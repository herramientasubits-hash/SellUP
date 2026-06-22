/**
 * Tests — Search Quality v1.12 — Source-Guided Investigation
 *
 * Verifica que el sistema genera y prioriza queries source-guided de alta
 * precisión, reduce la dependencia de fallback, y bloquea fuentes no permitidas.
 *
 * Fixtures:
 *   F1 — Colombia + Tecnología + Software Empresarial: >= 5 source-guided queries
 *   F2 — Colombia + Tecnología + Fintech: co_colombia_fintech permitida
 *   F3 — Colombia + Tecnología + B2G: SECOP permitido solo con señal gobierno
 *   F4 — Colombia + Tecnología + ANDICOM explícito: contextual_signal
 *   F5 — Standard cap <= 16, source-guided priorizadas
 *   F6 — No regression: search strategy, v1.11, v1.10, v1.8.1
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runIncrementalProspectingSearch } from '../incremental-search';
import { buildSearchStrategyFromCatalog } from '../search-strategy-builder';
import {
  buildSourceGuidedInvestigationQueries,
  getSourceGuidedQueriesForRound,
} from '../source-guided-investigation';
import type { SourceGuidedInvestigationOutput } from '../source-guided-investigation';
import type { SearchStrategyRuntimeMetadata } from '../incremental-search-types';
import type { ProspectingPipelineOutput, CatalogContextResult } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_CATALOG: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

type PipelineInput = Parameters<typeof import('../prospecting-pipeline').runProspectingPipeline>[0];

function pipelineCapturingQueries(rawResultsCount = 0): {
  pipeline: Parameters<typeof runIncrementalProspectingSearch>[2];
  capturedQueries: string[][];
} {
  const capturedQueries: string[][] = [];
  const pipeline = async (input: PipelineInput): Promise<ProspectingPipelineOutput> => {
    const queries = input.queryOverrides ?? [];
    capturedQueries.push([...queries]);
    return {
      input: {
        country: input.country,
        countryCode: input.countryCode ?? 'CO',
        industry: input.industry,
        webSearchProvider: 'mock',
        mode: 'multi_query',
      },
      catalogContext: FAKE_CATALOG,
      searchQuery: 'test',
      webSearch: {
        provider: 'mock',
        query: 'test',
        results: [],
        resultsCount: rawResultsCount,
        skipped: false,
        estimatedCostUsd: null,
        metadata: { queries_executed: queries },
      },
      candidates: [],
      summary: {
        requested: 10, searched: rawResultsCount, returned: 0,
        highQualityNew: 0, needsReview: 0, duplicates: 0,
        insufficientData: 0, discarded: 0, unchecked: 0,
      },
      warnings: [],
      metadata: {
        pipelineVersion: '0.4.0',
        executedAt: new Date().toISOString(),
        provider: 'mock',
        search_mode: 'multi_query',
        queries_executed: queries,
      },
    };
  };
  return { pipeline, capturedQueries };
}

type WriterInput = Parameters<typeof import('../candidate-writer').writeProspectingCandidates>[0];

function mockWriterCapturing(): {
  writer: Parameters<typeof runIncrementalProspectingSearch>[1];
  captured: { extraBatchMetadata: Record<string, unknown> | null };
} {
  const captured = { extraBatchMetadata: null as Record<string, unknown> | null };
  const writer = async (input: WriterInput) => {
    captured.extraBatchMetadata = (input.extraBatchMetadata ?? {}) as Record<string, unknown>;
    return {
      dryRun: false as const,
      batchId: 'fake-batch-id',
      candidatesCreated: 0,
      candidatesSkipped: 0,
      createdCandidateIds: [],
      skipped: [],
      status: 'success' as const,
      errors: [],
    };
  };
  return { writer, captured };
}

// ─── F1: Colombia + Tecnología + Software Empresarial ─────────────────────────

describe('F1 — Colombia + Tecnología + Software Empresarial: >= 5 source-guided queries', () => {
  const SOFTWARE_EMPRESARIAL_SUBINDUSTRIES = [
    'Software Empresarial (SaaS / ERP / CRM)',
    'Edtech: Plataformas de Aprendizaje',
  ];

  it('source-guided investigation genera al menos 5 queries para CO + Tecnología + Software Empresarial', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO',
      country: 'Colombia',
      industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
      additionalCriteria: null,
    });

    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO',
      country: 'Colombia',
      industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
      searchStrategy: strategy,
      additionalCriteria: null,
    });

    assert.ok(investigation.enabled, 'source-guided investigation debe estar enabled para CO + Tecnología');
    assert.ok(
      investigation.query_packs.length >= 5,
      `Debe generar al menos 5 queries source-guided, got: ${investigation.query_packs.length}`,
    );
    assert.ok(
      investigation.query_packs.some((q) => q.query_source_key === 'co_software_empresarial'),
      'co_software_empresarial debe estar presente en los query packs',
    );
  });

  it('co_rues no aparece en los query packs', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO',
      country: 'Colombia',
      industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
      searchStrategy: strategy,
    });
    const ruesBlocked = investigation.blocked_sources.includes('co_rues');
    const ruesInPacks = investigation.query_packs.some((q) => q.query_source_key === 'co_rues');
    assert.ok(ruesBlocked || !ruesInPacks, 'RUES no debe generar queries de discovery');
  });

  it('co_siis no aparece en los query packs', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
      searchStrategy: strategy,
    });
    const siisBlocked = investigation.blocked_sources.includes('co_siis');
    const siisInPacks = investigation.query_packs.some((q) => q.query_source_key === 'co_siis');
    assert.ok(siisBlocked || !siisInPacks, 'SIIS no debe generar queries de discovery');
  });

  it('co_personas_juridicas_cc no aparece en los query packs', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
      searchStrategy: strategy,
    });
    const pjBlocked = investigation.blocked_sources.includes('co_personas_juridicas_cc');
    const pjInPacks = investigation.query_packs.some((q) => q.query_source_key === 'co_personas_juridicas_cc');
    assert.ok(pjBlocked || !pjInPacks, 'Personas Jurídicas no debe generar queries de discovery');
  });

  it('co_secop2 no aparece sin señal B2G', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
      searchStrategy: strategy,
    });
    const secopInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_secop2' || q.query_source_key === 'co_secop2_proveedores',
    );
    assert.ok(!secopInPacks, 'SECOP no debe generar queries sin señal B2G');
  });

  it('co_colombia_fintech no aparece sin señal fintech', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
      searchStrategy: strategy,
    });
    const fintechInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_colombia_fintech',
    );
    assert.ok(!fintechInPacks, 'Colombia Fintech no debe generar queries sin señal fintech');
  });

  it('co_andicom no aparece sin mención explícita en additionalCriteria', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: SOFTWARE_EMPRESARIAL_SUBINDUSTRIES,
      searchStrategy: strategy,
    });
    const andicomInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_andicom',
    );
    assert.ok(!andicomInPacks, 'ANDICOM no debe generar queries automáticas sin mención explícita');
  });
});

// ─── F2: Colombia + Tecnología + Fintech ──────────────────────────────────────

describe('F2 — Colombia + Tecnología + Fintech: co_colombia_fintech permitida', () => {
  const FINTECH_SUBINDUSTRIES = [
    'Software Empresarial (SaaS / ERP / CRM)',
    'Fintech: Pagos y Open Banking',
  ];

  it('co_colombia_fintech aparece en query packs con señal fintech', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: FINTECH_SUBINDUSTRIES,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: FINTECH_SUBINDUSTRIES,
      searchStrategy: strategy,
    });
    const fintechInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_colombia_fintech',
    );
    assert.ok(fintechInPacks, 'Colombia Fintech debe generar queries con señal fintech');
    const swInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_software_empresarial',
    );
    assert.ok(swInPacks, 'co_software_empresarial debe seguir presente aunque haya fintech');
  });

  it('co_secop2_proveedores no aparece sin señal B2G aunque haya fintech', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: FINTECH_SUBINDUSTRIES,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: FINTECH_SUBINDUSTRIES,
      searchStrategy: strategy,
    });
    const secopInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_secop2_proveedores',
    );
    assert.ok(!secopInPacks, 'SECOP no debe generar queries sin B2G aunque haya fintech');
  });
});

// ─── F3: Colombia + Tecnología + B2G ──────────────────────────────────────────

describe('F3 — Colombia + Tecnología + B2G: SECOP permitido con señal gobierno', () => {
  it('co_secop2_proveedores aparece con additionalCriteria de gobierno/contratación pública', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: 'Proveedores sector público, licitaciones gobierno Colombia B2G',
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      searchStrategy: strategy,
      additionalCriteria: 'Proveedores sector público, licitaciones gobierno Colombia B2G',
    });
    const secopInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_secop2_proveedores',
    );
    assert.ok(secopInPacks, 'SECOP debe generar queries con señal B2G explícita');
  });

  it('co_rues sigue sin generar queries aunque haya B2G', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: 'licitación gobierno contratación pública',
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      searchStrategy: strategy,
      additionalCriteria: 'licitación gobierno contratación pública',
    });
    const ruesInPacks = investigation.query_packs.some((q) => q.query_source_key === 'co_rues');
    assert.ok(!ruesInPacks, 'RUES no debe generar queries aunque haya B2G');
  });
});

// ─── F4: Colombia + Tecnología + ANDICOM explícito ────────────────────────────

describe('F4 — Colombia + Tecnología + ANDICOM explícito: contextual_signal', () => {
  it('co_andicom genera queries con additionalCriteria mencionando ANDICOM', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: 'Empresas expositoras ANDICOM 2025, sponsors CINTEL',
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      searchStrategy: strategy,
      additionalCriteria: 'Empresas expositoras ANDICOM 2025, sponsors CINTEL',
    });
    const andicomInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_andicom',
    );
    assert.ok(andicomInPacks, 'ANDICOM debe generar queries cuando se menciona explícitamente');

    const andicomQuery = investigation.query_packs.find(
      (q) => q.query_source_key === 'co_andicom',
    );
    assert.ok(andicomQuery, 'ANDICOM query pack debe existir');
    assert.equal(andicomQuery!.priority, 'low', 'ANDICOM debe ser low priority (contextual_signal, no discovery_seed)');
  });

  it('co_andicom no genera query automática sin mención en additionalCriteria', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: null,
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      searchStrategy: strategy,
      additionalCriteria: null,
    });
    const andicomInPacks = investigation.query_packs.some(
      (q) => q.query_source_key === 'co_andicom',
    );
    assert.ok(!andicomInPacks, 'ANDICOM no debe generar query automática sin mención explícita');
  });
});

// ─── F5: Standard cap ──────────────────────────────────────────────────────────

describe('F5 — Standard cap: total <= 16, source-guided priorizadas', () => {
  it('total queries ejecutadas <= STANDARD_TOTAL_QUERY_CAP (16)', async () => {
    const { pipeline, capturedQueries } = pipelineCapturingQueries(1);
    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)', 'Edtech: Plataformas de Aprendizaje'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 4,
        targetPersistibleCandidates: 100,
      },
      undefined,
      pipeline,
    );
    const total = capturedQueries.flat().length;
    assert.ok(total <= 16, `total queries ${total} debe ser ≤ 16 (STANDARD_TOTAL_QUERY_CAP)`);
    for (const roundQueries of capturedQueries) {
      assert.ok(roundQueries.length <= 4, `ronda con ${roundQueries.length} queries excede perRoundCap=4`);
    }
  });

  it('source-guided queries aparecen al inicio de las queries de cada ronda (priorizadas)', async () => {
    const { pipeline, capturedQueries } = pipelineCapturingQueries(1);
    const output = await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 2,
        targetPersistibleCandidates: 100,
      },
      undefined,
      pipeline,
    );

    const runtime = output.searchStrategyRuntime as SearchStrategyRuntimeMetadata;
    assert.ok(runtime.source_guided_queries_allowed >= 0, 'source_guided_queries_allowed debe ser >= 0');

    const firstRoundQueries = capturedQueries[0] ?? [];
    if (firstRoundQueries.length > 0) {
      const firstQuery = firstRoundQueries[0];
      const isSourceGuided = firstQuery.includes('ERP') || firstQuery.includes('implementador') ||
        firstQuery.includes('software empresarial') || firstQuery.includes('nomina') ||
        firstQuery.includes('LMS') || firstQuery.includes('SaaS') ||
        firstQuery.includes('facturacion') || firstQuery.includes('BI');
      assert.ok(isSourceGuided, `La primera query de R1 debería ser source-guided, got: ${firstQuery}`);
    }
  });
});

// ─── F6: No regression ────────────────────────────────────────────────────────

describe('F6 — No regression: searchStrategyRuntime + metadata', () => {
  it('searchStrategyRuntime presente y consistente', async () => {
    const { pipeline } = pipelineCapturingQueries();
    const output = await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 1,
        targetPersistibleCandidates: 0,
      },
      undefined,
      pipeline,
    );
    const runtime = output.searchStrategyRuntime as SearchStrategyRuntimeMetadata;
    assert.ok(runtime, 'searchStrategyRuntime debe estar presente');
    assert.equal(runtime.enabled, true);
    assert.equal(typeof runtime.source_guided_queries_allowed, 'number');
    assert.equal(typeof runtime.source_guided_queries_blocked, 'number');
    assert.equal(typeof runtime.fallback_queries_allowed, 'number');
  });

  it('source_guided_investigation en metadata del output (dryRun=true)', async () => {
    const { pipeline } = pipelineCapturingQueries();
    const output = await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 1,
        targetPersistibleCandidates: 0,
      },
      undefined,
      pipeline,
    );
    const sgi = output.metadata.source_guided_investigation;
    assert.ok(sgi, 'source_guided_investigation debe estar en metadata');
    assert.equal(sgi!.enabled, true);
    assert.equal(sgi!.version, 'source_guided_investigation_v1_12');
    assert.ok(sgi!.generated_query_count > 0, 'debe haber queries generadas');
    assert.ok(Array.isArray(sgi!.query_packs), 'query_packs debe ser array');
  });

  it('source_guided_investigation en extraBatchMetadata (dryRun=false)', async () => {
    const { writer, captured } = mockWriterCapturing();
    const { pipeline } = pipelineCapturingQueries();

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: false,
        maxRounds: 1, targetPersistibleCandidates: 0,
      },
      writer,
      pipeline,
    );

    const meta = captured.extraBatchMetadata!;
    assert.ok(meta['source_guided_investigation'], 'source_guided_investigation debe estar en extraBatchMetadata');
    const sgi = meta['source_guided_investigation'] as Record<string, unknown>;
    assert.equal(sgi['enabled'], true);
    assert.equal(sgi['version'], 'source_guided_investigation_v1_12');
  });

  it('search_plan, discovery_strategy, search_strategy y source_guided_investigation coexisten', async () => {
    const { writer, captured } = mockWriterCapturing();
    const { pipeline } = pipelineCapturingQueries();

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: false,
        maxRounds: 1, targetPersistibleCandidates: 0,
      },
      writer,
      pipeline,
    );

    const meta = captured.extraBatchMetadata!;
    assert.ok(meta['search_plan'], 'search_plan debe estar presente');
    assert.ok(meta['discovery_strategy'], 'discovery_strategy debe estar presente');
    assert.ok(meta['search_strategy'], 'search_strategy debe estar presente');
    assert.ok(meta['search_strategy_runtime'], 'search_strategy_runtime debe estar presente');
    assert.ok(meta['source_guided_investigation'], 'source_guided_investigation debe estar presente');
  });
});

// ─── F7: getSourceGuidedQueriesForRound ──────────────────────────────────────

describe('F7 — getSourceGuidedQueriesForRound utility', () => {
  it('R1 devuelve queries high + medium priority', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      searchStrategy: strategy,
    });
    const r1Queries = getSourceGuidedQueriesForRound(investigation, 1);
    assert.ok(r1Queries.length > 0, 'R1 debe tener queries source-guided');
    const hasHigh = investigation.query_packs.some(
      (q) => q.priority === 'high' && r1Queries.includes(q.query_text),
    );
    assert.ok(hasHigh, 'R1 debe incluir queries de alta prioridad');
  });

  it('R2 devuelve queries high + medium + low priority', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
    });
    const investigation = buildSourceGuidedInvestigationQueries({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      searchStrategy: strategy,
    });
    const r2Queries = getSourceGuidedQueriesForRound(investigation, 2);
    assert.ok(r2Queries.length > 0, 'R2 debe tener queries source-guided');
  });
});
