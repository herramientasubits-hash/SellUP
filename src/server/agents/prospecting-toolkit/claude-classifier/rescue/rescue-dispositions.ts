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
  DOMAIN_SEARCH_REASON_CODE,
  readFoundWebsite,
  websiteNotFoundBeforeOfficialNames,
  websiteRejectedByOlderInstitutionRule,
  websiteNotFoundByAccountError,
  websiteNotFoundWithOlderSearch,
} from './domain-search';
import type { RescueDecision } from './rescue-decision';
import { isSizeUnfiltered, officialSizeSignal } from './official-size-signal';
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
  retryAttemptsOf,
  withRetryAttempt,
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
  // Dueña 14-11 — el proveedor la declaró de otra industria: la IA lo comprueba. Si es de
  // la pedida, vuelve; si es de otra y es viable, va al banco con su industria.
  'excluding_industry_declared',
  'declared_industry_outside_macro',
  // Dueña 14-11 — el proveedor la dejó fuera por pequeña con un tamaño que la IA puede
  // verificar (Lusha subestima). Si la IA mide ≥ mínimo, vuelve (o va al banco con tope).
  'known_employee_count_below_min',
] as const;

/** Descarte por el tamaño que dio el proveedor (lo verifica la IA). */
export const PROVIDER_SIZE_REASON_CODE = 'known_employee_count_below_min' as const;

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
  /** `free_source` ⇒ vino del buscador gratuito oficial del país. */
  round_origin?: string | null;
  /** `tax:<número fiscal>` cuando vino de un registro oficial (SOURCES-EC-CLOSE-2). */
  provider_identifier?: string | null;
  /** Proveedor de origen (`lusha`, `apollo`, `public_source`…): el banco lo guarda. */
  source_primary?: string | null;
};

type Evidence = Record<string, unknown>;

/**
 * SOURCES-EC-CLOSE-2 — marca en `claude_rescue` de una fila que se quedó en Descartadas
 * decidida YA con la regla del tamaño oficial (la capa gratuita vuelve a revisión sin
 * sector confirmado si sólo le faltaba la web).
 */
export const OFFICIAL_SIZE_RULE_MARKER = 'official_size_rule' as const;

/**
 * Del buscador gratuito, descartada sólo por falta de web, con la web YA encontrada y
 * tamaño oficial medido, que se quedó sin cambio ANTES de esa regla: vale una vuelta
 * más (sólo la clasificación; la web no se vuelve a buscar). Prod 06-10, EC×Tec
 * 0ef658fd: Cartimex, Computron, Movilcelistic.
 */
export function keptBeforeOfficialSizeRule(row: RescuableDispositionRow): boolean {
  if (row.domain || row.reason_code !== DOMAIN_SEARCH_REASON_CODE) return false;
  const fromFreeLayer = row.round_origin === 'free_source' || row.evidence?.tax_identifier_present === true;
  if (!officialSizeSignal({ countryCode: row.country_code, fromFreeLayer, sizeUnfiltered: isSizeUnfiltered(row.evidence) }).measured) return false;
  const rescue = row.evidence?.[CLAUDE_RESCUE_METADATA_KEY] as Record<string, unknown> | undefined;
  if (rescue?.decision !== 'unchanged' || rescue[OFFICIAL_SIZE_RULE_MARKER] === true) return false;
  return readFoundWebsite(row.evidence ?? null) !== null;
}

/**
 * Dueña 16-11 — marca del arreglo «al banco con la web encontrada». Las filas que el banco
 * rechazó ANTES (iban sin la web: «BO Chile Packaging») se reintentan UNA vez.
 */
export const BANK_WITH_FOUND_WEB_FIX = 'bank_found_web_v1' as const;

export function bankFailedBeforeFix(evidence: Record<string, unknown> | null): boolean {
  const rescue = evidence?.[CLAUDE_RESCUE_METADATA_KEY] as Record<string, unknown> | undefined;
  return rescue?.bank_outcome === 'failed' && rescue[BANK_WITH_FOUND_WEB_FIX] !== true;
}

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
  if (!row.domain && websiteNotFoundBeforeOfficialNames(row)) return true;
  if (!row.domain && websiteRejectedByOlderInstitutionRule(row)) return true;
  if (keptBeforeOfficialSizeRule(row)) return true;
  if (bankFailedBeforeFix(row.evidence)) return true;
  return rescueStillPending(
    row.evidence?.[CLAUDE_RESCUE_METADATA_KEY],
    nowMs,
    row.evidence?.claude_classification,
    retryAttemptsOf(row.evidence),
  );
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
  const retryable = RETRYABLE_OUTCOMES.has(result.outcome);
  const rescue = retryable
    ? { ...buildRescueMetadata(decision, [], decidedAt), decision: 'retryable' }
    : buildRescueMetadata(decision, [], decidedAt);
  const stays = {
    ...(evidence ?? {}),
    claude_classification: buildClassificationMetadata(result, decidedAt),
    [CLAUDE_RESCUE_METADATA_KEY]: rescue,
  };
  return retryable ? withRetryAttempt(stays) : stays;
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
