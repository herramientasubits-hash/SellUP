// Copy de «Ver más números» (AGENT2A-PHONE-REVEAL-4O-G)
//
// Aislado del componente para poder afirmarlo en un test sin renderizar, igual
// que `lusha-phone-fallback-copy.ts` y `phone-reveal-waterfall-copy.ts`.
//
// ── LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO ────────────────────
//
// Ninguna cadena puede sugerir que al pulsar se BUSCA algo. «Buscar otros»,
// «Encontrar más», «Revelar más», «Enriquecer» — todas prometen una consulta a un
// proveedor, y una consulta a un proveedor cuesta créditos. Aquí no se consulta
// nada: se abre lo que ya está guardado. El verbo es VER, y un test estático
// verifica que los verbos de búsqueda no aparezcan en este archivo.
//
// Por la misma razón no hay copy de costo. Los números almacenados salieron de
// respuestas que se cobraron POR RESPUESTA, no por número: escribir «este número
// costó N créditos» inventaría un precio unitario que nadie cobró. La contabilidad
// real vive en la corrida y en el usage log, y ahí se queda.

/** CTA cuando hay exactamente un número adicional. */
export const STORED_PHONES_CTA_SINGULAR = 'Ver 1 número más';

/** CTA con la cantidad, a partir de dos. */
export function getStoredPhonesCtaLabel(additionalCount: number): string {
  return additionalCount === 1
    ? STORED_PHONES_CTA_SINGULAR
    : `Ver ${additionalCount} números más`;
}

/** Rótulo para cerrar el disclosure ya abierto. */
export const STORED_PHONES_COLLAPSE_LABEL = 'Ocultar números adicionales';

/**
 * Encabezado de la sección desplegada. Dice ADICIONALES porque el principal ya
 * está arriba y no se repite aquí.
 */
export function getStoredPhonesHeading(additionalCount: number): string {
  return additionalCount === 1
    ? '1 número adicional almacenado'
    : `${additionalCount} números adicionales almacenados`;
}

/**
 * La colección cambió entre el render y el clic — típicamente una DSAR que
 * tombstoneó el número. No es un error: es el estado correcto.
 */
export const STORED_PHONES_EMPTY_COPY = 'No hay otros números disponibles.';

/**
 * La lectura falló. Se dice que falló la LECTURA y no se ofrece ninguna
 * alternativa que gaste: un fallo al leer nunca es motivo para llamar a un
 * proveedor.
 */
export const STORED_PHONES_ERROR_COPY = 'No pudimos cargar los números adicionales.';

/** Mientras la lectura está en curso. */
export const STORED_PHONES_LOADING_COPY = 'Cargando números adicionales…';

/** Prefijo de la línea de procedencia de un número. */
export const STORED_PHONES_SOURCES_LABEL = 'Fuentes';

/** Separador cuando un mismo número fue observado por más de un proveedor. */
export const STORED_PHONES_SOURCE_SEPARATOR = ' · ';
