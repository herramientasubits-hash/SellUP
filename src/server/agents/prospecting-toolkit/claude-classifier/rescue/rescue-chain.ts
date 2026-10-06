/**
 * Agente 1 · Rescate con Claude — ¿se relanza solo? (puro).
 *
 * SOURCES-EC-CLOSE-2 — decisión de la dueña (06-10-2026, «4 vueltas, tope US$3»).
 *
 * El rescate automático corre al terminar la búsqueda, dentro de la misma función de
 * Vercel (300 s). Si no le alcanza el tiempo, quedaban empresas pendientes hasta que
 * alguien pulsara el botón del lote (Prod 06-10, EC×Tec 0ef658fd: 51 descartadas sin
 * web, 7 «para reintentar»). Ahora, al acabar, se relanza SOLO en una función nueva
 * mientras quede trabajo, con tres frenos:
 *   - como mucho RESCUE_CHAIN_MAX_CONTINUATIONS vueltas extra por lote;
 *   - se corta si una vuelta no avanzó nada (sitios que siempre fallan, cuenta caída);
 *   - se corta cuando lo gastado en Claude por el rescate del lote llega al tope.
 */

import type { RescueBatchSummary } from './rescue-batch';

/** Vueltas extra después del rescate que corre al terminar la búsqueda. */
export const RESCUE_CHAIN_MAX_CONTINUATIONS = 4;
/** Tope de gasto en Claude del rescate de UN lote, sumando todas las vueltas. */
export const RESCUE_CHAIN_MAX_COST_USD = 3;

export type RescueChainStep = {
  /** Resultado de la vuelta que acaba de terminar. */
  summary: RescueBatchSummary;
  /** Vueltas extra ya hechas antes de ésta (0 = la vuelta fue la del final de la búsqueda). */
  continuationsDone: number;
  /** Gasto acumulado del rescate de este lote, incluida esta vuelta. */
  spentUsd: number;
};

export type RescueChainDecision =
  | { continue: true; nextContinuation: number }
  | { continue: false; reason: 'done' | 'failed' | 'max_continuations' | 'no_progress' | 'cost_cap' };

/** ¿Hay que lanzar otra vuelta? */
export function decideRescueContinuation(step: RescueChainStep): RescueChainDecision {
  const { summary } = step;
  if (!summary.ok) return { continue: false, reason: 'failed' };
  const pending = summary.remaining + summary.failed;
  if (pending <= 0) return { continue: false, reason: 'done' };
  if (step.continuationsDone >= RESCUE_CHAIN_MAX_CONTINUATIONS) return { continue: false, reason: 'max_continuations' };
  const progress =
    summary.candidatesCompleted +
    summary.candidatesDiscarded +
    summary.candidatesUnchanged +
    summary.dispositionsAdmitted +
    summary.dispositionsKept +
    summary.reassigned;
  if (progress === 0) return { continue: false, reason: 'no_progress' };
  if (!(step.spentUsd < RESCUE_CHAIN_MAX_COST_USD)) return { continue: false, reason: 'cost_cap' };
  return { continue: true, nextContinuation: step.continuationsDone + 1 };
}

/** Cuerpo de la petición de la siguiente vuelta (validado al recibirlo). */
export type RescueContinuationRequest = {
  batchId: string;
  continuation: number;
  spentUsd: number;
  triggeredBy: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee y valida el cuerpo; `null` si algo no cuadra (la ruta responde 400). */
export function parseRescueContinuationRequest(body: unknown): RescueContinuationRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const { batchId, continuation, spentUsd, triggeredBy } = b;
  if (typeof batchId !== 'string' || !UUID.test(batchId)) return null;
  if (typeof continuation !== 'number' || !Number.isInteger(continuation)) return null;
  if (continuation < 1 || continuation > RESCUE_CHAIN_MAX_CONTINUATIONS) return null;
  if (typeof spentUsd !== 'number' || !Number.isFinite(spentUsd) || spentUsd < 0) return null;
  // Quién disparó la búsqueda: sólo se arrastra a los registros de gasto; si no tiene
  // forma de identificador interno, se descarta (nunca bloquea la vuelta).
  const who = typeof triggeredBy === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(triggeredBy) ? triggeredBy : null;
  return { batchId, continuation, spentUsd, triggeredBy: who };
}
