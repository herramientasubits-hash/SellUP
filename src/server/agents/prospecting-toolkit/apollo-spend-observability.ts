/**
 * apollo-spend-observability.ts — One observability contract for every Apollo
 * organizations call, successful or not.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * Pagination and quota headers already reached provider_usage_logs — but only
 * on the terminal-error path. A successful search logged its result counts and
 * nothing about pages, quota or latency, so the runs that actually spent money
 * were the ones we could say least about afterwards.
 *
 * This module builds the record once, from whatever is available, and both
 * paths persist the same shape. Every field is nullable on purpose: an absent
 * header must be recorded as "we did not receive it", never as 0 —
 * `rate_limit_minute_remaining = 0` means the quota is exhausted, `null` means
 * the provider did not say.
 *
 * Never persists secrets: no API key, no Authorization header, no raw error
 * body, no query text, no organization payload.
 */

import type { ApolloRateLimitSnapshot } from '@/server/integrations/apollo-rate-limit-headers';
import type { WizardRunBillingState } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';

/**
 * Flat, nullable observability record persisted under
 * provider_usage_logs.metadata.spend_observability.
 */
export type ApolloSpendObservabilityRecord = {
  httpStatus: number | null;
  latencyMs: number | null;
  page: number | null;
  perPage: number | null;
  paginationPage: number | null;
  paginationTotalPages: number | null;
  paginationTotalEntries: number | null;
  resultsReturned: number | null;
  rateLimitMinute: number | null;
  rateLimitMinuteRemaining: number | null;
  rateLimitHourly: number | null;
  rateLimitHourlyRemaining: number | null;
  rateLimit24Hour: number | null;
  rateLimit24HourRemaining: number | null;
  retryAfter: number | null;
  billingState: WizardRunBillingState | null;
  estimatedCredits: number | null;
  recordedUsageCredits: number | null;
};

export type ApolloSpendObservabilityInput = {
  httpStatus?: number | null;
  latencyMs?: number | null;
  /** Page actually requested. */
  page?: number | null;
  /** Page size actually requested. */
  perPage?: number | null;
  /** Page number Apollo echoed back in its pagination block. */
  paginationPage?: number | null;
  paginationTotalPages?: number | null;
  paginationTotalEntries?: number | null;
  resultsReturned?: number | null;
  rateLimit?: ApolloRateLimitSnapshot | null;
  billingState?: WizardRunBillingState | null;
  estimatedCredits?: number | null;
  recordedUsageCredits?: number | null;
};

/**
 * Normalizes to `number | null`.
 *
 * Anything non-finite becomes null rather than 0 or NaN: "unknown" and "zero"
 * are different facts about a quota, and JSON has no NaN.
 */
function toNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) ? value : null;
}

/**
 * Builds the record. Missing inputs stay null — the builder never invents a
 * value and never reads a header itself.
 */
export function buildApolloSpendObservabilityRecord(
  input: ApolloSpendObservabilityInput,
): ApolloSpendObservabilityRecord {
  const rateLimit = input.rateLimit ?? null;

  return {
    httpStatus: toNullableNumber(input.httpStatus),
    latencyMs: toNullableNumber(input.latencyMs),
    page: toNullableNumber(input.page),
    perPage: toNullableNumber(input.perPage),
    paginationPage: toNullableNumber(input.paginationPage),
    paginationTotalPages: toNullableNumber(input.paginationTotalPages),
    paginationTotalEntries: toNullableNumber(input.paginationTotalEntries),
    resultsReturned: toNullableNumber(input.resultsReturned),
    rateLimitMinute: toNullableNumber(rateLimit?.minute.limit),
    rateLimitMinuteRemaining: toNullableNumber(rateLimit?.minute.remaining),
    rateLimitHourly: toNullableNumber(rateLimit?.hourly.limit),
    rateLimitHourlyRemaining: toNullableNumber(rateLimit?.hourly.remaining),
    rateLimit24Hour: toNullableNumber(rateLimit?.daily.limit),
    rateLimit24HourRemaining: toNullableNumber(rateLimit?.daily.remaining),
    retryAfter: toNullableNumber(rateLimit?.retryAfterSeconds),
    billingState: input.billingState ?? null,
    estimatedCredits: toNullableNumber(input.estimatedCredits),
    recordedUsageCredits: toNullableNumber(input.recordedUsageCredits),
  };
}

/** snake_case projection persisted in provider_usage_logs.metadata. */
export type ApolloSpendObservabilityMetadata = {
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
  retry_after: number | null;
  billing_state: WizardRunBillingState | null;
  estimated_credits: number | null;
  recorded_usage_credits: number | null;
};

export function toApolloSpendObservabilityMetadata(
  record: ApolloSpendObservabilityRecord,
): ApolloSpendObservabilityMetadata {
  return {
    http_status: record.httpStatus,
    latency_ms: record.latencyMs,
    page: record.page,
    per_page: record.perPage,
    pagination_page: record.paginationPage,
    pagination_total_pages: record.paginationTotalPages,
    pagination_total_entries: record.paginationTotalEntries,
    results_returned: record.resultsReturned,
    rate_limit_minute: record.rateLimitMinute,
    rate_limit_minute_remaining: record.rateLimitMinuteRemaining,
    rate_limit_hourly: record.rateLimitHourly,
    rate_limit_hourly_remaining: record.rateLimitHourlyRemaining,
    rate_limit_24_hour: record.rateLimit24Hour,
    rate_limit_24_hour_remaining: record.rateLimit24HourRemaining,
    retry_after: record.retryAfter,
    billing_state: record.billingState,
    estimated_credits: record.estimatedCredits,
    recorded_usage_credits: record.recordedUsageCredits,
  };
}

/** Metadata key under which the record is persisted. */
export const APOLLO_SPEND_OBSERVABILITY_KEY = 'spend_observability' as const;
