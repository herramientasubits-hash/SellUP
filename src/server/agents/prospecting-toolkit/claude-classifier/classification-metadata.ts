/**
 * Agente 1 · Clasificador Claude — selección de candidatos y forma persistida (puro).
 */

import {
  CLASSIFICATION_IN_PROGRESS_OUTCOME,
  CLAUDE_CLASSIFICATION_METADATA_KEY,
  CLAUDE_CLASSIFIER_CONTRACT_VERSION,
  FINAL_CLASSIFICATION_OUTCOMES,
  type ClaudeClassificationMetadata,
  type CompanyClassificationResult,
} from './types';

/** Condiciones de completitud que el clasificador puede ayudar a resolver. */
export const CLASSIFIABLE_FAILED_CONDITIONS = ['subindustry_match', 'employee_count_status'] as const;

export type ClassifiableCandidateRow = {
  id: string;
  industry_id: string | null;
  industry?: string | null;
  source_primary?: string | null;
  name: string | null;
  website: string | null;
  domain: string | null;
  country_code: string | null;
  country: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

function failedConditions(metadata: Record<string, unknown> | null): string[] {
  const completeness = metadata?.target_completeness as { failed_conditions?: unknown } | undefined;
  const failed = completeness?.failed_conditions;
  return Array.isArray(failed) ? failed.filter((f): f is string => typeof f === 'string') : [];
}

/** Una marca «en proceso» más vieja que esto se considera abandonada. */
export const IN_PROGRESS_STALE_AFTER_MS = 15 * 60 * 1000;

function previousClassificationBlocks(metadata: Record<string, unknown> | null, nowMs: number): boolean {
  const previous = metadata?.[CLAUDE_CLASSIFICATION_METADATA_KEY] as
    | { outcome?: unknown; classified_at?: unknown; started_at?: unknown }
    | undefined;
  if (!previous || typeof previous !== 'object') return false;
  if (previous.outcome === CLASSIFICATION_IN_PROGRESS_OUTCOME) {
    const startedAt = typeof previous.started_at === 'string' ? Date.parse(previous.started_at) : NaN;
    return Number.isFinite(startedAt) && nowMs - startedAt < IN_PROGRESS_STALE_AFTER_MS;
  }
  // Errores pasajeros (429, timeout, sitio caído) se pueden reintentar; lo definitivo no.
  return (FINAL_CLASSIFICATION_OUTCOMES as readonly unknown[]).includes(previous.outcome);
}

export function needsClaudeClassification(
  row: ClassifiableCandidateRow,
  options: { force: boolean; nowMs: number },
): boolean {
  if (row.status !== 'needs_review') return false;
  if (!row.website && !row.domain) return false;
  if (!options.force && previousClassificationBlocks(row.metadata, options.nowMs)) return false;
  const failed = failedConditions(row.metadata);
  return failed.some((f) => (CLASSIFIABLE_FAILED_CONDITIONS as readonly string[]).includes(f));
}

/** Para la UI: cuántos candidatos del lote entrarían (misma regla que el servidor). */
export function countClaudeClassificationEligible(
  candidates: ReadonlyArray<Partial<ClassifiableCandidateRow> & { id: string }>,
  nowMs: number = Date.now(),
): number {
  return candidates.filter((c) =>
    needsClaudeClassification(
      {
        id: c.id,
        industry_id: c.industry_id ?? null,
        name: c.name ?? null,
        website: c.website ?? null,
        domain: c.domain ?? null,
        country_code: c.country_code ?? null,
        country: c.country ?? null,
        status: c.status ?? null,
        metadata: (c.metadata as Record<string, unknown> | null | undefined) ?? null,
      },
      { force: false, nowMs },
    ),
  ).length;
}

export function buildClassificationMetadata(
  result: CompanyClassificationResult,
  classifiedAt: string,
): ClaudeClassificationMetadata {
  return {
    contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
    classified_at: classifiedAt,
    advisory_only: true,
    outcome: result.outcome,
    model: result.usage?.model ?? null,
    sector: result.sector
      ? {
          industry_id: result.sector.industryId,
          industry_name: result.sector.industryName,
          subindustry_id: result.sector.subindustryId,
          subindustry_name: result.sector.subindustryName,
          matches_current_industry: result.sector.matchesCurrentIndustry,
          quote: result.sector.quote,
          source_url: result.sector.sourceUrl,
          confidence: result.sector.confidence,
          verification: result.sector.verification,
        }
      : null,
    employee_range: result.employeeRange
      ? {
          min: result.employeeRange.min,
          max: result.employeeRange.max,
          status: 'estimated',
          quote: result.employeeRange.quote,
          source_url: result.employeeRange.sourceUrl,
          confidence: result.employeeRange.confidence,
          verification: result.employeeRange.verification,
        }
      : null,
    rejected: result.rejected,
    is_operating_company: result.isOperatingCompany,
    linkedin_company: result.linkedin
      ? { url: result.linkedin.url, slug: result.linkedin.slug, source: result.linkedin.source }
      : null,
    page_final_url: result.pageFinalUrl,
    page_source: result.pageSource ?? null,
    estimated_cost_usd: result.usage?.estimatedCostUsd ?? null,
    web_search_requests: result.usage?.webSearchRequests ?? 0,
    error_code: result.errorCode,
  };
}

export type ClassificationInProgressMarker = {
  contract_version: typeof CLAUDE_CLASSIFIER_CONTRACT_VERSION;
  outcome: typeof CLASSIFICATION_IN_PROGRESS_OUTCOME;
  started_at: string;
  advisory_only: true;
};

export function buildInProgressMarker(startedAt: string): ClassificationInProgressMarker {
  return {
    contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
    outcome: CLASSIFICATION_IN_PROGRESS_OUTCOME,
    started_at: startedAt,
    advisory_only: true,
  };
}

/** Devuelve una metadata NUEVA con la sugerencia; nunca muta la original. */
export function mergeClassificationIntoMetadata(
  metadata: Record<string, unknown> | null,
  classification: ClaudeClassificationMetadata | ClassificationInProgressMarker,
): Record<string, unknown> {
  return { ...(metadata ?? {}), [CLAUDE_CLASSIFICATION_METADATA_KEY]: classification };
}
