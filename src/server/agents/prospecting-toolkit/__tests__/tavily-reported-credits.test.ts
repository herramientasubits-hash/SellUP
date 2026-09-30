/**
 * AGENT1-TAVILY-V2-1 § 3 — créditos que Tavily DICE que cobró.
 *
 * Hoy `credits_used` se CALCULA (consultas exitosas × créditos por profundidad).
 * Con `include_usage: true`, Tavily devuelve `usage.credits` en cada respuesta.
 * Aquí se guarda al lado del cálculo, sólo como dato: `credits_used` no cambia
 * (tocar lo que se confirma contra el presupuesto exige autorización aparte).
 * Así la evaluación contra Apollo y Lusha puede usar el costo real y detectar
 * si nuestro cálculo se desvía.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runMultiQueryWebSearch } from '../web-search-tool';
import { buildTavilySearchRequestBody, readTavilyReportedCredits } from '../web-search-providers/tavily-web-search-provider';
import type { TavilyUsageDeps, UsageLogResult } from '../tavily-usage-logging';
import type { MultiQuerySearchInput, WebSearchInput, WebSearchOutput } from '../types';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

const BATCH_ID = '11111111-1111-1111-1111-111111111111';

function input(): MultiQuerySearchInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail',
    provider: 'tavily',
    queries: ['q1', 'q2', 'q3'],
    maxResultsPerQuery: 5,
    usageContext: { batchId: BATCH_ID, triggeredByUserId: 'u1', roundNumber: 1 },
  };
}

function dispatcherReporting(credits: Array<number | null>) {
  let i = 0;
  return async (_p: string, q: WebSearchInput): Promise<WebSearchOutput> => {
    const reported = credits[i++] ?? null;
    return {
      provider: 'tavily',
      query: q.query,
      results: [{ title: 'A', url: `https://empresa-${i}.com`, snippet: null, source: 'tavily', rank: 1, provider: 'tavily', confidence: null, metadata: {} }],
      resultsCount: 1,
      skipped: false,
      estimatedCostUsd: null,
      metadata: { provider_reported_credits: reported },
    };
  };
}

async function logFor(credits: Array<number | null>): Promise<LogProviderUsageInput> {
  const calls: LogProviderUsageInput[] = [];
  const deps: TavilyUsageDeps = {
    loadPricing: async () => ({ unitCostUsd: 0.008, unit: 'per_credit' }),
    logUsage: async (row): Promise<UsageLogResult> => { calls.push(row); return { kind: 'logged' }; },
    dispatchQuery: dispatcherReporting(credits) as unknown as TavilyUsageDeps['dispatchQuery'],
  };
  await runMultiQueryWebSearch(input(), deps);
  assert.equal(calls.length, 1);
  return calls[0];
}

describe('readTavilyReportedCredits', () => {
  it('lee usage.credits cuando es un número no negativo', () => {
    assert.equal(readTavilyReportedCredits({ usage: { credits: 1 } }), 1);
    assert.equal(readTavilyReportedCredits({ usage: { credits: 0 } }), 0);
  });

  it('devuelve null cuando falta o no es válido', () => {
    assert.equal(readTavilyReportedCredits({}), null);
    assert.equal(readTavilyReportedCredits({ usage: {} }), null);
    assert.equal(readTavilyReportedCredits({ usage: { credits: '1' } }), null);
    assert.equal(readTavilyReportedCredits({ usage: { credits: -1 } }), null);
    assert.equal(readTavilyReportedCredits(null), null);
  });
});

describe('el cuerpo pide el uso real', () => {
  it('include_usage viaja siempre (no cuesta créditos)', () => {
    assert.equal(buildTavilySearchRequestBody({ query: 'q', countryCode: 'CO' }, 5).include_usage, true);
  });
});

describe('el registro de la ronda guarda lo reportado al lado del cálculo', () => {
  it('todas reportan y coinciden: total, sin desvío, credits_used intacto', async () => {
    const row = await logFor([1, 1, 1]);
    assert.equal(row.credits_used, 3);
    assert.equal(row.metadata?.provider_reported_credits_total, 3);
    assert.equal(row.metadata?.provider_reported_credits_queries, 3);
    assert.equal(row.metadata?.provider_reported_credits_mismatch, false);
  });

  it('Tavily cobra distinto de lo calculado: se marca el desvío, credits_used sigue siendo el cálculo', async () => {
    const row = await logFor([2, 1, 1]);
    assert.equal(row.credits_used, 3);
    assert.equal(row.metadata?.provider_reported_credits_total, 4);
    assert.equal(row.metadata?.provider_reported_credits_mismatch, true);
  });

  it('si alguna consulta no reporta, el total queda null (nunca un total parcial disfrazado)', async () => {
    const row = await logFor([1, null, 1]);
    assert.equal(row.metadata?.provider_reported_credits_total, null);
    assert.equal(row.metadata?.provider_reported_credits_queries, 2);
    assert.equal(row.metadata?.provider_reported_credits_mismatch, null);
  });
});
