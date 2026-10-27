// AGENT2-AUDIT-FIXES-1 — la búsqueda masiva usa el mismo camino que la individual.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executeBulkContactEnrichmentRun,
  summarizeAutomaticResult,
  type BulkRunnerDeps,
} from '../bulk-enrichment-runner';

function deps(over: Partial<BulkRunnerDeps>) {
  const calls = { automatic: 0, statuses: [] as Array<{ status: string; extra?: Record<string, unknown> }>, final: null as unknown };
  const d: BulkRunnerDeps = {
    loadBulkRun: async () => ({ id: 'b1', status: 'created', eligible_account_ids: ['a1', 'a2'], triggered_by: 'u1' }),
    loadAccount: async (id) => ({ id, name: `Empresa ${id}`, domain: `${id}.com`, country_code: 'CO', hubspot_company_id: null }),
    updateBulkRunStatus: async (_id, status, extra) => { calls.statuses.push({ status, extra }); },
    updateBulkRunCounters: async (_id, counters) => { calls.final = counters; },
    isAutomaticRoutingEnabled: async () => true,
    runAutomaticForAccount: async () => { calls.automatic += 1; return { runId: 'r', failed: false, candidatesCreated: 0 }; },
    ...over,
  };
  return { d, calls };
}

describe('búsqueda masiva — camino automático', () => {
  it('cada empresa pasa por el camino automático y suma candidatos', async () => {
    const { d } = deps({
      runAutomaticForAccount: async ({ accountId }) =>
        accountId === 'a1'
          ? { runId: 'r1', failed: false, candidatesCreated: 3 }
          : { runId: 'r2', failed: false, candidatesCreated: 0 },
    });
    const result = await executeBulkContactEnrichmentRun({ bulkRunId: 'b1', triggeredByUserId: 'u1' }, d);
    assert.equal(result.totalCandidatesCreated, 3);
    assert.deepEqual(result.accountResults.map((r) => r.status), ['succeeded', 'no_candidates']);
    assert.equal(result.status, 'completed');
  });

  it('un fallo guarda el motivo real', async () => {
    const { d } = deps({
      runAutomaticForAccount: async () => ({ runId: 'r1', failed: true, candidatesCreated: 0, error: 'Falló Apollo (attempt1_provider_not_called)' }),
    });
    const result = await executeBulkContactEnrichmentRun({ bulkRunId: 'b1', triggeredByUserId: 'u1' }, d);
    assert.equal(result.accountResults[0].error, 'Falló Apollo (attempt1_provider_not_called)');
    assert.equal(result.status, 'failed');
  });

  it('apagada la búsqueda automática: no busca nada, no pasa a running y queda failed con el motivo', async () => {
    const { d, calls } = deps({ isAutomaticRoutingEnabled: async () => false });
    const result = await executeBulkContactEnrichmentRun({ bulkRunId: 'b1', triggeredByUserId: 'u1' }, d);
    assert.equal(calls.automatic, 0);
    assert.equal(result.status, 'failed');
    assert.equal(result.summary.error, 'automatic_routing_disabled');
    assert.deepEqual(calls.statuses.map((s) => s.status), ['failed']);
    assert.equal(calls.final, null);
  });
});

describe('búsqueda masiva — sin camino viejo', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const runner = readFileSync(join(HERE, '..', 'bulk-enrichment-runner.ts'), 'utf8');
  const actions = readFileSync(join(HERE, '..', 'actions.ts'), 'utf8');

  it('el runner ya no llama a los runners de sólo Apollo', () => {
    assert.ok(!runner.includes('apollo-enrichment-runner'));
    assert.ok(!runner.includes('contact-enrichment-runner'));
    assert.ok(!runner.includes('createIndividualRun'));
  });

  it('crear la corrida se rechaza antes de insertar si la búsqueda automática está apagada', () => {
    const fn = actions.slice(actions.indexOf('export async function createBulkContactEnrichmentRunAction('));
    const gate = fn.indexOf('getContactEnrichmentRoutingConfigV1().automaticRoutingEnabled');
    assert.ok(gate > 0);
    assert.ok(gate < fn.indexOf(".from('contact_enrichment_bulk_runs')"));
  });
});

describe('summarizeAutomaticResult', () => {
  const base = {
    success: true, status: 'fallback_executed', blockedReason: null, attempt1AttemptId: 'r1',
    providerCandidatesCreated: { apollo: 1, lusha: 0 }, failedProviders: [] as string[],
    hubspotFirstCandidates: 2, contactBankCandidates: 0, companySiteCandidates: 1,
  };
  it('suma todas las fuentes', () => {
    assert.deepEqual(summarizeAutomaticResult(base), { runId: 'r1', failed: false, candidatesCreated: 4 });
  });
  it('cero con un proveedor caído = fallo con motivo; cero sin fallos = sin candidatos', () => {
    const zero = { ...base, providerCandidatesCreated: { apollo: 0, lusha: null }, hubspotFirstCandidates: 0, companySiteCandidates: 0 };
    assert.equal(summarizeAutomaticResult(zero).failed, false);
    const failed = summarizeAutomaticResult({ ...zero, failedProviders: ['Apollo'] });
    assert.equal(failed.failed, true);
    assert.match(failed.error ?? '', /Falló Apollo/);
  });
  it('sin intento creado = fallo', () => {
    assert.equal(summarizeAutomaticResult({ ...base, attempt1AttemptId: null, blockedReason: 'attempt1_rejected' }).failed, true);
  });
});
