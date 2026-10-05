/**
 * Petición HTTP de la búsqueda de empresas en HubSpot, con techo de espera.
 * (AGENT2A-PROD-INCIDENT · incidente B, contact search)
 *
 * Vive en su propio módulo por dos razones:
 *
 *  1. Es el único punto del flujo de resolución de empresa que sale a la red, y
 *     era el único `fetch` SIN techo de espera. Cuando HubSpot no responde, el
 *     server action no vuelve nunca: la plataforma acaba matando la invocación y
 *     el cliente se queda con «Buscando en SellUp y HubSpot…» puesto para
 *     siempre. Ese fue el incidente.
 *
 *  2. Aislado, el techo se puede probar sin Supabase, sin token y sin red — el
 *     módulo que lo usaba antes exige credenciales para llegar hasta aquí, así
 *     que la garantía no era verificable donde estaba.
 *
 * Solo lectura: nunca escribe en HubSpot.
 */

/**
 * Techo de espera de UNA búsqueda de empresas en HubSpot.
 *
 * Generoso para una búsqueda normal y muy por debajo del límite de la función,
 * de modo que un HubSpot lento se convierta en «HubSpot no disponible» —el caso
 * que los llamadores YA saben tratar— en vez de en una invocación cortada.
 */
export const HUBSPOT_COMPANY_SEARCH_TIMEOUT_MS = 10_000;

/** Endpoint de búsqueda de empresas (solo lectura). */
export const HUBSPOT_COMPANY_SEARCH_URL =
  'https://api.hubapi.com/crm/v3/objects/companies/search';

/**
 * POST a la búsqueda de empresas de HubSpot, acotado en el tiempo.
 *
 * Al vencer el techo, `AbortSignal.timeout` aborta la petición y `fetch` RECHAZA
 * con `TimeoutError`. El rechazo es deliberado: es lo que distingue «HubSpot no
 * contestó» de «HubSpot contestó que no hay coincidencias», y los dos llamadores
 * lo convierten en un resultado tipado.
 */
export async function postHubSpotCompanySearch(
  token: string,
  body: unknown,
  timeoutMs: number = HUBSPOT_COMPANY_SEARCH_TIMEOUT_MS,
): Promise<Response> {
  return await fetch(HUBSPOT_COMPANY_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * AGENT2A-HUBSPOT-ID-RESOLUTION — lectura directa de UNA empresa de HubSpot por su
 * Company ID, con el mismo techo de espera que la búsqueda.
 *
 * Cuando la operadora pega el Company ID (p. ej. `52817179673`), buscar por nombre o
 * dominio no tiene sentido: el ID ya identifica la empresa. Esta lectura trae nombre,
 * dominio y país para que el enriquecimiento arranque con datos reales en lugar de
 * usar el número como nombre de empresa.
 *
 * Solo lectura: nunca escribe en HubSpot. Igual que la búsqueda, un techo vencido
 * RECHAZA con `TimeoutError` y el llamador lo trata como «HubSpot no disponible».
 */
export function buildHubSpotCompanyByIdUrl(companyId: string, properties: string[]): string {
  const params = new URLSearchParams({ properties: properties.join(',') });
  return `https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(companyId)}?${params.toString()}`;
}

export async function getHubSpotCompanyById(
  token: string,
  companyId: string,
  properties: string[],
  timeoutMs: number = HUBSPOT_COMPANY_SEARCH_TIMEOUT_MS,
): Promise<Response> {
  return await fetch(buildHubSpotCompanyByIdUrl(companyId, properties), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
