// Q3F-5AX.2 — Agent 1 Effectiveness Read Model (Phase 1).
//
// Read-only backend model for Agent 1 (prospect generation) effectiveness,
// built on the batch-based data model:
//   prospect_batches (canonical run source) → prospect_candidates (outcomes)
//   → provider_usage_logs (cost), joined conceptually by batch_id.
// No agent_runs as canonical source. No writes, no migrations, no UI.

export { getAgent1EffectivenessSummary, getAgent1EffectivenessPanel } from './actions';
export type { Agent1EffectivenessPanelResult } from './actions';
export { fetchAgent1EffectivenessEvidence } from './queries';
export {
  aggregateAgent1Effectiveness,
  buildFunnel,
  buildRates,
  buildCostSummary,
  buildProviderBreakdown,
  safeRate,
} from './aggregators';
export {
  computeCostCompleteness,
  isMissingCostRow,
  isSuspiciousZeroCostRow,
  hasLlmCostEvidence,
  LLM_PROVIDER_KEYS,
} from './cost-completeness';
export type {
  Agent1EffectivenessFilters,
  Agent1EffectivenessEvidence,
  Agent1BatchRow,
  Agent1CandidateRow,
  Agent1UsageRow,
  Agent1EffectivenessSummary,
  Agent1EffectivenessFunnel,
  Agent1EffectivenessRates,
  Agent1EffectivenessCostSummary,
  Agent1ProviderEffectivenessBreakdown,
  Agent1CostCompletenessFlag,
} from './types';
export type { UsageCostSignal, CostCompletenessInput, CostCompletenessResult } from './cost-completeness';
// Q3F-5AY.2 — Record origin classifier (pure).
export { deriveRecordOriginClassification } from './classification';
export type {
  RecordOrigin,
  RejectionReason,
  ClassificationSource,
  MatchedRule,
  ClassificationWarning,
  RecordOriginClassification,
  ClassifiableCandidate,
  ClassifiableBatch,
} from './classification';
