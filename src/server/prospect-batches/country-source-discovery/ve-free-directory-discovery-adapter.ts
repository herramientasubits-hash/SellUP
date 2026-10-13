/**
 * ve-free-directory-discovery-adapter.ts — descubrimiento gratuito de Venezuela
 * sobre el directorio (`ve_free_directory` y `ve_free_directory_web`). PROYECCIÓN DE
 * SÓLO LECTURA.
 *
 * SOURCES-VE-CLOSE-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga (`scripts/source-catalog/run-ve-sources-etl.ts`):
 * empresas que cotizan o emiten valores (Bolsa de Caracas, SUNAVAL), reguladas por la
 * SUDEASEG, casas de bolsa, empresas y universidades con web propia comprobada y
 * entes públicos (Gobierno). Aquí sólo se piden las de la macro pedida, de más a
 * menos relevantes (cotizadas, aseguradoras y entes primero).
 *
 * Ninguna fuente venezolana alcanzable da el tamaño: la fila no trae tamaño oficial
 * y el filtro de tamaño decide con lo que traigan los demás pasos.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la clasificación de HOY
 * (`ve-free-directory-macro-table.ts`): el código de la fila se re-clasifica y sólo
 * se ofrece si coincide.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`VeFreeDirectoryDiscoveryReads`). Este módulo no construye
 * ningún cliente, no lee env, no escribe y no sale a la red.
 */

import { canonicalVenezuelaRif } from '@/server/source-catalog/connectors/ve-sources/ve-sources-input';
import {
  macroHasVeCoverage,
  resolveVeDirectoryMacro,
  resolveVeDirectoryRubro,
  VE_FREE_DIRECTORY_MACRO_TABLE_VERSION,
} from './ve-free-directory-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const VE_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY = 've_free_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const VE_FREE_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila del directorio acotada a lo que esta proyección usa. */
export type VeFreeDirectorySnapshotReadRow = {
  record_identity_key: string;
  rif: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  activity_code: string | null;
  public_entity_kind: string | null;
  website_domain: string | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type VeFreeDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: { macroIndustryKey: string; limit: number }) => Promise<readonly VeFreeDirectorySnapshotReadRow[]>;
};

/** Industria que ve el vendedor en la columna «Industria». */
function declaredIndustry(row: VeFreeDirectorySnapshotReadRow): string | null {
  if (row.directory_kind === 'public_entity') return resolveVeDirectoryRubro('public_entity', row.public_entity_kind) ?? 'Entidad pública';
  return resolveVeDirectoryRubro(row.directory_kind, row.activity_code);
}

function toCompany(row: VeFreeDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;
  // La clasificación de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveVeDirectoryMacro(row.directory_kind, row.activity_code) !== macroIndustryKey) return null;
  const rif = canonicalVenezuelaRif(row.rif);
  const domain = normalizeDomain(row.website_domain);
  // Sin RIF, la entidad sólo se identifica por su web.
  if (rif === null && domain === null) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: rif,
    taxIdentifierType: rif !== null ? 'RIF' : null,
    countryCode: 'VE',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // La web que publica la fuente o la web oficial comprobada. Sin web la empresa
    // va a Descartadas y el rescate la busca.
    domain,
    declaredIndustry: declaredIndustry(row),
    // Los códigos son claves internas (RIF, Q de Wikidata, categoría): no son CIIU.
    industryCode: null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: VE_FREE_DIRECTORY_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * Construye el adapter de descubrimiento de Venezuela.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildVeFreeDirectoryDiscoveryAdapter(reads: VeFreeDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: VE_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin fuente clasificada no consulta: nunca una muestra genérica.
    if (!macroHasVeCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), VE_FREE_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un RIF (o una web, sin RIF), una empresa: la primera fila válida gana.
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null) continue;
      const key = company.taxId ?? `domain:${company.domain}`;
      if (seen.has(key)) continue;
      seen.add(key);
      companies.push(company);
    }

    return { sourceKey: VE_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
