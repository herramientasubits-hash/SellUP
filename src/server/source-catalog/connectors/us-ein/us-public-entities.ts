/**
 * us-public-entities.ts — entidades públicas de Estados Unidos con su web .gov
 * oficial (`us_public_entities`), para la capa gratuita de Gobierno.
 *
 * SOURCES-US-CLOSE-1 — cortes aprobados por la dueña el 14-10-2026:
 *
 *   - Agencias federales (ejecutivo, legislativo y judicial) y gobiernos
 *     estatales con sus agencias: todas.
 *   - Condados y ciudades: sólo con 50.000 habitantes o más (estimación del
 *     Censo de 2024).
 *   - Fuera: distritos especiales, escolares, tribus, juntas electorales.
 *
 * Fuente: la lista completa de dominios .gov de CISA
 * (github.com/cisagov/dotgov-data, `current-full.csv`, dominio público). No trae
 * EIN: la entidad se identifica por su web. De la lista sólo se usan el dominio,
 * el tipo, la organización, la ciudad y el estado; NUNCA el correo de contacto.
 *
 * Una web .gov sólo vale si lleva el nombre o la sigla de la entidad: de todos
 * los dominios de una organización se queda el que la nombra (y, entre ellos, el
 * más corto). Si ninguno la nombra, la entidad no entra.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { buildRecordIdentityKey, type RecordIdentityKey } from '../../record-identity';
import { normalizeUsCompanyCore, US_COUNTRY_CODE } from './us-ein-registry-rows';

export const US_PUBLIC_ENTITIES_SOURCE_KEY = 'us_public_entities' as const;
export const US_PUBLIC_ENTITY_IDENTITY_NAMESPACE = 'us-public-entity' as const;

/** Habitantes mínimos de un condado o una ciudad para entrar. */
export const US_LOCAL_GOVERNMENT_MIN_POPULATION = 50_000;

/** Habitantes desde los que un condado o una ciudad cuenta como grande. */
export const US_LOCAL_GOVERNMENT_LARGE_POPULATION = 250_000;

export type UsPublicEntityLevel = 'federal' | 'state' | 'county' | 'city';

const LEVEL_BY_DOMAIN_TYPE: Readonly<Record<string, UsPublicEntityLevel>> = Object.freeze({
  'Federal - Executive': 'federal',
  'Federal - Legislative': 'federal',
  'Federal - Judicial': 'federal',
  Federal: 'federal',
  'State or territory': 'state',
  County: 'county',
  City: 'city',
});

/** Estados y territorios: abreviatura → nombre (el del Censo). */
export const US_STATE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
});

/** Fila de `current-full.csv` (sólo las columnas que se usan). */
export type DotGovDomainRecord = {
  domain: string;
  domainType: string;
  organization: string;
  suborganization: string | null;
  city: string | null;
  state: string | null;
};

/** Población por (nombre del lugar, estado) del Censo, ya normalizados. */
export type UsPopulationLookup = {
  county: (name: string, stateName: string) => number | null;
  city: (name: string, stateName: string) => number | null;
};

export type UsPublicEntityRow = {
  source_key: typeof US_PUBLIC_ENTITIES_SOURCE_KEY;
  country_code: typeof US_COUNTRY_CODE;
  source_year: number;
  tax_id: null;
  normalized_tax_id: null;
  legal_name: string;
  normalized_legal_name: string;
  city: string | null;
  region: string | null;
  priority_score: number;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

const STOPWORDS = new Set([
  'THE', 'OF', 'AND', 'FOR', 'IN', 'ON', 'AT', 'TO', 'US', 'U', 'S', 'CITY', 'TOWN', 'VILLAGE',
  'COUNTY', 'PARISH', 'BOROUGH', 'STATE', 'DEPARTMENT', 'OFFICE', 'DIVISION', 'BUREAU',
  'GOVERNMENT', 'EXECUTIVE', 'BRANCH', 'UNITED', 'STATES', 'NATIONAL', 'FEDERAL', 'AGENCY',
  'COMMISSION', 'BOARD', 'SERVICE', 'SERVICES', 'ADMINISTRATION', 'OCIO', 'GOV',
]);

/** Núcleo de un nombre de lugar para cruzarlo con el Censo («City of X» / «X County» → «x»). */
export function placeNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/,.*$/, '')
    .replace(/^(the\s+)?(city|town|village|borough|township|county|parish|municipality)\s+(and\s+county\s+)?of\s+/, '')
    .replace(/\s+(city|town|village|borough|township|county|parish|municipality|census area)(\s+government)?$/, '')
    .replace(/^saint\s+/, 'st ')
    .replace(/^st\.\s*/, 'st ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameWords(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

const STATE_ABBREVIATIONS = new Set(Object.keys(US_STATE_NAMES).map((code) => code.toLowerCase()));
const STATE_NAME_WORDS = new Set(
  Object.values(US_STATE_NAMES).flatMap((name) => name.toUpperCase().split(' ')),
);
const ACRONYM_SKIP = new Set(['OF', 'AND', 'FOR', 'THE', 'IN', 'ON', 'AT', 'TO']);

/** La etiqueta y sus variantes sin la abreviatura del estado delante o detrás («al911» → «911», «abcks» → «abc»). */
function labelVariants(label: string): string[] {
  const variants = [label];
  if (label.length >= 5 && STATE_ABBREVIATIONS.has(label.slice(0, 2))) variants.push(label.slice(2));
  if (label.length >= 5 && STATE_ABBREVIATIONS.has(label.slice(-2))) variants.push(label.slice(0, -2));
  return variants;
}

/** ¿El dominio .gov lleva el nombre o la sigla de la entidad? */
export function dotGovDomainNamesEntity(domain: string, entityName: string): boolean {
  const label = domain.toLowerCase().replace(/\.gov$/, '').split('.').pop()!.replace(/-/g, '');
  if (label.length < 2) return false;
  const words = nameWords(entityName);
  const significant = words.filter((word) => !STOPWORDS.has(word));
  if (significant.some((word) => word.length >= 4 && label.includes(word.toLowerCase()))) return true;
  // Todas las palabras juntas («newyorkcity», «lacounty» no: «la» no es palabra del nombre).
  const joined = significant.join('').toLowerCase();
  if (joined.length >= 3 && label.includes(joined)) return true;
  // Sigla: iniciales de las palabras con contenido («Centers for Disease Control and
  // Prevention» → «cdcp»), también sin el nombre del estado («Alabama Alcoholic
  // Beverage Control Board» → «abcb») y con «us» delante («usda»).
  const initials = (list: readonly string[]) => list.map((word) => word.charAt(0)).join('').toLowerCase();
  const contentWords = words.filter((word) => !ACRONYM_SKIP.has(word));
  const acronyms = [initials(contentWords), initials(contentWords.filter((word) => !STATE_NAME_WORDS.has(word)))];
  acronyms.push(`us${acronyms[0]}`);
  return labelVariants(label).some(
    (variant) =>
      variant.length >= 3 && acronyms.some((acronym) => acronym.length >= 3 && (acronym === variant || acronym.startsWith(variant))),
  );
}

type Group = {
  level: UsPublicEntityLevel;
  name: string;
  parent: string | null;
  state: string | null;
  city: string | null;
  domains: string[];
};

/** Dominios de CISA → una fila por entidad (con web que la nombra y, si es local, ≥ 50.000 habitantes). */
export function buildUsPublicEntityRows(
  records: readonly DotGovDomainRecord[],
  population: UsPopulationLookup,
  params: { sourceYear: number; importedAt: string },
): UsPublicEntityRow[] {
  const groups = new Map<string, Group>();
  for (const record of records) {
    const level = LEVEL_BY_DOMAIN_TYPE[record.domainType.trim()];
    const organization = record.organization.trim();
    const domain = record.domain.trim().toLowerCase();
    if (level === undefined || organization === '' || !domain.endsWith('.gov')) continue;
    const sub = level === 'federal' ? record.suborganization?.trim() || null : null;
    const state = record.state?.trim().toUpperCase() || null;
    const key = `${level}|${organization.toLowerCase()}|${(sub ?? '').toLowerCase()}|${level === 'federal' ? '' : state ?? ''}`;
    const group = groups.get(key) ?? {
      level,
      name: sub ?? organization,
      parent: sub !== null ? organization : null,
      state: level === 'federal' ? null : state,
      city: record.city?.trim() || null,
      domains: [],
    };
    group.domains.push(domain);
    groups.set(key, group);
  }

  const rows: UsPublicEntityRow[] = [];
  const seenDomains = new Set<string>();
  for (const group of groups.values()) {
    const named = group.domains
      .filter((domain) => dotGovDomainNamesEntity(domain, group.name))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    const domain = named[0];
    if (domain === undefined || seenDomains.has(domain)) continue;

    let inhabitants: number | null = null;
    if (group.level === 'county' || group.level === 'city') {
      const stateName = group.state !== null ? US_STATE_NAMES[group.state] : undefined;
      if (stateName === undefined) continue;
      inhabitants = population[group.level](placeNameKey(group.name), stateName);
      if (inhabitants === null || inhabitants < US_LOCAL_GOVERNMENT_MIN_POPULATION) continue;
    }

    const core = normalizeUsCompanyCore(group.name);
    if (core.length < 2) continue;
    const identity = buildRecordIdentityKey(US_PUBLIC_ENTITY_IDENTITY_NAMESPACE, domain);
    seenDomains.add(domain);
    rows.push({
      source_key: US_PUBLIC_ENTITIES_SOURCE_KEY,
      country_code: US_COUNTRY_CODE,
      source_year: params.sourceYear,
      tax_id: null,
      normalized_tax_id: null,
      legal_name: group.name,
      normalized_legal_name: core,
      city: group.level === 'city' ? group.city : null,
      region: group.state,
      // Federal y estatal delante; las locales por habitantes (en miles).
      priority_score:
        group.level === 'federal' ? 3000 : group.level === 'state' ? 2000 : Math.min(1999, Math.round((inhabitants ?? 0) / 1000)),
      raw_data: {
        directory_kind: 'public_entity',
        government_level: group.level,
        parent_organization: group.parent,
        macro_industry_key: 'government',
        activity_text: 'Entidad pública',
        inhabitants,
        size_band: inhabitants !== null && inhabitants >= US_LOCAL_GOVERNMENT_LARGE_POPULATION ? 'large' : null,
        size_source: inhabitants !== null ? 'Censo 2024 – habitantes' : null,
        website_domain: domain,
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows.sort((a, b) => b.priority_score - a.priority_score || a.legal_name.localeCompare(b.legal_name));
}
