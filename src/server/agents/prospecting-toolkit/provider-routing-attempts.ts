/**
 * Q3F-5BB.11F.1 — Pure Apollo batch provider-attempt builder (OBSERVATIONAL).
 *
 * Builds one `metadata.provider_attempts[]` entry for Apollo COMPANY discovery
 * so the batch records what the Apollo organizations search actually produced,
 * mirroring the routing DECISION already stamped by 11E
 * (`metadata.provider_routing`).
 *
 * This module is PURE:
 *   - never reads process.env, never touches Supabase / Apollo / any provider,
 *   - never performs fetch / I/O / DB writes,
 *   - never imports contact-enrichment or phone-reveal code,
 *   - never creates migrations or new columns.
 *
 * Scope boundary: COMPANY discovery ONLY. The Apollo organizations search is a
 * different operation than phone reveal / contact enrichment — those live in
 * the contact-enrichment toolkit and are never referenced here.
 *
 * Cost rules (mirrors the 11C metadata contract):
 *   - `credits_used` is the value RECONCILED from provider_usage_logs by the
 *     caller (organizations_search only); `null` means "not confidently known"
 *     and is preserved as null — NEVER coerced to 0.
 *   - `estimated_cost_usd` is ALWAYS null in 11F.1 (no authorized USD source).
 *   - Any unknown count stays null (never 0).
 */

import type {
  ProviderAttemptMetadata,
  ProviderAttemptStatus,
} from '@/modules/prospect-batches/provider-routing/metadata-contract';
import type { RoutingProviderId } from '@/modules/prospect-batches/provider-routing/types';

/**
 * `web_search_provider` value the Apollo organizations search provider emits on
 * the pipeline metadata (see apollo-organizations-search-provider.ts). The guard
 * matches on this exact value.
 */
export const APOLLO_WEB_SEARCH_PROVIDER = 'apollo_organizations' as const;

/**
 * Routing provider id persisted on the attempt. Uses the source-identity
 * vocabulary (`ProspectIntakeProvider`), which is `'apollo'` — NOT the
 * `web_search_provider` string `'apollo_organizations'`.
 */
export const APOLLO_ROUTING_PROVIDER_ID: RoutingProviderId = 'apollo';

/**
 * `provider_usage_logs.operation_key` for the Apollo COMPANY / organizations
 * search. Credit reconciliation filters strictly on this key so phone reveal
 * (`person_phone_reveal`) and organization enrichment (`organization_enrichment`)
 * rows are excluded structurally.
 */
export const APOLLO_ORGANIZATIONS_OPERATION_KEY = 'organizations_search' as const;
/** `provider_usage_logs.provider_key` for Apollo. */
export const APOLLO_PROVIDER_USAGE_KEY = 'apollo' as const;

/** Writer-level status fed into the attempt status mapping. */
export type ApolloWriterStatus = 'success' | 'partial_success' | 'failed' | 'dry_run';

/** Runtime-measured counters for the single Apollo attempt. */
export interface ApolloBatchProviderAttemptInput {
  /** Writer status; 'failed' → 'error', everything else → 'ok'. */
  writerStatus: ApolloWriterStatus;
  rawCount: number | null;
  normalizedCount: number | null;
  gateExcludedCount: number | null;
  exactDuplicateCount: number | null;
  possibleDuplicateCount: number | null;
  persistedCount: number | null;
  /** Reconciled from provider_usage_logs; null when not confidently known. */
  creditsUsed: number | null;
  /** Sanitized internal failure reason (only surfaced when status is error). */
  failureReason: string | null;
}

/**
 * Guard: emit `provider_attempts[]` ONLY for Apollo company discovery AND only
 * when the 11E routing block is present. Any other provider (Tavily / mock / …)
 * or a missing routing block → false (metadata stays byte-for-byte unchanged).
 */
export function shouldEmitApolloBatchProviderAttempts(input: {
  webSearchProvider: unknown;
  hasProviderRouting: boolean;
}): boolean {
  return (
    input.webSearchProvider === APOLLO_WEB_SEARCH_PROVIDER && input.hasProviderRouting === true
  );
}

/**
 * Map the writer status onto the persisted attempt status. Only 'ok' / 'error'
 * are produced — a `below_threshold` signal is NEVER invented without a clear
 * source.
 */
function mapWriterStatusToAttemptStatus(status: ApolloWriterStatus): ProviderAttemptStatus {
  return status === 'failed' ? 'error' : 'ok';
}

/** Keep only a finite number; anything else (null / NaN / non-number) → null. */
function finiteNumberOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Trim + cap a failure reason; empty / non-string → null. Never leaks length. */
function sanitizeFailureReason(reason: string | null): string | null {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 300);
}

/**
 * Build the single Apollo `provider_attempts[]` entry. `role` is always
 * 'primary' (Apollo is the discovery provider, never a fallback here).
 * `estimated_cost_usd`, `pages_requested`, `quality_score` stay null in 11F.1.
 */
export function buildApolloBatchProviderAttempt(
  input: ApolloBatchProviderAttemptInput,
): ProviderAttemptMetadata {
  const status = mapWriterStatusToAttemptStatus(input.writerStatus);
  return {
    provider: APOLLO_ROUTING_PROVIDER_ID,
    role: 'primary',
    status,
    raw_count: finiteNumberOrNull(input.rawCount),
    normalized_count: finiteNumberOrNull(input.normalizedCount),
    gate_excluded_count: finiteNumberOrNull(input.gateExcludedCount),
    exact_duplicate_count: finiteNumberOrNull(input.exactDuplicateCount),
    possible_duplicate_count: finiteNumberOrNull(input.possibleDuplicateCount),
    persisted_count: finiteNumberOrNull(input.persistedCount),
    // Preserve null (unknown spend); never coerce to 0.
    credits_used: finiteNumberOrNull(input.creditsUsed),
    // 11F.1: no authorized real-USD source — always null.
    estimated_cost_usd: null,
    pages_requested: null,
    quality_score: null,
    failure_reason: status === 'error' ? sanitizeFailureReason(input.failureReason) : null,
  };
}
