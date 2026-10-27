import type { WizardExecutionFailureCode } from '../chat-wizard-execution/wizard-execution-types';
import type { BulkSearchProgress, BulkSearchStatus, BulkStopReason } from './bulk-search-types';

/**
 * Qué hace una búsqueda masiva antes de cada ronda, y qué significa el
 * resultado de la ronda. Puro: el servidor (PR 2) lee la fila, recuenta desde
 * cero y pregunta aquí.
 */

/** Una ronda sin ninguna empresa nueva = el mercado de esa búsqueda se agotó. */
export const BULK_EXHAUSTION_EMPTY_ROUNDS = 1;
/** Tantas rondas fallidas seguidas terminan la búsqueda. */
export const BULK_MAX_CONSECUTIVE_FAILURES = 3;
/** Cuánto esperar antes de reintentar cuando otra corrida ocupa el cupo. */
export const BULK_RETRY_AFTER_MS = 30_000;

export type BulkNextStep =
  | { kind: 'run_round' }
  | { kind: 'wait'; reason: 'continuation_pending'; retryAfterMs: number }
  | { kind: 'stop'; status: BulkSearchStatus; reason: BulkStopReason | null };

export function decideBulkNextStep(
  progress: BulkSearchProgress,
  context: { perRoundPaidCredits: number; continuationPending: boolean },
): BulkNextStep {
  // Pausada o terminada: no se lanza nada, y la fila ya dice por qué.
  if (progress.status !== 'running') return { kind: 'stop', status: progress.status, reason: null };
  if (progress.deliveredCount >= progress.targetCount) {
    return { kind: 'stop', status: 'completed', reason: 'target_reached' };
  }
  if (progress.consecutiveEmptyRounds >= BULK_EXHAUSTION_EMPTY_ROUNDS) {
    return { kind: 'stop', status: 'exhausted', reason: 'no_new_companies' };
  }
  if (progress.roundsDone >= progress.maxRounds) {
    return { kind: 'stop', status: 'exhausted', reason: 'max_rounds' };
  }
  if (progress.consecutiveFailedRounds >= BULK_MAX_CONSECUTIVE_FAILURES) {
    return { kind: 'stop', status: 'failed', reason: 'repeated_failures' };
  }
  // El tope nunca se pasa: si lo que queda no cubre el PEOR caso de otra ronda,
  // no se lanza.
  if (progress.creditCap - progress.creditsUsed < context.perRoundPaidCredits) {
    return { kind: 'stop', status: 'budget_capped', reason: 'credit_cap' };
  }
  // La ronda anterior dejó organizaciones pagadas por evaluar: primero esas.
  if (context.continuationPending) {
    return { kind: 'wait', reason: 'continuation_pending', retryAfterMs: BULK_RETRY_AFTER_MS };
  }
  return { kind: 'run_round' };
}

/** Lo que una ronda que no salió bien le hace a la búsqueda. */
export type BulkRoundFailureEffect =
  /** Otra corrida ocupa el cupo: la ronda no cuenta y se reintenta. */
  | { kind: 'skip'; retryAfterMs: number }
  /** Sin presupuesto del mes o del proveedor: la búsqueda termina con lo que lleva. */
  | { kind: 'stop'; status: 'budget_capped'; reason: 'monthly_budget' }
  /** No se puede seguir (permiso, piloto, esquema): la búsqueda termina. */
  | { kind: 'stop'; status: 'failed'; reason: 'not_allowed' | 'repeated_failures' }
  /** Falla pasajera: cuenta como ronda fallida y se reintenta. */
  | { kind: 'retry' };

const BUDGET_CODES: readonly WizardExecutionFailureCode[] = [
  'BUDGET_EXCEEDED',
  'EXECUTION_CREDIT_LIMIT_EXCEEDED',
  'BUDGET_PERIOD_CLOSED',
  'BUDGET_PERIOD_NOT_CONFIGURED',
];

const FATAL_CODES: readonly WizardExecutionFailureCode[] = [
  'EXECUTION_DISABLED',
  'NOT_ALLOWED_FOR_ROLE',
  'UNAUTHENTICATED',
  'INACTIVE_USER',
  'INVALID_REQUEST',
  'CATALOG_CHANGED',
  'PILOT_PAUSED',
  'NOT_IN_PILOT',
  'PERSISTENCE_NOT_READY',
];

export function classifyRoundFailure(code: WizardExecutionFailureCode): BulkRoundFailureEffect {
  if (code === 'CONCURRENT_EXECUTION_ACTIVE') return { kind: 'skip', retryAfterMs: BULK_RETRY_AFTER_MS };
  if (BUDGET_CODES.includes(code)) return { kind: 'stop', status: 'budget_capped', reason: 'monthly_budget' };
  if (FATAL_CODES.includes(code)) return { kind: 'stop', status: 'failed', reason: 'not_allowed' };
  // PROVIDER_UNAVAILABLE, GENERATION_FAILED, BUDGET_RESERVATION_FAILED, IDEMPOTENCY_CONFLICT.
  return { kind: 'retry' };
}

/** Cómo quedan los contadores después de una ronda que sí corrió. */
export function applySucceededRound(
  progress: Pick<BulkSearchProgress, 'roundsDone' | 'consecutiveEmptyRounds'>,
  deliveredNew: number,
): { roundsDone: number; consecutiveEmptyRounds: number; consecutiveFailedRounds: number } {
  return {
    roundsDone: progress.roundsDone + 1,
    consecutiveEmptyRounds: deliveredNew > 0 ? 0 : progress.consecutiveEmptyRounds + 1,
    consecutiveFailedRounds: 0,
  };
}
