// Q3F-5AX.2 — Effectiveness aggregators (pure, Phase 1).
//
// Given normalized evidence arrays (batches, candidates, usage logs), produce a
// read-only summary. Pure — no client, no provider calls, no writes. Tolerates
// empty arrays, nulls, unknown statuses, and cost-less rows without throwing.

import {
  deriveRecordOriginClassification,
  type ClassifiableBatch,
  type ClassifiableCandidate,
  type ClassificationSource,
  type RecordOrigin,
  type RejectionReason,
} from './classification';
import { computeCostCompleteness, type UsageCostSignal } from './cost-completeness';
import type {
  Agent1BatchRow,
  Agent1CandidateRow,
  Agent1EffectivenessCostSummary,
  Agent1EffectivenessEvidence,
  Agent1EffectivenessFilters,
  Agent1EffectivenessFunnel,
  Agent1EffectivenessRates,
  Agent1EffectivenessSummary,
  Agent1ProviderEffectivenessBreakdown,
  Agent1UsageRow,
  CleanProductionSummary,
  CleanProductionWarning,
  ClassificationSourceBreakdown,
  EffectiveCandidateClassification,
  OriginBreakdown,
  RejectionReasonBreakdown,
} from './types';

// ── Candidate status buckets (schema: migration 040) ───────────────────────────

const PENDING_STATUSES = new Set(['generated', 'normalized', 'needs_review']);
const APPROVED_STATUSES = new Set(['approved', 'converted_to_account']);
const REJECTED_STATUSES = new Set(['discarded']);
const CONVERTED_STATUSES = new Set(['converted_to_account']);
const DUPLICATE_CANDIDATE_STATUSES = new Set(['duplicate']);
const DUPLICATE_MATCH_STATUSES = new Set(['exact_duplicate', 'possible_duplicate']);

const NO_NEW_CANDIDATES_RESULT = 'no_new_candidates';

// ── Safe numeric helpers ───────────────────────────────────────────────────────

/** Division that returns null (never Infinity/NaN) on a zero or invalid denominator. */
export function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function toFiniteNumber(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// ── Funnel ──────────────────────────────────────────────────────────────────────

export function buildFunnel(
  batches: readonly Agent1BatchRow[],
  candidates: readonly Agent1CandidateRow[],
): Agent1EffectivenessFunnel {
  const persisted = candidates.length;

  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let converted = 0;
  let duplicateOrSkipped = 0;

  for (const c of candidates) {
    const status = (c.status ?? '').trim();
    const dup = (c.duplicateStatus ?? '').trim();
    if (PENDING_STATUSES.has(status)) pending += 1;
    if (APPROVED_STATUSES.has(status)) approved += 1;
    if (REJECTED_STATUSES.has(status)) rejected += 1;
    if (CONVERTED_STATUSES.has(status)) converted += 1;
    if (DUPLICATE_CANDIDATE_STATUSES.has(status) || DUPLICATE_MATCH_STATUSES.has(dup)) {
      duplicateOrSkipped += 1;
    }
  }

  // generatedCandidatesCount: sum of best-effort per-batch counts, but only when
  // at least one batch exposed it — otherwise null (drives completeness flag).
  const exposed = batches.filter((b) => b.generatedCandidateCount != null);
  const generatedCandidatesCount =
    exposed.length > 0 ? exposed.reduce((acc, b) => acc + toFiniteNumber(b.generatedCandidateCount), 0) : null;

  const noNewCandidatesBatchesCount = batches.filter(
    (b) => (b.adaptiveResultStatus ?? '').trim() === NO_NEW_CANDIDATES_RESULT,
  ).length;

  return {
    batchesCount: batches.length,
    generatedCandidatesCount,
    persistedCandidatesCount: persisted,
    pendingCandidatesCount: pending,
    approvedCandidatesCount: approved,
    rejectedCandidatesCount: rejected,
    convertedAccountsCount: converted,
    duplicateOrSkippedCount: duplicateOrSkipped,
    noNewCandidatesBatchesCount,
  };
}

// ── Rates (common denominator = persisted) ───────────────────────────────────────

export function buildRates(funnel: Agent1EffectivenessFunnel): Agent1EffectivenessRates {
  const d = funnel.persistedCandidatesCount;
  return {
    approvalRate: safeRate(funnel.approvedCandidatesCount, d),
    rejectionRate: safeRate(funnel.rejectedCandidatesCount, d),
    conversionRate: safeRate(funnel.convertedAccountsCount, d),
    pendingRate: safeRate(funnel.pendingCandidatesCount, d),
    duplicateOrSkippedRate: safeRate(funnel.duplicateOrSkippedCount, d),
  };
}

// ── Provider breakdown ────────────────────────────────────────────────────────────

export function buildProviderBreakdown(
  usageLogs: readonly Agent1UsageRow[],
): Agent1ProviderEffectivenessBreakdown[] {
  const byKey = new Map<string, Agent1ProviderEffectivenessBreakdown>();

  for (const row of usageLogs) {
    const providerKey = (row.providerKey ?? 'unknown').trim() || 'unknown';
    const operationKey = (row.operationKey ?? 'unknown').trim() || 'unknown';
    const key = `${providerKey}::${operationKey}`;
    const entry =
      byKey.get(key) ??
      {
        providerKey,
        operationKey,
        usageLogsCount: 0,
        credits: 0,
        estimatedCostUsd: 0,
        zeroCostRows: 0,
        missingCostRows: 0,
        resultsReturned: 0,
      };

    entry.usageLogsCount += 1;
    entry.credits += toFiniteNumber(row.creditsUsed);
    entry.resultsReturned += toFiniteNumber(row.resultsReturned);
    if (row.estimatedCostUsd == null) {
      entry.missingCostRows += 1;
    } else {
      entry.estimatedCostUsd += toFiniteNumber(row.estimatedCostUsd);
      if (row.estimatedCostUsd === 0) entry.zeroCostRows += 1;
    }
    byKey.set(key, entry);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.providerKey !== b.providerKey) return a.providerKey.localeCompare(b.providerKey);
    return a.operationKey.localeCompare(b.operationKey);
  });
}

// ── Cost summary ──────────────────────────────────────────────────────────────────

export function buildCostSummary(
  usageLogs: readonly Agent1UsageRow[],
  funnel: Agent1EffectivenessFunnel,
  missingCostRows: number,
  suspiciousZeroCostRows: number,
): Agent1EffectivenessCostSummary {
  let totalCost = 0;
  let totalCredits = 0;
  for (const row of usageLogs) {
    totalCost += toFiniteNumber(row.estimatedCostUsd);
    totalCredits += toFiniteNumber(row.creditsUsed);
  }

  return {
    totalProviderCostUsd: totalCost,
    totalProviderCredits: totalCredits,
    costPerPersistedCandidate: safeRate(totalCost, funnel.persistedCandidatesCount),
    costPerApprovedCandidate: safeRate(totalCost, funnel.approvedCandidatesCount),
    costPerConvertedAccount: safeRate(totalCost, funnel.convertedAccountsCount),
    missingCostRows,
    suspiciousZeroCostRows,
  };
}

// ── Q3F-5AY.4 — Clean production classification ─────────────────────────────────────

const CLEAN_PRODUCTION_ORIGIN: RecordOrigin = 'production';
const UNKNOWN_ORIGIN: RecordOrigin = 'unknown';

/** Every record origin, in a stable order — used to zero-fill OriginBreakdown. */
const ALL_RECORD_ORIGINS: readonly RecordOrigin[] = [
  'production',
  'smoke_test',
  'qa',
  'historical_cleanup',
  'import',
  'unknown',
  'synthetic',
];

const RECORD_ORIGIN_SET: ReadonlySet<string> = new Set<string>(ALL_RECORD_ORIGINS);

const REJECTION_REASON_SET: ReadonlySet<string> = new Set<string>([
  'test_record',
  'cleanup_record',
  'duplicate',
  'unknown',
  'outside_icp',
  'existing_account',
  'insufficient_data',
  'invalid_company',
  'provider_noise',
  'marketplace_or_directory',
  'geographic_mismatch',
  'industry_mismatch',
  'do_not_use',
  'no_longer_relevant',
  'other',
]);

const CLASSIFICATION_SOURCE_SET: ReadonlySet<string> = new Set<string>([
  'writer',
  'derived_metadata',
  'derived_source_primary',
  'derived_review_notes',
  'derived_batch',
  'manual',
  'derived_status',
  'unknown',
]);

/**
 * Threshold above which an 'unknown'-origin share (of all classified candidates)
 * is flagged as suspicious. Kept conservative: >50% unknown means the scope is
 * mostly unclassifiable and clean-production numbers should be read with care.
 */
const HIGH_UNKNOWN_SHARE = 0.5;

function trimmedString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Zero-filled origin breakdown with every origin key present. */
function emptyOriginBreakdown(): OriginBreakdown {
  const out = {} as OriginBreakdown;
  for (const origin of ALL_RECORD_ORIGINS) out[origin] = 0;
  return out;
}

function toClassifiableCandidate(c: Agent1CandidateRow): ClassifiableCandidate {
  return {
    status: c.status,
    duplicate_status: c.duplicateStatus,
    source_primary: c.sourcePrimary ?? null,
    review_notes: c.reviewNotes ?? null,
    metadata: c.metadata ?? null,
    reviewed_by: c.reviewedBy ?? null,
  };
}

function toClassifiableBatch(b: Agent1BatchRow | undefined): ClassifiableBatch | undefined {
  if (!b) return undefined;
  if (b.source == null && b.name == null && b.metadata == null) return undefined;
  return { source: b.source ?? null, name: b.name ?? null, metadata: b.metadata ?? null };
}

/**
 * Resolves the EFFECTIVE classification for a candidate. Persisted columns win
 * when present and valid (Q3F-5AY.4 §3); otherwise the pure runtime classifier
 * derives it. Never mutates inputs, never throws.
 */
export function resolveCandidateClassification(
  candidate: Agent1CandidateRow,
  batch?: Agent1BatchRow,
): EffectiveCandidateClassification {
  const persistedOrigin = trimmedString(candidate.recordOrigin);
  if (persistedOrigin && RECORD_ORIGIN_SET.has(persistedOrigin)) {
    const persistedReason = trimmedString(candidate.rejectionReason);
    const persistedSource = trimmedString(candidate.classificationSource);
    return {
      effectiveRecordOrigin: persistedOrigin as RecordOrigin,
      effectiveRejectionReason:
        persistedReason && REJECTION_REASON_SET.has(persistedReason)
          ? (persistedReason as RejectionReason)
          : null,
      effectiveClassificationSource:
        persistedSource && CLASSIFICATION_SOURCE_SET.has(persistedSource)
          ? (persistedSource as ClassificationSource)
          : 'manual',
      classificationResolutionSource: 'persisted',
    };
  }

  const derived = deriveRecordOriginClassification(
    toClassifiableCandidate(candidate),
    toClassifiableBatch(batch),
  );
  return {
    effectiveRecordOrigin: derived.recordOrigin,
    effectiveRejectionReason: derived.rejectionReason,
    effectiveClassificationSource: derived.classificationSource,
    classificationResolutionSource: 'derived_runtime',
  };
}

/** Builds the per-candidate effective classifications, resolving batch context by id. */
export function resolveClassifications(
  batches: readonly Agent1BatchRow[],
  candidates: readonly Agent1CandidateRow[],
): EffectiveCandidateClassification[] {
  const batchById = new Map<string, Agent1BatchRow>();
  for (const b of batches) batchById.set(b.id, b);
  return candidates.map((c) => resolveCandidateClassification(c, batchById.get(c.batchId)));
}

export function buildOriginBreakdown(
  classifications: readonly EffectiveCandidateClassification[],
): OriginBreakdown {
  const out = emptyOriginBreakdown();
  for (const c of classifications) out[c.effectiveRecordOrigin] += 1;
  return out;
}

export function buildRejectionReasonBreakdown(
  classifications: readonly EffectiveCandidateClassification[],
): RejectionReasonBreakdown {
  const out: RejectionReasonBreakdown = {};
  for (const c of classifications) {
    const reason = c.effectiveRejectionReason;
    if (reason == null) continue;
    out[reason] = (out[reason] ?? 0) + 1;
  }
  return out;
}

export function buildClassificationSourceBreakdown(
  classifications: readonly EffectiveCandidateClassification[],
): ClassificationSourceBreakdown {
  let persisted = 0;
  let derivedRuntime = 0;
  for (const c of classifications) {
    if (c.classificationResolutionSource === 'persisted') persisted += 1;
    else derivedRuntime += 1;
  }
  return { persisted, derived_runtime: derivedRuntime };
}

/**
 * Builds the clean-production view: funnel/rates over candidates whose effective
 * origin is 'production', plus excluded-by-origin accounting. Cost is left null
 * (batch-level attribution only). Never invents precision.
 */
export function buildCleanProduction(
  batches: readonly Agent1BatchRow[],
  candidates: readonly Agent1CandidateRow[],
  classifications: readonly EffectiveCandidateClassification[],
): CleanProductionSummary {
  const cleanCandidates: Agent1CandidateRow[] = [];
  const excludedByOrigin = emptyOriginBreakdown();
  let excludedCount = 0;
  let unknownOriginCount = 0;

  candidates.forEach((candidate, i) => {
    const origin = classifications[i]?.effectiveRecordOrigin ?? UNKNOWN_ORIGIN;
    if (origin === UNKNOWN_ORIGIN) unknownOriginCount += 1;
    if (origin === CLEAN_PRODUCTION_ORIGIN) {
      cleanCandidates.push(candidate);
    } else {
      excludedCount += 1;
      excludedByOrigin[origin] += 1;
    }
  });

  const funnel = buildFunnel(batches, cleanCandidates);
  const rates = buildRates(funnel);

  const warnings: CleanProductionWarning[] = [];
  if (unknownOriginCount > 0) warnings.push('unknown_origin_present');
  if (
    candidates.length > 0 &&
    safeRate(unknownOriginCount, candidates.length)! > HIGH_UNKNOWN_SHARE
  ) {
    warnings.push('high_unknown_discarded_share');
  }
  // Clean per-candidate cost is never attributed in Phase 1; always disclose it.
  warnings.push('clean_cost_attribution_is_batch_level');

  return {
    funnel,
    rates,
    excludedFromCleanProductionCount: excludedCount,
    excludedByOrigin,
    unknownOriginCount,
    cleanCostUsd: null,
    classificationWarnings: warnings,
  };
}

// ── Top-level aggregator ────────────────────────────────────────────────────────────

export function aggregateAgent1Effectiveness(
  evidence: Agent1EffectivenessEvidence,
  filters: Agent1EffectivenessFilters = {},
): Agent1EffectivenessSummary {
  const batches = evidence.batches ?? [];
  const candidates = evidence.candidates ?? [];
  const usageLogs = evidence.usageLogs ?? [];

  const funnel = buildFunnel(batches, candidates);
  const rates = buildRates(funnel);
  const providerBreakdown = buildProviderBreakdown(usageLogs);

  const costSignals: UsageCostSignal[] = usageLogs.map((row) => ({
    providerKey: row.providerKey,
    estimatedCostUsd: row.estimatedCostUsd,
    creditsUsed: row.creditsUsed,
  }));
  const generatedCountsMissing = batches.some((b) => b.generatedCandidateCount == null);
  const completeness = computeCostCompleteness({
    usageRows: costSignals,
    batchesCount: batches.length,
    generatedCountsMissing,
  });

  const cost = buildCostSummary(
    usageLogs,
    funnel,
    completeness.missingCostRows,
    completeness.suspiciousZeroCostRows,
  );

  // Q3F-5AY.4 — effective classification + clean-production view. Purely additive:
  // the all-scope funnel/rates/cost above are unchanged.
  const classifications = resolveClassifications(batches, candidates);
  const originBreakdown = buildOriginBreakdown(classifications);
  const rejectionReasonBreakdown = buildRejectionReasonBreakdown(classifications);
  const classificationSourceBreakdown = buildClassificationSourceBreakdown(classifications);
  const cleanProduction = buildCleanProduction(batches, candidates, classifications);

  return {
    filters,
    funnel,
    rates,
    cost,
    providerBreakdown,
    costCompletenessFlag: completeness.flag,
    warnings: completeness.warnings,
    originBreakdown,
    rejectionReasonBreakdown,
    classificationSourceBreakdown,
    cleanProduction,
    classificationWarnings: cleanProduction.classificationWarnings,
  };
}
