/**
 * AGENT1-TAVILY-QUERY-SPACE-1 — el espacio de búsqueda de Tavily aguanta muchos
 * vendedores y mucho tiempo.
 *
 * Prod 30-09: la 2.ª corrida de CO×Gobierno (lote fb530d9b) repitió las mismas 7
 * búsquedas nacionales de la 1.ª y trajo 16 resultados casi todos ya vistos.
 * Sin Supabase. Sin Tavily. Sin LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAVILY_EMPTY_CELL_COOLDOWN_DAYS,
  TAVILY_PRODUCTIVE_CELL_COOLDOWN_DAYS,
  TAVILY_CELL_RETIRE_AFTER_EMPTY_RUNS,
  buildTavilyQueryHistory,
  classifyTavilyCell,
  normalizeTavilyQueryKey,
  selectTavilyQueryCells,
  type TavilyQueryCell,
  type TavilyQueryHistory,
} from '../tavily-query-space';
import { buildTavilyMacroQueryPlan } from '../tavily-query-plan';
import { resolveTavilyCountryRegions, TAVILY_COUNTRY_REGIONS } from '../tavily-country-regions';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-01T12:00:00Z');

function cells(terms: string[], regions: (string | null)[]): TavilyQueryCell[] {
  return terms.flatMap((term) =>
    regions.map((region) => {
      const query = region ? `${term} ${region} Colombia` : `${term} Colombia`;
      return { term, region, query, key: normalizeTavilyQueryKey(query) };
    }),
  );
}

function historyOf(entries: Array<[string, { daysAgo: number; timesUsed?: number; persisted?: number }]>): TavilyQueryHistory {
  return new Map(
    entries.map(([query, e]) => [
      normalizeTavilyQueryKey(query),
      { lastUsedAtMs: NOW - e.daysAgo * DAY, timesUsed: e.timesUsed ?? 1, persistedCount: e.persisted ?? 0 },
    ]),
  );
}

describe('regiones', () => {
  it('los 20 países de Tavily tienen regiones', () => {
    for (const code of ['CO', 'MX', 'AR', 'PE', 'CL', 'EC', 'UY', 'PY', 'BO', 'VE', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'DO', 'ES', 'BR', 'US']) {
      assert.ok(resolveTavilyCountryRegions(code).length >= 7, code);
    }
  });
  it('sin regiones duplicadas dentro de un país', () => {
    for (const [code, regions] of Object.entries(TAVILY_COUNTRY_REGIONS)) {
      assert.equal(new Set(regions).size, regions.length, code);
    }
  });
  it('país desconocido ⇒ sin regiones', () => {
    assert.deepEqual(resolveTavilyCountryRegions('ZZ'), []);
    assert.deepEqual(resolveTavilyCountryRegions(null), []);
  });
});

describe('normalizeTavilyQueryKey', () => {
  it('ignora mayúsculas, tildes y espacios', () => {
    assert.equal(normalizeTavilyQueryKey('  Alcaldía   Bogotá COLOMBIA '), 'alcaldia bogota colombia');
  });
});

describe('classifyTavilyCell', () => {
  it('nunca usada ⇒ fresh', () => assert.equal(classifyTavilyCell(undefined, NOW), 'fresh'));
  it('usada hace poco ⇒ cooling', () => {
    assert.equal(classifyTavilyCell({ lastUsedAtMs: NOW - 5 * DAY, timesUsed: 1, persistedCount: 3 }, NOW), 'cooling');
  });
  it('rindió y pasó su enfriamiento corto ⇒ revisit (vuelve pronto, excluyendo lo ya traído)', () => {
    const at = NOW - (TAVILY_PRODUCTIVE_CELL_COOLDOWN_DAYS + 1) * DAY;
    assert.equal(classifyTavilyCell({ lastUsedAtMs: at, timesUsed: 1, persistedCount: 2 }, NOW), 'revisit');
  });
  it('vacía una vez ⇒ espera el enfriamiento largo', () => {
    const history = { lastUsedAtMs: NOW - (TAVILY_PRODUCTIVE_CELL_COOLDOWN_DAYS + 1) * DAY, timesUsed: 1, persistedCount: 0 };
    assert.equal(classifyTavilyCell(history, NOW), 'cooling');
    assert.equal(
      classifyTavilyCell({ ...history, lastUsedAtMs: NOW - (TAVILY_EMPTY_CELL_COOLDOWN_DAYS + 1) * DAY }, NOW),
      'revisit',
    );
  });
  it('vacía en varias corridas ⇒ retired aunque haya pasado el enfriamiento', () => {
    const at = NOW - (TAVILY_EMPTY_CELL_COOLDOWN_DAYS + 1) * DAY;
    assert.equal(
      classifyTavilyCell({ lastUsedAtMs: at, timesUsed: TAVILY_CELL_RETIRE_AFTER_EMPTY_RUNS, persistedCount: 0 }, NOW),
      'retired',
    );
  });
});

describe('selectTavilyQueryCells', () => {
  const terms = ['alcaldia', 'gobernacion', 'ministerio', 'hospital publico'];
  const regions: (string | null)[] = [null, 'Antioquia', 'Valle del Cauca', 'Santander', 'Atlántico', 'Bolívar'];
  const all = cells(terms, regions);

  it('nunca repite una búsqueda usada dentro del enfriamiento', () => {
    const history = historyOf(all.slice(0, 10).map((c) => [c.query, { daysAgo: 3, persisted: 4 }]));
    const { selected } = selectTavilyQueryCells({ cells: all, history, nowMs: NOW, seedKey: 'b1', limit: 16 });
    for (const c of selected) assert.equal(history.has(c.key), false, c.query);
  });

  it('reparte entre términos: ninguno acapara la corrida', () => {
    const { selected } = selectTavilyQueryCells({ cells: all, history: new Map(), nowMs: NOW, seedKey: 'b1', limit: 8 });
    const perTerm = new Map<string, number>();
    for (const c of selected) perTerm.set(c.term, (perTerm.get(c.term) ?? 0) + 1);
    assert.equal(perTerm.size, terms.length);
    assert.ok(Math.max(...perTerm.values()) <= 2);
  });

  it('en un segmento nuevo empieza por la búsqueda nacional de cada término', () => {
    const { selected } = selectTavilyQueryCells({ cells: all, history: new Map(), nowMs: NOW, seedKey: 'b1', limit: 4 });
    assert.ok(selected.every((c) => c.region === null));
  });

  it('dos lotes distintos toman regiones distintas (vendedores en paralelo)', () => {
    const history = historyOf(terms.map((t) => [`${t} Colombia`, { daysAgo: 2, persisted: 3 }]));
    const a = selectTavilyQueryCells({ cells: all, history, nowMs: NOW, seedKey: 'batch-a', limit: 8 }).selected;
    const b = selectTavilyQueryCells({ cells: all, history, nowMs: NOW, seedKey: 'batch-b', limit: 8 }).selected;
    const overlap = a.filter((c) => b.some((d) => d.key === c.key)).length;
    assert.ok(overlap < a.length, `solapamiento total entre lotes: ${overlap}/${a.length}`);
  });

  it('es determinista para el mismo lote (un reintento no cambia el plan)', () => {
    const one = selectTavilyQueryCells({ cells: all, history: new Map(), nowMs: NOW, seedKey: 'b1', limit: 12 });
    const two = selectTavilyQueryCells({ cells: all, history: new Map(), nowMs: NOW, seedKey: 'b1', limit: 12 });
    assert.deepEqual(one.selected.map((c) => c.key), two.selected.map((c) => c.key));
  });

  it('agotadas las nuevas, vuelve a las que rindieron y ya se enfriaron', () => {
    const old = NOW - (TAVILY_EMPTY_CELL_COOLDOWN_DAYS + 10) * DAY;
    const history: TavilyQueryHistory = new Map(
      all.map((c, i) => [c.key, { lastUsedAtMs: old, timesUsed: 1, persistedCount: i % 3 }]),
    );
    const { selected, summary } = selectTavilyQueryCells({ cells: all, history, nowMs: NOW, seedKey: 'b1', limit: 4 });
    assert.equal(summary.fresh, 0);
    assert.equal(selected.length, 4);
    assert.ok(selected.every((c) => (history.get(c.key)?.persistedCount ?? 0) > 0));
  });

  it('segmento agotado ⇒ 0 búsquedas y lo dice (no se gastan créditos a ciegas)', () => {
    const history = historyOf(all.map((c) => [c.query, { daysAgo: 1, persisted: 1 }]));
    const { selected, summary } = selectTavilyQueryCells({ cells: all, history, nowMs: NOW, seedKey: 'b1', limit: 16 });
    assert.equal(selected.length, 0);
    assert.equal(summary.exhausted, true);
    assert.equal(summary.cooling, all.length);
    assert.ok(summary.nextAvailableAtMs !== null && summary.nextAvailableAtMs > NOW);
  });

  it('las búsquedas retiradas no vuelven', () => {
    const old = NOW - (TAVILY_EMPTY_CELL_COOLDOWN_DAYS + 10) * DAY;
    const history: TavilyQueryHistory = new Map(
      all.map((c) => [c.key, { lastUsedAtMs: old, timesUsed: TAVILY_CELL_RETIRE_AFTER_EMPTY_RUNS, persistedCount: 0 }]),
    );
    const { selected, summary } = selectTavilyQueryCells({ cells: all, history, nowMs: NOW, seedKey: 'b1', limit: 16 });
    assert.equal(selected.length, 0);
    assert.equal(summary.retired, all.length);
    assert.equal(summary.nextAvailableAtMs, null);
  });
});

describe('buildTavilyQueryHistory', () => {
  it('suma usos por búsqueda y cuenta sólo empresas útiles', () => {
    const history = buildTavilyQueryHistory({
      batches: [
        { id: 'b1', createdAtMs: NOW - 10 * DAY, queries: ['alcaldia Colombia', 'gobernacion Colombia'] },
        { id: 'b2', createdAtMs: NOW - 2 * DAY, queries: ['Alcaldía Colombia'] },
      ],
      candidates: [
        { batchId: 'b1', status: 'needs_review', queryText: 'alcaldia Colombia' },
        { batchId: 'b1', status: 'duplicate', queryText: 'alcaldia Colombia' },
        { batchId: 'b1', status: 'discarded', queryText: 'gobernacion Colombia' },
        { batchId: 'b2', status: 'high_quality_new', queryText: 'alcaldia colombia' },
        { batchId: 'b9', status: 'needs_review', queryText: 'alcaldia Colombia' },
      ],
    });
    const alcaldia = history.get('alcaldia colombia');
    assert.deepEqual(alcaldia, { lastUsedAtMs: NOW - 2 * DAY, timesUsed: 2, persistedCount: 2 });
    assert.deepEqual(history.get('gobernacion colombia'), { lastUsedAtMs: NOW - 10 * DAY, timesUsed: 1, persistedCount: 0 });
  });

  it('una consulta con criterio adicional suma a su celda base', () => {
    const history = buildTavilyQueryHistory({
      batches: [{
        id: 'b1', createdAtMs: NOW, queries: ['alcaldia antioquia colombia'],
        emittedToKey: { 'alcaldia Antioquia Colombia salud': 'alcaldia antioquia colombia' },
      }],
      candidates: [{ batchId: 'b1', status: 'needs_review', queryText: 'alcaldia Antioquia Colombia salud' }],
    });
    assert.equal(history.get('alcaldia antioquia colombia')?.persistedCount, 1);
  });

  it('la misma búsqueda repetida en un lote cuenta una vez', () => {
    const history = buildTavilyQueryHistory({
      batches: [{ id: 'b1', createdAtMs: NOW, queries: ['alcaldia Colombia', 'alcaldia Colombia'] }],
      candidates: [],
    });
    assert.equal(history.get('alcaldia colombia')?.timesUsed, 1);
  });
});

describe('buildTavilyMacroQueryPlan con espacio de búsqueda', () => {
  const base = { industry: 'Gobierno', country: 'Colombia', countryCode: 'CO', additionalCriteria: null };

  it('el espacio de CO×Gobierno es término × (nacional + 33 regiones)', () => {
    const plan = buildTavilyMacroQueryPlan({ ...base, seedKey: 'b1', history: new Map(), nowMs: NOW });
    assert.ok(plan);
    assert.equal(plan.space.total, plan.termCount * (1 + resolveTavilyCountryRegions('CO').length));
  });

  it('la 2.ª corrida no repite las 7 búsquedas nacionales de la 1.ª (Prod 30-09)', () => {
    const first = buildTavilyMacroQueryPlan({ ...base, seedKey: 'ff1ba9f2', history: new Map(), nowMs: NOW });
    assert.ok(first);
    const used = first.rounds.flat();
    const history = historyOf(used.map((q) => [q, { daysAgo: 0, persisted: 5 }]));
    const second = buildTavilyMacroQueryPlan({ ...base, seedKey: 'fb530d9b', history, nowMs: NOW });
    assert.ok(second);
    const again = second.rounds.flat();
    assert.equal(again.length, 16, 'la 2.ª corrida tiene 16 búsquedas nuevas, no 7 repetidas');
    for (const q of again) assert.equal(used.includes(q), false, q);
  });

  it('el plan publica qué celdas usó, para el historial de las próximas corridas', () => {
    const plan = buildTavilyMacroQueryPlan({ ...base, seedKey: 'b1', history: new Map(), nowMs: NOW });
    assert.ok(plan);
    assert.equal(plan.cellsUsed.length, plan.rounds.flat().length);
  });

  it('una consulta regional nombra la región y el país', () => {
    const history = historyOf(
      (buildTavilyMacroQueryPlan({ ...base, seedKey: 'x', history: new Map(), nowMs: NOW })?.rounds.flat() ?? [])
        .map((q) => [q, { daysAgo: 0, persisted: 1 }]),
    );
    const plan = buildTavilyMacroQueryPlan({ ...base, seedKey: 'y', history, nowMs: NOW });
    const regional = plan?.rounds.flat().find((q) => resolveTavilyCountryRegions('CO').some((r) => q.includes(r)));
    assert.ok(regional, 'hay al menos una búsqueda regional');
    assert.match(regional, /Colombia$/);
  });

  it('sin historial se comporta como un segmento nuevo (fail-open)', () => {
    const plan = buildTavilyMacroQueryPlan({ ...base, seedKey: 'b1' });
    assert.ok(plan);
    assert.ok(plan.rounds.flat().length > 0);
  });

  it('segmento agotado ⇒ plan con 0 rondas y exhausted', () => {
    const everything = buildTavilyMacroQueryPlan({ ...base, seedKey: 'b1', history: new Map(), nowMs: NOW });
    assert.ok(everything);
    const plan = buildTavilyMacroQueryPlan({
      ...base,
      seedKey: 'b1',
      history: new Map(everything.allCellKeys.map((k) => [k, { lastUsedAtMs: NOW, timesUsed: 1, persistedCount: 1 }])),
      nowMs: NOW,
    });
    assert.ok(plan);
    assert.equal(plan.rounds.length, 0);
    assert.equal(plan.space.exhausted, true);
  });
});

// ─── Lector del historial (doble de Supabase, sólo lectura) ───────────────────

import { loadTavilyQueryHistory, readTavilyHistoryBatch } from '../tavily-query-history';
import type { SupabaseClient } from '@supabase/supabase-js';

function fakeSupabase(tables: Record<string, unknown[]>, calls: string[]): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      const chain = {
        select(cols: string) { calls.push(`${table}.select(${cols})`); return chain; },
        eq(col: string, v: unknown) { filters.push(['eq', col, v]); return chain; },
        gte(col: string, v: unknown) { filters.push(['gte', col, v]); return chain; },
        in(col: string, v: unknown) { filters.push(['in', col, v]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        then(resolve: (r: { data: unknown[]; error: null }) => void) {
          const rows = (tables[table] ?? []).filter((row) =>
            filters.every(([op, col, v]) => {
              const value = (row as Record<string, unknown>)[col];
              if (op === 'eq') return value === v;
              if (op === 'in') return (v as unknown[]).includes(value);
              return true;
            }),
          );
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe('loadTavilyQueryHistory', () => {
  const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

  it('lee sólo lotes de Tavily del mismo país e industria y suma lo que trajeron', async () => {
    const calls: string[] = [];
    const supabase = fakeSupabase({
      prospect_batches: [
        { id: 'v1', country_code: 'CO', industry: 'Gobierno', created_at: iso(3),
          plan: { version: 'tavily_macro_query_plan_v1' },
          rounds: [{ queriesUsed: ['ministerio Colombia', 'alcaldia Colombia'] }] },
        { id: 'v2', country_code: 'CO', industry: 'Gobierno', created_at: iso(1),
          plan: { version: 'tavily_macro_query_plan_v2', cells_used: [{ key: 'alcaldia antioquia colombia', query: 'alcaldia Antioquia Colombia' }] },
          rounds: [] },
        { id: 'apollo', country_code: 'CO', industry: 'Gobierno', created_at: iso(1), plan: null,
          rounds: [{ queriesUsed: ['no cuenta'] }] },
        { id: 'otro-pais', country_code: 'PE', industry: 'Gobierno', created_at: iso(1),
          plan: { version: 'v1' }, rounds: [{ queriesUsed: ['ministerio Peru'] }] },
      ],
      prospect_candidates: [
        { batch_id: 'v1', status: 'needs_review', query_text: 'ministerio Colombia' },
        { batch_id: 'v2', status: 'needs_review', query_text: 'alcaldia Antioquia Colombia' },
        { batch_id: 'v2', status: 'duplicate', query_text: 'alcaldia Antioquia Colombia' },
      ],
    }, calls);

    const { history, batchesRead } = await loadTavilyQueryHistory(supabase, {
      countryCode: 'CO', industry: 'Gobierno', nowMs: NOW,
    });
    assert.equal(batchesRead, 2);
    assert.equal(history.get('ministerio colombia')?.persistedCount, 1);
    assert.equal(history.get('alcaldia colombia')?.persistedCount, 0);
    assert.equal(history.get('alcaldia antioquia colombia')?.persistedCount, 1);
    assert.equal(history.has('no cuenta'), false);
    assert.equal(history.has('ministerio peru'), false);
    assert.ok(calls.every((c) => c.includes('.select(')), 'sólo lecturas');
  });

  it('excluye el lote en curso', async () => {
    const supabase = fakeSupabase({
      prospect_batches: [{ id: 'actual', country_code: 'CO', industry: 'Gobierno', created_at: iso(0),
        plan: { version: 'v2' }, rounds: [{ queriesUsed: ['alcaldia Colombia'] }] }],
      prospect_candidates: [],
    }, []);
    const { batchesRead } = await loadTavilyQueryHistory(supabase, {
      countryCode: 'CO', industry: 'Gobierno', nowMs: NOW, excludeBatchId: 'actual',
    });
    assert.equal(batchesRead, 0);
  });

  it('readTavilyHistoryBatch descarta filas sin fecha o sin consultas', () => {
    assert.equal(readTavilyHistoryBatch({ id: 'x', created_at: 'no-date', plan: {}, rounds: [] }), null);
    assert.equal(readTavilyHistoryBatch({ id: 'x', created_at: iso(1), plan: {}, rounds: [] }), null);
  });
});


describe('paginar por exclusión: volver a una celda excluye lo que ya trajo', () => {
  it('el historial recuerda los dominios de cada celda, también duplicados y descartados', () => {
    const history = buildTavilyQueryHistory({
      batches: [{ id: 'b1', createdAtMs: NOW, queries: ['alcaldia Colombia'] }],
      candidates: [
        { batchId: 'b1', status: 'needs_review', domain: 'medellin.gov.co', queryText: 'alcaldia Colombia' },
        { batchId: 'b1', status: 'duplicate', domain: 'bogota.gov.co', queryText: 'alcaldia Colombia' },
      ],
    });
    assert.deepEqual(history.get('alcaldia colombia')?.domains, ['medellin.gov.co', 'bogota.gov.co']);
  });

  it('el plan entrega, por ronda, los dominios que esas celdas ya trajeron', () => {
    const base = { industry: 'Gobierno', country: 'Colombia', countryCode: 'CO', additionalCriteria: null };
    const first = buildTavilyMacroQueryPlan({ ...base, seedKey: 'b1', history: new Map(), nowMs: NOW })!;
    const old = NOW - (TAVILY_PRODUCTIVE_CELL_COOLDOWN_DAYS + 1) * DAY;
    // Todas las celdas usadas, rindieron y se enfriaron; el resto también usadas y recientes.
    const history: TavilyQueryHistory = new Map(
      first.allCellKeys.map((key) => [key, first.cellsUsed.some((c) => c.key === key)
        ? { lastUsedAtMs: old, timesUsed: 1, persistedCount: 2, domains: [`${key.split(' ')[0]}.gov.co`] }
        : { lastUsedAtMs: NOW, timesUsed: 1, persistedCount: 1 }]),
    );
    const again = buildTavilyMacroQueryPlan({ ...base, seedKey: 'b2', history, nowMs: NOW })!;
    assert.ok(again.rounds.flat().length > 0);
    assert.ok(again.roundCellDomains[0].length > 0, 'la 1.ª ronda excluye lo que sus celdas ya trajeron');
  });

  it('una celda productiva sostiene el segmento: se vuelve a ella en días, no en meses', () => {
    assert.ok(TAVILY_PRODUCTIVE_CELL_COOLDOWN_DAYS <= 14);
    assert.ok(TAVILY_EMPTY_CELL_COOLDOWN_DAYS > TAVILY_PRODUCTIVE_CELL_COOLDOWN_DAYS);
  });
});
