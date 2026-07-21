// Q3F-5AZ.2A — Pending Review Queue (read-only) types.
//
// Domain shapes for the clean-production Agent 1 review queue. The queue is
// the set of `prospect_candidates` with record_origin = 'production' AND
// status = 'needs_review' (see Q3F-5AZ.1 diagnosis: 55 clean pending). This
// milestone is READ-ONLY: no approve/discard/convert/enrich. No writes.

/** Confidence band derived from `confidence_score` (0–100 scale). */
export type ConfidenceBand = 'high' | 'medium' | 'low';

/**
 * URL-driven filters for the queue. Every field is optional; an absent field
 * means "no filter" for that dimension. Values map 1:1 to persisted candidate
 * columns except `confidenceBand`, which is derived (see aggregators).
 */
export interface PendingReviewFilters {
  countryCode?: string;
  industry?: string;
  batchId?: string;
  confidenceBand?: ConfidenceBand;
  duplicateStatus?: string;
}

/** One candidate row, narrowed to the fields the read-only queue needs. */
export interface PendingReviewCandidate {
  id: string;
  batchId: string | null;
  name: string | null;
  normalizedName: string | null;
  domain: string | null;
  website: string | null;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  subindustry: string | null;
  companySize: string | null;
  employeeCount: number | null;
  fitScore: number | null;
  confidenceScore: number | null;
  dataCompletenessScore: number | null;
  duplicateStatus: string | null;
  matchedHubspotCompanyId: string | null;
  hubspotMatchStatus: string | null;
  status: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  sourcePrimary: string | null;
  recordOrigin: string | null;
  classificationSource: string | null;
}

/** Batch metadata for grouping and context (no candidate PII). */
export interface PendingReviewBatch {
  id: string;
  name: string | null;
  source: string | null;
  status: string | null;
  createdAt: string | null;
  ownerId: string | null;
  createdBy: string | null;
}

/** Raw evidence loaded from the DB before filtering/aggregation. */
export interface PendingReviewEvidence {
  candidates: PendingReviewCandidate[];
  batches: PendingReviewBatch[];
}

/** Top-line KPIs, computed over the FULL pending set (unfiltered). */
export interface PendingReviewSummary {
  totalPending: number;
  countries: number;
  industries: number;
  possibleDuplicates: number;
  hubspotMatches: number;
  batches: number;
  reviewed: number;
  avgAgeDays: number | null;
  oldestAgeDays: number | null;
  newestAgeDays: number | null;
}

/** Distinct filter options with counts, computed over the FULL pending set. */
export interface PendingReviewFilterOptions {
  countries: Array<{ code: string; count: number }>;
  industries: Array<{ name: string; count: number }>;
  batches: Array<{ id: string; label: string; count: number }>;
  duplicateStatuses: Array<{ value: string; count: number }>;
  confidenceBands: Array<{ band: ConfidenceBand; count: number }>;
}

/** Full result returned to the page: summary + options over the whole queue,
 *  plus the filtered candidate list and a batch lookup by id. */
export interface PendingReviewResult {
  summary: PendingReviewSummary;
  options: PendingReviewFilterOptions;
  candidates: PendingReviewCandidate[];
  batchesById: Record<string, PendingReviewBatch>;
  appliedFilters: PendingReviewFilters;
}
