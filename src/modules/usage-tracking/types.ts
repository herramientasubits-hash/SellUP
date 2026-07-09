// ============================================================
// usage-tracking — domain types
// ============================================================

export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentRunStepStatus = 'skipped' | 'attempted' | 'success' | 'error';

export type ProviderUsageStatus = 'success' | 'error' | 'rate_limited' | 'quota_exceeded';

export type PricingUnit = 'per_request' | 'per_result' | 'per_1k_tokens' | 'per_credit';

export type ResultType = 'prospect' | 'company' | 'contact' | 'meeting' | 'other';

export type ResultEventType =
  | 'generated'
  | 'normalized'
  | 'duplicate_detected'
  | 'discarded'
  | 'approved'
  | 'converted_to_account'
  | 'sent_to_hubspot'
  | 'contact_useful'
  | 'contact_invalid';

export type SourceKey =
  | 'internal_db'
  | 'hubspot'
  | 'apollo'
  | 'lusha'
  | 'samu_ia'
  | 'web_ai'
  | 'preloaded';

// ============================================================
// DB row types (read)
// ============================================================

export interface AgentRun {
  id: string;
  agent_key: string;
  agent_name: string | null;
  triggered_by: string | null;
  status: AgentRunStatus;
  input_params: Record<string, unknown>;
  results_requested: number | null;
  results_generated: number;
  results_unique: number;
  results_approved: number;
  results_discarded: number;
  estimated_cost_usd: number;
  real_cost_usd: number | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentRunStep {
  id: string;
  agent_run_id: string;
  step_key: string;
  step_name: string | null;
  provider_key: string | null;
  status: AgentRunStepStatus;
  results_returned: number;
  results_useful: number;
  estimated_cost_usd: number;
  real_cost_usd: number | null;
  duration_ms: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ProviderUsageLog {
  id: string;
  agent_run_id: string | null;
  agent_run_step_id: string | null;
  batch_id: string | null;
  usage_key: string | null;
  provider_key: string;
  operation_key: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  credits_used: number | null;
  results_returned: number;
  /** NULL means unknown cost — see metadata.cost.truth_source. NOT a free operation. */
  estimated_cost_usd: number | null;
  real_cost_usd: number | null;
  status: ProviderUsageStatus;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  triggered_by: string | null;
  /** Snapshot del role.key del usuario al momento del consumo. */
  triggered_by_role_key: string | null;
  /** Snapshot del group_id primario del usuario al momento del consumo. */
  triggered_by_group_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// tool_catalog — catálogo de proveedores/herramientas
// ============================================================

export type ToolType = 'llm' | 'data_enrichment' | 'web_search' | 'crm' | 'other';
export type ConsumptionUnit = 'tokens' | 'credits' | 'requests' | 'usd_estimated';

export interface ToolCatalogEntry {
  id: string;
  provider_key: string;
  display_name: string;
  tool_type: ToolType;
  consumption_unit: ConsumptionUnit;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// budget_rules — reglas de límite presupuestal
// ============================================================

export type BudgetScopeType = 'global' | 'role' | 'group' | 'user';
export type BudgetPeriodType = 'monthly' | 'quarterly' | 'annual' | 'custom';
export type BudgetOnExceed = 'alert' | 'block' | 'require_approval';

export interface BudgetRule {
  id: string;
  provider_key: string;
  scope_type: BudgetScopeType;
  scope_id: string | null;
  period_type: BudgetPeriodType;
  limit_credits: number | null;
  limit_usd: number | null;
  on_exceed: BudgetOnExceed;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderPricingConfig {
  id: string;
  provider_key: string;
  operation_key: string;
  unit: PricingUnit;
  unit_cost_usd: number;
  currency: string;
  notes: string | null;
  effective_from: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResultQualityEvent {
  id: string;
  agent_run_id: string | null;
  result_type: ResultType;
  result_id: string | null;
  external_id: string | null;
  event_type: ResultEventType;
  source_key: SourceKey | null;
  performed_by: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// Input types for logging helpers
// ============================================================

export interface CreateAgentRunInput {
  agent_key: string;
  agent_name?: string;
  triggered_by?: string;
  input_params?: Record<string, unknown>;
  results_requested?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentRunInput {
  status?: AgentRunStatus;
  results_generated?: number;
  results_unique?: number;
  results_approved?: number;
  results_discarded?: number;
  estimated_cost_usd?: number;
  real_cost_usd?: number;
  finished_at?: string;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAgentRunStepInput {
  agent_run_id: string;
  step_key: string;
  step_name?: string;
  provider_key?: string;
  metadata?: Record<string, unknown>;
}

export interface FinishAgentRunStepInput {
  status: AgentRunStepStatus;
  results_returned?: number;
  results_useful?: number;
  estimated_cost_usd?: number;
  real_cost_usd?: number;
  duration_ms?: number;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export interface LogProviderUsageInput {
  agent_run_id?: string;
  agent_run_step_id?: string;
  batch_id?: string;
  usage_key?: string;
  provider_key: string;
  operation_key: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  credits_used?: number;
  results_returned?: number;
  /**
   * Omitted → written as 0 (historical default for callers that never priced
   * their operation). Explicit `null` → written as SQL NULL (unknown cost —
   * never coerce to 0). Explicit number → written as-is (0 is a valid known cost).
   */
  estimated_cost_usd?: number | null;
  real_cost_usd?: number | null;
  status?: ProviderUsageStatus;
  error_code?: string;
  error_message?: string;
  duration_ms?: number;
  triggered_by?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// Provider cost-truth vocabulary (17B.4X.5)
//
// Every provider operation's cost must carry an explicit truth signal.
// UNKNOWN COST != FREE COST: a numeric 0 is only ever a valid cost when
// paired with truth_source 'estimated' or 'actual'. When cost cannot be
// determined (no configured pricing, no usage signal), the operation must
// record estimated_cost_usd = NULL with truth_source 'unknown' — never 0.
// ============================================================

export type ProviderCostTruthSourceV1 = 'actual' | 'estimated' | 'unknown';

export interface ProviderEstimatedCostTraceV1 {
  truth_source: 'estimated';
  pricing_provider_key: string;
  pricing_operation_key: string;
  pricing_unit: string;
  unit_cost_usd_snapshot: number;
  pricing_config_id?: string;
  /** Present only when the cost model assumes fungibility across distinct provider operations. */
  credit_unit_assumption?: string;
}

export interface ProviderUnknownCostTraceV1 {
  truth_source: 'unknown';
  unknown_reason: string;
}

export type ProviderCostTraceV1 = ProviderEstimatedCostTraceV1 | ProviderUnknownCostTraceV1;

export interface LogResultQualityEventInput {
  agent_run_id?: string;
  result_type: ResultType;
  result_id?: string;
  external_id?: string;
  event_type: ResultEventType;
  source_key?: SourceKey;
  performed_by?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// Summary types for admin UI
// ============================================================

export interface UsageSummary {
  total_agent_runs: number;
  running_agent_runs: number;
  failed_agent_runs: number;
  total_provider_calls: number;
  /** Known-cost subtotal only — see has_unknown_cost before treating this as a complete total. */
  total_estimated_cost_usd: number;
  /** True when at least one aggregated provider log has estimated_cost_usd = NULL (unknown cost). */
  has_unknown_cost: boolean;
  error_calls: number;
}

export interface RecentUsageActivity {
  agent_runs: AgentRun[];
  provider_logs: ProviderUsageLog[];
  quality_events: ResultQualityEvent[];
}

// ============================================================
// Aggregated stat types for the /ai-usage dashboard
// ============================================================

export interface ProviderStat {
  provider_key: string;
  total_calls: number;
  success_calls: number;
  error_calls: number;
  total_credits_used: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_results_returned: number;
  /** Known-cost subtotal only — see has_unknown_cost before treating this as a complete total. */
  total_estimated_cost_usd: number;
  /** True when at least one aggregated row has estimated_cost_usd = NULL (unknown cost). */
  has_unknown_cost: boolean;
  last_used_at: string | null;
}

export interface AgentStat {
  agent_key: string;
  agent_name: string | null;
  total_executions: number;
  completed_executions: number;
  failed_executions: number;
  total_results_generated: number;
  total_results_approved: number;
  total_estimated_cost_usd: number;
  last_run_at: string | null;
}

export interface AiUsageSummary {
  total_executions: number;
  running_executions: number;
  failed_executions: number;
  total_provider_calls: number;
  error_provider_calls: number;
  /** Known-cost subtotal only — see has_unknown_cost before treating this as a complete total. */
  total_estimated_cost_usd: number;
  /** True when at least one aggregated provider log has estimated_cost_usd = NULL (unknown cost). */
  has_unknown_cost: boolean;
  distinct_providers: number;
  avg_cost_per_run: number | null;
}
