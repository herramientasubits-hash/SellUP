/**
 * Tests — Official Contact Trace Validity (17B.4X.6C, §29)
 *
 * A trace-valid official contact requires ALL of: metadata.source ===
 * 'contact_enrichment_candidate', same run id, candidate_source matching the
 * provider being evaluated, and a source_candidate_id that resolves to a
 * real candidate of that same run. approvedCandidateCount and
 * newOfficialContactCount remain independent counters (approval/contact
 * writes are non-atomic).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateProviderEffectiveness, isTraceValidOfficialContact } from '../aggregators';
import type { ContactEnrichmentRunEvidence, OfficialContactTraceEvidence } from '../types';

function contact(overrides: Partial<OfficialContactTraceEvidence> = {}): OfficialContactTraceEvidence {
  return {
    metaSource: 'contact_enrichment_candidate',
    metaSourceEnrichmentRunId: 'run-1',
    metaSourceCandidateId: 'cand-1',
    metaCandidateSource: 'apollo',
    ...overrides,
  };
}

const candidateIdsForRun1 = new Set(['cand-1', 'cand-2']);

describe('isTraceValidOfficialContact (pure predicate)', () => {
  it('TEST 45 — same run, valid candidate, matching provider → valid', () => {
    const result = isTraceValidOfficialContact(contact(), {
      runId: 'run-1',
      provider: 'apollo',
      candidateIds: candidateIdsForRun1,
    });
    assert.equal(result, true);
  });

  it('TEST 47 — traced contact for another run → not counted', () => {
    const result = isTraceValidOfficialContact(contact({ metaSourceEnrichmentRunId: 'run-2' }), {
      runId: 'run-1',
      provider: 'apollo',
      candidateIds: candidateIdsForRun1,
    });
    assert.equal(result, false);
  });

  it('TEST 48 — candidate_source provider mismatch → not counted for this provider', () => {
    const result = isTraceValidOfficialContact(contact({ metaCandidateSource: 'lusha' }), {
      runId: 'run-1',
      provider: 'apollo',
      candidateIds: candidateIdsForRun1,
    });
    assert.equal(result, false);
  });

  it('TEST 49 — source_candidate_id references a candidate from another run → not trace-valid', () => {
    const result = isTraceValidOfficialContact(contact({ metaSourceCandidateId: 'cand-from-other-run' }), {
      runId: 'run-1',
      provider: 'apollo',
      candidateIds: candidateIdsForRun1,
    });
    assert.equal(result, false);
  });
});

describe('official contact trace — aggregate level (approved vs official independence)', () => {
  function makeRun(overrides: Partial<ContactEnrichmentRunEvidence> = {}): ContactEnrichmentRunEvidence {
    return {
      runId: 'agg-run-1',
      status: 'ready_for_review',
      createdAt: '2026-01-01T00:00:00.000Z',
      providersUsed: ['apollo'],
      summary: null,
      usage: [
        {
          providerKey: 'apollo',
          status: 'success',
          estimatedCostUsd: 0,
          creditsUsed: 0,
          durationMs: 100,
          costMetadata: { truthSource: null, hasApolloPricingEvidence: false },
        },
      ],
      reviewableCandidateCount: 1,
      pendingCandidateCount: 0,
      approvedCandidateCount: 1,
      candidateIds: ['cand-1'],
      traceContactCandidates: [],
      ...overrides,
    };
  }

  it('TEST 45 — approved candidate + same-run traced official contact → approved 1, official 1', () => {
    const run = makeRun({ traceContactCandidates: [contact({ metaSourceEnrichmentRunId: 'agg-run-1' })] });
    const model = aggregateProviderEffectiveness([run]);
    const apollo = model.providers.find((p) => p.provider === 'apollo')!;
    assert.equal(apollo.coverage.approvedCandidateCount, 1);
    assert.equal(apollo.coverage.newOfficialContactCount, 1);
  });

  it('TEST 46 — approved candidate without a traced contact → approved 1, official 0', () => {
    const run = makeRun({ traceContactCandidates: [] });
    const model = aggregateProviderEffectiveness([run]);
    const apollo = model.providers.find((p) => p.provider === 'apollo')!;
    assert.equal(apollo.coverage.approvedCandidateCount, 1);
    assert.equal(apollo.coverage.newOfficialContactCount, 0);
  });
});
