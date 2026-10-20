/**
 * AGENT1-AUDIT-WS1 — corridas trabadas: borradores del Agente 1 y vallado por
 * lease.
 *
 *   1. El asistente reserva el lote en `draft` y el camino de Apollo no lo mueve
 *      hasta escribir: si la corrida moría antes, el barrido (que sólo miraba
 *      «generando») nunca lo cerraba.
 *   2. `closeJob` vallaba sólo por estado: si un conductor reclamaba el trabajo
 *      entre la lectura y la escritura del barrido (mismo `processing`, token
 *      nuevo), el barrido lo cerraba en plena ejecución.
 *
 * Sin red ni base: tabla en memoria con un gancho que simula el reclamo
 * concurrente justo antes de la escritura.
 *
 * Correr: node --import tsx --test src/modules/prospect-batches/stuck-runs/__tests__/stuck-runs-audit-ws1.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { closeStuckAgentRuns, finishAgentRunForBatch } from '../stuck-runs.server';
import { isClosableStuckBatchStatus, isDraftAgentBatchIdle, STUCK_BATCH_IDLE_MINUTES } from '../stuck-runs-policy';

const NOW = Date.parse('2026-10-16T13:15:00Z');
const MIN = 60_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function fakeClient(tables: Tables, beforeUpdate?: (table: string) => void) {
  function builder(table: string) {
    let mode: 'select' | 'update' = 'select';
    let patch: Row = {};
    let head = false;
    const filters: Array<(row: Row) => boolean> = [];
    let limit = Infinity;
    const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const run = () => {
      if (mode === 'update') {
        beforeUpdate?.(table);
        const hit = rows();
        for (const row of hit) Object.assign(row, patch);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      const hit = rows().slice(0, limit);
      return head ? { data: null, count: hit.length, error: null } : { data: hit, error: null };
    };
    const api: Record<string, unknown> = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        if (opts?.head) head = true;
        return api;
      },
      update: (p: Row) => {
        mode = 'update';
        patch = p;
        return api;
      },
      eq: (col: string, value: unknown) => (filters.push((r) => r[col] === value), api),
      is: (col: string, value: unknown) => (filters.push((r) => (r[col] ?? null) === value), api),
      in: (col: string, values: unknown[]) => (filters.push((r) => values.includes(r[col])), api),
      lt: (col: string, value: string) => (filters.push((r) => String(r[col]) < value), api),
      gte: (col: string, value: string) => (filters.push((r) => String(r[col]) >= value), api),
      order: () => api,
      limit: (n: number) => ((limit = n), api),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return api;
  }
  return { from: builder } as unknown as SupabaseClient;
}

describe('reglas de borrador del Agente 1', () => {
  it('«generando» siempre se puede cerrar; «borrador» sólo si es del Agente 1', () => {
    assert.equal(isClosableStuckBatchStatus({ status: 'generating', source: 'manual' }), true);
    assert.equal(isClosableStuckBatchStatus({ status: 'draft', source: 'agent_1' }), true);
    assert.equal(isClosableStuckBatchStatus({ status: 'draft', source: 'manual' }), false);
    assert.equal(isClosableStuckBatchStatus({ status: 'draft', source: null }), false);
    assert.equal(isClosableStuckBatchStatus({ status: 'ready_for_review', source: 'agent_1' }), false);
  });

  it(`borrador quieto = mismo umbral que «generando» (${STUCK_BATCH_IDLE_MINUTES} min)`, () => {
    const base = { status: 'draft', source: 'agent_1', nowMs: NOW };
    assert.equal(isDraftAgentBatchIdle({ ...base, updatedAt: iso(STUCK_BATCH_IDLE_MINUTES * MIN) }), true);
    assert.equal(isDraftAgentBatchIdle({ ...base, updatedAt: iso(5 * MIN) }), false);
    assert.equal(isDraftAgentBatchIdle({ ...base, source: 'external_import', updatedAt: iso(60 * MIN) }), false);
    assert.equal(isDraftAgentBatchIdle({ ...base, updatedAt: null }), false);
  });
});

describe('barrido — borradores del Agente 1', () => {
  it('cierra el borrador quieto sin continuación; deja el que tiene continuación abierta', async () => {
    const tables: Tables = {
      apollo_round_continuation_jobs: [
        // Pausado con turno vivo: su lote sigue.
        { id: 'j-live', batch_id: 'b-paused', status: 'processing', attempts: 1, max_attempts: 3, lease_token: 't', lease_expires_at: new Date(NOW + MIN).toISOString(), created_at: iso(40 * MIN) },
      ],
      prospect_batches: [
        { id: 'b-dead', status: 'draft', source: 'agent_1', updated_at: iso(45 * MIN), metadata: { keep: 1 } },
        { id: 'b-paused', status: 'draft', source: 'agent_1', updated_at: iso(45 * MIN), metadata: {} },
      ],
      prospect_candidates: [{ id: 'c1', batch_id: 'b-dead' }],
    };
    const result = await closeStuckAgentRuns(fakeClient(tables), NOW);
    const batches = Object.fromEntries(tables.prospect_batches.map((b) => [b.id, b]));
    assert.equal(batches['b-dead'].status, 'ready_for_review', 'lo encontrado pasa a revisión');
    assert.equal((batches['b-dead'].metadata as Row).keep, 1);
    assert.equal(((batches['b-dead'].metadata as Row).stuck_run_close as Row).reason, 'idle');
    assert.equal(batches['b-paused'].status, 'draft', 'con continuación abierta no se cierra');
    assert.deepEqual(result, { closedJobs: 0, closedBatches: 1 });
  });

  it('«Terminar» también cierra el borrador del Agente 1 de quien lo pide', async () => {
    const tables: Tables = {
      apollo_round_continuation_jobs: [],
      prospect_batches: [{ id: 'b', status: 'draft', source: 'agent_1', updated_at: iso(MIN), metadata: {} }],
      prospect_candidates: [],
    };
    const result = await finishAgentRunForBatch(fakeClient(tables), 'b', 'user-1', { nowMs: NOW });
    assert.deepEqual(result, { closedJobs: 0, batchStatus: 'failed' });
  });

  it('«Terminar» no toca un borrador manual', async () => {
    const tables: Tables = {
      apollo_round_continuation_jobs: [],
      prospect_batches: [{ id: 'b', status: 'draft', source: 'manual', updated_at: iso(MIN), metadata: {} }],
      prospect_candidates: [],
    };
    const result = await finishAgentRunForBatch(fakeClient(tables), 'b', 'user-1', { nowMs: NOW });
    assert.deepEqual(result, { closedJobs: 0, batchStatus: null });
    assert.equal(tables.prospect_batches[0].status, 'draft');
  });
});

describe('barrido — vallado por lease', () => {
  function exhaustedJob(): Row {
    return {
      id: 'j',
      batch_id: 'b',
      status: 'processing',
      attempts: 3,
      max_attempts: 3,
      lease_token: 'token-viejo',
      lease_expires_at: iso(MIN),
      created_at: iso(60 * MIN),
    };
  }

  it('si un conductor reclama entre la lectura y la escritura, el barrido NO lo cierra', async () => {
    const tables: Tables = {
      apollo_round_continuation_jobs: [exhaustedJob()],
      prospect_batches: [{ id: 'b', status: 'generating', source: 'agent_1', updated_at: iso(60 * MIN), metadata: {} }],
      prospect_candidates: [],
    };
    let reclaimed = false;
    const client = fakeClient(tables, (table) => {
      if (table !== 'apollo_round_continuation_jobs' || reclaimed) return;
      // Reclamo concurrente: mismo estado, token NUEVO y turno vivo.
      reclaimed = true;
      Object.assign(tables.apollo_round_continuation_jobs[0], {
        lease_token: 'token-nuevo',
        lease_expires_at: new Date(NOW + 5 * MIN).toISOString(),
        attempts: 4,
      });
    });
    const result = await closeStuckAgentRuns(client, NOW);
    const job = tables.apollo_round_continuation_jobs[0];
    assert.equal(job.status, 'processing', 'el trabajo reclamado sigue corriendo');
    assert.equal(job.lease_token, 'token-nuevo');
    assert.equal(result.closedJobs, 0);
  });

  it('sin reclamo concurrente, el agotado se cierra como antes', async () => {
    const tables: Tables = {
      apollo_round_continuation_jobs: [exhaustedJob()],
      prospect_batches: [],
      prospect_candidates: [],
    };
    const result = await closeStuckAgentRuns(fakeClient(tables), NOW);
    assert.equal(tables.apollo_round_continuation_jobs[0].status, 'failed');
    assert.equal(tables.apollo_round_continuation_jobs[0].error_code, 'max_attempts_exceeded');
    assert.equal(result.closedJobs, 1);
  });

  it('«Terminar» cierra aunque el turno siga vivo (no se valla por lease)', async () => {
    const tables: Tables = {
      apollo_round_continuation_jobs: [
        { ...exhaustedJob(), attempts: 1, lease_expires_at: new Date(NOW + 5 * MIN).toISOString() },
      ],
      prospect_batches: [{ id: 'b', status: 'generating', source: 'agent_1', updated_at: iso(MIN), metadata: {} }],
      prospect_candidates: [],
    };
    const result = await finishAgentRunForBatch(fakeClient(tables), 'b', 'user-1', { nowMs: NOW });
    assert.equal(result.closedJobs, 1);
    assert.equal(tables.apollo_round_continuation_jobs[0].lease_token, null);
  });
});
