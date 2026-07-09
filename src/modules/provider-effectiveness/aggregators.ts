// Agente 2A — Provider Effectiveness Read Model (Hito 17B.4X.6C)
//
// Pure run classification and KPI aggregation. No Supabase, no provider
// calls, no mutation of input rows. See §5–§21 of the 17B.4X.6C prompt for
// the closed rules this mirrors. No routing/ranking score is computed here
// by design.

import type { ProviderUsageStatus } from '@/modules/usage-tracking/types';
import type { ContactEnrichmentRunStatus } from '@/modules/contact-enrichment/types';
import { classifyProviderUsageCostTruth, deriveRunCostTruth } from './cost-truth';
import type {
  ContactEnrichmentRunEvidence,
  EffectivenessProviderKey,
  OfficialContactTraceEvidence,
  ProviderAttributionState,
  ProviderEffectivenessCoverage,
  ProviderEffectivenessDiagnostics,
  ProviderEffectivenessFilters,
  ProviderEffectivenessGlobalCoverage,
  ProviderEffectivenessProviderSummary,
  ProviderEffectivenessReadModel,
  ProviderEffectivenessTruth,
  ProviderUsageEvidence,
  RunCostTruth,
  RunTechnicalOutcome,
} from './types';

// ── Numeric helpers ──────────────────────────────────────────────────────

export function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

// ── Provider attribution (§3) ────────────────────────────────────────────

export interface RunProviderAttribution {
  state: ProviderAttributionState;
  /** Raw distinct provider_key when state === 'attributed'; never inferred. */
  providerKey: string | null;
}

export function deriveProviderAttribution(
  usage: Array<Pick<ProviderUsageEvidence, 'providerKey'>>,
): RunProviderAttribution {
  if (usage.length === 0) return { state: 'unattributed', providerKey: null };
  const distinct = Array.from(new Set(usage.map((u) => u.providerKey)));
  if (distinct.length > 1) return { state: 'ambiguous', providerKey: null };
  return { state: 'attributed', providerKey: distinct[0] };
}

// ── Technical outcome (§5) ───────────────────────────────────────────────

const TECHNICAL_FAILURE_STATUSES: ProviderUsageStatus[] = ['error', 'rate_limited', 'quota_exceeded'];

export function deriveRunTechnicalOutcome(
  attributionState: ProviderAttributionState,
  usageStatuses: ProviderUsageStatus[],
): RunTechnicalOutcome {
  if (attributionState !== 'attributed') return 'technical_unknown';
  if (usageStatuses.some((s) => TECHNICAL_FAILURE_STATUSES.includes(s))) return 'technical_failure';
  if (usageStatuses.length > 0 && usageStatuses.every((s) => s === 'success')) return 'technical_success';
  return 'technical_unknown';
}

// ── Outcome maturity (§8) ────────────────────────────────────────────────

const OUTCOME_MATURE_STATUSES: ContactEnrichmentRunStatus[] = [
  'ready_for_review',
  'completed',
  'failed',
  'superseded',
];

const APPROVAL_ELIGIBLE_STATUSES: ContactEnrichmentRunStatus[] = ['ready_for_review', 'completed'];

export interface RunMaturity {
  outcomeMature: boolean;
  approvalComparisonEligible: boolean;
}

export function deriveOutcomeMaturity(
  runStatus: ContactEnrichmentRunStatus,
  pendingCandidateCount: number,
  attributionState: ProviderAttributionState,
): RunMaturity {
  const outcomeMature = OUTCOME_MATURE_STATUSES.includes(runStatus) && pendingCandidateCount === 0;
  const approvalComparisonEligible =
    outcomeMature && attributionState === 'attributed' && APPROVAL_ELIGIBLE_STATUSES.includes(runStatus);
  return { outcomeMature, approvalComparisonEligible };
}

// ── Latency (§17, diagnostic only) ───────────────────────────────────────

export interface RunLatency {
  eligible: boolean;
  totalDurationMs: number | null;
}

export function deriveLatencyTruth(usage: Array<Pick<ProviderUsageEvidence, 'durationMs'>>): RunLatency {
  if (usage.length === 0) return { eligible: false, totalDurationMs: null };
  const eligible = usage.every((u) => u.durationMs !== null);
  if (!eligible) return { eligible: false, totalDurationMs: null };
  const totalDurationMs = usage.reduce((sum, u) => sum + (u.durationMs as number), 0);
  return { eligible: true, totalDurationMs };
}

// ── Legacy provider-execution-without-usage diagnostics (§21) ───────────
//
// These classify unattributed runs against exact persisted content patterns
// proven live in 17B.4X.6B. They are diagnostics only — they never assign
// provider attribution, and matching one of them does not change a run's
// ProviderAttributionState.

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

interface LegacyDiagnosticRunShape {
  summary: Record<string, unknown> | null;
  providersUsed: string[];
  usage: unknown[];
}

/** summary.discovery_mode = company_first_discovery + search_status = no_results, lusha, zero usage rows. */
export function isCanonicalG7Pattern(run: LegacyDiagnosticRunShape): boolean {
  if (run.usage.length !== 0) return false;
  if (!run.providersUsed.includes('lusha')) return false;
  if (!run.summary) return false;
  return run.summary.discovery_mode === 'company_first_discovery' && run.summary.search_status === 'no_results';
}

/** summary.search_status = provider_error, lusha, zero usage rows (earlier instrumentation gap). */
export function isLegacyLushaProviderErrorPattern(run: LegacyDiagnosticRunShape): boolean {
  if (run.usage.length !== 0) return false;
  if (!run.providersUsed.includes('lusha')) return false;
  if (!run.summary) return false;
  return run.summary.search_status === 'provider_error';
}

/** summary.apollo_enrichment block present, providers_used empty, zero usage rows (legacy instrumentation gap). */
export function isLegacyApolloZeroUsagePattern(run: LegacyDiagnosticRunShape): boolean {
  if (run.usage.length !== 0) return false;
  if (run.providersUsed.length !== 0) return false;
  if (!run.summary) return false;
  return asRecord(run.summary.apollo_enrichment) !== null;
}

export function isLegacyProviderExecutionWithoutUsage(run: LegacyDiagnosticRunShape): boolean {
  return (
    isCanonicalG7Pattern(run) ||
    isLegacyLushaProviderErrorPattern(run) ||
    isLegacyApolloZeroUsagePattern(run)
  );
}

// ── Official contact trace validity (§29) ────────────────────────────────
//
// A contact only counts as trace-valid official output when it claims the
// same run id AND its source_candidate_id resolves to a real candidate of
// that same run AND its candidate_source matches the provider being
// evaluated. approvedCandidateCount and newOfficialContactCount stay
// independent counters (approval/contact writes are non-atomic) — this
// classifier only governs the latter.

export function isTraceValidOfficialContact(
  contact: OfficialContactTraceEvidence,
  params: { runId: string; provider: EffectivenessProviderKey; candidateIds: Set<string> },
): boolean {
  if (contact.metaSource !== 'contact_enrichment_candidate') return false;
  if (contact.metaSourceEnrichmentRunId !== params.runId) return false;
  if (contact.metaCandidateSource !== params.provider) return false;
  if (!contact.metaSourceCandidateId) return false;
  return params.candidateIds.has(contact.metaSourceCandidateId);
}

// ── Per-run classification (attributed runs only) ────────────────────────

interface RunClassification {
  technicalOutcome: RunTechnicalOutcome;
  outcomeMature: boolean;
  approvalComparisonEligible: boolean;
  runCostTruth: RunCostTruth;
  /** Sum of estimated cost across usage rows. Only meaningful when runCostTruth === 'known'. */
  knownCostUsd: number;
  reviewableCandidateCount: number;
  approvedCandidateCount: number;
  officialContactCount: number;
  latencyEligible: boolean;
  totalDurationMs: number | null;
}

function classifyAttributedRun(
  run: ContactEnrichmentRunEvidence,
  provider: EffectivenessProviderKey,
): RunClassification {
  const usageStatuses = run.usage.map((u) => u.status);
  const technicalOutcome = deriveRunTechnicalOutcome('attributed', usageStatuses);
  const { outcomeMature, approvalComparisonEligible } = deriveOutcomeMaturity(
    run.status,
    run.pendingCandidateCount,
    'attributed',
  );

  const operationTruths = run.usage.map((u) => classifyProviderUsageCostTruth(provider, u));
  const runCostTruth = deriveRunCostTruth(operationTruths);
  const knownCostUsd =
    runCostTruth === 'known' ? roundUsd(run.usage.reduce((sum, u) => sum + (u.estimatedCostUsd ?? 0), 0)) : 0;

  const { eligible: latencyEligible, totalDurationMs } = deriveLatencyTruth(run.usage);

  const candidateIds = new Set(run.candidateIds);
  const officialContactCount = run.traceContactCandidates.filter((c) =>
    isTraceValidOfficialContact(c, { runId: run.runId, provider, candidateIds }),
  ).length;

  return {
    technicalOutcome,
    outcomeMature,
    approvalComparisonEligible,
    runCostTruth,
    knownCostUsd,
    reviewableCandidateCount: run.reviewableCandidateCount,
    approvedCandidateCount: run.approvedCandidateCount,
    officialContactCount,
    latencyEligible,
    totalDurationMs,
  };
}

// ── Provider summary aggregation ─────────────────────────────────────────

function summarizeProvider(
  provider: EffectivenessProviderKey,
  classifications: RunClassification[],
  legacyUnattributedPresent: boolean,
): ProviderEffectivenessProviderSummary {
  const attributedRunCount = classifications.length;

  const technicalSuccessRunCount = classifications.filter((c) => c.technicalOutcome === 'technical_success').length;
  const technicalFailureRunCount = classifications.filter((c) => c.technicalOutcome === 'technical_failure').length;
  const technicalUnknownRunCount = classifications.filter((c) => c.technicalOutcome === 'technical_unknown').length;

  const outcomeMatureRunCount = classifications.filter((c) => c.outcomeMature).length;
  const approvalComparisonEligibleRunCount = classifications.filter((c) => c.approvalComparisonEligible).length;
  const openReviewRunCount = classifications.filter((c) => !c.outcomeMature).length;

  const costEligible = classifications.filter((c) => c.runCostTruth === 'known');
  const unknownCostRunCount = classifications.filter((c) => c.runCostTruth === 'unknown').length;
  const ambiguousCostRunCount = classifications.filter((c) => c.runCostTruth === 'ambiguous').length;

  const reviewableCandidateCount = classifications.reduce((sum, c) => sum + c.reviewableCandidateCount, 0);
  const approvedCandidateCount = classifications.reduce((sum, c) => sum + c.approvedCandidateCount, 0);
  const newOfficialContactCount = classifications.reduce((sum, c) => sum + c.officialContactCount, 0);

  const zeroReviewableEligible = classifications.filter((c) => c.technicalOutcome === 'technical_success');
  const zeroReviewableEligibleRunCount = zeroReviewableEligible.length;
  const zeroReviewableRunCount = zeroReviewableEligible.filter((c) => c.reviewableCandidateCount === 0).length;

  const comparableCostUsd = roundUsd(costEligible.reduce((sum, c) => sum + c.knownCostUsd, 0));
  const costEligibleReviewableSum = costEligible.reduce((sum, c) => sum + c.reviewableCandidateCount, 0);
  const costPerReviewableCandidateUsd = safeDivide(comparableCostUsd, costEligibleReviewableSum);

  const costAndApprovalEligible = costEligible.filter((c) => c.approvalComparisonEligible);
  const costApprovalNumerator = roundUsd(costAndApprovalEligible.reduce((sum, c) => sum + c.knownCostUsd, 0));
  const costApprovalDenominator = costAndApprovalEligible.reduce((sum, c) => sum + c.approvedCandidateCount, 0);
  const costPerApprovedContactUsd = safeDivide(costApprovalNumerator, costApprovalDenominator);

  const approvalEligible = classifications.filter((c) => c.approvalComparisonEligible);
  const approvalNumerator = approvalEligible.reduce((sum, c) => sum + c.approvedCandidateCount, 0);
  const approvalDenominator = approvalEligible.reduce((sum, c) => sum + c.reviewableCandidateCount, 0);
  const approvalRate = safeDivide(approvalNumerator, approvalDenominator);

  const zeroReviewableRate = safeDivide(zeroReviewableRunCount, zeroReviewableEligibleRunCount);

  const latencyEligibleRuns = classifications.filter((c) => c.latencyEligible);
  const latencyEligibleRunCount = latencyEligibleRuns.length;
  const unknownLatencyRunCount = classifications.length - latencyEligibleRunCount;
  const medianProviderRunLatencyMs = median(latencyEligibleRuns.map((c) => c.totalDurationMs as number));

  const coverage: ProviderEffectivenessCoverage = {
    attributedRunCount,
    outcomeMatureRunCount,
    approvalComparisonEligibleRunCount,
    openReviewRunCount,
    costEligibleRunCount: costEligible.length,
    unknownCostRunCount,
    ambiguousCostRunCount,
    reviewableCandidateCount,
    approvedCandidateCount,
    newOfficialContactCount,
    zeroReviewableRunCount,
    zeroReviewableEligibleRunCount,
    comparableCostUsd,
  };

  const diagnostics: ProviderEffectivenessDiagnostics = {
    technicalSuccessRunCount,
    technicalFailureRunCount,
    technicalUnknownRunCount,
    medianProviderRunLatencyMs,
    latencyEligibleRunCount,
    unknownLatencyRunCount,
  };

  const truth: ProviderEffectivenessTruth = {
    costEvidenceState:
      unknownCostRunCount > 0 ? 'unknown_cost_present' : ambiguousCostRunCount > 0 ? 'ambiguous_history_present' : 'clean',
    reliabilityEvidenceState: technicalFailureRunCount > 0 ? 'mixed_unmarked_history' : 'clean',
    attributionEvidenceState: legacyUnattributedPresent ? 'legacy_unattributed_present' : 'clean',
    latencyEvidenceState: unknownLatencyRunCount > 0 ? 'partial' : 'complete',
  };

  return { provider, comparable: { costPerApprovedContactUsd, costPerReviewableCandidateUsd, approvalRate, zeroReviewableRate }, coverage, diagnostics, truth };
}

// ── Top-level aggregation ─────────────────────────────────────────────────

const ALL_PROVIDERS: EffectivenessProviderKey[] = ['apollo', 'lusha'];

function isEffectivenessProviderKey(value: string | null): value is EffectivenessProviderKey {
  return value === 'apollo' || value === 'lusha';
}

/**
 * Aggregates the full individual-cohort run evidence into the V1 read model.
 *
 * `runs` must already be the full date-scoped individual cohort — provider
 * filtering is applied only to which provider summaries are returned, never
 * to which runs feed attribution or global coverage (§22: no fallback
 * attribution, global coverage describes the whole dataset).
 */
export function aggregateProviderEffectiveness(
  runs: ContactEnrichmentRunEvidence[],
  filters: Pick<ProviderEffectivenessFilters, 'provider'> = {},
): ProviderEffectivenessReadModel {
  const totalIndividualRunCount = runs.length;

  let unattributedRunCount = 0;
  let ambiguousProviderRunCount = 0;
  let legacyProviderExecutionWithoutUsageCount = 0;
  let canonicalG7RunCount = 0;
  let attributedRunCount = 0;

  const byProvider: Record<EffectivenessProviderKey, RunClassification[]> = { apollo: [], lusha: [] };

  for (const run of runs) {
    const attribution = deriveProviderAttribution(run.usage);

    if (attribution.state === 'unattributed') {
      unattributedRunCount++;
      if (isCanonicalG7Pattern(run)) canonicalG7RunCount++;
      if (isLegacyProviderExecutionWithoutUsage(run)) legacyProviderExecutionWithoutUsageCount++;
      continue;
    }

    if (attribution.state === 'ambiguous') {
      ambiguousProviderRunCount++;
      continue;
    }

    attributedRunCount++;
    if (!isEffectivenessProviderKey(attribution.providerKey)) continue; // unknown provider key: attributed, but outside the comparable cohort
    byProvider[attribution.providerKey].push(classifyAttributedRun(run, attribution.providerKey));
  }

  const legacyUnattributedPresent = legacyProviderExecutionWithoutUsageCount > 0;
  const selectedProviders = filters.provider ? [filters.provider] : ALL_PROVIDERS;
  const providers = selectedProviders.map((provider) =>
    summarizeProvider(provider, byProvider[provider], legacyUnattributedPresent),
  );

  const globalCoverage: ProviderEffectivenessGlobalCoverage = {
    totalIndividualRunCount,
    attributedRunCount,
    unattributedRunCount,
    ambiguousProviderRunCount,
    legacyProviderExecutionWithoutUsageCount,
    canonicalG7RunCount,
  };

  return {
    generatedAt: new Date().toISOString(),
    cohort: 'individual',
    providers,
    globalCoverage,
  };
}
