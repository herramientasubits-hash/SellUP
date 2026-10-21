/**
 * Agente 1 · Rescate con Claude — sobre qué lote corre el rescate al terminar
 * una búsqueda del asistente (AGENT1-CRITERIA-QUICK-WINS-1 § 3).
 *
 * Antes sólo con `result.ok`: una corrida que guardó filas gratuitas sin web y
 * luego murió (presupuesto agotado, proveedor caído) dejaba esas filas sin
 * rescate. Ahora también corre sobre el lote del aporte gratuito, si hay filas.
 */

export type WizardRunResultLike = {
  ok: boolean;
  batchId?: unknown;
  freeContribution?: { batchId?: unknown; persistedCandidates?: unknown } | null;
};

/** El lote a rescatar, o `null` si no hay nada que rescatar. */
export function resolveRescueTargetBatchId(result: WizardRunResultLike): string | null {
  if (result.ok) {
    return typeof result.batchId === 'string' && result.batchId ? result.batchId : null;
  }
  const free = result.freeContribution;
  if (!free || typeof free.batchId !== 'string' || !free.batchId) return null;
  return typeof free.persistedCandidates === 'number' && free.persistedCandidates > 0 ? free.batchId : null;
}
