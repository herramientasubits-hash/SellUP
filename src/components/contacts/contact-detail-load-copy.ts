/**
 * Copy de los estados de NO-DATO del drawer de detalle del CONTACTO oficial
 * (AGENT2A-P0-R2 — cross-flow runtime incident).
 *
 * Incidente observado en QA (2026-08-13): al abrir un contacto, el drawer se
 * quedaba en «Cargando contacto...» con el spinner girando para siempre.
 *
 * El defecto NO era la lectura: era que el drawer sólo sabía representar UN
 * estado —«todavía no hay contacto»— y lo pintaba igual para tres hechos
 * distintos:
 *
 *   1. la lectura sigue en curso            → spinner (correcto)
 *   2. el contacto no existe / no es visible → spinner (MENTIRA, es terminal)
 *   3. la lectura FALLÓ                      → spinner (MENTIRA, es terminal)
 *
 * `loadData` no tenía `catch`, y su render era `loading || !contact ? spinner`.
 * Como el `finally` sí bajaba `loading`, un fallo dejaba `contact` en `null` para
 * siempre: la condición `!contact` volvía a poner el spinner y ya no había nada
 * que lo quitara. Cualquier fallo del servidor —y también un contacto
 * simplemente no encontrado— terminaba en spinner permanente, sin mensaje, sin
 * reintento y sin rastro.
 *
 * Este es el mismo contrato que 4O-H3-B-R1 le dio al drawer de CANDIDATO. Se
 * replica aquí a propósito: las dos superficies de detalle deben distinguir «no
 * está» de «falló», y ninguna de las dos puede quedarse cargando para siempre.
 *
 * Ningún texto expone stack, SQL, respuesta de proveedor, identificadores
 * internos ni datos personales.
 */

/** Título del drawer mientras la lectura sigue en curso. */
export const CONTACT_DETAIL_LOADING_TITLE_COPY = 'Cargando contacto...';

/** Título del drawer cuando el contacto no existe o no es visible para el actor. */
export const CONTACT_DETAIL_NOT_FOUND_TITLE_COPY = 'Contacto no disponible';

/**
 * Cuerpo del caso ESPERADO: la lectura funcionó y no devolvió fila. El contacto
 * fue archivado o eliminado, o está fuera del alcance del actor. No es un error:
 * no invita a reintentar, explica.
 */
export const CONTACT_DETAIL_NOT_FOUND_BODY_COPY =
  'Este contacto ya no está disponible. Puede que lo hayan archivado o eliminado.';

/** Título del drawer cuando la lectura del detalle falló. */
export const CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY = 'No se pudo cargar el contacto';

/**
 * Cuerpo del caso de FALLO: la lectura no se pudo completar. Accionable, porque
 * reintentar es lo que corresponde, y honesto: no afirma que el contacto no
 * exista, que es justo lo que insinuaba el spinner eterno.
 */
export const CONTACT_DETAIL_LOAD_ERROR_BODY_COPY =
  'No fue posible cargar el detalle del contacto. Intenta nuevamente.';

/** Etiqueta del botón de reintento del estado de fallo. */
export const CONTACT_DETAIL_RETRY_COPY = 'Reintentar';

/**
 * Resultado de cargar el detalle. `null` ⇒ hay contacto (o sigue cargando).
 * Cerrado a estos dos casos: son los únicos que el cargador puede distinguir hoy
 * sin inventar taxonomía que el servidor no da.
 */
export type ContactDetailLoadOutcome = 'not_found' | 'load_error';
