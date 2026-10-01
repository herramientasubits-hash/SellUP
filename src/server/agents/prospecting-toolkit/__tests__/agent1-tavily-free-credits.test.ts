/**
 * AGENT1-TAVILY-FREE-CREDITS-1 — Tavily vive de los 1.000 créditos gratis del mes.
 *
 * Decisión de la dueña (01-10): no se compran más créditos de Tavily. Medición
 * Prod 30-09/01-10: 21 créditos por corrida (16 búsquedas de 5 resultados + 5
 * de LinkedIn que encontraron 2 en 28 créditos) ⇒ ~47 corridas al mes.
 * Sin Supabase real. Sin Tavily. Sin LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAVILY_DEFAULT_MONTHLY_CREDIT_CAP,
  evaluateTavilyMonthlyCredits,
  readTavilyCreditsUsedThisMonth,
  resolveTavilyMonthlyCreditCap,
  startOfUtcMonthIso,
} from '../tavily-monthly-credits';
import {
  TAVILY_PLAN_MAX_ROUNDS,
  TAVILY_QUERIES_PER_ROUND,
  TAVILY_RESULTS_PER_QUERY,
  buildTavilyMacroQueryPlan,
  resolveTavilyCountryTerms,
} from '../tavily-query-plan';
import { resolveTavilyCountryRegions } from '../tavily-country-regions';
import type { SupabaseClient } from '@supabase/supabase-js';

const NOW = Date.parse('2026-10-15T12:00:00Z');

describe('créditos por corrida', () => {
  it('una corrida paga como mucho 8 búsquedas de 20 resultados (antes 16 de 5)', () => {
    assert.equal(TAVILY_RESULTS_PER_QUERY, 20);
    assert.equal(TAVILY_QUERIES_PER_ROUND * TAVILY_PLAN_MAX_ROUNDS, 8);
  });

  it('el plan respeta 2 búsquedas por ronda', () => {
    const plan = buildTavilyMacroQueryPlan({
      industry: 'Gobierno', country: 'Colombia', countryCode: 'CO', seedKey: 'b1',
      additionalCriteria: null, history: new Map(), nowMs: NOW,
    })!;
    assert.ok(plan.rounds.every((round) => round.length <= 2));
    assert.ok(plan.rounds.flat().length <= 8);
  });
});

describe('tope mensual de créditos gratis', () => {
  it('por defecto 1.000; respeta un valor válido del entorno', () => {
    assert.equal(resolveTavilyMonthlyCreditCap(undefined), TAVILY_DEFAULT_MONTHLY_CREDIT_CAP);
    assert.equal(TAVILY_DEFAULT_MONTHLY_CREDIT_CAP, 1000);
    assert.equal(resolveTavilyMonthlyCreditCap('4000'), 4000);
    assert.equal(resolveTavilyMonthlyCreditCap('abc'), 1000);
    assert.equal(resolveTavilyMonthlyCreditCap('-5'), 1000);
  });

  it('alcanza para la corrida ⇒ available', () => {
    assert.deepEqual(evaluateTavilyMonthlyCredits({ usedCredits: 500, cap: 1000, runMaxCredits: 20 }), {
      status: 'available', usedCredits: 500, cap: 1000, remaining: 500,
    });
  });

  it('no alcanza para el peor caso de la corrida ⇒ exhausted (no se empieza a pagar)', () => {
    const verdict = evaluateTavilyMonthlyCredits({ usedCredits: 985, cap: 1000, runMaxCredits: 20 });
    assert.equal(verdict.status, 'exhausted');
    assert.equal(verdict.remaining, 15);
  });

  it('pagina más allá de las 1.000 filas de PostgREST', async () => {
    const all = Array.from({ length: 2500 }, () => ({ credits_used: 1 }));
    const supabase = {
      from() {
        let from = 0;
        const chain = {
          select() { return chain; }, eq() { return chain; }, gte() { return chain; }, order() { return chain; },
          range(f: number, to: number) { from = f; void to; return chain; },
          then(resolve: (r: { data: unknown[]; error: null }) => void) { resolve({ data: all.slice(from, from + 1000), error: null }); },
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    assert.equal(await readTavilyCreditsUsedThisMonth(supabase, NOW), 2500);
  });

  it('el mes empieza el día 1 en UTC', () => {
    assert.equal(startOfUtcMonthIso(NOW), '2026-10-01T00:00:00.000Z');
  });

  it('suma sólo créditos de Tavily del mes en curso (doble de Supabase, sólo lectura)', async () => {
    const filters: Array<[string, string, unknown]> = [];
    const rows = [{ credits_used: 7 }, { credits_used: 14 }, { credits_used: null }];
    const supabase = {
      from(table: string) {
        assert.equal(table, 'provider_usage_logs');
        const chain = {
          select() { return chain; },
          eq(col: string, v: unknown) { filters.push(['eq', col, v]); return chain; },
          gte(col: string, v: unknown) { filters.push(['gte', col, v]); return chain; },
          order() { return chain; },
          range(from: number) { filters.push(['range', 'from', from]); return chain; },
          then(resolve: (r: { data: unknown[]; error: null }) => void) { resolve({ data: rows, error: null }); },
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    assert.equal(await readTavilyCreditsUsedThisMonth(supabase, NOW), 21);
    assert.deepEqual(filters, [
      ['eq', 'provider_key', 'tavily'],
      ['gte', 'created_at', '2026-10-01T00:00:00.000Z'],
      ['range', 'from', 0],
    ]);
  });
});

describe('vocabulario por país (Gobierno y Salud se dicen distinto)', () => {
  it('fuera de Colombia no se busca con términos sólo colombianos', () => {
    const gov = ['gobernacion', 'alcaldia', 'ministerio', 'empresa industrial y comercial del estado'];
    const health = ['clinica', 'ips salud', 'entidad promotora de salud'];
    for (const code of ['CL', 'MX', 'PE', 'AR']) {
      const g = resolveTavilyCountryTerms({ macroKey: 'government', countryCode: code, terms: gov });
      for (const coOnly of ['gobernacion', 'alcaldia', 'empresa industrial y comercial del estado']) {
        assert.equal(g.includes(coOnly), false, `${code}: ${coOnly}`);
      }
      assert.ok(g.includes('ministerio'), `${code}: ministerio se conserva`);
      const h = resolveTavilyCountryTerms({ macroKey: 'health_pharma', countryCode: code, terms: health });
      assert.equal(h.includes('ips salud'), false, code);
      assert.equal(h.includes('entidad promotora de salud'), false, code);
      assert.ok(h.includes('clinica'));
    }
  });

  it('donde un término colombiano también se usa, se conserva', () => {
    const g = resolveTavilyCountryTerms({ macroKey: 'government', countryCode: 'PY', terms: ['gobernacion', 'alcaldia'] });
    assert.ok(g.includes('gobernacion'));
    assert.equal(g.includes('alcaldia'), false);
  });

  it('agrega los términos locales', () => {
    const cl = buildTavilyMacroQueryPlan({ industry: 'Gobierno', country: 'Chile', countryCode: 'CL', seedKey: 'b', additionalCriteria: null, history: new Map(), nowMs: NOW })!;
    assert.ok(cl.allCellKeys.some((k) => k.startsWith('municipalidad ')), 'Chile: municipalidad');
    assert.ok(cl.allCellKeys.some((k) => k.startsWith('gobierno regional ')), 'Chile: gobierno regional');
    const mx = buildTavilyMacroQueryPlan({ industry: 'Gobierno', country: 'México', countryCode: 'MX', seedKey: 'b', additionalCriteria: null, history: new Map(), nowMs: NOW })!;
    assert.ok(mx.allCellKeys.some((k) => k.startsWith('ayuntamiento ')), 'México: ayuntamiento');
    const clSalud = buildTavilyMacroQueryPlan({ industry: 'Salud & Farmacéuticos', country: 'Chile', countryCode: 'CL', seedKey: 'b', additionalCriteria: null, history: new Map(), nowMs: NOW })!;
    assert.ok(clSalud.allCellKeys.some((k) => k.includes('isapre')), 'Chile: isapre');
    assert.equal(clSalud.allCellKeys.some((k) => k.includes('ips salud')), false);
  });

  it('Colombia conserva su vocabulario', () => {
    const co = buildTavilyMacroQueryPlan({ industry: 'Gobierno', country: 'Colombia', countryCode: 'CO', seedKey: 'b', additionalCriteria: null, history: new Map(), nowMs: NOW })!;
    assert.ok(co.allCellKeys.some((k) => k.startsWith('gobernacion ')));
    assert.ok(co.allCellKeys.some((k) => k.startsWith('empresa industrial y comercial del estado ')));
  });
});

describe('regiones grandes primero', () => {
  it('las búsquedas regionales empiezan por el primer tercio de regiones (las principales)', () => {
    const base = { industry: 'Gobierno', country: 'Colombia', countryCode: 'CO', additionalCriteria: null } as const;
    const top = resolveTavilyCountryRegions('CO').slice(0, Math.ceil(resolveTavilyCountryRegions('CO').length / 3));
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      // 1.ª corrida: nacionales; se marcan usadas ⇒ la 2.ª es regional.
      const first = buildTavilyMacroQueryPlan({ ...base, seedKey: seed, history: new Map(), nowMs: NOW })!;
      const used = new Map(first.cellsUsed.map((c) => [c.key, { lastUsedAtMs: NOW, timesUsed: 1, persistedCount: 1 }]));
      const second = buildTavilyMacroQueryPlan({ ...base, seedKey: `${seed}2`, history: used, nowMs: NOW })!;
      const regional = second.cellsUsed.filter((c) => c.region !== null);
      assert.ok(regional.length > 0);
      for (const cell of regional) assert.ok(top.includes(cell.region!), `${seed}: ${cell.region}`);
    }
  });
});

// ─── Topes de resultados: sólo Tavily sube ────────────────────────────────────

import { runMultiQueryWebSearch } from '../web-search-tool';
import type { TavilyUsageDeps, UsageLogResult } from '../tavily-usage-logging';
import type { WebSearchInput, WebSearchOutput } from '../types';

function manyResultsDispatcher(seen: number[]) {
  let call = 0;
  return async (_p: string, q: WebSearchInput): Promise<WebSearchOutput> => {
    call++;
    seen.push(q.maxResults ?? -1);
    const results = Array.from({ length: q.maxResults ?? 5 }, (_, i) => ({
      title: `Entidad ${call}-${i}`, url: `https://entidad-${call}-${i}.gov.co`, snippet: 'Entidad pública de Colombia',
      source: 'tavily', rank: i + 1, provider: 'tavily' as const, confidence: null, metadata: {},
    }));
    return { provider: 'tavily', query: q.query, results, resultsCount: results.length, skipped: false, estimatedCostUsd: null, metadata: {} };
  };
}

describe('runMultiQueryWebSearch — 20 resultados por búsqueda sólo en Tavily', () => {
  it('Tavily pide 20 por consulta y la ronda conserva más de 20', async () => {
    const seen: number[] = [];
    const deps: TavilyUsageDeps = {
      loadPricing: async () => ({ unitCostUsd: 0.008, unit: 'per_credit' }),
      logUsage: async (): Promise<UsageLogResult> => ({ kind: 'logged' }),
      dispatchQuery: manyResultsDispatcher(seen) as unknown as TavilyUsageDeps['dispatchQuery'],
    };
    const out = await runMultiQueryWebSearch({
      country: 'Colombia', countryCode: 'CO', industry: 'Gobierno', provider: 'tavily',
      queries: ['alcaldia Antioquia Colombia', 'gobernacion Tolima Colombia'],
      maxResultsPerQuery: 20, targetCount: 25,
      usageContext: { batchId: '22222222-2222-2222-2222-222222222222', triggeredByUserId: 'u1', roundNumber: 1 },
    }, deps);
    assert.deepEqual(seen, [20, 20]);
    assert.ok(out.results.length > 20, `la ronda conserva ${out.results.length}`);
    assert.ok(out.results.length <= 25);
  });
});
