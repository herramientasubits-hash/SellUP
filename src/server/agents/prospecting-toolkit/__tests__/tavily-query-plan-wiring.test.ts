/**
 * AGENT1-TAVILY-V2-1 § 1 — el runner incremental usa el plan de macro industria
 * sólo cuando el proveedor es Tavily.
 *
 * Pipeline falso (sin red, sin Supabase, dryRun): se capturan las consultas que
 * cada ronda habría pagado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runIncrementalProspectingSearch } from '../incremental-search';
import type { IncrementalSearchInput } from '../incremental-search-types';
import type { CatalogContextResult, ProspectingPipelineOutput } from '../types';
import { buildTavilyMacroQueryPlan } from '../tavily-query-plan';

type PipelineFn = typeof import('../prospecting-pipeline').runProspectingPipeline;

const CATALOG_CONTEXT: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

function capturingPipeline(captured: string[][]): PipelineFn {
  const fn = async (pipelineInput: { queryOverrides?: string[] }): Promise<ProspectingPipelineOutput> => {
    captured.push([...(pipelineInput.queryOverrides ?? [])]);
    return {
      input: { country: 'Colombia', countryCode: 'CO', industry: 'Retail', webSearchProvider: 'tavily', mode: 'multi_query' },
      catalogContext: CATALOG_CONTEXT,
      searchQuery: 'test',
      webSearch: { provider: 'tavily', query: 'test', results: [], resultsCount: 5, skipped: false, estimatedCostUsd: null, metadata: {} },
      candidates: [],
      summary: { requested: 10, searched: 5, returned: 0, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0 },
      warnings: [],
      metadata: {},
    };
  };
  return fn as unknown as PipelineFn;
}

function baseInput(overrides: Partial<IncrementalSearchInput> = {}): IncrementalSearchInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail',
    webSearchProvider: 'tavily',
    dryRun: true,
    maxRounds: 4,
    targetPersistibleCandidates: 999,
    minUsefulCandidates: 999,
    existingBatchId: '00000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}

describe('Tavily + macro industria — las rondas pagan exactamente el plan', () => {
  it('cada ronda envía las consultas del plan, en orden', async () => {
    const captured: string[][] = [];
    const input = baseInput();
    const result = await runIncrementalProspectingSearch(input, undefined, capturingPipeline(captured));

    const plan = buildTavilyMacroQueryPlan({
      industry: 'Retail',
      country: 'Colombia',
      countryCode: 'CO',
      seedKey: input.existingBatchId!,
      additionalCriteria: null,
    })!;
    assert.deepEqual(captured, plan.rounds);
    assert.equal(result.metadata.tavily_query_plan?.macro_key, 'retail');
    // AGENT1-TAVILY-V2-2 — en Colombia Retail pierde sus 6 términos sólo en
    // inglés (retailer, grocery store, department store…): 14 → 8.
    assert.equal(result.metadata.tavily_query_plan?.term_count, 8);
    // AGENT1-TAVILY-QUERY-SPACE-1 — 8 términos × (nacional + 33 regiones) = 272
    // celdas: la corrida paga su tope completo (16), ya no sólo 8 nacionales.
    assert.equal(result.metadata.tavily_query_plan?.queries_planned, 16);
  });

  it('ninguna consulta de Retail lleva literales de software (R3/R4 legacy)', async () => {
    const captured: string[][] = [];
    await runIncrementalProspectingSearch(baseInput(), undefined, capturingPipeline(captured));
    for (const q of captured.flat()) assert.doesNotMatch(q, /\b(ERP|CRM|SaaS|software)\b/i, q);
  });

  it('nunca supera 16 consultas pagadas por corrida', async () => {
    const captured: string[][] = [];
    await runIncrementalProspectingSearch(
      baseInput({ industry: 'Salud & Farmacéuticos' }),
      undefined,
      capturingPipeline(captured),
    );
    assert.ok(captured.flat().length <= 16);
    for (const round of captured) assert.ok(round.length <= 4);
  });

  it('Gobierno (7 términos en español) ya no se agota en 7 consultas, y no inventa ninguna', async () => {
    const captured: string[][] = [];
    const result = await runIncrementalProspectingSearch(
      baseInput({ industry: 'Gobierno' }),
      undefined,
      capturingPipeline(captured),
    );
    // AGENT1-TAVILY-V2-2 — sin «government agency», «municipality» ni «public
    // administration»: 10 → 7 términos.
    assert.equal(result.metadata.tavily_query_plan?.term_count, 7);
    // AGENT1-TAVILY-QUERY-SPACE-1 — Prod 30-09 (fb530d9b): con sólo 7 consultas
    // nacionales la 2.ª corrida repitió la 1.ª. Con regiones, 4 rondas de 4
    // consultas distintas, todas del plan.
    const plan = buildTavilyMacroQueryPlan({
      industry: 'Gobierno',
      country: 'Colombia',
      countryCode: 'CO',
      seedKey: baseInput().existingBatchId!,
      additionalCriteria: null,
    })!;
    assert.deepEqual(captured, plan.rounds);
    assert.equal(captured.flat().length, 16);
    assert.equal(new Set(captured.flat()).size, 16);
  });

  it('dos lotes distintos arrancan por consultas distintas', async () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const captured: string[][] = [];
      await runIncrementalProspectingSearch(
        baseInput({ existingBatchId: `00000000-0000-4000-8000-00000000000${i}` }),
        undefined,
        capturingPipeline(captured),
      );
      firsts.add(captured[0][0]);
    }
    assert.ok(firsts.size >= 3, `6 lotes, sólo ${firsts.size} primeras consultas`);
  });
});

describe('Fuera de Tavily o fuera del catálogo macro — camino de siempre', () => {
  it('mock con la misma industria no usa el plan', async () => {
    const captured: string[][] = [];
    const result = await runIncrementalProspectingSearch(
      baseInput({ webSearchProvider: 'mock' }),
      undefined,
      capturingPipeline(captured),
    );
    assert.equal(result.metadata.tavily_query_plan, undefined);
  });

  it('Tavily con una industria legacy no usa el plan', async () => {
    const captured: string[][] = [];
    const result = await runIncrementalProspectingSearch(
      baseInput({ industry: 'Industria inventada' }),
      undefined,
      capturingPipeline(captured),
    );
    assert.equal(result.metadata.tavily_query_plan, undefined);
  });
});

// ── AGENT1-TAVILY-V2-1 § 2 — exclusiones por ronda ─────────────────────────────

function pipelineReturningDomains(
  capturedExcludes: Array<string[] | undefined>,
  domainsByCall: string[][],
): PipelineFn {
  let call = 0;
  const fn = async (pipelineInput: { excludeDomains?: string[] }): Promise<ProspectingPipelineOutput> => {
    capturedExcludes.push(pipelineInput.excludeDomains ? [...pipelineInput.excludeDomains] : undefined);
    const domains = domainsByCall[call++] ?? [];
    const candidates = domains.map((domain) => ({
      name: domain,
      website: `https://${domain}`,
      domain,
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail',
      sourceUrl: `https://${domain}`,
      sourceTitle: domain,
      sourceSnippet: null,
      websiteVerification: null,
      duplicateCheck: null,
      scoring: { qualityLabel: 'discard', confidenceScore: 0, fitScore: 0, reasons: [], warnings: [] },
    })) as unknown as ProspectingPipelineOutput['candidates'];
    return {
      input: { country: 'Colombia', countryCode: 'CO', industry: 'Retail', webSearchProvider: 'tavily', mode: 'multi_query' },
      catalogContext: CATALOG_CONTEXT,
      searchQuery: 'test',
      webSearch: { provider: 'tavily', query: 'test', results: [], resultsCount: 5, skipped: false, estimatedCostUsd: null, metadata: {} },
      candidates,
      summary: { requested: 10, searched: 5, returned: candidates.length, highQualityNew: 0, needsReview: 0, duplicates: 0, insufficientData: 0, discarded: candidates.length, unchecked: 0 },
      warnings: [],
      metadata: {},
    };
  };
  return fn as unknown as PipelineFn;
}

describe('Tavily — cada ronda excluye lo que ya vio', () => {
  it('la ronda 2 pide excluir los dominios que trajo la ronda 1', async () => {
    const excludes: Array<string[] | undefined> = [];
    // Salud conserva 11 términos en español (3 rondas): la tercera ronda debe
    // excluir lo que trajo la segunda.
    const result = await runIncrementalProspectingSearch(
      baseInput({ industry: 'Salud & Farmacéuticos' }),
      undefined,
      pipelineReturningDomains(excludes, [['exito.com', 'falabella.com.co'], ['olimpica.com']]),
    );
    assert.ok(excludes[0], 'la ronda 1 envía al menos el ruido fijo');
    assert.ok(!excludes[0]!.includes('exito.com'));
    assert.ok(excludes[0]!.includes('linkedin.com'));
    assert.ok(excludes[1]!.includes('exito.com'));
    assert.ok(excludes[1]!.includes('falabella.com.co'));
    assert.ok(excludes[2]!.includes('olimpica.com'));
    assert.equal(result.metadata.tavily_exclude_domains?.seen_this_run_count, 3);
  });

  it('fuera de Tavily no viaja ninguna exclusión', async () => {
    const excludes: Array<string[] | undefined> = [];
    const result = await runIncrementalProspectingSearch(
      baseInput({ webSearchProvider: 'mock' }),
      undefined,
      pipelineReturningDomains(excludes, [['exito.com']]),
    );
    assert.ok(excludes.every((e) => e === undefined));
    assert.equal(result.metadata.tavily_exclude_domains, undefined);
  });
});

describe('AGENT1-TAVILY-QUERY-SPACE-1 — el lote publica lo que leerá la próxima corrida', () => {
  it('cells_used = las consultas pagadas, con su celda; query_space con el conteo del espacio', async () => {
    const captured: string[][] = [];
    const result = await runIncrementalProspectingSearch(
      baseInput({ industry: 'Gobierno' }),
      undefined,
      capturingPipeline(captured),
    );
    const plan = result.metadata.tavily_query_plan!;
    assert.deepEqual(plan.cells_used?.map((c) => c.query), captured.flat());
    assert.equal(plan.regions_count, 33);
    assert.equal(plan.query_space?.total, 7 * 34);
    assert.equal(plan.query_space?.exhausted, false);
    // dryRun ⇒ sin cliente ⇒ el historial no se lee (y no se inventa).
    assert.equal(plan.query_space?.history_status, 'skipped');
  });
});
