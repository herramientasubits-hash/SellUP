// Q3F-11B — truthful technical-outcome + cost-completeness mapping tests.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeProviderEffectiveness,
  RECENT_USAGE_LOG_WINDOW,
} from '../provider-effectiveness-summary';
import type { ProviderUsageLogRow } from '@/modules/budgets/provider-detail-queries';

function makeLog(overrides: Partial<ProviderUsageLogRow> = {}): ProviderUsageLogRow {
  return {
    id: 'log-1',
    operationKey: 'people_search',
    creditsUsed: 1,
    estimatedCostUsd: 0.2,
    status: 'success',
    triggeredBy: null,
    createdAt: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

describe('summarizeProviderEffectiveness', () => {
  it('TEST 1: empty input -> zero observed, no rate, zero known cost, unknown false', () => {
    const summary = summarizeProviderEffectiveness([]);
    assert.equal(summary.observedLogCount, 0);
    assert.equal(summary.technicalSuccessRate, null);
    assert.equal(summary.knownCostSubtotalUsd, 0);
    assert.equal(summary.hasUnknownCost, false);
    assert.equal(summary.hasSufficientRecentEvidence, false);
  });

  it('TEST 2: single success with known cost -> success 1, failures 0, rate 100, exact subtotal, unknown false', () => {
    const summary = summarizeProviderEffectiveness([makeLog({ estimatedCostUsd: 0.5 })]);
    assert.equal(summary.technicalSuccessCount, 1);
    assert.equal(summary.technicalFailureCount, 0);
    assert.equal(summary.technicalSuccessRate, 100);
    assert.equal(summary.knownCostSubtotalUsd, 0.5);
    assert.equal(summary.hasUnknownCost, false);
  });

  it('TEST 3: success + error -> success 1, failure 1, rate 50', () => {
    const summary = summarizeProviderEffectiveness([
      makeLog({ status: 'success' }),
      makeLog({ status: 'error' }),
    ]);
    assert.equal(summary.technicalSuccessCount, 1);
    assert.equal(summary.technicalFailureCount, 1);
    assert.equal(summary.technicalSuccessRate, 50);
  });

  it('TEST 4: rate_limited -> not success, technical failure', () => {
    const summary = summarizeProviderEffectiveness([makeLog({ status: 'rate_limited' })]);
    assert.equal(summary.technicalSuccessCount, 0);
    assert.equal(summary.technicalFailureCount, 1);
  });

  it('TEST 5: quota_exceeded -> not success, technical failure', () => {
    const summary = summarizeProviderEffectiveness([makeLog({ status: 'quota_exceeded' })]);
    assert.equal(summary.technicalSuccessCount, 0);
    assert.equal(summary.technicalFailureCount, 1);
  });

  it('TEST 6: error -> technical failure', () => {
    const summary = summarizeProviderEffectiveness([makeLog({ status: 'error' })]);
    assert.equal(summary.technicalFailureCount, 1);
  });

  it('TEST 7: null cost only -> known subtotal 0, hasUnknownCost true', () => {
    const summary = summarizeProviderEffectiveness([makeLog({ estimatedCostUsd: null })]);
    assert.equal(summary.knownCostSubtotalUsd, 0);
    assert.equal(summary.hasUnknownCost, true);
  });

  it('TEST 8: known zero cost only -> known subtotal 0, hasUnknownCost false', () => {
    const summary = summarizeProviderEffectiveness([makeLog({ estimatedCostUsd: 0 })]);
    assert.equal(summary.knownCostSubtotalUsd, 0);
    assert.equal(summary.hasUnknownCost, false);
  });

  it('TEST 9: known positive + null -> subtotal is known-only, hasUnknownCost true', () => {
    const summary = summarizeProviderEffectiveness([
      makeLog({ estimatedCostUsd: 0.3 }),
      makeLog({ estimatedCostUsd: null }),
    ]);
    assert.equal(summary.knownCostSubtotalUsd, 0.3);
    assert.equal(summary.hasUnknownCost, true);
  });

  it('TEST 10: 20 rows -> capped/recent-window flag true', () => {
    const logs = Array.from({ length: RECENT_USAGE_LOG_WINDOW }, () => makeLog());
    const summary = summarizeProviderEffectiveness(logs);
    assert.equal(summary.observedLogCount, RECENT_USAGE_LOG_WINDOW);
    assert.equal(summary.isCappedWindow, true);
  });

  it('TEST 11: fewer than 20 rows -> capped flag false', () => {
    const logs = Array.from({ length: 5 }, () => makeLog());
    const summary = summarizeProviderEffectiveness(logs);
    assert.equal(summary.isCappedWindow, false);
  });

  it('TEST 12: unexpected runtime status -> not success, safe unknown/non-success behavior', () => {
    const summary = summarizeProviderEffectiveness([makeLog({ status: 'weird_future_status' })]);
    assert.equal(summary.technicalSuccessCount, 0);
    assert.equal(summary.technicalFailureCount, 0);
    assert.equal(summary.technicalUnknownCount, 1);
  });

  it('null status is treated as unknown/non-success, not a technical success', () => {
    const summary = summarizeProviderEffectiveness([makeLog({ status: null })]);
    assert.equal(summary.technicalSuccessCount, 0);
    assert.equal(summary.technicalUnknownCount, 1);
  });
});
