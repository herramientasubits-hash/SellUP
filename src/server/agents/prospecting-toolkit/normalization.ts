/**
 * Prospecting Toolkit — Normalización determinística.
 *
 * Funciones puras, sin dependencias externas, sin efectos secundarios.
 * Usadas para comparar empresa candidata contra SellUp y HubSpot.
 */

import type { DuplicateCheckInput } from './types';
import { isSharedPlatformHost } from './shared-hosts';

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
// normalizeStoredCompanyName / buildNormalizedNameLookupVariants
// ============================================================

/**
 * AGENT1-NORMALIZED-NAME-LOOKUP-1 — la normalización con la que SE GUARDA
 * `normalized_name` (writer de Agente 1 `normalizeName`, importación y cuentas
 * `normalizeText`): minúsculas, sin tildes, puntuación a espacio, espacios
 * compactados — y SIN quitar el sufijo legal.
 *
 * 🔴 Debe seguir siendo idéntica a `normalizeName` de
 * `candidate-writer-pure-gates.ts`; la prueba `normalized-name-lookup` lo fija.
 *
 * @example normalizeStoredCompanyName('Acme S.A.S.') → 'acme s a s'
 */
export function normalizeStoredCompanyName(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Las formas en que `normalized_name` puede estar guardado para este nombre.
 *
 * Antes las búsquedas por nombre comparaban `normalizeCompanyName` («acme», sin
 * sufijo) contra la columna guardada con `normalizeName` («acme s a s»): una
 * empresa con sufijo legal NUNCA coincidía consigo misma. Se buscan las dos
 * formas; la columna no se reescribe.
 */
export function buildNormalizedNameLookupVariants(name: string | null | undefined): string[] {
  if (typeof name !== 'string') return [];
  const variants = [normalizeCompanyName(name), normalizeStoredCompanyName(name)];
  return [...new Set(variants.filter((value) => value.length > 0))];
}

/**
 * AGENT1-ILIKE-ESCAPE-1 — escapa los comodines de `ilike` (`%`, `_` y la barra de
 * escape) para que un nombre como «100% Natural» o «Acme_Co» se busque LITERAL y
 * no como patrón que coincide con cualquier cosa.
 */
export function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
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
/**
 * Quita el prefijo web del host: `www.`, `www2.`, `ww2.`, `ww3.`…
 *
 * AGENT1-WEB-HOST-PREFIX-1 — Prod 06-10 (CL×Salud, e4fec102): Mutual de
 * Seguridad entró como «Ww2.mutual» con dominio `ww2.mutual.cl` porque sólo se
 * quitaba `www.`. Si lo que queda no tiene punto, se deja el host como venía.
 */
export function stripWebHostPrefix(hostname: string): string {
  const stripped = hostname.replace(/^(?:www\d*|ww\d+)\./i, '');
  return stripped.includes('.') ? stripped : hostname;
}

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

  // Strip www., www2., ww2.…
  hostname = stripWebHostPrefix(hostname);

  // Must have at least one dot and be longer than 3 chars
  if (!hostname.includes('.') || hostname.length < 4) return null;

  // Reject localhost and bare IPs
  if (hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;

  return hostname;
}

// ============================================================
// normalizeIdentityDomain
// ============================================================

/**
 * AGENT1-SHARED-HOSTS-1 — el dominio como señal de IDENTIDAD de empresa.
 *
 * Igual que `normalizeDomain` (que sigue intacto para sus otros usos: enviar el
 * dominio a un proveedor, mostrarlo, etc.), más dos reglas:
 *   · un host COMPARTIDO (`sites.google.com`, `facebook.com`, `linktr.ee`,
 *     `gmail.com`… ver `shared-hosts.ts`) NO identifica a ninguna empresa y
 *     devuelve `null`. Antes dos empresas con su página en Google Sites salían
 *     con el MISMO dominio y la segunda quedaba «duplicada» de la primera;
 *   · el punto final del FQDN (`acme.com.`) no parte la identidad.
 *
 * `null` siempre significa «no hay dominio de identidad», nunca «no coincide».
 *
 * @example
 * normalizeIdentityDomain('https://www.siigo.com/co')        → 'siigo.com'
 * normalizeIdentityDomain('https://sites.google.com/view/x') → null
 * normalizeIdentityDomain('acme.com.')                       → 'acme.com'
 */
export function normalizeIdentityDomain(urlOrDomain: string | null | undefined): string | null {
  if (typeof urlOrDomain !== 'string') return null;
  const domain = normalizeDomain(urlOrDomain);
  if (!domain) return null;
  const withoutTrailingDot = domain.replace(/\.+$/, '');
  if (!withoutTrailingDot.includes('.') || withoutTrailingDot.length < 4) return null;
  if (isSharedPlatformHost(withoutTrailingDot)) return null;
  return withoutTrailingDot;
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
 * Normaliza un identificador fiscal a su forma de derivación histórica:
 * - Minúsculas
 * - Sin guiones, puntos, espacios, guiones bajos
 *
 * ⚠️ AGENT1-CUT3B1-FISCAL-IDENTITY-TRUTH — NO es autoritativo para decidir
 * IGUALDAD fiscal. La autoridad canónica de Agente 1 es
 * `canonicalizeFiscalIdentifier` en `./fiscal-identity`, que además recorta la
 * etiqueta del identificador y aplica la semántica canónica por país, y exige
 * ámbito de país para cualquier igualdad automática.
 *
 * Esta función sigue existiendo porque es la derivación con la que ya se
 * escribió la columna persistida `prospect_candidates.identity_key`. Unificar esa
 * derivación pertenece al corte del registro (CUT-3B2), que es quien puede
 * decidir versionado/backfill; cambiarla aquí reescribiría en silencio la
 * semántica de una columna ya escrita.
 *
 * @example
 * normalizeTaxIdentifier("900.123.456-1") → "9001234561"
 * normalizeTaxIdentifier("RFC ABC-123456-AB1") → "rfcabc123456ab1"
 */
export function normalizeTaxIdentifier(value: string): string {
  return value.toLowerCase().replace(/[\s.\-_]/g, '').trim();
}

// ============================================================
// normalizeLinkedinUrl
// ============================================================

/**
 * Normaliza una URL de LinkedIn de empresa para comparación:
 * - Extrae el slug de /company/<slug>
 * - Descarta perfiles personales (/in/)
 * - Retorna null si no es una URL válida de empresa LinkedIn
 *
 * @example
 * normalizeLinkedinUrl("https://www.linkedin.com/company/siigo/") → "linkedin.com/company/siigo"
 * normalizeLinkedinUrl("https://www.linkedin.com/in/persona") → null
 * normalizeLinkedinUrl("linkedin.com/company/rappi?trk=...") → "linkedin.com/company/rappi"
 */
export function normalizeLinkedinUrl(url: string | null | undefined): string | null {
  if (!url || url.trim().length === 0) return null;

  const input = url.trim().toLowerCase();

  if (!input.includes('linkedin.com')) return null;
  if (input.includes('/in/')) return null; // reject personal profiles

  try {
    const withProtocol = input.startsWith('http') ? input : `https://${input}`;
    const u = new URL(withProtocol);
    const match = u.pathname.match(/\/company\/([^/?#]+)/);
    if (!match) return null;
    return `linkedin.com/company/${match[1].replace(/\/$/, '')}`;
  } catch {
    const match = input.match(/linkedin\.com\/company\/([^/?#\s]+)/);
    if (!match) return null;
    return `linkedin.com/company/${match[1].replace(/\/$/, '')}`;
  }
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

  // Prefer explicit domain; fall back to extracting from website.
  // AGENT1-SHARED-HOSTS-1 — con la normalización de IDENTIDAD: buscar en SellUp o
  // HubSpot por `facebook.com` o `sites.google.com` encontraba a OTRA empresa con la
  // misma plataforma y la daba por «ya existe» (y un dominio así tampoco sirve para
  // decir que es nueva).
  const domain =
    normalizeIdentityDomain(input.domain ?? '') ??
    normalizeIdentityDomain(input.website);

  const normalizedTaxId = input.taxIdentifier
    ? normalizeTaxIdentifier(input.taxIdentifier)
    : null;

  const countryCode = input.countryCode
    ? input.countryCode.toUpperCase().trim()
    : null;

  return { normalizedName, normalizedLegalName, domain, normalizedTaxId, countryCode };
}
