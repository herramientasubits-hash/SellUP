/**
 * cr-free-directory-discovery-adapter.ts — descubrimiento gratuito de Costa Rica
 * sobre el directorio oficial (`cr_free_directory`). PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-CR-CLOSE-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga
 * (`scripts/source-catalog/run-cr-company-registry-etl.ts`): proveedoras del
 * Estado (SICOP 2022-2024) con nombre en el registro, empresas en Zona Franca
 * (PROCOMER) y entidades públicas; sin las que el MEIC registra como micro o
 * pequeña y con una macro dominante. Aquí sólo se piden las de la macro pedida,
 * de más a menos relevantes (Zona Franca y entidades públicas primero, después
 * las proveedoras que abastecen a más instituciones).
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la clasificación de HOY
 * (`cr-free-directory-macro-table.ts`): el código de la fila se re-clasifica y
 * sólo se ofrece si coincide. Y el tramo del MEIC se vuelve a comprobar.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`CrFreeDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  CR_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  macroHasCrCoverage,
  resolveCrDirectoryMacro,
  resolveCrSicopRubro,
} from './cr-free-directory-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const CR_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY = 'cr_free_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const CR_FREE_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

/** Cédula jurídica de sociedad o de ente público. */
const JURIDICAL_CEDULA = /^[234]\d{9}$/;

const SMALL_MEIC_SIZES: ReadonlySet<string> = new Set(['MICRO', 'PEQUEÑA', 'PEQUENA']);

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `cr_free_directory` acotada a lo que esta proyección usa. */
export type CrFreeDirectorySnapshotReadRow = {
  record_identity_key: string;
  cedula: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  activity_code: string | null;
  activity_text: string | null;
  website_domain: string | null;
  meic_size: string | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type CrFreeDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly CrFreeDirectorySnapshotReadRow[]>;
};

/** Industria que ve el vendedor en la columna «Industria». */
function declaredIndustry(row: CrFreeDirectorySnapshotReadRow): string | null {
  if (row.directory_kind === 'sicop_supplier') {
    return resolveCrSicopRubro(row.activity_code) ?? (row.activity_text?.trim() || null);
  }
  return row.activity_text?.trim() || null;
}

function toCompany(row: CrFreeDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const cedula = row.cedula?.trim() ?? '';
  if (legalName === null || !JURIDICAL_CEDULA.test(cedula)) return null;
  if (SMALL_MEIC_SIZES.has(row.meic_size?.trim().toUpperCase() ?? '')) return null;
  // La clasificación de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveCrDirectoryMacro(row.directory_kind, row.activity_code) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: cedula,
    taxIdentifierType: 'cedula_juridica',
    countryCode: 'CR',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // Sólo las entidades públicas traen web (ficha de MIDEPLAN). Sin web la empresa
    // va a Descartadas y el rescate con Claude la busca.
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: declaredIndustry(row),
    industryCode: row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: CR_FREE_DIRECTORY_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * Construye el adapter de descubrimiento de Costa Rica.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildCrFreeDirectoryDiscoveryAdapter(reads: CrFreeDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: CR_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin fuente clasificada no consulta: nunca una muestra genérica.
    if (!macroHasCrCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), CR_FREE_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Una cédula, una empresa: la primera fila válida gana (la lectura ya viene ordenada).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: CR_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
