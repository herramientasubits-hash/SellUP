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
