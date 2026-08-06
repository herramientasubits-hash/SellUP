/**
 * Tests — el writer ante un fallo de persistencia (fixture LIVE-QA-2).
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 14, casos 6, 7, 12, 13, 14 y 15.
 *
 * Todo con un doble de cliente admin inyectado. Sin Supabase, sin Apollo, sin
 * Tavily, sin HubSpot, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeProspectingCandidates } from '../candidate-writer';
import {
  CANDIDATE_PERSISTENCE_OUTCOME_METADATA_KEY,
  CANDIDATE_PERSISTENCE_FAILED_ERROR_CODE,
  IDENTITY_KEY_UNAVAILABLE_ERROR_CODE,
} from '../prospect-candidate-persistence-readiness';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../apollo-two-round';
import {
  buildQa2PipelineOutput,
  buildQa2TwoRoundObservability,
  QA2_ELIGIBLE_COMPANY,
  QA2_IDENTITY_KEY_POSTGREST_ERROR,
  QA2_USER_ID,
} from './qa2-persistence-fixture';
import type { CandidateWriterInput } from '../types';

const EXISTING_BATCH_ID = 'batch-qa2-0000-0000-0000-000000000001';

// ─── Doble de cliente admin ───────────────────────────────────────────────────

class Chain {
  constructor(private readonly value: unknown) {}
  eq(): Chain { return this; }
  neq(): Chain { return this; }
  in(): Chain { return this; }
  not(): Chain { return this; }
  gte(): Chain { return this; }
  limit(): Chain { return this; }
  select(): Chain { return this; }
  then<T>(onFulfilled: (v: unknown) => T | PromiseLike<T>): Promise<T> {
    return Promise.resolve(this.value).then(onFulfilled);
  }
}

type Stats = {
  batchUpdates: Record<string, unknown>[];
  candidateInserts: Record<string, unknown>[];
};

type Config = {
  /** Error que devuelve el INSERT del candidato. `null` = éxito. */
  candidateInsertError?: { code?: string; message: string } | null;
  /** Falla sólo los primeros N inserts (persistencia parcial). */
  failFirstN?: number;
};

function makeFakeAdmin(config: Config, stats: Stats): SupabaseClient {
  let seq = 0;
  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(column: string) {
                if (column === 'source') return new Chain({ data: [], error: null });
                return {
                  single: async () => ({
                    data: {
                      id: EXISTING_BATCH_ID,
                      status: 'draft',
                      source: 'agent_1',
                      created_by: QA2_USER_ID,
                      owner_id: QA2_USER_ID,
                      metadata: { request_source: 'chat_wizard' },
                      client_request_id: 'req-qa2',
                    },
                    error: null,
                  }),
                };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdates.push({ ...data });
            return new Chain({ error: null });
          },
        };
      }

      if (table === 'prospect_candidates') {
        return {
          select() {
            return new Chain({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInserts.push({ ...data });
            const index = seq++;
            const shouldFail =
              config.candidateInsertError != null &&
              (config.failFirstN === undefined || index < config.failFirstN);
            return {
              select() {
                return {
                  single: async () =>
                    shouldFail
                      ? { data: null, error: config.candidateInsertError }
                      : { data: { id: `cand-${index + 1}` }, error: null },
                };
              },
            };
          },
        };
      }

      if (table === 'prospect_candidate_audit') {
        return { insert: async () => ({ data: null, error: null }) };
      }

      // provider_usage_logs y cualquier otra lectura de reconciliación: el writer
      // ya las envuelve en try/catch, así que lanzar aquí es inocuo y mantiene el
      // doble honesto sobre lo que NO simula.
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function makeInput(overrides: Partial<CandidateWriterInput> = {}): CandidateWriterInput {
  return {
    pipelineOutput: buildQa2PipelineOutput(),
    triggeredByUserId: QA2_USER_ID,
    ownerId: QA2_USER_ID,
    source: 'agent_1',
    dryRun: false,
    existingBatchId: EXISTING_BATCH_ID,
    extraBatchMetadata: buildQa2TwoRoundObservability(),
    ...overrides,
  };
}

function freshStats(): Stats {
  return { batchUpdates: [], candidateInserts: [] };
}

/**
 * ÚLTIMA escritura de metadata del lote.
 *
 * `find` sería incorrecto: la primera escritura es el UPDATE inicial a
 * `ready_for_review`, que lleva la metadata PRE-writer. La verdad de la
 * persistencia sólo existe en la escritura post-bucle.
 */
function lastMetadataWrite(stats: Stats): Record<string, unknown> {
  const writes = stats.batchUpdates.filter((u) => u.metadata != null);
  assert.ok(writes.length > 0, 'debe haber al menos una escritura de metadata');
  return writes[writes.length - 1].metadata as Record<string, unknown>;
}

function lastStatusWrite(stats: Stats): string | undefined {
  const withStatus = stats.batchUpdates.filter((u) => typeof u.status === 'string');
  return withStatus.length > 0 ? (withStatus[withStatus.length - 1].status as string) : undefined;
}

// ─── § 14.6 y § 14.13 — el camino feliz ───────────────────────────────────────

describe('§ 14.6 / § 14.13 — writer con un candidato: funciona y puebla identity_key', () => {
  it('persiste la empresa elegible y devuelve las cifras coherentes', async () => {
    const stats = freshStats();
    const result = await writeProspectingCandidates(
      makeInput(),
      makeFakeAdmin({ candidateInsertError: null }, stats),
    );

    assert.equal(result.status, 'success');
    assert.equal(result.candidatesCreated, 1);
    assert.equal(result.persistence.eligibleBeforePersistence, 1);
    assert.equal(result.persistence.persistedCandidates, 1);
    assert.equal(result.persistence.persistenceFailed, false);
    assert.equal(result.persistence.persistenceFailureCount, 0);
    assert.equal(result.persistence.persistenceErrorCode, null);
  });

  it('el INSERT lleva identity_key NO nula, derivada del dominio', async () => {
    const stats = freshStats();
    await writeProspectingCandidates(
      makeInput(),
      makeFakeAdmin({ candidateInsertError: null }, stats),
    );

    assert.equal(stats.candidateInserts.length, 1);
    const identityKey = stats.candidateInserts[0].identity_key;
    assert.equal(typeof identityKey, 'string');
    assert.notEqual(identityKey, null);
    assert.equal(identityKey, `domain:${QA2_ELIGIBLE_COMPANY.domain}`);
  });

  it('el lote queda en ready_for_review: hay algo real que revisar', async () => {
    const stats = freshStats();
    await writeProspectingCandidates(
      makeInput(),
      makeFakeAdmin({ candidateInsertError: null }, stats),
    );
    assert.equal(lastStatusWrite(stats), 'ready_for_review');
  });
});

// ─── § 14.12 — fixture QA-2 completo con el writer fallando ───────────────────

describe('§ 14.12 — fixture QA-2: elegible = 1, writer muere por identity_key', () => {
  async function runQa2Failure() {
    const stats = freshStats();
    const result = await writeProspectingCandidates(
      makeInput(),
      makeFakeAdmin({ candidateInsertError: { ...QA2_IDENTITY_KEY_POSTGREST_ERROR } }, stats),
    );
    return { result, stats };
  }

  it('reporta 1 elegible, 0 guardados y el fallo declarado con su código', async () => {
    const { result } = await runQa2Failure();
    assert.equal(result.candidatesCreated, 0);
    assert.equal(result.persistence.eligibleBeforePersistence, 1);
    assert.equal(result.persistence.persistedCandidates, 0);
    assert.equal(result.persistence.persistenceFailed, true);
    assert.equal(result.persistence.persistenceFailureCount, 1);
    assert.equal(result.persistence.persistenceErrorCode, IDENTITY_KEY_UNAVAILABLE_ERROR_CODE);
    assert.equal(result.persistence.persistenceErrorStage, 'candidate_insert');
  });

  it('el status del writer es failed, no success', async () => {
    const { result } = await runQa2Failure();
    assert.equal(result.status, 'failed');
  });

  // § 14.14
  it('§ 14.14 — el lote conserva el conteo de elegibles aunque el writer falle', async () => {
    const { stats } = await runQa2Failure();
    const metadata = lastMetadataWrite(stats);
    const persistence = metadata[CANDIDATE_PERSISTENCE_OUTCOME_METADATA_KEY] as Record<
      string,
      unknown
    >;
    assert.deepEqual(persistence, {
      eligible_before_persistence: 1,
      persisted_candidates: 0,
      persistence_failure_count: 1,
      persistence_failed: true,
      persistence_error_code: IDENTITY_KEY_UNAVAILABLE_ERROR_CODE,
      persistence_error_stage: 'candidate_insert',
      // FORENSICS-1 § 7 — un intento, cero guardados: fracaso total, no parcial.
      persistence_status: 'failed',
      persistence_attempted_count: 1,
      persistence_succeeded_count: 0,
      persistence_failed_count: 1,
      persistence_gap: 1,
    });
  });

  // § 9
  it('§ 9 — el lote NO se queda en ready_for_review: queda failed', async () => {
    const { stats } = await runQa2Failure();
    assert.equal(lastStatusWrite(stats), 'failed');
    assert.ok(
      !stats.batchUpdates.some(
        (u, i) => u.status === 'ready_for_review' && i === stats.batchUpdates.length - 1,
      ),
      'la última escritura de estado no puede ser ready_for_review',
    );
  });

  // § 14.15
  it('§ 14.15 — la correlación y la observabilidad de la corrida no se pierden', async () => {
    const { stats } = await runQa2Failure();
    const metadata = lastMetadataWrite(stats);
    const observability = metadata[APOLLO_TWO_ROUND_OBSERVABILITY_KEY] as Record<string, unknown>;
    assert.ok(observability, 'la observabilidad de dos rondas sigue en el metadata');
    assert.equal(observability.eligible_companies_found, 1);
    assert.equal(observability.rounds_executed, 2);
    assert.equal((observability.rounds as unknown[]).length, 2);
    // El resumen del writer sigue reportando la verdad de la escritura.
    const writerSummary = metadata.writer_summary as Record<string, unknown>;
    assert.equal(writerSummary.actual_persisted_count, 0);
    assert.equal(writerSummary.actual_skipped_count, 1);
  });

  // § 14.7
  it('§ 14.7 — nada de lo persistido ni devuelto contiene el error crudo', async () => {
    const { result, stats } = await runQa2Failure();
    const serialized = JSON.stringify({ result, batchUpdates: stats.batchUpdates });
    assert.doesNotMatch(serialized, /schema cache/);
    assert.doesNotMatch(serialized, /PGRST204/);
    assert.doesNotMatch(serialized, /Could not find/);
    // El motivo del descarte es un código propio, prefijado para poder agruparlo.
    assert.deepEqual(
      result.skipped.map((s) => s.reason),
      [`persistence_failed:${IDENTITY_KEY_UNAVAILABLE_ERROR_CODE}`],
    );
    for (const error of result.errors) {
      assert.doesNotMatch(error, /schema cache/);
    }
  });

  it('el descarte NO cae en el bucket de historial ni en el de calidad', async () => {
    const { stats } = await runQa2Failure();
    const metadata = lastMetadataWrite(stats);
    const novelty = metadata.novelty_summary as Record<string, unknown>;
    assert.equal(novelty.skipped_count, 0, 'un fallo de escritura no es historial');
    assert.equal(novelty.skipped_recent_count, 0);
    const writerSummary = metadata.writer_summary as Record<string, unknown>;
    assert.equal(writerSummary.quality_skipped_count, 0, 'tampoco es un filtro de calidad');
  });
});

// ─── § 14.9 — persistencia parcial ────────────────────────────────────────────

describe('§ 14.9 — persistencia parcial: uno falla, otro entra', () => {
  function twoCandidateInput(): CandidateWriterInput {
    const base = buildQa2PipelineOutput();
    const second = {
      ...(base.candidates[0] as unknown as Record<string, unknown>),
      name: 'Almacenes La Sabana',
      website: 'https://www.almaceneslasabana.com.co',
      domain: 'almaceneslasabana.com.co',
    };
    return makeInput({
      pipelineOutput: {
        ...base,
        candidates: [base.candidates[0], second as unknown as (typeof base.candidates)[number]],
      },
    });
  }

  it('reporta 2 elegibles, 1 guardado y 1 fallo', async () => {
    const stats = freshStats();
    const result = await writeProspectingCandidates(
      twoCandidateInput(),
      makeFakeAdmin(
        { candidateInsertError: { ...QA2_IDENTITY_KEY_POSTGREST_ERROR }, failFirstN: 1 },
        stats,
      ),
    );

    assert.equal(result.persistence.eligibleBeforePersistence, 2);
    assert.equal(result.persistence.persistedCandidates, 1);
    assert.equal(result.persistence.persistenceFailureCount, 1);
    assert.equal(result.persistence.persistenceFailed, true);
    assert.equal(result.status, 'partial_success');
  });

  it('con algo guardado el lote SÍ queda en ready_for_review', async () => {
    const stats = freshStats();
    await writeProspectingCandidates(
      twoCandidateInput(),
      makeFakeAdmin(
        { candidateInsertError: { ...QA2_IDENTITY_KEY_POSTGREST_ERROR }, failFirstN: 1 },
        stats,
      ),
    );
    assert.equal(lastStatusWrite(stats), 'ready_for_review');
  });
});

// ─── Fallo de escritura que NO es identity_key ────────────────────────────────

describe('§ 7 — otro fallo de escritura se declara sin filtrar su detalle', () => {
  it('un CHECK violado produce el código genérico', async () => {
    const stats = freshStats();
    const result = await writeProspectingCandidates(
      makeInput(),
      makeFakeAdmin(
        {
          candidateInsertError: {
            code: '23514',
            message:
              'new row for relation "prospect_candidates" violates check constraint "x" DETAIL: Failing row contains (secreto)',
          },
        },
        stats,
      ),
    );

    assert.equal(result.persistence.persistenceFailed, true);
    assert.equal(result.persistence.persistenceErrorCode, CANDIDATE_PERSISTENCE_FAILED_ERROR_CODE);
    const serialized = JSON.stringify({ result, batchUpdates: stats.batchUpdates });
    assert.doesNotMatch(serialized, /Failing row/);
    assert.doesNotMatch(serialized, /secreto/);
  });
});

// ─── Sin candidatos: nada falló ───────────────────────────────────────────────

describe('§ 9 — una corrida sin elegibles y sin fallos sigue quedando completed', () => {
  it('cero candidatos ⇒ completed, persistenceFailed = false', async () => {
    const stats = freshStats();
    const base = buildQa2PipelineOutput();
    const result = await writeProspectingCandidates(
      makeInput({ pipelineOutput: { ...base, candidates: [] } }),
      makeFakeAdmin({ candidateInsertError: null }, stats),
    );

    assert.equal(result.persistence.persistenceFailed, false);
    assert.equal(result.persistence.eligibleBeforePersistence, 0);
    assert.equal(lastStatusWrite(stats), 'completed');
  });
});
