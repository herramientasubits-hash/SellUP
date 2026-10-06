/**
 * Agente 1 · Rescate con Claude — empresas descartadas por FALTA DE DATOS (puro).
 *
 * Sólo se rescatan los descartes cuyo motivo es que faltaba un dato que Claude
 * puede completar. Los descartes correctos (duplicado en HubSpot/SellUp,
 * periodo de espera, dominio ajeno, país equivocado, tamaño conocido menor)
 * NO se tocan. Sin dominio (`missing_domain_final`) sólo con el buscador de
 * sitio oficial encendido (`domain-search.ts`).
 */

import { buildClassificationMetadata } from '../classification-metadata';
import {
  type ClassifierCompanyInput,
  type CompanyClassificationResult,
} from '../types';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import {
  isDomainSearchCandidate,
  websiteNotFoundByAccountError,
  websiteNotFoundWithOlderSearch,
} from './domain-search';
import type { RescueDecision } from './rescue-decision';
import {
  buildLinkedInEnrichmentFromClaude,
  buildIcpSizeGatePass,
  buildRescueInProgress,
  buildReassignedCompleteness,
  buildReassignReviewNote,
  buildRescueMetadata,
  CLAUDE_EMPLOYEE_COUNT_SOURCE,
  CLAUDE_RESCUE_METADATA_KEY,
  reassignedIndustryColumns,
  RETRYABLE_OUTCOMES,
  rescueStillPending,
} from './rescue-patch';

/**
 * Motivos de descarte que significan «faltaba un dato», medidos en Prod 30-09:
 * Lusha sólo trajo la industria padre (59), Apollo sin créditos de
 * enriquecimiento (36), Apollo no pudo confirmar el sector (16).
 */
export const RESCUABLE_DISPOSITION_REASON_CODES = [
  'sub_industry_branch_parent_only',
  'enrichment_budget_exhausted_final',
  'sector_subindustry_rejected_final',
] as const;

export type RescuableDispositionRow = {
  id: string;
  batch_id: string;
  candidate_id: string | null;
  status: string;
  name: string;
  domain: string | null;
  country_code: string | null;
  industry: string | null;
  reason_code: string | null;
  evidence: Record<string, unknown> | null;
};

type Evidence = Record<string, unknown>;

export function needsDispositionRescue(
  row: RescuableDispositionRow,
  nowMs: number,
  /** ¿Está encendido el buscador de sitio oficial? (`ENABLE_AGENT1_CLAUDE_DOMAIN_FINDER`) */
  domainSearchEnabled = false,
): boolean {
  if (row.status !== 'discarded' || row.candidate_id) return false;
  const rescuable = row.domain
    ? (RESCUABLE_DISPOSITION_REASON_CODES as readonly string[]).includes(row.reason_code ?? '')
    : domainSearchEnabled && isDomainSearchCandidate(row);
  if (!rescuable) return false;
  if (!row.domain && websiteNotFoundWithOlderSearch(row.evidence)) return true;
  if (!row.domain && websiteNotFoundByAccountError(row.evidence)) return true;
  return rescueStillPending(row.evidence?.[CLAUDE_RESCUE_METADATA_KEY], nowMs, row.evidence?.claude_classification);
}

export function dispositionToCompanyInput(row: RescuableDispositionRow): ClassifierCompanyInput {
  return {
    candidateId: row.id,
    name: row.name,
    websiteOrDomain: row.domain,
    countryCode: row.country_code,
    countryName: null,
    currentIndustryId: null,
    // En la disposición, `industry` es la macroindustria PEDIDA por la corrida.
    currentIndustryName: row.industry,
  };
}

export function buildDispositionInProgressEvidence(evidence: Evidence | null, startedAt: string): Evidence {
  return { ...(evidence ?? {}), [CLAUDE_RESCUE_METADATA_KEY]: buildRescueInProgress(startedAt) };
}

/** Evidencia de un descarte que se QUEDA en Descartadas (no pasó, o no se pudo saber). */
export function buildDispositionStaysEvidence(
  evidence: Evidence | null,
  result: CompanyClassificationResult,
  decision: RescueDecision,
  decidedAt: string,
): Evidence {
  const rescue = RETRYABLE_OUTCOMES.has(result.outcome)
    ? { ...buildRescueMetadata(decision, [], decidedAt), decision: 'retryable' }
    : buildRescueMetadata(decision, [], decidedAt);
  return {
    ...(evidence ?? {}),
    claude_classification: buildClassificationMetadata(result, decidedAt),
    [CLAUDE_RESCUE_METADATA_KEY]: rescue,
  };
}

/** Origen para `sendDispositionToReviewCore` cuando la empresa pasó los filtros. */
export function buildDispositionAdmissionOrigin(
  result: CompanyClassificationResult,
  decision: Extract<RescueDecision, { kind: 'admit' }>,
  minEmployees: number,
  decidedAt: string,
): SendToReviewOrigin {
  const range = decision.sizeConfirmed ? result.employeeRange : null;
  const sectorName = result.sector?.industryName ?? 'sector del lote';
  return {
    kind: 'claude_rescue',
    reviewNote: `Rescatada por Claude: ${sectorName}${range ? `, ${range.min}+ empleados (estimado)` : ''}.`,
    metadata: {
      claude_classification: buildClassificationMetadata(result, decidedAt),
      [CLAUDE_RESCUE_METADATA_KEY]: buildRescueMetadata(decision, [], decidedAt),
      ...(range ? { icp_size_gate: buildIcpSizeGatePass(null, result, minEmployees) } : {}),
      ...(decision.linkedinConfirmed
        ? { linkedin_enrichment: buildLinkedInEnrichmentFromClaude(null, result, decidedAt) }
        : {}),
    },
    columns: {
      ...(result.sector ? { industry: result.sector.industryName } : {}),
      ...(result.sector?.sourceUrl && result.pageFinalUrl ? { website: result.pageFinalUrl } : {}),
      ...(range
        ? {
            employee_count: range.min,
            employee_count_status: 'estimated_100_plus',
            employee_count_source: CLAUDE_EMPLOYEE_COUNT_SOURCE,
            employee_count_confidence: Math.round(range.confidence * 100),
          }
        : {}),
    },
  };
}

/**
 * Origen para `sendDispositionToReviewCore` cuando la empresa es de OTRA industria
 * UBITS: vuelve a revisión del mismo vendedor con la industria corregida y una
 * completitud que la deja FUERA de la meta.
 */
export function buildDispositionReassignOrigin(
  result: CompanyClassificationResult,
  decision: Extract<RescueDecision, { kind: 'reassign' }>,
  minEmployees: number,
  decidedAt: string,
): SendToReviewOrigin {
  const range = decision.sizeConfirmed ? result.employeeRange : null;
  return {
    kind: 'claude_rescue',
    reviewNote: buildReassignReviewNote(decision),
    metadata: {
      claude_classification: buildClassificationMetadata(result, decidedAt),
      [CLAUDE_RESCUE_METADATA_KEY]: buildRescueMetadata(decision, [], decidedAt),
      target_completeness: buildReassignedCompleteness(null),
      ...(range ? { icp_size_gate: buildIcpSizeGatePass(null, result, minEmployees) } : {}),
      ...(decision.linkedinConfirmed
        ? { linkedin_enrichment: buildLinkedInEnrichmentFromClaude(null, result, decidedAt) }
        : {}),
    },
    columns: {
      ...reassignedIndustryColumns(decision),
      ...(result.sector?.sourceUrl && result.pageFinalUrl ? { website: result.pageFinalUrl } : {}),
      ...(range
        ? {
            employee_count: range.min,
            employee_count_status: 'estimated_100_plus',
            employee_count_source: CLAUDE_EMPLOYEE_COUNT_SOURCE,
            employee_count_confidence: Math.round(range.confidence * 100),
          }
        : {}),
    },
  };
}
