/**
 * Núcleo PURO del pestillo de solicitud del reveal asíncrono
 * (Agente 2A · AGENT2A-PHONE-REVEAL-ASYNC-UI-REFRESH-1).
 *
 * Problema que resuelve. Todo el estado de espera del drawer —el badge
 * «Revelación en proceso» y el refresco acotado de LIVE-REFRESH-1— se derivaba
 * EXCLUSIVAMENTE del `phone_reveal_status` LEÍDO del servidor. Eso deja un hueco
 * que en Producción se vio entero: el handler apaga su propio spinner en su
 * `finally`, pero el refetch que traería el estado nuevo va por libre (`void`), así
 * que entre esos dos momentos el candidato en memoria sigue siendo el ANTERIOR y el
 * drawer se vuelve a pintar IDLE — mismo botón, misma pantalla, como si no se
 * hubiera pedido nada. Y el hueco no se cerraba solo: el sondeo automático dependía
 * del mismo estado leído que faltaba, así que un refetch lento, caído o servido
 * antes de que el START confirmara dejaba la UI idle indefinidamente. El usuario
 * sólo veía su teléfono recargando el navegador.
 *
 * Este módulo aporta el dato que faltaba: «el cliente YA envió una solicitud que el
 * servidor aceptó». Con él, el estado de espera y el sondeo dejan de depender de una
 * sola lectura afortunada.
 *
 * Lo que NO hace: no llama a proveedores, no inicia reveals, no consume créditos y
 * no sustituye a la autoridad del servidor. El pestillo sólo cubre la ventana previa
 * a la primera confirmación; en cuanto el servidor dice algo —en vuelo o terminal—
 * manda el servidor, siempre. Sin imports (ni React) para poder verificarlo aislado.
 */

/** Copy del CTA mientras la solicitud está aceptada pero aún sin confirmar. */
export const PHONE_REVEAL_SUBMITTED_COPY = "Buscando teléfono…";

/**
 * Copy de apoyo bajo el CTA en espera. Dice lo que SellUp está haciendo y que la
 * pantalla se actualiza sola — que es justo lo que el usuario de la QA no supo, y
 * por lo que acabó recargando el navegador. No promete plazo: Apollo responde
 * cuando responde, y el refresco automático está acotado a propósito.
 */
export const PHONE_REVEAL_SUBMITTED_HELPER_COPY =
  "SellUp está buscando el teléfono y actualiza esta pantalla automáticamente. No hace falta recargar.";

/**
 * Estados en los que el SERVIDOR ya confirmó que hay un reveal en vuelo. A partir
 * de aquí el pestillo sobra: la UI en vuelo de siempre (badge + copy + revisión
 * manual L3) toma el relevo.
 */
export const PHONE_REVEAL_CONFIRMED_IN_FLIGHT_STATUSES = [
  "requested",
  "pending",
] as const;

/**
 * Estados terminales. Cierran el caso y, con él, el pestillo — aunque el cliente
 * creyera estar esperando. El servidor es la autoridad, también para apagar.
 */
export const PHONE_REVEAL_TERMINAL_STATUSES = [
  "revealed",
  "no_phone_found",
  "error",
] as const;

export interface PhoneRevealSubmissionLatchInput {
  /** `true` desde que un envío del usuario fue ACEPTADO por el servidor. */
  readonly submitted: boolean;
  /** `phone_reveal_status` del candidato tal como lo proyecta el servidor. */
  readonly phoneRevealStatus: string | null | undefined;
  /** `true` si el candidato ya muestra un teléfono (no queda nada que esperar). */
  readonly hasPhone: boolean;
}

/**
 * ¿Sigue vigente el pestillo — es decir, hay una solicitud aceptada que el estado
 * leído todavía no refleja?
 *
 * Sólo es `true` en la ventana intermedia: hubo envío aceptado, no hay teléfono, y
 * el servidor aún no ha dicho ni «en vuelo» ni nada terminal. Un estado desconocido
 * se trata como «todavía no confirmado» a propósito: el pestillo mantiene la espera
 * visible en vez de devolver el CTA a idle, y quien lo consume lo acota igual en el
 * tiempo (el presupuesto del refresco) — nunca es una espera infinita por sí mismo.
 */
export function isPhoneRevealSubmissionLatchActive(
  input: PhoneRevealSubmissionLatchInput,
): boolean {
  if (!input.submitted) return false;
  if (input.hasPhone) return false;
  const status = input.phoneRevealStatus;
  if (typeof status !== "string") return true;
  if (
    (PHONE_REVEAL_CONFIRMED_IN_FLIGHT_STATUSES as readonly string[]).includes(
      status,
    )
  ) {
    return false;
  }
  if ((PHONE_REVEAL_TERMINAL_STATUSES as readonly string[]).includes(status)) {
    return false;
  }
  return true;
}

/**
 * Resultados del server action que dejan una solicitud REALMENTE en vuelo.
 *
 * Se listan explícitamente en vez de aceptar «cualquier cosa que no sea un error»:
 * encender la espera por un resultado que no dejó nada corriendo dejaría el CTA
 * bloqueado sin motivo, y ese bloqueo impide reintentar algo que sí es reintentable.
 * `already_pending` cuenta porque describe exactamente el mismo hecho — hay un
 * reveal esperando resultado — aunque no lo haya iniciado este clic.
 */
export const PHONE_REVEAL_SUBMISSION_ACCEPTED_RESULTS = [
  "requested",
  "already_pending",
] as const;

/** ¿Este resultado del server action deja una solicitud en vuelo? */
export function isPhoneRevealSubmissionAccepted(
  status: string | null | undefined,
): boolean {
  if (typeof status !== "string") return false;
  return (
    PHONE_REVEAL_SUBMISSION_ACCEPTED_RESULTS as readonly string[]
  ).includes(status);
}
