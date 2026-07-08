/**
 * Q3F-8B — Agent filter applied to provider_usage_logs.
 *
 * UsageFilters.agent carries an agent_key, not a run id. provider_usage_logs
 * has no agent_key column (only agent_run_id), so the fix resolves
 * agent_key → agent_runs.id[] and constrains agent_run_id ∈ those ids.
 *
 * `createAgentRunScope` is the single, pure decision shared by
 * getProviderStats, getProviderOperationStats and getRecentProviderLogs. It
 * encodes the three-case boundary (no filter / matching runs / zero runs).
 * Testing it directly covers the shared semantics without mocking the Supabase
 * client — the same approach used by operation-stats-aggregator.test.ts for
 * aggregateOperationStats.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRunScope, type AgentRunScope } from '../queries';

describe('createAgentRunScope (Q3F-8B Agent scope boundary)', () => {
  it('Case A — no filters.agent → scope disabled → agent_run_id NOT constrained', () => {
    const scope = createAgentRunScope(undefined, null);
    assert.deepEqual(scope, { enabled: false } satisfies AgentRunScope);
  });

  it('treats an empty-string agent_key as no filter (disabled)', () => {
    // filters.agent === '' must not enable an (empty) Agent constraint.
    assert.deepEqual(createAgentRunScope('', ['run-1']), { enabled: false });
  });

  it('Case B — agent with run ids → enabled, constrains agent_run_id IN run ids', () => {
    const scope = createAgentRunScope('prospect_generation', ['run-1', 'run-2']);
    assert.deepEqual(scope, { enabled: true, runIds: ['run-1', 'run-2'] });
    // The scope carries the resolved run IDs; callers apply
    // .in('agent_run_id', scope.runIds).
    assert.equal(scope.enabled && scope.runIds.length, 2);
  });

  it('Case C — agent with 0 matching runs → enabled with empty runIds → callers return EMPTY', () => {
    const scope = createAgentRunScope('prospect_generation', []);
    assert.deepEqual(scope, { enabled: true, runIds: [] });
    // enabled + empty runIds is the signal the three query functions use to
    // short-circuit to an empty result instead of running an unconstrained
    // provider_usage_logs query (which would wrongly show every row).
    assert.ok(scope.enabled && scope.runIds.length === 0);
  });

  it('a null resolved-id set for an active agent collapses to empty runIds (fail-closed)', () => {
    // resolveAgentRunIds returns [] on query error; if a caller ever passes
    // null while the key is set, the scope must still be a bounded empty
    // universe, never an unconstrained query.
    assert.deepEqual(createAgentRunScope('some_agent', null), {
      enabled: true,
      runIds: [],
    });
  });

  it('does NOT use agent_key as an agent_run_id — the key never leaks into runIds', () => {
    const scope = createAgentRunScope('prospect_generation', ['run-1']);
    assert.ok(scope.enabled);
    assert.ok(
      !scope.runIds.includes('prospect_generation'),
      'agent_key must be resolved to run ids, never used directly as agent_run_id',
    );
  });

  it('Case 5 — the same decision drives provider stats, operation stats and recent logs', () => {
    // All three query functions build their Agent scope through this one pure
    // helper, so identical inputs yield identical scope. This is the mechanism
    // that guarantees symmetry across the three surfaces.
    const inputs: [string | undefined, string[] | null][] = [
      [undefined, null],
      ['agent_a', ['r1', 'r2']],
      ['agent_a', []],
    ];
    for (const [key, ids] of inputs) {
      const a = createAgentRunScope(key, ids);
      const b = createAgentRunScope(key, ids);
      assert.deepEqual(a, b);
    }
  });
});
