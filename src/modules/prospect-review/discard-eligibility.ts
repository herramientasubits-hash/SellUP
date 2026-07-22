// Q3F-5AZ.2G-1 — Discard action eligibility (pure decision layer).
//
// Pure, side-effect-free gate that decides whether a candidate from the clean
// pending-review queue may be discarded. No IO, no DB, no clients — it takes a
// minimal candidate snapshot and returns a decision the server action turns
// into a DB write. Keeping it pure makes every branch of the safety policy
// (Q3F-5AZ.2G-1 § 1) exhaustively unit-testable.
//
// Policy (must stay in lock-step with the queue definition and discardCandidate):
//   - record_origin MUST be 'production'          → else not_clean_production
//   - status 'discarded' (already)                → idempotent (safe no-op)
//   - status MUST be 'needs_review'               → else status_conflict
//   - anything else                               → discard
//
// Discard deliberately does NOT consult duplicate_status: a prospect that a
// duplicate signal blocks from approval should still be removable from review.
// Discard never marks the candidate as a duplicate (that is a separate hito).

/** Canonical clean-queue criteria — mirrors approve-eligibility / queries.ts. */
export const DISCARD_QUEUE_RECORD_ORIGIN = 'production';
export const DISCARD_QUEUE_STATUS = 'needs_review';

/** Minimal candidate snapshot the decision needs (no PII, no duplicate signal). */
export interface CandidateDiscardSnapshot {
  status: string | null;
  recordOrigin: string | null;
}

/** Reasons a discard is rejected before any write happens. */
export type DiscardRejectReason = 'not_clean_production' | 'status_conflict';

/** Discriminated decision returned to the server action. */
export type DiscardEligibility =
  | { decision: 'discard' }
  | { decision: 'idempotent' }
  | { decision: 'reject'; reason: DiscardRejectReason };

/**
 * Decides whether `candidate` may be discarded. Order matters: record_origin is
 * checked first (a non-production row is never in scope for this queue), then
 * idempotency (already discarded), then the needs_review gate. Any other status
 * (approved / converted_to_account / duplicate / generated / normalized) is a
 * conflict and is left to a dedicated flow.
 */
export function evaluateDiscardEligibility(
  candidate: CandidateDiscardSnapshot,
): DiscardEligibility {
  // 1. Must be a clean production record — this queue never touches anything else.
  if (candidate.recordOrigin !== DISCARD_QUEUE_RECORD_ORIGIN) {
    return { decision: 'reject', reason: 'not_clean_production' };
  }

  // 2. Already discarded → idempotent success (safe re-submit / double click).
  if (candidate.status === 'discarded') {
    return { decision: 'idempotent' };
  }

  // 3. Only pending ('needs_review') candidates can transition; any other
  //    terminal/intermediate state is a conflict.
  if (candidate.status !== DISCARD_QUEUE_STATUS) {
    return { decision: 'reject', reason: 'status_conflict' };
  }

  // 4. Clear to discard.
  return { decision: 'discard' };
}
