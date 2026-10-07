/**
 * pe-sunat-directory-discovery-adapter.ts — descubrimiento gratuito de Perú sobre
 * el Padrón RUC de SUNAT en datos abiertos cruzado con el padrón reducido (razón
 * social). PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-PE-FREE-DISCOVERY-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas `pe_sunat_directory` ya vienen filtradas en la carga: sociedades y
 * entidades ACTIVAS y HABIDAS con RUC 20, 200 o más trabajadores informados y una
 * actividad CIIU Rev. 4 con macro industria
 * (`scripts/source-catalog/run-pe-sunat-sources-etl.ts`). Aquí sólo se piden las
 * de la macro pedida, de más a menos trabajadores. Igual que Ecuador, la fuente
 * puede cerrar el objetivo entero, nunca con empresas pequeñas.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY
 * (`pe-sunat-macro-table.ts`): cada fila se re-clasifica desde su clase CIIU y
 * sólo se ofrece si coincide. Y el tamaño se vuelve a comprobar.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`PeSunatDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  PE_SUNAT_MACRO_TABLE_VERSION,
  macroHasPeCoverage,
  resolvePeActivityMacro,
} from './pe-sunat-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';
import { buildCountrySourceOfficialWorkforce } from './country-source-types';

/** `source_key` que esta proyección declara. */
export const PE_SUNAT_DIRECTORY_DISCOVERY_SOURCE_KEY = 'pe_sunat_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que Colombia y Argentina). */
export const PE_SUNAT_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

/** Umbral de tamaño del Agente 1 (mismo que la carga). */
export const PE_SUNAT_DIRECTORY_DISCOVERY_MIN_WORKERS = 200;

/** RUC de sociedad (las personas naturales, RUC 10, nunca se ofrecen). */
const COMPANY_RUC = /^20\d{9}$/;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `pe_sunat_directory` acotada a lo que esta proyección usa. */
export type PeSunatDirectorySnapshotReadRow = {
  record_identity_key: string;
  ruc: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  ciiu4_code: string | null;
  activity_text: string | null;
  /** SOURCES-PE-MUNICIPAL-DOMAIN-1 — dominio oficial (RENAMU, sólo municipalidades). */
  website_domain?: string | null;
  employees: number | null;
  metrics_year: number | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type PeSunatDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly PeSunatDirectorySnapshotReadRow[]>;
};

function toCompany(row: PeSunatDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const ruc = row.ruc?.trim() ?? '';
  if (legalName === null || !COMPANY_RUC.test(ruc)) return null;
  if (row.employees === null || row.employees < PE_SUNAT_DIRECTORY_DISCOVERY_MIN_WORKERS) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolvePeActivityMacro(row.ciiu4_code) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: ruc,
    taxIdentifierType: 'RUC',
    countryCode: 'PE',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // 🔴 SUNAT no publica web. Sólo las municipalidades traen la del RENAMU del INEI
    // (SOURCES-PE-MUNICIPAL-DOMAIN-1); el resto llega sin dominio: no se fabrica.
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: row.activity_text?.trim() || null,
    industryCode: row.ciiu4_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: PE_SUNAT_MACRO_TABLE_VERSION,
    },
    // SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 — los trabajadores del padrón SUNAT van a
    // la ficha (antes quedaban «por validar» aunque la fuente los publica).
    officialWorkforce: buildCountrySourceOfficialWorkforce(row.employees, row.metrics_year, 'SUNAT'),
  };
}

/**
 * Construye el adapter de descubrimiento de Perú.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildPeSunatDirectoryDiscoveryAdapter(reads: PeSunatDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: PE_SUNAT_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin actividades clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasPeCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), PE_SUNAT_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({
      macroIndustryKey: criteria.macroIndustryKey,
      limit,
    });

    // Un RUC, una empresa: la primera fila válida gana (la lectura ya viene
    // ordenada por trabajadores).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: PE_SUNAT_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
