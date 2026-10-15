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

export type CountrySignalSource = 'domain_tld' | 'hubspot_phone' | 'hubspot_description' | 'hubspot_contacts';

export interface CountryCompletion {
  country: string;
  country_code: string;
  source: 'existing_country_name' | 'existing_country_code' | CountrySignalSource;
}

/** Pistas de país que salen de la ficha de HubSpot (ya traducidas a código). */
export interface CountryHints {
  phone?: string | null;
  description?: string | null;
  contacts?: string | null;
}

/**
 * Deduce país y código con lo que ya hay: el nombre (→ código), el código (→ nombre) o, si no
 * hay nada, las pistas: dominio de país, prefijo del teléfono, descripción de HubSpot y país
 * de los contactos. Si dos pistas se contradicen, NO se adivina: `null`.
 * `nameToCode` y `codeToName` se inyectan (los mapas viven en módulos de servidor).
 */
export function planCountryCompletion(
  account: AccountForProfileCompletion,
  maps: {
    nameToCode: (name: string | null) => string | null;
    codeToName: (code: string | null) => string | null;
  },
  hints: CountryHints = {},
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
  if (label || code) return null;

  const signals: Array<{ code: string; source: CountrySignalSource }> = [];
  const tld = countryCodeFromDomain(account.domain);
  if (tld) signals.push({ code: tld, source: 'domain_tld' });
  if (hints.phone) signals.push({ code: hints.phone, source: 'hubspot_phone' });
  if (hints.description) signals.push({ code: hints.description, source: 'hubspot_description' });
  if (hints.contacts) signals.push({ code: hints.contacts, source: 'hubspot_contacts' });
  if (signals.length === 0 || new Set(signals.map((x) => x.code)).size !== 1) return null;

  const name = maps.codeToName(signals[0].code);
  return name ? { country: name, country_code: signals[0].code, source: signals[0].source } : null;
}

// ── Pistas de HubSpot ────────────────────────────────────────

/** Prefijos telefónicos de los países que cubre SellUp. +1 no entra: es US, Canadá y el Caribe. */
const CALLING_CODES: ReadonlyArray<readonly [string, string]> = [
  ['52', 'MX'], ['57', 'CO'], ['56', 'CL'], ['51', 'PE'], ['593', 'EC'], ['55', 'BR'], ['507', 'PA'],
  ['506', 'CR'], ['54', 'AR'], ['58', 'VE'], ['591', 'BO'], ['598', 'UY'], ['595', 'PY'], ['502', 'GT'],
  ['504', 'HN'], ['503', 'SV'], ['505', 'NI'], ['34', 'ES'],
];

/** País del prefijo internacional de un teléfono («+52 998…» → MX). Sin «+» o «00» no se asume nada. */
export function countryCodeFromPhone(phone: string | null | undefined): string | null {
  if (isBlank(phone)) return null;
  const compact = (phone as string).replace(/[\s().-]/g, '');
  const digits = compact.startsWith('+') ? compact.slice(1) : compact.startsWith('00') ? compact.slice(2) : null;
  if (!digits || !/^\d+$/.test(digits)) return null;
  // El prefijo más largo gana (591 antes que 59…).
  const sorted = [...CALLING_CODES].sort((a, b) => b[0].length - a[0].length);
  return sorted.find(([prefix]) => digits.startsWith(prefix))?.[1] ?? null;
}

/** Nombres y gentilicios (español e inglés), sin tildes y en minúscula. */
const COUNTRY_WORDS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['MX', ['mexico', 'mexican', 'mexicana', 'mexicano']],
  ['CO', ['colombia', 'colombian', 'colombiana', 'colombiano']],
  ['CL', ['chile', 'chilean', 'chilena', 'chileno']],
  ['PE', ['peru', 'peruvian', 'peruana', 'peruano']],
  ['EC', ['ecuador', 'ecuadorian', 'ecuatoriana', 'ecuatoriano']],
  ['BR', ['brasil', 'brazil', 'brazilian', 'brasilena', 'brasileno']],
  ['PA', ['panama', 'panamanian', 'panamena', 'panameno']],
  ['CR', ['costa rica', 'costa rican', 'costarricense']],
  ['AR', ['argentina', 'argentine', 'argentinian', 'argentino']],
  ['VE', ['venezuela', 'venezuelan', 'venezolana', 'venezolano']],
  ['BO', ['bolivia', 'bolivian', 'boliviana', 'boliviano']],
  ['UY', ['uruguay', 'uruguayan', 'uruguaya', 'uruguayo']],
  ['PY', ['paraguay', 'paraguayan', 'paraguaya', 'paraguayo']],
  ['GT', ['guatemala', 'guatemalan', 'guatemalteca', 'guatemalteco']],
  ['HN', ['honduras', 'honduran', 'hondurena', 'hondureno']],
  ['SV', ['el salvador', 'salvadoran', 'salvadorena', 'salvadoreno']],
  ['NI', ['nicaragua', 'nicaraguan', 'nicaraguense']],
  ['ES', ['espana', 'spain', 'spanish company', 'empresa espanola']],
  ['US', ['united states', 'estados unidos', 'american company', 'u.s.-based', 'us-based']],
];

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * País que nombra la descripción de la empresa («Peruvian pharmaceutical company» → PE).
 * Sólo se acepta si el texto nombra UN solo país: «presente en México y Chile» no dice dónde
 * está la empresa.
 */
export function countryCodeFromDescription(description: string | null | undefined): string | null {
  if (isBlank(description)) return null;
  const text = ` ${stripAccents(description as string).replace(/[^a-z0-9.\- ]/g, ' ')} `;
  const found = new Set<string>();
  for (const [code, words] of COUNTRY_WORDS) {
    if (words.some((word) => text.includes(` ${word} `) || text.includes(` ${word}.`))) found.add(code);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * País de los contactos asociados: sólo si hay al menos DOS con país conocido y todos
 * coinciden. Una empresa con oficinas en varios países tiene contactos en varios.
 */
export function consensusCountryFromContacts(
  contacts: ReadonlyArray<{ country: string | null; phone: string | null }>,
  nameToCode: (name: string | null) => string | null,
): string | null {
  const codes = contacts
    .map((c) => nameToCode(cleanCountryLabel(c.country)) ?? countryCodeFromPhone(c.phone))
    .filter((c): c is string => c !== null);
  return codes.length >= 2 && new Set(codes).size === 1 ? codes[0] : null;
}

/**
 * Industria estándar de HubSpot → macro de SellUp, sólo cuando la correspondencia es clara.
 * «ENTERTAINMENT», «CONSULTING» y similares no se traducen: dependen de la empresa.
 */
const HUBSPOT_INDUSTRY_TO_MACRO: Readonly<Record<string, string>> = {
  PHARMACEUTICALS: 'Salud & Farmacéuticos', HOSPITAL_HEALTH_CARE: 'Salud & Farmacéuticos',
  MEDICAL_PRACTICE: 'Salud & Farmacéuticos', MEDICAL_DEVICES: 'Salud & Farmacéuticos',
  BIOTECHNOLOGY: 'Salud & Farmacéuticos', HEALTH_WELLNESS_AND_FITNESS: 'Salud & Farmacéuticos',
  RETAIL: 'Retail', APPAREL_FASHION: 'Retail', SUPERMARKETS: 'Retail', CONSUMER_ELECTRONICS: 'Retail',
  BANKING: 'Seguros y Servicios Financieros', INSURANCE: 'Seguros y Servicios Financieros',
  FINANCIAL_SERVICES: 'Seguros y Servicios Financieros', CAPITAL_MARKETS: 'Seguros y Servicios Financieros',
  INVESTMENT_BANKING: 'Seguros y Servicios Financieros', INVESTMENT_MANAGEMENT: 'Seguros y Servicios Financieros',
  COMPUTER_SOFTWARE: 'Tecnología', INFORMATION_TECHNOLOGY_AND_SERVICES: 'Tecnología', INTERNET: 'Tecnología',
  COMPUTER_HARDWARE: 'Tecnología', COMPUTER_NETWORKING: 'Tecnología', COMPUTER_NETWORK_SECURITY: 'Tecnología',
  TELECOMMUNICATIONS: 'Tecnología', SEMICONDUCTORS: 'Tecnología',
  LOGISTICS_AND_SUPPLY_CHAIN: 'Transporte & Logística', TRANSPORTATION_TRUCKING_RAILROAD: 'Transporte & Logística',
  AIRLINES_AVIATION: 'Transporte & Logística', MARITIME: 'Transporte & Logística',
  REAL_ESTATE: 'Propiedad & Construcción', CONSTRUCTION: 'Propiedad & Construcción',
  CIVIL_ENGINEERING: 'Propiedad & Construcción', BUILDING_MATERIALS: 'Propiedad & Construcción',
  AUTOMOTIVE: 'Industria / Manufactura / Químicos / Automotor', CHEMICALS: 'Industria / Manufactura / Químicos / Automotor',
  MACHINERY: 'Industria / Manufactura / Químicos / Automotor', MECHANICAL_OR_INDUSTRIAL_ENGINEERING: 'Industria / Manufactura / Químicos / Automotor',
  PLASTICS: 'Industria / Manufactura / Químicos / Automotor',
  OIL_ENERGY: 'Gas / Petróleo / Energía / Minería / Medio Ambiente', MINING_METALS: 'Gas / Petróleo / Energía / Minería / Medio Ambiente',
  UTILITIES: 'Gas / Petróleo / Energía / Minería / Medio Ambiente', RENEWABLES_ENVIRONMENT: 'Gas / Petróleo / Energía / Minería / Medio Ambiente',
  FOOD_BEVERAGES: 'Consumo Masivo', CONSUMER_GOODS: 'Consumo Masivo', FOOD_PRODUCTION: 'Consumo Masivo',
  COSMETICS: 'Consumo Masivo', WINE_AND_SPIRITS: 'Consumo Masivo',
  GOVERNMENT_ADMINISTRATION: 'Gobierno', GOVERNMENT_RELATIONS: 'Gobierno', PUBLIC_POLICY: 'Gobierno',
  FARMING: 'Agroindustria', AGRICULTURE: 'Agroindustria', FISHERIES: 'Agroindustria', RANCHING: 'Agroindustria',
};

export function macroIndustryFromHubSpotIndustry(value: string | null | undefined): string | null {
  if (isBlank(value)) return null;
  return HUBSPOT_INDUSTRY_TO_MACRO[(value as string).trim().toUpperCase()] ?? null;
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
