// Q3F-5AX.2 — Agent 1 Effectiveness Read Model (Phase 1).
//
// Pure types for a READ-ONLY effectiveness model of Agent 1 (prospect
// generation). The canonical run/batch source is `prospect_batches` (NOT
// `agent_runs`, which the modern wizard does not write reliably). Outcomes come
// from `prospect_candidates`; cost/provider signals from `provider_usage_logs`.
// Everything joins conceptually by `batch_id`.
//
// No provider calls, no writes, no migrations, no UI — types only.

import type {
  ClassificationSource,
  RecordOrigin,
  RejectionReason,
} from './classification';

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conceptual filters for the read model. Every field maps to a REAL column that
 * exists today (verified against migrations 040 / 036 / 063):
 *   - dateFrom/dateTo → prospect_batches.created_at (half-open [from, to)).
 *   - createdBy       → prospect_batches.created_by (the "seller" dimension).
 *   - countryCode     → prospect_batches.country_code.
 *   - industry        → prospect_batches.industry.
 *   - batchId         → prospect_batches.id.
 *   - providerKey     → provider_usage_logs.provider_key (cost breakdown only).
 * No invented columns.
 */
export interface Agent1EffectivenessFilters {
  dateFrom?: string;
  dateTo?: string;
  createdBy?: string;
  countryCode?: string;
  industry?: string;
  batchId?: string;
  providerKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw evidence rows (normalized shapes the aggregators consume)
// ─────────────────────────────────────────────────────────────────────────────

/** Normalized `prospect_batches` row for the read model. */
export interface Agent1BatchRow {
  id: string;
  status: string | null;
  countryCode: string | null;
  industry: string | null;
  createdBy: string | null;
  createdAt: string | null;
  /**
   * Best-effort candidate count the pipeline "generated"/returned before the
   * writer persisted, read from batch metadata when present. NULL when the
   * batch metadata does not expose it (older batches / different writer path);
   * a NULL here drives `partial_missing_candidate_outcomes`.
   */
  generatedCandidateCount: number | null;
  /**
   * adaptive_discovery.result_status when present (e.g. 'no_new_candidates',
   * 'success_partial', 'success_target_reached'). NULL if absent.
   */
  adaptiveResultStatus: string | null;
  /**
   * Raw batch signals used ONLY as a fallback origin classifier input
   * (Q3F-5AY.4). `source`/`name` map to prospect_batches.source/name; the raw
   * `metadata` is reused for smoke/QA batch markers. All optional so existing
   * evidence builders/tests that predate clean-production wiring still compile.
   */
  source?: string | null;
  name?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Normalized `prospect_candidates` row for the read model. */
export interface Agent1CandidateRow {
  batchId: string;
  status: string | null;
  duplicateStatus: string | null;
  convertedAccountId: string | null;
  /**
   * Persisted record-origin classification columns (migration 093). All NULL in
   * production today (no backfill), so these are optional; when present and
   * valid they take priority over the runtime classifier (Q3F-5AY.4 §3).
   */
  recordOrigin?: string | null;
  rejectionReason?: string | null;
  classificationSource?: string | null;
  classificationConfidence?: number | null;
  /**
   * Raw candidate signals fed to the runtime fallback classifier when the
   * persisted columns are NULL. Map to prospect_candidates.source_primary /
   * review_notes / metadata / reviewed_by. Optional for backward compatibility.
   */
  sourcePrimary?: string | null;
  reviewNotes?: string | null;
  metadata?: Record<string, unknown> | null;
  reviewedBy?: string | null;
}

/** Normalized `provider_usage_logs` row for the read model. */
export interface Agent1UsageRow {
  batchId: string | null;
  providerKey: string;
  operationKey: string;
  status: string | null;
  estimatedCostUsd: number | null;
  creditsUsed: number | null;
  resultsReturned: number | null;
}

/** Bundle of raw evidence for one scope, passed to the aggregator. */
export interface Agent1EffectivenessEvidence {
  batches: Agent1BatchRow[];
  candidates: Agent1CandidateRow[];
  usageLogs: Agent1UsageRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface Agent1EffectivenessFunnel {
  batchesCount: number;
  /** Sum of best-effort generated counts across batches; null if none exposed it. */
  generatedCandidatesCount: number | null;
  /** Actual persisted prospect_candidates rows in scope. */
  persistedCandidatesCount: number;
  pendingCandidatesCount: number;
  approvedCandidatesCount: number;
  rejectedCandidatesCount: number;
  convertedAccountsCount: number;
  duplicateOrSkippedCount: number;
  /** Batches whose adaptive_discovery.result_status === 'no_new_candidates'. */
  noNewCandidatesBatchesCount: number;
}

export interface Agent1EffectivenessRates {
  /** All rates use persistedCandidatesCount as the common denominator. */
  approvalRate: number | null;
  rejectionRate: number | null;
  conversionRate: number | null;
  pendingRate: number | null;
  duplicateOrSkippedRate: number | null;
}

export interface Agent1EffectivenessCostSummary {
  totalProviderCostUsd: number;
  totalProviderCredits: number;
  costPerPersistedCandidate: number | null;
  costPerApprovedCandidate: number | null;
  costPerConvertedAccount: number | null;
  /** Usage rows with estimated_cost_usd === null (pricing not attributable). */
  missingCostRows: number;
  /** Usage rows with cost 0 but credits > 0 (suspicious: pricing possibly missing). */
  suspiciousZeroCostRows: number;
}

export interface Agent1ProviderEffectivenessBreakdown {
  providerKey: string;
  operationKey: string;
  usageLogsCount: number;
  credits: number;
  estimatedCostUsd: number;
  zeroCostRows: number;
  missingCostRows: number;
  resultsReturned: number;
}

/**
 * Single completeness flag for the cost/outcome attribution. Cost is NOT perfect
 * in Phase 1 (LLM cost is not fully persisted, some providers lack pricing,
 * Tavily/Apollo may write 0/NULL), so the model reports how trustworthy the
 * numbers are instead of faking precision.
 */
export type Agent1CostCompletenessFlag =
  | 'complete'
  | 'partial_missing_llm_cost'
  | 'partial_missing_provider_pricing'
  | 'partial_missing_candidate_outcomes'
  | 'unknown';

// ─────────────────────────────────────────────────────────────────────────────
// Q3F-5AY.4 — Clean production classification shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Which layer produced the effective classification for a candidate. */
export type ClassificationResolutionSource = 'persisted' | 'derived_runtime';

/**
 * The effective (resolved) classification for a single candidate: persisted
 * columns win over the runtime classifier (Q3F-5AY.4 §3). Never mutates inputs.
 */
export interface EffectiveCandidateClassification {
  effectiveRecordOrigin: RecordOrigin;
  effectiveRejectionReason: RejectionReason | null;
  effectiveClassificationSource: ClassificationSource;
  classificationResolutionSource: ClassificationResolutionSource;
}

/** Count of candidates per record origin (every origin key present, zero-filled). */
export type OriginBreakdown = Record<RecordOrigin, number>;

/** Count of candidates per rejection reason (only reasons that occurred). */
export type RejectionReasonBreakdown = Partial<Record<RejectionReason, number>>;

/** How the effective classifications were resolved across the scope. */
export interface ClassificationSourceBreakdown {
  persisted: number;
  derived_runtime: number;
}

/**
 * Non-fatal, stable warning codes surfaced for the clean-production scope. Codes
 * (never silently hidden data):
 *   - 'unknown_origin_present'              — ≥1 candidate resolved to 'unknown'.
 *   - 'high_unknown_discarded_share'        — 'unknown' share of candidates is high.
 *   - 'clean_cost_attribution_is_batch_level' — clean per-candidate cost is not
 *      attributable (usage logs join at batch level); cleanCostUsd stays null.
 */
export type CleanProductionWarning =
  | 'unknown_origin_present'
  | 'high_unknown_discarded_share'
  | 'clean_cost_attribution_is_batch_level';

/**
 * "Clean production" view: funnel/rates restricted to candidates whose effective
 * origin is 'production'. Everything else (smoke_test / qa / historical_cleanup /
 * import / synthetic / unknown) is EXCLUDED but reported, never hidden.
 */
export interface CleanProductionSummary {
  /** Funnel over clean-production candidates only. Batch-level fields keep scope context. */
  funnel: Agent1EffectivenessFunnel;
  rates: Agent1EffectivenessRates;
  /** Candidates excluded from clean production (effective origin !== 'production'). */
  excludedFromCleanProductionCount: number;
  /** Excluded candidates grouped by their (non-production) effective origin. */
  excludedByOrigin: OriginBreakdown;
  /** Candidates whose effective origin resolved to 'unknown' (unclean by default). */
  unknownOriginCount: number;
  /**
   * Clean per-candidate cost is NOT attributable in Phase 1: provider_usage_logs
   * join at batch level, not candidate level, so any clean-only cost would be an
   * invented attribution. Left null on purpose; see classificationWarnings.
   */
  cleanCostUsd: number | null;
  classificationWarnings: CleanProductionWarning[];
}

export interface Agent1EffectivenessSummary {
  filters: Agent1EffectivenessFilters;
  funnel: Agent1EffectivenessFunnel;
  rates: Agent1EffectivenessRates;
  cost: Agent1EffectivenessCostSummary;
  providerBreakdown: Agent1ProviderEffectivenessBreakdown[];
  costCompletenessFlag: Agent1CostCompletenessFlag;
  /** Human-readable caveats about partial attribution. Never throws on partial data. */
  warnings: string[];
  // ── Q3F-5AY.4 clean-production additions (all-scope fields above are preserved) ──
  /** Count of candidates per effective record origin (zero-filled for all origins). */
  originBreakdown: OriginBreakdown;
  /** Count of candidates per effective rejection reason (only reasons that occurred). */
  rejectionReasonBreakdown: RejectionReasonBreakdown;
  /** persisted vs derived_runtime resolution counts for the effective classifications. */
  classificationSourceBreakdown: ClassificationSourceBreakdown;
  /** Clean-production funnel/rates plus excluded-by-origin accounting. */
  cleanProduction: CleanProductionSummary;
  /** Stable warning codes for the clean-production classification (mirrors cleanProduction). */
  classificationWarnings: CleanProductionWarning[];
}
