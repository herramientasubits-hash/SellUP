// 17B.4X.5H — getUsageSummary's NULL-safe cost aggregation (settings/usage).
// Pure aggregator, no Supabase mocking needed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUsageSummaryCost } from '../actions';

describe('aggregateUsageSummaryCost', () => {
  it('TEST 7: a NULL-cost row contributes 0 to the subtotal and sets has_unknown_cost', () => {
    const result = aggregateUsageSummaryCost([{ estimated_cost_usd: null }]);
    assert.equal(result.total_estimated_cost_usd, 0);
    assert.equal(result.has_unknown_cost, true);
  });

  it('TEST 8: a numeric-zero row contributes 0 but does NOT set has_unknown_cost', () => {
    const result = aggregateUsageSummaryCost([{ estimated_cost_usd: 0 }]);
    assert.equal(result.total_estimated_cost_usd, 0);
    assert.equal(result.has_unknown_cost, false);
  });

  it('TEST 9: a known 5 + an unknown NULL -> subtotal 5, has_unknown_cost true', () => {
    const result = aggregateUsageSummaryCost([
      { estimated_cost_usd: 5 },
      { estimated_cost_usd: null },
    ]);
    assert.equal(result.total_estimated_cost_usd, 5);
    assert.equal(result.has_unknown_cost, true);
  });

  it('TEST 10: two known rows (5 + 2) -> subtotal 7, has_unknown_cost false', () => {
    const result = aggregateUsageSummaryCost([
      { estimated_cost_usd: 5 },
      { estimated_cost_usd: 2 },
    ]);
    assert.equal(result.total_estimated_cost_usd, 7);
    assert.equal(result.has_unknown_cost, false);
  });

  it('handles an empty row set as complete-zero', () => {
    const result = aggregateUsageSummaryCost([]);
    assert.equal(result.total_estimated_cost_usd, 0);
    assert.equal(result.has_unknown_cost, false);
  });
});
