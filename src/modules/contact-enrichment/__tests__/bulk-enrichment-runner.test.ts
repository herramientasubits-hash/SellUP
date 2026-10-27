/**
 * Tests — Bulk Enrichment Runner (Agente 2A, Hito 17A.10C)
 *
 * Verifica el runner puro con dependencias inyectadas (mocks).
 * Sin DB, sin proveedores, sin Supabase real. Cada empresa pasa por el mismo
 * camino que la búsqueda individual (`runAutomaticForAccount`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeBulkContactEnrichmentRun,
  type BulkRunnerDeps,
} from '../bulk-enrichment-runner';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeBulkRun(overrides: Partial<{
  id: string;
  status: string;
  eligible_account_ids: string[];
  triggered_by: string;
}> = {}) {
  return {
    id: 'bulk-run-1',
    status: 'created',
    eligible_account_ids: ['acc-1', 'acc-2'],
    triggered_by: 'user-1',
    ...overrides,
  };
}

function makeAccount(id: string) {
  return {
    id,
    name: `Empresa ${id}`,
    domain: `${id}.com`,
    country_code: 'CO',
    hubspot_company_id: null,
  };
}

function makeDeps(overrides: Partial<BulkRunnerDeps> = {}): BulkRunnerDeps {
  return {
    loadBulkRun: async (id) => makeBulkRun({ id }),
    loadAccount: async (id) => makeAccount(id),
    updateBulkRunStatus: async () => {},
    updateBulkRunCounters: async () => {},
    isAutomaticRoutingEnabled: async () => true,
    runAutomaticForAccount: async ({ accountId }) => ({ runId: `run-${accountId}`, failed: false, candidatesCreated: 3 }),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('executeBulkContactEnrichmentRun', () => {

  it('falla si bulk run no existe', async () => {
    const deps = makeDeps({ loadBulkRun: async () => null });
    await assert.rejects(
      () => executeBulkContactEnrichmentRun({ bulkRunId: 'missing', triggeredByUserId: 'u1' }, deps),
      /no encontrado/i,
    );
  });

  it('falla si bulk run no está en estado created', async () => {
    const deps = makeDeps({
      loadBulkRun: async (id) => makeBulkRun({ id, status: 'running' }),
    });
    await assert.rejects(
      () => executeBulkContactEnrichmentRun({ bulkRunId: 'bulk-1', triggeredByUserId: 'u1' }, deps),
      /no está en estado ejecutable/i,
    );
  });

  it('devuelve failed si no hay cuentas elegibles', async () => {
    const statusUpdates: string[] = [];
    const deps = makeDeps({
      loadBulkRun: async (id) => makeBulkRun({ id, eligible_account_ids: [] }),
      updateBulkRunStatus: async (_id, status) => { statusUpdates.push(status); },
    });

    const result = await executeBulkContactEnrichmentRun(
      { bulkRunId: 'bulk-1', triggeredByUserId: 'u1' },
      deps,
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.totalProcessed, 0);
    assert.ok(statusUpdates.includes('failed'));
  });

  it('marca bulk como running al iniciar', async () => {
    const statusUpdates: string[] = [];
    const deps = makeDeps({
      updateBulkRunStatus: async (_id, status) => { statusUpdates.push(status); },
    });

    await executeBulkContactEnrichmentRun({ bulkRunId: 'bulk-1', triggeredByUserId: 'u1' }, deps);

    assert.ok(statusUpdates.includes('running'), 'debe marcar running al iniciar');
  });

  it('busca una vez por cuenta elegible, con el bulk_run_id correcto', async () => {
    const calls: Array<{ accountId: string; bulkRunId: string }> = [];
    const deps = makeDeps({
      loadBulkRun: async () => makeBulkRun({ id: 'bulk-xyz' }),
      runAutomaticForAccount: async ({ accountId, bulkRunId }) => {
        calls.push({ accountId, bulkRunId });
        return { runId: `run-${accountId}`, failed: false, candidatesCreated: 1 };
      },
    });

    await executeBulkContactEnrichmentRun({ bulkRunId: 'bulk-xyz', triggeredByUserId: 'u1' }, deps);

    assert.deepEqual(calls, [
      { accountId: 'acc-1', bulkRunId: 'bulk-xyz' },
      { accountId: 'acc-2', bulkRunId: 'bulk-xyz' },
    ]);
  });

  it('ejecución secuencial: no paraleliza (orden preservado)', async () => {
    const order: string[] = [];
    let running = 0;
    const deps = makeDeps({
      loadBulkRun: async (id) => makeBulkRun({ id, eligible_account_ids: ['acc-1', 'acc-2', 'acc-3'] }),
      runAutomaticForAccount: async ({ accountId }) => {
        running += 1;
        assert.equal(running, 1, 'una empresa a la vez');
        order.push(accountId);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return { runId: `run-${accountId}`, failed: false, candidatesCreated: 1 };
      },
    });

    await executeBulkContactEnrichmentRun({ bulkRunId: 'bulk-1', triggeredByUserId: 'u1' }, deps);

    assert.deepEqual(order, ['acc-1', 'acc-2', 'acc-3']);
  });

  it('fallo de una cuenta no detiene el resto', async () => {
    const processedAccounts: string[] = [];
    const deps = makeDeps({
      loadBulkRun: async (id) => makeBulkRun({ id, eligible_account_ids: ['acc-1', 'acc-2', 'acc-3'] }),
      runAutomaticForAccount: async ({ accountId }) => {
        if (accountId === 'acc-2') throw new Error('Error simulado acc-2');
        processedAccounts.push(accountId);
        return { runId: `run-${accountId}`, failed: false, candidatesCreated: 1 };
      },
    });

    const result = await executeBulkContactEnrichmentRun(
      { bulkRunId: 'bulk-1', triggeredByUserId: 'u1' },
      deps,
    );

    assert.deepEqual(processedAccounts, ['acc-1', 'acc-3']);
    assert.equal(result.totalProcessed, 3);
    assert.equal(result.totalFailed, 1);
  });

  it('contadores finales son correctos', async () => {
    const deps = makeDeps({
      runAutomaticForAccount: async ({ accountId }) => ({
        runId: `run-${accountId}`,
        failed: false,
        candidatesCreated: accountId === 'acc-1' ? 3 : 2,
      }),
    });

    const result = await executeBulkContactEnrichmentRun(
      { bulkRunId: 'bulk-1', triggeredByUserId: 'u1' },
      deps,
    );

    assert.equal(result.totalProcessed, 2);
    assert.equal(result.totalSucceeded, 2);
    assert.equal(result.totalFailed, 0);
    assert.equal(result.totalCandidatesCreated, 5);
  });

  it('finaliza completed si todas las cuentas retornan no_candidates', async () => {
    const deps = makeDeps({
      runAutomaticForAccount: async ({ accountId }) => ({ runId: `run-${accountId}`, failed: false, candidatesCreated: 0 }),
    });

    const result = await executeBulkContactEnrichmentRun(
      { bulkRunId: 'bulk-1', triggeredByUserId: 'u1' },
      deps,
    );

    assert.equal(result.status, 'completed');
    assert.equal(result.totalCandidatesCreated, 0);
    assert.deepEqual(result.accountResults.map((r) => r.status), ['no_candidates', 'no_candidates']);
  });

  it('finaliza completed_with_errors si una cuenta falla', async () => {
    const deps = makeDeps({
      runAutomaticForAccount: async ({ accountId }) =>
        accountId === 'acc-2'
          ? { runId: 'run-acc-2', failed: true, candidatesCreated: 0, error: 'Falló Apollo' }
          : { runId: 'run-acc-1', failed: false, candidatesCreated: 3 },
    });

    const result = await executeBulkContactEnrichmentRun(
      { bulkRunId: 'bulk-1', triggeredByUserId: 'u1' },
      deps,
    );

    assert.equal(result.status, 'completed_with_errors');
    assert.equal(result.totalFailed, 1);
    assert.equal(result.totalSucceeded, 1);
    assert.equal(result.accountResults[1].error, 'Falló Apollo');
  });

  it('finaliza failed si ninguna cuenta pudo procesarse', async () => {
    const deps = makeDeps({
      runAutomaticForAccount: async () => { throw new Error('Error sistémico'); },
    });

    const result = await executeBulkContactEnrichmentRun(
      { bulkRunId: 'bulk-1', triggeredByUserId: 'u1' },
      deps,
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.totalSucceeded, 0);
    assert.equal(result.totalFailed, 2);
  });

  it('procesa exactamente las cuentas que trae el bulk (el tope lo valida la acción)', async () => {
    const manyAccounts = Array.from({ length: 5 }, (_, i) => `acc-${i}`);
    const deps = makeDeps({
      loadBulkRun: async (id) => makeBulkRun({ id, eligible_account_ids: manyAccounts }),
    });

    const result = await executeBulkContactEnrichmentRun(
      { bulkRunId: 'bulk-1', triggeredByUserId: 'u1' },
      deps,
    );

    assert.equal(result.totalProcessed, 5);
  });

});
