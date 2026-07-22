// Q3F-5AZ.2G-2 — Mark-duplicate action eligibility (pure decision layer).
//
// Pure, side-effect-free gate that decides whether a candidate from the clean
// pending-review queue may be marked as a duplicate. No IO, no DB, no clients —
// it takes a minimal candidate snapshot and returns a decision the server
// action turns into a DB write (via the canonical markCandidateDuplicate).
// Keeping it pure makes every branch of the safety policy (Q3F-5AZ.2G-2 § 1)
// exhaustively unit-testable, exactly like discard-eligibility.
//
// Policy (must stay in lock-step with the queue definition and the canonical
// markCandidateDuplicate action):
//   - record_origin MUST be 'production'          → else not_clean_production
//   - status 'duplicate' (already)                → idempotent (safe no-op)
//   - status MUST be 'needs_review'               → else status_conflict
//   - anything else                               → mark_duplicate
//
// Marking as a duplicate NEVER creates an account and NEVER merges records — it
// only classifies the prospect as a duplicate inside SellUp (status='duplicate')
// so it leaves the pending-review queue. It never approves and never discards.

/** Canonical clean-queue criteria — mirrors discard-eligibility / approve-eligibility. */
export const DUPLICATE_QUEUE_RECORD_ORIGIN = 'production';
export const DUPLICATE_QUEUE_STATUS = 'needs_review';

/** Minimal candidate snapshot the decision needs (no PII, no match details). */
export interface CandidateDuplicateSnapshot {
  status: string | null;
  recordOrigin: string | null;
}

/** Reasons a mark-duplicate is rejected before any write happens. */
export type DuplicateRejectReason = 'not_clean_production' | 'status_conflict';

/** Discriminated decision returned to the server action. */
export type DuplicateEligibility =
  | { decision: 'mark_duplicate' }
  | { decision: 'idempotent' }
  | { decision: 'reject'; reason: DuplicateRejectReason };

/**
 * Decides whether `candidate` may be marked as a duplicate. Order matters:
 * record_origin is checked first (a non-production row is never in scope for
 * this queue), then idempotency (already a duplicate), then the needs_review
 * gate. Any other status (approved / converted_to_account / discarded /
 * generated / normalized) is a conflict and is left to a dedicated flow.
 */
export function evaluateDuplicateEligibility(
  candidate: CandidateDuplicateSnapshot,
): DuplicateEligibility {
  // 1. Must be a clean production record — this queue never touches anything else.
  if (candidate.recordOrigin !== DUPLICATE_QUEUE_RECORD_ORIGIN) {
    return { decision: 'reject', reason: 'not_clean_production' };
  }

  // 2. Already a duplicate → idempotent success (safe re-submit / double click).
  if (candidate.status === 'duplicate') {
    return { decision: 'idempotent' };
  }

  // 3. Only pending ('needs_review') candidates can transition; any other
  //    terminal/intermediate state is a conflict.
  if (candidate.status !== DUPLICATE_QUEUE_STATUS) {
    return { decision: 'reject', reason: 'status_conflict' };
  }

  // 4. Clear to mark as duplicate.
  return { decision: 'mark_duplicate' };
}
