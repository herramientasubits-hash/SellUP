/**
 * candidate-writer-omitted-samples-traceability.test.ts
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · § F.
 *
 * El defecto real, medido en la corrida `bdc51c49…`: `writer_summary.
 * quality_rejected_count = 1` y `writer_omitted_samples = []` en el MISMO
 * documento. La categoría existía; la candidata rechazada no tenía nombre en
 * ningún lado — el gate de ICP size era el único de la Pasada 4 sin
 * `captureOmittedSample`.
 *
 * Reutiliza el fixture QA-2 (una candidata que YA pasa todos los gates
 * anteriores en la suite existente) y le fuerza un `employee_count` bajo el
 * umbral, para ejercitar EXACTAMENTE el gate que fallaba en producción.
 *
 * Doble de cliente admin inyectado. Sin Supabase, sin Apollo, sin créditos.
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
import type { CandidateWriterInput, ProspectingPipelineCandidate } from '../types';

const EXISTING_BATCH_ID = 'batch-f-omitted-0000-0000-000000000001';

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

type Stats = { batchUpdates: Record<string, unknown>[] };

function makeFakeAdmin(stats: Stats): SupabaseClient {
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
                      client_request_id: 'req-f-omitted',
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
          insert() {
            const index = seq++;
            return {
              select() {
                return { single: async () => ({ data: { id: `cand-${index + 1}` }, error: null }) };
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

/** La candidata QA-2, con un `employee_count` que el gate de ICP bloquea. */
function buildBelowThresholdCandidate(): CandidateWriterInput {
  const pipelineOutput = buildQa2PipelineOutput();
  const [company] = pipelineOutput.candidates;
  const belowThreshold: ProspectingPipelineCandidate = {
    ...company,
    // AGENT1-APOLLO-FINALIZATION-HARDENING-1 § F — 5 < umbral(200) ⇒
    // `evaluateIcpSizeGate` decide `block`, y el writer la salta con
    // `icp_size_below_threshold`.
    employee_count: 5,
  } as unknown as ProspectingPipelineCandidate;

  return {
    pipelineOutput: { ...pipelineOutput, candidates: [belowThreshold] },
    triggeredByUserId: QA2_USER_ID,
    ownerId: QA2_USER_ID,
    source: 'agent_1',
    dryRun: false,
    existingBatchId: EXISTING_BATCH_ID,
    extraBatchMetadata: buildQa2TwoRoundObservability(),
  };
}

function lastMetadataWrite(stats: Stats): Record<string, unknown> {
  const writes = stats.batchUpdates.filter((u) => u.metadata != null);
  assert.ok(writes.length > 0, 'debe haber al menos una escritura de metadata');
  return writes[writes.length - 1].metadata as Record<string, unknown>;
}

describe('§ F · el gate de ICP size deja una muestra trazable', () => {
  it('la candidata bloqueada por tamaño aparece en writer_omitted_samples', async () => {
    const stats: Stats = { batchUpdates: [] };
    const result = await writeProspectingCandidates(
      buildBelowThresholdCandidate(),
      makeFakeAdmin(stats),
    );

    assert.equal(result.candidatesCreated, 0, 'el gate de ICP la descarta antes de insertarla');
    assert.equal(
      result.skipped.some((s) => s.reason === 'icp_size_below_threshold'),
      true,
      'el motivo real, no un cajón de sastre de calidad',
    );

    const metadata = lastMetadataWrite(stats);
    const samples = metadata['writer_omitted_samples'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(samples), 'writer_omitted_samples debe existir');
    assert.equal(samples.length, 1, 'antes de este hito quedaba vacío: 0 muestras, 1 descarte');
    assert.equal(samples[0]?.['final_skip_reason'], 'icp_size_below_threshold');
    assert.equal(samples[0]?.['gate'], 'icp_size');
    assert.equal(typeof samples[0]?.['name'], 'string');
    assert.notEqual(samples[0]?.['name'], '', 'la candidata debe ser NOMBRABLE, no anónima');
  });
});
