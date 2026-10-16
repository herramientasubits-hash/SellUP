/**
 * stuck-runs.server.ts — cierra las corridas trabadas del Agente 1.
 * AGENT1-STUCK-RUNS-CLOSE-1. Server-only. Las reglas están en `stuck-runs-policy.ts`.
 *
 * Dos entradas:
 *   · `closeStuckAgentRuns` — barrido automático (cron diario y cada vez que el
 *     Centro de procesos pregunta si hay algo pendiente). Nunca toca un trabajo
 *     con turno vivo ni un lote que todavía se mueve.
 *   · `finishAgentRunForBatch` — el botón «Terminar»: cierra la continuación del
 *     lote y deja lo encontrado listo para revisar. No llama a ningún proveedor.
 *
 * El cliente es de servicio: quien llama comprueba antes que la persona puede ver
 * el lote. Todo es fail-soft: un fallo aquí no tumba la pantalla ni el cron.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AGENT1_BATCH_SOURCE,
  continuationJobCloseReason,
  isBatchIdle,
  isClosableStuckBatchStatus,
  isDraftAgentBatchIdle,
  STUCK_BATCH_IDLE_MINUTES,
  STUCK_DRAFT_SWEEP_MAX_AGE_HOURS,
  STUCK_RUN_CLOSE_CODES,
  stuckBatchFinalStatus,
  type ContinuationJobState,
  type StuckRunCloseCode,
} from './stuck-runs-policy';

const JOBS_TABLE = 'apollo_round_continuation_jobs';
const OPEN_JOB_STATUSES = ['pending', 'processing'] as const;
/** Techo de filas por barrido: el barrido corre a menudo y debe ser barato. */
const SWEEP_LIMIT = 100;

type JobRow = ContinuationJobState & { id: string; batch_id: string; lease_token: string | null };

export type StuckRunsSweepResult = { closedJobs: number; closedBatches: number };

type CloseJobOptions = {
  /**
   * AGENT1-AUDIT-WS1 — vallar también por el token del lease leído. El barrido lo
   * exige: entre su lectura y su escritura un conductor puede reclamar el
   * trabajo (mismo estado `processing`, token NUEVO) y el barrido lo cerraba en
   * plena ejecución. El botón «Terminar» NO lo usa a propósito: quiere cerrar
   * también la continuación que tiene turno vivo.
   */
  fenceLease: boolean;
};

async function closeJob(
  client: SupabaseClient,
  job: Pick<JobRow, 'id' | 'status'> & { lease_token?: string | null },
  code: StuckRunCloseCode,
  nowIso: string,
  options: CloseJobOptions,
) {
  // Vallado por el estado leído: si otro proceso lo tomó o lo cerró entre medias,
  // esta escritura no encuentra fila y no pisa nada. Soltar el token también
  // invalida el cierre tardío de un conductor que siguiera vivo.
  let query = client
    .from(JOBS_TABLE)
    .update({
      status: 'failed',
      error_code: code,
      completed_at: nowIso,
      updated_at: nowIso,
      lease_token: null,
      lease_expires_at: null,
      locked_by: null,
    })
    .eq('id', job.id)
    .eq('status', job.status);
  if (options.fenceLease) {
    // Cada reclamo genera un token nuevo: si el token cambió, alguien lo tomó.
    const token = job.lease_token ?? null;
    query = token === null ? query.is('lease_token', null) : query.eq('lease_token', token);
  }
  const { data, error } = await query.select('id');
  return !error && Array.isArray(data) && data.length > 0;
}

async function hasOpenJob(client: SupabaseClient, batchId: string): Promise<boolean> {
  const { data, error } = await client
    .from(JOBS_TABLE)
    .select('id')
    .eq('batch_id', batchId)
    .in('status', [...OPEN_JOB_STATUSES])
    .limit(1);
  // Ante la duda, se considera abierta: no se cierra un lote que quizá sigue.
  return error !== null || (Array.isArray(data) && data.length > 0);
}

/**
 * Cierra un lote «generando» (o un borrador del Agente 1): a revisión si tiene
 * empresas, fallido si no. Deja el motivo en `metadata.stuck_run_close`. Sólo si
 * sigue en el estado leído.
 */
async function closeBatch(
  client: SupabaseClient,
  batchId: string,
  reason: StuckRunCloseCode | 'idle',
  nowIso: string,
  actorUserId: string | null = null,
): Promise<string | null> {
  const { data: batch, error } = await client
    .from('prospect_batches')
    .select('status, source, metadata')
    .eq('id', batchId)
    .maybeSingle();
  if (error || !batch) return null;
  const currentStatus = (batch as { status?: unknown }).status;
  const source = (batch as { source?: unknown }).source;
  if (
    typeof currentStatus !== 'string' ||
    !isClosableStuckBatchStatus({ status: currentStatus, source: typeof source === 'string' ? source : null })
  ) {
    return null;
  }

  const { count } = await client
    .from('prospect_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId);
  const status = stuckBatchFinalStatus(count ?? 0);
  const metadata = ((batch as { metadata?: unknown }).metadata ?? {}) as Record<string, unknown>;

  const { data: updated } = await client
    .from('prospect_batches')
    .update({
      status,
      updated_at: nowIso,
      metadata: {
        ...metadata,
        stuck_run_close: { reason, closed_at: nowIso, closed_by: actorUserId, final_status: status },
      },
    })
    .eq('id', batchId)
    .eq('status', currentStatus)
    .select('id');
  return Array.isArray(updated) && updated.length > 0 ? status : null;
}

/** Barrido automático. Nunca lanza. */
export async function closeStuckAgentRuns(
  client: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<StuckRunsSweepResult> {
  const result: StuckRunsSweepResult = { closedJobs: 0, closedBatches: 0 };
  const nowIso = new Date(nowMs).toISOString();
  try {
    const { data: jobs } = await client
      .from(JOBS_TABLE)
      .select('id, batch_id, status, attempts, max_attempts, lease_expires_at, lease_token, created_at')
      .in('status', [...OPEN_JOB_STATUSES])
      .order('created_at', { ascending: true })
      .limit(SWEEP_LIMIT);

    const batchesToCheck = new Map<string, StuckRunCloseCode | 'idle'>();
    for (const job of (jobs ?? []) as JobRow[]) {
      const code = continuationJobCloseReason(job, nowMs);
      if (code === null) continue;
      if (await closeJob(client, job, code, nowIso, { fenceLease: true })) {
        result.closedJobs++;
        batchesToCheck.set(job.batch_id, code);
      }
    }

    const idleBefore = new Date(nowMs - STUCK_BATCH_IDLE_MINUTES * 60_000).toISOString();
    const { data: idle } = await client
      .from('prospect_batches')
      .select('id, status, updated_at')
      .eq('status', 'generating')
      .lt('updated_at', idleBefore)
      .limit(SWEEP_LIMIT);
    for (const batch of (idle ?? []) as Array<{ id: string; status: string; updated_at: string | null }>) {
      if (isBatchIdle({ status: batch.status, updatedAt: batch.updated_at, nowMs }) && !batchesToCheck.has(batch.id)) {
        batchesToCheck.set(batch.id, 'idle');
      }
    }

    // AGENT1-AUDIT-WS1 — borradores del Agente 1 quietos: la corrida murió antes de
    // escribir. Mismo umbral y misma condición (sin continuación abierta).
    const { data: idleDrafts } = await client
      .from('prospect_batches')
      .select('id, status, source, updated_at')
      .eq('status', 'draft')
      .eq('source', AGENT1_BATCH_SOURCE)
      .lt('updated_at', idleBefore)
      // AUDIT-HARDENING-1 — sólo corridas recientes, no el histórico (ver la constante).
      .gte('updated_at', new Date(nowMs - STUCK_DRAFT_SWEEP_MAX_AGE_HOURS * 3_600_000).toISOString())
      .limit(SWEEP_LIMIT);
    for (const batch of (idleDrafts ?? []) as Array<{ id: string; status: string; source: string | null; updated_at: string | null }>) {
      if (
        isDraftAgentBatchIdle({ status: batch.status, source: batch.source, updatedAt: batch.updated_at, nowMs }) &&
        !batchesToCheck.has(batch.id)
      ) {
        batchesToCheck.set(batch.id, 'idle');
      }
    }

    for (const [batchId, reason] of batchesToCheck) {
      if (await hasOpenJob(client, batchId)) continue;
      if ((await closeBatch(client, batchId, reason, nowIso)) !== null) result.closedBatches++;
    }
  } catch (error) {
    console.error('[StuckRuns] barrido falló:', error);
  }
  return result;
}

export type FinishAgentRunResult = { closedJobs: number; batchStatus: string | null };

/**
 * Botón «Terminar». Cierra TODA continuación abierta del lote —también la que
 * tiene turno vivo: quitarle el token impide que su cierre tardío reabra nada— y
 * deja el lote listo para revisar con lo encontrado. No llama a proveedores.
 */
export async function finishAgentRunForBatch(
  client: SupabaseClient,
  batchId: string,
  actorUserId: string | null,
  options: { code?: StuckRunCloseCode; nowMs?: number } = {},
): Promise<FinishAgentRunResult> {
  const code = options.code ?? STUCK_RUN_CLOSE_CODES.user;
  const nowIso = new Date(options.nowMs ?? Date.now()).toISOString();
  const { data: jobs, error } = await client
    .from(JOBS_TABLE)
    .select('id, status')
    .eq('batch_id', batchId)
    .in('status', [...OPEN_JOB_STATUSES]);
  if (error) throw new Error(`finish_run_read_failed: ${error.message}`);

  let closedJobs = 0;
  for (const job of (jobs ?? []) as Array<{ id: string; status: string }>) {
    if (await closeJob(client, job, code, nowIso, { fenceLease: false })) closedJobs++;
  }
  const batchStatus = await closeBatch(client, batchId, code, nowIso, actorUserId);
  return { closedJobs, batchStatus };
}
