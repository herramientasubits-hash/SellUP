/**
 * Multistage Orchestrator — Centralized Configuration (16AB.23.3)
 *
 * All operational limits, timeouts, and cost rates in one place.
 * Change here to affect the entire pipeline.
 */

export const MULTISTAGE_CONFIG = {
  model: 'claude-sonnet-4-6' as const,
  anthropic_api: 'https://api.anthropic.com/v1/messages' as const,
  pipeline_version: '16AB.23.4' as const,

  // Timeouts — a single HTTP connection must never exceed 5 min
  per_call_timeout_ms: 90_000,
  overall_run_timeout_ms: 1_200_000,

  // API budget
  max_total_api_calls: 16,
  max_total_search_tool_uses: 40,
  max_cost_usd: 2.5,

  // Stage 2 — Discovery batches
  discovery_batch_count: 5,
  candidates_per_discovery_batch: 5,
  max_searches_per_discovery_call: 4,

  // Stage 5 — Verification batches
  verification_batch_size: 2,
  max_searches_per_verification_call: 4,

  // Stage 7 — Replacement
  max_replacement_rounds: 2,

  // Concurrency (serial by default — org-level token limits)
  concurrency: 1,

  // Retry
  max_retries_per_call: 2,
  inter_call_pause_ms: 2_000,
  backoff_base_ms: 5_000,

  // Candidate counts
  max_candidates_pool: 30,
  requested_count: 10,
  initial_verification_pool_size: 16,
} as const;

// Sonnet pricing as of mid-2025. Update here — not in individual functions.
export const COST_RATES = {
  input_per_million: 3.0,
  output_per_million: 15.0,
  /** Anthropic Web Search: $10 per 1,000 requests = $0.01 per request. */
  web_search_per_thousand: 10.0,
  /** Derived convenience constant: web_search_per_thousand / 1000. */
  web_search_per_request: 0.01,
} as const;
