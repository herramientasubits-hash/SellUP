// Q3F-5AZ.2A — Pending Review Queue pure aggregators.
//
// Pure, side-effect-free helpers: confidence banding, age computation, KPI
// summary, filter-option extraction and client-safe filtering. No IO, no DB,
// no Date.now() captured at module scope — callers pass `now` so results are
// deterministic and unit-testable.

import type {
  ConfidenceBand,
  PendingReviewCandidate,
  PendingReviewBatch,
  PendingReviewFilters,
  PendingReviewFilterOptions,
  PendingReviewSummary,
} from './types';

// Confidence band thresholds (0–100 scale). Aligned with the effectiveness
// panel's ≥70 "strong" cut; medium covers the 40–69 working band.
export const CONFIDENCE_HIGH_MIN = 70;
export const CONFIDENCE_MEDIUM_MIN = 40;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Derives the confidence band from a score. Null/NaN → null (unknown). */
export function confidenceBand(score: number | null | undefined): ConfidenceBand | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= CONFIDENCE_HIGH_MIN) return 'high';
  if (score >= CONFIDENCE_MEDIUM_MIN) return 'medium';
  return 'low';
}

/** Whole-day age of a candidate relative to `now` (>= 0). Null when unparseable. */
export function ageInDays(createdAt: string | null | undefined, now: Date): number | null {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return null;
  const diff = now.getTime() - created;
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/** A candidate is a "possible duplicate" if flagged as such OR matched to a
 *  HubSpot company. Mirrors the Q3F-5AZ.1 diagnosis definition. */
export function isPossibleDuplicate(c: PendingReviewCandidate): boolean {
  return c.duplicateStatus === 'possible_duplicate' || c.matchedHubspotCompanyId != null;
}

/** True when the candidate carries a HubSpot company match. */
export function hasHubspotMatch(c: PendingReviewCandidate): boolean {
  return c.matchedHubspotCompanyId != null;
}

/** Builds the top-line KPI summary over the given (full) candidate set. */
export function buildSummary(
  candidates: PendingReviewCandidate[],
  now: Date,
): PendingReviewSummary {
  const countries = new Set<string>();
  const industries = new Set<string>();
  const batches = new Set<string>();
  let possibleDuplicates = 0;
  let hubspotMatches = 0;
  let reviewed = 0;
  const ages: number[] = [];

  for (const c of candidates) {
    if (c.countryCode) countries.add(c.countryCode);
    if (c.industry) industries.add(c.industry);
    if (c.batchId) batches.add(c.batchId);
    if (isPossibleDuplicate(c)) possibleDuplicates += 1;
    if (hasHubspotMatch(c)) hubspotMatches += 1;
    if (c.reviewedBy != null) reviewed += 1;
    const age = ageInDays(c.createdAt, now);
    if (age != null) ages.push(age);
  }

  const avgAgeDays =
    ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;

  return {
    totalPending: candidates.length,
    countries: countries.size,
    industries: industries.size,
    possibleDuplicates,
    hubspotMatches,
    batches: batches.size,
    reviewed,
    avgAgeDays,
    oldestAgeDays: ages.length > 0 ? Math.max(...ages) : null,
    newestAgeDays: ages.length > 0 ? Math.min(...ages) : null,
  };
}

function countBy<K extends string>(
  candidates: PendingReviewCandidate[],
  key: (c: PendingReviewCandidate) => K | null,
): Map<K, number> {
  const map = new Map<K, number>();
  for (const c of candidates) {
    const k = key(c);
    if (k == null) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/**
 * Extracts distinct filter options with counts over the full candidate set.
 * Batch labels prefer the batch name, then a short id fallback — never a raw
 * PII-bearing field.
 */
export function buildFilterOptions(
  candidates: PendingReviewCandidate[],
  batchesById: Record<string, PendingReviewBatch>,
): PendingReviewFilterOptions {
  const byCountry = countBy(candidates, (c) => c.countryCode);
  const byIndustry = countBy(candidates, (c) => c.industry);
  const byBatch = countBy(candidates, (c) => c.batchId);
  const byDuplicate = countBy(candidates, (c) => c.duplicateStatus);
  const byBand = countBy(candidates, (c) => confidenceBand(c.confidenceScore));

  const countries = [...byCountry.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const industries = [...byIndustry.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const batches = [...byBatch.entries()]
    .map(([id, count]) => ({
      id,
      label: batchLabel(id, batchesById[id]),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const duplicateStatuses = [...byDuplicate.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const bandOrder: ConfidenceBand[] = ['high', 'medium', 'low'];
  const confidenceBands = bandOrder
    .filter((band) => byBand.has(band))
    .map((band) => ({ band, count: byBand.get(band) ?? 0 }));

  return { countries, industries, batches, duplicateStatuses, confidenceBands };
}

/** Human-readable batch label: name → "Lote <shortId>" fallback. */
export function batchLabel(id: string, batch: PendingReviewBatch | undefined): string {
  const name = batch?.name?.trim();
  if (name) return name;
  return `Lote ${id.slice(0, 8)}`;
}

/**
 * Applies the URL filters to the candidate list. Pure and order-independent;
 * an unset filter dimension matches everything. Confidence band is derived.
 */
export function applyFilters(
  candidates: PendingReviewCandidate[],
  filters: PendingReviewFilters,
): PendingReviewCandidate[] {
  return candidates.filter((c) => {
    if (filters.countryCode && c.countryCode !== filters.countryCode) return false;
    if (filters.industry && c.industry !== filters.industry) return false;
    if (filters.batchId && c.batchId !== filters.batchId) return false;
    if (filters.duplicateStatus && c.duplicateStatus !== filters.duplicateStatus) return false;
    if (filters.confidenceBand && confidenceBand(c.confidenceScore) !== filters.confidenceBand) {
      return false;
    }
    return true;
  });
}

/** Groups candidates by batch id, preserving input order within each group.
 *  Returns groups ordered by the batch's first appearance in the list. */
export function groupByBatch(
  candidates: PendingReviewCandidate[],
): Array<{ batchId: string | null; candidates: PendingReviewCandidate[] }> {
  const order: Array<string | null> = [];
  const groups = new Map<string | null, PendingReviewCandidate[]>();
  for (const c of candidates) {
    const key = c.batchId ?? null;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(c);
  }
  return order.map((batchId) => ({ batchId, candidates: groups.get(batchId)! }));
}
