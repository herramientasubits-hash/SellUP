/**
 * Q3F-5BB.11C — Additive provider-routing METADATA contract.
 *
 * Pure helpers + types that build the STANDARD, additive metadata blocks a
 * future execution layer will persist so that routing decisions, per-provider
 * attempts, and per-candidate provenance are comparable across providers
 * (Lusha / Apollo / Tavily / Web AI).
 *
 * This slice ONLY produces plain JSONB-shaped objects. It is PURE:
 *   - never reads process.env, never touches Supabase / HubSpot / any provider,
 *   - never performs fetch / I/O / DB writes,
 *   - never creates migrations or new columns.
 *
 * ── Where the metadata lands (additive, no renames) ─────────────────────────
 *   Batch (`prospect_batches.metadata`):
 *     - metadata.provider_routing      ← ProviderRoutingMetadata
 *     - metadata.provider_attempts[]   ← ProviderAttemptMetadata[]
 *     (existing keys — provider, billing, gate_summary,
 *      source_enrichment_summary, … — are preserved untouched.)
 *
 *   Candidate (`prospect_candidates`):
 *     - metadata.source_provider       ← RoutingProviderId (kept consistent
 *                                          with source_trace.sourceProvider)
 *     - metadata.provider_trace        ← CandidateProviderTraceMetadata
 *     - source_trace.sourceProvider    ← RoutingProviderId (respected if present)
 *     (existing keys — source_enrichment, duplicate_check, and
 *      source_trace.duplicateDetails, … — are preserved untouched.)
 *
 * ── Naming ──────────────────────────────────────────────────────────────────
 * Persisted METADATA keys use snake_case (matching the existing batch/candidate
 * metadata convention: `billing`, `gate_summary`, `source_provider`, …). The
 * `source_trace` column uses camelCase keys (matching its existing convention:
 * `sourceProvider`, `duplicateDetails`, …). The contract preserves both.
 */

import type {
  ProviderBlockedReason,
  ProviderRoutingEnvironment,
  ProviderRoutingMode,
  ProviderRoutingPlan,
  ProviderRunResult,
  ProviderStepRole,
  RoutingIntent,
  RoutingProviderId,
} from './types';

// ============================================================
// Contract version
// ============================================================

/**
 * Explicit contract version stamped on every routing/attempt/trace block so a
 * consumer can tell which metadata shape it is reading. Bumped only on a real,
 * documented shape change — never silently.
 */
export const PROVIDER_ROUTING_CONTRACT_VERSION = 'provider_routing_v1' as const;
export type ProviderRoutingContractVersion = typeof PROVIDER_ROUTING_CONTRACT_VERSION;

/** Metadata keys this contract owns on the batch. Reused by tests / callers. */
export const BATCH_PROVIDER_ROUTING_KEY = 'provider_routing' as const;
export const BATCH_PROVIDER_ATTEMPTS_KEY = 'provider_attempts' as const;

/** Metadata / source_trace keys this contract owns on the candidate. */
export const CANDIDATE_SOURCE_PROVIDER_KEY = 'source_provider' as const;
export const CANDIDATE_PROVIDER_TRACE_KEY = 'provider_trace' as const;
export const SOURCE_TRACE_PROVIDER_KEY = 'sourceProvider' as const;

// ============================================================
// Serialized metadata shapes (snake_case = JSONB as persisted)
// ============================================================

/**
 * Cost estimate as persisted on the routing block. `unknown === true` means the
 * USD amount is NOT authoritative; `usd_max` is then `null` and MUST NOT be read
 * as 0. `credits_max` is the expected worst-case credit count (may be null).
 */
export interface ProviderRoutingEstimatedCostMetadata {
  credits_max: number | null;
  usd_max: number | null;
  unknown: boolean;
}

/** `batch.metadata.provider_routing` — the resolved routing DECISION. */
export interface ProviderRoutingMetadata {
  contract_version: ProviderRoutingContractVersion;
  mode: ProviderRoutingMode;
  environment: ProviderRoutingEnvironment;
  intended_provider: RoutingIntent;
  selected_provider: RoutingProviderId | null;
  fallback_allowed: boolean;
  fallback_reason: string | null;
  estimated_cost: ProviderRoutingEstimatedCostMetadata;
  requires_confirmation: boolean;
  confirmed_by: string | null;
  dry_run_only: boolean;
  blocked_reason: ProviderBlockedReason | null;
}

/** Technical status of one provider attempt as persisted. */
export type ProviderAttemptStatus =
  | 'ok'
  | 'error'
  | 'skipped'
  | 'not_executed'
  | 'blocked';

/**
 * One entry of `batch.metadata.provider_attempts[]` — a per-provider attempt
 * record. All counts are `number | null`; `null` means "not known / not
 * measured", NEVER coerced to 0. `credits_used` / `estimated_cost_usd` follow
 * the same rule (unknown cost is never 0). `started_at` / `completed_at` are
 * only present when the caller supplies them (this pure layer never reads a
 * clock).
 */
export interface ProviderAttemptMetadata {
  provider: RoutingProviderId;
  role: ProviderStepRole;
  status: ProviderAttemptStatus;
  raw_count: number | null;
  normalized_count: number | null;
  gate_excluded_count: number | null;
  exact_duplicate_count: number | null;
  possible_duplicate_count: number | null;
  persisted_count: number | null;
  credits_used: number | null;
  estimated_cost_usd: number | null;
  pages_requested: number | null;
  quality_score: number | null;
  failure_reason: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

/** Per-candidate cost attribution (usually null — cost is billed per batch). */
export interface CandidateCostAttributionMetadata {
  credits_used: number | null;
  estimated_cost_usd: number | null;
}

/** `candidate.metadata.provider_trace` — how this candidate was produced. */
export interface CandidateProviderTraceMetadata {
  contract_version: ProviderRoutingContractVersion;
  provider: RoutingProviderId;
  role: ProviderStepRole;
  attempt_index: number;
  source_provider: RoutingProviderId;
  cost_attribution: CandidateCostAttributionMetadata;
}

// ============================================================
// Builder CONTEXT inputs (values not derivable from the pure plan/run result)
// ============================================================

/**
 * Config-derived context for `buildProviderRoutingMetadata`. These values live
 * on the resolved `ProviderRoutingConfig` (env-read server-side) rather than on
 * the pure plan, so the caller passes them in explicitly.
 */
export interface ProviderRoutingMetadataContext {
  environment: ProviderRoutingEnvironment;
  fallbackAllowed: boolean;
  /** Operator/admin who confirmed execution, if any. Default: null. */
  confirmedBy?: string | null;
  /** Why fallback is/ isn't allowed (audit note). Default: null. */
  fallbackReason?: string | null;
}

/**
 * Runtime-measured context for `buildProviderAttemptMetadata` — the pipeline
 * counts a `ProviderRunResult` does not carry. Every field optional; omitted
 * fields become `null` (never 0).
 */
export interface ProviderAttemptMetadataContext {
  role: ProviderStepRole;
  rawCount?: number | null;
  normalizedCount?: number | null;
  gateExcludedCount?: number | null;
  exactDuplicateCount?: number | null;
  possibleDuplicateCount?: number | null;
  persistedCount?: number | null;
  estimatedCostUsd?: number | null;
  pagesRequested?: number | null;
  qualityScore?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** Minimal candidate-source shape needed to attribute provenance. */
export interface ProviderTraceCandidateSource {
  sourceProvider: RoutingProviderId;
}

/** Per-candidate context for `buildCandidateProviderTraceMetadata`. */
export interface CandidateProviderTraceContext {
  attemptIndex: number;
  creditsUsed?: number | null;
  estimatedCostUsd?: number | null;
}

// ============================================================
// Consistency error (typed)
// ============================================================

/** Machine-readable reason a candidate provider consistency check failed. */
export type ProviderMetadataConsistencyCode =
  | 'source_trace_provider_mismatch'
  | 'metadata_provider_mismatch'
  | 'existing_provider_internal_mismatch';

/**
 * Thrown by `mergeCandidateProviderMetadata` when the incoming trace provider
 * conflicts with an existing `source_trace.sourceProvider` /
 * `metadata.source_provider`, or when the two existing values already disagree.
 * Fail-closed: a provider mismatch may indicate a routing bug, so the contract
 * refuses to silently overwrite it.
 */
export class ProviderMetadataConsistencyError extends Error {
  readonly code: ProviderMetadataConsistencyCode;
  readonly existingProvider: string | null;
  readonly incomingProvider: string;

  constructor(
    code: ProviderMetadataConsistencyCode,
    existingProvider: string | null,
    incomingProvider: string,
  ) {
    super(
      `provider metadata consistency violation (${code}): existing="${existingProvider ?? 'none'}" incoming="${incomingProvider}"`,
    );
    this.name = 'ProviderMetadataConsistencyError';
    this.code = code;
    this.existingProvider = existingProvider;
    this.incomingProvider = incomingProvider;
  }
}

/** Result of a pure consistency check. `ok:false` carries a typed issue. */
export type ProviderConsistencyResult =
  | { ok: true; resolvedProvider: RoutingProviderId }
  | {
      ok: false;
      code: ProviderMetadataConsistencyCode;
      existingProvider: string | null;
      incomingProvider: RoutingProviderId;
    };

// ============================================================
// Small pure utilities
// ============================================================

/** Read a non-empty string field from a loose record, else null. */
function readStringField(
  source: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

// ============================================================
// Builders
// ============================================================

/**
 * Build `metadata.provider_routing` from a pure `ProviderRoutingPlan` (11B) plus
 * the config-derived context. Additive: returns a fresh object; never reads env.
 * Unknown USD cost stays `null` — never 0.
 */
export function buildProviderRoutingMetadata(
  plan: ProviderRoutingPlan,
  context: ProviderRoutingMetadataContext,
): ProviderRoutingMetadata {
  return {
    contract_version: PROVIDER_ROUTING_CONTRACT_VERSION,
    mode: plan.mode,
    environment: context.environment,
    intended_provider: plan.intendedProvider,
    selected_provider: plan.selectedProvider,
    fallback_allowed: context.fallbackAllowed,
    fallback_reason: context.fallbackReason ?? null,
    estimated_cost: {
      credits_max: plan.estimatedCost.credits,
      usd_max: plan.estimatedCost.usdMax,
      unknown: plan.estimatedCost.unknown,
    },
    requires_confirmation: plan.requiresUserConfirmation,
    confirmed_by: context.confirmedBy ?? null,
    dry_run_only: plan.dryRunOnly,
    blocked_reason: plan.blockedReason,
  };
}

/** Map a pure `ProviderRunStatus` onto the persisted attempt status. */
function mapRunStatus(status: ProviderRunResult['status']): ProviderAttemptStatus {
  return status === 'success' ? 'ok' : status;
}

/**
 * Build one `metadata.provider_attempts[]` entry from a `ProviderRunResult`
 * (11B) plus runtime-measured context. Additive & pure. Any count the caller
 * does not supply is `null` (never 0); `credits_used` / `estimated_cost_usd`
 * keep `null` when unknown.
 */
export function buildProviderAttemptMetadata(
  runResult: ProviderRunResult,
  context: ProviderAttemptMetadataContext,
): ProviderAttemptMetadata {
  const attempt: ProviderAttemptMetadata = {
    provider: runResult.provider,
    role: context.role,
    status: mapRunStatus(runResult.status),
    raw_count: context.rawCount ?? null,
    normalized_count: context.normalizedCount ?? null,
    gate_excluded_count: context.gateExcludedCount ?? null,
    exact_duplicate_count: context.exactDuplicateCount ?? null,
    possible_duplicate_count: context.possibleDuplicateCount ?? null,
    // usefulCandidateCount is the persisted useful count; a caller can override.
    persisted_count: context.persistedCount ?? runResult.usefulCandidateCount ?? null,
    // Never coerce an unknown credit/USD spend to 0 — preserve null.
    credits_used: runResult.creditsSpent,
    estimated_cost_usd: context.estimatedCostUsd ?? runResult.usdSpent,
    pages_requested: context.pagesRequested ?? null,
    quality_score: context.qualityScore ?? null,
    failure_reason: runResult.error,
  };

  // Only emit timestamps when supplied — this pure layer never reads a clock.
  if (context.startedAt !== undefined) attempt.started_at = context.startedAt;
  if (context.completedAt !== undefined) attempt.completed_at = context.completedAt;

  return attempt;
}

/**
 * Build `metadata.provider_trace` for one candidate. `provider` / `role` come
 * from the attempt that produced it; `source_provider` is the candidate's own
 * origin. Per-candidate cost defaults to `null` (cost is billed per batch).
 */
export function buildCandidateProviderTraceMetadata(
  candidateSource: ProviderTraceCandidateSource,
  attempt: Pick<ProviderAttemptMetadata, 'provider' | 'role'>,
  context: CandidateProviderTraceContext,
): CandidateProviderTraceMetadata {
  return {
    contract_version: PROVIDER_ROUTING_CONTRACT_VERSION,
    provider: attempt.provider,
    role: attempt.role,
    attempt_index: context.attemptIndex,
    source_provider: candidateSource.sourceProvider,
    cost_attribution: {
      credits_used: context.creditsUsed ?? null,
      estimated_cost_usd: context.estimatedCostUsd ?? null,
    },
  };
}

// ============================================================
// Additive merges
// ============================================================

/**
 * Additively merge the routing decision + attempts into an EXISTING batch
 * metadata object. Preserves every existing key (provider, billing,
 * gate_summary, source_enrichment_summary, …); only `provider_routing` and
 * `provider_attempts` are added/overwritten. Pure & immutable: inputs are never
 * mutated; a fresh object (and a fresh attempts array) is returned.
 */
export function mergeProviderRoutingBatchMetadata(
  existingMetadata: Record<string, unknown> | null | undefined,
  routingMetadata: ProviderRoutingMetadata,
  attempts: readonly ProviderAttemptMetadata[],
): Record<string, unknown> {
  return {
    ...(existingMetadata ?? {}),
    [BATCH_PROVIDER_ROUTING_KEY]: routingMetadata,
    [BATCH_PROVIDER_ATTEMPTS_KEY]: attempts.map((a) => ({ ...a })),
  };
}

/**
 * Q3F-5BB.11F.1 — NARROW additive merge: attach `provider_attempts[]` ONLY.
 *
 * Unlike `mergeProviderRoutingBatchMetadata`, this helper NEVER touches
 * `provider_routing` (or any other existing key). It exists for the batch-level
 * attempts seam where the routing DECISION was already stamped upstream (11E)
 * and this slice only needs to add the per-provider attempt record without
 * re-deriving or re-writing the routing block.
 *
 * Pure & immutable: the input metadata is never mutated; a fresh object (and a
 * fresh, deep-copied attempts array) is returned. If `attempts` is empty /
 * undefined the metadata is returned preserved — the `provider_attempts` key is
 * NOT added, so a no-op stays byte-for-byte. `null`/unknown counts inside the
 * attempts are preserved exactly (never coerced to 0).
 */
export function mergeProviderAttemptsBatchMetadata(
  existingMetadata: Record<string, unknown> | null | undefined,
  attempts: readonly ProviderAttemptMetadata[] | null | undefined,
): Record<string, unknown> {
  const preserved = { ...(existingMetadata ?? {}) };
  if (!attempts || attempts.length === 0) {
    return preserved;
  }
  return {
    ...preserved,
    [BATCH_PROVIDER_ATTEMPTS_KEY]: attempts.map((a) => ({ ...a })),
  };
}

/** A candidate's routing-relevant columns (both preserved additively). */
export interface CandidateProviderMetadataInput {
  metadata?: Record<string, unknown> | null;
  source_trace?: Record<string, unknown> | null;
}

/** The additively-updated candidate columns. */
export interface CandidateProviderMetadataResult {
  metadata: Record<string, unknown>;
  source_trace: Record<string, unknown>;
}

/**
 * Pure consistency check between the incoming trace provider and any existing
 * `source_trace.sourceProvider` / `metadata.source_provider`. Deterministic:
 * returns the resolved provider on success, or a typed issue on conflict.
 */
export function resolveCandidateProviderConsistency(
  existing: CandidateProviderMetadataInput,
  incomingProvider: RoutingProviderId,
): ProviderConsistencyResult {
  const existingTraceProvider = readStringField(existing.source_trace, SOURCE_TRACE_PROVIDER_KEY);
  const existingMetaProvider = readStringField(existing.metadata, CANDIDATE_SOURCE_PROVIDER_KEY);

  // The two pre-existing markers must already agree with each other.
  if (
    existingTraceProvider !== null &&
    existingMetaProvider !== null &&
    existingTraceProvider !== existingMetaProvider
  ) {
    return {
      ok: false,
      code: 'existing_provider_internal_mismatch',
      existingProvider: existingTraceProvider,
      incomingProvider,
    };
  }

  if (existingTraceProvider !== null && existingTraceProvider !== incomingProvider) {
    return {
      ok: false,
      code: 'source_trace_provider_mismatch',
      existingProvider: existingTraceProvider,
      incomingProvider,
    };
  }

  if (existingMetaProvider !== null && existingMetaProvider !== incomingProvider) {
    return {
      ok: false,
      code: 'metadata_provider_mismatch',
      existingProvider: existingMetaProvider,
      incomingProvider,
    };
  }

  // Respect an existing provider marker; otherwise adopt the incoming one.
  const resolvedProvider = (existingTraceProvider ??
    existingMetaProvider ??
    incomingProvider) as RoutingProviderId;
  return { ok: true, resolvedProvider };
}

/**
 * Additively merge `source_provider` + `provider_trace` into a candidate's
 * `metadata`, and `sourceProvider` into its `source_trace`. Preserves every
 * existing key (metadata.source_enrichment, metadata.duplicate_check,
 * source_trace.duplicateDetails, …). Pure & immutable.
 *
 * Consistency: if `source_trace.sourceProvider` already exists it is respected
 * (not overwritten). A conflict between the incoming trace provider and an
 * existing marker throws a typed `ProviderMetadataConsistencyError` — fail-closed
 * rather than silently rewriting provenance.
 */
export function mergeCandidateProviderMetadata(
  existing: CandidateProviderMetadataInput,
  trace: CandidateProviderTraceMetadata,
): CandidateProviderMetadataResult {
  const consistency = resolveCandidateProviderConsistency(existing, trace.source_provider);
  if (!consistency.ok) {
    throw new ProviderMetadataConsistencyError(
      consistency.code,
      consistency.existingProvider,
      consistency.incomingProvider,
    );
  }

  const resolvedProvider = consistency.resolvedProvider;

  return {
    metadata: {
      ...(existing.metadata ?? {}),
      [CANDIDATE_SOURCE_PROVIDER_KEY]: resolvedProvider,
      [CANDIDATE_PROVIDER_TRACE_KEY]: { ...trace },
    },
    source_trace: {
      ...(existing.source_trace ?? {}),
      [SOURCE_TRACE_PROVIDER_KEY]: resolvedProvider,
    },
  };
}
