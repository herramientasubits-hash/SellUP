/**
 * bo-public-entity-rows.ts — directorio de entidades públicas de Bolivia (gob.bo),
 * listo para `source_company_snapshots` (`source_key = bo_public_entities`).
 *
 * SOURCES-BO-CLOSE-1. El portal único del Estado (www.gob.bo, AGETIC; DS 5340/2025)
 * publica la ficha de cada entidad: nombre, sigla, entidad de la que depende, PÁGINA
 * WEB, correo de contacto y ubicación (departamento, provincia, municipio). Es
 * público (robots.txt: Allow /) y se lee una vez, despacio (≈2,5 s entre fichas).
 *
 * Qué aporta:
 *   - la WEB oficial (.gob.bo y otras) de alcaldías, gobernaciones, ministerios,
 *     empresas públicas y cajas de salud: la que Apollo y Tavily no traen y sin la
 *     cual la candidata termina en Descartadas;
 *   - el buscador gratuito de Gobierno.
 *
 * Qué NO aporta: el NIT. Ninguna fuente oficial gratuita publica en lote el NIT de
 * las entidades públicas, y el SEPREC no las registra. Las filas se identifican por
 * la ficha del portal (`gobbo:<slug>`), nunca por un número inventado.
 *
 * Nunca se guardan correos ni personas: del correo de contacto sólo se usa su
 * DOMINIO, y sólo cuando la ficha no trae web y el dominio es institucional.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { classifyBoliviaActivity } from '@/server/prospect-batches/country-source-discovery/bo-activity-macro-table';
import { boliviaWebsiteHost, normalizeBoliviaCompanyCore } from '../seprec-bolivia/bo-company-name-core';

export const BO_PUBLIC_ENTITIES_SOURCE_KEY = 'bo_public_entities' as const;
export const BO_PUBLIC_ENTITIES_SOURCE_YEAR = 2026;

/** Ficha de una entidad tal como la publica gob.bo. */
export type GobBoEntity = {
  slug: string;
  name: string;
  acronym: string | null;
  website: string | null;
  contactEmail: string | null;
  parentName: string | null;
  department: string | null;
  municipality: string | null;
};

/**
 * El payload de Next.js va dentro de una cadena de JavaScript: se quita UN nivel de
 * escape para leerlo como JSON («\\\"Mi teleférico\\\"» → «\"Mi teleférico\"»).
 */
function unescapeFlight(html: string): string {
  return html.replace(/\\(.)/g, '$1');
}

function jsonString(raw: string | undefined): string | null {
  if (raw === undefined || raw === 'null') return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

const STRING_OR_NULL = '("(?:[^"\\\\]|\\\\.)*"|null)';

/** HTML de `https://www.gob.bo/entidades/<slug>` → ficha, o `null` si no se reconoce. */
export function parseGobBoEntityPage(html: string, slug: string): GobBoEntity | null {
  const text = unescapeFlight(html);
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const own = new RegExp(
    `"nombre":${STRING_OR_NULL},"slug":"${escapedSlug}","sigla":${STRING_OR_NULL},"urlPaginaWeb":${STRING_OR_NULL},"telefonoContacto":${STRING_OR_NULL},"correoElectronicoContacto":${STRING_OR_NULL}`,
  ).exec(text);
  if (own === null) return null;
  const name = jsonString(own[1]);
  if (name === null) return null;

  // La entidad de la que depende va justo antes: "padre":{"id":…,"nombre":"…",…}.
  const before = text.slice(Math.max(0, own.index - 600), own.index);
  const parent = /"padre":\{"id":"[^"]*","nombre":("(?:[^"\\]|\\.)*")/.exec(before);

  // La ubicación (la primera, la oficina central) va después.
  const after = text.slice(own.index, own.index + 6_000);
  const location = /"ubicacionesList":\[\{[^\]]*?"municipio":("(?:[^"\\]|\\.)*"|null),"provincia":("(?:[^"\\]|\\.)*"|null),"departamento":("(?:[^"\\]|\\.)*"|null)/.exec(after);

  return {
    slug,
    name,
    acronym: jsonString(own[2]),
    website: jsonString(own[3]),
    contactEmail: jsonString(own[5]),
    parentName: parent ? jsonString(parent[1]) : null,
    municipality: location ? jsonString(location[1]) : null,
    department: location ? jsonString(location[3]) : null,
  };
}

/** Tipo de entidad, por su nombre. */
export type BoPublicEntityKind =
  | 'municipal_government'
  | 'departmental_government'
  | 'ministry'
  | 'public_university'
  | 'health_insurer'
  | 'public_company'
  | 'other_public_body';

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyBoPublicEntityKind(name: string): BoPublicEntityKind {
  const n = plain(name);
  if (/^(GOBIERNO AUTONOMO MUNICIPAL|GOBIERNO MUNICIPAL|ALCALDIA)/.test(n)) return 'municipal_government';
  if (/^(GOBIERNO AUTONOMO DEPARTAMENTAL|GOBERNACION)/.test(n)) return 'departmental_government';
  if (/^MINISTERIO/.test(n)) return 'ministry';
  if (/^UNIVERSIDAD/.test(n)) return 'public_university';
  if (/^CAJA (NACIONAL|DE SALUD|BANCARIA|PETROLERA|DE CAMINOS)/.test(n)) return 'health_insurer';
  if (/^(EMPRESA|YACIMIENTOS|BOLIVIANA DE|DEPOSITOS ADUANEROS|ENTEL|MI TELEFERICO|CORPORACION MINERA|SERVICIO DE AGUA|EMPRESA MUNICIPAL)/.test(n)) {
    return 'public_company';
  }
  return 'other_public_body';
}

/**
 * Alcaldías que el buscador gratuito ofrece: las nueve capitales de departamento y
 * El Alto, las ciudades más grandes del país. gob.bo no trae tamaño y el SICOES (que
 * publica la categoría por habitantes) bloquea el acceso: las demás alcaldías se
 * quedan en la tabla para dar web e identidad, pero no se ofrecen.
 */
export const BO_LARGE_MUNICIPALITY_CORES: ReadonlySet<string> = new Set([
  'GAM LA PAZ',
  'GAM EL ALTO',
  'GAM EL ALTO DE LA PAZ',
  'GAM SANTA CRUZ DE LA SIERRA',
  'GAM COCHABAMBA',
  'GAM SUCRE',
  'GAM ORURO',
  'GAM POTOSI',
  'GAM TARIJA',
  'GAM TRINIDAD',
  'GAM COBIJA',
]);

/** ¿Depende de un gobierno municipal (empresa o servicio municipal)? */
function isMunicipalDependency(parentName: string | null): boolean {
  return parentName !== null && /^(GOBIERNO AUTONOMO MUNICIPAL|GOBIERNO MUNICIPAL|ALCALDIA)/.test(plain(parentName));
}

/**
 * Macro industria con la que el buscador gratuito ofrece la entidad, o `null` si no
 * la ofrece (sigue en la tabla para la web y la identidad):
 *   - gobernaciones, ministerios y organismos nacionales → Gobierno;
 *   - alcaldías → Gobierno, sólo las grandes (`BO_LARGE_MUNICIPALITY_CORES`);
 *   - empresas públicas NACIONALES → la macro de su actividad, por su nombre, con la
 *     misma tabla que las empresas privadas (ENDE → Energía, Entel → Tecnología);
 *     las municipales no se ofrecen;
 *   - cajas de salud → Salud.
 */
export function boPublicEntityMacro(
  entity: Pick<GobBoEntity, 'name' | 'parentName'>,
  kind: BoPublicEntityKind,
  core: string,
): MacroIndustryKey | null {
  if (kind === 'municipal_government') return BO_LARGE_MUNICIPALITY_CORES.has(core) ? 'government' : null;
  if (kind === 'departmental_government' || kind === 'ministry') return 'government';
  if (isMunicipalDependency(entity.parentName)) return null;
  if (kind === 'health_insurer') return 'health_pharma';
  if (kind === 'public_company') return classifyBoliviaActivity(entity.name, null).macroIndustryKey;
  if (kind === 'public_university') return null;
  return 'government';
}

/** Correo genérico de proveedores gratuitos: su dominio nunca es la web de la entidad. */
const FREE_MAIL = /@(gmail|hotmail|yahoo|outlook|live|icloud)\./i;

/** Web oficial: la de la ficha; si no hay, el dominio institucional del correo. */
export function boPublicEntityDomain(entity: Pick<GobBoEntity, 'website' | 'contactEmail'>): {
  domain: string | null;
  source: 'website' | 'email' | null;
} {
  const fromWeb = boliviaWebsiteHost(entity.website);
  if (fromWeb !== null) return { domain: fromWeb, source: 'website' };
  const email = entity.contactEmail ?? '';
  if (!email.includes('@') || FREE_MAIL.test(email)) return { domain: null, source: null };
  const fromMail = boliviaWebsiteHost(email.split('@')[1] ?? null);
  return fromMail !== null && /\.(gob|edu|org|com)?\.?bo$/.test(fromMail)
    ? { domain: fromMail, source: 'email' }
    : { domain: null, source: null };
}

/**
 * Núcleo comparable de una entidad pública: el mismo de las empresas, más la forma
 * corta de los gobiernos autónomos que usan Apollo y Tavily:
 *   «Gobierno Autónomo Municipal de La Paz» = «Alcaldía de La Paz» = «GAM La Paz»
 *     → GAM LA PAZ
 *   «Gobierno Autónomo Departamental de Santa Cruz» = «Gobernación de Santa Cruz»
 *     → GAD SANTA CRUZ
 * El municipio entre paréntesis («Uriondo (Concepción)») es la capital: se quita.
 */
export function normalizeBoliviaPublicEntityCore(name: string | null | undefined): string {
  const core = normalizeBoliviaCompanyCore(name);
  const municipal = /^(?:GOBIERNO AUTONOMO MUNICIPAL|GOBIERNO MUNICIPAL|ALCALDIA MUNICIPAL|ALCALDIA|GAM|GAMLP)(?: (?:DE|DEL))? (.+)$/.exec(core);
  if (municipal) return `GAM ${municipal[1]}`;
  const departmental = /^(?:GOBIERNO AUTONOMO DEPARTAMENTAL|GOBERNACION|GAD)(?: (?:DE|DEL))? (.+)$/.exec(core);
  if (departmental) return `GAD ${departmental[1]}`;
  return core;
}

export type BoPublicEntitySnapshotRow = {
  source_key: typeof BO_PUBLIC_ENTITIES_SOURCE_KEY;
  country_code: 'BO';
  source_year: number;
  source_period: null;
  record_identity_key: string;
  tax_id: null;
  normalized_tax_id: null;
  legal_name: string;
  normalized_legal_name: string;
  sector: string;
  city: string | null;
  department: string | null;
  region: string | null;
  priority_score: number;
  raw_data: {
    entity_kind: BoPublicEntityKind;
    acronym: string | null;
    parent_name: string | null;
    website_domain: string | null;
    website_domain_source: 'website' | 'email' | null;
    macro_industry_key: MacroIndustryKey | null;
    gobbo_slug: string;
  };
};

/** Gobiernos primero (los departamentales, luego los municipales, luego el resto). */
const KIND_PRIORITY: Readonly<Record<BoPublicEntityKind, number>> = {
  departmental_government: 5,
  ministry: 4,
  municipal_government: 3,
  public_company: 2,
  health_insurer: 2,
  public_university: 2,
  other_public_body: 1,
};

/**
 * Fichas → filas. Una fila por ficha; si dos fichas comparten núcleo de nombre, gana
 * la que trae web (gob.bo lista a veces la misma entidad dos veces).
 */
export function buildBoPublicEntityRows(entities: Iterable<GobBoEntity>): BoPublicEntitySnapshotRow[] {
  const byCore = new Map<string, BoPublicEntitySnapshotRow>();
  for (const entity of entities) {
    const core = normalizeBoliviaPublicEntityCore(entity.name);
    if (core.length < 3) continue;
    const kind = classifyBoPublicEntityKind(entity.name);
    const { domain, source } = boPublicEntityDomain(entity);
    const row: BoPublicEntitySnapshotRow = {
      source_key: BO_PUBLIC_ENTITIES_SOURCE_KEY,
      country_code: 'BO',
      source_year: BO_PUBLIC_ENTITIES_SOURCE_YEAR,
      source_period: null,
      record_identity_key: `gobbo:${entity.slug}`,
      tax_id: null,
      normalized_tax_id: null,
      legal_name: entity.name,
      normalized_legal_name: core,
      sector: kind,
      city: entity.municipality,
      department: entity.department,
      region: entity.department,
      priority_score: KIND_PRIORITY[kind] + (domain !== null ? 1 : 0),
      raw_data: {
        entity_kind: kind,
        acronym: entity.acronym,
        parent_name: entity.parentName,
        website_domain: domain,
        website_domain_source: source,
        macro_industry_key: boPublicEntityMacro(entity, kind, core),
        gobbo_slug: entity.slug,
      },
    };
    const previous = byCore.get(core);
    if (previous === undefined || (previous.raw_data.website_domain === null && domain !== null)) byCore.set(core, row);
  }
  return [...byCore.values()];
}
