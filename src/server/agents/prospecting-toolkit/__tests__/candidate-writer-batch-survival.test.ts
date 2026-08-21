/**
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-1 — supervivencia del lote vista
 * desde el ESCRITOR REAL.
 *
 * La suite pura fija la matriz; ésta comprueba que el escritor de candidatos la
 * USA: que lee lo que el lote ya contenía y que, con 0 inserciones propias y
 * fallos de escritura, NO degrada un lote que trae filas gratuitas dentro.
 *
 * Cliente admin falso e inyectable. Sin Supabase, sin Tavily, sin Apollo, sin
 * Lusha, sin HubSpot, sin LLM. 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { writeProspectingCandidates } from '../candidate-writer';

import type { CandidateWriterInput, CatalogContextResult } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const EXISTING_BATCH_ID = 'batch-cut1-0000-0000-0000-00000000000a';
const NEW_BATCH_ID = 'batch-cut1-0000-0000-0000-00000000000b';

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

class ChainResult {
  constructor(private readonly _val: unknown) {}
  eq(): ChainResult { return this; }
  neq(): ChainResult { return this; }
  in(): ChainResult { return this; }
  not(): ChainResult { return this; }
  gte(): ChainResult { return this; }
  limit(): ChainResult { return this; }
  select(): ChainResult { return this; }
  then<T>(
    onFulfilled: (v: unknown) => T | PromiseLike<T>,
    onRejected?: (r: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this._val).then(onFulfilled, onRejected);
  }
  single(): Promise<unknown> { return Promise.resolve(this._val); }
}

type Stats = {
  batchUpdateCalls: Record<string, unknown>[];
  candidateInsertCalls: Record<string, unknown>[];
  durableProbeCalls: number;
};

type Config = {
  /** Lo que responde la sonda de filas durables ya presentes en el lote. */
  durableProbe: { count: number | null; error: { message: string } | null };
  /** Si el INSERT de candidato falla (⇒ 0 escritas por este contribuyente). */
  candidateInsertError?: { message: string } | null;
  existingBatchStatus?: string;
};

function makeFakeAdmin(config: Config, stats: Stats): SupabaseClient {
  let candidateSeq = 0;

  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            return {
              eq(col: string) {
                if (col === 'source') return new ChainResult({ data: [], error: null });
                return {
                  single() {
                    return Promise.resolve({
                      data: {
                        id: EXISTING_BATCH_ID,
                        status: config.existingBatchStatus ?? 'generating',
                        source: 'agent_1',
                        created_by: USER_A,
                        owner_id: USER_A,
                        metadata: { request_source: 'chat_wizard' },
                        client_request_id: 'req-cut1-0001',
                        completed_at: null,
                      },
                      error: null,
                    });
                  },
                };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return new ChainResult({ error: null });
          },
          insert() {
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id: NEW_BATCH_ID }, error: null }) };
              },
            };
          },
        };
      }

      if (table === 'prospect_candidates') {
        return {
          select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            // La sonda de supervivencia: conteo acotado, sin filas.
            if (opts?.head === true) {
              stats.durableProbeCalls += 1;
              return new ChainResult({
                count: config.durableProbe.count,
                error: config.durableProbe.error,
                data: null,
              });
            }
            // Novelty checker y demás lecturas: historial vacío.
            return new ChainResult({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            if (config.candidateInsertError) {
              return {
                select() {
                  return {
                    single: () =>
                      Promise.resolve({ data: null, error: config.candidateInsertError }),
                  };
                },
              };
            }
            const id = `cand-cut1-${++candidateSeq}`;
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id }, error: null }) };
              },
            };
          },
        };
      }

      if (table === 'prospect_candidate_audit') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }

      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function makePipelineOutput(count = 1) {
  const candidates = Array.from({ length: count }, (_, i) => ({
    name: `Empresa Cut1 ${i + 1}`,
    website: `https://empresa-cut1-${i + 1}.com.co`,
    domain: `empresa-cut1-${i + 1}.com.co`,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'EdTech',
    sourceUrl: `https://source-cut1-${i + 1}.com`,
    sourceTitle: `Empresa Cut1 ${i + 1} - Software empresarial en Colombia`,
    sourceSnippet: 'Empresa colombiana de software empresarial para clientes corporativos.',
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: {
        name: `Empresa Cut1 ${i + 1}`,
        website: `https://empresa-cut1-${i + 1}.com.co`,
        domain: `empresa-cut1-${i + 1}.com.co`,
      },
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
      breakdown: {
        existenceSignals: 1, websiteSignals: 1, duplicateSignals: 1,
        sourceSignals: 1, fitSignals: 1, completenessSignals: 1, penalties: 0,
      },
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
      resultsCount: count,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: count, searched: count, returned: count,
      highQualityNew: count, needsReview: 0, duplicates: 0,
      insufficientData: 0, discarded: 0, unchecked: 0,
    },
    warnings: [],
    metadata: { provider: 'mock', pipelineVersion: 'cut1-test', executedAt: '2026-08-21T00:00:00.000Z' },
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

function makeStats(): Stats {
  return { batchUpdateCalls: [], candidateInsertCalls: [], durableProbeCalls: 0 };
}

function statusWrites(stats: Stats): string[] {
  return stats.batchUpdateCalls
    .map((c) => c['status'])
    .filter((s): s is string => typeof s === 'string');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-1 — el escritor de pago no degrada un lote que ya trae filas', () => {
  it('lote con 7 filas previas + 0 escritas + fallo de escritura ⇒ NUNCA failed', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      { durableProbe: { count: 7, error: null }, candidateInsertError: { message: 'insert boom' } },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(result.candidatesCreated, 0, 'el escritor de pago no debe haber escrito nada');
    assert.ok(result.errors.length > 0, 'el fallo de escritura sigue siendo observable');
    assert.equal(stats.durableProbeCalls, 1, 'la sonda de supervivencia tiene que correr');

    const written = statusWrites(stats);
    assert.ok(!written.includes('failed'), `no puede escribirse failed; se escribió ${written.join(',')}`);
    assert.ok(!written.includes('completed'), `no puede escribirse completed; se escribió ${written.join(',')}`);
    // El lote conserva el `ready_for_review` que la adopción ya dejó puesto.
    assert.ok(
      stats.batchUpdateCalls.some((c) => c['status'] === 'ready_for_review'),
      'la adopción tiene que haber dejado el lote en ready_for_review',
    );
  });

  it('lote con 7 filas previas + 0 escritas SIN fallos ⇒ NUNCA completed', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      { durableProbe: { count: 7, error: null }, candidateInsertError: { message: 'insert boom' } },
      stats,
    );
    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(0) }),
      admin,
    );
    const written = statusWrites(stats);
    assert.ok(!written.includes('completed'));
    assert.ok(!written.includes('failed'));
  });

  it('CONTROL — lote VACÍO + 0 escritas + fallo ⇒ sigue quedando failed', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      { durableProbe: { count: 0, error: null }, candidateInsertError: { message: 'insert boom' } },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    assert.ok(statusWrites(stats).includes('failed'), 'el comportamiento previo se conserva');
  });

  it('CONTROL — lote VACÍO + cero limpio ⇒ sigue quedando completed', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin({ durableProbe: { count: 0, error: null } }, stats);

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(0) }),
      admin,
    );

    assert.ok(statusWrites(stats).includes('completed'));
  });

  it('sonda ILEGIBLE + 0 escritas ⇒ no se escribe estado terminal alguno (§ 10)', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      {
        durableProbe: { count: null, error: { message: 'read boom' } },
        candidateInsertError: { message: 'insert boom' },
      },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    const written = statusWrites(stats);
    assert.ok(!written.includes('failed'), 'una lectura imposible no puede AFIRMAR que hay cero');
    assert.ok(!written.includes('completed'));
  });

  it('lote NUEVO no sondea nada y conserva su comportamiento histórico', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      { durableProbe: { count: 0, error: null }, candidateInsertError: { message: 'insert boom' } },
      stats,
    );

    const result = await writeProspectingCandidates(makeInput(), admin);

    assert.equal(result.batchId, NEW_BATCH_ID);
    assert.equal(stats.durableProbeCalls, 0, 'un lote recién creado no puede contener nada');
    assert.ok(statusWrites(stats).includes('failed'));
  });

  it('§ 8 — la telemetría suma sin contar dos veces las filas nuevas', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin({ durableProbe: { count: 7, error: null } }, stats);

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(3) }),
      admin,
    );

    // La ÚLTIMA escritura con metadata es la post-bucle; la primera es la adopción.
    const metadataUpdate = [...stats.batchUpdateCalls]
      .reverse()
      .find((c) => c['metadata'] != null);
    assert.ok(metadataUpdate, 'la metadata post-bucle tiene que escribirse');
    const summary = (metadataUpdate['metadata'] as Record<string, unknown>)['writer_summary'] as
      | Record<string, unknown>
      | undefined;
    assert.ok(summary, 'writer_summary tiene que existir en la metadata');
    assert.equal(summary['pre_existing_durable_candidates'], 7);
    assert.equal(summary['pre_existing_durable_candidates_known'], true);
    assert.equal(summary['actual_persisted_count'], result.candidatesCreated);
    assert.equal(
      summary['total_durable_candidates'],
      7 + result.candidatesCreated,
      'el total no puede contar dos veces las filas de este escritor',
    );
  });
});
