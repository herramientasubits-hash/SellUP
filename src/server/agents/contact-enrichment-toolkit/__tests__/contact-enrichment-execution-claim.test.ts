/**
 * Tests — Atomic Execution Claim (Agente 2A · 17B.4X.7C.2)
 *
 * Pure DI tests — no DB, no network. Verifies the claim helper's contract:
 * ready_to_enrich → claimed; anything else → not_ready; missing row →
 * not_found; transport failure → error. The claimRow dependency stands in
 * for the single conditional UPDATE ... WHERE ... RETURNING — these tests
 * assert the CONTRACT the runners depend on, not Postgres locking itself.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  claimContactEnrichmentAttemptForExecution,
  type ClaimableRunRow,
  type ClaimExecutionDeps,
} from '../contact-enrichment-execution-claim';

function makeRow(overrides: Partial<ClaimableRunRow> = {}): ClaimableRunRow {
  return {
    id: 'run-1',
    agent_run_id: 'ar-1',
    account_id: 'acc-1',
    company_name: 'Corp',
    company_domain: 'corp.com',
    company_country_code: 'CO',
    status: 'enriching',
    summary: {},
    ...overrides,
  };
}

describe('claimContactEnrichmentAttemptForExecution', () => {
  it('claims a ready_to_enrich row and returns it with status=enriching', async () => {
    const claimed = makeRow();
    let claimRowCalls = 0;
    const deps: ClaimExecutionDeps = {
      claimRow: async (attemptId) => {
        claimRowCalls += 1;
        assert.equal(attemptId, 'run-1');
        return { row: claimed };
      },
      loadCurrentStatus: async () => {
        throw new Error('must not be called when the claim succeeds');
      },
    };

    const result = await claimContactEnrichmentAttemptForExecution('run-1', deps);

    assert.equal(result.status, 'claimed');
    assert.equal(claimRowCalls, 1);
    if (result.status === 'claimed') {
      assert.equal(result.row.id, 'run-1');
      assert.equal(result.row.status, 'enriching');
    }
  });

  it('returns not_ready when the conditional UPDATE matches zero rows but the row exists', async () => {
    const deps: ClaimExecutionDeps = {
      claimRow: async () => ({ row: null }),
      loadCurrentStatus: async () => ({ found: true, status: 'completed' }),
    };

    const result = await claimContactEnrichmentAttemptForExecution('run-2', deps);

    assert.equal(result.status, 'not_ready');
    if (result.status === 'not_ready') {
      assert.equal(result.currentStatus, 'completed');
    }
  });

  it('returns not_ready for a row already claimed by a concurrent caller (status=enriching)', async () => {
    const deps: ClaimExecutionDeps = {
      claimRow: async () => ({ row: null }),
      loadCurrentStatus: async () => ({ found: true, status: 'enriching' }),
    };

    const result = await claimContactEnrichmentAttemptForExecution('run-3', deps);

    assert.equal(result.status, 'not_ready');
    if (result.status === 'not_ready') {
      assert.equal(result.currentStatus, 'enriching');
    }
  });

  it('returns not_found when the row does not exist', async () => {
    const deps: ClaimExecutionDeps = {
      claimRow: async () => ({ row: null }),
      loadCurrentStatus: async () => ({ found: false }),
    };

    const result = await claimContactEnrichmentAttemptForExecution('missing-run', deps);

    assert.equal(result.status, 'not_found');
  });

  it('returns not_found immediately for an empty/invalid attemptId — never calls claimRow', async () => {
    let claimRowCalls = 0;
    const deps: ClaimExecutionDeps = {
      claimRow: async () => {
        claimRowCalls += 1;
        return { row: makeRow() };
      },
    };

    const result = await claimContactEnrichmentAttemptForExecution('', deps);

    assert.equal(result.status, 'not_found');
    assert.equal(claimRowCalls, 0);
  });

  it('returns error when the conditional UPDATE itself fails (transport/DB error)', async () => {
    const deps: ClaimExecutionDeps = {
      claimRow: async () => ({ row: null, error: 'connection reset' }),
      loadCurrentStatus: async () => {
        throw new Error('must not be called after a claimRow error');
      },
    };

    const result = await claimContactEnrichmentAttemptForExecution('run-4', deps);

    assert.equal(result.status, 'error');
    if (result.status === 'error') {
      assert.equal(result.reason, 'connection reset');
    }
  });

  it('single round trip on the happy path — claimRow called once, loadCurrentStatus never', async () => {
    let claimRowCalls = 0;
    let loadCurrentStatusCalls = 0;
    const deps: ClaimExecutionDeps = {
      claimRow: async () => {
        claimRowCalls += 1;
        return { row: makeRow() };
      },
      loadCurrentStatus: async () => {
        loadCurrentStatusCalls += 1;
        return { found: true, status: 'ready_to_enrich' };
      },
    };

    await claimContactEnrichmentAttemptForExecution('run-5', deps);

    assert.equal(claimRowCalls, 1);
    assert.equal(loadCurrentStatusCalls, 0);
  });
});
