/**
 * es-free-directory-discovery-adapter.ts — descubrimiento gratuito de España.
 * PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-ES-CLOSE-1.
 *
 * ── Qué ofrece ──────────────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga (`scripts/source-catalog/run-es-sources-etl.ts`):
 *
 *   - `es_free_directory`: sociedades con NIF de cuatro fuentes oficiales y
 *     gratuitas: entes públicos empresariales de INVENTE (CNAE, plantilla y web),
 *     bancos y financieras del Banco de España (web), «GRAN EMPRESA» de las ayudas
 *     de Estado de la BDNS (CNAE) y adjudicatarias con 1 M€ o más (CPV).
 *   - `es_public_entities`: entidades públicas con NIF (P, Q, S o ente público de
 *     INVENTE) y web que las nombra (sólo Gobierno).
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY
 * (`es-free-directory-macro-table.ts`): el código se re-clasifica y sólo se ofrece
 * si coincide. La relevancia también se vuelve a comprobar.
 *
 * ── Tamaño ──────────────────────────────────────────────────────────────────
 *
 * La plantilla de INVENTE viaja a la ficha como número oficial; «GRAN EMPRESA» de
 * la BDNS viaja como tramo «grande» (no decide solo).
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`EsFreeDirectoryDiscoveryReads`). Este módulo no construye
 * ningún cliente, no lee env, no escribe y no sale a la red.
 */

import { normalizeSpainCompanyNif } from '@/server/source-catalog/connectors/placsp-spain/es-placsp-registry-rows';
import { ES_BDNS_LARGE_SIZE_LABEL } from '@/server/source-catalog/connectors/placsp-spain/es-sources-rows';
import {
  ES_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  isEsDirectoryRelevant,
  macroHasEsCoverage,
  resolveEsDirectoryMacro,
  resolveEsDirectoryRubro,
} from './es-free-directory-macro-table';
import {
  buildCountrySourceOfficialWorkforce,
  type CountrySourceAdapter,
  type CountrySourceCompany,
  type CountrySourceCriteria,
  type CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const ES_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY = 'es_free_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const ES_FREE_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `es_free_directory` o `es_public_entities` acotada a lo que esta proyección usa. */
export type EsFreeDirectorySnapshotReadRow = {
  record_identity_key: string;
  nif: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  activity_code: string | null;
  website_domain: string | null;
  awarded_eur: number | null;
  workers: number | null;
  metrics_year: number | null;
  bdns_large_year: number | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type EsFreeDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly EsFreeDirectorySnapshotReadRow[]>;
};

/** Etiqueta de la plantilla de INVENTE en la ficha. */
export const ES_INVENTE_SIZE_LABEL = 'INVENTE (Hacienda)' as const;

function toCompany(row: EsFreeDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;
  // La clasificación de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveEsDirectoryMacro(row.directory_kind, row.activity_code) !== macroIndustryKey) return null;
  const nif = normalizeSpainCompanyNif(row.nif);
  if (nif === null) return null;
  const publicEntity = row.directory_kind === 'public_entity';
  const domain = normalizeDomain(row.website_domain);
  // Una entidad pública sólo se ofrece con su web; una empresa, si sigue siendo relevante.
  if (publicEntity && domain === null) return null;
  if (!isEsDirectoryRelevant({ kind: row.directory_kind, awardedEur: row.awarded_eur, workers: row.workers })) return null;

  const officialWorkforce = buildCountrySourceOfficialWorkforce(row.workers, row.metrics_year, ES_INVENTE_SIZE_LABEL);
  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: nif,
    taxIdentifierType: 'NIF',
    countryCode: 'ES',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // La web oficial (INVENTE, Banco de España, órgano de contratación). Sin web la
    // empresa va a Descartadas y el rescate con Claude la busca.
    domain,
    declaredIndustry: resolveEsDirectoryRubro(row.directory_kind, row.activity_code),
    industryCode: row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: ES_FREE_DIRECTORY_MACRO_TABLE_VERSION,
    },
    officialWorkforce,
    ...(officialWorkforce === null && row.bdns_large_year !== null
      ? { officialSizeBand: { band: 'large' as const, sourceLabel: ES_BDNS_LARGE_SIZE_LABEL } }
      : {}),
  };
}

/**
 * Construye el adapter de descubrimiento de España.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildEsFreeDirectoryDiscoveryAdapter(reads: EsFreeDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: ES_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin fuente clasificada no consulta: nunca una muestra genérica.
    if (!macroHasEsCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), ES_FREE_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un NIF, una empresa: la primera fila válida gana (la lectura ya viene ordenada).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null) continue;
      if (seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: ES_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
