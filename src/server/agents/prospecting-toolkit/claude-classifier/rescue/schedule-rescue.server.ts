/**
 * Agente 1 · Rescate con Claude — disparo en segundo plano al terminar una búsqueda.
 *
 * Una sola llamada desde la acción del asistente. Usa `after()` de Next: corre
 * cuando la respuesta ya salió, así la búsqueda no espera a Claude. Nunca lanza:
 * un fallo del rescate no puede convertir una búsqueda exitosa en un error.
 */

import { after } from 'next/server';
import { isAgent1ClaudeRescueEnabled } from '@/lib/feature-flags.server';

type WizardRunResultLike = { ok: boolean; batchId?: unknown };

export function scheduleClaudeRescueAfterWizardRun(
  result: WizardRunResultLike,
  resolveTriggeredBy: () => Promise<string | null>,
): void {
  if (!isAgent1ClaudeRescueEnabled()) return;
  if (!result.ok || typeof result.batchId !== 'string' || !result.batchId) return;
  const batchId = result.batchId;
  try {
    after(async () => {
      try {
        const [{ rescueBatchWithClaude }, { buildLiveRescueBatchDeps }, triggeredBy] = await Promise.all([
          import('./rescue-batch'),
          import('./rescue-batch.server'),
          resolveTriggeredBy().catch(() => null),
        ]);
        const summary = await rescueBatchWithClaude({ batchId, triggeredBy }, buildLiveRescueBatchDeps(triggeredBy));
        console.info('[claude-rescue] batch', batchId, JSON.stringify(summary));
      } catch (err) {
        console.error('[claude-rescue] background run failed:', err instanceof Error ? err.message : err);
      }
    });
  } catch (err) {
    console.error('[claude-rescue] could not schedule:', err instanceof Error ? err.message : err);
  }
}
