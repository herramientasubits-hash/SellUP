// Q3F-5AZ.2C — Approve action eligibility (pure decision layer).
//
// Pure, side-effect-free gate that decides whether a candidate from the clean
// pending-review queue may be approved. No IO, no DB, no clients — it takes a
// minimal candidate snapshot plus caller options and returns a decision the
// server action turns into a DB write. Keeping it pure makes every branch of
// the safety policy (Q3F-5AZ.2C § 4) exhaustively unit-testable.
//
// Policy (must stay in lock-step with the queue definition and approveCandidate):
//   - record_origin MUST be 'production'          → else not_clean_production
//   - status 'approved' (already)                 → idempotent (safe no-op)
//   - status MUST be 'needs_review'               → else status_conflict
//   - duplicate_status exact/unchecked/insuff.    → duplicate_blocked
//   - duplicate_status possible_duplicate         → requires explicit UI confirm
//   - anything else                               → approve

/** Canonical clean-queue criteria — mirrors queries.ts PENDING_REVIEW_*. */
export const CLEAN_QUEUE_RECORD_ORIGIN = 'production';
export const CLEAN_QUEUE_STATUS = 'needs_review';

/**
 * Duplicate statuses that hard-block approval. Mirrors the prospect-batches
 * APPROVE_BLOCK_MESSAGES set so the review queue never approves something the
 * canonical approveCandidate would reject.
 */
export const DUPLICATE_HARD_BLOCK = new Set<string>([
  'exact_duplicate',
  'unchecked',
  'insufficient_data',
]);

/** Minimal candidate snapshot the decision needs (no PII). */
export interface CandidateApprovalSnapshot {
  status: string | null;
  recordOrigin: string | null;
  duplicateStatus: string | null;
}

/** Caller-supplied options; possible-duplicate approval needs explicit confirm. */
export interface ApproveOptions {
  confirmPossibleDuplicate?: boolean;
}

/** Reasons an approval is rejected before any write happens. */
export type ApproveRejectReason =
  | 'not_clean_production'
  | 'status_conflict'
  | 'duplicate_blocked'
  | 'needs_duplicate_confirmation';

/** Discriminated decision returned to the server action. */
export type ApproveEligibility =
  | { decision: 'approve' }
  | { decision: 'idempotent' }
  | { decision: 'reject'; reason: ApproveRejectReason };

/**
 * Decides whether `candidate` may be approved. Order matters: record_origin is
 * checked first (a non-production row is never in scope for this queue), then
 * idempotency, then the needs_review gate, then duplicate policy.
 */
export function evaluateApproveEligibility(
  candidate: CandidateApprovalSnapshot,
  options: ApproveOptions = {},
): ApproveEligibility {
  // 1. Must be a clean production record — this queue never touches anything else.
  if (candidate.recordOrigin !== CLEAN_QUEUE_RECORD_ORIGIN) {
    return { decision: 'reject', reason: 'not_clean_production' };
  }

  // 2. Already approved → idempotent success (safe re-submit / double click).
  if (candidate.status === 'approved') {
    return { decision: 'idempotent' };
  }

  // 3. Only pending ('needs_review') candidates can transition; any other
  //    terminal/intermediate state is a conflict.
  if (candidate.status !== CLEAN_QUEUE_STATUS) {
    return { decision: 'reject', reason: 'status_conflict' };
  }

  // 4. Hard duplicate blocks (exact / unchecked / insufficient_data).
  const dup = candidate.duplicateStatus;
  if (dup != null && DUPLICATE_HARD_BLOCK.has(dup)) {
    return { decision: 'reject', reason: 'duplicate_blocked' };
  }

  // 5. possible_duplicate is allowed ONLY with explicit UI confirmation.
  if (dup === 'possible_duplicate' && options.confirmPossibleDuplicate !== true) {
    return { decision: 'reject', reason: 'needs_duplicate_confirmation' };
  }

  // 6. Clear to approve.
  return { decision: 'approve' };
}
