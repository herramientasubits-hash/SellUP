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
 * los dominios de una organización se queda el que MEJOR la nombra (sigla o nombre
 * exacto antes que una palabra suelta; SOURCES-US-GOV-WEB-PICK-1) y, entre los igual
 * de buenos, el más corto. Si ninguno la nombra, la entidad no entra.
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

/**
 * Tipos de CISA que sólo aportan dominios (no son entidad propia): la oficina
 * electoral a veces registra la web principal del condado («kingcounty.gov»).
 */
const POOL_ONLY_DOMAIN_TYPES: Readonly<Record<string, UsPublicEntityLevel>> = Object.freeze({
  'State or territory - Election': 'state',
  'County - Election': 'county',
  'City - Election': 'city',
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
  /** Población del estado (para ordenar su gobierno y sus agencias). */
  state?: (stateName: string) => number | null;
};

/** Presupuesto (USD) de una agencia federal de primer nivel por su nombre (USAspending), o `null`. */
export type UsFederalBudgetLookup = (organization: string) => number | null;

/**
 * SOURCES-US-GOV-ORDER-1 — orden de Gobierno aprobado por la dueña el 14-10-2026,
 * de mayor a menor (dentro de cada nivel, por presupuesto, población o estudiantes):
 *
 *   A · federales con presupuesto ≥ US$ 10.000 M (y sus suborganismos), gobiernos
 *       estatales principales, condados y ciudades de 1 M+ habitantes, universidades
 *       públicas de 20.000+ estudiantes;
 *   B · federales de US$ 1.000-10.000 M, locales de 250.000-1 M, universidades
 *       públicas de 10.000-20.000, demás agencias estatales;
 *   C · locales de 50.000-250.000, universidades públicas de 5.000-10.000,
 *       federales de US$ 100-1.000 M;
 *   D · comisiones y juntas federales con presupuesto menor o desconocido (al final).
 */
export const US_GOVERNMENT_TIER_BASE = Object.freeze({ A: 4000, B: 3000, C: 2000, D: 100 });

export type UsGovernmentTier = keyof typeof US_GOVERNMENT_TIER_BASE;

function tierScore(tier: UsGovernmentTier, offset: number): number {
  return US_GOVERNMENT_TIER_BASE[tier] + Math.max(0, Math.min(999, Math.round(offset)));
}

/** Suborganismos que nunca suben: comités, comisiones, consejos, juntas, grupos de trabajo. */
const SMALL_FEDERAL_UNIT = /\b(committee|commission|council|board|advisory|task force|panel|working group|inspector general)\b/i;

/**
 * Nivel y relevancia de una agencia federal por su presupuesto (escala logarítmica:
 * US$ 10.000 M = 0 … US$ 10 billones = 999). Un suborganismo hereda el presupuesto
 * de su agencia pero baja un nivel; los comités y juntas van siempre al final.
 */
export function federalGovernmentPriority(
  budgetUsd: number | null,
  options: { suborganization?: boolean; name?: string } = {},
): { tier: UsGovernmentTier; score: number } {
  const budget = budgetUsd ?? 0;
  if (options.suborganization && options.name !== undefined && SMALL_FEDERAL_UNIT.test(options.name)) {
    return { tier: 'D', score: tierScore('D', 0) };
  }
  const logOffset = budget > 0 ? (Math.log10(budget) - 10) * 333 : 0;
  if (budget >= 10_000_000_000) {
    return options.suborganization ? { tier: 'B', score: tierScore('B', logOffset) } : { tier: 'A', score: tierScore('A', logOffset) };
  }
  if (budget >= 1_000_000_000) {
    const offset = (Math.log10(budget) - 9) * 999;
    return options.suborganization ? { tier: 'C', score: tierScore('C', offset) } : { tier: 'B', score: tierScore('B', offset) };
  }
  if (budget >= 100_000_000 && !options.suborganization) {
    return { tier: 'C', score: tierScore('C', (Math.log10(budget) - 8) * 999) };
  }
  return { tier: 'D', score: tierScore('D', budget / 10_000_000) };
}

/** Nivel y relevancia de un condado o una ciudad por sus habitantes. */
export function localGovernmentPriority(inhabitants: number): { tier: UsGovernmentTier; score: number } {
  if (inhabitants >= 1_000_000) return { tier: 'A', score: tierScore('A', inhabitants / 10_000) };
  if (inhabitants >= 250_000) return { tier: 'B', score: tierScore('B', inhabitants / 1_000) };
  return { tier: 'C', score: tierScore('C', inhabitants / 250) };
}

const STATE_GOVERNMENT_NAME = /^(the\s+)?(state|commonwealth|territory|government)\s+of\s+/i;

/** ¿Es el gobierno principal del estado («State of Ohio», «State of Arizona, Executive Branch»)? */
export function isMainStateGovernment(name: string, stateCode: string | null): boolean {
  const stateName = stateCode !== null ? US_STATE_NAMES[stateCode] : undefined;
  if (stateName === undefined) return false;
  const head = name.replace(/[,(-].*$/, '').trim().toLowerCase();
  return head === stateName.toLowerCase() || (STATE_GOVERNMENT_NAME.test(head) && head.replace(STATE_GOVERNMENT_NAME, '') === stateName.toLowerCase());
}

/** Núcleo de un nombre de agencia federal para cruzarlo con USAspending. */
export function federalAgencyKey(name: string): string {
  return normalizeUsCompanyCore(name.replace(/\bU\.?\s?S\.?\b/gi, ' ').replace(/\bUnited States\b/gi, ' '));
}

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

/**
 * Cuánto nombra el dominio .gov a la entidad (SOURCES-US-GOV-WEB-PICK-1):
 *
 *   4 · el nombre completo junto, solo o con su nivel o su estado («texas»,
 *       «miamidade», «kingcounty», «houstontx»);
 *   4 · también la sigla exacta de una agencia federal («hhs», «ssa», «usda») y la
 *       abreviatura del estado para su gobierno («ny», «pa»): entre empates, la corta;
 *   3 · la sigla exacta de otra entidad;
 *   2 · contiene el nombre completo junto o todas sus palabras importantes;
 *   1 · contiene alguna palabra importante o es el inicio de la sigla;
 *   0 · no la nombra (no vale).
 *
 * Así «reproductivehealthservices.gov» (sólo «health» y «services») pierde contra
 * «hhs.gov» para el Department of Health and Human Services.
 */
export function dotGovDomainMatchScore(
  domain: string,
  entityName: string,
  context: { stateCode?: string | null; levelWords?: readonly string[]; mainState?: boolean; federal?: boolean } = {},
): number {
  const label = domain.toLowerCase().replace(/\.gov$/, '').split('.').pop()!.replace(/-/g, '');
  if (label.length < 2) return 0;
  const words = nameWords(entityName);
  const significant = words.filter((word) => !STOPWORDS.has(word));
  const joined = significant.join('').toLowerCase();
  const initials = (list: readonly string[]) => list.map((word) => word.charAt(0)).join('').toLowerCase();
  const contentWords = words.filter((word) => !ACRONYM_SKIP.has(word));
  const withoutDepartment = contentWords.filter((word) => word !== 'DEPARTMENT');
  const acronyms = [
    initials(contentWords),
    initials(withoutDepartment),
    initials(contentWords.filter((word) => !STATE_NAME_WORDS.has(word))),
  ];
  acronyms.push(`us${acronyms[0]}`, `us${acronyms[1]}`);
  const variants = labelVariants(label);

  const state = context.stateCode?.toLowerCase() ?? '';
  if (joined.length >= 3) {
    const exactForms = [joined, ...(context.levelWords ?? []).map((word) => `${joined}${word}`)];
    if (state !== '') exactForms.push(...exactForms.map((form) => `${form}${state}`));
    if (exactForms.includes(label)) return 4;
  }
  const exactAcronym = variants.some((variant) => variant.length >= 3 && acronyms.some((acronym) => acronym === variant));
  // Las agencias federales y los estados usan la sigla como web principal («ssa.gov»
  // y no «socialsecurity.gov», «pa.gov», «ny.gov»): ahí vale tanto como el nombre
  // y, por ser más corta, gana.
  if (context.mainState === true && state.length === 2 && label === state) return 4;
  if (exactAcronym) return context.federal === true ? 4 : 3;
  const longWords = significant.filter((word) => word.length >= 4).map((word) => word.toLowerCase());
  if (
    (joined.length >= 3 && label.includes(joined)) ||
    (longWords.length >= 2 && longWords.every((word) => label.includes(word)))
  ) {
    return 2;
  }
  if (longWords.some((word) => label.includes(word))) return 1;
  const acronymPrefix = variants.some(
    (variant) => variant.length >= 3 && acronyms.some((acronym) => acronym.length >= 3 && acronym.startsWith(variant)),
  );
  return acronymPrefix ? 1 : 0;
}

/** ¿El dominio .gov lleva el nombre o la sigla de la entidad? */
export function dotGovDomainNamesEntity(domain: string, entityName: string): boolean {
  return dotGovDomainMatchScore(domain, entityName) > 0;
}

type Group = {
  level: UsPublicEntityLevel;
  name: string;
  parent: string | null;
  state: string | null;
  city: string | null;
  domains: string[];
  /** Pool de dominios extra (subunidades, oficina electoral) para elegir su web. */
  poolKey: string | null;
};

/** Dominios de CISA → una fila por entidad (con web que la nombra y, si es local, ≥ 50.000 habitantes). */
export function buildUsPublicEntityRows(
  records: readonly DotGovDomainRecord[],
  population: UsPopulationLookup,
  params: { sourceYear: number; importedAt: string },
  federalBudget: UsFederalBudgetLookup = () => null,
): UsPublicEntityRow[] {
  // SOURCES-US-GOV-WEB-PICK-1 — una entidad por agencia, por gobierno principal de
  // cada estado y por lugar (condado o ciudad); y la web principal se busca también
  // entre los dominios de sus subunidades: «hhs.gov» lo registró la Office of the
  // Secretary, «texas.gov» el departamento de informática del estado.
  const groups = new Map<string, Group>();
  const pools = new Map<string, Set<string>>();
  const addToPool = (key: string, domain: string) => {
    const pool = pools.get(key) ?? new Set<string>();
    pool.add(domain);
    pools.set(key, pool);
  };
  for (const record of records) {
    const type = record.domainType.trim();
    const organization = record.organization.trim();
    const domain = record.domain.trim().toLowerCase();
    if (organization === '' || !domain.endsWith('.gov')) continue;
    const state = record.state?.trim().toUpperCase() || null;
    const poolLevel = LEVEL_BY_DOMAIN_TYPE[type] ?? POOL_ONLY_DOMAIN_TYPES[type];
    if (poolLevel === 'federal') addToPool(`federal|${organization.toLowerCase()}`, domain);
    if (poolLevel === 'state' && state !== null) addToPool(`state|${state}`, domain);
    if ((poolLevel === 'county' || poolLevel === 'city') && state !== null) {
      addToPool(`${poolLevel}|${placeNameKey(organization)}|${state}`, domain);
      // Todo el estado: sólo vale si el dominio es el nombre exacto («kingcounty.gov»
      // lo registró «King County Information Technology»).
      addToPool(`${poolLevel}|*|${state}`, domain);
    }

    const level = LEVEL_BY_DOMAIN_TYPE[type];
    if (level === undefined) continue;
    const sub = level === 'federal' ? record.suborganization?.trim() || null : null;
    const mainState = level === 'state' && isMainStateGovernment(organization, state);
    const key =
      level === 'federal'
        ? `federal|${organization.toLowerCase()}|${(sub ?? '').toLowerCase()}`
        : mainState
          ? `state-main|${state}`
          : level === 'state'
            ? `state|${organization.toLowerCase()}|${state ?? ''}`
            : `${level}|${placeNameKey(organization)}|${state ?? ''}`;
    const existing = groups.get(key);
    const name = sub ?? organization;
    const group = existing ?? {
      level,
      name,
      parent: sub !== null ? organization : null,
      state: level === 'federal' ? null : state,
      city: record.city?.trim() || null,
      domains: [],
      poolKey:
        level === 'federal'
          ? sub === null
            ? `federal|${organization.toLowerCase()}`
            : null
          : mainState
            ? `state|${state}`
            : level === 'county' || level === 'city'
              ? `${level}|${placeNameKey(organization)}|${state ?? ''}`
              : null,
    };
    // El gobierno principal del estado se queda con el nombre más corto («State of Ohio»).
    if (existing !== undefined && mainState && name.length < existing.name.length) existing.name = name;
    group.domains.push(domain);
    groups.set(key, group);
  }

  // Primero las entidades principales (agencia, gobierno del estado, lugar): así se
  // quedan con su web antes que una subunidad que la comparte.
  const ordered = [...groups.values()].sort((a, b) => Number(a.poolKey === null) - Number(b.poolKey === null));

  const rows: UsPublicEntityRow[] = [];
  const seenDomains = new Set<string>();
  for (const group of ordered) {
    // La web que mejor nombra a la entidad (sigla o nombre exacto antes que una
    // palabra suelta) y, entre las igual de buenas, la más corta. Las de su pool
    // (subunidades, oficina electoral) sólo cuentan si la nombran de verdad (≥ 2).
    const own = new Set(group.domains);
    const pool = group.poolKey !== null ? pools.get(group.poolKey) ?? new Set<string>() : new Set<string>();
    const local = group.level === 'county' || group.level === 'city';
    const statewide = local && group.state !== null ? pools.get(`${group.level}|*|${group.state}`) ?? new Set<string>() : new Set<string>();
    const context = {
      stateCode: group.state,
      levelWords: group.level === 'county' ? ['county', 'co', 'parish'] : group.level === 'city' ? ['city'] : [],
      mainState: group.level === 'state' && isMainStateGovernment(group.name, group.state),
      federal: group.level === 'federal',
    };
    const minimum = (domain: string) => (own.has(domain) ? 1 : pool.has(domain) ? 2 : 4);
    const named = [...new Set([...own, ...pool, ...statewide])]
      .filter((domain) => !seenDomains.has(domain))
      .map((domain) => ({ domain, score: dotGovDomainMatchScore(domain, group.name, context) }))
      .filter((candidate) => candidate.score >= minimum(candidate.domain))
      .sort((a, b) => b.score - a.score || a.domain.length - b.domain.length || a.domain.localeCompare(b.domain))
      .map((candidate) => candidate.domain);
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

    // Orden aprobado (A-D): federales por presupuesto (los suborganismos heredan el de
    // su agencia), estados por su población, locales por habitantes.
    let budget: number | null = null;
    let tier: UsGovernmentTier;
    let priority: number;
    let sizeSource: string | null = inhabitants !== null ? 'Censo 2024 – habitantes' : null;
    if (group.level === 'federal') {
      const own = federalBudget(group.name);
      budget = own ?? (group.parent !== null ? federalBudget(group.parent) : null);
      ({ tier, score: priority } = federalGovernmentPriority(budget, {
        suborganization: own === null && group.parent !== null,
        name: group.name,
      }));
      if (tier === 'A') sizeSource = 'USAspending – presupuesto federal';
    } else if (group.level === 'state') {
      const stateName = group.state !== null ? US_STATE_NAMES[group.state] : undefined;
      const statePopulation = stateName !== undefined ? population.state?.(stateName) ?? null : null;
      tier = isMainStateGovernment(group.name, group.state) ? 'A' : 'B';
      priority = tierScore(tier, (statePopulation ?? 0) / 50_000);
      if (tier === 'A') sizeSource = 'Censo 2024 – habitantes del estado';
    } else {
      ({ tier, score: priority } = localGovernmentPriority(inhabitants ?? 0));
    }
    const large =
      tier === 'A' || (inhabitants !== null && inhabitants >= US_LOCAL_GOVERNMENT_LARGE_POPULATION);

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
      priority_score: priority,
      raw_data: {
        directory_kind: 'public_entity',
        government_level: group.level,
        parent_organization: group.parent,
        macro_industry_key: 'government',
        activity_text: 'Entidad pública',
        inhabitants,
        federal_budget_usd: budget,
        government_tier: tier,
        size_band: large && sizeSource !== null ? 'large' : null,
        size_source: sizeSource,
        website_domain: domain,
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows.sort((a, b) => b.priority_score - a.priority_score || a.legal_name.localeCompare(b.legal_name));
}
