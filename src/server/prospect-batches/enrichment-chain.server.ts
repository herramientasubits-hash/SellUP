/**
 * Enriquecimiento de lo importado — una vuelta del vaciado y, si queda cola, la
 * siguiente en una función NUEVA de Vercel (FEEDBACK 24-11, ver `enrichment-drain.ts`).
 *
 * La siguiente vuelta se pide a `/api/cron/enrich` con `CRON_SECRET`, como el rescate
 * con Claude. Esa ruta responde 202 al instante y vacía en su propio `after()`.
 *
 * Nunca lanza: si no se puede pedir la vuelta (sin `CRON_SECRET`, sin URL, red caída),
 * los trabajos siguen `pending` y los toma la siguiente importación.
 */

import { rescueContinuationBaseUrl } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-chain.server';
import {
  decideEnrichmentContinuation,
  drainEnrichmentJobs,
  ENRICHMENT_CHAIN_MAX_ROUNDS,
  ENRICHMENT_CHAIN_TIME_BUDGET_MS,
  type EnrichmentDrainResult,
} from './enrichment-drain';

export const ENRICHMENT_CONTINUATION_PATH = '/api/cron/enrich';
/** Sólo hace falta que la ruta ACEPTE la vuelta (responde 202 al instante). */
const TRIGGER_TIMEOUT_MS = 10_000;

/** Pide la vuelta `hop`. `true` si la ruta la aceptó. */
export async function triggerEnrichmentContinuation(hop: number): Promise<boolean> {
  const base = rescueContinuationBaseUrl();
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.warn('[EnrichmentChain] continuation not scheduled: missing app URL or CRON_SECRET');
    return false;
  }
  try {
    const response = await fetch(new URL(ENRICHMENT_CONTINUATION_PATH, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ hop }),
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('[EnrichmentChain] continuation rejected:', response.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[EnrichmentChain] continuation trigger failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Si el vaciado `hopsDone` dejó cola, pide la vuelta siguiente. Nunca lanza. */
export async function continueEnrichmentIfQueued(result: EnrichmentDrainResult, hopsDone: number): Promise<void> {
  const decision = decideEnrichmentContinuation(result, hopsDone);
  console.info('[EnrichmentChain] hop', hopsDone, JSON.stringify({ result, decision }));
  if (decision.continue) await triggerEnrichmentContinuation(decision.nextHop);
}

/** Una vuelta encadenada: vacía con su propio plazo y pide la siguiente si queda cola. */
export async function runEnrichmentChainHop(hop: number): Promise<void> {
  const result = await drainEnrichmentJobs({
    timeBudgetMs: ENRICHMENT_CHAIN_TIME_BUDGET_MS,
    maxRounds: ENRICHMENT_CHAIN_MAX_ROUNDS,
  });
  await continueEnrichmentIfQueued(result, hop);
}
