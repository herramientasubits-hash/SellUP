/**
 * AGENT1-TAVILY-V2-1 § 5 — la ficha por corrida mide también a Tavily, con la
 * misma vara que Apollo y Lusha (USD por empresa aceptada, desde
 * `accepted_for_target`).
 *
 * Datos reales de Producción (2026-09-29) que fijan la forma:
 *   · un lote Tavily se reconoce por `metadata.web_search_provider = 'tavily'`
 *     (no tiene `provider_attempts`);
 *   · sus candidatos se guardan con `source_primary = 'web_ai'`; un descarte
 *     puede registrarse como `web_ai` o `tavily` (CHECK de la migración 138);
 *   · su gasto vive en `provider_usage_logs` (`provider_key = 'tavily'`,
 *     `multi_query_web_search` + `linkedin_company_search`), con `batch_id`;
 *   · `incremental_search` publica `total_raw_evaluated` y
 *     `total_candidates_accumulated`;
 *   · los 31 lotes Tavily de junio/julio NO publican `accepted_for_target`: la
 *     ficha lo declara como hueco, no lo rellena con cero.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderRunScorecard,
  summarizeProviderRunScorecard,
  type ScorecardBatchInput,
  type ScorecardOutcomeCount,
  type ScorecardPrice,
  type ScorecardUsageLogInput,
} from '../provider-run-scorecard';

const PRICES: readonly ScorecardPrice[] = [
  { providerKey: 'apollo', unitCostUsd: 0.00867168, source: 'provider_pricing_config' },
  { providerKey: 'lusha', unitCostUsd: 0.06821193, source: 'provider_pricing_config' },
  { providerKey: 'tavily', unitCostUsd: 0.008, source: 'provider_pricing_config' },
];

function tavilyBatch(id: string, opts: { accepted?: number; raw?: number; unique?: number } = {}): ScorecardBatchInput {
  return {
    id,
    createdAt: '2026-10-01T15:00:00.000Z',
    countryCode: 'PE',
    industry: 'Retail',
    metadata: {
      web_search_provider: 'tavily',
      incremental_search: { total_raw_evaluated: opts.raw ?? 37, total_candidates_accumulated: opts.unique ?? 29 },
      ...(opts.accepted !== undefined
        ? {
            accepted_for_target: {
              accepted_paid_for_target: opts.accepted,
              accepted_count_kind: 'exact',
              paid_acceptance_measured: true,
            },
          }
        : {}),
    },
  };
}

function tavilyLog(
  id: string,
  batchId: string | null,
  operationKey: string,
  credits: number,
  metadata: Record<string, unknown> = {},
): ScorecardUsageLogInput {
  return {
    id,
    createdAt: '2026-10-01T15:01:00.000Z',
    providerKey: 'tavily',
    operationKey,
    batchId,
    creditsUsed: credits,
    metadata,
  };
}

function outcomes(batchId: string, persisted: number, discarded: Array<[string, string, number]>): ScorecardOutcomeCount[] {
  return [
    { batchId, sourcePrimary: 'web_ai', kind: 'candidate', disposition: null, count: persisted },
    ...discarded.map(([sourcePrimary, disposition, count]) => ({
      batchId, sourcePrimary, kind: 'discard' as const, disposition, count,
    })),
  ];
}

describe('§ 1 — una corrida Tavily standalone', () => {
  const rows = buildProviderRunScorecard({
    batches: [tavilyBatch('t1', { accepted: 4, unique: 29 })],
    usageLogs: [
      tavilyLog('l1', 't1', 'multi_query_web_search', 4),
      tavilyLog('l2', 't1', 'multi_query_web_search', 4),
      tavilyLog('l3', 't1', 'multi_query_web_search', 4),
      tavilyLog('l4', 't1', 'multi_query_web_search', 4),
      tavilyLog('l5', 't1', 'linkedin_company_search', 5),
      // otro lote: no se suma
      tavilyLog('l6', 'otro', 'multi_query_web_search', 4),
    ],
    outcomeCounts: outcomes('t1', 9, [['web_ai', 'country_rejected', 12], ['tavily', 'sellup_duplicate', 8]]),
    prices: PRICES,
  });

  test('produce UNA fila de Tavily', () => {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'tavily');
    assert.equal(rows[0].role, 'standalone');
    assert.equal(rows[0].runKey, 'batch:t1:tavily');
  });

  test('créditos = búsqueda + LinkedIn del lote (21), costo al precio de Tavily', () => {
    assert.equal(rows[0].credits, 21);
    assert.equal(rows[0].creditsSource, 'tavily_usage_logs');
    assert.ok(Math.abs((rows[0].costUsd ?? 0) - 0.168) < 1e-9);
  });

  test('persistidas = candidatos web_ai; descartes = web_ai + tavily', () => {
    assert.equal(rows[0].persisted, 9);
    assert.equal(rows[0].discarded, 20);
    assert.deepEqual(rows[0].discardsByDisposition, { country_rejected: 12, sellup_duplicate: 8 });
  });

  test('aceptación desde accepted_for_target y costo por aceptada', () => {
    assert.equal(rows[0].acceptedForTarget, 4);
    assert.equal(rows[0].acceptanceSource, 'batch_accepted_for_target');
    assert.ok(Math.abs((rows[0].costPerAccepted ?? 0) - 0.042) < 1e-9);
  });

  test('resultados crudos y únicos desde incremental_search; cuadre de destinos', () => {
    assert.equal(rows[0].rawResults, 37);
    assert.equal(rows[0].uniqueResults, 29);
    assert.equal(rows[0].unaccountedCompanies, 0);
  });

  test('declara que Tavily no mide lo que el proveedor ya había visto', () => {
    assert.ok(rows[0].gaps.includes('provider_seen_not_measured'));
    assert.equal(rows[0].alreadySeenByProvider, null);
  });
});

describe('§ 2 — lo que falta se declara', () => {
  test('lote viejo sin accepted_for_target ⇒ hueco, nunca cero', () => {
    const [row] = buildProviderRunScorecard({
      batches: [tavilyBatch('t2')],
      usageLogs: [tavilyLog('l1', 't2', 'multi_query_web_search', 16)],
      outcomeCounts: outcomes('t2', 6, []),
      prices: PRICES,
    });
    assert.equal(row.acceptedForTarget, null);
    assert.ok(row.gaps.includes('accepted_for_target_missing'));
    assert.equal(row.costPerAccepted, null);
  });

  test('sin logs de uso ⇒ créditos null (no cero)', () => {
    const [row] = buildProviderRunScorecard({
      batches: [tavilyBatch('t3', { accepted: 1 })],
      usageLogs: [],
      outcomeCounts: outcomes('t3', 1, []),
      prices: PRICES,
    });
    assert.equal(row.credits, null);
    assert.equal(row.creditsSource, null);
    assert.equal(row.costUsd, null);
  });

  test('Tavily informó cobrar distinto de lo calculado ⇒ hueco de desvío', () => {
    const [row] = buildProviderRunScorecard({
      batches: [tavilyBatch('t4', { accepted: 1 })],
      usageLogs: [tavilyLog('l1', 't4', 'multi_query_web_search', 4, { provider_reported_credits_mismatch: true })],
      outcomeCounts: outcomes('t4', 1, []),
      prices: PRICES,
    });
    assert.ok(row.gaps.includes('credits_mismatch_provider_reported'));
  });

  test('sin precio de Tavily ⇒ price_missing', () => {
    const [row] = buildProviderRunScorecard({
      batches: [tavilyBatch('t5', { accepted: 1 })],
      usageLogs: [tavilyLog('l1', 't5', 'multi_query_web_search', 4)],
      outcomeCounts: outcomes('t5', 1, []),
      prices: PRICES.filter((p) => p.providerKey !== 'tavily'),
    });
    assert.ok(row.gaps.includes('price_missing'));
  });

  test('una operación de Tavily ajena al descubrimiento no se suma', () => {
    const [row] = buildProviderRunScorecard({
      batches: [tavilyBatch('t6', { accepted: 1 })],
      usageLogs: [
        tavilyLog('l1', 't6', 'multi_query_web_search', 4),
        tavilyLog('l2', 't6', 'rich_profile_enrichment', 3),
      ],
      outcomeCounts: outcomes('t6', 1, []),
      prices: PRICES,
    });
    assert.equal(row.credits, 4);
  });
});

describe('§ 3 — convive con Apollo y Lusha', () => {
  test('un lote mock (web_search_provider=mock) no es una corrida Tavily', () => {
    const rows = buildProviderRunScorecard({
      batches: [{ ...tavilyBatch('m1'), metadata: { web_search_provider: 'mock' } }],
      usageLogs: [],
      outcomeCounts: [],
      prices: PRICES,
    });
    assert.equal(rows.length, 0);
  });

  test('el resumen tiene una columna tavily con sus totales', () => {
    const summary = summarizeProviderRunScorecard(
      buildProviderRunScorecard({
        batches: [tavilyBatch('t1', { accepted: 4 }), tavilyBatch('t2', { accepted: 2 })],
        usageLogs: [
          tavilyLog('l1', 't1', 'multi_query_web_search', 16),
          tavilyLog('l2', 't2', 'multi_query_web_search', 16),
        ],
        outcomeCounts: [...outcomes('t1', 9, []), ...outcomes('t2', 5, [])],
        prices: PRICES,
      }),
    );
    const t = summary.byProvider.tavily;
    assert.equal(t.runs, 2);
    assert.equal(t.credits, 32);
    assert.equal(t.acceptedForTarget, 6);
    assert.ok(Math.abs((t.costPerAccepted ?? 0) - (32 * 0.008) / 6) < 1e-9);
    assert.equal(summary.byProvider.apollo.runs, 0);
    assert.equal(summary.byProvider.lusha.runs, 0);
  });
});
