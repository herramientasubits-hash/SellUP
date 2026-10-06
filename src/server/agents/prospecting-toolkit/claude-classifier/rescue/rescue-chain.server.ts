/**
 * Agente 1 · Rescate con Claude — una vuelta del rescate y, si queda trabajo, la
 * siguiente en una función NUEVA de Vercel (SOURCES-EC-CLOSE-2).
 *
 * La siguiente vuelta se pide a la ruta `/api/cron/claude-rescue-continuation`,
 * autenticada con `CRON_SECRET` como los crons. Esa ruta responde enseguida y hace
 * el trabajo en su propio `after()`, con sus propios 300 s.
 *
 * Nunca lanza: si no se puede pedir la siguiente vuelta (sin `CRON_SECRET`, sin URL
 * de la app, red caída), queda para el botón del lote, como antes.
 */

import { decideRescueContinuation, type RescueContinuationRequest } from './rescue-chain';

export const RESCUE_CONTINUATION_PATH = '/api/cron/claude-rescue-continuation';
/** Sólo hace falta que la ruta ACEPTE la vuelta (responde 202 al instante). */
const TRIGGER_TIMEOUT_MS = 10_000;

/**
 * URL base de la app: la configurada, o el dominio de producción que Vercel publica
 * solo (`VERCEL_PROJECT_PRODUCTION_URL`, sin protocolo). `null` si no hay ninguna.
 */
export function rescueContinuationBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured;
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return production ? `https://${production}` : null;
}

/** Pide la siguiente vuelta. `true` si la ruta la aceptó. */
export async function triggerRescueContinuation(request: RescueContinuationRequest): Promise<boolean> {
  const base = rescueContinuationBaseUrl();
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.warn('[claude-rescue] continuation not scheduled: missing app URL or CRON_SECRET');
    return false;
  }
  try {
    const response = await fetch(new URL(RESCUE_CONTINUATION_PATH, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('[claude-rescue] continuation rejected:', response.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[claude-rescue] continuation trigger failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Corre UNA vuelta del rescate del lote y, si `decideRescueContinuation` lo dice,
 * pide la siguiente. Nunca lanza.
 */
export async function runRescueRound(params: {
  batchId: string;
  triggeredBy: string | null;
  deadlineMs: number;
  /** Vueltas extra ya hechas (0 = la del final de la búsqueda). */
  continuationsDone: number;
  /** Gasto del rescate de este lote en vueltas anteriores. */
  spentBeforeUsd: number;
  includeUnassessed?: boolean;
}): Promise<void> {
  try {
    const [{ rescueBatchWithClaude }, { buildLiveRescueBatchDeps }] = await Promise.all([
      import('./rescue-batch'),
      import('./rescue-batch.server'),
    ]);
    const summary = await rescueBatchWithClaude(
      {
        batchId: params.batchId,
        triggeredBy: params.triggeredBy,
        deadlineMs: params.deadlineMs,
        includeUnassessed: params.includeUnassessed === true,
      },
      buildLiveRescueBatchDeps(params.triggeredBy),
    );
    const spentUsd = params.spentBeforeUsd + (summary.ok ? summary.estimatedCostUsd : 0);
    const decision = decideRescueContinuation({ summary, continuationsDone: params.continuationsDone, spentUsd });
    console.info(
      '[claude-rescue] batch',
      params.batchId,
      JSON.stringify({ round: params.continuationsDone, summary, spentUsd, decision }),
    );
    if (decision.continue) {
      await triggerRescueContinuation({
        batchId: params.batchId,
        continuation: decision.nextContinuation,
        spentUsd,
        triggeredBy: params.triggeredBy,
      });
    }
  } catch (err) {
    console.error('[claude-rescue] round failed:', err instanceof Error ? err.message : err);
  }
}
