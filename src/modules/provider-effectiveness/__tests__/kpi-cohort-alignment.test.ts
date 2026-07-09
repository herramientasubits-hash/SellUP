/**
 * Tests — KPI Cohort Alignment (17B.4X.6C, §27)
 *
 * The most critical property of this read model: cost ratios must align
 * numerator and denominator to the exact same eligible-run cohort, and cost
 * aggregation is sum-cost/sum-outcomes — never an average of per-run ratios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateProviderEffectiveness } from '../aggregators';
import type { ContactEnrichmentRunEvidence, ProviderUsageEvidence } from '../types';

let runCounter = 0;
function makeRun(overrides: Partial<ContactEnrichmentRunEvidence> = {}): ContactEnrichmentRunEvidence {
  runCounter += 1;
  return {
    runId: `run-${runCounter}`,
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

function knownApolloUsage(costUsd: number): ProviderUsageEvidence {
  return {
    providerKey: 'apollo',
    status: 'success',
    estimatedCostUsd: costUsd,
    creditsUsed: costUsd > 0 ? 1 : 0,
    durationMs: 100,
    costMetadata: { truthSource: null, hasApolloPricingEvidence: true },
  };
}

function ambiguousApolloUsage(): ProviderUsageEvidence {
  return {
    providerKey: 'apollo',
    status: 'success',
    estimatedCostUsd: 0,
    creditsUsed: 0,
    durationMs: 100,
    costMetadata: { truthSource: null, hasApolloPricingEvidence: false },
  };
}

function unknownApolloUsage(): ProviderUsageEvidence {
  return {
    providerKey: 'apollo',
    status: 'success',
    estimatedCostUsd: null,
    creditsUsed: null,
    durationMs: 100,
    costMetadata: { truthSource: null, hasApolloPricingEvidence: false },
  };
}

function apolloOf(runs: ContactEnrichmentRunEvidence[]) {
  const model = aggregateProviderEffectiveness(runs);
  const apollo = model.providers.find((p) => p.provider === 'apollo');
  assert.ok(apollo, 'apollo summary must exist');
  return apollo!;
}

describe('KPI cohort alignment', () => {
  it('TEST 31 — open run (1 approved, 4 pending) excluded from approvalRate and costPerApprovedContact', () => {
    const run = makeRun({
      pendingCandidateCount: 4,
      approvedCandidateCount: 1,
      reviewableCandidateCount: 5,
      usage: [knownApolloUsage(5)],
    });
    const apollo = apolloOf([run]);
    assert.equal(apollo.comparable.approvalRate, null);
    assert.equal(apollo.comparable.costPerApprovedContactUsd, null);
  });

  it('TEST 32 — mature run (1 approved, 4 discarded) → approval rate 20%', () => {
    const run = makeRun({
      pendingCandidateCount: 0,
      approvedCandidateCount: 1,
      reviewableCandidateCount: 5,
      usage: [knownApolloUsage(5)],
    });
    const apollo = apolloOf([run]);
    assert.equal(apollo.comparable.approvalRate, 0.2);
  });

  it('TEST 33 — cost eligible run: $5 / 5 reviewables → cost/reviewable $1', () => {
    const run = makeRun({ reviewableCandidateCount: 5, usage: [knownApolloUsage(5)] });
    const apollo = apolloOf([run]);
    assert.equal(apollo.comparable.costPerReviewableCandidateUsd, 1);
  });

  it('TEST 34 — ambiguous cost run ($0, 5 reviewables) excluded from BOTH numerator and denominator', () => {
    const ambiguousRun = makeRun({ reviewableCandidateCount: 5, usage: [ambiguousApolloUsage()] });
    const knownRun = makeRun({ reviewableCandidateCount: 10, usage: [knownApolloUsage(10)] });
    const apollo = apolloOf([ambiguousRun, knownRun]);
    // Only the known-cost run contributes — ambiguous run's 5 reviewables
    // must not dilute the denominator.
    assert.equal(apollo.comparable.costPerReviewableCandidateUsd, 1);
    // But total reviewable coverage still counts both runs' candidates.
    assert.equal(apollo.coverage.reviewableCandidateCount, 15);
    assert.equal(apollo.coverage.costEligibleRunCount, 1);
  });

  it('TEST 35 — unknown cost run: same exclusion behavior as ambiguous', () => {
    const unknownRun = makeRun({ reviewableCandidateCount: 5, usage: [unknownApolloUsage()] });
    const knownRun = makeRun({ reviewableCandidateCount: 10, usage: [knownApolloUsage(10)] });
    const apollo = apolloOf([unknownRun, knownRun]);
    assert.equal(apollo.comparable.costPerReviewableCandidateUsd, 1);
    assert.equal(apollo.coverage.reviewableCandidateCount, 15);
    assert.equal(apollo.coverage.unknownCostRunCount, 1);
  });

  it('TEST 36 — sum-cost/sum-outcomes, never average of per-run ratios', () => {
    const runA = makeRun({ reviewableCandidateCount: 10, usage: [knownApolloUsage(10)] });
    const runB = makeRun({ reviewableCandidateCount: 1, usage: [knownApolloUsage(10)] });
    const apollo = apolloOf([runA, runB]);
    // $20 / 11 reviewables, not average($1, $10) = $5.5
    assert.equal(apollo.comparable.costPerReviewableCandidateUsd, 20 / 11);
    assert.notEqual(apollo.comparable.costPerReviewableCandidateUsd, 5.5);
  });

  it('TEST 37 — zero cost-eligible reviewables → costPerReviewableCandidateUsd is null (not 0, not Infinity)', () => {
    const run = makeRun({ reviewableCandidateCount: 0, usage: [knownApolloUsage(10)] });
    const apollo = apolloOf([run]);
    assert.equal(apollo.comparable.costPerReviewableCandidateUsd, null);
  });

  it('TEST 38 — zero approved denominator → costPerApprovedContactUsd is null', () => {
    const run = makeRun({
      reviewableCandidateCount: 5,
      approvedCandidateCount: 0,
      usage: [knownApolloUsage(10)],
    });
    const apollo = apolloOf([run]);
    assert.equal(apollo.comparable.costPerApprovedContactUsd, null);
  });

  it('TEST 39 — approval rate uses all approval-eligible runs regardless of cost truth', () => {
    const ambiguousCostButApprovalEligible = makeRun({
      reviewableCandidateCount: 5,
      approvedCandidateCount: 2,
      usage: [ambiguousApolloUsage()],
    });
    const apollo = apolloOf([ambiguousCostButApprovalEligible]);
    assert.equal(apollo.comparable.approvalRate, 2 / 5);
    // Cost truth still excludes this run from the cost KPI, proving the two
    // KPIs read independent cohorts.
    assert.equal(apollo.comparable.costPerReviewableCandidateUsd, null);
  });
});
