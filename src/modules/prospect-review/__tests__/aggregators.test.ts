// Q3F-5AZ.2A — Pending Review Queue pure aggregator tests (non-live, no DB).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
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
} from '../aggregators';
import type { PendingReviewCandidate, PendingReviewBatch } from '../types';

const NOW = new Date('2026-07-21T00:00:00.000Z');

function candidate(overrides: Partial<PendingReviewCandidate> = {}): PendingReviewCandidate {
  return {
    id: overrides.id ?? 'c1',
    batchId: overrides.batchId ?? 'b1',
    name: overrides.name ?? 'Acme',
    normalizedName: overrides.normalizedName ?? 'acme',
    domain: overrides.domain ?? 'acme.com',
    website: overrides.website ?? 'https://acme.com',
    country: overrides.country ?? 'Colombia',
    countryCode: overrides.countryCode ?? 'CO',
    city: overrides.city ?? null,
    region: overrides.region ?? null,
    industry: overrides.industry ?? 'Salud',
    subindustry: overrides.subindustry ?? null,
    companySize: overrides.companySize ?? null,
    employeeCount: overrides.employeeCount ?? null,
    fitScore: overrides.fitScore ?? 42,
    confidenceScore: overrides.confidenceScore ?? 57,
    dataCompletenessScore: overrides.dataCompletenessScore ?? 60,
    duplicateStatus: overrides.duplicateStatus ?? 'no_match',
    matchedHubspotCompanyId: overrides.matchedHubspotCompanyId ?? null,
    hubspotMatchStatus: overrides.hubspotMatchStatus ?? null,
    status: overrides.status ?? 'needs_review',
    reviewedBy: overrides.reviewedBy ?? null,
    reviewedAt: overrides.reviewedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-07-06T00:00:00.000Z',
    sourcePrimary: overrides.sourcePrimary ?? 'web_ai',
    recordOrigin: overrides.recordOrigin ?? 'production',
    classificationSource: overrides.classificationSource ?? 'derived_status',
  };
}

describe('confidenceBand', () => {
  it('bands by the documented thresholds', () => {
    assert.equal(confidenceBand(75), 'high');
    assert.equal(confidenceBand(CONFIDENCE_HIGH_MIN), 'high');
    assert.equal(confidenceBand(69), 'medium');
    assert.equal(confidenceBand(CONFIDENCE_MEDIUM_MIN), 'medium');
    assert.equal(confidenceBand(39), 'low');
    assert.equal(confidenceBand(0), 'low');
  });

  it('returns null for null / NaN', () => {
    assert.equal(confidenceBand(null), null);
    assert.equal(confidenceBand(undefined), null);
    assert.equal(confidenceBand(Number.NaN), null);
  });
});

describe('ageInDays', () => {
  it('computes whole-day age relative to now', () => {
    assert.equal(ageInDays('2026-07-14T00:00:00.000Z', NOW), 7);
    assert.equal(ageInDays('2026-07-21T00:00:00.000Z', NOW), 0);
  });

  it('never returns negative and handles unparseable / null', () => {
    assert.equal(ageInDays('2026-07-25T00:00:00.000Z', NOW), 0);
    assert.equal(ageInDays(null, NOW), null);
    assert.equal(ageInDays('not-a-date', NOW), null);
  });
});

describe('possible-duplicate / hubspot predicates', () => {
  it('flags possible_duplicate status', () => {
    assert.equal(isPossibleDuplicate(candidate({ duplicateStatus: 'possible_duplicate' })), true);
  });
  it('flags a hubspot company match even when duplicate_status is no_match', () => {
    const c = candidate({ duplicateStatus: 'no_match', matchedHubspotCompanyId: 'hs-1' });
    assert.equal(isPossibleDuplicate(c), true);
    assert.equal(hasHubspotMatch(c), true);
  });
  it('is false for a clean no_match with no hubspot id', () => {
    const c = candidate();
    assert.equal(isPossibleDuplicate(c), false);
    assert.equal(hasHubspotMatch(c), false);
  });
});

// Fixture mirroring the Q3F-5AZ.1 diagnosis shape at reduced scale:
// 5 candidates, 2 countries, 2 industries, 2 batches, 1 possible dup (hubspot).
const FIXTURE: PendingReviewCandidate[] = [
  candidate({ id: 'c1', batchId: 'b1', countryCode: 'CO', industry: 'Salud', confidenceScore: 72, createdAt: '2026-07-06T00:00:00.000Z' }),
  candidate({ id: 'c2', batchId: 'b1', countryCode: 'CO', industry: 'Tecnología', confidenceScore: 55, createdAt: '2026-07-01T00:00:00.000Z' }),
  candidate({ id: 'c3', batchId: 'b2', countryCode: 'MX', industry: 'Salud', confidenceScore: 48, createdAt: '2026-06-21T00:00:00.000Z' }),
  candidate({ id: 'c4', batchId: 'b2', countryCode: 'MX', industry: 'Salud', confidenceScore: 40, matchedHubspotCompanyId: 'hs-9', duplicateStatus: 'possible_duplicate', createdAt: '2026-07-11T00:00:00.000Z' }),
  candidate({ id: 'c5', batchId: 'b1', countryCode: 'CO', industry: 'Tecnología', confidenceScore: 70, reviewedBy: null, createdAt: '2026-07-16T00:00:00.000Z' }),
];

const BATCHES: Record<string, PendingReviewBatch> = {
  b1: { id: 'b1', name: 'Lote Salud CO', source: 'web_ai', status: 'ready_for_review', createdAt: '2026-07-01T00:00:00.000Z', ownerId: null, createdBy: 'u1' },
  b2: { id: 'b2', name: null, source: 'web_ai', status: 'ready_for_review', createdAt: '2026-06-20T00:00:00.000Z', ownerId: null, createdBy: 'u1' },
};

describe('buildSummary', () => {
  const s = buildSummary(FIXTURE, NOW);
  it('counts total / countries / industries / batches', () => {
    assert.equal(s.totalPending, 5);
    assert.equal(s.countries, 2);
    assert.equal(s.industries, 2);
    assert.equal(s.batches, 2);
  });
  it('counts possible duplicates and hubspot matches', () => {
    assert.equal(s.possibleDuplicates, 1);
    assert.equal(s.hubspotMatches, 1);
  });
  it('reports zero reviewed and a bounded age range', () => {
    assert.equal(s.reviewed, 0);
    assert.equal(s.oldestAgeDays, ageInDays('2026-06-21T00:00:00.000Z', NOW));
    assert.equal(s.newestAgeDays, ageInDays('2026-07-16T00:00:00.000Z', NOW));
    assert.ok(s.avgAgeDays != null && s.avgAgeDays >= (s.newestAgeDays ?? 0));
  });
});

describe('buildFilterOptions', () => {
  const o = buildFilterOptions(FIXTURE, BATCHES);
  it('extracts country counts sorted by frequency', () => {
    assert.deepEqual(o.countries, [
      { code: 'CO', count: 3 },
      { code: 'MX', count: 2 },
    ]);
  });
  it('extracts industries with counts', () => {
    const salud = o.industries.find((i) => i.name === 'Salud');
    assert.equal(salud?.count, 3);
  });
  it('labels batches by name with a short-id fallback', () => {
    const b1 = o.batches.find((b) => b.id === 'b1');
    const b2 = o.batches.find((b) => b.id === 'b2');
    assert.equal(b1?.label, 'Lote Salud CO');
    assert.equal(b2?.label, 'Lote b2');
  });
  it('produces confidence bands in high→low order', () => {
    assert.deepEqual(o.confidenceBands.map((b) => b.band), ['high', 'medium']);
    const high = o.confidenceBands.find((b) => b.band === 'high');
    assert.equal(high?.count, 2); // 72 and 70
  });
  it('extracts duplicate statuses', () => {
    const values = o.duplicateStatuses.map((d) => d.value).sort();
    assert.deepEqual(values, ['no_match', 'possible_duplicate']);
  });
});

describe('applyFilters', () => {
  it('an empty filter set returns everything', () => {
    assert.equal(applyFilters(FIXTURE, {}).length, 5);
  });
  it('filters by country', () => {
    assert.equal(applyFilters(FIXTURE, { countryCode: 'MX' }).length, 2);
  });
  it('filters by industry', () => {
    assert.equal(applyFilters(FIXTURE, { industry: 'Tecnología' }).length, 2);
  });
  it('filters by batch', () => {
    assert.equal(applyFilters(FIXTURE, { batchId: 'b2' }).length, 2);
  });
  it('filters by derived confidence band', () => {
    const high = applyFilters(FIXTURE, { confidenceBand: 'high' });
    assert.deepEqual(high.map((c) => c.id).sort(), ['c1', 'c5']);
  });
  it('filters by duplicate status', () => {
    assert.equal(applyFilters(FIXTURE, { duplicateStatus: 'possible_duplicate' }).length, 1);
  });
  it('composes multiple filters (AND semantics)', () => {
    const r = applyFilters(FIXTURE, { countryCode: 'CO', industry: 'Tecnología' });
    assert.deepEqual(r.map((c) => c.id).sort(), ['c2', 'c5']);
  });
});

describe('groupByBatch', () => {
  it('groups preserving first-appearance order and input order within group', () => {
    const groups = groupByBatch(FIXTURE);
    assert.deepEqual(groups.map((g) => g.batchId), ['b1', 'b2']);
    assert.deepEqual(groups[0].candidates.map((c) => c.id), ['c1', 'c2', 'c5']);
    assert.deepEqual(groups[1].candidates.map((c) => c.id), ['c3', 'c4']);
  });
});

describe('batchLabel', () => {
  it('prefers the trimmed name, else a short-id fallback', () => {
    assert.equal(batchLabel('abcdef12', { id: 'abcdef12', name: '  My Batch  ', source: null, status: null, createdAt: null, ownerId: null, createdBy: null }), 'My Batch');
    assert.equal(batchLabel('abcdef1234', undefined), 'Lote abcdef12');
  });
});
