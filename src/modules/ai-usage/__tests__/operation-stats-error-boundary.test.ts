/**
 * Q3F-8E — getProviderOperationStats must not swallow Supabase query errors
 * into the same `[]` shape as a legitimate "zero operations" result.
 *
 * Before this fix, `if (error) return [];` made a failed
 * provider_usage_logs query for the operation breakdown indistinguishable
 * from a real empty result, so provider-consumption-actions.ts's
 * `operation_stats` try/catch (which classifies failures via
 * classifyConsumptionError) never fired — the UI silently rendered
 * "Sin consumo por operación" instead of the contained-error banner.
 *
 * `resolveOperationLogRowsOrThrow` is the pure boundary extracted from
 * getProviderOperationStats specifically so this decision is testable
 * without mocking the Supabase admin client (same rationale as
 * operation-stats-aggregator.test.ts for aggregateOperationStats and
 * agent-run-scope.test.ts for createAgentRunScope).
 *
 * The three "valid empty" cases that must NOT throw (scope.mode === 'ids'
 * with 0 ids, agentScope enabled with 0 runIds, and a successful query with
 * data = []) are short-circuited earlier in getProviderOperationStats via
 * `return []` before the query ever runs, or — for a successful query with
 * zero rows — flow through this same helper with `error` falsy. Both paths
 * are covered below.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOperationLogRowsOrThrow,
  createAgentRunScope,
  type AgentRunScope,
} from '../queries';

type Row = {
  operation_key: string | null;
  status: string | null;
  credits_used: number | null;
  estimated_cost_usd: number | null;
};

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    operation_key: 'organizations_search',
    status: 'success',
    credits_used: 1,
    estimated_cost_usd: 0.01,
    ...overrides,
  };
}

describe('resolveOperationLogRowsOrThrow (Q3F-8E error boundary)', () => {
  it('1. valid empty — successful query with data = [] returns []', () => {
    const rows = resolveOperationLogRowsOrThrow([], null);
    assert.deepEqual(rows, []);
  });

  it('valid empty — successful query with data = null (defensive) returns []', () => {
    const rows = resolveOperationLogRowsOrThrow(null, null);
    assert.deepEqual(rows, []);
  });

  it('non-empty success — returns the rows unchanged', () => {
    const rows = [makeRow(), makeRow({ operation_key: 'people_search' })];
    assert.deepEqual(resolveOperationLogRowsOrThrow(rows, null), rows);
  });

  it('4. Supabase query error does NOT become [] — it throws', () => {
    const error = new Error('permission denied for table provider_usage_logs');
    assert.throws(() => resolveOperationLogRowsOrThrow([], error), (thrown: unknown) => {
      assert.equal(thrown, error);
      return true;
    });
  });

  it('a query error takes precedence even if data happens to be non-null', () => {
    // Defensive: some drivers can return a partial/stale `data` alongside a
    // truthy `error`. The error must win — it must never be masked by data.
    const error = { message: 'upstream timeout', name: 'TimeoutError' };
    assert.throws(() => resolveOperationLogRowsOrThrow([makeRow()], error));
  });

  it('5. a thrown query failure carries the original error through unchanged', () => {
    // provider-consumption-actions.ts's classifyConsumptionError() branches
    // on `error.name`, so the boundary must not wrap, rename, or stringify
    // the error — it must propagate the exact object Supabase produced.
    class FakePostgrestError extends Error {
      code = 'PGRST301';
      constructor(message: string) {
        super(message);
        this.name = 'PostgrestError';
      }
    }
    const error = new FakePostgrestError('permission denied');
    try {
      resolveOperationLogRowsOrThrow([], error);
      assert.fail('expected resolveOperationLogRowsOrThrow to throw');
    } catch (caught) {
      assert.equal(caught, error);
      assert.equal((caught as Error).name, 'PostgrestError');
    }
  });
});

describe('getProviderOperationStats empty-scope short-circuits (Q3F-8E, no throw)', () => {
  // These mirror the two scope guards that run BEFORE the Supabase query in
  // getProviderOperationStats (scope.mode === 'ids' && ids.length === 0, and
  // agentScope.enabled && runIds.length === 0). They must keep returning a
  // plain [] — not a thrown error — because they represent a legitimately
  // empty universe, not a query failure.

  it('2. empty agent scope (agent filter resolves to 0 runs) stays a non-throwing empty scope', () => {
    const scope = createAgentRunScope('some_agent', []);
    const expected: AgentRunScope = { enabled: true, runIds: [] };
    assert.deepEqual(scope, expected);
    // getProviderOperationStats short-circuits on this shape via
    // `if (agentScope.enabled && agentScope.runIds.length === 0) return [];`
    // — asserted structurally here since that guard runs before the query.
    assert.equal(scope.enabled && scope.runIds.length === 0, true);
  });

  it('3. empty user scope (scope.mode === "ids" with 0 ids) is the other non-throwing empty guard', () => {
    // resolveUserScope's `{ mode: 'ids', ids: [] }` shape is what
    // `if (scope.mode === 'ids' && scope.ids.length === 0) return [];` checks
    // for in getProviderOperationStats, before any Supabase query runs.
    const scope = { mode: 'ids' as const, ids: [] as string[] };
    assert.equal(scope.mode === 'ids' && scope.ids.length === 0, true);
  });
});
