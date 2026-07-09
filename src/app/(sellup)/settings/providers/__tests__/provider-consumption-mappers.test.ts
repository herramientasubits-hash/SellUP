// 17B.4X.5H — DTO propagation tests: has_unknown_cost must survive the
// mapping from ai-usage producer stats into the presentation DTOs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationStat } from '@/modules/ai-usage/queries';
import type { ProviderStat } from '@/modules/usage-tracking/types';
import { toOperationBreakdownRow, toSnapshotCostFields } from '../provider-consumption-mappers';

function makeOperationStat(overrides: Partial<OperationStat> = {}): OperationStat {
  return {
    operation_key: 'people_search',
    total_calls: 3,
    success_calls: 3,
    error_calls: 0,
    total_credits_used: 10,
    total_estimated_cost_usd: 2.5,
    has_unknown_cost: false,
    ...overrides,
  };
}

function makeProviderStat(overrides: Partial<ProviderStat> = {}): ProviderStat {
  return {
    provider_key: 'apollo',
    total_calls: 3,
    success_calls: 3,
    error_calls: 0,
    total_credits_used: 10,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_results_returned: 5,
    total_estimated_cost_usd: 2.5,
    has_unknown_cost: false,
    last_used_at: null,
    ...overrides,
  };
}

describe('toOperationBreakdownRow', () => {
  it('TEST 12: OperationStat.has_unknown_cost true -> ProviderOperationBreakdownRow.hasUnknownCost true', () => {
    const row = toOperationBreakdownRow(makeOperationStat({ has_unknown_cost: true }), 10);
    assert.equal(row.hasUnknownCost, true);
  });

  it('TEST 13a: false remains false (no numeric inference)', () => {
    const row = toOperationBreakdownRow(makeOperationStat({ has_unknown_cost: false, total_estimated_cost_usd: 0 }), 10);
    assert.equal(row.hasUnknownCost, false);
    assert.equal(row.totalCostUsd, 0);
  });

  it('preserves the known cost subtotal unchanged', () => {
    const row = toOperationBreakdownRow(makeOperationStat({ total_estimated_cost_usd: 4.2 }), 10);
    assert.equal(row.totalCostUsd, 4.2);
  });
});

describe('toSnapshotCostFields', () => {
  it('TEST 11: ProviderStat.has_unknown_cost true -> ProviderConsumptionSnapshot.hasUnknownCost true', () => {
    const fields = toSnapshotCostFields(makeProviderStat({ has_unknown_cost: true }));
    assert.equal(fields.hasUnknownCost, true);
  });

  it('TEST 13b: false remains false (no numeric inference)', () => {
    const fields = toSnapshotCostFields(makeProviderStat({ has_unknown_cost: false, total_estimated_cost_usd: 0 }));
    assert.equal(fields.hasUnknownCost, false);
    assert.equal(fields.totalCostUsd, 0);
  });

  it('defaults to complete + 0 when no stat is found for the provider', () => {
    const fields = toSnapshotCostFields(undefined);
    assert.equal(fields.hasUnknownCost, false);
    assert.equal(fields.totalCostUsd, 0);
  });
});
