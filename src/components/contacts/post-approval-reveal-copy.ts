// Agente 2A — Copy del reveal desde la ficha del contacto OFICIAL
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
//
// Módulo PURO y sin dependencias: ni React, ni servidor, ni flags. Existe separado del componente
// por la razón habitual del subsistema — el texto que le promete un gasto a un operador se puede
// probar palabra por palabra sin montar un drawer — y porque el número de créditos que aparece en
// el botón NO se calcula aquí: llega ya resuelto por la vista previa del servidor, que es la misma
// función que reserva. Este archivo lo formatea; nunca lo inventa.

import type {
  OfficialContactPhoneRevealOfferStatus,
  OfficialContactPhoneRevealOfferView,
} from '@/modules/contact-enrichment/post-approval-reveal-core';

/** Título de la sección. Nombra la operación, no la tecnología. */
export const OFFICIAL_REVEAL_SECTION_TITLE = 'Teléfono';

/** Etiqueta del botón cuando hay que AUTORIZAR una compra. */
export const OFFICIAL_REVEAL_BUY_LABEL = 'Revelar teléfono';

/** Etiqueta del botón cuando lo único que falta es TRAER lo que ya se pagó. */
export const OFFICIAL_REVEAL_REUSE_LABEL = 'Usar teléfono ya obtenido';

/** Estado mientras la operación está en curso. */
export const OFFICIAL_REVEAL_BUSY_LABEL = 'Revelando…';

/**
 * Lo que se lee DEBAJO del botón, antes del clic. Es donde el operador se entera de qué va a
 * pasar y cuánto puede costar.
 *
 * `maxCredits === null` significa que la vista previa no se pudo calcular. En ese caso NO se
 * escribe una cifra: se dice que se confirmará en el servidor. Escribir un suelo inventado es lo
 * que provoca que el arranque rechace la autorización por techo (o, peor, que el operador acepte
 * un gasto mayor del que leyó).
 */
export function officialRevealHelperText(view: OfficialContactPhoneRevealOfferView): string {
  if (view.status === 'reuse_from_candidate') {
    return 'Sin costo: el número ya fue obtenido y pagado para este contacto. Solo se copia a la ficha.';
  }
  if (view.maxCredits === null) {
    return 'Consulta con proveedor. El tope de créditos se confirma en el servidor al autorizar.';
  }
  const legs = view.lushaEligible
    ? view.requiresIdentitySearch
      ? 'Apollo, y si no hay número, búsqueda de identidad en Lusha y su revelado'
      : 'Apollo, y si no hay número, revelado en Lusha'
    : 'Apollo';
  return `Consulta ${legs}. Puede consumir hasta ${view.maxCredits} créditos y tardar algunos minutos.`;
}

/**
 * Por qué NO se ofrece nada. Devuelve `null` cuando el estado no es una razón que le importe al
 * operador: sin candidato fuente y con contacto ilegible el bloque entero no se pinta, porque
 * anunciar «no se puede revelar» en cada contacto del sistema sería ruido.
 *
 * `phone_already_present` SÍ se explica: es el único caso en el que el operador podría estar
 * buscando el botón y merece saber que el número ya está y que hay otra salida.
 */
export function officialRevealUnavailableText(
  status: OfficialContactPhoneRevealOfferStatus,
): string | null {
  if (status === 'phone_already_present') {
    return 'Este contacto ya tiene un teléfono guardado. Para buscar números adicionales usa la revisión del candidato.';
  }
  // ── DURABLE RESUME ──────────────────────────────────────────────
  // Los cuatro desenlaces del estado durable SÍ se explican, y por la misma razón que
  // `phone_already_present`: en los cuatro el operador está mirando el sitio donde antes había un
  // botón. Callar aquí es exactamente el defecto —la ficha volvía a ofrecer «Revelar teléfono»
  // sobre una solicitud que seguía viva, o se quedaba muda sobre una que ya había cerrado—.
  if (status === 'reveal_in_flight') return OFFICIAL_REVEAL_IN_FLIGHT_COPY;
  if (status === 'reveal_terminal_no_phone') return OFFICIAL_REVEAL_NO_PHONE_COPY;
  if (status === 'reveal_terminal_failed') return OFFICIAL_REVEAL_TERMINAL_FAILURE_COPY;
  if (status === 'reveal_already_completed') return OFFICIAL_REVEAL_ALREADY_COMPLETED_COPY;
  // `reveal_state_unreadable` NO se explica con un texto propio y, sobre todo, NO ofrece un botón:
  // es el caso fail-closed. Decirle al operador «no pudimos leer el estado» invita justo a la
  // acción que no queremos —volver a comprar—, y el bloque simplemente no se pinta.
  return null;
}

/**
 * PARIDAD DE RESCATE — ¿tiene sentido preguntarle al servidor qué salidas quedan?
 *
 * Sólo cuando el estado IMPLICA que hay un candidato fuente vinculado. Los tres estados de abajo
 * se resuelven sin candidato —no hay vínculo, no hay contacto legible, está archivado— y sobre
 * ellos ninguna de las tres tuberías podría hacer nada: preguntarlo sería una llamada al servidor
 * por cada contacto del sistema para recibir siempre la misma respuesta vacía.
 *
 * Se expresa como una lista NEGATIVA corta y explícita: un estado nuevo hereda «sí, pregunta»,
 * que es el lado seguro —una llamada de lectura de más, nunca una salida escondida—.
 */
export function officialContactMayHaveRescueOptions(
  status: OfficialContactPhoneRevealOfferStatus,
): boolean {
  return (
    status !== 'missing_source_candidate' &&
    status !== 'contact_unavailable' &&
    status !== 'contact_archived'
  );
}

/** Aviso mientras el reveal asíncrono está en vuelo. No promete un teléfono. */
export const OFFICIAL_REVEAL_IN_FLIGHT_COPY =
  'Solicitud enviada. El número aparecerá aquí en cuanto el proveedor responda.';

/** El teléfono llegó y ya está en la ficha. */
export const OFFICIAL_REVEAL_PROJECTED_COPY = 'Teléfono guardado en el contacto.';

/** El proveedor cerró sin número. Es un resultado, no un error. */
export const OFFICIAL_REVEAL_NO_PHONE_COPY =
  'Los proveedores no devolvieron un teléfono para este contacto.';

/**
 * DURABLE RESUME — el reveal cerró en FALLO. Honesto y sin culpar al operador: no promete un
 * reintento desde aquí (no lo hay en este corte) y no cita el mensaje del proveedor, que puede
 * contener el número.
 */
export const OFFICIAL_REVEAL_TERMINAL_FAILURE_COPY =
  'La búsqueda de teléfono terminó con un error. Revisa el candidato para reintentarla.';

/**
 * DURABLE RESUME — el reveal ya se completó, pero no queda ningún número vivo que copiar (se
 * suprimió después). Comprar otra vez no traería nada: el pipeline respondería `already_revealed`.
 */
export const OFFICIAL_REVEAL_ALREADY_COMPLETED_COPY =
  'El revelado de este contacto ya se completó y no hay un número disponible para copiar.';

/**
 * DURABLE RESUME (§7) — el refresco acotado del navegador AGOTÓ su presupuesto y el servidor sigue
 * diciendo que la solicitud está viva.
 *
 * Es deliberadamente distinto de `OFFICIAL_REVEAL_IN_FLIGHT_COPY`: aquí SellUp ya no está
 * mirando, y decir «el número aparecerá aquí» sería prometer una vigilancia que no existe. Lo que
 * sí es cierto —y es lo único que este corte añade de verdad— es que el estado vive en el
 * servidor, así que cerrar la ficha no pierde nada.
 *
 * Lo que NUNCA hace es volver a «Revelar teléfono»: un presupuesto de sondeo agotado es un límite
 * del navegador, no una prueba de que no haya nada en vuelo.
 */
export const OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY =
  'Solicitud en proceso. Puedes cerrar esta ficha; el estado se retomará cuando vuelvas.';

/** Fallo genérico. Nunca cita el mensaje del driver ni un dato de la persona. */
export const OFFICIAL_REVEAL_ERROR_COPY = 'No fue posible revelar el teléfono.';

/**
 * Traduce el desenlace de un clic a UNA frase. Se apoya en `revealStatus` —los MISMOS estados que
 * el pipeline del candidato ya emite— para no inventar una segunda taxonomía de resultados.
 */
export function officialRevealOutcomeText(outcome: {
  readonly ok: boolean;
  readonly gate: string;
  readonly revealStatus: string | null;
  readonly phoneProjected: boolean;
}): string {
  if (outcome.phoneProjected) return OFFICIAL_REVEAL_PROJECTED_COPY;
  if (!outcome.ok) {
    if (outcome.revealStatus === 'no_phone_found') return OFFICIAL_REVEAL_NO_PHONE_COPY;
    return OFFICIAL_REVEAL_ERROR_COPY;
  }
  if (outcome.revealStatus === 'requested') return OFFICIAL_REVEAL_IN_FLIGHT_COPY;
  // `ok` sin teléfono proyectado y sin estado en vuelo: la operación se aceptó pero el número aún
  // no está en la ficha. Se dice así, no «revelado».
  return OFFICIAL_REVEAL_IN_FLIGHT_COPY;
}
