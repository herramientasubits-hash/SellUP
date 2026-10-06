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
      try {
        const [{ runRescueRound, triggerRescueContinuation }, triggeredBy] = await Promise.all([
          import('./rescue-chain.server'),
          resolveTriggeredBy().catch(() => null),
        ]);
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
          includeUnassessed: options.includeUnassessed === true,
        });
      } catch (err) {
        console.error('[claude-rescue] background run failed:', err instanceof Error ? err.message : err);
      }
    });
  } catch (err) {
    console.error('[claude-rescue] could not schedule:', err instanceof Error ? err.message : err);
  }
}
