/**
 * AGENT1-TAVILY-V2-1 § 5b — el costo de Claude entra en la ficha por corrida.
 *
 * Sin él, comparar a Tavily con Apollo y Lusha sale sesgado a favor de Tavily:
 * sus empresas llegan sin sector ni tamaño y se completan con el clasificador de
 * Claude (~US$0,035 por empresa, ~US$0,90 por corrida de 25), que no aparece en
 * ningún crédito de proveedor. Datos reales (30-09): provider_key = 'anthropic',
 * operation_key = 'company_classification', con `batch_id` y `estimated_cost_usd`;
 * 23 filas de error con costo 0 y 9 buenas con US$0,3156.
 *
 * Reglas:
 *   · se suma por LOTE, a la fila estándar de ese lote, sea cual sea el proveedor
 *     (la misma vara para todos);
 *   · `costUsd` NO cambia (sigue siendo sólo el proveedor): el costo de Claude va
 *     aparte y el total, al lado;
 *   · la pierna Lusha de una cascada no lo recibe (comparte lote con Apollo: sería
 *     contarlo dos veces) y la fila de Apollo de una cascada lo declara compartido;
 *   · un costo que no se puede leer no se convierte en cero.
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

function tavilyBatch(id: string, accepted: number): ScorecardBatchInput {
  return {
    id,
    createdAt: '2026-10-01T15:00:00.000Z',
    countryCode: 'PE',
    industry: 'Retail',
    metadata: {
      web_search_provider: 'tavily',
      incremental_search: { total_raw_evaluated: 40, total_candidates_accumulated: 25 },
      accepted_for_target: {
        accepted_paid_for_target: accepted,
        accepted_count_kind: 'exact',
        paid_acceptance_measured: true,
      },
    },
  };
}

function log(
  id: string,
  providerKey: string,
  operationKey: string,
  batchId: string | null,
  extra: Partial<ScorecardUsageLogInput> = {},
): ScorecardUsageLogInput {
  return {
    id,
    createdAt: '2026-10-01T15:01:00.000Z',
    providerKey,
    operationKey,
    batchId,
    creditsUsed: null,
    metadata: {},
    ...extra,
  };
}

const persisted = (batchId: string, n: number): ScorecardOutcomeCount[] => [
  { batchId, sourcePrimary: 'web_ai', kind: 'candidate', disposition: null, count: n },
];

describe('§ 1 — Tavily + Claude: dos costos, un total', () => {
  const rows = buildProviderRunScorecard({
    batches: [tavilyBatch('t1', 10)],
    usageLogs: [
      log('a', 'tavily', 'multi_query_web_search', 't1', { creditsUsed: 16 }),
      log('b', 'anthropic', 'company_classification', 't1', { estimatedCostUsd: 0.35 }),
      log('c', 'anthropic', 'company_classification', 't1', { estimatedCostUsd: '0.35' }),
      log('d', 'anthropic', 'company_classification', 't1', { estimatedCostUsd: 0 }), // error: costó 0
      log('e', 'anthropic', 'company_classification', 'otro', { estimatedCostUsd: 9 }), // otro lote
    ],
    outcomeCounts: persisted('t1', 10),
    prices: PRICES,
  });

  test('costUsd sigue siendo sólo el de Tavily', () => {
    assert.ok(Math.abs((rows[0].costUsd ?? 0) - 0.128) < 1e-9);
  });

  test('el costo de Claude es la suma de los logs del lote (texto numérico incluido)', () => {
    assert.ok(Math.abs((rows[0].claudeCostUsd ?? 0) - 0.7) < 1e-9);
  });

  test('el total y el costo total por aceptada incluyen a Claude', () => {
    assert.ok(Math.abs((rows[0].totalCostUsd ?? 0) - 0.828) < 1e-9);
    assert.ok(Math.abs((rows[0].totalCostPerAccepted ?? 0) - 0.0828) < 1e-9);
  });

  test('costPerAccepted (sólo proveedor) no cambia', () => {
    assert.ok(Math.abs((rows[0].costPerAccepted ?? 0) - 0.0128) < 1e-9);
  });
});

describe('§ 2 — la misma vara para todos los proveedores', () => {
  test('un lote Apollo standalone con Claude también lo suma', () => {
    const batch: ScorecardBatchInput = {
      id: 'a1',
      createdAt: '2026-10-01T15:00:00.000Z',
      countryCode: 'CO',
      industry: 'Retail',
      metadata: {
        provider_attempts: [{ role: 'primary', provider: 'apollo' }],
        apollo_run_budget: { ledger: { entries: [{ operationKey: 'organizations_search', state: 'settled', settledCredits: 4 }] } },
        accepted_for_target: { accepted_paid_for_target: 2, accepted_count_kind: 'exact', paid_acceptance_measured: true },
      },
    };
    const [row] = buildProviderRunScorecard({
      batches: [batch],
      usageLogs: [log('x', 'anthropic', 'company_classification', 'a1', { estimatedCostUsd: 0.1 })],
      outcomeCounts: [{ batchId: 'a1', sourcePrimary: 'apollo', kind: 'candidate', disposition: null, count: 3 }],
      prices: PRICES,
    });
    assert.equal(row.provider, 'apollo');
    assert.ok(Math.abs((row.claudeCostUsd ?? 0) - 0.1) < 1e-9);
    assert.ok(Math.abs((row.totalCostUsd ?? 0) - (4 * 0.00867168 + 0.1)) < 1e-9);
  });

  test('Apollo en cascada: el lote es compartido, se declara y la pierna Lusha no lo duplica', () => {
    const batch: ScorecardBatchInput = {
      id: 'c1',
      createdAt: '2026-10-01T15:00:00.000Z',
      countryCode: 'CO',
      industry: 'Retail',
      metadata: {
        provider_attempts: [{ role: 'primary', provider: 'apollo' }],
        apollo_run_budget: { ledger: { entries: [{ operationKey: 'organizations_search', state: 'settled', settledCredits: 4 }] } },
        lusha_waterfall_leg: { executed: true, clientRequestId: 'req-1' },
        accepted_for_target: { accepted_paid_for_target: 3, accepted_count_kind: 'exact', paid_acceptance_measured: true },
      },
    };
    const rows = buildProviderRunScorecard({
      batches: [batch],
      usageLogs: [
        log('x', 'anthropic', 'company_classification', 'c1', { estimatedCostUsd: 0.2 }),
        log('y', 'lusha', 'company_prospecting_v3', null, {
          creditsUsed: 2,
          metadata: { run_correlation: { client_request_id: 'req-1' } },
        }),
      ],
      outcomeCounts: [],
      prices: PRICES,
    });
    const apollo = rows.find((r) => r.provider === 'apollo')!;
    const leg = rows.find((r) => r.provider === 'lusha')!;
    assert.ok(Math.abs((apollo.claudeCostUsd ?? 0) - 0.2) < 1e-9);
    assert.ok(apollo.gaps.includes('claude_cost_shared_batch'));
    assert.equal(leg.role, 'waterfall_leg');
    assert.equal(leg.claudeCostUsd, null, 'la pierna no recibe el costo del lote compartido');
  });
});

describe('§ 3 — lo que no se sabe no se inventa', () => {
  test('sin logs de Claude en el lote: claudeCostUsd null y el total es el del proveedor', () => {
    const [row] = buildProviderRunScorecard({
      batches: [tavilyBatch('t2', 4)],
      usageLogs: [log('a', 'tavily', 'multi_query_web_search', 't2', { creditsUsed: 16 })],
      outcomeCounts: persisted('t2', 6),
      prices: PRICES,
    });
    assert.equal(row.claudeCostUsd, null);
    assert.ok(Math.abs((row.totalCostUsd ?? 0) - 0.128) < 1e-9);
    assert.ok(!row.gaps.includes('claude_cost_incomplete'));
  });

  test('un costo de Claude ilegible ⇒ null y se declara incompleto (nunca un total parcial)', () => {
    const [row] = buildProviderRunScorecard({
      batches: [tavilyBatch('t3', 4)],
      usageLogs: [
        log('a', 'tavily', 'multi_query_web_search', 't3', { creditsUsed: 16 }),
        log('b', 'anthropic', 'company_classification', 't3', { estimatedCostUsd: 0.3 }),
        log('c', 'anthropic', 'company_classification', 't3', { estimatedCostUsd: null }),
      ],
      outcomeCounts: persisted('t3', 6),
      prices: PRICES,
    });
    assert.equal(row.claudeCostUsd, null);
    assert.ok(row.gaps.includes('claude_cost_incomplete'));
  });

  test('sin precio del proveedor, el total tampoco se inventa', () => {
    const [row] = buildProviderRunScorecard({
      batches: [tavilyBatch('t4', 4)],
      usageLogs: [
        log('a', 'tavily', 'multi_query_web_search', 't4', { creditsUsed: 16 }),
        log('b', 'anthropic', 'company_classification', 't4', { estimatedCostUsd: 0.3 }),
      ],
      outcomeCounts: persisted('t4', 6),
      prices: PRICES.filter((p) => p.providerKey !== 'tavily'),
    });
    assert.equal(row.totalCostUsd, null);
    assert.equal(row.totalCostPerAccepted, null);
  });

  test('los logs de Claude no crean filas ni cuentan como corrida de ningún proveedor', () => {
    const rows = buildProviderRunScorecard({
      batches: [],
      usageLogs: [log('b', 'anthropic', 'company_classification', 'sin-lote', { estimatedCostUsd: 0.3 })],
      outcomeCounts: [],
      prices: PRICES,
    });
    assert.equal(rows.length, 0);
  });
});

describe('§ 4 — el resumen suma el costo total por proveedor', () => {
  test('Tavily: costo de proveedor, de Claude y total por aceptada', () => {
    const summary = summarizeProviderRunScorecard(
      buildProviderRunScorecard({
        batches: [tavilyBatch('t1', 4), tavilyBatch('t2', 2)],
        usageLogs: [
          log('a', 'tavily', 'multi_query_web_search', 't1', { creditsUsed: 16 }),
          log('b', 'tavily', 'multi_query_web_search', 't2', { creditsUsed: 16 }),
          log('c', 'anthropic', 'company_classification', 't1', { estimatedCostUsd: 0.5 }),
          log('d', 'anthropic', 'company_classification', 't2', { estimatedCostUsd: 0.4 }),
        ],
        outcomeCounts: [...persisted('t1', 8), ...persisted('t2', 5)],
        prices: PRICES,
      }),
    );
    const t = summary.byProvider.tavily;
    assert.ok(Math.abs((t.claudeCostUsd ?? 0) - 0.9) < 1e-9);
    assert.ok(Math.abs((t.totalCostUsd ?? 0) - (0.256 + 0.9)) < 1e-9);
    assert.ok(Math.abs((t.totalCostPerAccepted ?? 0) - (0.256 + 0.9) / 6) < 1e-9);
    assert.ok(Math.abs((t.costPerAccepted ?? 0) - 0.256 / 6) < 1e-9);
  });
});
