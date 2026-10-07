/**
 * py-dncp-directory-discovery-adapter.ts — descubrimiento gratuito de Paraguay
 * sobre las sociedades que el Estado contrató (DNCP). PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-PY-CLOSE-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas `py_dncp_directory` ya vienen filtradas en la carga
 * (`scripts/source-catalog/run-py-dncp-directory-etl.ts`): sociedades ACTIVAS del
 * padrón, sin consorcios ni personas físicas, sin las que declararon ser micro,
 * pequeña o mediana, y con una macro dominante por lo que venden al Estado. Aquí
 * sólo se piden las de la macro pedida, de más a menos entidades compradoras.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY
 * (`py-dncp-macro-table.ts`): la familia UNSPSC dominante se re-clasifica y sólo
 * se ofrece si coincide. Y el tamaño declarado se vuelve a comprobar.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`PyDncpDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  macroHasPyDncpCoverage,
  PY_DNCP_MACRO_TABLE_VERSION,
  resolvePyUnspscMacro,
} from './py-dncp-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const PY_DNCP_DIRECTORY_DISCOVERY_SOURCE_KEY = 'py_dncp_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const PY_DNCP_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

/** RUC de sociedad con dígito verificador. */
const COMPANY_RUC = /^80\d{6}-\d$/;

const SMALL_DECLARED_SIZES: ReadonlySet<string> = new Set(['MICRO', 'PEQUEÑA', 'PEQUENA', 'MEDIANA']);

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `py_dncp_directory` acotada a lo que esta proyección usa. */
export type PyDncpDirectorySnapshotReadRow = {
  record_identity_key: string;
  ruc: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  unspsc_family: string | null;
  activity_text: string | null;
  website_domain: string | null;
  declared_size: string | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type PyDncpDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly PyDncpDirectorySnapshotReadRow[]>;
};

function toCompany(row: PyDncpDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const ruc = row.ruc?.trim() ?? '';
  if (legalName === null || !COMPANY_RUC.test(ruc)) return null;
  if (SMALL_DECLARED_SIZES.has(row.declared_size?.trim().toUpperCase() ?? '')) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolvePyUnspscMacro(row.unspsc_family) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: ruc,
    taxIdentifierType: 'RUC',
    countryCode: 'PY',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // La web declarada a la DNCP, o el dominio de su correo corporativo. Sin web
    // la empresa va a Descartadas y el rescate con Claude la busca.
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: row.activity_text?.trim() || null,
    industryCode: row.unspsc_family?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: PY_DNCP_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * Construye el adapter de descubrimiento de Paraguay.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildPyDncpDirectoryDiscoveryAdapter(reads: PyDncpDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: PY_DNCP_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin clases clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasPyDncpCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), PY_DNCP_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un RUC, una empresa: la primera fila válida gana (la lectura ya viene ordenada).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: PY_DNCP_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
