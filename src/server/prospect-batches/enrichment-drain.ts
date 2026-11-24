/**
 * AGENT1-IMPORT-PARITY-10 — que el enriquecimiento con IA de lo importado
 * CORRA de verdad.
 *
 * El defecto que cierra: la importación encolaba trabajos en
 * `prospect_enrichment_jobs`, pero `/api/cron/enrich` nunca estuvo en
 * `vercel.json`. En Producción ningún trabajo se procesó jamás (6 filas, todas
 * `skipped`, de junio).
 *
 * Esto repite el worker existente —sin cambiar QUÉ hace, ni su elegibilidad, ni
 * su bloqueo atómico `claim_enrichment_jobs`— hasta vaciar la cola o agotar un
 * presupuesto de tiempo. Lo llama la importación con `after()` (en segundo
 * plano, sin demorar la respuesta) y el cron como red de seguridad.
 *
 * Nunca lanza: un fallo del worker se registra y corta el vaciado; los trabajos
 * que queden siguen `pending` para la próxima vez.
 */

import { runEnrichmentWorker, type WorkerExecutionStats } from './enrichment-worker';

/** Presupuesto por vaciado. Conservador: cabe dentro del límite de la función. */
export const ENRICHMENT_DRAIN_TIME_BUDGET_MS = 45_000;
/** Tope de rondas (cada ronda reclama `workerBatchSize` trabajos). */
export const ENRICHMENT_DRAIN_MAX_ROUNDS = 20;

export type EnrichmentDrainStopReason = 'queue_empty' | 'time_budget' | 'max_rounds' | 'worker_error';

export type EnrichmentDrainResult = {
  rounds: number;
  processed: number;
  succeeded: number;
  stoppedBy: EnrichmentDrainStopReason;
};

export async function drainEnrichmentJobs(
  options: {
    timeBudgetMs?: number;
    maxRounds?: number;
    runWorker?: () => Promise<WorkerExecutionStats>;
    now?: () => number;
  } = {},
): Promise<EnrichmentDrainResult> {
  const budget = options.timeBudgetMs ?? ENRICHMENT_DRAIN_TIME_BUDGET_MS;
  const maxRounds = options.maxRounds ?? ENRICHMENT_DRAIN_MAX_ROUNDS;
  const runWorker = options.runWorker ?? runEnrichmentWorker;
  const now = options.now ?? Date.now;
  const start = now();

  let rounds = 0;
  let processed = 0;
  let succeeded = 0;

  while (true) {
    if (rounds >= maxRounds) return { rounds, processed, succeeded, stoppedBy: 'max_rounds' };
    if (now() - start >= budget) return { rounds, processed, succeeded, stoppedBy: 'time_budget' };
    let stats: WorkerExecutionStats;
    try {
      stats = await runWorker();
    } catch (err) {
      console.error('[EnrichmentDrain] worker failed; remaining jobs stay pending:', err);
      return { rounds, processed, succeeded, stoppedBy: 'worker_error' };
    }
    rounds++;
    processed += stats.processedCount;
    succeeded += stats.successCount;
    if (stats.processedCount === 0) return { rounds, processed, succeeded, stoppedBy: 'queue_empty' };
  }
}

// ─── Vueltas encadenadas ──────────────────────────────────────────────────────

/**
 * FEEDBACK 24-11 — «Enriquecimiento pendiente» que nunca termina. Prod 24-11: 155
 * trabajos `pending` con 0 intentos (17-11 y 24-11). Cada vaciado cabe ~45 s dentro de
 * la importación y procesa los más viejos primero, así que la importación del 24-11
 * gastó su vaciado en el lote del 17-11 y la suya quedó entera en cola. El cron
 * `/api/cron/enrich` no puede ser la red de seguridad: el plan Hobby de Vercel sólo
 * admite dos crons DIARIOS y ya están ocupados.
 *
 * Por eso, como el rescate con Claude, cuando un vaciado se queda sin tiempo con
 * trabajo en cola pide la siguiente vuelta en una función NUEVA, hasta vaciar la cola.
 */

/** Plazo para EMPEZAR rondas en una vuelta encadenada (la función tiene 300 s). */
export const ENRICHMENT_CHAIN_TIME_BUDGET_MS = 180_000;
/** Rondas por vuelta encadenada (cada ronda reclama `workerBatchSize` trabajos). */
export const ENRICHMENT_CHAIN_MAX_ROUNDS = 80;
/** Tope de vueltas seguidas: una cola que no se vacía no puede encadenarse para siempre. */
export const ENRICHMENT_CHAIN_MAX_HOPS = 30;

export type EnrichmentContinuationDecision = { continue: true; nextHop: number } | { continue: false };

/**
 * ¿Pedir otra vuelta? Sólo si esta vuelta trabajó y se cortó por tiempo o rondas (queda
 * cola). Si la cola se vació, si el worker falló o si se llegó al tope, no.
 */
export function decideEnrichmentContinuation(
  result: EnrichmentDrainResult,
  hopsDone: number,
): EnrichmentContinuationDecision {
  const cutShort = result.stoppedBy === 'time_budget' || result.stoppedBy === 'max_rounds';
  if (!cutShort || result.processed === 0) return { continue: false };
  if (hopsDone >= ENRICHMENT_CHAIN_MAX_HOPS) return { continue: false };
  return { continue: true, nextHop: hopsDone + 1 };
}

/** Cuerpo de la petición de la siguiente vuelta: `{ hop }` (0 si falta o es inválido). */
export function parseEnrichmentHop(body: unknown): number {
  const hop = (body as { hop?: unknown } | null)?.hop;
  return typeof hop === 'number' && Number.isInteger(hop) && hop >= 0 && hop <= ENRICHMENT_CHAIN_MAX_HOPS ? hop : 0;
}
