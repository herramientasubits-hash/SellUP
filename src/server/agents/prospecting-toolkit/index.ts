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
