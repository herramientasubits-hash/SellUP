/**
 * us-free-directory-discovery-adapter.ts — descubrimiento gratuito de Estados
 * Unidos sobre el directorio oficial `us_free_directory`. PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-US-CLOSE-1.
 *
 * ── Qué ofrece ──────────────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga (`scripts/source-catalog/run-us-free-directory-etl.ts`):
 *
 *   - organizaciones sin ánimo de lucro del IRS con ingresos ≥ US$ 25 M
 *     (universidades, hospitales…) clasificadas por su NTEE;
 *   - empresas cotizadas de la SEC «Large accelerated» o «Accelerated»,
 *     clasificadas por su SIC (sin cascarones ni titulizaciones);
 *   - universidades y colegios de IPEDS con 5.000+ estudiantes, con su web
 *     oficial (públicas → Gobierno, privadas → Servicios a empresas).
 *
 * Aquí sólo se piden las de la macro pedida, primero las más grandes.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY: el código
 * NTEE o SIC se re-clasifica y sólo se ofrece si coincide.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`UsFreeDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import {
  macroHasUsFreeDirectoryCoverage,
  resolveUsIpedsMacro,
  resolveUsIrsMacro,
  resolveUsSicMacro,
  US_FREE_DIRECTORY_MACRO_TABLE_VERSION,
} from './us-free-directory-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const US_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY = 'us_free_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const US_FREE_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const EIN = /^\d{2}-\d{7}$/;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `us_free_directory` acotada a lo que esta proyección usa. */
export type UsFreeDirectorySnapshotReadRow = {
  record_identity_key: string;
  ein: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  activity_system: string | null;
  activity_code: string | null;
  activity_text: string | null;
  size_band: string | null;
  size_source: string | null;
  website_domain: string | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type UsFreeDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly UsFreeDirectorySnapshotReadRow[]>;
};

/** Macro de HOY para la fila (re-clasifica el código guardado). */
function currentMacro(row: UsFreeDirectorySnapshotReadRow): string | null {
  if (row.directory_kind === 'sec') return resolveUsSicMacro(row.activity_code);
  if (row.directory_kind === 'ipeds') return resolveUsIpedsMacro(row.activity_code);
  if (row.directory_kind !== 'irs_eo') return null;
  // La subsección sólo se guarda para las cooperativas eléctricas sin NTEE.
  if (row.activity_system === 'IRS_SUBSECTION') {
    return resolveUsIrsMacro({ ntee: null, subsection: '12', legalName: row.legal_name });
  }
  return resolveUsIrsMacro({ ntee: row.activity_code, subsection: null, legalName: row.legal_name });
}

function toCompany(row: UsFreeDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const ein = EIN.test(row.ein?.trim() ?? '') ? row.ein!.trim() : null;
  if (legalName === null || ein === null) return null;
  if (currentMacro(row) !== macroIndustryKey) return null;
  const sizeSource = row.size_source?.trim() || null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: ein,
    taxIdentifierType: 'EIN',
    countryCode: 'US',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // Sólo IPEDS publica la web; sin web la empresa va a Descartadas y el rescate
    // con Claude la busca.
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: row.activity_text?.trim() || null,
    industryCode: row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: US_FREE_DIRECTORY_MACRO_TABLE_VERSION,
    },
    // Ninguna fuente da empleados: sólo «grande» (ingresos ≥ US$ 100 M, emisor
    // «Large accelerated» o 10.000+ estudiantes), que nunca decide solo.
    officialWorkforce: null,
    officialSizeBand:
      row.size_band === 'large' && sizeSource !== null ? { band: 'large', sourceLabel: sizeSource } : null,
  };
}

/**
 * Construye el adapter de descubrimiento de Estados Unidos.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildUsFreeDirectoryDiscoveryAdapter(reads: UsFreeDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: US_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin códigos clasificados no consulta: nunca una muestra genérica.
    if (!macroHasUsFreeDirectoryCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), US_FREE_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un EIN, una empresa: la primera fila válida gana (la lectura ya viene ordenada).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || seen.has(company.taxId!)) continue;
      seen.add(company.taxId!);
      companies.push(company);
    }

    return { sourceKey: US_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
