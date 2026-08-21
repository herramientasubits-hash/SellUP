// Copy de «Ver más números» del contacto OFICIAL (AGENT2A-PHONE-REVEAL-4O-H4)
//
// Aislado del componente para poder afirmarlo en un test sin renderizar, igual que
// el copy equivalente del candidato (4O-G) y que `lusha-phone-fallback-copy.ts`.
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
//
// ── POR QUÉ ES UN ARCHIVO PROPIO Y NO EL DEL CANDIDATO ─────────
//
// Las cadenas son deliberadamente IGUALES a las de 4O-G: es la misma acción sobre
// la misma clase de dato, y que el operador lea dos verbos distintos según la
// pantalla sería peor que cualquier duplicación.
//
// No se importan las del candidato porque 4O-G instaló una guarda explícita —una
// lista blanca de quién puede depender de sus módulos— cuyo valor entero está en
// que sea CERRADA. Ensancharla desde aquí para ahorrar seis constantes debilitaría
// un control por comodidad, y además ese archivo de guarda está siendo modificado
// por otro hito en vuelo (H3-B): tocarlo crearía un conflicto real por una ganancia
// cosmética.
//
// Lo que SÍ se comparte es lo que de verdad puede divergir con consecuencias: el
// mapa de procedencia (`stored-phone-provenance-mapping.ts`) y la tabla de
// etiquetas (`phone-display-labels.ts`), ambos módulos neutrales que las dos
// superficies importan.

/** CTA cuando hay exactamente un número adicional. */
export const OFFICIAL_STORED_PHONES_CTA_SINGULAR = 'Ver 1 número más';

/** CTA con la cantidad, a partir de dos. */
export function getOfficialStoredPhonesCtaLabel(additionalCount: number): string {
  return additionalCount === 1
    ? OFFICIAL_STORED_PHONES_CTA_SINGULAR
    : `Ver ${additionalCount} números más`;
}

/** Rótulo para cerrar el disclosure ya abierto. */
export const OFFICIAL_STORED_PHONES_COLLAPSE_LABEL = 'Ocultar números adicionales';

/**
 * Encabezado de la sección desplegada. Dice ADICIONALES porque los escalares ya
 * están arriba y no se repiten aquí.
 */
export function getOfficialStoredPhonesHeading(additionalCount: number): string {
  return additionalCount === 1
    ? '1 número adicional almacenado'
    : `${additionalCount} números adicionales almacenados`;
}

/**
 * La colección cambió entre el render y el clic — típicamente una DSAR que
 * tombstoneó el número, o una retirada por proveedor que dejó de justificarlo. No
 * es un error: es el estado correcto.
 */
export const OFFICIAL_STORED_PHONES_EMPTY_COPY = 'No hay otros números disponibles.';

/**
 * La lectura falló. Se dice que falló la LECTURA y no se ofrece ninguna alternativa
 * que gaste: un fallo al leer nunca es motivo para llamar a un proveedor.
 */
export const OFFICIAL_STORED_PHONES_ERROR_COPY =
  'No pudimos cargar los números adicionales.';

/** Mientras la lectura está en curso. */
export const OFFICIAL_STORED_PHONES_LOADING_COPY = 'Cargando números adicionales…';

/** Prefijo de la línea de procedencia de un número. */
export const OFFICIAL_STORED_PHONES_SOURCES_LABEL = 'Fuentes';

/** Separador cuando un mismo número fue observado por más de un proveedor. */
export const OFFICIAL_STORED_PHONES_SOURCE_SEPARATOR = ' · ';
