/**
 * Q3F-8 — Provider consumption breakdown by operation_key.
 *
 * Tests the pure aggregator `aggregateOperationStats` exported from
 * ../queries.ts. It is dependency-free (no Supabase admin client), so it is
 * exercised directly here instead of mocking the database layer — mirrors
 * the async getProviderOperationStats query one-to-one (same grouping,
 * same success/error classification as getProviderStats), but the async
 * wrapper itself is thin enough that testing the pure core is sufficient
 * coverage without introducing a new mocking framework.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateOperationStats, type OperationStat } from '../queries';

type Row = {
  operation_key: string | null;
  status: string | null;
  credits_used: number | null;
  estimated_cost_usd: number | null;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    operation_key: 'organizations_search',
    status: 'success',
    credits_used: 1,
    estimated_cost_usd: 0.01,
    ...overrides,
  };
}

function find(stats: OperationStat[], key: string): OperationStat {
  const found = stats.find((s) => s.operation_key === key);
  assert.ok(found, `expected an aggregated row for operation_key=${key}`);
  return found!;
}

describe('aggregateOperationStats', () => {
  it('groups multiple rows with the same operation_key', () => {
    const rows = [
      row({ operation_key: 'organizations_search' }),
      row({ operation_key: 'organizations_search' }),
      row({ operation_key: 'organizations_search' }),
    ];
    const stats = aggregateOperationStats(rows);
    assert.equal(stats.length, 1);
    assert.equal(stats[0].total_calls, 3);
  });

  it('separates two different operation_keys into distinct rows', () => {
    const rows = [
      row({ operation_key: 'organizations_search' }),
      row({ operation_key: 'person_match' }),
    ];
    const stats = aggregateOperationStats(rows);
    assert.equal(stats.length, 2);
    assert.ok(stats.some((s) => s.operation_key === 'organizations_search'));
    assert.ok(stats.some((s) => s.operation_key === 'person_match'));
  });

  it('sums credits_used across rows for the same operation', () => {
    const rows = [
      row({ operation_key: 'person_match', credits_used: 2 }),
      row({ operation_key: 'person_match', credits_used: 5 }),
      row({ operation_key: 'person_match', credits_used: null }),
    ];
    const stats = aggregateOperationStats(rows);
    assert.equal(find(stats, 'person_match').total_credits_used, 7);
  });

  it('sums estimated_cost_usd across rows for the same operation', () => {
    const rows = [
      row({ operation_key: 'person_match', estimated_cost_usd: 0.02 }),
      row({ operation_key: 'person_match', estimated_cost_usd: 0.03 }),
      row({ operation_key: 'person_match', estimated_cost_usd: null }),
    ];
    const stats = aggregateOperationStats(rows);
    assert.ok(
      Math.abs(find(stats, 'person_match').total_estimated_cost_usd - 0.05) < 1e-9,
    );
  });

  it('counts success/error using the same semantics as getProviderStats (status !== "success" is an error)', () => {
    const rows = [
      row({ operation_key: 'organizations_search', status: 'success' }),
      row({ operation_key: 'organizations_search', status: 'error' }),
      row({ operation_key: 'organizations_search', status: 'rate_limited' }),
      row({ operation_key: 'organizations_search', status: 'quota_exceeded' }),
    ];
    const stats = find(aggregateOperationStats(rows), 'organizations_search');
    assert.equal(stats.total_calls, 4);
    assert.equal(stats.success_calls, 1);
    assert.equal(stats.error_calls, 3);
  });

  it('preserves an operation with 0 credits when it had calls', () => {
    const rows = [
      row({ operation_key: 'bulk_people_search', credits_used: 0, estimated_cost_usd: 0 }),
      row({ operation_key: 'bulk_people_search', credits_used: null, estimated_cost_usd: null }),
    ];
    const stats = aggregateOperationStats(rows);
    const target = find(stats, 'bulk_people_search');
    assert.equal(target.total_calls, 2);
    assert.equal(target.total_credits_used, 0);
    assert.ok(stats.includes(target), 'zero-credit operation must not be filtered out');
  });

  it('produces deterministic ordering (credits desc, then calls desc, then operation_key asc)', () => {
    const rows = [
      row({ operation_key: 'b_op', credits_used: 5 }),
      row({ operation_key: 'a_op', credits_used: 5 }),
      row({ operation_key: 'c_op', credits_used: 20 }),
      row({ operation_key: 'd_op', credits_used: 0 }),
      row({ operation_key: 'd_op', credits_used: 0 }),
      row({ operation_key: 'e_op', credits_used: 0 }),
    ];
    const stats = aggregateOperationStats(rows);
    const order = stats.map((s) => s.operation_key);
    // c_op has the most credits (20) -> first.
    // a_op and b_op tie on credits (5) -> alphabetical: a_op then b_op.
    // d_op (2 calls, 0 credits) beats e_op (1 call, 0 credits) on call volume.
    assert.deepEqual(order, ['c_op', 'a_op', 'b_op', 'd_op', 'e_op']);
  });

  it('is a pure function: repeated calls with the same input produce the same output', () => {
    const rows = [row({ operation_key: 'organizations_search' }), row({ operation_key: 'person_match' })];
    const first = aggregateOperationStats(rows);
    const second = aggregateOperationStats(rows);
    assert.deepEqual(first, second);
  });
});

/**
 * The creditsPercentage formula lives inline in
 * ../../../app/(sellup)/settings/providers/provider-consumption-actions.ts
 * (a 'use server' file, whose non-async exports Next.js rejects at build
 * time — so it cannot be imported directly). Mirrored here 1:1, the same
 * way src/modules/budgets/__tests__/budget-resolution-pure.test.ts
 * re-implements matchRule to test in-process logic without a live server
 * action boundary.
 */
function computeCreditsPercentage(operationCredits: number, providerTotalCredits: number): number {
  const raw = providerTotalCredits > 0 ? (operationCredits / providerTotalCredits) * 100 : 0;
  return Number.isFinite(raw) ? raw : 0;
}

describe('creditsPercentage formula (mirrors provider-consumption-actions.ts)', () => {
  it('is 0 when the provider total credits for the filtered scope is 0', () => {
    assert.equal(computeCreditsPercentage(5, 0), 0);
  });

  it('computes the share of the operation over the provider total', () => {
    assert.equal(computeCreditsPercentage(25, 100), 25);
  });
});
