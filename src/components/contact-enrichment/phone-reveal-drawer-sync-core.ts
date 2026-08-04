/**
 * Núcleo PURO de la sincronización del drawer de un candidato con el estado
 * persistido de su phone reveal (Agente 2A · AGENT2A-PHONE-REVEAL-UI-STATE-1).
 *
 * Problema que resuelve: el backend ya cerraba el reveal (webhook + recovery
 * escriben `phone_reveal_status` terminal), pero el drawer podía seguir diciendo
 * "Revelación en proceso" y conservando el aviso «Apollo aún está procesando el
 * resultado». Tres causas se combinaban:
 *   1. `phoneRecoveryNotice` quedaba fijado en React tras la revisión manual y
 *      nada lo retiraba cuando llegaba el estado terminal;
 *   2. el refresco acotado (LIVE-REFRESH-1) tiene un presupuesto de 90 s y
 *      Apollo tardó más, sin que la UI dijera que ya había dejado de mirar;
 *   3. el drawer abierto no volvía a leer el candidato por su cuenta (reabrirlo
 *      sí mostraba el estado terminal correcto).
 *
 * Este módulo NO llama a Apollo, NO llama a Lusha, NO inicia reveals, NO ejecuta
 * recovery y NO escribe usage logs: sólo decide, a partir del estado que YA
 * devolvió el servidor, qué estado local hay que descartar y cuándo conviene
 * volver a leer. Sin imports (ni React) para que las reglas sean verificables de
 * forma aislada.
 *
 * Invariantes:
 *  - La autoridad es SIEMPRE el servidor: un estado terminal persistido gana
 *    sobre cualquier mensaje local, nunca al revés.
 *  - Fail-closed: entradas desconocidas o ausentes se tratan como "no en vuelo",
 *    porque el error seguro es limpiar un aviso de más, no conservar uno falso.
 *  - Ningún refresco por foco/visibilidad se convierte en polling: siempre pasa
 *    por la ventana mínima de `shouldRefreshOnWindowSignal`.
 */

/**
 * Estados del reveal en los que TODAVÍA se espera un resultado del proveedor.
 * Espejo deliberado de `PHONE_REVEAL_LIVE_REFRESH_IN_FLIGHT_STATUSES`: son el
 * mismo concepto, pero este módulo no importa nada para conservar su pureza y el
 * test `phone-reveal-drawer-sync-core` verifica que las dos listas coincidan.
 */
export const PHONE_REVEAL_IN_FLIGHT_STATUSES = ['requested', 'pending'] as const;

/**
 * Ventana mínima entre dos refrescos disparados por señales de ventana (foco /
 * `visibilitychange`). Cambiar de pestaña emite varias señales seguidas — y en
 * algunos navegadores `focus` y `visibilitychange` llegan juntas —, así que sin
 * esta ventana un solo cambio de pestaña provocaría una ráfaga de lecturas.
 */
export const PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS = 3_000;

/**
 * Copy mostrado cuando el refresco automático YA agotó su presupuesto y el reveal
 * sigue en vuelo. Es deliberadamente distinto de
 * `PHONE_REVEAL_LIVE_REFRESH_COPY`: afirmar «Actualizando el estado
 * automáticamente…» cuando ya no se está actualizando es exactamente la mentira
 * que este hito corrige. No promete que SellUp siga mirando, porque no lo hace.
 */
export const PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY =
  'La actualización automática terminó. Apollo puede seguir procesando el resultado. Actualiza el estado o vuelve a abrir este candidato para consultar la información más reciente.';

/**
 * ¿El reveal sigue esperando un resultado del proveedor?
 *
 * Fail-closed: cualquier valor que no sea exactamente uno de los estados en
 * vuelo (incluidos `null`, `undefined` y estados desconocidos) devuelve `false`.
 */
export function isPhoneRevealInFlightStatus(
  status: string | null | undefined,
): boolean {
  if (typeof status !== 'string') return false;
  return (PHONE_REVEAL_IN_FLIGHT_STATUSES as readonly string[]).includes(status);
}

/**
 * ¿Hay que descartar el estado local temporal del reveal (aviso de revisión
 * manual, spinners, mensaje de «aún está procesando»)?
 *
 * `true` en cuanto el candidato que devolvió el SERVIDOR deja de estar en vuelo:
 * `revealed`, `no_phone_found`, `error`, `not_requested`, `null` o cualquier
 * estado desconocido. Es la regla que impide que «Apollo aún está procesando el
 * resultado» sobreviva a un resultado ya persistido.
 *
 * Se expresa como la negación explícita de "en vuelo" (y no como una lista de
 * estados terminales) a propósito: así un estado nuevo que se añada en el futuro
 * limpia el aviso por defecto en vez de conservarlo indefinidamente.
 */
export function shouldClearLocalPhoneRevealState(
  serverPhoneRevealStatus: string | null | undefined,
): boolean {
  return !isPhoneRevealInFlightStatus(serverPhoneRevealStatus);
}

export interface PhoneRevealWindowRefreshInput {
  /** `true` sólo si el drawer está abierto. Cerrado no se refresca nada. */
  readonly open: boolean;
  /** Candidato abierto. Sin candidato no hay nada que releer. */
  readonly candidateId: string | null;
  /**
   * Marca temporal (ms) del último refresco por señal de ventana, o `null` si
   * todavía no hubo ninguno en este ciclo.
   */
  readonly lastRefreshAtMs: number | null;
  /** Marca temporal (ms) de la señal que se está evaluando. */
  readonly nowMs: number;
}

/**
 * ¿Debe una señal de ventana (foco recuperado / pestaña vuelta a `visible`)
 * disparar UNA lectura del candidato?
 *
 * Reglas, todas fail-closed:
 *  - drawer cerrado           ⇒ no;
 *  - sin candidato            ⇒ no;
 *  - marcas de tiempo no finitas ⇒ no (nunca se refresca "por si acaso");
 *  - dentro de la ventana mínima desde el último refresco ⇒ no (debounce).
 *
 * No consulta el estado del reveal a propósito: volver a la pestaña es una buena
 * razón para releer el candidato incluso cuando ya está terminal — es justamente
 * lo que retira un aviso local obsoleto. La lectura es de la base de SellUp, así
 * que no cuesta créditos ni toca a ningún proveedor.
 */
export function shouldRefreshOnWindowSignal(
  input: PhoneRevealWindowRefreshInput,
): boolean {
  if (!input.open) return false;
  if (!input.candidateId) return false;
  if (!Number.isFinite(input.nowMs)) return false;
  const last = input.lastRefreshAtMs;
  if (last === null) return true;
  if (!Number.isFinite(last)) return false;
  // Un reloj que retrocede (ajuste de hora, monotonía rota) no debe abrir la
  // puerta a una ráfaga: se trata como "demasiado reciente".
  const elapsed = input.nowMs - last;
  if (elapsed < 0) return false;
  return elapsed >= PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS;
}
