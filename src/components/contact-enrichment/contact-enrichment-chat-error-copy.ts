/**
 * Copy de fallo INESPERADO del wizard de enriquecimiento
 * (AGENT2A-PROD-INCIDENT — contact search).
 *
 * Incidente de Producción: al buscar una empresa, el drawer «Enriquecer
 * contactos» se quedaba indefinidamente en «Buscando en SellUp y HubSpot…».
 *
 * Los server actions de este flujo devuelven `{ success: false, error }` cuando
 * fallan por dentro, y el reducer ya sabe salir del estado de carga con ese
 * resultado. Lo que NO estaba cubierto es que la llamada misma se rompa —
 * la invocación muere, la red se cae, la plataforma corta la función que se
 * quedó esperando a HubSpot: entonces la promesa RECHAZA, no devuelve, y el
 * `await` sin `catch` dejaba el paso de carga puesto para siempre.
 *
 * Estos textos son el mensaje que se le muestra a la operadora en ese caso. Son
 * deliberadamente genéricos y accionables: no llevan stack, ni SQL, ni respuesta
 * del proveedor, ni identificadores internos, ni datos personales.
 */

/** Fallo inesperado resolviendo la empresa (paso `resolving`). */
export const CONTACT_ENRICHMENT_COMPANY_SEARCH_UNEXPECTED_ERROR_COPY =
  'No fue posible buscar la empresa. Intenta nuevamente.';

/** Fallo inesperado creando la request de enriquecimiento (paso `creating_run`). */
export const CONTACT_ENRICHMENT_REQUEST_UNEXPECTED_ERROR_COPY =
  'No fue posible crear la solicitud de enriquecimiento. Intenta nuevamente.';

/** Fallo inesperado lanzando la búsqueda de contactos (paso `searching_contacts`). */
export const CONTACT_ENRICHMENT_SEARCH_CONTACTS_UNEXPECTED_ERROR_COPY =
  'No fue posible iniciar la búsqueda de contactos. Intenta nuevamente.';
