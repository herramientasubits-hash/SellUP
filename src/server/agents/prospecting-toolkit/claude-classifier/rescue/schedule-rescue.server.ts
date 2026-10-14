/**
 * Agente 1 · Rescate con Claude — disparo en segundo plano al terminar una búsqueda.
 *
 * Una sola llamada desde la acción del asistente. Usa `after()` de Next: corre
 * cuando la respuesta ya salió, así la búsqueda no espera a Claude. Nunca lanza:
 * un fallo del rescate no puede convertir una búsqueda exitosa en un error.
 */

import { after } from 'next/server';
import { isAgent1ClaudeRescueEnabled } from '@/lib/feature-flags.server';
import { computeBackgroundRescueDeadlineMs } from './rescue-time-budget';

type WizardRunResultLike = { ok: boolean; batchId?: unknown };

export function scheduleClaudeRescueAfterWizardRun(
  result: WizardRunResultLike,
  resolveTriggeredBy: () => Promise<string | null>,
  /** Cuándo empezó la acción del asistente: `after()` comparte sus 300 s de Vercel. */
  actionStartedAtMs: number,
  /** Lote del piloto «Claude busca empresas» (opcional; el asistente no lo pasa). */
  options: { includeUnassessed?: boolean } = {},
): void {
  if (!isAgent1ClaudeRescueEnabled()) return;
  if (!result.ok || typeof result.batchId !== 'string' || !result.batchId) return;
  const batchId = result.batchId;
  try {
    after(async () => {
      const triggeredBy = await resolveTriggeredBy().catch(() => null);
      await runFirstRescueRound(batchId, triggeredBy, actionStartedAtMs, options.includeUnassessed === true);
    });
  } catch (err) {
    console.error('[claude-rescue] could not schedule:', err instanceof Error ? err.message : err);
  }
}

/**
 * AGENT1-IMPORT-SAME-PIPELINE-1 — la importación pasa por el MISMO rescate que una
 * búsqueda del asistente (decisión de la dueña 14-10). Sus filas no traen
 * `target_completeness`, así que se revisan las que quedaron sin tamaño
 * (`includeUnassessed`, como el piloto). `before` corre primero en el mismo
 * `after()` (el enriquecimiento con IA de la importación): los dos escriben la
 * metadata del candidato y no deben pisarse.
 */
export function scheduleClaudeRescueAfterImport(params: {
  batchId: string;
  triggeredBy: string | null;
  actionStartedAtMs: number;
  /** ¿Quedó alguna fila en revisión? Sin ellas no hay nada que rescatar. */
  hasReviewRows: boolean;
  before: (() => Promise<void>) | null;
}): void {
  const rescue = isAgent1ClaudeRescueEnabled() && params.hasReviewRows;
  if (!rescue && !params.before) return;
  try {
    after(async () => {
      if (params.before) {
        await params.before().catch((err) => {
          console.error('[claude-rescue] import pre-step failed:', err instanceof Error ? err.message : err);
        });
      }
      if (rescue) await runFirstRescueRound(params.batchId, params.triggeredBy, params.actionStartedAtMs, true);
    });
  } catch (err) {
    console.error('[claude-rescue] could not schedule:', err instanceof Error ? err.message : err);
  }
}

async function runFirstRescueRound(
  batchId: string,
  triggeredBy: string | null,
  actionStartedAtMs: number,
  includeUnassessed: boolean,
): Promise<void> {
  try {
    const { runRescueRound, triggerRescueContinuation } = await import('./rescue-chain.server');
    const deadlineMs = computeBackgroundRescueDeadlineMs(actionStartedAtMs, Date.now());
    if (deadlineMs === null) {
      // La búsqueda ya usó casi todo el tiempo de la función: no se empieza nada
      // que Vercel pueda cortar a la mitad. SOURCES-EC-CLOSE-2 — en vez de dejarlo
      // para el botón, la 1.ª vuelta corre en una función nueva.
      console.info('[claude-rescue] batch', batchId, 'deferred: not enough function time left');
      await triggerRescueContinuation({ batchId, continuation: 1, spentUsd: 0, triggeredBy });
      return;
    }
    // SOURCES-EC-CLOSE-2 — si queda trabajo, la vuelta pide la siguiente sola.
    await runRescueRound({
      batchId,
      triggeredBy,
      deadlineMs,
      continuationsDone: 0,
      spentBeforeUsd: 0,
      includeUnassessed,
    });
  } catch (err) {
    console.error('[claude-rescue] background run failed:', err instanceof Error ? err.message : err);
  }
}
