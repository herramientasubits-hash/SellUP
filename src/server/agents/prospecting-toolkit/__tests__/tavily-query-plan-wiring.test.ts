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
      seedKey: input.existingBatchId!,
      additionalCriteria: null,
    })!;
    assert.deepEqual(captured, plan.rounds);
    assert.equal(result.metadata.tavily_query_plan?.macro_key, 'retail');
    assert.equal(result.metadata.tavily_query_plan?.queries_planned, 14);
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

  it('Gobierno (10 términos) se detiene al agotar el plan, sin inventar consultas', async () => {
    const captured: string[][] = [];
    const result = await runIncrementalProspectingSearch(
      baseInput({ industry: 'Gobierno' }),
      undefined,
      capturingPipeline(captured),
    );
    assert.equal(captured.length, 3);
    assert.equal(captured.flat().length, 10);
    assert.equal(result.metadata.stopped_reason, 'novelty_exhausted_no_diversification_available');
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
