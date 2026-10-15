/**
 * Tests — «Proveedores de una empresa», ronda 3 (AGENT1-SUPPLIER-SEARCH-3): lo que se
 * vio en los lotes reales de Producción del 14-10.
 *
 *  1. El escritor pisaba `metadata.search_mode` («suppliers» → «multi_query») al adoptar.
 *  2. El lote quedaba «Agente 1 · Pipeline · Colombia · Tecnología».
 *  3. (Uso de IA con la forma «Proveedores» lo trae #698.)
 *  4. Aceptadas = 0 siempre: el tamaño llega con el rescate, después de contar.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeAdoptedBatchMetadata, WIZARD_REQUEST_SEARCH_MODES } from '@/server/prospect-batches/adopted-batch-truth';
import { buildSupplierBatchName } from '../supplier-batch-name';
import {
  executeSupplierSearchRun,
  resolveSupplierRescueWindowMs,
  SUPPLIER_SEARCH_LEG_METADATA_KEY,
  type SupplierSearchRunDeps,
  type SupplierSearchRunInput,
} from '../wizard-supplier-search';
import type { ClaudeSearchLegOutcome } from '../wizard-claude-search-leg';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import {
  runClaudeCompanySearch,
  type ClaudeCompanySearchDeps,
  type CompanySearchCall,
} from '@/server/agents/prospecting-toolkit/claude-classifier/company-search-run';

describe('1. la forma de búsqueda de la petición sobrevive a la adopción', () => {
  it('«suppliers», «competitors» y «corporate_tree» no los pisa el modo del buscador', () => {
    for (const mode of WIZARD_REQUEST_SEARCH_MODES) {
      const merged = mergeAdoptedBatchMetadata({
        existingMetadata: { search_mode: mode, supplier_search: { reference_company_name: 'Ecopetrol' } },
        writerOwnedMetadata: { search_mode: 'multi_query', generated_by: 'agent_1_candidate_writer' },
        passthroughMetadata: {},
      });
      assert.equal(merged.metadata.search_mode, mode);
      assert.ok(merged.preservedKeys.includes('search_mode'));
      assert.equal(merged.metadata.generated_by, 'agent_1_candidate_writer');
    }
  });

  it('el modo del buscador sigue actualizándose en el resto de lotes', () => {
    const merged = mergeAdoptedBatchMetadata({
      existingMetadata: { search_mode: 'single_query' },
      writerOwnedMetadata: { search_mode: 'multi_query' },
      passthroughMetadata: {},
    });
    assert.equal(merged.metadata.search_mode, 'multi_query');
  });
});

describe('2. nombre del lote', () => {
  it('dice de quién son los proveedores', () => {
    assert.equal(buildSupplierBatchName('Ecopetrol', 'Colombia', 'Tecnología'), 'Proveedores de Ecopetrol · Colombia · Tecnología');
    assert.equal(buildSupplierBatchName('Cemex', 'México', ''), 'Proveedores de Cemex · México');
  });

  it('la escritura de Claude manda ese nombre al escritor', async () => {
    const writes: Array<Parameters<ClaudeCompanySearchDeps['writeCandidates']>[0]> = [];
    const call: CompanySearchCall = {
      results: [{ title: 'Minsait', url: 'https://minsait.com', rank: 1, provider: 'claude' }],
      proposed: 1,
      rejected: {},
      usage: null,
      errorCode: null,
      query: 'q',
      durationMs: 1,
    };
    await runClaudeCompanySearch(
      { sourceBatchId: 'b1', triggeredBy: 'u1', writeIntoSourceBatch: true },
      {
        loadSourceBatch: async () => ({
          id: 'b1',
          country: 'Colombia',
          countryCode: 'CO',
          industry: 'Tecnología',
          industryId: null,
          macroIndustryKey: 'technology',
          subindustries: [],
          additionalCriteria: null,
          referenceCompanyName: 'Ecopetrol',
        }),
        loadExcludedDomains: async () => [],
        countPreviousRuns: async () => 0,
        resolveRegions: () => [],
        resolveActiveModel: async () => ({ model: 'm', apiKey: 'k' }),
        checkQuota: async () => ({ allowed: true }),
        runSearch: async () => ({ pipelineOutput: {}, calls: [call] }),
        writeCandidates: async (params) => (writes.push(params), { batchId: 'b1', candidatesCreated: 1, errors: [] }),
        logUsage: async () => true,
        newRunId: () => 'r',
        nowIso: () => '2026-10-14T00:00:00Z',
        nowMs: () => 0,
      },
    );
    assert.equal(writes[0].batchName, 'Proveedores de Ecopetrol · Colombia · Tecnología');
  });
});

describe('4. aceptadas tras el rescate de Claude dentro de la corrida', () => {
  const CATALOG = {
    country: { code: 'CO', name: 'Colombia' },
    catalog: { version: '2.0.0' },
    industry: { id: '223e4567-e89b-12d3-a456-426614174001', slug: 'technology', name: 'Tecnología' },
    subindustries: [],
  } as unknown as CatalogResolutionOutput;
  const INPUT: SupplierSearchRunInput = {
    userId: 'u1',
    clientRequestId: '423e4567-e89b-12d3-a456-426614174003',
    countryCode: 'CO',
    countryName: 'Colombia',
    catalogVersion: '2.0.0',
    additionalCriteria: null,
    referenceCompanyName: 'Ecopetrol',
    catalogResolution: CATALOG,
    searchDepth: 'standard',
  };
  const LEG: ClaudeSearchLegOutcome = {
    executed: true,
    persistedCandidates: 3,
    completeValidCandidates: 0,
    acceptedIdentities: [],
    estimatedCostUsd: 0.25,
    proposed: 10,
    passedPreFilter: 3,
  };

  function deps(overrides: Partial<SupplierSearchRunDeps> = {}) {
    const seals: Array<{ status: string; metadata?: Record<string, unknown> | null }> = [];
    const rescues: Array<{ batchId: string; windowMs: number }> = [];
    const d: SupplierSearchRunDeps = {
      resolveSupplierSearchEnabled: () => true,
      runClaudeSupplierSearch: async () => LEG,
      checkPersistenceReadiness: async () => ({ status: 'available' as const }),
      reserveSlot: async () => ({ status: 'reserved', batchId: 'b1' }),
      sealFreeOnlyBatchStatus: async (input) => {
        seals.push(input);
      },
      rescueBatchInline: async (input) => (rescues.push(input), true),
      listAcceptedCandidateIds: async () => ['c1', 'c2'],
      countCompetitorBatchOutcome: async () => ({ reviewable: 10, hubspotDuplicates: 0, sellupDuplicates: 0 }),
      actionStartedAtMs: 0,
      nowMs: () => 100_000,
      ...overrides,
    };
    return { d, seals, rescues };
  }

  it('el rescate corre dentro y la aceptación cuenta lo que quedó completo', async () => {
    const f = deps();
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.deepEqual(f.rescues, [{ batchId: 'b1', windowMs: 60_000 }]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 2);
    assert.equal(result.candidateCount, 3);
    const legMeta = f.seals[0].metadata?.[SUPPLIER_SEARCH_LEG_METADATA_KEY] as { inline_rescue: Record<string, unknown> };
    assert.deepEqual(legMeta.inline_rescue, { reviewed: true, window_ms: 60_000, accepted_after_rescue: 2 });
  });

  it('si el rescate falla, se queda la aceptación del escritor', async () => {
    const f = deps({ rescueBatchInline: async () => false });
    const result = await executeSupplierSearchRun(INPUT, f.d);
    assert.equal(result.ok && result.acceptedForTarget?.acceptedForTargetTotal, 0);
  });

  it('sin empresas escritas o sin tiempo no se revisa', async () => {
    const empty = deps({ runClaudeSupplierSearch: async () => ({ ...LEG, persistedCandidates: 0 }) });
    await executeSupplierSearchRun(INPUT, empty.d);
    assert.equal(empty.rescues.length, 0);

    const late = deps({ nowMs: () => 200_000 });
    await executeSupplierSearchRun(INPUT, late.d);
    assert.equal(late.rescues.length, 0);
  });

  it('ventana: 60 s como mucho, nunca dentro de los últimos 90 s', () => {
    assert.equal(resolveSupplierRescueWindowMs(100_000), 60_000);
    assert.equal(resolveSupplierRescueWindowMs(180_000), 30_000);
    assert.equal(resolveSupplierRescueWindowMs(200_000), null);
    assert.equal(resolveSupplierRescueWindowMs(null), null);
  });
});
