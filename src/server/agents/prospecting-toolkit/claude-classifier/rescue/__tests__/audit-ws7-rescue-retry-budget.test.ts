/**
 * AUDIT-A1-WS7 (16-10) — el rescate de Claude ya no reintenta ni gasta sin fin:
 *
 *   · `website_unreachable` / `model_error` se reintentan como mucho
 *     RESCUE_MAX_RETRY_ATTEMPTS veces (contador fuera de `claude_rescue`, que la
 *     marca «en proceso» reescribe);
 *   · el tope de US$3 es por LOTE y acumulado entre corridas (antes se reiniciaba
 *     en cada cadena); al llegar, no se empiezan más empresas y la cadena se corta.
 *
 * Dobles en memoria; cero E/S.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateRescuePatch,
  RESCUE_MAX_RETRY_ATTEMPTS,
  RESCUE_RETRY_ATTEMPTS_KEY,
  rescueStillPending,
  retryAttemptsOf,
} from '../rescue-patch';
import { buildDispositionStaysEvidence } from '../rescue-dispositions';
import { RESCUE_BATCH_MAX_COST_USD, rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';
import { decideRescueContinuation } from '../rescue-chain';
import { readBatchRescueSpentUsd } from '../rescue-batch.server';
import type { CompanyClassificationResult } from '../../types';
import type { ClassifiableCandidateRow } from '../../classification-metadata';

const AT = '2026-10-16T12:00:00.000Z';
const NOW = Date.parse(AT);

const unreachable = {
  candidateId: 'c1', outcome: 'website_unreachable', sector: null, employeeRange: null, rejected: [],
  isOperatingCompany: null, pageFinalUrl: null, usage: null, errorCode: 'fetch_error', durationMs: 1,
} as unknown as CompanyClassificationResult;

describe('tope de reintentos', () => {
  it('cada resultado reintentable suma un intento; al tope deja de estar pendiente', () => {
    let metadata: Record<string, unknown> = {};
    for (let i = 1; i <= RESCUE_MAX_RETRY_ATTEMPTS; i++) {
      metadata = buildCandidateRescuePatch({
        metadata, result: unreachable, decision: { kind: 'unchanged', why: 'not_classified' }, minEmployees: 200, decidedAt: AT,
      })!.metadata;
      assert.equal(retryAttemptsOf(metadata), i);
      const pending = rescueStillPending(metadata.claude_rescue, NOW, metadata.claude_classification, retryAttemptsOf(metadata));
      assert.equal(pending, i < RESCUE_MAX_RETRY_ATTEMPTS, `intento ${i}`);
    }
  });

  it('las descartadas también cuentan sus intentos', () => {
    const once = buildDispositionStaysEvidence({}, unreachable, { kind: 'unchanged', why: 'not_classified' }, AT);
    const twice = buildDispositionStaysEvidence(once, unreachable, { kind: 'unchanged', why: 'not_classified' }, AT);
    assert.equal(twice[RESCUE_RETRY_ATTEMPTS_KEY], 2);
  });

  it('sin contador (filas viejas) sigue reintentando como antes', () => {
    assert.equal(rescueStillPending({ decision: 'retryable' }, NOW), true);
  });
});

function fakeDeps(spentBefore: number | null) {
  const classified: string[] = [];
  const candidates = ['c1', 'c2'].map(
    (id) =>
      ({
        id, industry_id: 'tec', industry: 'Tecnología', name: id, website: `${id}.com`, domain: `${id}.com`,
        country_code: 'CO', country: 'Colombia', status: 'needs_review',
        metadata: { target_completeness: { failed_conditions: ['employee_count_status'] } },
      }) as ClassifiableCandidateRow,
  );
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: 'm', apiKey: 'k' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'tec', industryName: 'Tecnología', industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => candidates,
    loadDispositions: async () => [],
    loadBatchIndustryId: async () => 'tec',
    loadBatchRescueSpentUsd: async () => spentBefore,
    classify: async (company: { candidateId: string }) => {
      classified.push(company.candidateId);
      return {
        ...unreachable,
        candidateId: company.candidateId,
        outcome: 'nothing_verifiable',
        usage: { estimatedCostUsd: 2 } as never,
      } as CompanyClassificationResult;
    },
    logUsage: async () => true,
    patchCandidate: async (_id: string, build: (metadata: Record<string, unknown>) => unknown) =>
      build({ target_completeness: { failed_conditions: ['employee_count_status'] } }) !== null,
    patchDispositionEvidence: async () => true,
    admitDisposition: async (id: string) => `new-${id}`,
    claimIdentities: async () => undefined,
    nowIso: () => AT,
    nowMs: () => NOW,
  } as unknown as RescueBatchDeps;
  return { deps, classified };
}

describe('tope de gasto acumulado por lote', () => {
  it('con el tope ya gastado en corridas anteriores no empieza ninguna empresa', async () => {
    const f = fakeDeps(RESCUE_BATCH_MAX_COST_USD);
    const summary = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: null }, f.deps);
    assert.equal(f.classified.length, 0);
    assert.equal(summary.ok && summary.batchBudgetReached, true);
    assert.deepEqual(
      decideRescueContinuation({ summary, continuationsDone: 0, spentUsd: 0 }),
      { continue: false, reason: 'cost_cap' },
    );
  });

  it('sin lectura del gasto (null) sigue como antes', async () => {
    const f = fakeDeps(null);
    const summary = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: null }, f.deps);
    assert.equal(f.classified.length, 2);
    assert.equal(summary.ok && summary.batchBudgetReached, undefined);
  });

  it('readBatchRescueSpentUsd suma el uso del rescate del lote (sólo SELECT)', async () => {
    const filters: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) {
      builder[m] = (...args: unknown[]) => {
        filters.push([m, args]);
        return builder;
      };
    }
    builder.limit = async () => ({ data: [{ estimated_cost_usd: 1.25 }, { estimated_cost_usd: '0.5' }, { estimated_cost_usd: null }], error: null });
    const client = { from: (table: string) => (filters.push(['from', [table]]), builder) };
    assert.equal(await readBatchRescueSpentUsd(client as never, 'b1'), 1.75);
    assert.ok(filters.some(([m, a]) => m === 'eq' && a[0] === 'metadata->>flow' && a[1] === 'claude_rescue'));
    assert.deepEqual(filters[0], ['from', ['provider_usage_logs']]);
  });
});
