/**
 * Núcleo PURO del refresco acotado del candidato mientras un Apollo Phone Reveal
 * está en vuelo (Agente 2A · APOLLO-PHONE-REVEAL-LIVE-REFRESH-1).
 *
 * Problema que resuelve: el backend ya cierra el reveal por webhook en decenas de
 * segundos (persistiendo `phone_reveal_status`, el teléfono y su badge), pero el
 * drawer seguía mostrando "Revelación en proceso" hasta que el usuario recargaba
 * la página. El gap era exclusivamente de UI.
 *
 * Este módulo NO llama a Apollo, NO llama a Lusha, NO llama a HubSpot, NO inicia
 * reveals y NO ejecuta recovery: solo decide CUÁNDO conviene volver a leer el
 * candidato ya abierto y CUÁNDO hay que parar. Sin imports (ni siquiera React),
 * para que la política de parada sea verificable de forma aislada.
 *
 * Invariantes:
 *  - El refresco es acotado en el tiempo: nunca es un bucle infinito.
 *  - Solo aplica a estados en vuelo (`requested` / `pending`) y sin teléfono.
 *  - Cualquier estado terminal (revealed / no_phone_found / error / not_requested)
 *    lo apaga, igual que la aparición de un teléfono.
 */

/** Estados del reveal en los que aún se espera un resultado de Apollo. */
export const PHONE_REVEAL_LIVE_REFRESH_IN_FLIGHT_STATUSES = [
  'requested',
  'pending',
] as const;

/**
 * Primer refetch. Se espera un poco antes del primer intento porque el reveal
 * recién solicitado ya provocó un refetch propio en el handler del botón.
 */
export const PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS = 5_000;

/** Cadencia de los refetch siguientes. Deliberadamente tranquila: no es tiempo real. */
export const PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS = 8_000;

/**
 * Presupuesto total del refresco. Pasado este tiempo el drawer deja de refrescar
 * solo y el usuario conserva las salidas que ya existían (revisión manual L3 a
 * partir de los 2 min, recovery programado del servidor, reabrir el candidato).
 */
export const PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS = 90_000;

/** Copy mostrado mientras el refresco acotado está activo. */
export const PHONE_REVEAL_LIVE_REFRESH_COPY = 'Actualizando el estado automáticamente…';

export interface PhoneRevealLiveRefreshEligibilityInput {
  /** `phone_reveal_status` del candidato tal como lo proyecta el servidor. */
  readonly phoneRevealStatus: string | null | undefined;
  /** `true` si el candidato ya muestra un teléfono (nada que esperar). */
  readonly hasPhone: boolean;
  /** `true` si hay una acción de aprobar/rechazar en curso. */
  readonly busy: boolean;
  /**
   * `true` mientras hay una solicitud ACEPTADA por el servidor que el estado leído
   * todavía no refleja (ASYNC-UI-REFRESH-1; lo decide
   * `isPhoneRevealSubmissionLatchActive`).
   *
   * Por qué existe: antes el refresco sólo podía arrancar si la lectura YA traía
   * `requested`/`pending`. Esa lectura es justamente la que puede fallar, llegar
   * tarde o adelantarse al START — y cuando fallaba nadie volvía a mirar, porque el
   * único disparador del sondeo era el dato que faltaba. Con el pestillo, el
   * refresco arranca por el HECHO de haber solicitado, no por haberlo leído.
   *
   * No relaja ninguna parada: el presupuesto de tiempo, el teléfono presente, el
   * estado terminal y el cierre del drawer siguen apagándolo igual.
   */
  readonly submissionLatchActive?: boolean;
}

/**
 * Decide si el drawer debe refrescar el candidato por su cuenta.
 *
 * Fail-closed: sin estado en vuelo leído y sin solicitud aceptada pendiente de
 * confirmar, devuelve `false`. Un teléfono ya presente también apaga el refresco
 * aunque el estado siguiera en vuelo (el dato que se esperaba ya está en pantalla).
 */
export function isPhoneRevealLiveRefreshEligible(
  input: PhoneRevealLiveRefreshEligibilityInput,
): boolean {
  if (input.hasPhone) return false;
  if (input.busy) return false;
  if (input.submissionLatchActive === true) return true;
  const status = input.phoneRevealStatus;
  if (typeof status !== 'string') return false;
  return (PHONE_REVEAL_LIVE_REFRESH_IN_FLIGHT_STATUSES as readonly string[]).includes(
    status,
  );
}

/**
 * Retardo del siguiente refetch, o `null` cuando ya no debe programarse ninguno.
 *
 * `attempt` es la cantidad de refetch ya realizados por este ciclo y `elapsedMs`
 * el tiempo consumido desde que arrancó. Devolver `null` es la única condición de
 * parada por tiempo: quien la consuma no debe volver a programar nada. Entradas
 * inválidas (negativas, NaN, no finitas) también paran — fail-closed.
 */
export function resolveNextLiveRefreshDelayMs(
  attempt: number,
  elapsedMs: number,
): number | null {
  if (!Number.isFinite(attempt) || attempt < 0) return null;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const delay =
    attempt === 0
      ? PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS
      : PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS;
  if (elapsedMs + delay > PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS) return null;
  return delay;
}
