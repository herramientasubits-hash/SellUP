/**
 * Agente 1 · Rescate con Claude — qué se escribe en cada fila (puro).
 *
 * Nunca muta la metadata recibida: siempre devuelve objetos nuevos.
 */

import { buildClassificationMetadata } from '../classification-metadata';
import { CLAUDE_CLASSIFIER_CONTRACT_VERSION, type CompanyClassificationResult } from '../types';
import type { RescueDecision } from './rescue-decision';

export const CLAUDE_RESCUE_METADATA_KEY = 'claude_rescue';
export const CLAUDE_EMPLOYEE_COUNT_SOURCE = 'claude_classifier';

/** Condiciones del contrato de completitud que el rescate puede dar por cumplidas. */
const SECTOR_CONDITION = 'subindustry_match';
const SIZE_CONDITION = 'employee_count_status';
const LINKEDIN_CONDITION = 'linkedin_status';

/** Un sitio caído o un error del modelo no es un veredicto: se vuelve a intentar. */
export const RETRYABLE_OUTCOMES: ReadonlySet<string> = new Set(['website_unreachable', 'model_error']);

/** Una marca «en proceso» más vieja que esto se considera abandonada. */
export const RESCUE_STALE_AFTER_MS = 15 * 60 * 1000;

export function buildRescueInProgress(startedAt: string): Record<string, unknown> {
  return { contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION, decision: 'in_progress', started_at: startedAt };
}

/** ¿Hay que (re)procesar esta fila? Sin veredicto, o con uno reintentable, o con una marca vieja. */
/** Decisiones SIN veredicto de sector: se reintentan si cambió el contrato del clasificador. */
const NO_VERDICT_DECISIONS = new Set(['unchanged', 'data_completed']);

/**
 * `classification` = `metadata.claude_classification` de la fila. Con contrato viejo,
 * un «admit» cuyo sector NUNCA se confirmó (antes de existir `data_completed`, Prod
 * 30-09: KFC, mineras, Diario Gestión) tampoco es un veredicto y se reintenta.
 */
export function rescueStillPending(rescue: unknown, nowMs: number, classification?: unknown): boolean {
  if (!rescue || typeof rescue !== 'object') return true;
  const r = rescue as { decision?: unknown; started_at?: unknown; contract_version?: unknown };
  if (r.decision === 'in_progress') {
    const startedAt = typeof r.started_at === 'string' ? Date.parse(r.started_at) : NaN;
    return !(Number.isFinite(startedAt) && nowMs - startedAt < RESCUE_STALE_AFTER_MS);
  }
  if (r.decision === 'retryable') return true;
  // Un clasificador nuevo puede dar el veredicto que el anterior no pudo; lo decidido
  // (descartes, admisiones) NUNCA se reabre.
  if (r.contract_version === CLAUDE_CLASSIFIER_CONTRACT_VERSION) return false;
  if (NO_VERDICT_DECISIONS.has(String(r.decision))) return true;
  if (r.decision === 'admit') {
    const sector = (classification as { sector?: { matches_current_industry?: unknown } | null } | undefined)?.sector;
    return sector?.matches_current_industry !== true;
  }
  return false;
}

export type ClaudeRescueMetadata = {
  contract_version: typeof CLAUDE_CLASSIFIER_CONTRACT_VERSION;
  decided_at: string;
  /**
   * `admit` = pasó el filtro de sector; `data_completed` = sólo se completaron datos
   * (tamaño/LinkedIn), el sector NO quedó confirmado. Prod 30-09: «admit» sin sector
   * confirmado se leía como «pasó el filtro».
   */
  decision: RescueDecision['kind'] | 'data_completed';
  /** Claude vio otro sector sin evidencia suficiente para descartar. */
  sector_warning: 'claude_sector_mismatch_unconfirmed' | null;
  discard_reason: string | null;
  discard_detail: string | null;
  discard_source_url: string | null;
  resolved_conditions: string[];
};

type Metadata = Record<string, unknown>;

function asObject(value: unknown): Metadata | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Metadata) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function buildRescueMetadata(
  decision: RescueDecision,
  resolved: readonly string[],
  decidedAt: string,
): ClaudeRescueMetadata {
  return {
    contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
    decided_at: decidedAt,
    decision: decision.kind === 'admit' && !decision.sectorConfirmed ? 'data_completed' : decision.kind,
    sector_warning:
      decision.kind !== 'discard' && decision.sectorMismatchUnconfirmed ? 'claude_sector_mismatch_unconfirmed' : null,
    discard_reason: decision.kind === 'discard' ? decision.reason : null,
    discard_detail: decision.kind === 'discard' ? decision.detail : null,
    discard_source_url: decision.kind === 'discard' ? decision.sourceUrl : null,
    resolved_conditions: [...resolved],
  };
}

/**
 * Quita de `target_completeness` lo que Claude resolvió y recalcula si el
 * candidato ya cuenta para la meta. Si quedan otras condiciones (LinkedIn,
 * duplicado, calidad), sigue sin contar: el rescate sólo resuelve lo suyo.
 */
export function resolveCompletenessConditions(
  completeness: Metadata | null,
  decision: Extract<RescueDecision, { kind: 'admit' }>,
): { completeness: Metadata | null; resolved: string[] } {
  if (!completeness) return { completeness: null, resolved: [] };
  const failed = stringList(completeness.failed_conditions);
  const requestedSubindustries = stringList(completeness.requested_subindustries);
  const resolvable = new Set<string>();
  // Con subindustrias pedidas, la macroindustria no basta (el catálogo v2 no tiene subindustrias).
  if (decision.sectorConfirmed && requestedSubindustries.length === 0) resolvable.add(SECTOR_CONDITION);
  if (decision.sizeConfirmed) resolvable.add(SIZE_CONDITION);
  if (decision.linkedinConfirmed) resolvable.add(LINKEDIN_CONDITION);

  const resolved = failed.filter((c) => resolvable.has(c));
  if (resolved.length === 0) return { completeness, resolved };
  const keep = (list: unknown) => stringList(list).filter((c) => !resolvable.has(c));
  const remaining = keep(completeness.failed_conditions);
  const complete = remaining.length === 0;
  return {
    resolved,
    completeness: {
      ...completeness,
      failed_conditions: remaining,
      blocking_reasons: keep(completeness.blocking_reasons),
      review_only_reasons: keep(completeness.review_only_reasons),
      complete_valid: complete,
      counts_toward_target: complete,
      review_only: !complete,
      resolved_by_claude: resolved,
    },
  };
}

export function buildIcpSizeGatePass(
  previous: Metadata | null,
  result: CompanyClassificationResult,
  minEmployees: number,
): Metadata | null {
  const range = result.employeeRange;
  if (!range) return previous;
  return {
    ...(previous ?? {}),
    decision: 'pass',
    size_status: 'estimated_above_threshold',
    threshold: minEmployees,
    normalized_min_employees: range.min,
    normalized_max_employees: range.max ?? range.min,
    requires_human_review: false,
    reason: `Claude: «${range.quote.slice(0, 120)}»`,
    source: CLAUDE_EMPLOYEE_COUNT_SOURCE,
  };
}

/**
 * `metadata.linkedin_enrichment` en la forma canónica de SellUp (la que lee
 * `getCandidateLinkedInUrl`). Nunca pisa un LinkedIn ya encontrado.
 */
export function buildLinkedInEnrichmentFromClaude(
  previous: Metadata | null,
  result: CompanyClassificationResult,
  checkedAt: string,
): Metadata | null {
  if (!result.linkedin) return previous;
  if (previous?.status === 'found' && typeof previous.company_url === 'string') return previous;
  return {
    enabled: true,
    status: 'found',
    company_url: result.linkedin.url,
    normalized_company_slug: result.linkedin.slug,
    confidence: result.linkedin.source === 'website_social_link' ? 90 : 75,
    match_reason: `claude_classifier:${result.linkedin.source}`,
    signals: null,
    warnings: [],
    source: result.linkedin.source,
    checked_at: checkedAt,
  };
}

export type CandidateRescuePatch = {
  status?: 'discarded';
  review_notes?: string;
  employee_count?: number;
  employee_count_status?: 'estimated_100_plus';
  employee_count_source?: string;
  employee_count_confidence?: number;
  metadata: Metadata;
};

/** Cambio para un candidato YA existente («Candidatos por revisar»). */
export function buildCandidateRescuePatch(params: {
  metadata: Metadata | null;
  result: CompanyClassificationResult;
  decision: RescueDecision;
  minEmployees: number;
  decidedAt: string;
}): CandidateRescuePatch {
  const { result, decision, minEmployees, decidedAt } = params;
  const base: Metadata = {
    ...(params.metadata ?? {}),
    claude_classification: buildClassificationMetadata(result, decidedAt),
  };

  if (decision.kind === 'discard') {
    return {
      status: 'discarded',
      review_notes: `Descartada automáticamente (Claude): ${decision.detail}`,
      metadata: { ...base, [CLAUDE_RESCUE_METADATA_KEY]: buildRescueMetadata(decision, [], decidedAt) },
    };
  }
  if (decision.kind === 'unchanged') {
    const rescue = RETRYABLE_OUTCOMES.has(result.outcome)
      ? { ...buildRescueMetadata(decision, [], decidedAt), decision: 'retryable' }
      : buildRescueMetadata(decision, [], decidedAt);
    return { metadata: { ...base, [CLAUDE_RESCUE_METADATA_KEY]: rescue } };
  }

  const { completeness, resolved } = resolveCompletenessConditions(asObject(base.target_completeness), decision);
  const withCompleteness: Metadata = completeness ? { ...base, target_completeness: completeness } : base;
  const metadata: Metadata = {
    ...withCompleteness,
    ...(decision.sizeConfirmed
      ? { icp_size_gate: buildIcpSizeGatePass(asObject(base.icp_size_gate), result, minEmployees) }
      : {}),
    ...(decision.linkedinConfirmed
      ? { linkedin_enrichment: buildLinkedInEnrichmentFromClaude(asObject(base.linkedin_enrichment), result, decidedAt) }
      : {}),
    [CLAUDE_RESCUE_METADATA_KEY]: buildRescueMetadata(decision, resolved, decidedAt),
  };
  const range = decision.sizeConfirmed ? result.employeeRange : null;
  return {
    metadata,
    ...(range
      ? {
          employee_count: range.min,
          employee_count_status: 'estimated_100_plus' as const,
          employee_count_source: CLAUDE_EMPLOYEE_COUNT_SOURCE,
          employee_count_confidence: Math.round(range.confidence * 100),
        }
      : {}),
  };
}
