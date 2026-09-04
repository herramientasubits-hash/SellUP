// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — reconciliation between the pipeline's
// own aggregate breakdown (`candidate_final_dispositions.breakdown`, computed
// by `toCandidateFinalDispositionsMetadata`, batch-level, pure, no names) and
// the actual per-company rows this hito now persists.
//
// The breakdown was never wrong — it was always aggregate-only. This module
// answers a different, new question: "of the rejections the breakdown
// counted, how many actually got a durable, reviewable row?" That is the
// accounting issue #389 asks for — not a relabeling of "Sin clasificar".
//
// Pure: no IO, no clock. The caller supplies both counts already read.

import { mapApolloFinalDispositionToCode } from './mapping';

/**
 * Sums the subset of `breakdown` entries that this module persists a row
 * for (i.e. every key `mapApolloFinalDispositionToCode` maps to a code).
 * Entries with no mapping (`provisionally_persisted_pending_writer_final`,
 * `persisted_review_only_final`) are NOT rejections and are correctly
 * excluded — they either got a candidate row already or are pending review.
 */
export function sumExpectedDiscardedDispositions(
  breakdown: Record<string, number> | null | undefined,
): number {
  if (!breakdown) return 0;
  let total = 0;
  for (const [key, count] of Object.entries(breakdown)) {
    if (mapApolloFinalDispositionToCode(key) !== null) {
      total += typeof count === 'number' && Number.isFinite(count) ? count : 0;
    }
  }
  return total;
}

export interface DiscardedDispositionsReconciliationResult {
  expectedDiscardCount: number;
  persistedDispositionCount: number;
  /** true when persisted >= expected (persistence can only under-count on a
   *  transient DB failure, never over-count — the idempotency key forbids
   *  duplicates). false signals a persistence gap worth investigating. */
  reconciled: boolean;
  gap: number;
}

export function reconcileDiscardedDispositionsAgainstBreakdown(
  breakdown: Record<string, number> | null | undefined,
  persistedDispositionCount: number,
): DiscardedDispositionsReconciliationResult {
  const expectedDiscardCount = sumExpectedDiscardedDispositions(breakdown);
  const gap = expectedDiscardCount - persistedDispositionCount;
  return {
    expectedDiscardCount,
    persistedDispositionCount,
    reconciled: gap <= 0,
    gap: Math.max(gap, 0),
  };
}
