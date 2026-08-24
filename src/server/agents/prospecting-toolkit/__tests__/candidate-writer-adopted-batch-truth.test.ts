/**
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-2 — BATCH TRUTHFULNESS sobre el
 * ESCRITOR REAL.
 *
 * La suite pura (`adopted-batch-truth.test.ts`) fija la política. Esta fija que
 * el escritor la EJERCE: que la UPDATE de adopción que sale de verdad hacia la
 * base no lleva las columnas de identidad global cuando el lote ya las tenía, y
 * que la ruta de CREACIÓN —§ 11— sigue poblándolas exactamente como siempre.
 *
 * Offline y determinista: cliente admin falso inyectado. Sin Supabase, sin red,
 * sin credenciales, 0 créditos, 0 migraciones.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { writeProspectingCandidates } from '../candidate-writer';

import type { CandidateWriterInput, CatalogContextResult } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Minimal CatalogContextResult for test fixtures.
const FAKE_CATALOG_CONTEXT: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'EdTech',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
// ─── UUIDs de fixtures ────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const EXISTING_BATCH_ID = 'batch-0001-0000-0000-0000-000000000001';
const NEW_BATCH_ID = 'batch-9999-0000-0000-0000-000000000099';

// ─── Fake admin client ────────────────────────────────────────────────────────

/**
 * A minimal chainable/thenable builder used by the fake Supabase client.
 * Supports the chained API used by candidate-writer and novelty-checker.
 */
class ChainResult {
  constructor(private readonly _val: unknown) {}

  eq(_col: string, _val: unknown): ChainResult { return this; }
  neq(_col: string, _val: unknown): ChainResult { return this; }
  in(_col: string, _vals: unknown[]): ChainResult { return this; }
  not(_col: string, _op: string, _val: unknown): ChainResult { return this; }
  gte(_col: string, _val: unknown): ChainResult { return this; }
  limit(_n: number): ChainResult { return this; }
  select(_cols: string): ChainResult { return this; }

  /** Makes the object directly awaitable (thenable). */
  then<T>(
    onFulfilled: (v: unknown) => T | PromiseLike<T>,
    onRejected?: (r: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this._val).then(onFulfilled, onRejected);
  }

  single(): Promise<unknown> {
    return Promise.resolve(this._val);
  }
}

type FakeBatchRow = {
  id: string;
  status: string;
  source: string;
  created_by: string | null;
  owner_id: string | null;
  metadata: Record<string, unknown>;
  client_request_id: string | null;
  // CUT-2 § 3 — las seis columnas de identidad global forman parte de la fila
  // que el escritor LEE antes de adoptar.
  name: string | null;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  target_count: number | null;
  search_depth: string | null;
};

type FakeAdminStats = {
  batchInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
  candidateInsertCalls: Record<string, unknown>[];
  auditInsertCalls: Record<string, unknown>[];
};

type FakeAdminConfig = {
  /** Filas durables que el lote YA contenía (CUT-1). */
  preExistingDurableCount?: number;
  existingBatch?: FakeBatchRow | null;
  batchSelectError?: { message: string } | null;
  batchUpdateError?: { message: string } | null;
  newBatchId?: string;
};

function makeFakeAdmin(
  config: FakeAdminConfig,
  stats: FakeAdminStats,
): SupabaseClient {
  let candidateSeq = 0;

  return {
    // CUT-3B4-CORRECCIÓN — la 126 SIN aplicar se declara como lo hace la BASE.
    // Omitir `rpc` modelaría un cliente no soportado, y eso degrada CERRADO.
    rpc: preM126Rpc,
    from(table: string) {
      // ── prospect_batches ──────────────────────────────────────────────────
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                // buildRecentIdentityKeySet uses .eq('source', ...).gte(...) — return ChainResult
                // that is thenable (empty data → no identity keys) and also supports .single()
                if (_col === 'source') {
                  return new ChainResult({ data: [], error: null });
                }
                // Default: batch lookup by id → .single()
                return {
                  single() {
                    if (config.batchSelectError) {
                      return Promise.resolve({ data: null, error: config.batchSelectError });
                    }
                    return Promise.resolve({
                      data: config.existingBatch ?? null,
                      error: config.existingBatch ? null : { message: 'Not found' },
                    });
                  },
                };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return new ChainResult({ error: config.batchUpdateError ?? null });
          },
          insert(data: Record<string, unknown>) {
            stats.batchInsertCalls.push({ ...data });
            return {
              select(_cols: string) {
                return {
                  single() {
                    return Promise.resolve({
                      data: { id: config.newBatchId ?? NEW_BATCH_ID },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      // ── prospect_candidates ───────────────────────────────────────────────
      if (table === 'prospect_candidates') {
        return {
          select(_cols: string, opts?: { count?: string; head?: boolean }) {
            // CUT-1 § 7 — la sonda durable pide `head: true` con conteo exacto.
            // El resto de lecturas (novelty) devuelven historial vacío.
            if (opts?.head === true) {
              return new ChainResult({
                data: null,
                count: config.preExistingDurableCount ?? 0,
                error: null,
              });
            }
            return new ChainResult({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            const id = `cand-fake-${++candidateSeq}`;
            return {
              select(_cols: string) {
                return {
                  single() {
                    return Promise.resolve({ data: { id }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      // ── prospect_candidate_audit ──────────────────────────────────────────
      if (table === 'prospect_candidate_audit') {
        return {
          insert(data: Record<string, unknown>) {
            stats.auditInsertCalls.push({ ...data });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }

      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

// ─── Pipeline output de prueba ────────────────────────────────────────────────

function makePipelineOutput(candidateCount = 1) {
  const candidates = Array.from({ length: candidateCount }, (_, i) => ({
    name: `Empresa Test ${i + 1}`,
    website: `https://empresa-test-${i + 1}.com.co`,
    domain: `empresa-test-${i + 1}.com.co`,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'EdTech',
    sourceUrl: `https://source-${i + 1}.com`,
    sourceTitle: `Empresa Test ${i + 1} - Software empresarial en Colombia`,
    sourceSnippet: `Empresa colombiana de software empresarial para clientes corporativos en Colombia.`,
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: { name: `Empresa Test ${i + 1}`, website: `https://empresa-test-${i + 1}.com.co`, domain: `empresa-test-${i + 1}.com.co` },
      checkedSources: ['sellup' as const],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'high_quality_new' as const,
      confidenceScore: 0.9,
      fitScore: 0.85,
      dataCompletenessScore: 0.8,
      recommendedAction: 'approve_for_review' as const,
      breakdown: { existenceSignals: 1, websiteSignals: 1, duplicateSignals: 1, sourceSignals: 1, fitSignals: 1, completenessSignals: 1, penalties: 0 },
      reasons: [],
      warnings: [],
      blockers: [],
    },
  }));

  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'EdTech',
      webSearchProvider: 'mock' as const,
      mode: 'multi_query' as const,
    },
    catalogContext: FAKE_CATALOG_CONTEXT,
    searchQuery: 'EdTech Colombia',
    webSearch: {
      provider: 'mock' as const,
      query: 'test',
      results: [],
      resultsCount: candidateCount,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: candidateCount,
      searched: candidateCount,
      returned: candidateCount,
      highQualityNew: candidateCount,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      provider: 'mock',
      pipelineVersion: 'test-v1',
      executedAt: '2026-06-17T00:00:00.000Z',
    },
  };
}

function makeInput(overrides: Partial<CandidateWriterInput> = {}): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput(1),
    triggeredByUserId: USER_A,
    ownerId: USER_A,
    source: 'agent_1',
    dryRun: false,
    ...overrides,
  };
}

function makeDraftBatch(overrides: Partial<FakeBatchRow> = {}): FakeBatchRow {
  return {
    id: EXISTING_BATCH_ID,
    status: 'draft',
    source: 'agent_1',
    created_by: USER_A,
    owner_id: USER_A,
    metadata: {
      request_source: 'chat_wizard',
      catalog_version_id: 'v2024-01',
      industry_id: 'edtech-001',
      subindustry_ids: ['sub-a', 'sub-b'],
      country_code: 'CO',
      additional_criteria: null,
    },
    client_request_id: 'req-uuid-0001-0000-0000-000000000001',
    // § 14 CASO A — la petición del usuario, ya establecida en la fila.
    // El nombre es el rótulo PROVISIONAL que deja `reserveWizardExecutionSlot`.
    name: 'Wizard: edtech-001 / CO',
    country: 'Colombia',
    country_code: 'CO',
    industry: 'pharmaceuticals',
    target_count: 10,
    search_depth: 'standard',
    ...overrides,
  };
}


/**
 * REVIEW-1 § 6 — `name` NO está aquí: es columna de PRESENTACIÓN y el escritor la
 * canonicaliza en cada adopción, como siempre.
 */
const REQUEST_GLOBAL_COLUMNS = [
  'country',
  'country_code',
  'industry',
  'target_count',
  'search_depth',
] as const;

function freshStats(): FakeAdminStats {
  return {
    batchInsertCalls: [],
    batchUpdateCalls: [],
    candidateInsertCalls: [],
    auditInsertCalls: [],
  };
}

/** La UPDATE de adopción es la PRIMERA escritura sobre el lote. */
const adoptionUpdate = (stats: FakeAdminStats) => stats.batchUpdateCalls[0] ?? {};
/** La post-bucle es la última: lleva la metadata final. */
const finalUpdate = (stats: FakeAdminStats) =>
  stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1] ?? {};

// ─── § 14 CASO A / CASO B ─────────────────────────────────────────────────────

describe('CUT-2 § 14 CASO A — adoptar no reescribe la identidad global del lote', () => {
  it('el contribuyente de pago llega con otro objetivo, país, industria y nombre y NO pisa ninguno', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      { existingBatch: makeDraftBatch(), preExistingDurableCount: 7 },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({
        existingBatchId: EXISTING_BATCH_ID,
        batchName: 'Apollo Search',
        pipelineOutput: {
          ...makePipelineOutput(3),
          input: {
            country: 'Colombia',
            countryCode: 'CO',
            industry: 'healthcare',
            webSearchProvider: 'mock' as const,
            mode: 'multi_query' as const,
            searchDepth: 'deep' as const,
          },
        } as unknown as CandidateWriterInput['pipelineOutput'],
      }),
      admin,
    );

    assert.equal(result.batchId, EXISTING_BATCH_ID);
    assert.equal(stats.batchInsertCalls.length, 0, 'adoptar no crea un lote nuevo');

    const patch = adoptionUpdate(stats);
    for (const column of REQUEST_GLOBAL_COLUMNS) {
      assert.equal(column in patch, false, `${column} no puede viajar en la adopción`);
    }
    // REVIEW-1 § 6 — el nombre humano SÍ viaja, y no lleva proveedor dentro.
    assert.deepEqual(Object.keys(patch).sort(), ['metadata', 'name']);
    assert.equal(patch['name'], 'Apollo Search');
  });

  it('el objetivo 10 del usuario sobrevive a un residual de pago de 3 (§ 5)', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      { existingBatch: makeDraftBatch({ target_count: 10 }), preExistingDurableCount: 7 },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(3) }),
      admin,
    );

    for (const call of stats.batchUpdateCalls) {
      assert.equal('target_count' in call, false, 'ninguna escritura reintroduce el objetivo');
    }
  });

  it('CASO B — valores entrantes idénticos tampoco viajan', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      {
        existingBatch: makeDraftBatch({
          country: 'Colombia',
          country_code: 'CO',
          industry: 'EdTech',
          target_count: 1,
          search_depth: 'standard',
        }),
        preExistingDurableCount: 0,
      },
      stats,
    );

    await writeProspectingCandidates(makeInput({ existingBatchId: EXISTING_BATCH_ID }), admin);

    assert.deepEqual(Object.keys(adoptionUpdate(stats)).sort(), ['metadata', 'name']);
  });

  it('columnas que el lote NO tenía se establecen (la reserva del wizard las deja NULL)', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      {
        // Fila tal y como la deja `reserveWizardExecutionSlot`: sólo nombre.
        existingBatch: makeDraftBatch({
          country: null,
          country_code: null,
          industry: null,
          target_count: null,
        }),
        preExistingDurableCount: 0,
      },
      stats,
    );

    await writeProspectingCandidates(makeInput({ existingBatchId: EXISTING_BATCH_ID }), admin);

    const patch = adoptionUpdate(stats);
    assert.equal(patch['country'], 'Colombia');
    assert.equal(patch['country_code'], 'CO');
    assert.equal(patch['industry'], 'EdTech');
    assert.equal(patch['target_count'], 1);
    assert.equal(typeof patch['name'], 'string', 'el nombre es de presentación y siempre viaja');
    assert.equal('search_depth' in patch, false, 'NOT NULL DEFAULT ⇒ nunca sin establecer');
  });
});

// ─── § 14 CASO C / CASO D — metadata ─────────────────────────────────────────

describe('CUT-2 § 14 CASO C/D — metadata gratuita y metadata del contribuyente', () => {
  it('CASO C — el bloque gratuito y el del escritor conviven en la metadata final', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      {
        existingBatch: makeDraftBatch({
          metadata: {
            request_source: 'chat_wizard',
            discovery_layer: 'country_source',
            macro_industry_key: 'health_pharma',
          },
        }),
        preExistingDurableCount: 7,
      },
      stats,
    );

    await writeProspectingCandidates(makeInput({ existingBatchId: EXISTING_BATCH_ID }), admin);

    const meta = finalUpdate(stats)['metadata'] as Record<string, unknown>;
    assert.equal(meta['discovery_layer'], 'country_source');
    assert.equal(meta['macro_industry_key'], 'health_pharma');
    assert.equal(meta['request_source'], 'chat_wizard');
    assert.equal(meta['generated_by'], 'agent_1_candidate_writer');
    assert.ok(meta['pipeline_summary'] != null);
  });

  it('CASO D — el escritor no pisa una clave protegida que ya estaba', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      {
        existingBatch: makeDraftBatch({
          metadata: {
            request_source: 'chat_wizard',
            // Clave que el escritor TAMBIÉN produce (bloque observacional) pero
            // que aquí ya la puso otro contribuyente.
            discovery_layer: 'country_source',
            apollo_discovery_taxonomy: {
              mode: 'macro_industry',
              macro_industry_key: 'health_pharma',
              requested_subindustries: ['Farmacéutica'],
            },
          },
        }),
        preExistingDurableCount: 7,
      },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({
        existingBatchId: EXISTING_BATCH_ID,
        extraBatchMetadata: {
          // Paso a través: NO es del escritor. Antes ganaba y degradaba la
          // taxonomía rica de la reserva a su versión pobre.
          apollo_discovery_taxonomy: { mode: 'macro_industry' },
          discovery_layer: 'apollo_paid',
        },
      }),
      admin,
    );

    const meta = finalUpdate(stats)['metadata'] as Record<string, unknown>;
    assert.deepEqual(meta['apollo_discovery_taxonomy'], {
      mode: 'macro_industry',
      macro_industry_key: 'health_pharma',
      requested_subindustries: ['Farmacéutica'],
    });
    assert.equal(meta['discovery_layer'], 'country_source');
  });

  it('la metadata del wizard sobrevive entera a la adopción', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      { existingBatch: makeDraftBatch(), preExistingDurableCount: 0 },
      stats,
    );

    await writeProspectingCandidates(makeInput({ existingBatchId: EXISTING_BATCH_ID }), admin);

    const meta = finalUpdate(stats)['metadata'] as Record<string, unknown>;
    assert.equal(meta['request_source'], 'chat_wizard');
    assert.equal(meta['catalog_version_id'], 'v2024-01');
    assert.equal(meta['industry_id'], 'edtech-001');
    assert.deepEqual(meta['subindustry_ids'], ['sub-a', 'sub-b']);
  });
});

// ─── § 11 / CASO E — la ruta de CREACIÓN no se toca ──────────────────────────

describe('CUT-2 § 11 CASO E — un lote NUEVO sigue naciendo con todos sus campos', () => {
  it('el INSERT conserva nombre, país, industria, objetivo, profundidad, estado, source y metadata', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin({ newBatchId: NEW_BATCH_ID }, stats);

    const result = await writeProspectingCandidates(makeInput(), admin);

    assert.equal(result.batchId, NEW_BATCH_ID);
    assert.equal(stats.batchInsertCalls.length, 1);

    const row = stats.batchInsertCalls[0]!;
    assert.equal(typeof row['name'], 'string');
    assert.equal(row['country'], 'Colombia');
    assert.equal(row['country_code'], 'CO');
    assert.equal(row['industry'], 'EdTech');
    assert.equal(row['target_count'], 1);
    assert.equal(row['search_depth'], 'standard');
    assert.equal(row['status'], 'ready_for_review');
    assert.equal(row['source'], 'agent_1');
    assert.ok(row['metadata'] != null);
  });

  it('la metadata del lote nuevo mantiene su forma: el paso a través se esparce AL FINAL', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin({ newBatchId: NEW_BATCH_ID }, stats);

    await writeProspectingCandidates(
      makeInput({ extraBatchMetadata: { generated_by: 'llamador', clave_extra: 1 } }),
      admin,
    );

    const meta = stats.batchInsertCalls[0]!['metadata'] as Record<string, unknown>;
    // Comportamiento histórico EXACTO: el paso a través gana sobre el bloque
    // propio en la ruta de creación, porque ahí el escritor es el dueño.
    assert.equal(meta['generated_by'], 'llamador');
    assert.equal(meta['clave_extra'], 1);
    assert.ok(meta['pipeline_summary'] != null);
  });
});

// ─── § 14 CASO F / CASO G — coexistencia con CUT-1 ───────────────────────────

describe('CUT-2 § 13/§ 14 CASO F/G — la supervivencia de CUT-1 sigue intacta', () => {
  it('CASO F — 0 inserciones sobre un lote con 7 filas durables: globales intactas y sigue revisable', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      {
        existingBatch: makeDraftBatch({ status: 'generating' }),
        preExistingDurableCount: 7,
      },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(0) }),
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    for (const call of stats.batchUpdateCalls) {
      for (const column of REQUEST_GLOBAL_COLUMNS) {
        assert.equal(column in call, false, `${column} no puede reescribirse`);
      }
    }
    const statuses = stats.batchUpdateCalls
      .map((call) => call['status'])
      .filter((value): value is string => typeof value === 'string');
    // CUT-1 § 3 — el estado terminal se escribe desde una sola AUTORIDAD, en dos
    // escrituras (la garantizada y la post-bucle con metadata) con el MISMO valor.
    assert.deepEqual(statuses, ['ready_for_review', 'ready_for_review']);
  });

  it('CASO G — con inserciones el lote pasa a revisable y las globales siguen intactas', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      { existingBatch: makeDraftBatch({ status: 'generating' }), preExistingDurableCount: 0 },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(2) }),
      admin,
    );

    assert.ok(result.candidatesCreated > 0);
    for (const call of stats.batchUpdateCalls) {
      for (const column of REQUEST_GLOBAL_COLUMNS) {
        assert.equal(column in call, false);
      }
    }
    const statuses = stats.batchUpdateCalls
      .map((call) => call['status'])
      .filter((value): value is string => typeof value === 'string');
    // CUT-1 § 3 — el estado terminal se escribe desde una sola AUTORIDAD, en dos
    // escrituras (la garantizada y la post-bucle con metadata) con el MISMO valor.
    assert.deepEqual(statuses, ['ready_for_review', 'ready_for_review']);
  });

  it('la adopción sigue sin llevar `status` (CUT-1 § 2)', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      { existingBatch: makeDraftBatch(), preExistingDurableCount: 3 },
      stats,
    );

    await writeProspectingCandidates(makeInput({ existingBatchId: EXISTING_BATCH_ID }), admin);

    assert.equal('status' in adoptionUpdate(stats), false);
  });
});

// ─── § 16 — reintentos ───────────────────────────────────────────────────────

describe('CUT-2 § 16 — un reintento es idempotente respecto de la verdad del lote', () => {
  it('dos adopciones con residuales distintos dejan las globales donde estaban', async () => {
    const batch = makeDraftBatch({ target_count: 10 });

    for (const residual of [3, 1]) {
      const stats = freshStats();
      const admin = makeFakeAdmin({ existingBatch: batch, preExistingDurableCount: 7 }, stats);

      await writeProspectingCandidates(
        makeInput({
          existingBatchId: EXISTING_BATCH_ID,
          pipelineOutput: makePipelineOutput(residual),
        }),
        admin,
      );

      for (const call of stats.batchUpdateCalls) {
        for (const column of REQUEST_GLOBAL_COLUMNS) {
          assert.equal(column in call, false, `residual ${residual}: ${column}`);
        }
      }
    }

    assert.equal(batch.target_count, 10);
    assert.equal(batch.industry, 'pharmaceuticals');
  });
});

// ─── REVIEW-1 § 6 — el nombre humano histórico sobrevive a la adopción ───────

describe('CUT-2 REVIEW-1 § 6 — el rótulo técnico de la reserva no llega al usuario', () => {
  it('reserva `Wizard: {industryId} / {countryCode}` ⇒ tras adoptar, nombre humano canónico', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      {
        existingBatch: makeDraftBatch({ name: 'Wizard: edtech-001 / CO' }),
        preExistingDurableCount: 7,
      },
      stats,
    );

    // Ni la ruta Apollo ni la Tavily del wizard pasan `batchName`, así que el
    // escritor deriva el nombre canónico de contexto GLOBAL: país e industria.
    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    const name = adoptionUpdate(stats)['name'];
    assert.equal(typeof name, 'string');
    assert.equal(
      String(name).startsWith('Wizard: '),
      false,
      'el rótulo técnico de idempotencia no puede quedar visible',
    );
    assert.ok(String(name).startsWith('Agente 1 · Pipeline · '));
    assert.ok(String(name).includes('Colombia'));
    assert.ok(String(name).includes('EdTech'));
  });

  it('el nombre canónico NO lleva el proveedor dentro', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      { existingBatch: makeDraftBatch({ name: 'Wizard: edtech-001 / CO' }), preExistingDurableCount: 0 },
      stats,
    );

    await writeProspectingCandidates(makeInput({ existingBatchId: EXISTING_BATCH_ID }), admin);

    const name = String(adoptionUpdate(stats)['name']).toLowerCase();
    for (const provider of ['apollo', 'lusha', 'tavily']) {
      assert.equal(name.includes(provider), false, `${provider} no pertenece al nombre`);
    }
  });
});

// ─── REVIEW-1 §§ 7/8/10 — el paso a través no adquiere autoridad de escritor ──

describe('CUT-2 REVIEW-1 § 7/§ 8 — canales de metadata separados en el escritor REAL', () => {
  it('`extraBatchMetadata` NO puede suplantar una clave del bloque del escritor', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      {
        existingBatch: makeDraftBatch({
          metadata: { request_source: 'chat_wizard', pipeline_summary: { requested: 10 } },
        }),
        preExistingDurableCount: 7,
      },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({
        existingBatchId: EXISTING_BATCH_ID,
        pipelineOutput: makePipelineOutput(3),
        extraBatchMetadata: {
          // Paso a través que COLISIONA con una clave del escritor. Antes de
          // REVIEW-1 los dos canales se recombinaban y este valor heredaba la
          // autoridad del escritor sólo por coincidir en el nombre.
          pipeline_summary: { requested: 999, forged: true },
          generated_by: 'llamador_falsificado',
        },
      }),
      admin,
    );

    const meta = finalUpdate(stats)['metadata'] as Record<string, unknown>;
    const summary = meta['pipeline_summary'] as Record<string, unknown>;
    assert.equal(summary['requested'], 3, 'el valor VERDADERO del escritor tiene que ganar');
    assert.equal('forged' in summary, false);
    assert.equal(meta['generated_by'], 'agent_1_candidate_writer');
  });

  it('`extraBatchMetadata` con clave nueva sigue siendo ADITIVO al adoptar', async () => {
    const stats = freshStats();
    const admin = makeFakeAdmin(
      { existingBatch: makeDraftBatch(), preExistingDurableCount: 0 },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({
        existingBatchId: EXISTING_BATCH_ID,
        extraBatchMetadata: { apollo_discovery_modality: 'two_round_adaptive' },
      }),
      admin,
    );

    const meta = finalUpdate(stats)['metadata'] as Record<string, unknown>;
    assert.equal(meta['apollo_discovery_modality'], 'two_round_adaptive');
  });
});
