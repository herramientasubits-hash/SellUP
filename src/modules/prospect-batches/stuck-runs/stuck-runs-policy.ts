/**
 * stuck-runs-policy.ts — cuándo una corrida del Agente 1 está trabada y cómo se
 * cierra. AGENT1-STUCK-RUNS-CLOSE-1. Puro: sin E/S, sin reloj (se inyecta).
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 *
 * Prod 06-10 (AR×Tecnología 17da92cf) y 07-10 (AR×Gobierno b61a430d): la corrida
 * dejó en cola una continuación de Apollo que nunca terminó. La función que toma
 * el trabajo (`claim_apollo_round_continuation_jobs`) no mira el máximo de
 * intentos, y el conductor sólo lo daba por agotado ante un ERROR: si Vercel
 * cortaba la ejecución por tiempo, el trabajo quedaba «en proceso», su turno
 * vencía y se volvía a tomar sin fin (b61a430d iba por 4 intentos de 3). El lote
 * quedaba «a medias» en el Centro de procesos hasta cerrarlo a mano.
 *
 * Reglas:
 *   · un trabajo con un turno VIVO nunca se toca: alguien lo está corriendo;
 *   · con los intentos agotados se cierra (`max_attempts_exceeded`);
 *   · con más de 7 días abierto se cierra (`stale_abandoned`): nadie lo espera;
 *   · un lote «generando» sin movimiento por 30 minutos y sin continuación
 *     abierta se cierra: a revisión si tiene empresas, fallido si no.
 */

/** Minutos sin movimiento tras los que un lote «generando» se da por detenido. */
export const STUCK_BATCH_IDLE_MINUTES = 30;
/** Días tras los que una continuación abierta se da por abandonada. */
export const CONTINUATION_ABANDON_DAYS = 7;

export const STUCK_RUN_CLOSE_CODES = {
  exhausted: 'max_attempts_exceeded',
  abandoned: 'stale_abandoned',
  user: 'closed_by_user',
} as const;

export type StuckRunCloseCode = (typeof STUCK_RUN_CLOSE_CODES)[keyof typeof STUCK_RUN_CLOSE_CODES];

const OPEN_JOB_STATUSES: ReadonlySet<string> = new Set(['pending', 'processing']);

export type ContinuationJobState = {
  status: string;
  attempts: number;
  max_attempts: number;
  lease_expires_at: string | null;
  created_at: string;
};

export function isOpenContinuationJob(job: Pick<ContinuationJobState, 'status'>): boolean {
  return OPEN_JOB_STATUSES.has(job.status);
}

/** ¿Alguien tiene ahora mismo el turno de este trabajo? */
export function hasLiveLease(job: Pick<ContinuationJobState, 'status' | 'lease_expires_at'>, nowMs: number): boolean {
  if (job.status !== 'processing' || job.lease_expires_at === null) return false;
  const expires = Date.parse(job.lease_expires_at);
  return Number.isFinite(expires) && expires > nowMs;
}

/** Por qué cerrar esta continuación ahora, o `null` si hay que dejarla. */
export function continuationJobCloseReason(job: ContinuationJobState, nowMs: number): StuckRunCloseCode | null {
  if (!isOpenContinuationJob(job) || hasLiveLease(job, nowMs)) return null;
  if (job.attempts >= job.max_attempts) return STUCK_RUN_CLOSE_CODES.exhausted;
  const created = Date.parse(job.created_at);
  if (Number.isFinite(created) && nowMs - created >= CONTINUATION_ABANDON_DAYS * 86_400_000) {
    return STUCK_RUN_CLOSE_CODES.abandoned;
  }
  return null;
}

/** Estado final de un lote detenido: lo encontrado se revisa; sin nada, fallido. */
export function stuckBatchFinalStatus(candidateCount: number): 'ready_for_review' | 'failed' {
  return candidateCount > 0 ? 'ready_for_review' : 'failed';
}

/** ¿Este lote «generando» lleva demasiado sin moverse? */
export function isBatchIdle(input: { status: string; updatedAt: string | null; nowMs: number }): boolean {
  if (input.status !== 'generating' || input.updatedAt === null) return false;
  const updated = Date.parse(input.updatedAt);
  return Number.isFinite(updated) && input.nowMs - updated >= STUCK_BATCH_IDLE_MINUTES * 60_000;
}

/**
 * Qué mostrar en la página del lote:
 *   · `paused`  — tiene una continuación abierta (se puede continuar o terminar);
 *   · `stalled` — «generando» sin movimiento y sin continuación (sólo terminar);
 *   · `none`    — nada que hacer.
 */
export function batchRunAttention(input: {
  status: string;
  updatedAt: string | null;
  nowMs: number;
  hasOpenContinuation: boolean;
}): 'paused' | 'stalled' | 'none' {
  if (input.hasOpenContinuation) return 'paused';
  return isBatchIdle(input) ? 'stalled' : 'none';
}
