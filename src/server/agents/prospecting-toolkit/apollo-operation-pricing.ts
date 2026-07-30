/**
 * apollo-operation-pricing.ts — SINGLE source of per-operation Apollo credit
 * pricing for Agent 1 company discovery.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§5).
 *
 * Why this module exists
 * ----------------------
 * Before it, the wizard's pre-flight reservation computed
 * `maxQueries × maxResultsPerQuery` inline (wizard-budget-estimate.ts) and the
 * provider computed the search charge inline (apollo-organizations-search-provider.ts),
 * while `organization_enrichment` credits were written by a third place and were
 * NOT part of the reservation at all. A pilot configured as
 * `1 query × 3 results × 1 enrichment` therefore reserved 3 credits and recorded
 * 4 — the exact mismatch observed in A1-APOLLO-LIVE-QA-1
 * (batch 7a75df68-aaa2-4558-9118-0846486a3e97).
 *
 * Every consumer — estimation, guardrails, usage-log writing and reconciliation —
 * must derive its numbers from here so the four can never drift again.
 *
 * Pricing confidence
 * ------------------
 * These are INTERNAL CONSERVATIVE CEILINGS, not invoiced facts. There is no
 * concluding external evidence about how Apollo bills `organizations_search`
 * (per request? per result? per page?), so the ceiling assumes the most expensive
 * plausible model — one credit per returned result. That keeps the reservation at
 * or above what the system can register, never below it.
 *
 * `pricingSource` / `pricingVersion` travel with every estimate so a later
 * invoice reconciliation can tell which assumption produced a given number, and
 * so nothing downstream mistakes an estimate for a confirmed charge.
 *
 * Pure: no env reads, no I/O, no Apollo calls.
 */

/** Identifies the assumption set behind these numbers. Bump on any change. */
export const APOLLO_PRICING_VERSION = 'apollo_operation_pricing_v1';

/**
 * Provenance of the numbers. `internal_conservative_ceiling` means "our own
 * upper bound", explicitly NOT "confirmed by Apollo billing".
 */
export const APOLLO_PRICING_SOURCE = 'internal_conservative_ceiling' as const;

export type ApolloPricingSource = typeof APOLLO_PRICING_SOURCE;

/** Apollo operations in Agent 1 company discovery that can consume credits. */
export const APOLLO_BILLABLE_OPERATION_KEYS = [
  'organizations_search',
  'organization_enrichment',
] as const;

export type ApolloBillableOperationKey = (typeof APOLLO_BILLABLE_OPERATION_KEYS)[number];

/**
 * Credits per billable unit, per operation.
 *   - organizations_search    → 1 credit per RESULT returned by Apollo.
 *   - organization_enrichment → 1 credit per enrichment CALL.
 */
export const APOLLO_CREDITS_PER_BILLABLE_UNIT: Readonly<
  Record<ApolloBillableOperationKey, number>
> = {
  organizations_search: 1,
  organization_enrichment: 1,
};

/** Human-readable unit each operation is billed by — for logs and diagnostics. */
export const APOLLO_BILLABLE_UNIT_LABEL: Readonly<
  Record<ApolloBillableOperationKey, string>
> = {
  organizations_search: 'per_result_returned',
  organization_enrichment: 'per_enrichment_call',
};

export function isApolloBillableOperationKey(
  value: string | null | undefined,
): value is ApolloBillableOperationKey {
  return (
    value !== null &&
    value !== undefined &&
    (APOLLO_BILLABLE_OPERATION_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Credits for `units` billable units of `operation`.
 * Negative or non-finite unit counts resolve to 0 — a malformed count must never
 * fabricate spend.
 */
export function creditsForApolloOperation(
  operation: ApolloBillableOperationKey,
  units: number,
): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  return Math.floor(units) * APOLLO_CREDITS_PER_BILLABLE_UNIT[operation];
}

// ── Run-level reservation breakdown ──────────────────────────────────────────

export type ApolloRunReservationInput = {
  /** Global cap on Apollo queries for the whole run. */
  maxQueriesPerRun: number;
  /** Cap on results requested per query. */
  maxResultsPerQuery: number;
  /** Run-level cap on `organization_enrichment` calls. */
  maxEnrichmentsPerRun: number;
  /**
   * Whether the enrichment cascade can actually run. When false the code path
   * that charges enrichment credits is unreachable, so reserving for it would
   * block executions for spend that cannot happen.
   */
  enrichmentCascadeEnabled: boolean;
};

export type ApolloRunReservationBreakdown = {
  searchReservedCredits: number;
  enrichmentReservedCredits: number;
  totalReservedCredits: number;
  pricingSource: ApolloPricingSource;
  pricingVersion: string;
  /** Echo of the caps the breakdown was derived from — no secrets. */
  derivedFrom: {
    maxQueriesPerRun: number;
    maxResultsPerQuery: number;
    maxEnrichmentsPerRun: number;
    enrichmentCascadeEnabled: boolean;
  };
};

function nonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Full reservation ceiling for an Apollo run: search AND enrichment.
 *
 * For the controlled-pilot configuration
 * (`1 query × 3 results × 1 enrichment`, cascade on) this returns
 * `3 + 1 = 4` — the amount the system can actually register — instead of the
 * search-only 3 that produced the observed mismatch. The `3 + 1` is DERIVED
 * from the caps here, never hardcoded at the wizard call site.
 */
export function resolveApolloRunReservationBreakdown(
  input: ApolloRunReservationInput,
): ApolloRunReservationBreakdown {
  const maxQueriesPerRun = nonNegativeInt(input.maxQueriesPerRun);
  const maxResultsPerQuery = nonNegativeInt(input.maxResultsPerQuery);
  const maxEnrichmentsPerRun = nonNegativeInt(input.maxEnrichmentsPerRun);

  const searchReservedCredits = creditsForApolloOperation(
    'organizations_search',
    maxQueriesPerRun * maxResultsPerQuery,
  );

  const enrichmentReservedCredits = input.enrichmentCascadeEnabled
    ? creditsForApolloOperation('organization_enrichment', maxEnrichmentsPerRun)
    : 0;

  return {
    searchReservedCredits,
    enrichmentReservedCredits,
    totalReservedCredits: searchReservedCredits + enrichmentReservedCredits,
    pricingSource: APOLLO_PRICING_SOURCE,
    pricingVersion: APOLLO_PRICING_VERSION,
    derivedFrom: {
      maxQueriesPerRun,
      maxResultsPerQuery,
      maxEnrichmentsPerRun,
      enrichmentCascadeEnabled: input.enrichmentCascadeEnabled,
    },
  };
}

/** Flat, secret-free metadata shape for batch/usage logs. */
export function toApolloReservationBreakdownMetadata(
  breakdown: ApolloRunReservationBreakdown,
): Record<string, number | string | boolean> {
  return {
    search_reserved_credits: breakdown.searchReservedCredits,
    enrichment_reserved_credits: breakdown.enrichmentReservedCredits,
    total_reserved_credits: breakdown.totalReservedCredits,
    pricing_source: breakdown.pricingSource,
    pricing_version: breakdown.pricingVersion,
    max_queries_per_run: breakdown.derivedFrom.maxQueriesPerRun,
    max_results_per_query: breakdown.derivedFrom.maxResultsPerQuery,
    max_enrichments_per_run: breakdown.derivedFrom.maxEnrichmentsPerRun,
    enrichment_cascade_enabled: breakdown.derivedFrom.enrichmentCascadeEnabled,
  };
}
