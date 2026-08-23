/**
 * wizard-batch-failure.ts — Cierra un lote reservado por el wizard cuando el
 * pipeline o el proveedor falla.
 *
 * Sólo toca la columna de estado — la metadata existente (incluido
 * client_request_id y los campos de contexto del wizard) se conserva
 * automáticamente. No crea lotes compensatorios.
 *
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-1 (segunda mitad de P0 G2).
 *
 * El defecto que cierra: esto marcaba `failed` SIEMPRE. Un lote que ya contenía
 * candidatos durables —por ejemplo las filas gratuitas de una corrida mixta—
 * quedaba anunciado como fallido entero porque el proveedor de pago murió
 * después. El fallo del proveedor era cierto; el estado del LOTE, no.
 *
 * Lo que cambia y lo que NO:
 *   * el fallo del proveedor NO se traga ni se reescribe: el resultado de la
 *     acción lo sigue reportando tal cual;
 *   * sólo deja de mentir el estado del LOTE cuando el lote tiene contenido.
 */

import {
  resolveBatchFailureStatusDecision,
  type BatchTerminalStatus,
  type DurableCandidateKnowledge,
} from '@/server/prospect-batches/batch-durable-candidates';

export class WizardBatchFailureError extends Error {
  constructor(
    public readonly batchId: string,
    public readonly reason: string,
    public readonly cause?: unknown,
  ) {
    super(`Failed to mark batch ${batchId} as failed (reason: ${reason})`);
    this.name = 'WizardBatchFailureError';
  }
}

/**
 * Injectable function that updates a single batch row.
 * Returns an object with an error field, or null on success.
 *
 * CUT-1 — el estado viaja como ARGUMENTO. Antes el llamador cerraba
 * `status: 'failed'` dentro del closure, así que esta función no podía decidir
 * nada aunque supiera la verdad.
 */
export type BatchUpdateFn = (
  id: string,
  status: BatchTerminalStatus,
) => Promise<{ error: { message?: string; code?: string } | null }>;

/**
 * Sonda inyectable: ¿cuántas filas durables contiene ya el lote?
 *
 * Devuelve conocimiento, no un número: «no se pudo leer» es una respuesta
 * legítima y distinta de «hay cero» (§ 10).
 */
export type BatchDurableCandidateProbeFn = (
  batchId: string,
) => Promise<DurableCandidateKnowledge>;

/** Qué se hizo con el lote. El fallo del proveedor se reporta aparte. */
export type WizardBatchFailureOutcome =
  | { action: 'marked_failed' }
  | { action: 'preserved_for_review'; durableCandidates: number }
  | { action: 'left_untouched'; reason: 'durable_candidate_count_unavailable' };

/**
 * Cierra el lote de forma coherente con lo que el lote CONTIENE.
 *
 *   lote con filas durables ⇒ `ready_for_review` (hay algo real que revisar)
 *   lote vacío              ⇒ `failed`           (comportamiento previo, intacto)
 *   lectura imposible       ⇒ no se escribe nada (§ 10)
 *
 * § 10 — FAIL-CLOSED CONTRA MENTIR EN LAS DOS DIRECCIONES, no fail-open. Cuando
 * la sonda no puede responder, este camino no tiene ninguna verdad propia sobre
 * filas: el pipeline murió antes de escribir. Escribir `ready_for_review`
 * inventaría contenido; escribir `failed` AFIRMARÍA que hay cero, que es
 * exactamente la conversión que § 10 prohíbe («no se pudo determinar» ⇒ «hay
 * cero»). Por eso no se escribe estado: el lote conserva el que tenía, que es lo
 * único cierto, y un reintento vuelve a sondear.
 *
 * § 11/§ 12 — idempotente y monótono: la decisión sale del CONTENIDO del lote,
 * no de cuántas veces se haya invocado, así que un segundo manejador de fallo
 * converge al mismo estado y nunca degrada `ready_for_review` a `failed`.
 *
 * Lanza WizardBatchFailureError si la escritura falla — el llamador debe
 * capturarla para no enmascarar el error original del pipeline.
 */
export async function markWizardBatchFailed(
  batchId: string,
  reason: 'batchid_mismatch' | 'pipeline_error',
  updateFn: BatchUpdateFn,
  probeDurableCandidates: BatchDurableCandidateProbeFn,
): Promise<WizardBatchFailureOutcome> {
  const durableCandidates = await probeDurableCandidates(batchId);
  const decision = resolveBatchFailureStatusDecision({ durableCandidates });

  if (decision.action === 'preserve') {
    return { action: 'left_untouched', reason: decision.reason };
  }

  const { error } = await updateFn(batchId, decision.status);
  if (error) {
    throw new WizardBatchFailureError(batchId, reason, error);
  }

  return decision.status === 'failed'
    ? { action: 'marked_failed' }
    : {
        action: 'preserved_for_review',
        durableCandidates: durableCandidates.known ? durableCandidates.count : 0,
      };
}
