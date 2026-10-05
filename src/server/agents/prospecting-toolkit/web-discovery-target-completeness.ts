/**
 * Agente 1 · Tavily — qué campos de empresa trae una fila de búsqueda web (puro).
 *
 * Prod 30-09 (lotes ff1ba9f2, 1e9fd646, 26f57743): las filas de Tavily no traían
 * `providerCompanyFields` (eso sólo lo arma Apollo), así que el writer no escribía
 * `target_completeness`. Sin ese bloque el rescate de Claude no veía a ninguna
 * (lee `failed_conditions`) y ninguna podía contar para la meta.
 *
 * Tavily no devuelve tamaño ni LinkedIn: el tamaño sólo puede venir del gate ICP
 * (`icpSizeConfirmedAboveThreshold`, la segunda vía del contrato) o de Claude, y
 * el LinkedIn sólo del enriquecimiento del writer, y sólo cuando quedó verificado.
 * `not_returned` —no `mapping_failed`— porque no es una pérdida interna: el
 * proveedor no tiene el dato.
 */

import type { CompanyFieldMappingStatus } from './apollo-company-fields-mapping';

export const TAVILY_WEB_DISCOVERY_PROVIDER = 'tavily';
/**
 * AGENT1-CLAUDE-COMPANY-SEARCH-AUTO-1 — Claude con búsqueda web es el mismo caso que
 * Tavily: no trae tamaño confirmado ni LinkedIn verificado. Sin esto, sus filas no
 * llevaban `target_completeness` y el lote entero quedaba «no medido» (Prod 05-10,
 * CL×Salud d92a12ec: Grifols Chile, Axon Pharma).
 */
export const CLAUDE_WEB_DISCOVERY_PROVIDER = 'claude';
const WEB_DISCOVERY_PROVIDERS: ReadonlySet<string> = new Set([
  TAVILY_WEB_DISCOVERY_PROVIDER,
  CLAUDE_WEB_DISCOVERY_PROVIDER,
]);

export type WebDiscoveryCompanyFieldStatuses = {
  employeeCountStatus: CompanyFieldMappingStatus;
  linkedinStatus: CompanyFieldMappingStatus;
};

/**
 * `null` = no es una corrida de búsqueda web (Tavily o Claude): el writer sigue como antes (Apollo con sus
 * campos, el resto sin bloque de completitud).
 */
export function resolveWebDiscoveryCompanyFieldStatuses(input: {
  provider: string | null | undefined;
  writerLinkedinVerified: boolean;
}): WebDiscoveryCompanyFieldStatuses | null {
  if (!input.provider || !WEB_DISCOVERY_PROVIDERS.has(input.provider)) return null;
  return {
    employeeCountStatus: 'not_returned',
    linkedinStatus: input.writerLinkedinVerified ? 'confirmed' : 'not_returned',
  };
}
