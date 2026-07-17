// Q3F-5AX.2 — Effectiveness aggregators (pure, Phase 1).
//
// Given normalized evidence arrays (batches, candidates, usage logs), produce a
// read-only summary. Pure — no client, no provider calls, no writes. Tolerates
// empty arrays, nulls, unknown statuses, and cost-less rows without throwing.

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

  return {
    filters,
    funnel,
    rates,
    cost,
    providerBreakdown,
    costCompletenessFlag: completeness.flag,
    warnings: completeness.warnings,
  };
}
