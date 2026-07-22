// Q3F-5AZ.2E-1 — Convert-approve eligibility (pure decision layer).
//
// Pure, side-effect-free gate that decides whether a clean-production candidate
// from the Prospectos review surface may be APPROVED AND CONVERTED to a SellUp
// account. No IO, no DB, no clients — it takes a minimal candidate snapshot plus
// caller options and returns a decision the server wrapper turns into a delegated
// conversion. Keeping it pure makes every branch of the safety policy
// (Q3F-5AZ.2E-1 § 4) exhaustively unit-testable.
//
// This is the CONVERT counterpart of `approve-eligibility.ts` (approve-only).
// It differs in two ways the convert flow requires:
//   - `converted_to_account` (+ account id) is the idempotent terminal, NOT
//     `approved`.
//   - `approved` WITHOUT a converted account id is the "approved-only backlog"
//     conflict: this wrapper must NOT silently convert it (remediation is a
//     separate hito, Q3F-5AZ.2E-2). It returns approved_only_requires_remediation.
//
// Policy order (must stay in lock-step with approveAndConvertCandidateAction):
//   1. record_origin MUST be 'production'                → not_clean_production
//   2. status 'converted_to_account' (+ account id)      → idempotent success
//   3. status 'approved' AND no converted account id     → approved_only_requires_remediation
//   4. status MUST be 'needs_review'                     → else status_conflict
//   5. duplicate exact/unchecked/insufficient            → duplicate_blocked
//   6. duplicate possible_duplicate                      → requires explicit confirm
//   7. matched_hubspot_company_id present                → requires explicit confirm
//   8. otherwise                                         → convert

/** Canonical clean-queue criteria — mirrors queries.ts PENDING_REVIEW_*. */
export const CLEAN_QUEUE_RECORD_ORIGIN = 'production';
export const NEEDS_REVIEW_STATUS = 'needs_review';
export const CONVERTED_TO_ACCOUNT_STATUS = 'converted_to_account';
export const APPROVED_STATUS = 'approved';

/**
 * Duplicate statuses that hard-block approval. Mirrors the prospect-batches
 * APPROVE_BLOCK_MESSAGES set so the wrapper never delegates a conversion the
 * canonical approveAndConvertCandidateAction would itself reject.
 */
export const DUPLICATE_HARD_BLOCK = new Set<string>([
  'exact_duplicate',
  'unchecked',
  'insufficient_data',
]);

/** Minimal candidate snapshot the decision needs (no PII). */
export interface ConvertCandidateSnapshot {
  status: string | null;
  recordOrigin: string | null;
  duplicateStatus: string | null;
  convertedAccountId: string | null;
  matchedHubspotCompanyId: string | null;
}

/** Caller-supplied options; possible-duplicate and HubSpot-match need confirm. */
export interface ConvertApproveOptions {
  confirmPossibleDuplicate?: boolean;
  confirmHubSpotMatch?: boolean;
}

/** Reasons a conversion is rejected before any delegation happens. */
export type ConvertApproveRejectReason =
  | 'not_clean_production'
  | 'status_conflict'
  | 'approved_only_requires_remediation'
  | 'duplicate_blocked'
  | 'needs_duplicate_confirmation'
  | 'needs_hubspot_match_confirmation';

/** Discriminated decision returned to the server wrapper. */
export type ConvertApproveEligibility =
  | { decision: 'convert' }
  | { decision: 'idempotent'; accountId: string }
  | { decision: 'reject'; reason: ConvertApproveRejectReason };

/**
 * Decides whether `candidate` may be approved and converted to an account.
 * Order matters (see policy above): record_origin first, then the converted /
 * approved-only terminals, then the needs_review gate, then duplicate policy,
 * then the HubSpot-match confirmation.
 */
export function evaluateConvertApproveEligibility(
  candidate: ConvertCandidateSnapshot,
  options: ConvertApproveOptions = {},
): ConvertApproveEligibility {
  // 1. Must be a clean production record — this surface never converts anything else.
  if (candidate.recordOrigin !== CLEAN_QUEUE_RECORD_ORIGIN) {
    return { decision: 'reject', reason: 'not_clean_production' };
  }

  // 2. Already converted (status + account id) → idempotent success. No second
  //    account, no HubSpot call. Mirrors isCandidateAlreadyConverted.
  const accId =
    typeof candidate.convertedAccountId === 'string' && candidate.convertedAccountId.trim().length > 0
      ? candidate.convertedAccountId
      : null;
  if (candidate.status === CONVERTED_TO_ACCOUNT_STATUS && accId) {
    return { decision: 'idempotent', accountId: accId };
  }

  // 3. Approved-only backlog (approved but never converted). This wrapper must
  //    NOT silently convert it — remediation is a separate hito (Q3F-5AZ.2E-2).
  if (candidate.status === APPROVED_STATUS && !accId) {
    return { decision: 'reject', reason: 'approved_only_requires_remediation' };
  }

  // 4. Only pending ('needs_review') candidates can transition; any other
  //    terminal/intermediate state is a conflict.
  if (candidate.status !== NEEDS_REVIEW_STATUS) {
    return { decision: 'reject', reason: 'status_conflict' };
  }

  // 5. Hard duplicate blocks (exact / unchecked / insufficient_data).
  const dup = candidate.duplicateStatus;
  if (dup != null && DUPLICATE_HARD_BLOCK.has(dup)) {
    return { decision: 'reject', reason: 'duplicate_blocked' };
  }

  // 6. possible_duplicate is allowed ONLY with explicit UI confirmation.
  if (dup === 'possible_duplicate' && options.confirmPossibleDuplicate !== true) {
    return { decision: 'reject', reason: 'needs_duplicate_confirmation' };
  }

  // 7. A matched HubSpot company means the conversion will LINK to it. Requires
  //    explicit UI confirmation so the human acknowledges the existing match.
  const hasHubSpotMatch =
    typeof candidate.matchedHubspotCompanyId === 'string' &&
    candidate.matchedHubspotCompanyId.trim().length > 0;
  if (hasHubSpotMatch && options.confirmHubSpotMatch !== true) {
    return { decision: 'reject', reason: 'needs_hubspot_match_confirmation' };
  }

  // 8. Clear to convert.
  return { decision: 'convert' };
}
