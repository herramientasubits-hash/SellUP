/**
 * continuation-worker.server.ts — cableado real del conductor de continuaciones.
 *
 * AGENT1-APOLLO-ROUND-EXECUTION-TIME-BUDGET § 7.
 *
 * Aquí sólo vive la I/O: reclamo atómico, lectura del checkpoint, reanudación y
 * cierre del trabajo. TODA la política —identidad, idempotencia, reintentos,
 * plazo— está en `continuation-worker.ts`, que es puro y lo ejercita la suite
 * sin red. Server-only.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  runApolloRoundContinuationWorker,
  type ApolloContinuationJob,
  type ApolloContinuationWorkerDeps,
  type ApolloContinuationWorkerStats,
} from './continuation-worker';
import { readTwoRoundCheckpoint } from './checkpoint.server';
import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundWizardRunInput,
} from './production-runner.server';

const CONTINUATION_JOBS_TABLE = 'apollo_round_continuation_jobs';
const CLAIM_RPC = 'claim_apollo_round_continuation_jobs';

/** Reintento con espera: un fallo transitorio no vuelve inmediatamente. */
const RETRY_BACKOFF_SECONDS = 60;

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('apollo_continuation_configuration_unavailable');
  }
  return createClient(url, key);
}

type ClaimedRow = {
  id: string;
  batch_id: string;
  wizard_run_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  attempts: number;
  max_attempts: number;
  metadata: { run_input?: ApolloTwoRoundWizardRunInput } | null;
};

/**
 * Encola la continuación de un lote que se quedó sin tiempo.
 *
 * El índice único parcial de la migración 139 garantiza que un lote no tenga dos
 * continuaciones vivas: un segundo encolado sobre el mismo lote choca y se
 * ignora, que es exactamente lo que debe pasar.
 *
 * `run_input` viaja ENTERO a propósito: es lo que conserva lote, criterios y
 * correlación. Las identidades, el gasto acumulado y las operaciones ya
 * completadas NO viajan aquí — los restaura el checkpoint, que es su única
 * fuente de verdad.
 */
export async function enqueueApolloRoundContinuation(input: {
  batchId: string;
  wizardRunId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  runInput: ApolloTwoRoundWizardRunInput;
  client?: SupabaseClient;
}): Promise<{ enqueued: boolean; reason?: string }> {
  try {
    const client = input.client ?? adminClient();
    const { error } = await client.from(CONTINUATION_JOBS_TABLE).insert({
      batch_id: input.batchId,
      wizard_run_id: input.wizardRunId,
      idempotency_key: input.idempotencyKey,
      request_fingerprint: input.requestFingerprint,
      metadata: { run_input: input.runInput },
    });
    if (error) {
      // 23505 = el lote ya tiene una continuación viva. No es un fallo.
      if (error.code === '23505') return { enqueued: false, reason: 'already_queued' };
      return { enqueued: false, reason: error.message };
    }
    return { enqueued: true };
  } catch (error) {
    return {
      enqueued: false,
      reason: error instanceof Error ? error.message : 'enqueue_failed',
    };
  }
}

export async function runApolloRoundContinuationWorkerFromEnv(): Promise<ApolloContinuationWorkerStats> {
  const client = adminClient();
  const runInputByJobId = new Map<string, ApolloTwoRoundWizardRunInput>();
  /** Identidad con la que se lee el checkpoint de cada lote reclamado. */
  const identityByBatchId = new Map<
    string,
    { idempotencyKey: string; requestFingerprint: string }
  >();

  const deps: ApolloContinuationWorkerDeps = {
    claimJobs: async ({ workerId, limit, lockDurationMinutes }) => {
      const { data, error } = await client.rpc(CLAIM_RPC, {
        p_worker_id: workerId,
        p_limit: limit,
        p_lock_duration_minutes: lockDurationMinutes,
      });
      if (error) throw error;
      const rows = (data ?? []) as ClaimedRow[];
      const jobs: ApolloContinuationJob[] = [];
      for (const row of rows) {
        const runInput = row.metadata?.run_input;
        // Sin el input original no se puede reanudar sin inventar criterios.
        if (!runInput) continue;
        runInputByJobId.set(row.id, runInput);
        identityByBatchId.set(row.batch_id, {
          idempotencyKey: row.idempotency_key,
          requestFingerprint: row.request_fingerprint,
        });
        jobs.push({
          id: row.id,
          batchId: row.batch_id,
          wizardRunId: row.wizard_run_id,
          idempotencyKey: row.idempotency_key,
          requestFingerprint: row.request_fingerprint,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
        });
      }
      return jobs;
    },

    loadCheckpointView: async (batchId) => {
      const identity = identityByBatchId.get(batchId);
      if (!identity) return null;
      const checkpoint = await readTwoRoundCheckpoint(batchId, identity);
      if (!checkpoint) return null;
      return {
        wizardRunId: checkpoint.wizard_run_id,
        idempotencyKey: checkpoint.idempotency_key,
        requestFingerprint: checkpoint.request_fingerprint,
        pendingOrganizationCount: checkpoint.pending_organizations.length,
        candidatesPersisted: checkpoint.candidates_persisted,
      };
    },

    resumeRun: async ({ job }) => {
      const runInput = runInputByJobId.get(job.id);
      if (!runInput) throw new Error('continuation_run_input_missing');
      // El runner restaura identidades, gasto y operaciones completadas desde el
      // checkpoint: una búsqueda ya pagada NO se vuelve a pedir porque su
      // operación está en `completed_operation_keys`.
      const outcome = await runApolloTwoRoundWizardDiscovery(runInput);
      return {
        assessmentDeadlineReached: outcome.assessmentDeadlineReached === true,
        pendingOrganizationCount: outcome.pendingOrganizationCount ?? 0,
      };
    },

    settleJob: async ({ jobId, status, resolution, errorCode }) => {
      const patch: Record<string, unknown> = {
        status,
        error_code: errorCode ?? null,
        locked_at: null,
        locked_by: null,
        // El desenlace queda anotado para que la cola sea auditable sin
        // reconstruirlo desde los logs.
        metadata: { last_resolution: resolution },
      };
      if (status === 'completed') patch.completed_at = new Date().toISOString();
      // Un trabajo que vuelve a la cola no reintenta de inmediato: sin espera,
      // un fallo transitorio consumiría los tres intentos en la misma invocación.
      if (status === 'pending') {
        patch.next_retry_at = new Date(Date.now() + RETRY_BACKOFF_SECONDS * 1000).toISOString();
      }
      const { error } = await client.from(CONTINUATION_JOBS_TABLE).update(patch).eq('id', jobId);
      if (error) throw error;
    },

    now: () => Date.now(),
  };

  return runApolloRoundContinuationWorker(deps);
}
