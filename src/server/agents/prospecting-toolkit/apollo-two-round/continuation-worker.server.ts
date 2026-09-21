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
  type ApolloContinuationRunPolicy,
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
  lease_token: string;
  metadata: {
    run_input?: ApolloTwoRoundWizardRunInput;
    run_policy?: ApolloContinuationRunPolicy;
  } | null;
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
  /** § 4 — foto de la política autorizada, para reevaluar la cascada al terminar. */
  runPolicy?: ApolloContinuationRunPolicy | null;
  client?: SupabaseClient;
}): Promise<{ enqueued: boolean; reason?: string }> {
  try {
    const client = input.client ?? adminClient();
    const { error } = await client.from(CONTINUATION_JOBS_TABLE).insert({
      batch_id: input.batchId,
      wizard_run_id: input.wizardRunId,
      idempotency_key: input.idempotencyKey,
      request_fingerprint: input.requestFingerprint,
      metadata: {
        run_input: input.runInput,
        ...(input.runPolicy ? { run_policy: input.runPolicy } : {}),
      },
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

/**
 * § 4 — reevaluación de la cascada cuando la continuación cierra la corrida.
 *
 * La decisión usa la CONJUNCIÓN de la política autorizada de la corrida con el
 * estado actual de las banderas: un cambio posterior puede apagar la pierna,
 * nunca encenderla. Y el objetivo y el acumulado salen de la foto de la
 * corrida, así que reanudar no reinicia ningún tope.
 */
async function runContinuationCascade(
  policy: ApolloContinuationRunPolicy,
  outcome: { candidatesCreated?: number },
): Promise<void> {
  const [{ runLushaWaterfallLeg }, { isAgent1ApolloLushaWaterfallEnabled, isLushaPreviewEnabled }] =
    await Promise.all([
      import('@/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server'),
      import('@/lib/feature-flags.server'),
    ]);
  const { resolveContinuationCascadeInputs } = await import('./continuation-worker');

  const effective = resolveContinuationCascadeInputs(policy, {
    waterfallEnabled: isAgent1ApolloLushaWaterfallEnabled(),
    lushaAvailable: isLushaPreviewEnabled(),
  });
  if (!effective.waterfallEnabled || !effective.lushaAvailable) return;

  await runLushaWaterfallLeg(
    {
      wizardClientRequestId: policy.wizardClientRequestId,
      canonicalBatchId: policy.batchId,
      countryCode: policy.countryCode,
      macroIndustryKey: policy.macroIndustryKey,
      subIndustryId: policy.subIndustryId,
      requestedSubindustries: [...policy.requestedSubindustries],
      target: policy.target,
      usefulAccumulated: outcome.candidatesCreated ?? 0,
      apolloTerminal: true,
      // Ya no hay trabajo pendiente: por definición, esto ya no es una pausa.
      apolloPendingContinuation: false,
    },
    {
      waterfallEnabled: () => effective.waterfallEnabled,
      lushaAvailable: () => effective.lushaAvailable,
    },
  );
}

export async function runApolloRoundContinuationWorkerFromEnv(
  options: {
    batchId?: string | null;
    limit?: number;
    timeBudgetMs?: number;
    /**
     * AGENT1-APOLLO-DURABLE-RUN-BUDGET § 3 — cliente inyectable.
     *
     * Existe SÓLO para que la verificación contra un PostgreSQL desechable
     * ejercite ESTE cuerpo —el reclamo real y el cierre real— en vez de una
     * reimplementación de sus reglas en la prueba. Ausente, cae al cliente de
     * servicio de siempre y el comportamiento es idéntico.
     */
    client?: SupabaseClient;
  } = {},
): Promise<ApolloContinuationWorkerStats> {
  const client = options.client ?? adminClient();
  const runInputByJobId = new Map<string, ApolloTwoRoundWizardRunInput>();
  const runPolicyByJobId = new Map<string, ApolloContinuationRunPolicy>();
  /** Identidad con la que se lee el checkpoint de cada lote reclamado. */
  const identityByBatchId = new Map<
    string,
    { idempotencyKey: string; requestFingerprint: string }
  >();

  const deps: ApolloContinuationWorkerDeps = {
    claimJobs: async ({ workerId, limit, lockDurationMinutes, batchId }) => {
      const { data, error } = await client.rpc(CLAIM_RPC, {
        p_worker_id: workerId,
        p_limit: limit,
        // § 3 — el lease se expresa en SEGUNDOS: es el tiempo que un worker
        // puede tener el trabajo antes de que otro pueda quitárselo.
        p_lease_seconds: lockDurationMinutes * 60,
        p_batch_id: batchId,
      });
      if (error) throw error;
      const rows = (data ?? []) as ClaimedRow[];
      const jobs: ApolloContinuationJob[] = [];
      for (const row of rows) {
        const runInput = row.metadata?.run_input;
        // Sin el input original no se puede reanudar sin inventar criterios.
        if (!runInput) continue;
        runInputByJobId.set(row.id, runInput);
        if (row.metadata?.run_policy) runPolicyByJobId.set(row.id, row.metadata.run_policy);
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
          leaseToken: row.lease_token,
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
      const paused = outcome.assessmentDeadlineReached === true;
      const pending = outcome.pendingOrganizationCount ?? 0;

      // § 4 — Apollo terminó DE VERDAD: ahora, y sólo ahora, toca preguntar si
      // corresponde Lusha. Una pausa NO la activa; esto corre cuando ya no
      // queda trabajo pendiente y el lote está escrito.
      if (!paused && pending === 0) {
        const policy = runPolicyByJobId.get(job.id);
        if (policy) {
          await runContinuationCascade(policy, outcome).catch((error) => {
            // La cascada no puede tumbar una continuación que YA terminó su
            // trabajo: lo de Apollo está escrito y es válido con o sin Lusha.
            console.error('[ApolloContinuation] cascada tras continuación falló:', error);
          });
        }
      }

      return { assessmentDeadlineReached: paused, pendingOrganizationCount: pending };
    },

    settleJob: async ({ jobId, leaseToken, status, resolution, errorCode }) => {
      const patch: Record<string, unknown> = {
        status,
        error_code: errorCode ?? null,
        // Soltar el lease es parte de cerrar: la fila deja de estar tomada.
        lease_token: null,
        lease_expires_at: null,
        locked_by: null,
        metadata_last_resolution: undefined,
      };
      delete patch.metadata_last_resolution;
      if (status === 'completed') patch.completed_at = new Date().toISOString();
      // Un trabajo que vuelve a la cola no reintenta de inmediato: sin espera,
      // un fallo transitorio consumiría los tres intentos en la misma invocación.
      if (status === 'pending') {
        patch.next_retry_at = new Date(Date.now() + RETRY_BACKOFF_SECONDS * 1000).toISOString();
      }
      // § 3 — VALLADO. El cierre exige el token con el que se reclamó: si el
      // lease caducó y otro worker se quedó el trabajo, el token viejo no
      // encuentra fila y esta escritura no pisa nada.
      const { error, data } = await client
        .from(CONTINUATION_JOBS_TABLE)
        .update(patch)
        .eq('id', jobId)
        .eq('lease_token', leaseToken)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        console.warn(
          `[ApolloContinuation] cierre descartado: el lease de ${jobId} ya no es nuestro (resolución ${resolution})`,
        );
      }
    },

    now: () => Date.now(),
  };

  return runApolloRoundContinuationWorker(deps, {
    ...(options.batchId ? { batchId: options.batchId, limit: options.limit ?? 1 } : {}),
    ...(options.timeBudgetMs ? { timeBudgetMs: options.timeBudgetMs } : {}),
  });
}
