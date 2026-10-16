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
  restoreContinuationRunInput,
  runApolloRoundContinuationWorker,
  type ApolloContinuationRunPolicy,
  type ApolloContinuationJob,
  type ApolloContinuationWorkerDeps,
  type ApolloContinuationWorkerStats,
} from './continuation-worker';
import { serializePriorProviderSeen } from '@/modules/prospect-batches/provider-seen/provider-seen-memory-serialization';
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


/** AGENT1-AUDIT-WS2 § 6 — código de cierre de una fila reclamada sin `run_input`. */
export const APOLLO_CONTINUATION_RUN_INPUT_MISSING = 'continuation_run_input_missing';

/**
 * AGENT1-AUDIT-WS2 § 6 — cierra como `failed` una fila reclamada cuyo `run_input`
 * no se puede restaurar. Vallada por `lease_token`: si el lease ya no es nuestro,
 * no pisa nada. Nunca lanza: un cierre fallido se registra y la fila caduca sola.
 */
async function closeUnrestorableContinuationRow(
  client: SupabaseClient,
  row: Pick<ClaimedRow, 'id' | 'batch_id' | 'lease_token'>,
): Promise<void> {
  console.error(
    `[ApolloContinuation] trabajo ${row.id} (lote ${row.batch_id}) sin run_input: se cierra como fallido`,
  );
  try {
    const { error } = await client
      .from(CONTINUATION_JOBS_TABLE)
      .update({
        status: 'failed',
        error_code: APOLLO_CONTINUATION_RUN_INPUT_MISSING,
        lease_token: null,
        lease_expires_at: null,
        locked_by: null,
      })
      .eq('id', row.id)
      .eq('lease_token', row.lease_token);
    if (error) throw error;
  } catch (error) {
    console.error(`[ApolloContinuation] no se pudo cerrar el trabajo ${row.id}:`, error);
  }
}

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
        // 🔴 `priorProviderSeen` lleva `Set`/`Map`, que JSON borra (`{}`): se
        // encola como listas y `restoreContinuationRunInput` las reconstruye.
        run_input: {
          ...input.runInput,
          ...(input.runInput.priorProviderSeen
            ? { priorProviderSeen: serializePriorProviderSeen(input.runInput.priorProviderSeen) }
            : {}),
        },
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
/** La cifra que el writer publicó en el lote. `null` si no se puede leer. */
async function readDurableAcceptedForTargetTotal(
  client: SupabaseClient,
  batchId: string,
): Promise<number | null> {
  try {
    const { data, error } = await client
      .from('prospect_batches')
      .select('metadata')
      .eq('id', batchId)
      .maybeSingle();
    if (error || !data) return null;
    const accepted = (data as { metadata?: { accepted_for_target?: { accepted_for_target_total?: unknown } } })
      .metadata?.accepted_for_target?.accepted_for_target_total;
    return typeof accepted === 'number' ? accepted : null;
  } catch {
    return null;
  }
}

/**
 * AGENT1-AUDIT-WS2 § 4 — ¿hay una persona con sesión en ESTA invocación?
 *
 * El cron no trae cookies: `getUser()` devuelve `null` y la acción de Lusha
 * (`requireActiveUser`) redirigiría. La continuación en sesión sí la trae. Es una
 * LECTURA de la sesión, no un atajo: nada aquí autentica a nadie. Cualquier error ⇒
 * «sin sesión» (fail-closed: Lusha no corre).
 */
async function hasActiveUserSession(): Promise<boolean> {
  try {
    const { createClient: createSessionClient } = await import('@/lib/supabase/server');
    const supabase = await createSessionClient();
    const { data } = await supabase.auth.getUser();
    return Boolean(data?.user);
  } catch {
    return false;
  }
}

/**
 * AGENT1-AUDIT-WS2 §§ 3, 4 — deja en el lote POR QUÉ la pierna Lusha no corrió (o
 * falló) tras la continuación. Antes el lote seguía diciendo lo que dijo la pausa
 * («Apollo pendiente») y nadie podía saber que Lusha nunca llegó a correr.
 *
 * Observacional y best-effort: tras la escritura del runner no hay otro escritor
 * del lote, y un fallo aquí no cambia nada de la corrida.
 */
async function recordContinuationLushaLeg(
  client: SupabaseClient,
  batchId: string,
  trace: { skipReason: string | null; failureReason?: string | null },
): Promise<void> {
  try {
    const { LUSHA_WATERFALL_LEG_METADATA_KEY } = await import(
      '@/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall'
    );
    const { data, error } = await client
      .from('prospect_batches')
      .select('metadata')
      .eq('id', batchId)
      .maybeSingle();
    if (error || !data) return;
    const current = (data as { metadata?: Record<string, unknown> | null }).metadata ?? {};
    await client
      .from('prospect_batches')
      .update({
        metadata: {
          ...current,
          [LUSHA_WATERFALL_LEG_METADATA_KEY]: {
            executed: false,
            skipReason: trace.skipReason,
            gap: null,
            clientRequestId: null,
            persistedCandidates: null,
            acceptedForTarget: null,
            failureCode: null,
            failureReason: trace.failureReason ?? null,
            decidedBy: 'apollo_continuation',
          },
        },
      })
      .eq('id', batchId);
  } catch (error) {
    console.warn('[ApolloContinuation] no se pudo anotar la pierna Lusha en el lote:', error);
  }
}

async function runContinuationCascade(
  policy: ApolloContinuationRunPolicy,
  outcome: { persistenceOutcome?: { completeValidCandidates?: number | null } },
  client: SupabaseClient,
  timing: { elapsedMs: number },
): Promise<void> {
  const [{ runLushaWaterfallLeg }, { isAgent1LushaFallbackEffective, isLushaPreviewEnabled }] =
    await Promise.all([
      import('@/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server'),
      import('@/lib/feature-flags.server'),
    ]);
  const {
    resolveContinuationCascadeInputs,
    resolveCascadeAcceptedForTarget,
    decideContinuationLushaPrecondition,
  } = await import('./continuation-worker');

  const effective = resolveContinuationCascadeInputs(policy, {
    waterfallEnabled: isAgent1LushaFallbackEffective(),
    lushaAvailable: isLushaPreviewEnabled(),
  });
  if (!effective.waterfallEnabled || !effective.lushaAvailable) return;

  // 🔴 AGENT1-AUDIT-WS2 §§ 3, 4 — tiempo y sesión ANTES de reservar nada. Sin
  // tiempo no se reserva (Vercel cortaría con la reserva hecha); sin sesión (cron)
  // la acción de Lusha redirigiría. Las dos se saltan con motivo, nunca en silencio.
  const precondition = decideContinuationLushaPrecondition({
    elapsedMs: timing.elapsedMs,
    hasUserSession: await hasActiveUserSession(),
  });
  if (precondition !== null) {
    console.warn(
      `[ApolloContinuation] pierna Lusha omitida (${precondition}) en el lote ${policy.batchId}`,
    );
    await recordContinuationLushaLeg(client, policy.batchId, { skipReason: precondition });
    return;
  }

  // 🔴 AGENT1-CONTINUATION-LUSHA-CASCADE-1 — lo ACEPTADO, no lo escrito.
  const acceptedForTarget = resolveCascadeAcceptedForTarget({
    durableAcceptedTotal: await readDurableAcceptedForTargetTotal(client, policy.batchId),
    completeValidCandidates: outcome.persistenceOutcome?.completeValidCandidates,
  });
  if (acceptedForTarget === null) {
    console.warn(
      `[ApolloContinuation] cascada omitida: no se pudo medir lo aceptado del lote ${policy.batchId}`,
    );
    return;
  }

  const leg = await runLushaWaterfallLeg(
    {
      wizardClientRequestId: policy.wizardClientRequestId,
      canonicalBatchId: policy.batchId,
      countryCode: policy.countryCode,
      macroIndustryKey: policy.macroIndustryKey,
      subIndustryId: policy.subIndustryId,
      requestedSubindustries: [...policy.requestedSubindustries],
      target: policy.target,
      usefulAccumulated: acceptedForTarget,
      apolloTerminal: true,
      // Ya no hay trabajo pendiente: por definición, esto ya no es una pausa.
      apolloPendingContinuation: false,
    },
    {
      waterfallEnabled: () => effective.waterfallEnabled,
      lushaAvailable: () => effective.lushaAvailable,
    },
  );
  // AGENT1-AUDIT-WS2 § 4 — antes el desenlace se descartaba: una pierna que lanzó
  // (`leg_failed`) era indistinguible de una que no hizo falta.
  if (!leg.executed && leg.reason === 'leg_failed') {
    console.error(`[ApolloContinuation] la pierna Lusha falló en el lote ${policy.batchId}`);
    await recordContinuationLushaLeg(client, policy.batchId, {
      skipReason: 'leg_failed',
      failureReason: 'lusha_action_threw',
    });
  }
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
        // Sin el input original no se puede reanudar sin inventar criterios.
        //
        // 🔴 AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — y el input que vuelve de la
        // base es JSON: perdió la función con la que el writer publica
        // `accepted_for_target`. `restoreContinuationRunInput` la vuelve a atar
        // desde los hechos de la corrida, con la misma aritmética que el mago.
        const restored = restoreContinuationRunInput(row.metadata);
        if (!restored) {
          // 🔴 AGENT1-AUDIT-WS2 § 6 — antes `continue` a secas: la fila quedaba
          // reclamada (lease, intento sumado) y nadie la cerraba nunca. Reintentar
          // no va a crear el `run_input`, así que se cierra como fallida con un
          // código propio, vallada por el mismo token del reclamo.
          await closeUnrestorableContinuationRow(client, row);
          continue;
        }
        runInputByJobId.set(row.id, restored.runInput);
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
        assessmentCompleted: checkpoint.checkpoint_reason === 'run_completed',
      };
    },

    resumeRun: async ({ job, invocationStartedAtMs }) => {
      const runInput = runInputByJobId.get(job.id);
      if (!runInput) throw new Error('continuation_run_input_missing');
      // El runner restaura identidades, gasto y operaciones completadas desde el
      // checkpoint: una búsqueda ya pagada NO se vuelve a pedir porque su
      // operación está en `completed_operation_keys`.
      //
      // AGENT1-AUDIT-WS2 § 1 — el plazo cuenta desde el inicio del CONDUCTOR, no
      // desde este trabajo: el segundo trabajo de la invocación no tiene 300 s.
      const outcome = await runApolloTwoRoundWizardDiscovery(runInput, undefined, {
        startedAtMs: invocationStartedAtMs,
      });
      const paused = outcome.assessmentDeadlineReached === true;
      const pending = outcome.pendingOrganizationCount ?? 0;

      // § 4 — Apollo terminó DE VERDAD: ahora, y sólo ahora, toca preguntar si
      // corresponde Lusha. Una pausa NO la activa; esto corre cuando ya no
      // queda trabajo pendiente y el lote está escrito.
      //
      // 🔴 AGENT1-CONTINUATION-LUSHA-CASCADE-1 — y también cuando ESTA vuelta
      // escribió el lote: con 0 pendientes y candidatas escritas Apollo terminó,
      // aunque el reloj de evaluación se hubiera agotado por el camino (una
      // reanudación que sólo escribe tarda y puede marcar el plazo).
      const wroteThisAttempt = outcome.persistenceOutcome !== undefined;
      if (pending === 0 && (!paused || wroteThisAttempt)) {
        const policy = runPolicyByJobId.get(job.id);
        if (policy) {
          await runContinuationCascade(policy, outcome, client, {
            elapsedMs: Date.now() - invocationStartedAtMs,
          }).catch((error) => {
            // La cascada no puede tumbar una continuación que YA terminó su
            // trabajo: lo de Apollo está escrito y es válido con o sin Lusha.
            console.error('[ApolloContinuation] cascada tras continuación falló:', error);
          });
        }
      }

      return { assessmentDeadlineReached: paused, pendingOrganizationCount: pending };
    },

    settleJob: async ({ jobId, leaseToken, status, resolution, errorCode, resetAttempts }) => {
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
      // AGENT1-STUCK-RUNS-CLOSE-1 — ver `resetAttempts` en el contrato.
      if (resetAttempts) patch.attempts = 0;
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
