/**
 * Tests — Search Quality v1.8.1 — Runtime Wiring de Search Strategy
 *
 * Verifica que SearchStrategyV1 está cableada al flujo real del wizard:
 *   - filterQueriesByStrategy bloquea source-guided queries de fuentes no permitidas
 *   - searchStrategyRuntime queda presente en el output (dryRun=true)
 *   - search_strategy y search_strategy_runtime quedan en extraBatchMetadata (writer mock)
 *   - co_rues / co_personas_juridicas_cc / co_secop2 no generan queries ejecutables
 *   - co_colombia_fintech no genera query ejecutable sin señal fintech
 *   - co_software_empresarial genera query ejecutable (virtual intent siempre permitido)
 *   - co_colombia_fintech genera query ejecutable con señal fintech
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runIncrementalProspectingSearch } from '../incremental-search';
import { buildSearchStrategyFromCatalog } from '../search-strategy-builder';
import { classifyQuery } from '../query-builder';
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

/**
 * Pipeline fake que registra todas las queries que recibe.
 * rawResultsCount controla resultsCount por ronda:
 *   0 (default) → detiene en R1 por no_results_round_1
 *   >0          → permite múltiples rondas
 */
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
        query_trace_summary: {
          enabled: true,
          queries_executed: queries.map((q) => {
            const { queryType, querySourceKey } = classifyQuery(q, input.country, input.industry);
            return { query_text: q, query_type: queryType, query_source_key: querySourceKey };
          }),
        },
      },
    };
  };
  return { pipeline, capturedQueries };
}

type WriterInput = Parameters<typeof import('../candidate-writer').writeProspectingCandidates>[0];

/** Writer fake que captura extraBatchMetadata */
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

// ─── R1: searchStrategyRuntime presente en output (dryRun=true) ───────────────

describe('R1 — searchStrategyRuntime presente en output (dryRun=true)', () => {
  it('output.searchStrategyRuntime es definido con enabled=true', async () => {
    const { pipeline } = pipelineCapturingQueries();
    const output = await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 2,
        targetPersistibleCandidates: 0,
      },
      undefined,
      pipeline,
    );
    assert.ok(output.searchStrategyRuntime, 'searchStrategyRuntime debe estar presente');
    const runtime = output.searchStrategyRuntime as SearchStrategyRuntimeMetadata;
    assert.equal(runtime.enabled, true);
    assert.equal(typeof runtime.source_guided_queries_allowed, 'number');
    assert.equal(typeof runtime.source_guided_queries_blocked, 'number');
    assert.equal(typeof runtime.fallback_queries_allowed, 'number');
    assert.ok(Array.isArray(runtime.blocked_samples));
  });

  it('fallback_queries_allowed > 0 (queries estándar siempre pasan)', async () => {
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
    assert.ok(runtime.fallback_queries_allowed > 0, `fallback_queries_allowed debe ser > 0, got: ${runtime.fallback_queries_allowed}`);
  });
});

// ─── R2: co_colombia_fintech no genera query ejecutable sin señal fintech ──────

describe('R2 — co_colombia_fintech bloqueada sin señal fintech', () => {
  const FINTECH_SOURCE_GUIDED_QUERY = 'fintech asociadas Colombia Fintech pagos Colombia empresa sitio oficial';

  it('la query fintech source-guided no aparece en pipeline sin subindustria fintech', async () => {
    const { pipeline, capturedQueries } = pipelineCapturingQueries();
    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)', 'Ciberseguridad'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 2,
        targetPersistibleCandidates: 0,
      },
      undefined,
      pipeline,
    );
    const allExecuted = capturedQueries.flat();
    assert.ok(
      !allExecuted.includes(FINTECH_SOURCE_GUIDED_QUERY),
      `Query fintech no debe ejecutarse sin señal fintech. Queries ejecutadas: ${allExecuted.join(' | ')}`,
    );
  });

  it('co_colombia_fintech en blockedSourceKeys cuando no hay señal fintech', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: null,
    });
    assert.ok(
      strategy.queryStrategy.blockedSourceKeys.includes('co_colombia_fintech'),
      'co_colombia_fintech debe estar en blockedSourceKeys sin señal fintech',
    );
  });

  it('classifyQuery mapea query fintech a co_colombia_fintech', () => {
    const { queryType, querySourceKey } = classifyQuery(
      FINTECH_SOURCE_GUIDED_QUERY, 'Colombia', 'Tecnología',
    );
    assert.equal(queryType, 'source_guided');
    assert.equal(querySourceKey, 'co_colombia_fintech');
  });
});

// ─── R3: co_colombia_fintech genera query ejecutable con señal fintech ─────────

describe('R3 — co_colombia_fintech permitida con señal fintech', () => {
  it('query fintech source-guided aparece en pipeline con subindustria fintech', async () => {
    const { pipeline, capturedQueries } = pipelineCapturingQueries();
    const output = await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Fintech: Pagos y Open Banking', 'Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 1,
        targetPersistibleCandidates: 0,
      },
      undefined,
      pipeline,
    );
    const runtime = output.searchStrategyRuntime as SearchStrategyRuntimeMetadata;
    const allExecuted = capturedQueries.flat();
    const FINTECH_QUERY = 'fintech asociadas Colombia Fintech pagos Colombia empresa sitio oficial';
    assert.ok(
      allExecuted.includes(FINTECH_QUERY),
      `Query fintech debe ejecutarse con señal fintech. Queries ejecutadas: ${allExecuted.join(' | ')}`,
    );
    assert.ok(
      runtime.source_guided_queries_allowed > 0,
      `source_guided_queries_allowed debe ser > 0, got: ${runtime.source_guided_queries_allowed}`,
    );
  });

  it('co_colombia_fintech NO está en blockedSourceKeys cuando hay señal fintech', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Fintech: Pagos y Open Banking'],
      additionalCriteria: null,
    });
    assert.ok(
      !strategy.queryStrategy.blockedSourceKeys.includes('co_colombia_fintech'),
      'co_colombia_fintech NO debe estar en blockedSourceKeys con señal fintech',
    );
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_colombia_fintech');
    assert.equal(dec?.role, 'sector_signal', 'con señal fintech debe ser sector_signal');
  });
});

// ─── R4: co_software_empresarial (virtual intent) genera query ejecutable ──────

describe('R4 — co_software_empresarial genera query ejecutable (R2)', () => {
  const SOFTWARE_EMPRESARIAL_QUERY = 'empresa software empresarial Colombia clientes corporativos sitio oficial';

  it('co_software_empresarial está en sourceGuidedQuerySeeds (virtual intent Colombia)', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: null,
    });
    assert.ok(
      strategy.queryStrategy.sourceGuidedQuerySeeds.includes('co_software_empresarial'),
      'co_software_empresarial debe estar en sourceGuidedQuerySeeds como virtual intent',
    );
    assert.ok(
      !strategy.queryStrategy.blockedSourceKeys.includes('co_software_empresarial'),
      'co_software_empresarial NO debe estar en blockedSourceKeys',
    );
  });

  it('classifyQuery mapea software empresarial query a co_software_empresarial', () => {
    const { queryType, querySourceKey } = classifyQuery(
      SOFTWARE_EMPRESARIAL_QUERY, 'Colombia', 'Tecnología',
    );
    assert.equal(queryType, 'source_guided');
    assert.equal(querySourceKey, 'co_software_empresarial');
  });

  it('query software empresarial aparece en R2 y es ejecutable', async () => {
    // rawResultsCount=1 evita no_results_round_1 para que R2 se ejecute.
    // targetPersistibleCandidates=100 evita early stop por target_reached.
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
    const allExecuted = capturedQueries.flat();
    assert.ok(
      allExecuted.includes(SOFTWARE_EMPRESARIAL_QUERY),
      `Query software empresarial debe ejecutarse en R2. Queries ejecutadas: ${allExecuted.join(' | ')}`,
    );
    assert.ok(
      runtime.source_guided_queries_allowed >= 1,
      `source_guided_queries_allowed debe ser >= 1, got: ${runtime.source_guided_queries_allowed}`,
    );
  });
});

// ─── R5: co_rues / co_personas_juridicas_cc / co_secop2 no generan queries ────

describe('R5 — fuentes legal_registry y blocked no generan queries ejecutables', () => {
  it('co_rues no aparece como query_source_key en ninguna query ejecutada', async () => {
    const { pipeline, capturedQueries } = pipelineCapturingQueries();
    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 2,
        targetPersistibleCandidates: 0,
      },
      undefined,
      pipeline,
    );
    const allExecuted = capturedQueries.flat();
    for (const q of allExecuted) {
      const { querySourceKey } = classifyQuery(q, 'Colombia', 'Tecnología');
      assert.notEqual(querySourceKey, 'co_rues', `Query "${q}" no debe mapear a co_rues`);
    }
  });

  it('co_personas_juridicas_cc no aparece como query_source_key en ninguna query ejecutada', async () => {
    const { pipeline, capturedQueries } = pipelineCapturingQueries();
    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 2,
        targetPersistibleCandidates: 0,
      },
      undefined,
      pipeline,
    );
    const allExecuted = capturedQueries.flat();
    for (const q of allExecuted) {
      const { querySourceKey } = classifyQuery(q, 'Colombia', 'Tecnología');
      assert.notEqual(querySourceKey, 'co_personas_juridicas_cc');
    }
  });

  it('co_secop2 en blockedSourceKeys (not_for_ai_flow)', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: null,
    });
    assert.ok(
      strategy.queryStrategy.blockedSourceKeys.includes('co_secop2'),
      'co_secop2 debe estar en blockedSourceKeys',
    );
  });

  it('co_andicom no genera discovery automático (contextual_signal, no discovery_seed)', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: null,
    });
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_andicom');
    assert.ok(dec, 'co_andicom debe tener decisión');
    assert.equal(dec!.role, 'contextual_signal');
    assert.equal(dec!.allowedForDiscovery, false, 'co_andicom no debe ser discovery_seed');
  });
});

// ─── R6: B2G — co_secop2_proveedores sector_signal con señal gobierno ─────────

describe('R6 — co_secop2_proveedores habilitado con señal B2G', () => {
  it('co_secop2_proveedores → sector_signal con additionalCriteria gobierno/B2G', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: 'Proveedores sector público, licitaciones gobierno Colombia B2G',
    });
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_secop2_proveedores');
    assert.ok(dec, 'co_secop2_proveedores debe tener decisión');
    assert.equal(dec!.role, 'sector_signal', `con señal B2G debe ser sector_signal, got: ${dec!.role}`);
    assert.equal(dec!.allowedForSourceGuidedQueries, true, 'con B2G debe estar permitido para source-guided queries');
  });

  it('co_secop2_proveedores → enrichment_only sin señal B2G', () => {
    const strategy = buildSearchStrategyFromCatalog({
      countryCode: 'CO', country: 'Colombia', industry: 'Tecnología',
      subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
      additionalCriteria: null,
    });
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_secop2_proveedores');
    assert.ok(dec, 'co_secop2_proveedores debe tener decisión');
    assert.equal(dec!.role, 'enrichment_only', `sin B2G debe ser enrichment_only, got: ${dec!.role}`);
  });
});

// ─── R7: Metadata — search_strategy y search_strategy_runtime en writer ───────

describe('R7 — search_strategy y search_strategy_runtime en extraBatchMetadata (writer mock)', () => {
  it('el writer recibe search_strategy con version=search_strategy_v1_8', async () => {
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

    assert.ok(captured.extraBatchMetadata, 'extraBatchMetadata debe estar presente');
    const meta = captured.extraBatchMetadata!;
    assert.ok(meta['search_strategy'], 'search_strategy debe estar en extraBatchMetadata');
    const ss = meta['search_strategy'] as Record<string, unknown>;
    assert.equal(ss['version'], 'search_strategy_v1_8', `search_strategy.version debe ser search_strategy_v1_8, got: ${ss['version']}`);
    assert.equal(ss['countryCode'], 'CO');
    assert.ok(Array.isArray((ss['sourceDecisions'] as unknown[])), 'sourceDecisions debe ser array');
  });

  it('el writer recibe search_strategy_runtime con enabled=true', async () => {
    const { writer, captured } = mockWriterCapturing();
    const { pipeline } = pipelineCapturingQueries();

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: false,
        maxRounds: 2, targetPersistibleCandidates: 0,
      },
      writer,
      pipeline,
    );

    const meta = captured.extraBatchMetadata!;
    assert.ok(meta['search_strategy_runtime'], 'search_strategy_runtime debe estar en extraBatchMetadata');
    const runtime = meta['search_strategy_runtime'] as Record<string, unknown>;
    assert.equal(runtime['enabled'], true);
    assert.equal(typeof runtime['source_guided_queries_allowed'], 'number');
    assert.equal(typeof runtime['source_guided_queries_blocked'], 'number');
    assert.equal(typeof runtime['fallback_queries_allowed'], 'number');
    assert.ok(Array.isArray(runtime['blocked_samples']));
  });

  it('fallback_queries_allowed coincide con queries estándar ejecutadas', async () => {
    const { writer, captured } = mockWriterCapturing();
    const { pipeline, capturedQueries } = pipelineCapturingQueries();

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: false,
        maxRounds: 2, targetPersistibleCandidates: 0,
      },
      writer,
      pipeline,
    );

    const meta = captured.extraBatchMetadata!;
    const runtime = meta['search_strategy_runtime'] as Record<string, unknown>;
    const allExecuted = capturedQueries.flat();
    const standardQueriesCount = allExecuted.filter((q) => {
      const { queryType } = classifyQuery(q, 'Colombia', 'Tecnología');
      return queryType === 'standard';
    }).length;
    assert.equal(
      runtime['fallback_queries_allowed'],
      standardQueriesCount,
      `fallback_queries_allowed debe coincidir con queries estándar ejecutadas`,
    );
  });

  it('search_plan, discovery_strategy y search_strategy coexisten en extraBatchMetadata', async () => {
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
  });
});

// ─── R8: v1.3 query cap sigue operando con filtro de estrategia activo ─────────

describe('R8 — query cap v1.3 sigue operando con strategy filter activo', () => {
  it('total queries ejecutadas ≤ STANDARD_TOTAL_QUERY_CAP después del strategy filter', async () => {
    const { pipeline, capturedQueries } = pipelineCapturingQueries();

    await runIncrementalProspectingSearch(
      {
        country: 'Colombia', countryCode: 'CO', industry: 'Tecnología',
        subindustries: ['Fintech: Pagos y Open Banking', 'Software Empresarial (SaaS / ERP / CRM)'],
        webSearchProvider: 'mock', dryRun: true, maxRounds: 4,
        targetPersistibleCandidates: 0,
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
});
