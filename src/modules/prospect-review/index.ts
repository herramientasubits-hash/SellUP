// Q3F-5AZ.2A — Pending Review Queue (read-only) module barrel.
//
// Read-only surface for clean-production Agent 1 candidates pending human
// review (record_origin='production' AND status='needs_review'). No writes,
// no migrations, no provider calls, no approve/discard/convert actions.

export { getPendingReviewQueue } from './actions';
export type { PendingReviewQueueResult } from './actions';
export {
  fetchPendingReviewEvidence,
  PENDING_REVIEW_RECORD_ORIGIN,
  PENDING_REVIEW_STATUS,
} from './queries';
export {
  confidenceBand,
  ageInDays,
  isPossibleDuplicate,
  hasHubspotMatch,
  buildSummary,
  buildFilterOptions,
  applyFilters,
  groupByBatch,
  batchLabel,
  CONFIDENCE_HIGH_MIN,
  CONFIDENCE_MEDIUM_MIN,
} from './aggregators';
export type {
  ConfidenceBand,
  PendingReviewFilters,
  PendingReviewCandidate,
  PendingReviewBatch,
  PendingReviewEvidence,
  PendingReviewSummary,
  PendingReviewFilterOptions,
  PendingReviewResult,
} from './types';
