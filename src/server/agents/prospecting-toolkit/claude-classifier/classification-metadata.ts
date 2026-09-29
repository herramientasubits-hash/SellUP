/**
 * Agente 1 · Clasificador Claude — selección de candidatos y forma persistida (puro).
 */

import {
  CLAUDE_CLASSIFICATION_METADATA_KEY,
  CLAUDE_CLASSIFIER_CONTRACT_VERSION,
  type ClaudeClassificationMetadata,
  type CompanyClassificationResult,
} from './types';

/** Condiciones de completitud que el clasificador puede ayudar a resolver. */
export const CLASSIFIABLE_FAILED_CONDITIONS = ['subindustry_match', 'employee_count_status'] as const;

export type ClassifiableCandidateRow = {
  id: string;
  industry_id: string | null;
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

export function needsClaudeClassification(row: ClassifiableCandidateRow, options: { force: boolean }): boolean {
  if (row.status !== 'needs_review') return false;
  if (!row.website && !row.domain) return false;
  if (!options.force && row.metadata?.[CLAUDE_CLASSIFICATION_METADATA_KEY]) return false;
  const failed = failedConditions(row.metadata);
  return failed.some((f) => (CLASSIFIABLE_FAILED_CONDITIONS as readonly string[]).includes(f));
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
    page_final_url: result.pageFinalUrl,
    estimated_cost_usd: result.usage?.estimatedCostUsd ?? null,
    web_search_requests: result.usage?.webSearchRequests ?? 0,
    error_code: result.errorCode,
  };
}

/** Devuelve una metadata NUEVA con la sugerencia; nunca muta la original. */
export function mergeClassificationIntoMetadata(
  metadata: Record<string, unknown> | null,
  classification: ClaudeClassificationMetadata,
): Record<string, unknown> {
  return { ...(metadata ?? {}), [CLAUDE_CLASSIFICATION_METADATA_KEY]: classification };
}
