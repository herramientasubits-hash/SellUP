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
  auditInserts: Record<string, unknown>[];
  durableProbeCalls: number;
  /**
   * CUT-1 CORRECTION § 6 — ESTADO OBSERVADO de la fila, no la lista de intentos.
   *
   * La suite anterior sólo miraba qué valores se habían intentado escribir, y por
   * eso no podía distinguir «se conservó `generating`» de «se fabricó
   * `ready_for_review` en la adopción y luego no se volvió a tocar». Este campo
   * arranca con el estado que la fila YA tenía y se mueve sólo cuando una UPDATE
   * lleva de verdad la columna: es lo que quedaría en la base.
   */
  storedStatus: string | null;
  /** Igual que arriba, para la marca de cierre. */
  storedCompletedAt: string | null;
  /** Orden real de los efectos, para poder afirmar precedencias (§ 8). */
  events: string[];
};

type Config = {
  /** Lo que responde la sonda de filas durables ya presentes en el lote. */
  durableProbe: { count: number | null; error: { message: string } | null };
  /** Si el INSERT de candidato falla (⇒ 0 escritas por este contribuyente). */
  candidateInsertError?: { message: string } | null;
  existingBatchStatus?: string;
  existingCompletedAt?: string | null;
};

function makeFakeAdmin(config: Config, stats: Stats): SupabaseClient {
  let candidateSeq = 0;
  stats.storedStatus = config.existingBatchStatus ?? 'generating';
  stats.storedCompletedAt = config.existingCompletedAt ?? null;

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
                        completed_at: config.existingCompletedAt ?? null,
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
            // Se aplica como lo haría la base: sólo las columnas presentes.
            if (typeof data['status'] === 'string') {
              stats.storedStatus = data['status'] as string;
              stats.events.push(`batch_status_write:${data['status'] as string}`);
            } else {
              stats.events.push('batch_update_without_status');
            }
            if (typeof data['completed_at'] === 'string') {
              stats.storedCompletedAt = data['completed_at'] as string;
            }
            return new ChainResult({ error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.storedStatus =
              typeof data?.['status'] === 'string' ? (data['status'] as string) : null;
            stats.events.push('batch_insert');
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
              stats.events.push('durable_probe');
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
        return {
          insert(data: Record<string, unknown>) {
            stats.auditInserts.push({ ...data });
            stats.events.push(`audit:${String(data?.['action_type'])}`);
            return Promise.resolve({ data: null, error: null });
          },
        };
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
  return {
    batchUpdateCalls: [],
    candidateInsertCalls: [],
    auditInserts: [],
    durableProbeCalls: 0,
    storedStatus: null,
    storedCompletedAt: null,
    events: [],
  };
}

/** Auditorías de transición de estado del LOTE (no las de candidato). */
function statusAudits(stats: Stats): Record<string, unknown>[] {
  return stats.auditInserts.filter((a) => a['action_type'] === 'batch_status_changed');
}

function statusAuditTargets(stats: Stats): string[] {
  return statusAudits(stats).map(
    (a) => String((a['details'] as Record<string, unknown> | undefined)?.['new_status']),
  );
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

// ─────────────────────────────────────────────────────────────────────────────
// CUT-1 CORRECTION § 6 — «PRESERVE» TIENE QUE PRESERVAR DE VERDAD
//
// Estas pruebas NO miran el resolutor puro ni la lista de intentos de escritura:
// miran el ESTADO QUE QUEDARÍA EN LA FILA y el ORDEN REAL de los efectos.
//
// El defecto que cierran: la adopción escribía `ready_for_review` ANTES de
// sondear el contenido del lote, así que la decisión `preserve` no conservaba el
// estado previo — conservaba el `ready_for_review` que la propia adopción
// acababa de fabricar. La suite anterior pasaba en verde porque sólo comprobaba
// que no se escribiera `failed` ni `completed`.
// ─────────────────────────────────────────────────────────────────────────────

const CUT1_UNREADABLE_PROBE = { count: null, error: { message: 'read boom' } } as const;
const CUT1_INSERT_BOOM = { message: 'insert boom' } as const;

/** Índice de la primera escritura de estado del lote; -1 si no hubo ninguna. */
function firstStatusWriteIndex(stats: Stats): number {
  return stats.events.findIndex((e) => e.startsWith('batch_status_write:'));
}

describe('CUT-1 CORRECTION § 6 — el estado OBSERVADO del lote adoptado', () => {
  it('A — generating + sonda ILEGIBLE + 0 nuevas ⇒ la fila SIGUE en generating', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      {
        existingBatchStatus: 'generating',
        durableProbe: { ...CUT1_UNREADABLE_PROBE },
        candidateInsertError: { ...CUT1_INSERT_BOOM },
      },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(result.candidatesCreated, 0, 'este contribuyente no escribió nada');
    assert.equal(stats.durableProbeCalls, 1, 'la sonda tiene que haber corrido');

    // 🔴 EL NÚCLEO: el estado que quedaría en la fila.
    assert.equal(
      stats.storedStatus,
      'generating',
      `«unknown durable count ⇒ no terminal status is invented»; la fila quedó en ${stats.storedStatus}`,
    );
    assert.equal(firstStatusWriteIndex(stats), -1, 'no puede escribirse NINGÚN estado');
    assert.equal(stats.storedCompletedAt, null, 'sin estado terminal no se sella fecha de cierre');
    assert.ok(
      !stats.batchUpdateCalls.some((c) => 'completed_at' in c),
      'ninguna escritura puede llevar completed_at',
    );

    // Y no queda una auditoría afirmando una transición que no ocurrió.
    assert.deepEqual(
      statusAuditTargets(stats),
      [],
      `no puede auditarse ninguna transición; se auditó ${statusAuditTargets(stats).join(',')}`,
    );

    // El fallo del proveedor/escritura se sigue reportando por su canal.
    assert.ok(result.errors.length > 0, 'el fallo real no se traga');
  });

  it('B — draft + sonda ILEGIBLE + 0 nuevas ⇒ la fila SIGUE en draft', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      {
        existingBatchStatus: 'draft',
        durableProbe: { ...CUT1_UNREADABLE_PROBE },
        candidateInsertError: { ...CUT1_INSERT_BOOM },
      },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(stats.storedStatus, 'draft', `la fila quedó en ${stats.storedStatus}`);
    assert.equal(firstStatusWriteIndex(stats), -1);
    assert.deepEqual(statusAuditTargets(stats), []);
  });

  it('C — generating + sonda ILEGIBLE + >0 nuevas ⇒ ready_for_review, auditado UNA vez y de verdad', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      { existingBatchStatus: 'generating', durableProbe: { ...CUT1_UNREADABLE_PROBE } },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(3) }),
      admin,
    );

    // Lo que ESTE contribuyente insertó es verdad propia y no depende de la sonda.
    assert.ok(result.candidatesCreated > 0, 'tiene que haber insertado algo');
    assert.equal(stats.storedStatus, 'ready_for_review');

    const audits = statusAudits(stats);
    assert.equal(audits.length, 1, `la transición se audita UNA vez; hubo ${audits.length}`);
    const details = audits[0]['details'] as Record<string, unknown>;
    assert.equal(details['previous_status'], 'generating', 'el estado anterior es el REAL');
    assert.equal(details['new_status'], 'ready_for_review');

    // § 8 — la auditoría nunca precede a la escritura que la justifica.
    const auditIdx = stats.events.indexOf('audit:batch_status_changed');
    assert.ok(auditIdx > firstStatusWriteIndex(stats), 'primero se escribe, después se audita');
  });

  it('D — generating + previas CONOCIDAS >0 + 0 nuevas ⇒ ready_for_review', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      {
        existingBatchStatus: 'generating',
        durableProbe: { count: 7, error: null },
        candidateInsertError: { ...CUT1_INSERT_BOOM },
      },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    assert.equal(stats.storedStatus, 'ready_for_review', 'las 7 filas previas sobreviven');
    assert.deepEqual(statusAuditTargets(stats), ['ready_for_review']);
  });

  it('E — generating + previas CONOCIDAS 0 + 0 nuevas + 0 fallos ⇒ completed', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      { existingBatchStatus: 'generating', durableProbe: { count: 0, error: null } },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(0) }),
      admin,
    );

    assert.equal(stats.storedStatus, 'completed');
    assert.deepEqual(statusAuditTargets(stats), ['completed']);
  });

  it('F — generating + previas CONOCIDAS 0 + 0 nuevas + fallos >0 ⇒ failed', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      {
        existingBatchStatus: 'generating',
        durableProbe: { count: 0, error: null },
        candidateInsertError: { ...CUT1_INSERT_BOOM },
      },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    assert.equal(stats.storedStatus, 'failed', 'un lote vacío con escritura fallida SÍ es failed');
    assert.deepEqual(statusAuditTargets(stats), ['failed']);
  });

  it('G — un lote que YA sobrevivió en ready_for_review no se puede degradar', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      {
        existingBatchStatus: 'ready_for_review',
        durableProbe: { count: 7, error: null },
        candidateInsertError: { ...CUT1_INSERT_BOOM },
      },
      stats,
    );

    // El reintento se rechaza en la validación de adopción, ANTES de cualquier
    // escritura: `ready_for_review` no está entre los estados que aceptan
    // resultados de pipeline.
    await assert.rejects(
      () => writeProspectingCandidates(makeInput({ existingBatchId: EXISTING_BATCH_ID }), admin),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'BATCH_INCOMPATIBLE_STATUS');
        return true;
      },
    );

    assert.equal(stats.storedStatus, 'ready_for_review', 'la fila no se toca');
    assert.equal(stats.batchUpdateCalls.length, 0, 'cero escrituras al lote');
    assert.equal(stats.candidateInsertCalls.length, 0, 'cero inserciones');
    assert.deepEqual(statusAuditTargets(stats), []);
  });
});

describe('CUT-1 CORRECTION § 8 — orden real: la verdad precede al estado', () => {
  it('en un lote ADOPTADO la sonda corre ANTES de cualquier escritura de estado', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      { existingBatchStatus: 'generating', durableProbe: { count: 7, error: null } },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(2) }),
      admin,
    );

    const probeIdx = stats.events.indexOf('durable_probe');
    const statusIdx = firstStatusWriteIndex(stats);
    assert.ok(probeIdx >= 0, 'la sonda tiene que correr');
    assert.ok(statusIdx >= 0, 'tiene que escribirse un estado terminal');
    assert.ok(
      probeIdx < statusIdx,
      `la sonda (${probeIdx}) tiene que preceder al estado (${statusIdx}); orden: ${stats.events.join(' → ')}`,
    );
  });

  it('la UPDATE de adopción no lleva la columna de estado', async () => {
    const stats = makeStats();
    const admin = makeFakeAdmin(
      { existingBatchStatus: 'generating', durableProbe: { count: 0, error: null } },
      stats,
    );

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID, pipelineOutput: makePipelineOutput(1) }),
      admin,
    );

    assert.ok(stats.batchUpdateCalls.length > 0);
    const adoption = stats.batchUpdateCalls[0];
    assert.ok(
      !('status' in adoption),
      `la adopción no puede decidir el estado; escribió ${JSON.stringify(adoption['status'])}`,
    );
    assert.equal(stats.events[0], 'batch_update_without_status', 'y es el PRIMER efecto');
  });
});
