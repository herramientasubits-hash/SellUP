/**
 * Agente 1 · Búsqueda en árbol — cuando la respuesta de la corrida no llega al
 * navegador (Prod 14-10, Cencosud: el servidor terminó y guardó 17 empresas, pero
 * el chat dijo «falló»), se sigue la corrida por su id hasta ver su lote.
 *
 * Puro: la consulta, la espera y el reloj se inyectan.
 */

import type { AgentRunStatusSnapshot } from '@/modules/prospect-batches/agent-runs/agent-runs-status.server';

/** Cuánto se espera al lote antes de rendirse (la corrida dura como mucho 300 s). */
export const TREE_RUN_RECOVERY_TIMEOUT_MS = 330_000;
export const TREE_RUN_RECOVERY_POLL_MS = 3_000;

export type TreeRunRecovered = { batchId: string; candidateCount: number | null };

export async function waitForTreeRunResult(
  clientRequestId: string,
  deps: {
    fetchStatus: (ids: readonly string[]) => Promise<AgentRunStatusSnapshot[]>;
    sleep: (ms: number) => Promise<void>;
    nowMs: () => number;
    /** Cuándo empezó la corrida: el tope cuenta desde ahí. */
    startedAtMs: number;
    isCancelled?: () => boolean;
  },
): Promise<TreeRunRecovered | null> {
  while (deps.nowMs() - deps.startedAtMs < TREE_RUN_RECOVERY_TIMEOUT_MS) {
    if (deps.isCancelled?.()) return null;
    const statuses = await deps.fetchStatus([clientRequestId]).catch(() => []);
    const status = statuses.find((s) => s.clientRequestId === clientRequestId);
    // El lote del árbol recibe su id al final de la corrida, ya etiquetado: si está, terminó.
    // Mientras el servidor anota etapas, todavía no terminó de guardar.
    if (status?.batch && !status.progress) {
      return { batchId: status.batch.id, candidateCount: status.batch.candidateCount };
    }
    await deps.sleep(TREE_RUN_RECOVERY_POLL_MS);
  }
  return null;
}
