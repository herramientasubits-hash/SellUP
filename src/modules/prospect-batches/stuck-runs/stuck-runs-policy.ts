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
 *   · AGENT1-AUDIT-WS1 — lo mismo para un lote del Agente 1 que sigue en
 *     «borrador»: el asistente reserva el lote en `draft` y el camino de Apollo
 *     no lo mueve hasta escribir, así que una corrida que murió antes de
 *     escribir dejaba el lote en borrador para siempre. Sólo `source = agent_1`:
 *     los borradores manuales no son corridas y no se tocan.
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
 * AUDIT-HARDENING-1 — el barrido automático sólo cierra borradores del Agente 1 que
 * se movieron en las últimas 72 h. Sin esta ventana, el primer barrido tras
 * desplegar cerraría de golpe todos los borradores históricos (y los que tuvieran
 * filas reaparecerían en las colas de revisión). Los viejos se siguen pudiendo
 * terminar a mano desde la página del lote.
 */
export const STUCK_DRAFT_SWEEP_MAX_AGE_HOURS = 72;

/** Origen de los lotes del Agente 1: los únicos cuyos borradores son corridas. */
export const AGENT1_BATCH_SOURCE = 'agent_1';

/** Estados de lote que una corrida trabada puede dejar abiertos. */
export const STUCK_BATCH_OPEN_STATUSES = ['generating', 'draft'] as const;

/**
 * ¿Puede el cierre de corridas trabadas tocar un lote en este estado? «Generando»
 * siempre; «borrador» sólo si es del Agente 1 (un borrador manual no es una corrida).
 */
export function isClosableStuckBatchStatus(input: { status: string; source: string | null | undefined }): boolean {
  if (input.status === 'generating') return true;
  return input.status === 'draft' && input.source === AGENT1_BATCH_SOURCE;
}

/** ¿Este borrador del Agente 1 lleva demasiado sin moverse? Mismo umbral que «generando». */
export function isDraftAgentBatchIdle(input: {
  status: string;
  source: string | null | undefined;
  updatedAt: string | null;
  nowMs: number;
}): boolean {
  if (input.status !== 'draft' || input.source !== AGENT1_BATCH_SOURCE || input.updatedAt === null) return false;
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
  /** AUDIT-HARDENING-1 — un borrador trabado del Agente 1 también es una corrida detenida. */
  source?: string | null;
}): 'paused' | 'stalled' | 'none' {
  if (input.hasOpenContinuation) return 'paused';
  return isBatchIdle(input) || isDraftAgentBatchIdle({ ...input, source: input.source ?? null }) ? 'stalled' : 'none';
}
