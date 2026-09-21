/**
 * apollo-continuation-status.ts — el estado que la UI puede enseñar.
 *
 * AGENT1-APOLLO-CONTINUATION-COMPLETES § 5.
 *
 * Puro y sin `'use server'`: lo importan tanto la acción de servidor como los
 * componentes, y así el mapeo estado→copy se prueba sin red.
 */

/**
 * Estados con los que la cola durable describe un trabajo.
 *
 * AGENT1-APOLLO-CONTINUATION-WIZARD-WIRING § 1 — se NOMBRA porque ahora hay un
 * lector que los produce. Mientras la unión vivía en línea dentro de la firma
 * del resolutor, cada llamador la reescribía por su cuenta.
 */
export type ApolloContinuationJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped';

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

/**
 * AGENT1-APOLLO-CONTINUATION-WIZARD-WIRING § 2 — título de la superficie.
 *
 * La pantalla necesita un encabezado que diga QUÉ es esto antes del estado. Sin
 * él, «Procesando las empresas que quedaron pendientes…» aparece suelto en el
 * panel y se confunde con el progreso de una búsqueda nueva.
 */
export const APOLLO_CONTINUATION_PANEL_TITLE = 'La corrida quedó a medias';

/**
 * § 2 — lo que se dice mientras la ventana está abierta y el navegador conduce.
 *
 * 🔴 No promete inmediatez: la vuelta la puede estar ejecutando otro (el cron o
 * la misma corrida en otra pestaña), y entonces esta pestaña sólo espera.
 */
export const APOLLO_CONTINUATION_IN_SESSION_NOTE =
  'Mientras esta ventana siga abierta, seguimos retomando el mismo lote. No se ' +
  'inicia otra búsqueda ni se vuelve a cobrar la que ya se pagó.';

/**
 * § 2 — el intento NO llegó al servidor.
 *
 * 🔴 No es `failed` en el sentido de la cola. El trabajo no agotó sus intentos:
 * fue esta pantalla la que no pudo hablar con el servidor. Decir «la
 * continuación falló» aquí sugeriría que el trabajo se perdió, y no se perdió.
 */
export const APOLLO_CONTINUATION_TRANSPORT_ERROR_COPY =
  'No pudimos contactar con el servidor para seguir la corrida. El trabajo sigue ' +
  'guardado y se retomará.';

/** Estados en los que ya no hay nada más que conducir desde la pantalla. */
export function isApolloContinuationTerminal(status: ApolloContinuationUiStatus): boolean {
  return status === 'finished' || status === 'failed';
}

/** Deriva el estado visible de las señales durables. Sin heurísticas. */
export function resolveApolloContinuationUiStatus(input: {
  readonly pendingOrganizationCount: number;
  readonly jobStatus: ApolloContinuationJobStatus | null;
}): ApolloContinuationUiStatus {
  if (input.jobStatus === 'failed') return 'failed';
  // Sin trabajo pendiente la corrida está cerrada, diga lo que diga la cola: un
  // trabajo huérfano no puede convertir en «pendiente» un lote ya terminado.
  if (input.pendingOrganizationCount === 0) return 'finished';
  if (input.jobStatus === 'processing') return 'processing';
  return 'pending_continuation';
}
