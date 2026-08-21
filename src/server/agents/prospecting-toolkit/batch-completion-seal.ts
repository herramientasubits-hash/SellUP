/**
 * batch-completion-seal.ts — Sellado terminal del lote (`completed_at`).
 *
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 · § 7.
 *
 * El defecto que cierra: el lote `e1622574…` quedó en `ready_for_review` —un
 * estado terminal para la corrida: ya no va a cambiar por sí solo— con
 * `completed_at = null`. Nada lo escribía. Cualquier consumidor que mida
 * duración, latencia o antigüedad de la corrida leía «sin terminar» sobre un lote
 * terminado, y un lote sin fecha de cierre no se puede ordenar ni comparar con
 * los demás.
 *
 * Dos reglas, y las dos importan:
 *
 *   1. Un estado terminal SIEMPRE escribe `completed_at`.
 *   2. Un lote que sigue activo NUNCA lo escribe — ni siquiera «por si acaso».
 *
 * Idempotencia: dos cierres terminales no pueden producir marcas de tiempo
 * contradictorias. La primera gana y las siguientes no tocan nada. La condición
 * se aplica además en la propia escritura (`completed_at IS NULL`), de modo que
 * dos procesos concurrentes tampoco puedan pisarse.
 *
 * Puro: sin I/O, sin reloj. El instante entra como dato.
 */

/**
 * Estados en los que la corrida ya no va a avanzar por sí sola.
 *
 * `completed_with_errors` se incluye porque el contrato del § 7 lo nombra; el
 * CHECK de `prospect_batches` no lo admite hoy, así que en la práctica nunca
 * llega. Se deja declarado para que, si algún día se añade, el sellado ya lo
 * cubra en vez de olvidarlo en silencio.
 *
 * `in_review` NO está: hay una persona trabajando sobre el lote. `draft` y
 * `generating` tampoco: la corrida sigue viva.
 */
const TERMINAL_BATCH_STATUSES: ReadonlySet<string> = new Set([
  'ready_for_review',
  'completed',
  'completed_with_errors',
  'failed',
]);

export function isTerminalBatchStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && TERMINAL_BATCH_STATUSES.has(status);
}

export type BatchCompletionSealDecision = {
  /** Hay que escribir `completed_at`. */
  shouldWrite: boolean;
  /** Valor a escribir. `null` cuando no hay que escribir nada. */
  completedAt: string | null;
  reason:
    | 'terminal_status_sealed'
    | 'already_sealed'
    | 'status_not_terminal';
};

/**
 * Decide si un lote debe sellarse.
 *
 * Un `completed_at` ya presente se respeta SIEMPRE, aunque el estado terminal
 * haya cambiado después (`ready_for_review` → `failed` tras un reintento): la
 * fecha de cierre marca cuándo la corrida dejó de avanzar, y reescribirla haría
 * que dos lecturas de la misma corrida devolvieran instantes distintos.
 */
export function decideBatchCompletionSeal(input: {
  status: string | null | undefined;
  currentCompletedAt: string | null | undefined;
  now: Date;
}): BatchCompletionSealDecision {
  if (input.currentCompletedAt) {
    return { shouldWrite: false, completedAt: input.currentCompletedAt, reason: 'already_sealed' };
  }
  if (!isTerminalBatchStatus(input.status)) {
    return { shouldWrite: false, completedAt: null, reason: 'status_not_terminal' };
  }
  return {
    shouldWrite: true,
    completedAt: input.now.toISOString(),
    reason: 'terminal_status_sealed',
  };
}
