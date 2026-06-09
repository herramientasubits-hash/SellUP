/**
 * Multistage Orchestrator — Types (16AB.23.3 / 16AB.23.4 / 16AB.23.5)
 */

import type { SearchCountStatus } from './web-search-audit';
export type { SearchCountStatus };

export type MultistageErrorCode =
  | 'rate_limit'
  | 'timeout'
  | 'connection_terminated'
  | 'invalid_response'
  | 'provider_error'
  | 'budget_exhausted'
  | 'parse_error';

// ─── Stage outputs ─────────────────────────────────────────────────────────────

export type SearchPlanOutput = {
  subsectors: string[];
  cities: string[];
  company_types: string[];
  target_sources: string[];
  queries: string[];
  exclusions: string[];
  diversity_strategy: string;
  batch_themes: string[];
};

export type DiscoveryCandidate = {
  name: string;
  website: string | null;
  linkedin: string | null;
  city: string | null;
  sector: string;
  description: string | null;
  confidence: 'Alta' | 'Media' | 'Baja';
  evidence_url: string | null;
  evidence_source: string | null;
  estimated_size: string | null;
  notes: string | null;
  batch_index: number;
  batch_theme: string;
};

export type VerifiedCandidateResult = {
  original_name: string;
  resolved_name: string | null;
  is_real_company: boolean;
  official_website: string | null;
  linkedin_url: string | null;
  operates_in_colombia: boolean;
  is_tech_b2b: boolean;
  city: string | null;
  estimated_size: string | null;
  confidence: 'Alta' | 'Media' | 'Baja';
  evidence_url: string | null;
  evidence_source: string | null;
  description: string | null;
  notes: string | null;
  rejection_reason: string | null;
};

// ─── API call result ───────────────────────────────────────────────────────────

export type BatchUsage = {
  input_tokens: number;
  output_tokens: number;
  /** Kept for backward compat. Equals web_search_requests when reported_by_provider. */
  search_calls: number;
  search_count_status: SearchCountStatus;
  token_cost_usd: number;
  /** Null when searchCountStatus is 'unavailable'. */
  web_search_cost_usd: number | null;
  /** = token_cost_usd + (web_search_cost_usd ?? 0). Kept for backward compat. */
  cost_usd: number;
};

export type ApiCallResult<T> = {
  data: T | null;
  usage: BatchUsage;
  errorCode: MultistageErrorCode | null;
  errorMessage: string | null;
  durationMs: number;
  /** Audit trail for Anthropic Web Search. Present when search was enabled for this call. */
  webSearchAudit?: import('./web-search-audit').AnthropicWebSearchAudit;
};

// ─── Usage ────────────────────────────────────────────────────────────────────

export type RunUsage = {
  input_tokens: number;
  output_tokens: number;
  /** Kept for compat. Sum of search_calls across all BatchUsage records. */
  searches_executed: number;
  /** Kept for backward compat. Equals total_provider_attempts. */
  total_api_calls: number;
  successful_api_calls: number;
  failed_api_calls: number;
  retried_api_calls: number;
  rate_limit_wait_ms: number;
  /** Kept for backward compat. Equals known_cost_usd. */
  estimated_cost_usd: number;
  // ─── Web search stats (16AB.23.5) ──────────────────────────────────────
  /** Sum of web_search_requests from calls with status reported_by_provider. */
  web_search_requests_reported: number;
  /** Sum of search counts from calls with status inferred_from_blocks. */
  web_search_requests_inferred: number;
  /** Worst-case status across all API calls in this run. */
  web_search_count_status: SearchCountStatus;
  /** Sum of token costs across all calls. */
  token_cost_usd: number;
  /**
   * Sum of web search costs across all calls.
   * Null if any call had status 'unavailable' (partial search cost unknown).
   */
  web_search_cost_usd: number | null;
  /** Result counts across calls with search enabled. */
  web_search_results_count: number;
  web_search_citations_count: number;
  web_search_errors_count: number;
  // ─── 16AB.23.7 — Separated provider attempt / consumption counters ──────
  /** Every HTTP attempt to the provider, including 429s. */
  total_provider_attempts: number;
  /** Only calls that returned token usage (input_tokens > 0 || output_tokens > 0). */
  usage_bearing_api_calls: number;
  /** 429s that returned zero usage. Do NOT count against consumption budget. */
  rate_limited_attempts: number;
  /** Errors where usage status is ambiguous (may have been sent but response lost). */
  unknown_usage_attempts: number;
  /** Accumulated cost from usage-bearing calls only. Equals estimated_cost_usd. */
  known_cost_usd: number;
  /**
   * Conservative upper bound for legacy search cost when web_search_count_status
   * was 'unavailable' for pre-16AB.23.5 runs.
   * Used in the monetary gate as: known_cost_usd + legacy_search_cost_upper_bound_usd.
   * NOT presented as actual cost.
   */
  legacy_search_cost_upper_bound_usd: number | null;
};

// ─── Invocation budget (16AB.23.7) ────────────────────────────────────────────

/**
 * Per-invocation attempt budget. Resets to zero on every CLI run or --resume.
 * Persisted to state/invocations/<id>.json for audit.
 */
export type InvocationBudgetState = {
  invocationId: string;
  startedAt: string;
  isResume: boolean;
  attempts: number;
  retries: number;
  successfulCalls: number;
  failedCalls: number;
  rateLimitedAttempts: number;
  rateLimitWaitMs: number;
  incrementalKnownCostUsd: number;
};

// ─── Artifact envelope (16AB.23.4) ────────────────────────────────────────────

/**
 * Envelope wrapping any derived artifact.
 * An artifact is reusable only when:
 *   artifactVersion === CURRENT_ARTIFACT_VERSION AND inputHash === expectedInputHash
 */
export type CheckpointArtifact<T> = {
  artifactVersion: number;
  stage: string;
  inputHash: string;
  createdAt: string;
  data: T;
};

/** Per-stage artifact validity metadata stored in RunState. */
export type StageArtifactMeta = {
  inputHash: string;
  status: 'completed' | 'stale' | 'failed';
};

// ─── Run state (checkpoint) ────────────────────────────────────────────────────

export type RunState = {
  runId: string;
  provider: 'anthropic_native_search';
  requestHash: string;
  model: string;
  pipelineVersion: string;
  currentStage: string;
  completedStages: string[];
  completedDiscoveryBatches: number[];
  completedVerificationBatches: number[];
  failedBatches: Array<{ stage: string; batch: number; errorCode: string }>;
  usage: RunUsage;
  startedAt: string;
  updatedAt: string;
  /** Per-stage artifact hashes for downstream invalidation (16AB.23.4). */
  stageArtifacts?: Record<string, StageArtifactMeta>;
};

// ─── Execution metrics ─────────────────────────────────────────────────────────

export type ExecutionMetrics = {
  total_api_calls: number;
  successful_api_calls: number;
  failed_api_calls: number;
  retried_api_calls: number;
  rate_limit_wait_ms: number;
  discovery_batches_completed: number;
  verification_batches_completed: number;
  resumed_from_checkpoint: boolean;
  checkpoint_count: number;
  per_stage_duration_ms: Record<string, number>;
  longest_call_duration_ms: number;
  terminated_connections: number;
  partial_results_preserved: boolean;
  // 16AB.23.7 additions (optional: not present on legacy ExecutionMetrics instances)
  usage_bearing_api_calls?: number;
  rate_limited_attempts?: number;
  cached_discovery_batches_loaded?: number;
  new_discovery_batches_attempted?: number;
  retryable_discovery_batches?: number;
  resume_degradation_prevented?: boolean;
};
