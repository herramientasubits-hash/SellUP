/**
 * Multistage Orchestrator — Types (16AB.23.3)
 */

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
  search_calls: number;
  cost_usd: number;
};

export type ApiCallResult<T> = {
  data: T | null;
  usage: BatchUsage;
  errorCode: MultistageErrorCode | null;
  errorMessage: string | null;
  durationMs: number;
};

// ─── Run state (checkpoint) ────────────────────────────────────────────────────

export type RunUsage = {
  input_tokens: number;
  output_tokens: number;
  searches_executed: number;
  total_api_calls: number;
  successful_api_calls: number;
  failed_api_calls: number;
  retried_api_calls: number;
  rate_limit_wait_ms: number;
  estimated_cost_usd: number;
};

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
};
