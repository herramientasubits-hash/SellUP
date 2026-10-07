/**
 * AGENT1-STUCK-RUNS-CLOSE-1 — corridas trabadas del Agente 1: reglas puras, el
 * barrido automático, el botón «Terminar» y el tope real de intentos del
 * conductor de continuaciones. Sin red ni base: una tabla en memoria.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  batchRunAttention,
  continuationJobCloseReason,
  CONTINUATION_ABANDON_DAYS,
  hasLiveLease,
  isBatchIdle,
  STUCK_BATCH_IDLE_MINUTES,
  STUCK_RUN_CLOSE_CODES,
  stuckBatchFinalStatus,
} from '../stuck-runs-policy';
import { closeStuckAgentRuns, finishAgentRunForBatch } from '../stuck-runs.server';
import {
  APOLLO_CONTINUATION_MAX_ATTEMPTS_EXCEEDED,
  runApolloRoundContinuationWorker,
  type ApolloContinuationWorkerDeps,
} from '@/server/agents/prospecting-toolkit/apollo-two-round/continuation-worker';

const NOW = Date.parse('2026-10-07T22:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

function job(overrides: Record<string, unknown> = {}) {
  return {
    status: 'processing',
    attempts: 1,
    max_attempts: 3,
    lease_expires_at: iso(MIN),
    created_at: iso(10 * MIN),
    ...overrides,
  } as { status: string; attempts: number; max_attempts: number; lease_expires_at: string | null; created_at: string };
}

describe('reglas (stuck-runs-policy)', () => {
  it('un trabajo con turno vivo nunca se cierra', () => {
    const live = job({ attempts: 9, lease_expires_at: new Date(NOW + MIN).toISOString() });
    assert.equal(hasLiveLease(live, NOW), true);
    assert.equal(continuationJobCloseReason(live, NOW), null);
  });

  it('con los intentos agotados y el turno vencido se cierra (caso b61a430d: 4 de 3)', () => {
    assert.equal(continuationJobCloseReason(job({ attempts: 4 }), NOW), STUCK_RUN_CLOSE_CODES.exhausted);
    assert.equal(continuationJobCloseReason(job({ attempts: 3 }), NOW), STUCK_RUN_CLOSE_CODES.exhausted);
    assert.equal(continuationJobCloseReason(job({ attempts: 2 }), NOW), null, 'le queda un intento');
  });

  it(`abierto más de ${CONTINUATION_ABANDON_DAYS} días se da por abandonado; cerrado no se toca`, () => {
    const old = job({ status: 'pending', attempts: 0, lease_expires_at: null, created_at: iso(8 * DAY) });
    assert.equal(continuationJobCloseReason(old, NOW), STUCK_RUN_CLOSE_CODES.abandoned);
    assert.equal(continuationJobCloseReason({ ...old, status: 'completed' }, NOW), null);
    assert.equal(continuationJobCloseReason({ ...old, status: 'failed' }, NOW), null);
  });

  it('lote: a revisión con empresas, fallido sin nada; quieto sólo si «generando» 30+ min', () => {
    assert.equal(stuckBatchFinalStatus(7), 'ready_for_review');
    assert.equal(stuckBatchFinalStatus(0), 'failed');
    const idle = iso(STUCK_BATCH_IDLE_MINUTES * MIN);
    assert.equal(isBatchIdle({ status: 'generating', updatedAt: idle, nowMs: NOW }), true);
    assert.equal(isBatchIdle({ status: 'generating', updatedAt: iso(5 * MIN), nowMs: NOW }), false);
    assert.equal(isBatchIdle({ status: 'ready_for_review', updatedAt: idle, nowMs: NOW }), false);
  });

  it('aviso en el lote: continuación abierta = a medias; quieto sin cola = detenido', () => {
    const base = { status: 'ready_for_review', updatedAt: iso(MIN), nowMs: NOW };
    assert.equal(batchRunAttention({ ...base, hasOpenContinuation: true }), 'paused');
    assert.equal(batchRunAttention({ ...base, hasOpenContinuation: false }), 'none');
    assert.equal(
      batchRunAttention({ status: 'generating', updatedAt: iso(40 * MIN), nowMs: NOW, hasOpenContinuation: false }),
      'stalled',
    );
  });
});

// ── Base en memoria ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function fakeClient(tables: Tables) {
  const writes: Array<{ table: string; patch: Row }> = [];
  function builder(table: string) {
    let mode: 'select' | 'update' = 'select';
    let patch: Row = {};
    let head = false;
    const filters: Array<(row: Row) => boolean> = [];
    let limit = Infinity;
    const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const run = () => {
      if (mode === 'update') {
        const hit = rows();
        for (const row of hit) Object.assign(row, patch);
        writes.push({ table, patch });
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
      in: (col: string, values: unknown[]) => (filters.push((r) => values.includes(r[col])), api),
      lt: (col: string, value: string) => (filters.push((r) => String(r[col]) < value), api),
      order: () => api,
      limit: (n: number) => ((limit = n), api),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    for (const forbidden of ['insert', 'upsert', 'delete', 'rpc']) {
      api[forbidden] = () => {
        throw new Error(`operación prohibida: ${forbidden}`);
      };
    }
    return api;
  }
  return { client: { from: builder } as unknown as SupabaseClient, writes, tables };
}

function world() {
  return {
    apollo_round_continuation_jobs: [
      // b61a430d: 4 de 3, turno vencido.
      { id: 'j-ar', batch_id: 'b-ar', status: 'processing', attempts: 4, max_attempts: 3, lease_expires_at: iso(MIN), created_at: iso(70 * MIN) },
      // MX 29-09: pendiente hace 8 días.
      { id: 'j-mx', batch_id: 'b-mx', status: 'pending', attempts: 1, max_attempts: 3, lease_expires_at: null, created_at: iso(8 * DAY) },
      // Corriendo ahora mismo: intocable.
      { id: 'j-live', batch_id: 'b-live', status: 'processing', attempts: 3, max_attempts: 3, lease_expires_at: new Date(NOW + 2 * MIN).toISOString(), created_at: iso(5 * MIN) },
    ],
    prospect_batches: [
      { id: 'b-ar', status: 'generating', updated_at: iso(60 * MIN), metadata: { keep: 1 } },
      { id: 'b-mx', status: 'draft', updated_at: iso(8 * DAY), metadata: {} },
      { id: 'b-live', status: 'generating', updated_at: iso(60 * MIN), metadata: {} },
      { id: 'b-idle-empty', status: 'generating', updated_at: iso(45 * MIN), metadata: {} },
      { id: 'b-fresh', status: 'generating', updated_at: iso(2 * MIN), metadata: {} },
    ],
    prospect_candidates: [
      { id: 'c1', batch_id: 'b-ar' },
      { id: 'c2', batch_id: 'b-ar' },
    ],
  } as Tables;
}

describe('barrido automático (closeStuckAgentRuns)', () => {
  it('cierra lo agotado y lo abandonado; no toca lo que corre ni lo que se mueve', async () => {
    const { client, tables } = fakeClient(world());
    const result = await closeStuckAgentRuns(client, NOW);

    const jobs = Object.fromEntries(tables.apollo_round_continuation_jobs.map((j) => [j.id, j]));
    assert.equal(jobs['j-ar'].status, 'failed');
    assert.equal(jobs['j-ar'].error_code, 'max_attempts_exceeded');
    assert.equal(jobs['j-ar'].lease_token, null);
    assert.equal(jobs['j-mx'].status, 'failed');
    assert.equal(jobs['j-mx'].error_code, 'stale_abandoned');
    assert.equal(jobs['j-live'].status, 'processing', 'con turno vivo no se toca');

    const batches = Object.fromEntries(tables.prospect_batches.map((b) => [b.id, b]));
    assert.equal(batches['b-ar'].status, 'ready_for_review', 'lo encontrado pasa a revisión');
    assert.deepEqual((batches['b-ar'].metadata as Row).keep, 1, 'la metadata previa se conserva');
    assert.equal(((batches['b-ar'].metadata as Row).stuck_run_close as Row).reason, 'max_attempts_exceeded');
    assert.equal(batches['b-mx'].status, 'draft', 'sólo se cierran lotes «generando»');
    assert.equal(batches['b-live'].status, 'generating', 'su continuación sigue viva');
    assert.equal(batches['b-idle-empty'].status, 'failed', 'quieto y sin empresas');
    assert.equal(batches['b-fresh'].status, 'generating', 'se mueve: no se toca');
    assert.deepEqual(result, { closedJobs: 2, closedBatches: 2 });
  });

  it('nunca lanza aunque la base falle', async () => {
    const broken = { from: () => { throw new Error('caída'); } } as unknown as SupabaseClient;
    assert.deepEqual(await closeStuckAgentRuns(broken, NOW), { closedJobs: 0, closedBatches: 0 });
  });
});

describe('botón «Terminar» (finishAgentRunForBatch)', () => {
  it('cierra la continuación del lote —aunque tenga turno vivo— y deja lo encontrado para revisar', async () => {
    const tables = world();
    tables.prospect_candidates.push({ id: 'c3', batch_id: 'b-live' });
    const { client } = fakeClient(tables);
    const result = await finishAgentRunForBatch(client, 'b-live', 'user-1', { nowMs: NOW });
    assert.deepEqual(result, { closedJobs: 1, batchStatus: 'ready_for_review' });
    const live = tables.apollo_round_continuation_jobs.find((j) => j.id === 'j-live')!;
    assert.equal(live.error_code, 'closed_by_user');
    assert.equal(live.lease_token, null, 'el cierre tardío del conductor ya no encuentra su fila');
    const batch = tables.prospect_batches.find((b) => b.id === 'b-live')!;
    assert.equal(((batch.metadata as Row).stuck_run_close as Row).closed_by, 'user-1');
  });

  it('un lote ya listo para revisión sólo pierde la cola', async () => {
    const tables = world();
    tables.prospect_batches.find((b) => b.id === 'b-ar')!.status = 'ready_for_review';
    const { client } = fakeClient(tables);
    assert.deepEqual(await finishAgentRunForBatch(client, 'b-ar', null, { nowMs: NOW }), {
      closedJobs: 1,
      batchStatus: null,
    });
  });
});

describe('tope real de intentos del conductor', () => {
  function deps(attempts: number, settled: Array<Record<string, unknown>>): ApolloContinuationWorkerDeps {
    let resumed = 0;
    return {
      claimJobs: async () => [
        { id: 'j', batchId: 'b', wizardRunId: 'w', idempotencyKey: 'k', requestFingerprint: 'f', attempts, maxAttempts: 3, leaseToken: 't' },
      ],
      loadCheckpointView: async () => ({
        wizardRunId: 'w', idempotencyKey: 'k', requestFingerprint: 'f', pendingOrganizationCount: 5, candidatesPersisted: true,
      }),
      resumeRun: async () => {
        resumed++;
        if (resumed > 0 && attempts > 3) throw new Error('no debió reanudar');
        return { assessmentDeadlineReached: true, pendingOrganizationCount: 3 };
      },
      settleJob: async (input) => {
        settled.push(input);
      },
      now: () => 0,
    };
  }

  it('pasado el máximo se cierra como agotado SIN reanudar (no vuelve a gastar)', async () => {
    const settled: Array<Record<string, unknown>> = [];
    const stats = await runApolloRoundContinuationWorker(deps(4, settled));
    assert.equal(stats.failed, 1);
    assert.equal(settled[0].status, 'failed');
    assert.equal(settled[0].resolution, 'exhausted');
    assert.equal(settled[0].errorCode, APOLLO_CONTINUATION_MAX_ATTEMPTS_EXCEEDED);
  });

  it('una pausa que avanzó vuelve a la cola con la cuenta en cero', async () => {
    const settled: Array<Record<string, unknown>> = [];
    await runApolloRoundContinuationWorker(deps(3, settled));
    assert.equal(settled[0].resolution, 'requeued');
    assert.equal(settled[0].resetAttempts, true);
  });
});

describe('guardas estáticas', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

  it('«Terminar» comprueba con el cliente de la persona ANTES de usar el de servicio', () => {
    const route = read('src/app/api/prospect-batches/finish-run/route.ts');
    assert.match(route, /requireActiveUser\(\)/);
    const rls = route.indexOf("from('prospect_batches')");
    const service = route.indexOf('createSupabaseAdminClient()');
    assert.ok(rls > 0 && service > rls, 'primero RLS, después servicio');
  });

  it('cerrar no llama a proveedores ni borra filas', () => {
    for (const file of [
      'src/modules/prospect-batches/stuck-runs/stuck-runs.server.ts',
      'src/modules/prospect-batches/stuck-runs/stuck-runs-policy.ts',
      'src/app/api/prospect-batches/finish-run/route.ts',
    ]) {
      const code = read(file);
      assert.doesNotMatch(code, /apollo-two-round\/production-runner|lusha|tavily|fetch\(|\.delete\(|\.rpc\(/i, file);
    }
  });

  it('el cron y el Centro de procesos barren lo trabado', () => {
    assert.match(read('src/app/api/cron/apollo-round-continuation/route.ts'), /closeStuckAgentRuns\(/);
    assert.match(read('src/modules/prospect-batches/apollo-continuation-actions.ts'), /closeStuckAgentRuns\(/);
  });
});
