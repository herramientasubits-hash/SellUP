/**
 * ni-free-directory-discovery-adapter.ts — descubrimiento gratuito de Nicaragua
 * sobre el directorio oficial (`ni_free_directory` y `ni_free_directory_web`).
 * PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-NI-CLOSE-2.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga (`scripts/source-catalog/run-ni-sources-etl.ts`):
 * Grandes Contribuyentes de la DGI (tabla revisada), empresas con una licencia
 * sanitaria vigente del MINSA, empresas del Directorio Industrial de Zonas Francas,
 * microfinancieras de la CONAMI y entidades públicas con web (Gobierno). Aquí sólo
 * se piden las de la macro pedida, de más a menos relevantes (Grandes
 * Contribuyentes y entidades primero, después Zona Franca y las que tienen más
 * licencias vigentes).
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la clasificación de HOY
 * (`ni-free-directory-macro-table.ts`): el código de la fila se re-clasifica y sólo
 * se ofrece si coincide.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`NiFreeDirectoryDiscoveryReads`). Este módulo no construye
 * ningún cliente, no lee env, no escribe y no sale a la red.
 */

import { canonicalNicaraguaRuc } from '@/server/source-catalog/connectors/ni-sources/ni-sources-rows';
import { NI_PUBLIC_ENTITY_KIND_LABEL, type NiPublicEntityKind } from '@/server/source-catalog/connectors/ni-sources/ni-public-entities';
import {
  macroHasNiCoverage,
  NI_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  resolveNiDirectoryMacro,
  resolveNiDirectoryRubro,
} from './ni-free-directory-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const NI_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY = 'ni_free_directory_discovery' as const;

/** Etiqueta corta del tamaño oficial «grande» de Nicaragua para la ficha. */
export const NI_LARGE_TAXPAYER_SIZE_LABEL = 'DGI – Grandes Contribuyentes (2019-2020)' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const NI_FREE_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila del directorio acotada a lo que esta proyección usa. */
export type NiFreeDirectorySnapshotReadRow = {
  record_identity_key: string;
  ruc: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  activity_code: string | null;
  public_entity_kind: string | null;
  website_domain: string | null;
  /** «large» si el RUC está en la lista de Grandes Contribuyentes de la DGI. */
  official_size_band: string | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type NiFreeDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: { macroIndustryKey: string; limit: number }) => Promise<readonly NiFreeDirectorySnapshotReadRow[]>;
};

/** Industria que ve el vendedor en la columna «Industria». */
function declaredIndustry(row: NiFreeDirectorySnapshotReadRow): string | null {
  if (row.directory_kind === 'public_entity') {
    return NI_PUBLIC_ENTITY_KIND_LABEL[row.public_entity_kind as NiPublicEntityKind] ?? 'Entidad pública';
  }
  return resolveNiDirectoryRubro(row.directory_kind, row.activity_code);
}

function toCompany(row: NiFreeDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;
  // La clasificación de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveNiDirectoryMacro(row.directory_kind, row.activity_code) !== macroIndustryKey) return null;
  const ruc = canonicalNicaraguaRuc(row.ruc);
  const domain = normalizeDomain(row.website_domain);
  // Sin RUC, la entidad sólo se identifica por su web.
  if (ruc === null && domain === null) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: ruc,
    taxIdentifierType: ruc !== null ? 'RUC' : null,
    countryCode: 'NI',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // La web que publica la fuente o el dominio del correo corporativo (Zona Franca).
    // Sin web la empresa va a Descartadas y el rescate la busca.
    domain,
    declaredIndustry: declaredIndustry(row),
    industryCode: row.directory_kind === 'large_taxpayer' ? null : row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: NI_FREE_DIRECTORY_MACRO_TABLE_VERSION,
    },
    // Tamaño oficial «grande»: está en la lista de Grandes Contribuyentes de la DGI.
    ...(row.official_size_band === 'large'
      ? { officialSizeBand: { band: 'large' as const, sourceLabel: NI_LARGE_TAXPAYER_SIZE_LABEL } }
      : {}),
  };
}

/**
 * Construye el adapter de descubrimiento de Nicaragua.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildNiFreeDirectoryDiscoveryAdapter(reads: NiFreeDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: NI_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin fuente clasificada no consulta: nunca una muestra genérica.
    if (!macroHasNiCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), NI_FREE_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un RUC (o una web, sin RUC), una empresa: la primera fila válida gana.
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

    return { sourceKey: NI_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
