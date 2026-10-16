/**
 * continuation-worker.ts — el CONDUCTOR de las continuaciones de ronda.
 *
 * AGENT1-APOLLO-ROUND-EXECUTION-TIME-BUDGET § 7.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Guardar `pending_organizations` no es retomarlas. Una corrida que se queda sin
 * tiempo deja trabajo GRATUITO pendiente sobre una búsqueda que ya se pagó; sin
 * alguien que lo recoja, ese trabajo espera para siempre y la corrida nunca
 * termina sin intervención manual.
 *
 * Este módulo es ese alguien. Es PURO y con dependencias inyectadas: el mismo
 * cuerpo que corre en producción es el que ejercita la suite, sin red y sin
 * base de datos. El cableado real vive en `continuation-worker.server.ts`.
 *
 * ── Las cinco invariantes que defiende ───────────────────────────────────────
 *
 *  1. IDENTIDAD — un trabajo cuya identidad no coincide con el checkpoint
 *     pertenece a OTRA corrida. Reanudarlo saltaría operaciones que nunca se
 *     hicieron, así que se descarta sin tocar nada;
 *  2. NADA QUE HACER — un lote sin organizaciones pendientes se cierra como
 *     completado. Reanudar dos veces no duplica candidatas ni recuentos;
 *  3. VARIAS VUELTAS — si la continuación se vuelve a quedar sin tiempo, el
 *     trabajo vuelve a la cola. El flujo termina en N invocaciones, no en una;
 *  4. FALLO ACOTADO — un error reintenta hasta `maxAttempts` y después se marca
 *     fallido. No hay bucle infinito;
 *  5. PRESUPUESTO — el conductor tiene su propio plazo y deja de tomar trabajos
 *     cuando se le acaba, en vez de morir a mitad de uno.
 *
 * 🔴 Lo que NO hace: comprar páginas, crear presupuesto, autorizar gasto ni
 * activar a otro proveedor. Una continuación sólo termina de evaluar lo que ya
 * se compró.
 */

import type { ResolveExtraBatchMetadata } from '../writer-metadata-resolution';
import {
  buildWriterAcceptedForTargetMetadata,
  parseRunAcceptanceFacts,
  type RunAcceptanceFacts,
} from '@/modules/prospect-batches/accepted-for-target';
import { revivePriorProviderSeen } from '@/modules/prospect-batches/provider-seen/provider-seen-memory-serialization';

/** Trabajo reclamado de la cola durable. */
export type ApolloContinuationJob = {
  id: string;
  batchId: string;
  /** Identidad de la corrida, las tres piezas que el checkpoint también lleva. */
  wizardRunId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  attempts: number;
  maxAttempts: number;
  /**
   * AGENT1-APOLLO-CONTINUATION-COMPLETES § 3 — token de PROPIEDAD del lease.
   *
   * Se acuña en el reclamo y viaja con el trabajo. Todo cierre lo exige: un
   * worker cuyo lease caducó y fue tomado por otro tiene un token viejo, así
   * que su escritura no encuentra fila y no puede pisar el estado del nuevo.
   */
  leaseToken: string;
};

/** Lo que el conductor necesita saber del checkpoint. Nada más. */
export type ApolloContinuationCheckpointView = {
  wizardRunId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  /** Organizaciones pagadas y todavía sin evaluar. */
  pendingOrganizationCount: number;
  /** El lote ya escribió sus candidatas: no queda nada que continuar. */
  candidatesPersisted: boolean;
  /**
   * AGENT1-APOLLO-CONTINUATION-PERSIST-COMPLETED-RUN-1 — `true` cuando el
   * último checkpoint es `run_completed`: la evaluación y el gasto TERMINARON y
   * sólo falta escribir. Opcional para no romper vistas antiguas: ausente ⇒
   * `false`, el comportamiento de siempre.
   */
  assessmentCompleted?: boolean;
};

/** Desenlace de la reanudación de UNA corrida. */
export type ApolloContinuationRunOutcome = {
  /** `true` ⇒ la continuación TAMBIÉN se quedó sin tiempo. */
  assessmentDeadlineReached: boolean;
  /** Organizaciones que siguen pendientes después de esta vuelta. */
  pendingOrganizationCount: number;
};

export type ApolloContinuationJobResolution =
  | 'completed'
  | 'requeued'
  | 'identity_mismatch'
  | 'nothing_pending'
  | 'failed'
  | 'exhausted';

export type ApolloContinuationWorkerDeps = {
  claimJobs: (input: {
    workerId: string;
    limit: number;
    lockDurationMinutes: number;
    /** § 5 — sólo el trabajo de ESTE lote. `null` ⇒ toda la cola (el cron). */
    batchId: string | null;
  }) => Promise<readonly ApolloContinuationJob[]>;
  loadCheckpointView: (batchId: string) => Promise<ApolloContinuationCheckpointView | null>;
  /** Reanuda la corrida desde su checkpoint. No puede comprar páginas. */
  resumeRun: (input: {
    job: ApolloContinuationJob;
    checkpoint: ApolloContinuationCheckpointView;
    /**
     * AGENT1-AUDIT-WS2 § 1 — inicio del CONDUCTOR (reloj de `now`). El plazo de la
     * corrida reanudada cuenta desde aquí: el segundo trabajo de una invocación no
     * tiene 300 s, tiene lo que dejó el primero.
     */
    invocationStartedAtMs: number;
  }) => Promise<ApolloContinuationRunOutcome>;
  /** Cierra el trabajo. `resolution` viaja para que la cola sea auditable. */
  settleJob: (input: {
    jobId: string;
    /** § 3 — sin el token que reclamó el trabajo, el cierre no se aplica. */
    leaseToken: string;
    status: 'completed' | 'pending' | 'failed' | 'skipped';
    resolution: ApolloContinuationJobResolution;
    errorCode?: string;
    /**
     * AGENT1-STUCK-RUNS-CLOSE-1 — la cuenta de intentos vuelve a cero: el trabajo
     * vuelve a la cola tras AVANZAR (o sin haber empezado), no tras fallar. Así
     * el tope corta los cortes repetidos y no una corrida larga y sana.
     */
    resetAttempts?: boolean;
  }) => Promise<void>;
  now: () => number;
};

export type ApolloContinuationWorkerOptions = {
  /** Cuántos trabajos se reclaman por invocación. */
  limit?: number;
  lockDurationMinutes?: number;
  /**
   * Plazo de reloj del conductor. Se comprueba ANTES de tomar cada trabajo,
   * nunca a mitad: un trabajo empezado se termina siempre.
   */
  timeBudgetMs?: number;
  workerId?: string;
  /** § 5 — acota el reclamo a un lote. Lo usa la continuación en sesión. */
  batchId?: string | null;
  /**
   * AGENT1-AUDIT-WS2 § 1 — límite duro de la invocación y hueco mínimo que un
   * trabajo necesita para valer la pena. Un trabajo sólo EMPIEZA si al límite le
   * quedan al menos `minJobRoomMs`; si no, vuelve a la cola intacto.
   */
  invocationLimitMs?: number;
  minJobRoomMs?: number;
};

export type ApolloContinuationWorkerStats = {
  claimed: number;
  completed: number;
  requeued: number;
  failed: number;
  skipped: number;
  /** Trabajos que no se llegaron a tomar porque se agotó el plazo. */
  deferredForTime: number;
  resolutions: { jobId: string; resolution: ApolloContinuationJobResolution }[];
  durationMs: number;
};

export const APOLLO_CONTINUATION_DEFAULT_LIMIT = 3;
export const APOLLO_CONTINUATION_DEFAULT_LOCK_MINUTES = 5;

/**
 * Plazo del conductor.
 *
 * Deliberadamente por debajo del presupuesto de evaluación de UNA corrida
 * (150 s) más margen: el conductor puede tomar varios trabajos, y cada uno trae
 * su propio plazo. Ver § 6 para la aritmética completa.
 */
export const APOLLO_CONTINUATION_TIME_BUDGET_MS = 240_000;

/** Límite real de una invocación (el mismo que `RUNTIME_INVOCATION_LIMIT_MS`). */
export const APOLLO_CONTINUATION_INVOCATION_LIMIT_MS = 300_000;

/**
 * AGENT1-AUDIT-WS2 § 1 — hueco mínimo para EMPEZAR un trabajo: una tanda de
 * evaluación (18 s) + la escritura del lote (45 s) + el margen de salida (20 s),
 * redondeado hacia arriba. Con menos, la corrida reanudada se pausaría al instante
 * o, peor, Vercel la cortaría escribiendo. Antes el conductor sólo miraba sus
 * 240 s, así que un segundo trabajo podía empezar a falta de 60 s del límite.
 */
export const APOLLO_CONTINUATION_MIN_JOB_ROOM_MS = 120_000;

/**
 * ¿Puede EMPEZAR otro trabajo? Puro. Exige las dos cosas: que el conductor no haya
 * agotado su propio plazo y que al límite de la invocación le quede el hueco
 * mínimo de un trabajo.
 */
export function canStartContinuationJob(input: {
  elapsedMs: number;
  timeBudgetMs: number;
  invocationLimitMs?: number;
  minJobRoomMs?: number;
}): boolean {
  if (input.elapsedMs >= input.timeBudgetMs) return false;
  const limit = input.invocationLimitMs ?? APOLLO_CONTINUATION_INVOCATION_LIMIT_MS;
  const room = input.minJobRoomMs ?? APOLLO_CONTINUATION_MIN_JOB_ROOM_MS;
  return limit - input.elapsedMs >= room;
}

/**
 * ¿La identidad del trabajo es la del checkpoint?
 *
 * Las tres piezas, y las tres tienen que coincidir. `wizardRunId` admite `null`
 * en checkpoints escritos antes de que el campo existiera; en ese caso la
 * identidad la prueban la clave de idempotencia y la huella, exactamente como
 * hace la fusión de checkpoints.
 */
export function continuationIdentityMatches(
  job: ApolloContinuationJob,
  checkpoint: ApolloContinuationCheckpointView,
): boolean {
  if (checkpoint.idempotencyKey !== job.idempotencyKey) return false;
  if (checkpoint.requestFingerprint !== job.requestFingerprint) return false;
  if (checkpoint.wizardRunId !== null && checkpoint.wizardRunId !== job.wizardRunId) return false;
  return true;
}

/**
 * AGENT1-STUCK-RUNS-CLOSE-1 — código con el que se cierra un trabajo que se tomó
 * más veces de las permitidas sin llegar a cerrarse.
 */
export const APOLLO_CONTINUATION_MAX_ATTEMPTS_EXCEEDED = 'max_attempts_exceeded';

/** Procesa UN trabajo. Nunca lanza: el desenlace siempre se decide aquí. */
async function resolveJob(
  job: ApolloContinuationJob,
  deps: ApolloContinuationWorkerDeps,
  invocationStartedAtMs: number,
): Promise<{ resolution: ApolloContinuationJobResolution; errorCode?: string }> {
  // 🔴 AGENT1-STUCK-RUNS-CLOSE-1 — el reclamo suma un intento ANTES de que el
  // conductor lo vea y no mira el máximo. Una ejecución que Vercel corta por
  // tiempo nunca llega a cerrar el trabajo: su turno vence, se vuelve a tomar y
  // así sin fin (Prod 07-10, AR×Gobierno b61a430d: 4 intentos de 3). Pasado el
  // máximo se cierra SIN reanudar: reanudar podría volver a gastar.
  if (job.attempts > job.maxAttempts) {
    return { resolution: 'exhausted', errorCode: APOLLO_CONTINUATION_MAX_ATTEMPTS_EXCEEDED };
  }

  let checkpoint: ApolloContinuationCheckpointView | null;
  try {
    checkpoint = await deps.loadCheckpointView(job.batchId);
  } catch (error) {
    return {
      resolution: job.attempts >= job.maxAttempts ? 'exhausted' : 'failed',
      errorCode: error instanceof Error ? error.message : 'checkpoint_read_failed',
    };
  }

  // Sin checkpoint no hay nada que reanudar, y reintentar no lo va a crear.
  if (checkpoint === null) return { resolution: 'identity_mismatch' };

  // Invariante 1 — identidad.
  if (!continuationIdentityMatches(job, checkpoint)) {
    return { resolution: 'identity_mismatch' };
  }

  // Invariante 2 — idempotencia, medida por TRABAJO PENDIENTE.
  //
  // 🔴 § 1 — aquí estaba el defecto que hacía inútil toda la continuación:
  // la condición era `candidatesPersisted || pending === 0`. Como una corrida
  // pausada llegaba igual a persistir, `candidates_persisted` salía `true` y el
  // trabajo se cerraba como «nada pendiente» SIN evaluar una sola organización.
  //
  // Lo único que significa «no queda trabajo» es que no queden organizaciones
  // pendientes. La no duplicación de filas NO se defiende aquí: la defiende el
  // runner, que lee `candidates_persisted` antes de escribir y devuelve lo ya
  // escrito en vez de reescribirlo.
  //
  // 🔴 AGENT1-APOLLO-CONTINUATION-PERSIST-COMPLETED-RUN-1 — con una excepción:
  // la corrida que TERMINÓ de evaluar (`run_completed`) y se quedó sin tiempo
  // ESCRIBIENDO. Medido en Producción el 2026-09-30 (México × Tecnología, lote
  // `6d39ed4b`): 3 búsquedas y 5 enrichments pagados, checkpoint
  // `run_completed`, 0 candidatas escritas, lease caducado. Cerrarla aquí como
  // «nada pendiente» tiraba lo pagado. Se reanuda para ESCRIBIR: el runner
  // restaura las operaciones completadas (ninguna búsqueda ni enrichment se
  // repite) y lee `candidates_persisted` antes de escribir.
  //
  // Sólo con `run_completed`: un checkpoint de pausa con 0 pendientes (p. ej.
  // `round_assessment_completed`) no afirma que la evaluación terminara, y
  // reanudarlo podría abrir gasto que nadie autorizó en esta vuelta.
  if (checkpoint.pendingOrganizationCount === 0) {
    const persistOnly = checkpoint.assessmentCompleted === true && !checkpoint.candidatesPersisted;
    if (!persistOnly) return { resolution: 'nothing_pending' };
  }

  let outcome: ApolloContinuationRunOutcome;
  try {
    outcome = await deps.resumeRun({ job, checkpoint, invocationStartedAtMs });
  } catch (error) {
    return {
      resolution: job.attempts >= job.maxAttempts ? 'exhausted' : 'failed',
      errorCode: error instanceof Error ? error.message : 'resume_failed',
    };
  }

  // Invariante 3 — varias vueltas. Mientras quede trabajo pendiente el flujo
  // sigue, y termina cuando ya no queda.
  if (outcome.assessmentDeadlineReached && outcome.pendingOrganizationCount > 0) {
    return { resolution: 'requeued' };
  }
  return { resolution: 'completed' };
}

/** Estado durable con el que se cierra cada desenlace. */
const STATUS_BY_RESOLUTION: Record<
  ApolloContinuationJobResolution,
  'completed' | 'pending' | 'failed' | 'skipped'
> = {
  completed: 'completed',
  nothing_pending: 'completed',
  // Vuelve a la cola: hay más trabajo y hará falta otra invocación.
  requeued: 'pending',
  // Reintentable: el trabajo sigue vivo con un intento más gastado.
  failed: 'pending',
  // Agotó los intentos. Se para para que no haya bucle infinito.
  exhausted: 'failed',
  // No es un fallo: es trabajo de otra corrida. No se reintenta.
  identity_mismatch: 'skipped',
};

export async function runApolloRoundContinuationWorker(
  deps: ApolloContinuationWorkerDeps,
  options: ApolloContinuationWorkerOptions = {},
): Promise<ApolloContinuationWorkerStats> {
  const startedAt = deps.now();
  const timeBudgetMs = options.timeBudgetMs ?? APOLLO_CONTINUATION_TIME_BUDGET_MS;
  const workerId = options.workerId ?? `apollo-continuation-${startedAt}`;

  const jobs = await deps.claimJobs({
    workerId,
    limit: options.limit ?? APOLLO_CONTINUATION_DEFAULT_LIMIT,
    lockDurationMinutes: options.lockDurationMinutes ?? APOLLO_CONTINUATION_DEFAULT_LOCK_MINUTES,
    batchId: options.batchId ?? null,
  });

  const stats: ApolloContinuationWorkerStats = {
    claimed: jobs.length,
    completed: 0,
    requeued: 0,
    failed: 0,
    skipped: 0,
    deferredForTime: 0,
    resolutions: [],
    durationMs: 0,
  };

  for (const job of jobs) {
    // Invariante 5 — el plazo se mira ANTES de empezar un trabajo. Uno ya
    // empezado se termina; uno no empezado vuelve a la cola intacto.
    // AGENT1-AUDIT-WS2 § 1 — y además tiene que caber: no basta con que el
    // conductor no haya agotado sus 240 s, al límite de la invocación le tiene
    // que quedar el hueco mínimo de un trabajo.
    if (
      !canStartContinuationJob({
        elapsedMs: deps.now() - startedAt,
        timeBudgetMs,
        invocationLimitMs: options.invocationLimitMs,
        minJobRoomMs: options.minJobRoomMs,
      })
    ) {
      stats.deferredForTime++;
      await deps.settleJob({
        jobId: job.id,
        leaseToken: job.leaseToken,
        status: 'pending',
        resolution: 'requeued',
        resetAttempts: true,
      });
      continue;
    }

    const { resolution, errorCode } = await resolveJob(job, deps, startedAt);
    const status = STATUS_BY_RESOLUTION[resolution];
    await deps.settleJob({
      jobId: job.id,
      leaseToken: job.leaseToken,
      status,
      resolution,
      ...(errorCode ? { errorCode } : {}),
      ...(resolution === 'requeued' ? { resetAttempts: true } : {}),
    });

    stats.resolutions.push({ jobId: job.id, resolution });
    if (status === 'completed') stats.completed++;
    else if (status === 'pending') stats.requeued++;
    else if (status === 'failed') stats.failed++;
    else stats.skipped++;
  }

  stats.durationMs = deps.now() - startedAt;
  return stats;
}


/**
 * ¿Este resultado de pipeline describe una PAUSA RECUPERABLE de Apollo?
 *
 * Existe para que el llamador no tenga que ensanchar `IncrementalSearchOutput`
 * —el contrato COMPARTIDO por todos los proveedores— con un campo que sólo
 * Apollo produce. Lee la señal sin afirmar nada cuando no está: un proveedor que
 * no la emite no está en pausa, está sin pausar.
 */
export function readApolloAssessmentDeadlineReached(output: unknown): boolean {
  if (typeof output !== 'object' || output === null) return false;
  return (output as { assessmentDeadlineReached?: unknown }).assessmentDeadlineReached === true;
}

/**
 * AGENT1-AUDIT-WS2 § 5 — ¿queda trabajo de Apollo que ALGUIEN va a retomar?
 *
 * Igual que `readApolloAssessmentDeadlineReached`, salvo cuando el runner declara
 * que la continuación NO se pudo encolar (`continuationEnqueued: false`): entonces
 * nadie la retoma, la corrida ya escribió lo evaluado y Apollo es, de hecho,
 * terminal. Tratarla como provisional bloqueaba a Lusha para siempre.
 */
export function readApolloContinuationPending(output: unknown): boolean {
  if (!readApolloAssessmentDeadlineReached(output)) return false;
  return (output as { continuationEnqueued?: unknown }).continuationEnqueued !== false;
}

/**
 * AGENT1-APOLLO-CONTINUATION-COMPLETES § 4 — la política AUTORIZADA de la
 * corrida, congelada en el momento de la pausa.
 *
 * Existe porque la cascada se reevalúa DESPUÉS, posiblemente horas más tarde, y
 * para entonces una bandera global puede haber cambiado. Un cambio posterior no
 * puede habilitar gasto que la corrida original tenía excluido: la decisión se
 * toma con la conjunción de esta foto Y el estado actual, así que sólo puede
 * volverse más restrictiva, nunca más permisiva.
 */
export type ApolloContinuationRunPolicy = {
  /** ¿El waterfall estaba habilitado cuando la corrida arrancó? */
  readonly waterfallEnabledAtRunStart: boolean;
  /** ¿Lusha estaba disponible cuando la corrida arrancó? */
  readonly lushaAvailableAtRunStart: boolean;
  /** Objetivo de la corrida. Un reintento no lo reinicia. */
  readonly target: number;
  readonly countryCode: string;
  readonly macroIndustryKey: string | null;
  readonly subIndustryId: number | null;
  /** El lote canónico de la corrida. La pierna escribe DENTRO de él. */
  readonly batchId: string;
  readonly requestedSubindustries: readonly string[];
  readonly wizardClientRequestId: string;
  /**
   * AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — los DATOS con los que el mago
   * resolvía la aceptación de esta corrida.
   *
   * Viajan aquí porque la función que los usaba no puede viajar: la cola es
   * JSON. Opcional porque un trabajo encolado antes de este corte no los lleva,
   * y para ése la continuación publica sin aceptación antes que inventarla.
   */
  readonly acceptanceFacts?: RunAcceptanceFacts | null;
};

/**
 * La columna `metadata` de un trabajo de la cola, tal como vuelve de la base.
 *
 * 🔴 Es JSON leído de Postgres: dato NO confiable, y sin funciones.
 */
export type ContinuationJobMetadata<TRunInput extends object> =
  | {
      run_input?: TRunInput | null;
      run_policy?: ApolloContinuationRunPolicy | null;
    }
  | null
  | undefined;

/**
 * AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — el `run_input` con el que se
 * reanuda, reconstruido desde la cola.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * El runner encolaba su `input` entero, y ese `input` llevaba la FUNCIÓN con la
 * que el writer resuelve `accepted_for_target`. JSON descarta las funciones sin
 * avisar, así que la continuación escribía el lote sin aceptación. Como la
 * primera pasada de una corrida pausada no escribe, toda corrida de Apollo que se
 * pausaba terminaba sin `accepted_for_target` (lote `c681bfcd`, 2026-09-22).
 *
 * 🔴 Aquí no hay una aritmética nueva: se valida lo que volvió de la base y se
 * vuelve a atar `buildWriterAcceptedForTargetMetadata`, la MISMA que usa el mago.
 * Si los hechos faltan —trabajo anterior al corte— o no cuadran, la corrida se
 * reanuda igual y sin resolutor: la clave queda ausente, que es verdad, en vez de
 * presente con un número inventado.
 *
 * `null` sólo cuando no hay `run_input`: sin él no se puede reanudar sin
 * inventar criterios, que es la regla que el worker ya aplicaba.
 */
export function restoreContinuationRunInput<TRunInput extends object>(
  metadata: ContinuationJobMetadata<TRunInput>,
): {
  runInput: TRunInput & { resolveExtraBatchMetadata?: ResolveExtraBatchMetadata | null };
  acceptanceRestored: boolean;
} | null {
  const stored = metadata?.run_input;
  if (!stored || typeof stored !== 'object') return null;

  // 🔴 AGENT1-CONTINUATION-PROVIDER-SEEN-REHYDRATE-1 — JSON también borró los
  // `Set`/`Map` de la memoria provider-seen (quedaron `{}`), y al reanudar
  // `memory.providerEntityIds.has(...)` lanzaba `TypeError`. Se reconstruyen aquí,
  // igual que se reata la función de aceptación: lo que vuelve de la base es
  // JSON, no el objeto que se encoló. Las filas encoladas antes de este corte
  // traen `{}` y reviven como memoria vacía, que es lo único que dicen.
  const prior = (stored as { priorProviderSeen?: unknown }).priorProviderSeen;
  const runInput = (
    prior === undefined || prior === null
      ? stored
      : { ...stored, priorProviderSeen: revivePriorProviderSeen(prior) }
  ) as TRunInput;

  const facts = parseRunAcceptanceFacts(metadata?.run_policy?.acceptanceFacts);
  if (!facts) return { runInput, acceptanceRestored: false };

  const resolveExtraBatchMetadata: ResolveExtraBatchMetadata = (outcome) =>
    buildWriterAcceptedForTargetMetadata(facts, outcome);
  return { runInput: { ...runInput, resolveExtraBatchMetadata }, acceptanceRestored: true };
}

/**
 * § 4 — la decisión de cascada que una CONTINUACIÓN puede tomar.
 *
 * Es la CONJUNCIÓN de la política autorizada de la corrida con el estado
 * actual. La dirección es el contrato: un cambio posterior de una bandera
 * global puede APAGAR la pierna, nunca encenderla. Una corrida que arrancó con
 * el waterfall apagado no puede gastar en Lusha porque alguien lo encendió
 * mientras su trabajo esperaba en la cola.
 */
export function resolveContinuationCascadeInputs(
  policy: ApolloContinuationRunPolicy,
  current: { waterfallEnabled: boolean; lushaAvailable: boolean },
): { waterfallEnabled: boolean; lushaAvailable: boolean } {
  return {
    waterfallEnabled: policy.waterfallEnabledAtRunStart && current.waterfallEnabled,
    lushaAvailable: policy.lushaAvailableAtRunStart && current.lushaAvailable,
  };
}

/**
 * AGENT1-CONTINUATION-LUSHA-CASCADE-1 — cuántas empresas CUENTAN para el objetivo
 * cuando la cascada decide si Lusha corre tras una continuación.
 *
 * Tiene que ser la MISMA autoridad que usa la corrida en sesión
 * (`acceptedForTargetTotal`, CUT-7: el hueco lo fija lo ACEPTADO, no lo
 * persistido). Antes la cascada pasaba `candidatesCreated` —filas escritas,
 * incluidas las `needs_review`—: medido en Producción el 2026-09-30 (México ×
 * Tecnología, lote `6d39ed4b`), 154 filas escritas y 0 aceptadas hicieron que
 * Lusha se saltara con «objetivo cumplido».
 *
 * Orden: la cifra DURABLE que el writer publicó en el lote (cubre también el
 * caso en que la escritura la hizo un intento anterior) y, si no se pudo leer,
 * la del writer de ESTE intento. Sin ninguna de las dos ⇒ `null`: la cascada NO
 * corre, porque sin saber qué falta no se autoriza gasto.
 */
/**
 * AGENT1-AUDIT-WS2 §§ 3, 4 — Lusha tras una continuación sólo EMPIEZA si no han
 * pasado más de esto desde el inicio del conductor (el mismo margen que la corrida
 * en sesión deja a Lusha: `TAVILY_FIRST_LUSHA_START_LIMIT_MS`).
 */
export const APOLLO_CONTINUATION_LUSHA_START_LIMIT_MS = 200_000;

export type ContinuationLushaSkipReason = 'skipped_no_time' | 'skipped_no_session';

/**
 * AGENT1-AUDIT-WS2 §§ 3, 4 — las dos condiciones que la cascada tras una
 * continuación exige ANTES de llamar a Lusha. Puro.
 *
 *   · tiempo: la cascada corría hasta a los ~280 s, sin guarda; Vercel la cortaba
 *     con la reserva de Lusha recién hecha;
 *   · sesión: la acción de Lusha exige un usuario (`requireActiveUser`) y desde el
 *     cron NO hay sesión: redirigía, la pierna salía `leg_failed` y nadie lo veía.
 *     Sin sesión se salta A PROPÓSITO, con motivo, sin saltarse la autenticación.
 *
 * `null` ⇒ puede seguir hacia la decisión normal de la pierna.
 */
export function decideContinuationLushaPrecondition(input: {
  elapsedMs: number;
  hasUserSession: boolean;
  startLimitMs?: number;
}): ContinuationLushaSkipReason | null {
  if (input.elapsedMs > (input.startLimitMs ?? APOLLO_CONTINUATION_LUSHA_START_LIMIT_MS)) {
    return 'skipped_no_time';
  }
  if (!input.hasUserSession) return 'skipped_no_session';
  return null;
}

export function resolveCascadeAcceptedForTarget(input: {
  durableAcceptedTotal: number | null | undefined;
  completeValidCandidates: number | null | undefined;
}): number | null {
  const pick = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
  return pick(input.durableAcceptedTotal) ?? pick(input.completeValidCandidates);
}
