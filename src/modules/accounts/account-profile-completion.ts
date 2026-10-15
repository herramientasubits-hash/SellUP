// ACCOUNT-PROFILE-COMPLETION-1 — Completar país e industria de una empresa (núcleo puro)
//
// Las empresas que llegan de HubSpot (Agente 2, aprobaciones) a veces vienen sin país o sin
// industria porque la ficha de HubSpot ya estaba así. Aquí se decide, sin red ni Supabase,
// qué falta, qué se puede deducir gratis y qué se escribe de vuelta en HubSpot.
// Regla de oro: sólo se llena lo VACÍO, en SellUp y en HubSpot; nada se pisa.

export interface AccountForProfileCompletion {
  domain: string | null;
  country: string | null;
  country_code: string | null;
  industry: string | null;
}

export type MissingProfileField = 'country' | 'industry';

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

/** Qué le falta a la empresa. País incompleto = falta el nombre o el código. */
export function missingProfileFields(account: AccountForProfileCompletion): MissingProfileField[] {
  const missing: MissingProfileField[] = [];
  if (isBlank(account.country) || isBlank(account.country_code)) missing.push('country');
  if (isBlank(account.industry)) missing.push('industry');
  return missing;
}

/**
 * Dominios de país (ccTLD) con los que una empresa casi siempre opera en ese país. `.co` solo
 * NO entra: se usa como «.com» corto en todo el mundo; Colombia sólo se acepta con `.com.co`,
 * `.org.co`, `.net.co`, `.edu.co`, `.gov.co` y similares.
 */
const CCTLD_COUNTRY_CODES: Readonly<Record<string, string>> = {
  mx: 'MX', cl: 'CL', pe: 'PE', ec: 'EC', br: 'BR', pa: 'PA', cr: 'CR', ar: 'AR', ve: 'VE',
  bo: 'BO', uy: 'UY', py: 'PY', gt: 'GT', hn: 'HN', sv: 'SV', ni: 'NI', do: 'DO', es: 'ES', us: 'US',
};
const COLOMBIA_SECOND_LEVELS = new Set(['com', 'org', 'net', 'edu', 'gov', 'mil']);

/** País que dice el dominio, o `null` si es genérico o ambiguo. */
export function countryCodeFromDomain(domain: string | null | undefined): string | null {
  if (isBlank(domain)) return null;
  const labels = (domain as string)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('.');
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1];
  if (tld === 'co') {
    return labels.length >= 3 && COLOMBIA_SECOND_LEVELS.has(labels[labels.length - 2]) ? 'CO' : null;
  }
  return CCTLD_COUNTRY_CODES[tld] ?? null;
}

/**
 * «Bolivia (Estado Plurinacional de)» → «Bolivia»: HubSpot trae nombres oficiales largos que
 * el mapa de países no reconoce.
 */
export function cleanCountryLabel(value: string | null | undefined): string | null {
  if (isBlank(value)) return null;
  const cleaned = (value as string).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

export interface CountryCompletion {
  country: string;
  country_code: string;
  source: 'existing_country_name' | 'existing_country_code' | 'domain_tld';
}

/**
 * Deduce país y código con lo que ya hay: el nombre (→ código), el código (→ nombre) o, si no
 * hay nada, el dominio. `nameToCode` y `codeToName` se inyectan (los mapas viven en módulos de
 * servidor). `null` = no se puede deducir sin adivinar.
 */
export function planCountryCompletion(
  account: AccountForProfileCompletion,
  maps: {
    nameToCode: (name: string | null) => string | null;
    codeToName: (code: string | null) => string | null;
  },
): CountryCompletion | null {
  const label = cleanCountryLabel(account.country);
  const code = isBlank(account.country_code) ? null : (account.country_code as string).trim().toUpperCase();

  if (label && !code) {
    const resolved = maps.nameToCode(label);
    return resolved ? { country: label, country_code: resolved, source: 'existing_country_name' } : null;
  }
  if (code && !label) {
    const name = maps.codeToName(code);
    return name ? { country: name, country_code: code, source: 'existing_country_code' } : null;
  }
  if (!label && !code) {
    const fromDomain = countryCodeFromDomain(account.domain);
    const name = fromDomain ? maps.codeToName(fromDomain) : null;
    return fromDomain && name ? { country: name, country_code: fromDomain, source: 'domain_tld' } : null;
  }
  return null;
}

export interface HubSpotFillInput {
  /** Propiedades actuales de la empresa en HubSpot. */
  current: Partial<Record<'pais' | 'country' | 'industriaespecifica', string | null>>;
  /** Lo que SellUp acaba de completar. */
  country: string | null;
  industry: string | null;
}

/**
 * Propiedades a escribir en HubSpot: sólo las que están vacías allá. `pais` (propiedad de
 * UBITS) y `country` (estándar) reciben el mismo nombre; la industria va a la Macro industria
 * (`industriaespecifica`).
 */
export function buildHubSpotFillProperties(input: HubSpotFillInput): Record<string, string> {
  const properties: Record<string, string> = {};
  if (input.country) {
    if (isBlank(input.current.pais)) properties.pais = input.country;
    if (isBlank(input.current.country)) properties.country = input.country;
  }
  if (input.industry && isBlank(input.current.industriaespecifica)) {
    properties.industriaespecifica = input.industry;
  }
  return properties;
}
