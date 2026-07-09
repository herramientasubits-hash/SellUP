/**
 * Tests — Zero-Reviewable Rate (17B.4X.6C, §28)
 *
 * Cohort is attributed + technical_success only. Cost truth has no bearing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateProviderEffectiveness } from '../aggregators';
import type { ContactEnrichmentRunEvidence, ProviderUsageEvidence } from '../types';

let runCounter = 0;
function makeRun(overrides: Partial<ContactEnrichmentRunEvidence> = {}): ContactEnrichmentRunEvidence {
  runCounter += 1;
  return {
    runId: `zr-run-${runCounter}`,
    status: 'ready_for_review',
    createdAt: '2026-01-01T00:00:00.000Z',
    providersUsed: ['apollo'],
    summary: null,
    usage: [],
    reviewableCandidateCount: 0,
    pendingCandidateCount: 0,
    approvedCandidateCount: 0,
    candidateIds: [],
    traceContactCandidates: [],
    ...overrides,
  };
}

function apolloUsage(overrides: Partial<ProviderUsageEvidence> = {}): ProviderUsageEvidence {
  return {
    providerKey: 'apollo',
    status: 'success',
    estimatedCostUsd: 0,
    creditsUsed: 0,
    durationMs: 100,
    costMetadata: { truthSource: null, hasApolloPricingEvidence: false },
    ...overrides,
  };
}

function apolloOf(runs: ContactEnrichmentRunEvidence[]) {
  const model = aggregateProviderEffectiveness(runs);
  const apollo = model.providers.find((p) => p.provider === 'apollo');
  assert.ok(apollo);
  return apollo!;
}

describe('zero-reviewable rate', () => {
  it('TEST 40 — technical success + 0 candidates → numerator +1, denominator +1', () => {
    const run = makeRun({ reviewableCandidateCount: 0, usage: [apolloUsage()] });
    const apollo = apolloOf([run]);
    assert.equal(apollo.coverage.zeroReviewableRunCount, 1);
    assert.equal(apollo.coverage.zeroReviewableEligibleRunCount, 1);
    assert.equal(apollo.comparable.zeroReviewableRate, 1);
  });

  it('TEST 41 — technical success + 5 candidates → denominator +1 only', () => {
    const run = makeRun({ reviewableCandidateCount: 5, usage: [apolloUsage()] });
    const apollo = apolloOf([run]);
    assert.equal(apollo.coverage.zeroReviewableRunCount, 0);
    assert.equal(apollo.coverage.zeroReviewableEligibleRunCount, 1);
    assert.equal(apollo.comparable.zeroReviewableRate, 0);
  });

  it('TEST 42 — technical failure + 0 candidates → excluded from numerator and denominator', () => {
    const run = makeRun({ reviewableCandidateCount: 0, usage: [apolloUsage({ status: 'error' })] });
    const apollo = apolloOf([run]);
    assert.equal(apollo.coverage.zeroReviewableRunCount, 0);
    assert.equal(apollo.coverage.zeroReviewableEligibleRunCount, 0);
    assert.equal(apollo.comparable.zeroReviewableRate, null);
  });

  it('TEST 43 — technical unknown (unattributed) + 0 candidates → excluded', () => {
    const run = makeRun({ reviewableCandidateCount: 0, usage: [] });
    const apollo = apolloOf([run]);
    assert.equal(apollo.coverage.zeroReviewableEligibleRunCount, 0);
    assert.equal(apollo.comparable.zeroReviewableRate, null);
  });

  it('TEST 44 — ambiguous cost + technical success + 0 candidates → still included (cost truth irrelevant)', () => {
    const run = makeRun({
      reviewableCandidateCount: 0,
      usage: [apolloUsage({ estimatedCostUsd: 0, costMetadata: { truthSource: null, hasApolloPricingEvidence: false } })],
    });
    const apollo = apolloOf([run]);
    assert.equal(apollo.coverage.ambiguousCostRunCount, 1);
    assert.equal(apollo.coverage.zeroReviewableRunCount, 1);
    assert.equal(apollo.comparable.zeroReviewableRate, 1);
  });
});
