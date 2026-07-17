// Q3F-5AX.2 — aggregators pure tests (non-live).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateAgent1Effectiveness,
  buildFunnel,
  buildProviderBreakdown,
  buildRates,
  safeRate,
} from '../aggregators';
import type {
  Agent1BatchRow,
  Agent1CandidateRow,
  Agent1UsageRow,
} from '../types';

function batch(overrides: Partial<Agent1BatchRow> = {}): Agent1BatchRow {
  return {
    id: overrides.id ?? 'b1',
    status: overrides.status ?? 'completed',
    countryCode: overrides.countryCode ?? 'CO',
    industry: overrides.industry ?? 'tech',
    createdBy: overrides.createdBy ?? 'u1',
    createdAt: overrides.createdAt ?? '2026-07-01T00:00:00Z',
    generatedCandidateCount: overrides.generatedCandidateCount ?? null,
    adaptiveResultStatus: overrides.adaptiveResultStatus ?? null,
  };
}

function candidate(status: string, extra: Partial<Agent1CandidateRow> = {}): Agent1CandidateRow {
  return {
    batchId: extra.batchId ?? 'b1',
    status,
    duplicateStatus: extra.duplicateStatus ?? 'no_match',
    convertedAccountId: extra.convertedAccountId ?? null,
  };
}

describe('safeRate', () => {
  it('returns null (not Infinity/NaN) on zero or invalid denominator', () => {
    assert.equal(safeRate(5, 0), null);
    assert.equal(safeRate(5, -1), null);
    assert.equal(safeRate(Number.NaN, 10), null);
    assert.equal(safeRate(3, 6), 0.5);
  });
});

describe('buildFunnel', () => {
  it('empty candidates → all zero, generated null', () => {
    const f = buildFunnel([], []);
    assert.equal(f.batchesCount, 0);
    assert.equal(f.persistedCandidatesCount, 0);
    assert.equal(f.generatedCandidatesCount, null);
    assert.equal(f.convertedAccountsCount, 0);
  });

  it('buckets statuses correctly (approved includes converted)', () => {
    const candidates = [
      candidate('needs_review'),
      candidate('generated'),
      candidate('approved'),
      candidate('converted_to_account', { convertedAccountId: 'acc-1' }),
      candidate('discarded'),
      candidate('duplicate'),
    ];
    const f = buildFunnel([batch()], candidates);
    assert.equal(f.persistedCandidatesCount, 6);
    assert.equal(f.pendingCandidatesCount, 2); // needs_review + generated
    assert.equal(f.approvedCandidatesCount, 2); // approved + converted_to_account
    assert.equal(f.convertedAccountsCount, 1);
    assert.equal(f.rejectedCandidatesCount, 1);
    assert.equal(f.duplicateOrSkippedCount, 1);
  });

  it('duplicate_status match also counts as duplicate/skipped', () => {
    const candidates = [
      candidate('needs_review', { duplicateStatus: 'exact_duplicate' }),
      candidate('needs_review', { duplicateStatus: 'possible_duplicate' }),
    ];
    const f = buildFunnel([batch()], candidates);
    assert.equal(f.duplicateOrSkippedCount, 2);
  });

  it('unknown statuses do not throw and are not miscounted', () => {
    const f = buildFunnel([batch()], [candidate('some_future_status'), candidate('')]);
    assert.equal(f.persistedCandidatesCount, 2);
    assert.equal(f.pendingCandidatesCount, 0);
    assert.equal(f.approvedCandidatesCount, 0);
  });

  it('generatedCandidatesCount sums only when at least one batch exposes it', () => {
    const f1 = buildFunnel([batch({ generatedCandidateCount: null }), batch({ id: 'b2', generatedCandidateCount: null })], []);
    assert.equal(f1.generatedCandidatesCount, null);
    const f2 = buildFunnel(
      [batch({ generatedCandidateCount: 10 }), batch({ id: 'b2', generatedCandidateCount: null })],
      [],
    );
    assert.equal(f2.generatedCandidatesCount, 10);
  });

  it('counts batches with no_new_candidates adaptive result', () => {
    const f = buildFunnel(
      [batch({ adaptiveResultStatus: 'no_new_candidates' }), batch({ id: 'b2', adaptiveResultStatus: 'success_partial' })],
      [],
    );
    assert.equal(f.noNewCandidatesBatchesCount, 1);
  });
});

describe('buildRates', () => {
  it('all rates share persisted denominator; zero persisted → null', () => {
    const f = buildFunnel([batch()], []);
    const r = buildRates(f);
    assert.equal(r.approvalRate, null);
    assert.equal(r.conversionRate, null);
  });

  it('computes proportions over persisted', () => {
    const candidates = [
      candidate('approved'),
      candidate('converted_to_account', { convertedAccountId: 'a' }),
      candidate('discarded'),
      candidate('needs_review'),
    ];
    const f = buildFunnel([batch()], candidates);
    const r = buildRates(f);
    assert.equal(r.approvalRate, 0.5); // 2/4
    assert.equal(r.rejectionRate, 0.25); // 1/4
    assert.equal(r.conversionRate, 0.25); // 1/4
    assert.equal(r.pendingRate, 0.25); // 1/4
  });
});

describe('buildProviderBreakdown', () => {
  it('groups by provider_key + operation_key and tallies cost signals', () => {
    const usage: Agent1UsageRow[] = [
      { batchId: 'b1', providerKey: 'apollo', operationKey: 'search', status: 'success', estimatedCostUsd: 0.01, creditsUsed: 1, resultsReturned: 5 },
      { batchId: 'b1', providerKey: 'apollo', operationKey: 'search', status: 'success', estimatedCostUsd: 0, creditsUsed: 0, resultsReturned: 3 },
      { batchId: 'b1', providerKey: 'apollo', operationKey: 'match', status: 'success', estimatedCostUsd: null, creditsUsed: 1, resultsReturned: 1 },
      { batchId: 'b1', providerKey: 'tavily', operationKey: 'multi_query_web_search', status: 'success', estimatedCostUsd: 0.008, creditsUsed: 1, resultsReturned: 10 },
    ];
    const rows = buildProviderBreakdown(usage);
    assert.equal(rows.length, 3);
    const apolloSearch = rows.find((r) => r.providerKey === 'apollo' && r.operationKey === 'search');
    assert.ok(apolloSearch);
    assert.equal(apolloSearch?.usageLogsCount, 2);
    assert.equal(apolloSearch?.zeroCostRows, 1);
    assert.equal(apolloSearch?.resultsReturned, 8);
    const apolloMatch = rows.find((r) => r.operationKey === 'match');
    assert.equal(apolloMatch?.missingCostRows, 1);
    assert.equal(apolloMatch?.estimatedCostUsd, 0);
  });
});

describe('aggregateAgent1Effectiveness', () => {
  it('empty evidence → safe summary, flag unknown, no NaN/Infinity', () => {
    const s = aggregateAgent1Effectiveness({ batches: [], candidates: [], usageLogs: [] });
    assert.equal(s.costCompletenessFlag, 'unknown');
    assert.equal(s.cost.totalProviderCostUsd, 0);
    assert.equal(s.cost.costPerApprovedCandidate, null);
    assert.equal(s.rates.approvalRate, null);
    assert.equal(s.providerBreakdown.length, 0);
    // guard: no Infinity/NaN anywhere in numeric rate/cost fields
    for (const v of [
      s.rates.approvalRate,
      s.rates.conversionRate,
      s.cost.costPerConvertedAccount,
      s.cost.costPerPersistedCandidate,
    ]) {
      assert.ok(v === null || Number.isFinite(v));
    }
  });

  it('computes cost-per-approved and cost-per-converted from totals', () => {
    const batches = [batch({ generatedCandidateCount: 20, adaptiveResultStatus: 'success_partial' })];
    const candidates = [
      candidate('approved'),
      candidate('converted_to_account', { convertedAccountId: 'acc-1' }),
    ];
    const usageLogs: Agent1UsageRow[] = [
      { batchId: 'b1', providerKey: 'anthropic', operationKey: 'generate', status: 'success', estimatedCostUsd: 0.4, creditsUsed: 0, resultsReturned: 0 },
      { batchId: 'b1', providerKey: 'tavily', operationKey: 'multi_query_web_search', status: 'success', estimatedCostUsd: 0.2, creditsUsed: 25, resultsReturned: 40 },
    ];
    const s = aggregateAgent1Effectiveness({ batches, candidates, usageLogs }, { batchId: 'b1' });
    assert.ok(Math.abs(s.cost.totalProviderCostUsd - 0.6) < 1e-9); // 0.4 + 0.2
    assert.equal(s.funnel.approvedCandidatesCount, 2);
    assert.equal(s.funnel.convertedAccountsCount, 1);
    // cost per approved = 0.6/2 = 0.3 ; per converted = 0.6/1 = 0.6
    assert.ok(Math.abs((s.cost.costPerApprovedCandidate ?? 0) - 0.3) < 1e-9);
    assert.ok(Math.abs((s.cost.costPerConvertedAccount ?? 0) - 0.6) < 1e-9);
    assert.equal(s.funnel.generatedCandidatesCount, 20);
    assert.equal(s.filters.batchId, 'b1');
  });
});
