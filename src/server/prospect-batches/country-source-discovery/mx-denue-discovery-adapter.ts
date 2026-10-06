/**
 * mx-denue-discovery-adapter.ts — descubrimiento gratuito de México sobre el
 * DENUE (INEGI), consciente de criterios. Adapter PURO: la consulta en vivo se
 * inyecta (`MxDenueDiscoveryReads`).
 *
 * SOURCES-MX-DENUE-FREE-DISCOVERY-1.
 *
 * Qué empresas ofrece (decisión de la dueña, 30-09-2026):
 *   1. establecimientos cuya actividad SCIAN pertenece a la macro pedida según la
 *      tabla aprobada (`mx-denue-macro-table.ts`),
 *   2. con 51 o más personas ocupadas (estratos 7, 6, 5), de mayor a menor,
 *   3. UNA vez por empresa: DENUE lista establecimientos, así que las sucursales
 *      se agrupan por el núcleo de su razón social.
 *
 * DENUE no publica RFC: las empresas llegan sin identificador fiscal. Sí publica
 * sitio web, que se usa como dominio para detectar duplicados contra SellUp y
 * HubSpot.
 *
 * Por lo demás se comporta igual que Colombia: puede cerrar el objetivo entero.
 */

import {
  macroHasMxCoverage,
  MX_DENUE_ESTRATOS,
  MX_DENUE_MACRO_TABLE_VERSION,
  MX_DENUE_QUERY_PLAN,
  resolveScianMacro,
  type DenueActivityFilter,
} from './mx-denue-macro-table';
import { MEXICO_LEGAL_FORMS, normalizeCompanyNameCore } from '@/server/source-catalog/company-name-core';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const MX_DENUE_DISCOVERY_SOURCE_KEY = 'mx_denue_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia). */
export const MX_DENUE_DISCOVERY_MAX_ROWS = 200;

/** Establecimientos pedidos por cada combinación filtro × estrato. */
export const MX_DENUE_PAGE_SIZE = 100;

/** Un establecimiento DENUE, acotado a lo que esta proyección usa. */
export type DenueEstablishment = {
  id: string;
  name: string | null;
  legalName: string | null;
  activityCode: string | null;
  activityName: string | null;
  estrato: string | null;
  website: string | null;
  location: string | null;
};

/** Consulta inyectada (en vivo, sólo lectura). Fail-soft: vacío si falla. */
export type MxDenueDiscoveryReads = {
  readEstablishments: (input: {
    filter: DenueActivityFilter;
    estrato: string;
    limit: number;
  }) => Promise<readonly DenueEstablishment[]>;
};

/**
 * Terminaciones de dominio aceptadas. SOURCES-MX-DENUE-MIX-WEB-DEDUPE-1: DENUE trae
 * webs tecleadas a mano («HTPS ALINCEBPO.NET ECC» acababa como
 * «htpsalincebpo.netecc»). Un dominio equivocado es peor que ninguno: se guardaría
 * en la ficha y decidiría duplicados. Lo que no termine en una de éstas se descarta.
 */
const DENUE_ACCEPTED_TLDS = new Set([
  'com', 'net', 'org', 'mx', 'edu', 'gob', 'info', 'biz', 'io', 'co', 'tv', 'us',
  'app', 'tech', 'cloud', 'online', 'global', 'digital', 'group', 'solutions',
  'services', 'company', 'store', 'site', 'ai', 'dev', 'lat', 'es',
]);

/** Sitio web DENUE («WWW.EMPRESA.COM.MX», «empresa.mx/…») → dominio, o `null`. */
export function denueWebsiteToDomain(website: string | null | undefined): string | null {
  if (typeof website !== 'string') return null;
  const host = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#\s]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  const tld = host.slice(host.lastIndexOf('.') + 1);
  return DENUE_ACCEPTED_TLDS.has(tld) ? host : null;
}

/** «…, Guadalajara, JALISCO» → { city, region }. */
function splitLocation(location: string | null): { city: string | null; region: string | null } {
  if (!location) return { city: null, region: null };
  const parts = location.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return { city: null, region: null };
  return {
    region: parts[parts.length - 1] ?? null,
    city: parts.length >= 2 ? parts[parts.length - 2] : null,
  };
}

const STATE_LEVEL_GENERIC =
  /^(?:GOBIERNO DEL ESTADO(?: LIBRE Y SOBERANO)?|SECRETARIA DE SALUD|SECRETARIA DE EDUCACION(?: PUBLICA)?|SERVICIOS DE SALUD|PODER JUDICIAL(?: DEL ESTADO)?|CONGRESO DEL ESTADO|FISCALIA GENERAL(?: DEL ESTADO)?)$/;
const MUNICIPAL_GENERIC = /^(?:H )?(?:AYUNTAMIENTO|PRESIDENCIA MUNICIPAL|MUNICIPIO)(?: CONSTITUCIONAL)?$/;
/** Con estado en la Ciudad de México, «SECRETARIA DE SALUD» es la federal: no se completa. */
const FEDERAL_CAPITAL = /^CIUDAD DE MEXICO$/;

/**
 * SOURCES-MX-DENUE-QUALITY-1 — siglas de instituciones nacionales que DENUE trae
 * como NOMBRE DE ESTABLECIMIENTO (sin razón social): «IMSS CLINICA 76» es una
 * sucursal del IMSS, no otra empresa. Se lleva a la razón social de la institución
 * para que todas sus sucursales sean UNA empresa (y crucen con su RFC).
 * PEMEX y CFE NO: hay gasolineras y contratistas privados que DENUE nombra así.
 */
const NATIONAL_INSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^IMSS(?! BIENESTAR)\b/, 'INSTITUTO MEXICANO DEL SEGURO SOCIAL'],
  [/^ISSSTE\b/, 'INSTITUTO DE SEGURIDAD Y SERVICIOS SOCIALES DE LOS TRABAJADORES DEL ESTADO'],
];

function asciiUpper(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

/**
 * Nombres de organismos públicos que, tal como los publica DENUE, no identifican a
 * nadie (Prod 05-10/06-10: «GOBIERNO DEL ESTADO» en Hermosillo, «SECRETARIA DE
 * SALUD» en Villahermosa, «IMSS CLINICA 76»). Así no cruzan con el RFC ni con un
 * duplicado y el vendedor no sabe de quién se trata:
 *   · siglas de institución nacional → su razón social;
 *   · organismo estatal genérico → «… DE <ESTADO>» (salvo la Secretaría de Salud
 *     en la Ciudad de México, que es la federal);
 *   · ayuntamiento/municipio genérico → «… DE <MUNICIPIO>».
 * Cualquier otro nombre no cambia.
 */
export function completeGenericPublicEntityName(name: string, region: string | null, city: string | null = null): string {
  const core = normalizeCompanyNameCore(name, MEXICO_LEGAL_FORMS);
  for (const [pattern, legalName] of NATIONAL_INSTITUTIONS) {
    if (pattern.test(core)) return legalName;
  }
  const state = region?.trim();
  if (state && STATE_LEVEL_GENERIC.test(core)) {
    const isFederalHealth = core === 'SECRETARIA DE SALUD' && FEDERAL_CAPITAL.test(asciiUpper(state));
    return isFederalHealth ? name : `${name} DE ${state.toUpperCase()}`;
  }
  const municipality = city?.trim();
  if (municipality && MUNICIPAL_GENERIC.test(core)) return `${name} DE ${municipality.toUpperCase()}`;
  return name;
}

/** Sólo «GOBIERNO DEL ESTADO» (#591). Se conserva: el resto lo cubre la de arriba. */
export function completeGenericStateGovernmentName(name: string, region: string | null): string {
  const state = region?.trim();
  if (!state) return name;
  const core = normalizeCompanyNameCore(name, MEXICO_LEGAL_FORMS);
  return /^GOBIERNO DEL ESTADO(?: LIBRE Y SOBERANO)?$/.test(core) ? `${name} DE ${state.toUpperCase()}` : name;
}

function toCompany(row: DenueEstablishment, macroIndustryKey: string): CountrySourceCompany | null {
  const rawName = row.legalName?.trim() || row.name?.trim() || null;
  if (rawName === null) return null;
  const { city, region } = splitLocation(row.location);
  const legalName = completeGenericPublicEntityName(rawName, region, city);
  return {
    recordIdentityKey: `denue:${row.id}`,
    legalName,
    normalizedLegalName: normalizeCompanyNameCore(legalName, MEXICO_LEGAL_FORMS) || null,
    taxId: null,
    taxIdentifierType: null,
    countryCode: 'MX',
    city,
    region,
    domain: denueWebsiteToDomain(row.website),
    declaredIndustry: row.activityName?.trim() || null,
    industryCode: row.activityCode?.trim() || null,
    coarseSector: row.estrato?.trim() || null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: MX_DENUE_MACRO_TABLE_VERSION,
    },
  };
}

/** Intercala listas: el primero de cada una, luego el segundo de cada una… */
function* interleave<T>(lists: readonly (readonly T[])[]): Generator<T> {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) yield list[i];
    }
  }
}

/** Construye el adapter de descubrimiento de México. Nunca lanza. */
export function buildMxDenueDiscoveryAdapter(reads: MxDenueDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: MX_DENUE_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };
    if (!macroHasMxCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), MX_DENUE_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const filters = MX_DENUE_QUERY_PLAN[criteria.macroIndustryKey] ?? [];
    let recordsRead = 0;
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];

    // Estrato a estrato, de mayor a menor: se piden en paralelo los filtros de un
    // estrato y sólo se baja al siguiente si todavía falta cubrir el límite.
    for (const estrato of MX_DENUE_ESTRATOS) {
      if (companies.length >= limit) break;
      const pages = await Promise.all(
        filters.map((filter) => reads.readEstablishments({ filter, estrato, limit: MX_DENUE_PAGE_SIZE })),
      );
      for (const page of pages) recordsRead += page.length;
      // SOURCES-MX-DENUE-MIX-WEB-DEDUPE-1 — se intercalan las páginas (una fila de
      // cada actividad por turno). Antes se recorrían en orden y la primera
      // actividad (517 telecomunicaciones en Tecnología) llenaba sola el objetivo:
      // nunca aparecía software ni servicios de TI.
      for (const row of interleave(pages)) {
        if (companies.length >= limit) break;
        // La tabla de HOY manda: un filtro amplio nunca cuela otra macro.
        if (resolveScianMacro(row.activityCode) !== criteria.macroIndustryKey) continue;
        const company = toCompany(row, criteria.macroIndustryKey);
        if (company === null) continue;
        // Una empresa = una fila: se agrupan sus sucursales por el núcleo de la
        // razón social Y por el del nombre comercial («MEGACABLE» y «MEGACABLE
        // COMUNICACIONES DE MEXICO» comparten nombre comercial).
        const keys = [
          company.normalizedLegalName ?? company.legalName ?? row.id,
          // El nombre comercial también se completa: si no, dos gobiernos estatales
          // con nombre comercial «GOBIERNO DEL ESTADO» se tomarían por la misma empresa.
          normalizeCompanyNameCore(completeGenericPublicEntityName(row.name ?? '', company.region, company.city), MEXICO_LEGAL_FORMS),
        ].filter((key) => key.length > 0);
        if (keys.some((key) => seen.has(key))) continue;
        for (const key of keys) seen.add(key);
        companies.push(company);
      }
    }

    return { sourceKey: MX_DENUE_DISCOVERY_SOURCE_KEY, companies, recordsRead };
  };
}
