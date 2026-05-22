/**
 * Prospecting Toolkit — Punto de entrada público.
 *
 * Exporta solo la API pública del toolkit.
 * Los helpers internos de normalización y los checkers individuales
 * quedan encapsulados; importar desde aquí es el contrato estable.
 */

// Tipos públicos
export type {
  DuplicateStatus,
  DuplicateCheckInput,
  DuplicateMatch,
  DuplicateCheckResult,
} from './types';

// Normalización — útil para quienes necesiten pre-normalizar antes de llamar al orquestador
export {
  normalizeCompanyName,
  normalizeDomain,
  extractDomainFromWebsite,
  normalizeTaxIdentifier,
  buildCompanySearchTerms,
} from './normalization';

// Orquestador principal
export { checkCompanyDuplicate } from './duplicate-checker';

// Checkers individuales (acceso directo cuando se necesita solo uno)
export { checkSellUpDuplicates } from './sellup-duplicate-checker';
export { checkHubSpotDuplicates } from './hubspot-duplicate-checker';

// Catalog Context Retriever — Hito 2
export type {
  SearchDepth,
  SourcePriority,
  CatalogSource,
  CatalogContextInput,
  CatalogContextResult,
} from './types';
export { getCatalogContext } from './catalog-context-retriever';

// Web Search Tool — Hito 3A
export type {
  WebSearchProviderKey,
  WebSearchIntent,
  WebSearchInput,
  WebSearchResult,
  WebSearchOutput,
} from './types';
export { runWebSearch, buildCompanyDiscoveryQuery } from './web-search-tool';
export type { CompanyDiscoveryQueryOptions } from './web-search-tool';
