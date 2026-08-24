/**
 * AGENT1-CUT3B23 REVIEW-FIX § 3 — los contadores del writer de PAGO dicen la verdad.
 *
 * El defecto que fija esta suite: `tallyBatchIdentityDecision` se llama ANTES de
 * persistir. Si el INSERT falla después, la fila NO existe — y sin embargo el
 * candidato quedaba contado como aceptado, con `errors` en 0. Un candidato que
 * sólo pasó la admisión no puede hacerse pasar por una fila del lote.
 *
 * Por eso hay DOS conceptos explícitos y separados:
 *
 *   · `identity_admitted_unique` — la admisión no lo retiró.
 *   · `persisted_unique`         — la fila EXISTE.
 *
 * Doble de cliente admin inyectado: sin Supabase, sin Apollo, sin Tavily, sin
 * HubSpot, sin proveedores y sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeProspectingCandidates } from '../candidate-writer';
import {
  buildQa2PipelineOutput,
  buildQa2TwoRoundObservability,
  QA2_USER_ID,
} from './qa2-persistence-fixture';
import type { CandidateWriterInput } from '../types';

const EXISTING_BATCH_ID = 'batch-cut3b23-0000-0000-0000-000000000001';

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

type Stats = { batchUpdates: Record<string, unknown>[]; candidateInserts: number };

/**
 * @param insertOutcome  `'ok'` inserta, `'error'` devuelve error de motor y
 *                       `'throw'` lanza: los tres caminos de fallo del bucle.
 */
function makeFakeAdmin(
  insertOutcome: 'ok' | 'error' | 'throw',
  stats: Stats,
): SupabaseClient {
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
                      client_request_id: 'req-cut3b23',
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
          // La sonda durable de CUT-1 (`head: true`) y la siembra del registro de
          // identidad (lote VACÍO) comparten esta superficie de lectura.
          select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            if (opts?.head === true) return new Chain({ count: 0, error: null, data: null });
            return new Chain({ data: [], error: null });
          },
          insert() {
            stats.candidateInserts += 1;
            const index = seq++;
            if (insertOutcome === 'throw') throw new Error('conexión caída');
            return {
              select() {
                return {
                  single: async () =>
                    insertOutcome === 'error'
                      ? { data: null, error: { code: '08006', message: 'insert rejected' } }
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
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function makeInput(): CandidateWriterInput {
  return {
    pipelineOutput: buildQa2PipelineOutput(),
    triggeredByUserId: QA2_USER_ID,
    ownerId: QA2_USER_ID,
    source: 'agent_1',
    dryRun: false,
    existingBatchId: EXISTING_BATCH_ID,
    extraBatchMetadata: buildQa2TwoRoundObservability(),
  };
}

/** El bloque de conteo del corte, tal como queda en la metadata del lote. */
function readBatchIdentityMetadata(stats: Stats): Record<string, unknown> {
  const writes = stats.batchUpdates.filter((u) => u.metadata != null);
  assert.ok(writes.length > 0, 'debe haber una escritura de metadata');
  const metadata = writes[writes.length - 1].metadata as Record<string, unknown>;
  const block = metadata['batch_identity_registry'];
  assert.ok(block && typeof block === 'object', 'el bloque del corte debe existir');
  return block as Record<string, unknown>;
}

// ─── § 3 ──────────────────────────────────────────────────────────────────────

describe('CUT-3B23 REVIEW-FIX § 3 — writer de PAGO: admitido ≠ persistido', () => {
  it('un INSERT que funciona: `persisted_unique` 1 y `errors` 0', async () => {
    const stats: Stats = { batchUpdates: [], candidateInserts: 0 };
    const result = await writeProspectingCandidates(makeInput(), makeFakeAdmin('ok', stats));

    assert.equal(result.candidatesCreated, 1);
    const block = readBatchIdentityMetadata(stats);
    assert.equal(block.identity_admitted_unique, 1);
    assert.equal(block.persisted_unique, 1);
    assert.equal(block.errors, 0);
    assert.equal(block.duplicate_skipped, 0);
  });

  it('🔴 identidad admitida + INSERT fallido ⇒ `errors` 1 y `persisted_unique` 0', async () => {
    const stats: Stats = { batchUpdates: [], candidateInserts: 0 };
    const result = await writeProspectingCandidates(makeInput(), makeFakeAdmin('error', stats));

    assert.equal(stats.candidateInserts, 1, 'se intentó escribir');
    assert.equal(result.candidatesCreated, 0, 'no se creó ninguna fila');

    const block = readBatchIdentityMetadata(stats);
    assert.equal(block.identity_admitted_unique, 1, 'pasó la admisión');
    assert.equal(block.persisted_unique, 0, '🔴 pero la fila NO existe');
    assert.equal(block.errors, 1, '🔴 y el fallo se declara');
    assert.equal(block.duplicate_skipped, 0, 'un fallo de escritura no es un duplicado');
  });

  it('🔴 una EXCEPCIÓN del insert se cuenta igual que el error del motor', async () => {
    const stats: Stats = { batchUpdates: [], candidateInserts: 0 };
    const result = await writeProspectingCandidates(makeInput(), makeFakeAdmin('throw', stats));

    assert.equal(result.candidatesCreated, 0);
    const block = readBatchIdentityMetadata(stats);
    assert.equal(block.identity_admitted_unique, 1);
    assert.equal(block.persisted_unique, 0);
    assert.equal(block.errors, 1);
  });

  it('el bloque del corte sigue siendo sólo números y nombres de señal: sin PII', async () => {
    const stats: Stats = { batchUpdates: [], candidateInserts: 0 };
    await writeProspectingCandidates(makeInput(), makeFakeAdmin('ok', stats));

    const block = readBatchIdentityMetadata(stats);
    for (const [key, value] of Object.entries(block)) {
      if (key === 'seed_degraded') {
        assert.equal(typeof value, 'boolean');
        continue;
      }
      if (key === 'duplicate_signals') {
        assert.equal(typeof value, 'object');
        continue;
      }
      assert.equal(typeof value, 'number', `${key} debe ser numérico`);
    }
  });
});
