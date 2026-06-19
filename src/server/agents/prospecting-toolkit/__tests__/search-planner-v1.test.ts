/**
 * Tests — Search Planner v1 (Hito 16AD)
 *
 * Verifica:
 *   - getExecutableQueriesFromSearchPlan devuelve queries ordenadas por prioridad
 *   - Colombia + Tecnología produce queries desde familias HIGH primero
 *   - RUES no aparece como query ejecutable primaria
 *   - Queries ejecutables incluyen metadata familyKey/familyIntent/priority/source
 *   - Pipeline multi_query usa queries del planner (usedForExecution=true, fallbackUsed=false)
 *   - Pipeline con queryOverrides usa fallback (fallbackUsed=true)
 *   - Pipeline single_query usa fallback (fallbackUsed=true)
 *   - search_plan.version = 'search_planner_v1' en metadata de output
 *   - No se llama Tavily en tests (webSearchProvider: 'mock')
 *
 * Puramente determinístico o con mock provider — sin I/O real, sin llamadas externas.
 * Usa Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchPlan, getExecutableQueriesFromSearchPlan } from '../search-planner';
import { runProspectingPipeline } from '../prospecting-pipeline';
import type { SearchPlanV0 } from '../search-planner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildColombiaTeçnologíaPlan(overrides: Partial<Parameters<typeof buildSearchPlan>[0]> = {}): SearchPlanV0 {
  return buildSearchPlan({
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    subindustries: [],
    additionalCriteria: null,
    targetCount: 10,
    searchDepth: 'standard',
    ...overrides,
  });
}

// ─── getExecutableQueriesFromSearchPlan — estructura base ─────────────────────

describe('getExecutableQueriesFromSearchPlan — Colombia + Tecnología', () => {
  it('devuelve al menos una query ejecutable', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    assert.ok(queries.length > 0, 'debe devolver al menos una query');
  });

  it('todas las queries tienen source = search_planner_v1', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    for (const q of queries) {
      assert.equal(q.source, 'search_planner_v1', `query "${q.queryText}" debe tener source search_planner_v1`);
    }
  });

  it('todas las queries tienen queryText no vacío', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    for (const q of queries) {
      assert.ok(q.queryText.trim().length > 0, 'queryText no debe estar vacío');
    }
  });

  it('todas las queries tienen familyKey no vacío', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    for (const q of queries) {
      assert.ok(q.familyKey.length > 0, `query debe tener familyKey`);
    }
  });

  it('todas las queries tienen familyIntent no vacío', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    for (const q of queries) {
      assert.ok(q.familyIntent.length > 0, `query "${q.queryText}" debe tener familyIntent`);
    }
  });

  it('todas las queries tienen priority válida', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    const validPriorities = new Set(['high', 'medium', 'low']);
    for (const q of queries) {
      assert.ok(validPriorities.has(q.priority), `priority "${q.priority}" no es válida`);
    }
  });

  it('todas las queries tienen round válido (1 o 2)', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    for (const q of queries) {
      assert.ok(q.round === 1 || q.round === 2, `round debe ser 1 o 2, got ${q.round}`);
    }
  });
});

// ─── Orden de prioridad ───────────────────────────────────────────────────────

describe('getExecutableQueriesFromSearchPlan — orden de prioridad', () => {
  it('queries de Round 1 aparecen antes que Round 2', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);

    const firstR2Index = queries.findIndex(q => q.round === 2);
    const lastR1Index = [...queries].reverse().findIndex(q => q.round === 1);
    const lastR1Actual = queries.length - 1 - lastR1Index;

    if (firstR2Index !== -1 && lastR1Index !== -1) {
      assert.ok(
        lastR1Actual < firstR2Index,
        'toda R1 debe aparecer antes de R2',
      );
    }
  });

  it('dentro de Round 1, HIGH aparece antes que MEDIUM', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    const r1 = queries.filter(q => q.round === 1);

    const firstMediumIdx = r1.findIndex(q => q.priority === 'medium');
    const lastHighIdx = [...r1].reverse().findIndex(q => q.priority === 'high');
    const lastHighActual = r1.length - 1 - lastHighIdx;

    if (firstMediumIdx !== -1 && lastHighIdx !== -1) {
      assert.ok(
        lastHighActual < firstMediumIdx,
        'HIGH debe aparecer antes que MEDIUM en R1',
      );
    }
  });

  it('no tiene orden invertido (LOW antes que HIGH) en R1', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    const r1 = queries.filter(q => q.round === 1);

    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    let maxSeenRank = -1;
    for (const q of r1) {
      const rank = priorityRank[q.priority] ?? 99;
      assert.ok(rank >= maxSeenRank, `orden de prioridad invertido en R1: ${q.priority} después de rank ${maxSeenRank}`);
      maxSeenRank = rank;
    }
  });
});

// ─── RUES no es query ejecutable primaria ─────────────────────────────────────

describe('getExecutableQueriesFromSearchPlan — RUES no aparece como query', () => {
  it('ninguna queryText contiene "rues" (case-insensitive)', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    for (const q of queries) {
      assert.ok(
        !q.queryText.toLowerCase().includes('rues'),
        `queryText no debe contener RUES: "${q.queryText}"`,
      );
    }
  });

  it('ninguna familyKey contiene "rues"', () => {
    const plan = buildColombiaTeçnologíaPlan();
    const queries = getExecutableQueriesFromSearchPlan(plan);
    for (const q of queries) {
      assert.ok(
        !q.familyKey.toLowerCase().includes('rues'),
        `familyKey no debe contener rues: "${q.familyKey}"`,
      );
    }
  });
});

// ─── Límite por searchDepth ───────────────────────────────────────────────────

describe('getExecutableQueriesFromSearchPlan — límite por searchDepth', () => {
  it('standard depth no supera 10 queries', () => {
    const plan = buildColombiaTeçnologíaPlan({ searchDepth: 'standard' });
    const queries = getExecutableQueriesFromSearchPlan(plan);
    assert.ok(queries.length <= 10, `standard debe tener <= 10 queries, got ${queries.length}`);
  });

  it('deep depth no supera 18 queries', () => {
    const plan = buildColombiaTeçnologíaPlan({ searchDepth: 'deep' });
    const queries = getExecutableQueriesFromSearchPlan(plan);
    assert.ok(queries.length <= 18, `deep debe tener <= 18 queries, got ${queries.length}`);
  });

  it('deep depth puede producir más queries que standard', () => {
    const planStandard = buildColombiaTeçnologíaPlan({ searchDepth: 'standard' });
    const planDeep = buildColombiaTeçnologíaPlan({ searchDepth: 'deep' });
    const qStandard = getExecutableQueriesFromSearchPlan(planStandard);
    const qDeep = getExecutableQueriesFromSearchPlan(planDeep);
    assert.ok(
      qDeep.length >= qStandard.length,
      `deep (${qDeep.length}) debe tener >= queries que standard (${qStandard.length})`,
    );
  });
});

// ─── Pipeline integration — multi_query usa planner ──────────────────────────

describe('Pipeline — multi_query usa Search Planner v1', () => {
  it('metadata.search_plan.version = search_planner_v1', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.version, 'search_planner_v1');
  });

  it('metadata.search_plan.usedForExecution = true en multi_query', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.usedForExecution, true, 'planner debe haberse usado para ejecutar queries');
  });

  it('metadata.search_plan.fallbackUsed = false en multi_query', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.fallbackUsed, false, 'no debe usar fallback en multi_query con planner disponible');
  });

  it('metadata.search_plan.executedQueryCount > 0 en multi_query', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.ok(
      typeof sp?.executedQueryCount === 'number' && (sp.executedQueryCount as number) > 0,
      `executedQueryCount debe ser > 0, got ${sp?.executedQueryCount}`,
    );
  });

  it('metadata.search_plan.querySelectionReason = search_planner_v1_queries_available', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.querySelectionReason, 'search_planner_v1_queries_available');
  });

  it('metadata.search_plan.executableQueries es array', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.ok(Array.isArray(sp?.executableQueries), 'executableQueries debe ser array');
  });
});

// ─── Pipeline integration — queryOverrides usa fallback ───────────────────────

describe('Pipeline — queryOverrides desactiva planner y activa fallback', () => {
  it('metadata.search_plan.fallbackUsed = true con queryOverrides', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
      queryOverrides: ['empresas tecnologia colombia', 'software empresas bogota'],
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.fallbackUsed, true, 'fallbackUsed debe ser true cuando hay queryOverrides');
  });

  it('metadata.search_plan.usedForExecution = false con queryOverrides', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
      queryOverrides: ['empresas tecnologia colombia'],
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.usedForExecution, false);
  });

  it('metadata.search_plan.querySelectionReason = query_overrides_provided', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
      queryOverrides: ['empresas tecnologia colombia'],
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.querySelectionReason, 'query_overrides_provided');
  });
});

// ─── Pipeline integration — single_query usa fallback ────────────────────────

describe('Pipeline — single_query usa fallback (planner no controla)', () => {
  it('metadata.search_plan.fallbackUsed = true en single_query', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'single_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.fallbackUsed, true, 'single_query siempre usa fallback');
  });

  it('metadata.search_plan.usedForExecution = false en single_query', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'single_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.usedForExecution, false);
  });

  it('metadata.search_plan.version = search_planner_v1 en single_query también', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'single_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.equal(sp?.version, 'search_planner_v1');
  });
});

// ─── Pipeline — metadata siempre contiene queryFamilies ───────────────────────

describe('Pipeline — search_plan.queryFamilies siempre presente', () => {
  it('multi_query tiene queryFamilies en search_plan', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'multi_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.ok(Array.isArray(sp?.queryFamilies) && (sp.queryFamilies as unknown[]).length > 0);
  });

  it('single_query tiene queryFamilies en search_plan', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      mode: 'single_query',
      webSearchProvider: 'mock',
    });
    const sp = (output.metadata as Record<string, unknown>).search_plan as Record<string, unknown>;
    assert.ok(Array.isArray(sp?.queryFamilies) && (sp.queryFamilies as unknown[]).length > 0);
  });
});
