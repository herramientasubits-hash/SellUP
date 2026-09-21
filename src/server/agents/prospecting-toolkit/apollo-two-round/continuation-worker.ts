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
  }) => Promise<readonly ApolloContinuationJob[]>;
  loadCheckpointView: (batchId: string) => Promise<ApolloContinuationCheckpointView | null>;
  /** Reanuda la corrida desde su checkpoint. No puede comprar páginas. */
  resumeRun: (input: {
    job: ApolloContinuationJob;
    checkpoint: ApolloContinuationCheckpointView;
  }) => Promise<ApolloContinuationRunOutcome>;
  /** Cierra el trabajo. `resolution` viaja para que la cola sea auditable. */
  settleJob: (input: {
    jobId: string;
    status: 'completed' | 'pending' | 'failed' | 'skipped';
    resolution: ApolloContinuationJobResolution;
    errorCode?: string;
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

/** Procesa UN trabajo. Nunca lanza: el desenlace siempre se decide aquí. */
async function resolveJob(
  job: ApolloContinuationJob,
  deps: ApolloContinuationWorkerDeps,
): Promise<{ resolution: ApolloContinuationJobResolution; errorCode?: string }> {
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

  // Invariante 2 — idempotencia. Un lote ya cerrado, o sin pendientes, no se
  // vuelve a ejecutar: reanudar dos veces no puede duplicar candidatas.
  if (checkpoint.candidatesPersisted || checkpoint.pendingOrganizationCount === 0) {
    return { resolution: 'nothing_pending' };
  }

  let outcome: ApolloContinuationRunOutcome;
  try {
    outcome = await deps.resumeRun({ job, checkpoint });
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
    if (deps.now() - startedAt >= timeBudgetMs) {
      stats.deferredForTime++;
      await deps.settleJob({ jobId: job.id, status: 'pending', resolution: 'requeued' });
      continue;
    }

    const { resolution, errorCode } = await resolveJob(job, deps);
    const status = STATUS_BY_RESOLUTION[resolution];
    await deps.settleJob({ jobId: job.id, status, resolution, ...(errorCode ? { errorCode } : {}) });

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
