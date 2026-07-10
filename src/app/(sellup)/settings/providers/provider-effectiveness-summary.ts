// ============================================================
// settings/providers — recent-log effectiveness summary (Q3F-11B)
//
// Pure mapping from the fetched provider_usage_logs window into a truthful
// technical-outcome + cost-completeness summary. Deliberately narrow: it
// describes the recent-log window only, never usefulness, agent-level
// measurement, or a full operation count.
// ============================================================

import type { ProviderUsageLogRow } from '@/modules/budgets/provider-detail-queries';

/** Mirrors the `limit` passed to getRecentUsageLogs() in provider-detail-queries.ts. */
export const RECENT_USAGE_LOG_WINDOW = 20;

const TECHNICAL_FAILURE_STATUSES = new Set(['error', 'rate_limited', 'quota_exceeded']);

export interface ProviderEffectivenessSummary {
  observedLogCount: number;
  technicalSuccessCount: number;
  technicalFailureCount: number;
  technicalUnknownCount: number;
  /** Percentage of observedLogCount, or null when observedLogCount is 0. */
  technicalSuccessRate: number | null;
  /** True when the query hit RECENT_USAGE_LOG_WINDOW — the count is a cap, not a total. */
  isCappedWindow: boolean;
  knownCostSubtotalUsd: number;
  hasUnknownCost: boolean;
  hasSufficientRecentEvidence: boolean;
}

/**
 * Summarizes the recent usage-log window truthfully: status literals map to
 * technical success/failure/unknown, never "useful"/"quality"; cost follows
 * the known-subtotal-plus-unknown-flag contract (null cost is never coerced
 * to zero).
 */
export function summarizeProviderEffectiveness(
  usageLogs: ProviderUsageLogRow[],
): ProviderEffectivenessSummary {
  let technicalSuccessCount = 0;
  let technicalFailureCount = 0;
  let technicalUnknownCount = 0;
  let knownCostSubtotalUsd = 0;
  let hasUnknownCost = false;

  for (const log of usageLogs) {
    if (log.status === 'success') {
      technicalSuccessCount += 1;
    } else if (log.status != null && TECHNICAL_FAILURE_STATUSES.has(log.status)) {
      technicalFailureCount += 1;
    } else {
      technicalUnknownCount += 1;
    }

    if (log.estimatedCostUsd == null) {
      hasUnknownCost = true;
    } else {
      knownCostSubtotalUsd += log.estimatedCostUsd;
    }
  }

  const observedLogCount = usageLogs.length;

  return {
    observedLogCount,
    technicalSuccessCount,
    technicalFailureCount,
    technicalUnknownCount,
    technicalSuccessRate:
      observedLogCount > 0 ? Math.round((technicalSuccessCount / observedLogCount) * 100) : null,
    isCappedWindow: observedLogCount === RECENT_USAGE_LOG_WINDOW,
    knownCostSubtotalUsd,
    hasUnknownCost,
    hasSufficientRecentEvidence: observedLogCount > 0,
  };
}
