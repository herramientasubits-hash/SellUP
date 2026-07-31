/**
 * apollo-operation-pricing.ts — Single source of Apollo per-operation credit pricing.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * Root cause this file closes:
 *   The wizard reserved `maxQueries × maxResults` credits (1 × 3 = 3) for an
 *   Apollo run, but a run can also spend Organization Enrichment credits. The
 *   QA batch of 2026-07-30 (7a75df68-aaa2-4558-9118-0846486a3e97) was charged
 *   4 credits — 3 organizations_search + 1 organization_enrichment — against a
 *   3-credit reservation. The reservation only knew about one of the two
 *   billable operations.
 *
 * Contract:
 *   - Every module needing an Apollo credit number (preflight estimation, cost
 *     guardrails, usage logging, reconciliation) reads it from here.
 *   - No caller may hardcode `3`, `+ 1`, or `3 + 1`.
 *   - Each breakdown carries `pricingSource` and `pricingVersion`, so a
 *     reconciliation can tell which pricing produced a given reservation.
 *
 * Pure: no I/O and no process.env reads. Caps are injected by the caller, which
 * keeps this module deterministic and testable offline.
 */

/** Apollo operations that consume credits in the Agent 1 company-discovery run. */
export type ApolloBillableOperationKey =
  | 'organizations_search'
  | 'organization_enrichment';

/** Canonical operation keys, exactly as written to provider_usage_logs.operation_key. */
export const APOLLO_BILLABLE_OPERATION_KEYS: readonly ApolloBillableOperationKey[] = [
  'organizations_search',
  'organization_enrichment',
] as const;

/**
 * Bumped whenever the credit model changes (units, operations, or formula).
 * Persisted alongside reservations so an old reservation stays interpretable.
 */
export const APOLLO_PRICING_VERSION = 'a1-apollo-operation-pricing-v1';

/** Where the numbers come from. Not a live provider_pricing_config read. */
export const APOLLO_PRICING_SOURCE = 'apollo_operation_pricing_table';

/**
 * Credits charged per billable unit.
 *   organizations_search    → 1 credit per organization RETURNED (not per query).
 *   organization_enrichment → 1 credit per enrichment API call attempted.
 */
export const APOLLO_CREDITS_PER_UNIT: Readonly<
  Record<ApolloBillableOperationKey, number>
> = {
  organizations_search: 1,
  organization_enrichment: 1,
};

export type ApolloRunPricingInput = {
  /** Resolved cap of Apollo queries for the whole run. */
  maxQueriesPerRun: number;
  /** Resolved cap of results requested per query. */
  maxResultsPerQuery: number;
  /**
   * Resolved cap of Organization Enrichment calls for the whole run.
   * Callers pass the run-level cap, not the per-call cap.
   */
  maxEnrichmentsPerRun: number;
  /**
   * False when the enrichment cascade flag is OFF. A disabled cascade cannot
   * issue enrichment calls, so it reserves zero enrichment credits — but the
   * breakdown still records that the operation was considered.
   */
  enrichmentEnabled: boolean;
};

export type ApolloRunCreditBreakdown = {
  searchReservedCredits: number;
  enrichmentReservedCredits: number;
  totalReservedCredits: number;
  pricingSource: string;
  pricingVersion: string;
  /** Echo of the caps used, so a reservation is reproducible from its record. */
  inputs: ApolloRunPricingInput;
};

function toNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Returns the full credit breakdown for one Apollo wizard run.
 *
 * search     = maxQueriesPerRun × maxResultsPerQuery × credits/result
 * enrichment = maxEnrichmentsPerRun × credits/enrichment (0 when disabled)
 *
 * The total is what must be reserved before the first Apollo call.
 */
export function estimateApolloRunCreditBreakdown(
  input: ApolloRunPricingInput,
): ApolloRunCreditBreakdown {
  const queries = toNonNegativeInt(input.maxQueriesPerRun);
  const results = toNonNegativeInt(input.maxResultsPerQuery);
  const enrichments = input.enrichmentEnabled
    ? toNonNegativeInt(input.maxEnrichmentsPerRun)
    : 0;

  const searchReservedCredits =
    queries * results * APOLLO_CREDITS_PER_UNIT.organizations_search;
  const enrichmentReservedCredits =
    enrichments * APOLLO_CREDITS_PER_UNIT.organization_enrichment;

  return {
    searchReservedCredits,
    enrichmentReservedCredits,
    totalReservedCredits: searchReservedCredits + enrichmentReservedCredits,
    pricingSource: APOLLO_PRICING_SOURCE,
    pricingVersion: APOLLO_PRICING_VERSION,
    inputs: {
      maxQueriesPerRun: queries,
      maxResultsPerQuery: results,
      maxEnrichmentsPerRun: enrichments,
      enrichmentEnabled: input.enrichmentEnabled,
    },
  };
}

/**
 * Credits charged for N units of an operation.
 *
 * Used by usage logging so the credits it records and the credits the wizard
 * reserved come from the same table rather than two independent constants.
 */
export function creditsForApolloOperation(
  operation: ApolloBillableOperationKey,
  units: number,
): number {
  return toNonNegativeInt(units) * APOLLO_CREDITS_PER_UNIT[operation];
}

/** Credits a single unit of the given operation costs. */
export function creditsForApolloOperationUnit(
  operation: ApolloBillableOperationKey,
): number {
  return APOLLO_CREDITS_PER_UNIT[operation];
}

/** True when the operation key is one this pricing model bills. */
export function isApolloBillableOperation(
  operationKey: string,
): operationKey is ApolloBillableOperationKey {
  return (APOLLO_BILLABLE_OPERATION_KEYS as readonly string[]).includes(operationKey);
}

/** Diagnostic shape persisted in batch/reservation metadata. No secrets. */
export type ApolloRunCreditBreakdownMetadata = {
  search_reserved_credits: number;
  enrichment_reserved_credits: number;
  total_reserved_credits: number;
  pricing_source: string;
  pricing_version: string;
  max_queries_per_run: number;
  max_results_per_query: number;
  max_enrichments_per_run: number;
  enrichment_enabled: boolean;
};

export function toApolloRunCreditBreakdownMetadata(
  breakdown: ApolloRunCreditBreakdown,
): ApolloRunCreditBreakdownMetadata {
  return {
    search_reserved_credits: breakdown.searchReservedCredits,
    enrichment_reserved_credits: breakdown.enrichmentReservedCredits,
    total_reserved_credits: breakdown.totalReservedCredits,
    pricing_source: breakdown.pricingSource,
    pricing_version: breakdown.pricingVersion,
    max_queries_per_run: breakdown.inputs.maxQueriesPerRun,
    max_results_per_query: breakdown.inputs.maxResultsPerQuery,
    max_enrichments_per_run: breakdown.inputs.maxEnrichmentsPerRun,
    enrichment_enabled: breakdown.inputs.enrichmentEnabled,
  };
}
