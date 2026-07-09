// Agente 2A — Provider Effectiveness Read Model (Hito 17B.4X.6C)
//
// Truthful V1 comparable read model over individual (non-bulk) Apollo vs
// Lusha contact enrichment runs. No routing, no ranking, no winner. See
// section 18 of the 17B.4X.6C prompt for the closed shape this mirrors.

import type { ProviderUsageStatus } from '@/modules/usage-tracking/types';
import type { ContactEnrichmentRunStatus } from '@/modules/contact-enrichment/types';

export type EffectivenessProviderKey = 'apollo' | 'lusha';

export type ProviderAttributionState = 'attributed' | 'ambiguous' | 'unattributed';

export type RunTechnicalOutcome =
  | 'technical_success'
  | 'technical_failure'
  | 'technical_unknown';

export type OperationCostTruth = 'known' | 'unknown' | 'ambiguous';

export type RunCostTruth = 'known' | 'unknown' | 'ambiguous';

// ── Normalized evidence rows (queries.ts output → aggregators.ts input) ────

/** One provider_usage_logs row joined to a run via agent_run_id. */
export interface ProviderUsageEvidence {
  providerKey: string;
  status: ProviderUsageStatus;
  estimatedCostUsd: number | null;
  creditsUsed: number | null;
  durationMs: number | null;
  /** Narrowed metadata needed for cost-truth classification only. */
  costMetadata: {
    /** Lusha shape: metadata.cost.truth_source */
    truthSource: 'actual' | 'estimated' | 'unknown' | null;
    /** Apollo shape: flat pricing evidence fields. */
    hasApolloPricingEvidence: boolean;
  };
}

/**
 * Narrowed contacts.metadata fields for one contact whose metadata already
 * claims descent from an enrichment candidate. Trace VALIDITY (same-run,
 * same-candidate, matching provider) is a classification decision owned by
 * aggregators.ts, not by this normalization layer — see
 * `isTraceValidOfficialContact`.
 */
export interface OfficialContactTraceEvidence {
  metaSource: string | null;
  metaSourceEnrichmentRunId: string | null;
  metaSourceCandidateId: string | null;
  metaCandidateSource: string | null;
}

/** One contact_enrichment_runs row plus its joined evidence, pre-aggregation. */
export interface ContactEnrichmentRunEvidence {
  runId: string;
  status: ContactEnrichmentRunStatus;
  createdAt: string;
  /** Raw providers_used column — diagnostic only, never authoritative. */
  providersUsed: string[];
  /** Raw summary JSONB — diagnostic only, used for legacy pattern classifiers. */
  summary: Record<string, unknown> | null;
  usage: ProviderUsageEvidence[];
  reviewableCandidateCount: number;
  pendingCandidateCount: number;
  approvedCandidateCount: number;
  /** Ids of every contact_enrichment_candidates row belonging to this run. */
  candidateIds: string[];
  /** Contacts globally claiming trace descent, pre-filtered to this run's id. */
  traceContactCandidates: OfficialContactTraceEvidence[];
}

// ── Read model output (public contract) ─────────────────────────────────

export interface ProviderEffectivenessComparableKpis {
  costPerApprovedContactUsd: number | null;
  costPerReviewableCandidateUsd: number | null;
  approvalRate: number | null;
  zeroReviewableRate: number | null;
}

export interface ProviderEffectivenessDiagnostics {
  technicalSuccessRunCount: number;
  technicalFailureRunCount: number;
  technicalUnknownRunCount: number;

  medianProviderRunLatencyMs: number | null;
  latencyEligibleRunCount: number;
  unknownLatencyRunCount: number;

  unattributedRunCount?: number;
  ambiguousProviderRunCount?: number;

  legacyProviderExecutionWithoutUsageCount?: number;
  canonicalG7RunCount?: number;
}

export interface ProviderEffectivenessCoverage {
  attributedRunCount: number;

  outcomeMatureRunCount: number;
  approvalComparisonEligibleRunCount: number;
  openReviewRunCount: number;

  costEligibleRunCount: number;
  unknownCostRunCount: number;
  ambiguousCostRunCount: number;

  reviewableCandidateCount: number;
  approvedCandidateCount: number;
  newOfficialContactCount: number;

  zeroReviewableRunCount: number;
  zeroReviewableEligibleRunCount: number;

  comparableCostUsd: number;
}

export interface ProviderEffectivenessTruth {
  costEvidenceState: 'clean' | 'ambiguous_history_present' | 'unknown_cost_present';
  reliabilityEvidenceState: 'clean' | 'mixed_unmarked_history';
  attributionEvidenceState: 'clean' | 'legacy_unattributed_present';
  latencyEvidenceState: 'complete' | 'partial';
}

export interface ProviderEffectivenessProviderSummary {
  provider: EffectivenessProviderKey;
  comparable: ProviderEffectivenessComparableKpis;
  coverage: ProviderEffectivenessCoverage;
  diagnostics: ProviderEffectivenessDiagnostics;
  truth: ProviderEffectivenessTruth;
}

export interface ProviderEffectivenessGlobalCoverage {
  totalIndividualRunCount: number;
  attributedRunCount: number;
  unattributedRunCount: number;
  ambiguousProviderRunCount: number;
  legacyProviderExecutionWithoutUsageCount: number;
  canonicalG7RunCount: number;
}

export interface ProviderEffectivenessReadModel {
  generatedAt: string;
  cohort: 'individual';
  providers: ProviderEffectivenessProviderSummary[];
  globalCoverage: ProviderEffectivenessGlobalCoverage;
}

// ── Filters ──────────────────────────────────────────────────────────────

export interface ProviderEffectivenessFilters {
  dateFrom?: string;
  dateTo?: string;
  provider?: EffectivenessProviderKey;
}
