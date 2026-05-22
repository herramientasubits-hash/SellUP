/**
 * Prospecting Toolkit — Normalización determinística.
 *
 * Funciones puras, sin dependencias externas, sin efectos secundarios.
 * Usadas para comparar empresa candidata contra SellUp y HubSpot.
 */

import type { DuplicateCheckInput } from './types';

// ============================================================
// Sufijos legales a remover (LatAm + globales comunes)
// ============================================================

// Aplicado al final del nombre, después de convertir a minúsculas y normalizar puntuación.
// El orden importa: los más específicos primero para evitar coincidencias parciales.
const LEGAL_SUFFIX_RE =
  /[\s,]+(?:s\.?\s*a\.?\s*s\.?|s\.?\s*r\.?\s*l\.?|s\.?\s*a\.?\s*de\s+c\.?\s*v\.?|s\.?\s*a\.?|sas|srl|spa|ltda\.?|s\.?\s*l\.?|inc\.?|llc|corp\.?|ag|sa|sl|de\s+c\.?\s*v\.?)[\s.,]*$/i;

// ============================================================
// normalizeCompanyName
// ============================================================

/**
 * Convierte un nombre de empresa a su forma canónica para comparación:
 * - Minúsculas
 * - Sin tildes ni diacríticos
 * - Sin sufijos legales (SAS, Ltda, Inc, etc.)
 * - Sin puntuación irrelevante
 * - Espacios compactados
 *
 * @example
 * normalizeCompanyName("Rappi Colombia S.A.S.") → "rappi colombia"
 * normalizeCompanyName("Siigo SAS") → "siigo"
 * normalizeCompanyName("Globant, Inc.") → "globant"
 */
export function normalizeCompanyName(name: string): string {
  if (!name || name.trim().length === 0) return '';

  let normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  // Strip legal suffix
  normalized = normalized.replace(LEGAL_SUFFIX_RE, '');

  // Strip remaining punctuation (keep letters, digits, spaces)
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');

  // Compact spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// ============================================================
// normalizeDomain
// ============================================================

/**
 * Extrae el dominio limpio desde una URL o dominio suelto:
 * - Sin protocolo
 * - Sin www.
 * - Sin path, query, fragmento
 * - Minúsculas
 * - Retorna null si no hay dominio útil
 *
 * @example
 * normalizeDomain("https://www.siigo.com/co") → "siigo.com"
 * normalizeDomain("www.rappi.com") → "rappi.com"
 * normalizeDomain("mail.google.com") → "mail.google.com"
 * normalizeDomain("") → null
 */
export function normalizeDomain(urlOrDomain: string): string | null {
  if (!urlOrDomain || urlOrDomain.trim().length === 0) return null;

  const input = urlOrDomain.trim().toLowerCase();

  // Strip leading @ (email addresses)
  const cleaned = input.startsWith('@') ? input.slice(1) : input;

  let hostname: string;
  try {
    const withProtocol =
      cleaned.startsWith('http://') || cleaned.startsWith('https://')
        ? cleaned
        : `https://${cleaned}`;
    hostname = new URL(withProtocol).hostname;
  } catch {
    return null;
  }

  // Strip www.
  hostname = hostname.replace(/^www\./, '');

  // Must have at least one dot and be longer than 3 chars
  if (!hostname.includes('.') || hostname.length < 4) return null;

  // Reject localhost and bare IPs
  if (hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;

  return hostname;
}

// ============================================================
// extractDomainFromWebsite
// ============================================================

/**
 * Alias semántico de normalizeDomain para cuando el input es claramente una URL.
 * Comportamiento idéntico.
 */
export function extractDomainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  return normalizeDomain(website);
}

// ============================================================
// normalizeTaxIdentifier
// ============================================================

/**
 * Normaliza un identificador fiscal para comparación:
 * - Minúsculas
 * - Sin guiones, puntos, espacios, guiones bajos
 *
 * @example
 * normalizeTaxIdentifier("900.123.456-1") → "9001234561"
 * normalizeTaxIdentifier("RFC ABC-123456-AB1") → "rfcabc123456ab1"
 */
export function normalizeTaxIdentifier(value: string): string {
  return value.toLowerCase().replace(/[\s.\-_]/g, '').trim();
}

// ============================================================
// buildCompanySearchTerms
// ============================================================

/**
 * Construye los términos de búsqueda normalizados a partir del input.
 * Centraliza la normalización para que todos los checkers usen los mismos valores.
 */
export function buildCompanySearchTerms(input: DuplicateCheckInput): {
  normalizedName: string;
  normalizedLegalName: string | null;
  domain: string | null;
  normalizedTaxId: string | null;
  countryCode: string | null;
} {
  const normalizedName = normalizeCompanyName(input.name ?? '');

  const normalizedLegalName = input.legalName
    ? normalizeCompanyName(input.legalName)
    : null;

  // Prefer explicit domain; fall back to extracting from website
  const domain =
    normalizeDomain(input.domain ?? '') ??
    extractDomainFromWebsite(input.website);

  const normalizedTaxId = input.taxIdentifier
    ? normalizeTaxIdentifier(input.taxIdentifier)
    : null;

  const countryCode = input.countryCode
    ? input.countryCode.toUpperCase().trim()
    : null;

  return { normalizedName, normalizedLegalName, domain, normalizedTaxId, countryCode };
}
