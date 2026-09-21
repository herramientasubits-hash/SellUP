/**
 * apollo-continuation-status.ts — el estado que la UI puede enseñar.
 *
 * AGENT1-APOLLO-CONTINUATION-COMPLETES § 5.
 *
 * Puro y sin `'use server'`: lo importan tanto la acción de servidor como los
 * componentes, y así el mapeo estado→copy se prueba sin red.
 */

export type ApolloContinuationUiStatus =
  /** Hay un trabajo tomado por alguien y avanzando AHORA. */
  | 'processing'
  /** Queda trabajo y está encolado, pero nadie lo está ejecutando en este momento. */
  | 'pending_continuation'
  /** La corrida cerró: no queda trabajo pendiente. */
  | 'finished'
  /** El trabajo agotó sus intentos. Requiere mirada humana. */
  | 'failed';

export const APOLLO_CONTINUATION_STATUS_COPY: Record<ApolloContinuationUiStatus, string> = {
  processing: 'Procesando las empresas que quedaron pendientes…',
  pending_continuation: 'Pendiente de continuación: el trabajo está guardado y se retomará.',
  finished: 'Terminado.',
  failed: 'La continuación falló. Nada se perdió: las empresas pendientes siguen guardadas.',
};

/**
 * 🔴 Lo que este copy NO promete.
 *
 * La cadencia dice cuándo se puede volver a INTENTAR, no cuándo va a terminar.
 * Un intento puede volver a quedarse sin tiempo y encolar otro. Por eso ningún
 * texto habla de «segundos» ni de «24 horas»: prometer un plazo que el sistema
 * no controla es peor que no prometer ninguno.
 */
export const APOLLO_CONTINUATION_BROWSER_CLOSED_NOTE =
  'Si cierras esta ventana no se pierde nada: el trabajo queda guardado y un proceso ' +
  'diario vuelve a intentarlo. Esa cadencia indica cuándo puede reintentarse, no ' +
  'garantiza que termine en ese plazo.';

/** Deriva el estado visible de las señales durables. Sin heurísticas. */
export function resolveApolloContinuationUiStatus(input: {
  readonly pendingOrganizationCount: number;
  readonly jobStatus: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped' | null;
}): ApolloContinuationUiStatus {
  if (input.jobStatus === 'failed') return 'failed';
  // Sin trabajo pendiente la corrida está cerrada, diga lo que diga la cola: un
  // trabajo huérfano no puede convertir en «pendiente» un lote ya terminado.
  if (input.pendingOrganizationCount === 0) return 'finished';
  if (input.jobStatus === 'processing') return 'processing';
  return 'pending_continuation';
}
