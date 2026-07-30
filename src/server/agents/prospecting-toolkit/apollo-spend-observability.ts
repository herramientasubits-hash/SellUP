/**
 * apollo-spend-observability.ts — The observability block persisted with every
 * Apollo usage log.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§10).
 *
 * Why a dedicated module
 * ----------------------
 * The facts needed to audit a charge — which page was requested, what Apollo
 * answered, how much quota was left, whether the call was billed — were scattered
 * across `apollo_pagination`, `apollo_page_logs` and the rate-limit helper, in
 * different shapes per call site. Reconciling a single credit meant knowing which
 * of three nested structures happened to carry the field.
 *
 * The absent-value rule
 * ---------------------
 * Every field is `number | string | boolean | null`, and an absent measurement is
 * `null` — NEVER `0`. A fabricated zero is indistinguishable from a real zero, and
 * `rate_limit_minute_remaining = 0` means "quota exhausted" while `null` means
 * "Apollo did not tell us". Conflating them is how a cost audit reaches a
 * confident wrong answer.
 *
 * Pure: no I/O, no env, no clock.
 */

import type { ApolloPageLogEntry } from './apollo-organizations-paginated-search';
import type { ApolloRateLimitSnapshot } from '@/server/integrations/apollo-rate-limit-headers';

export const APOLLO_SPEND_OBSERVABILITY_VERSION = 'apollo_spend_observability_v1';

/** Key under which the block is stored inside `provider_usage_logs.metadata`. */
export const SPEND_OBSERVABILITY_METADATA_KEY = 'spend_observability';

/** Billing outcome of a single provider call. `unknown` is a real state. */
export type ApolloObservedBillingState = 'charged' | 'not_charged' | 'unknown';

/**
 * The flat observability payload. Field names match the additive columns in
 * migration 100 one-for-one, so the same object serves the metadata block today
 * and the typed columns once the migration is applied.
 */
export type ApolloSpendObservability = {
  observability_version: string;
  http_status: number | null;
  latency_ms: number | null;
  page: number | null;
  per_page: number | null;
  pagination_page: number | null;
  pagination_total_pages: number | null;
  pagination_total_entries: number | null;
  results_returned: number | null;
  rate_limit_minute: number | null;
  rate_limit_minute_remaining: number | null;
  rate_limit_hourly: number | null;
  rate_limit_hourly_remaining: number | null;
  rate_limit_24_hour: number | null;
  rate_limit_24_hour_remaining: number | null;
  retry_after_seconds: number | null;
  billing_state: ApolloObservedBillingState | null;
  estimated_credits: number | null;
  recorded_usage_credits: number | null;
};

/** Every key of the payload, for column-projection and tests. */
export const APOLLO_SPEND_OBSERVABILITY_FIELDS = [
  'http_status',
  'latency_ms',
  'page',
  'per_page',
  'pagination_page',
  'pagination_total_pages',
  'pagination_total_entries',
  'results_returned',
  'rate_limit_minute',
  'rate_limit_minute_remaining',
  'rate_limit_hourly',
  'rate_limit_hourly_remaining',
  'rate_limit_24_hour',
  'rate_limit_24_hour_remaining',
  'retry_after_seconds',
  'billing_state',
  'estimated_credits',
  'recorded_usage_credits',
] as const;

/**
 * Coerces a measurement to a finite number, or `null`.
 *
 * `undefined`, `null`, `NaN`, `Infinity` and non-numeric input all become `null`.
 * A genuine `0` survives — the point is to keep real zeros and invented ones apart.
 */
export function toObservedNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toObservedBillingState(value: unknown): ApolloObservedBillingState | null {
  return value === 'charged' || value === 'not_charged' || value === 'unknown' ? value : null;
}

export type BuildApolloSpendObservabilityInput = {
  /** Page-level trace of the call, when the paginated transport produced one. */
  pageLog?: ApolloPageLogEntry | null;
  /** Quota snapshot from the response headers, when any header was present. */
  rateLimit?: ApolloRateLimitSnapshot | null;
  /** Pagination totals Apollo reported. */
  paginationTotalPages?: number | null;
  paginationTotalEntries?: number | null;
  /** HTTP status of the underlying request, when the transport surfaced one. */
  httpStatus?: number | null;
  /** Credits this call is estimated to cost. */
  estimatedCredits?: number | null;
  /** Credits actually written to `provider_usage_logs.credits_used` for it. */
  recordedUsageCredits?: number | null;
  /** Results returned, when not carried by `pageLog`. */
  resultsReturned?: number | null;
  /** Latency, when not carried by `pageLog`. */
  latencyMs?: number | null;
  /** Billing outcome, when not carried by `pageLog`. */
  billingState?: ApolloObservedBillingState | null;
};

/**
 * Assembles the observability block.
 *
 * `pageLog` wins where it has a value, because it is measured at the transport
 * boundary; explicit inputs fill the rest. Nothing is defaulted to zero: a field
 * neither source provides stays `null`.
 */
export function buildApolloSpendObservability(
  input: BuildApolloSpendObservabilityInput,
): ApolloSpendObservability {
  const pageLog = input.pageLog ?? null;
  const rateLimit = input.rateLimit ?? null;

  return {
    observability_version: APOLLO_SPEND_OBSERVABILITY_VERSION,
    http_status: toObservedNumber(input.httpStatus),
    latency_ms: toObservedNumber(pageLog?.latencyMs) ?? toObservedNumber(input.latencyMs),
    page: toObservedNumber(pageLog?.page),
    per_page: toObservedNumber(pageLog?.perPage),
    // `pagination_page` is the page Apollo says it served; `page` is the page we
    // asked for. They usually agree, and when they do not that is the finding.
    pagination_page: toObservedNumber(pageLog?.page),
    pagination_total_pages: toObservedNumber(input.paginationTotalPages),
    pagination_total_entries: toObservedNumber(input.paginationTotalEntries),
    results_returned:
      toObservedNumber(pageLog?.resultsReturned) ?? toObservedNumber(input.resultsReturned),
    rate_limit_minute: toObservedNumber(rateLimit?.minute.limit),
    rate_limit_minute_remaining: toObservedNumber(rateLimit?.minute.remaining),
    rate_limit_hourly: toObservedNumber(rateLimit?.hourly.limit),
    rate_limit_hourly_remaining: toObservedNumber(rateLimit?.hourly.remaining),
    rate_limit_24_hour: toObservedNumber(rateLimit?.daily.limit),
    rate_limit_24_hour_remaining: toObservedNumber(rateLimit?.daily.remaining),
    retry_after_seconds: toObservedNumber(rateLimit?.retryAfterSeconds),
    billing_state:
      toObservedBillingState(pageLog?.billingState) ??
      toObservedBillingState(input.billingState),
    estimated_credits:
      toObservedNumber(input.estimatedCredits) ?? toObservedNumber(pageLog?.estimatedCredits),
    recorded_usage_credits: toObservedNumber(input.recordedUsageCredits),
  };
}

/**
 * Projection of the block onto the additive columns from migration 100.
 *
 * `observability_version` is deliberately excluded — it belongs to the metadata
 * block, not to a column. The writer only spreads this when the columns exist;
 * see `apollo-organizations-usage-logging.ts`.
 */
export function toProviderUsageObservabilityColumns(
  observability: ApolloSpendObservability,
): Record<string, number | string | null> {
  const columns: Record<string, number | string | null> = {};
  for (const field of APOLLO_SPEND_OBSERVABILITY_FIELDS) {
    columns[field] = observability[field];
  }
  return columns;
}
