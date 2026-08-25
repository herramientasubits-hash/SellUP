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
  return null;
}

/** Aviso mientras el reveal asíncrono está en vuelo. No promete un teléfono. */
export const OFFICIAL_REVEAL_IN_FLIGHT_COPY =
  'Solicitud enviada. El número aparecerá aquí en cuanto el proveedor responda.';

/** El teléfono llegó y ya está en la ficha. */
export const OFFICIAL_REVEAL_PROJECTED_COPY = 'Teléfono guardado en el contacto.';

/** El proveedor cerró sin número. Es un resultado, no un error. */
export const OFFICIAL_REVEAL_NO_PHONE_COPY =
  'Los proveedores no devolvieron un teléfono para este contacto.';

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
