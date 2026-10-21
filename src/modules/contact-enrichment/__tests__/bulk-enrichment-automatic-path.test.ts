// AGENT2-AUDIT-FIXES-1 — la búsqueda masiva usa el mismo camino que la individual.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeBulkContactEnrichmentRun,
  summarizeAutomaticResult,
  type BulkRunnerDeps,
} from '../bulk-enrichment-runner';

function deps(over: Partial<BulkRunnerDeps>) {
  const calls = { legacyCreate: 0, legacyApollo: 0, final: null as unknown };
  const d: BulkRunnerDeps = {
    loadBulkRun: async () => ({ id: 'b1', status: 'created', eligible_account_ids: ['a1', 'a2'], triggered_by: 'u1' }),
    loadAccount: async (id) => ({ id, name: `Empresa ${id}`, domain: `${id}.com`, country_code: 'CO', hubspot_company_id: null }),
    updateBulkRunStatus: async () => {},
    updateBulkRunCounters: async (_id, counters) => { calls.final = counters; },
    createIndividualRun: async () => { calls.legacyCreate += 1; return { runId: 'legacy' }; },
    executeApolloRun: async () => { calls.legacyApollo += 1; return { status: 'error', error: 'HTTP_429' }; },
    ...over,
  };
  return { d, calls };
}

describe('búsqueda masiva — camino automático', () => {
  it('con el camino automático encendido no usa el camino viejo y suma candidatos', async () => {
    const { d, calls } = deps({
      runAutomaticForAccount: async ({ accountId }) =>
        accountId === 'a1'
          ? { runId: 'r1', failed: false, candidatesCreated: 3 }
          : { runId: 'r2', failed: false, candidatesCreated: 0 },
    });
    const result = await executeBulkContactEnrichmentRun({ bulkRunId: 'b1', triggeredByUserId: 'u1' }, d);
    assert.equal(calls.legacyCreate, 0);
    assert.equal(calls.legacyApollo, 0);
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

  it('apagado (null): camino viejo, y el error de Apollo trae su motivo', async () => {
    const { d, calls } = deps({ runAutomaticForAccount: async () => null });
    const result = await executeBulkContactEnrichmentRun({ bulkRunId: 'b1', triggeredByUserId: 'u1' }, d);
    assert.equal(calls.legacyApollo, 2);
    assert.equal(result.accountResults[0].error, 'Apollo retornó error: HTTP_429');
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
