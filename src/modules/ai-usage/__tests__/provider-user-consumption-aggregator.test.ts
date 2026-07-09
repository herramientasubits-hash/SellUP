/**
 * Q3F-9 — "Consumo por usuario" breakdown scoped to a single provider.
 *
 * Tests the pure functions exported from ../queries.ts:
 * `aggregateProviderUserConsumption`, `sortProviderUserConsumptionRows`, and
 * `resolveProviderUserLogRowsOrThrow`. All three are dependency-free (no
 * Supabase admin client), so they are exercised directly here instead of
 * mocking the database layer — mirrors the aggregator/error-boundary test
 * split used by operation-stats-aggregator.test.ts and
 * operation-stats-error-boundary.test.ts for the Q3F-8 breakdown.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateProviderUserConsumption,
  sortProviderUserConsumptionRows,
  resolveProviderUserLogRowsOrThrow,
  type ProviderUserConsumptionRow,
} from '../queries';

type Row = {
  triggered_by: string | null;
  credits_used: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    triggered_by: 'user-1',
    credits_used: 1,
    estimated_cost_usd: 0.01,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function find(
  rows: ProviderUserConsumptionRow[],
  triggeredBy: string | null,
): ProviderUserConsumptionRow {
  const found = rows.find((r) => r.triggered_by === triggeredBy);
  assert.ok(found, `expected an aggregated row for triggered_by=${triggeredBy}`);
  return found!;
}

// ============================================================
// AGGREGATION
// ============================================================

describe('aggregateProviderUserConsumption — aggregation', () => {
  it('1. multiple rows for the same triggered_by aggregate into one row', () => {
    const rows = [
      row({ triggered_by: 'user-1' }),
      row({ triggered_by: 'user-1' }),
      row({ triggered_by: 'user-1' }),
    ];
    const result = aggregateProviderUserConsumption(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].provider_calls, 3);
  });

  it('2. two different users remain separate rows', () => {
    const rows = [row({ triggered_by: 'user-1' }), row({ triggered_by: 'user-2' })];
    const result = aggregateProviderUserConsumption(rows);
    assert.equal(result.length, 2);
    assert.ok(result.some((r) => r.triggered_by === 'user-1'));
    assert.ok(result.some((r) => r.triggered_by === 'user-2'));
  });

  it('3. provider_calls counts the number of input rows per bucket', () => {
    const rows = [
      row({ triggered_by: 'user-1' }),
      row({ triggered_by: 'user-1' }),
      row({ triggered_by: 'user-2' }),
    ];
    const result = aggregateProviderUserConsumption(rows);
    assert.equal(find(result, 'user-1').provider_calls, 2);
    assert.equal(find(result, 'user-2').provider_calls, 1);
  });

  it('4. sums credits_used across rows for the same user', () => {
    const rows = [
      row({ triggered_by: 'user-1', credits_used: 2 }),
      row({ triggered_by: 'user-1', credits_used: 5 }),
    ];
    const result = aggregateProviderUserConsumption(rows);
    assert.equal(find(result, 'user-1').total_credits_used, 7);
  });

  it('5. null credits_used normalizes to 0 in the sum', () => {
    const rows = [
      row({ triggered_by: 'user-1', credits_used: 3 }),
      row({ triggered_by: 'user-1', credits_used: null }),
    ];
    const result = aggregateProviderUserConsumption(rows);
    assert.equal(find(result, 'user-1').total_credits_used, 3);
  });

  it('6. sums estimated_cost_usd across rows for the same user', () => {
    const rows = [
      row({ triggered_by: 'user-1', estimated_cost_usd: 0.02 }),
      row({ triggered_by: 'user-1', estimated_cost_usd: 0.03 }),
      row({ triggered_by: 'user-1', estimated_cost_usd: null }),
    ];
    const result = aggregateProviderUserConsumption(rows);
    assert.ok(Math.abs(find(result, 'user-1').total_estimated_cost_usd - 0.05) < 1e-9);
  });

  it('7. last_activity_at is the max created_at for the bucket', () => {
    const rows = [
      row({ triggered_by: 'user-1', created_at: '2026-07-01T00:00:00.000Z' }),
      row({ triggered_by: 'user-1', created_at: '2026-07-05T00:00:00.000Z' }),
      row({ triggered_by: 'user-1', created_at: '2026-07-03T00:00:00.000Z' }),
    ];
    const result = aggregateProviderUserConsumption(rows);
    assert.equal(find(result, 'user-1').last_activity_at, '2026-07-05T00:00:00.000Z');
  });

  it('8. triggered_by === null is preserved as its own row (unattributed)', () => {
    const rows = [row({ triggered_by: null })];
    const result = aggregateProviderUserConsumption(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].triggered_by, null);
  });

  it('9. multiple null-triggered_by rows aggregate into a single unattributed bucket', () => {
    const rows = [row({ triggered_by: null }), row({ triggered_by: null }), row({ triggered_by: null })];
    const result = aggregateProviderUserConsumption(rows);
    const nullRows = result.filter((r) => r.triggered_by === null);
    assert.equal(nullRows.length, 1);
    assert.equal(nullRows[0].provider_calls, 3);
  });

  it('10. a zero-credit, zero-cost consumer is preserved (not filtered out)', () => {
    const rows = [row({ triggered_by: 'user-1', credits_used: 0, estimated_cost_usd: 0 })];
    const result = aggregateProviderUserConsumption(rows);
    const target = find(result, 'user-1');
    assert.equal(target.provider_calls, 1);
    assert.equal(target.total_credits_used, 0);
    assert.ok(result.includes(target), 'zero-credit consumer must not be filtered out');
  });
});

// ============================================================
// RECONCILIATION
// ============================================================

describe('aggregateProviderUserConsumption — reconciliation', () => {
  it('11. sum of provider_calls across all rows equals the input row count', () => {
    const rows = [
      row({ triggered_by: 'user-1' }),
      row({ triggered_by: 'user-1' }),
      row({ triggered_by: 'user-2' }),
      row({ triggered_by: null }),
    ];
    const result = aggregateProviderUserConsumption(rows);
    const totalCalls = result.reduce((sum, r) => sum + r.provider_calls, 0);
    assert.equal(totalCalls, rows.length);
  });

  it('12. sum of total_credits_used equals the null-normalized input credit sum', () => {
    const rows = [
      row({ triggered_by: 'user-1', credits_used: 4 }),
      row({ triggered_by: 'user-2', credits_used: null }),
      row({ triggered_by: null, credits_used: 6 }),
    ];
    const expected = rows.reduce((sum, r) => sum + Number(r.credits_used ?? 0), 0);
    const result = aggregateProviderUserConsumption(rows);
    const total = result.reduce((sum, r) => sum + r.total_credits_used, 0);
    assert.equal(total, expected);
  });

  it('13. sum of total_estimated_cost_usd approximately equals the null-normalized input cost sum', () => {
    const rows = [
      row({ triggered_by: 'user-1', estimated_cost_usd: 0.011 }),
      row({ triggered_by: 'user-2', estimated_cost_usd: null }),
      row({ triggered_by: null, estimated_cost_usd: 0.022 }),
    ];
    const expected = rows.reduce((sum, r) => sum + Number(r.estimated_cost_usd ?? 0), 0);
    const result = aggregateProviderUserConsumption(rows);
    const total = result.reduce((sum, r) => sum + r.total_estimated_cost_usd, 0);
    assert.ok(Math.abs(total - expected) < 1e-9);
  });
});

// ============================================================
// TRUTHFUL COST (Q3F-9U — KNOWN_SUBTOTAL_PLUS_UNKNOWN_FLAG)
// ============================================================

describe('aggregateProviderUserConsumption — truthful cost semantics', () => {
  it('26. known zero cost only: total 0, has_unknown_cost false', () => {
    const rows = [
      row({ triggered_by: 'user-1', estimated_cost_usd: 0 }),
      row({ triggered_by: 'user-1', estimated_cost_usd: 0 }),
    ];
    const result = find(aggregateProviderUserConsumption(rows), 'user-1');
    assert.equal(result.total_estimated_cost_usd, 0);
    assert.equal(result.has_unknown_cost, false);
  });

  it('27. known positive cost only: subtotal correct, has_unknown_cost false', () => {
    const rows = [
      row({ triggered_by: 'user-1', estimated_cost_usd: 0.2 }),
      row({ triggered_by: 'user-1', estimated_cost_usd: 0.3 }),
    ];
    const result = find(aggregateProviderUserConsumption(rows), 'user-1');
    assert.ok(Math.abs(result.total_estimated_cost_usd - 0.5) < 1e-9);
    assert.equal(result.has_unknown_cost, false);
  });

  it('28. all null cost: total 0, has_unknown_cost true', () => {
    const rows = [
      row({ triggered_by: 'user-1', estimated_cost_usd: null }),
      row({ triggered_by: 'user-1', estimated_cost_usd: null }),
    ];
    const result = find(aggregateProviderUserConsumption(rows), 'user-1');
    assert.equal(result.total_estimated_cost_usd, 0);
    assert.equal(result.has_unknown_cost, true);
  });

  it('29. mixed known + null cost: known subtotal preserved, has_unknown_cost true', () => {
    const rows = [
      row({ triggered_by: 'user-1', estimated_cost_usd: 0.2 }),
      row({ triggered_by: 'user-1', estimated_cost_usd: null }),
      row({ triggered_by: 'user-1', estimated_cost_usd: 0.3 }),
    ];
    const result = find(aggregateProviderUserConsumption(rows), 'user-1');
    assert.ok(Math.abs(result.total_estimated_cost_usd - 0.5) < 1e-9);
    assert.equal(result.has_unknown_cost, true);
  });

  it('30. null + known zero: total 0, has_unknown_cost true', () => {
    const rows = [
      row({ triggered_by: 'user-1', estimated_cost_usd: null }),
      row({ triggered_by: 'user-1', estimated_cost_usd: 0 }),
    ];
    const result = find(aggregateProviderUserConsumption(rows), 'user-1');
    assert.equal(result.total_estimated_cost_usd, 0);
    assert.equal(result.has_unknown_cost, true);
  });

  it('31. has_unknown_cost is isolated per bucket — one user unknown does not flip another', () => {
    const rows = [
      row({ triggered_by: 'user-a', estimated_cost_usd: null }),
      row({ triggered_by: 'user-b', estimated_cost_usd: 0.05 }),
    ];
    const result = aggregateProviderUserConsumption(rows);
    assert.equal(find(result, 'user-a').has_unknown_cost, true);
    assert.equal(find(result, 'user-b').has_unknown_cost, false);
  });

  it('32. the unattributed (null triggered_by) bucket carries the correct flag', () => {
    const rows = [
      row({ triggered_by: null, estimated_cost_usd: null }),
      row({ triggered_by: null, estimated_cost_usd: 0.1 }),
    ];
    const result = find(aggregateProviderUserConsumption(rows), null);
    assert.ok(Math.abs(result.total_estimated_cost_usd - 0.1) < 1e-9);
    assert.equal(result.has_unknown_cost, true);
  });

  it('33. sortProviderUserConsumptionRows does not lose has_unknown_cost', () => {
    const rows = [
      agg({ triggered_by: 'a', total_credits_used: 5, has_unknown_cost: true }),
      agg({ triggered_by: 'b', total_credits_used: 10, has_unknown_cost: false }),
    ];
    const sorted = sortProviderUserConsumptionRows(rows);
    assert.deepEqual(
      sorted.map((r) => ({ triggered_by: r.triggered_by, has_unknown_cost: r.has_unknown_cost })),
      [
        { triggered_by: 'b', has_unknown_cost: false },
        { triggered_by: 'a', has_unknown_cost: true },
      ],
    );
  });
});

// ============================================================
// SORTING
// ============================================================

function agg(overrides: Partial<ProviderUserConsumptionRow> = {}): ProviderUserConsumptionRow {
  return {
    triggered_by: 'user-x',
    full_name: null,
    email: null,
    provider_calls: 0,
    total_credits_used: 0,
    total_estimated_cost_usd: 0,
    has_unknown_cost: false,
    last_activity_at: null,
    ...overrides,
  };
}

describe('sortProviderUserConsumptionRows — canonical sort', () => {
  it('14. sorts by total_credits_used DESC', () => {
    const rows = [
      agg({ triggered_by: 'low', total_credits_used: 1 }),
      agg({ triggered_by: 'high', total_credits_used: 10 }),
      agg({ triggered_by: 'mid', total_credits_used: 5 }),
    ];
    const sorted = sortProviderUserConsumptionRows(rows);
    assert.deepEqual(sorted.map((r) => r.triggered_by), ['high', 'mid', 'low']);
  });

  it('15. credits tie breaks by total_estimated_cost_usd DESC', () => {
    const rows = [
      agg({ triggered_by: 'a', total_credits_used: 5, total_estimated_cost_usd: 0.01 }),
      agg({ triggered_by: 'b', total_credits_used: 5, total_estimated_cost_usd: 0.05 }),
    ];
    const sorted = sortProviderUserConsumptionRows(rows);
    assert.deepEqual(sorted.map((r) => r.triggered_by), ['b', 'a']);
  });

  it('16. credits + cost tie breaks by provider_calls DESC', () => {
    const rows = [
      agg({ triggered_by: 'a', total_credits_used: 5, total_estimated_cost_usd: 0.01, provider_calls: 2 }),
      agg({ triggered_by: 'b', total_credits_used: 5, total_estimated_cost_usd: 0.01, provider_calls: 9 }),
    ];
    const sorted = sortProviderUserConsumptionRows(rows);
    assert.deepEqual(sorted.map((r) => r.triggered_by), ['b', 'a']);
  });

  it('17. full tie breaks by identity ASC (full_name ?? email ?? triggered_by)', () => {
    const rows = [
      agg({ triggered_by: 'z-id', full_name: 'Zoe' }),
      agg({ triggered_by: 'a-id', full_name: 'Ana' }),
    ];
    const sorted = sortProviderUserConsumptionRows(rows);
    assert.deepEqual(sorted.map((r) => r.full_name), ['Ana', 'Zoe']);
  });

  it('18. the unattributed bucket (triggered_by null) sorts deterministically by its metrics/identity', () => {
    const rows = [
      agg({ triggered_by: null, total_credits_used: 3 }),
      agg({ triggered_by: 'user-1', total_credits_used: 3, full_name: 'Ana' }),
    ];
    const sorted = sortProviderUserConsumptionRows(rows);
    // Tie on credits/cost/calls → identity ASC: '' (null bucket) < 'Ana'.
    assert.deepEqual(sorted.map((r) => r.triggered_by), [null, 'user-1']);
  });
});

// ============================================================
// BEHAVIOR / PURITY
// ============================================================

describe('aggregateProviderUserConsumption / sortProviderUserConsumptionRows — purity', () => {
  it('19. does not mutate the input rows array', () => {
    const rows = [row({ triggered_by: 'user-1' }), row({ triggered_by: 'user-2' })];
    const snapshot = JSON.parse(JSON.stringify(rows));
    aggregateProviderUserConsumption(rows);
    assert.deepEqual(rows, snapshot);
  });

  it('20. repeated calls with the same input produce the same output (deterministic)', () => {
    const rows = [row({ triggered_by: 'user-1' }), row({ triggered_by: 'user-2' })];
    const first = sortProviderUserConsumptionRows(aggregateProviderUserConsumption(rows));
    const second = sortProviderUserConsumptionRows(aggregateProviderUserConsumption(rows));
    assert.deepEqual(first, second);
  });
});

// ============================================================
// ERROR BOUNDARY
// ============================================================

describe('resolveProviderUserLogRowsOrThrow (error boundary)', () => {
  it('21. successful query with non-empty data returns the rows unchanged', () => {
    const rows = [row(), row({ triggered_by: 'user-2' })];
    assert.deepEqual(resolveProviderUserLogRowsOrThrow(rows, null), rows);
  });

  it('22. successful query with data = [] returns []', () => {
    assert.deepEqual(resolveProviderUserLogRowsOrThrow([], null), []);
  });

  it('23. successful query with data = null (defensive) returns []', () => {
    assert.deepEqual(resolveProviderUserLogRowsOrThrow(null, null), []);
  });

  it('24. a query error does not collapse into [] — it throws the original error unchanged', () => {
    const error = new Error('permission denied for table provider_usage_logs');
    try {
      resolveProviderUserLogRowsOrThrow([], error);
      assert.fail('expected resolveProviderUserLogRowsOrThrow to throw');
    } catch (caught) {
      assert.equal(caught, error);
    }
  });

  it('25. an error takes precedence even when data happens to be non-null', () => {
    const error = { message: 'upstream timeout', name: 'TimeoutError' };
    assert.throws(() => resolveProviderUserLogRowsOrThrow([row()], error));
  });
});
