/**
 * pa-free-directory-discovery-adapter.ts — descubrimiento gratuito de Panamá sobre
 * el directorio oficial (`pa_free_directory`). PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-PA-CLOSE-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga
 * (`scripts/source-catalog/run-pa-sources-etl.ts`): sociedades a las que el Estado
 * adjudicó al menos B/.1 millón en 2022-2026 (con lo que venden clasificado por
 * UNSPSC), Grandes Contribuyentes de la DGI (clasificados en una tabla revisada por
 * la dueña) y entidades compradoras con RUC (Gobierno). Aquí sólo se piden las de
 * la macro pedida, de más a menos relevantes (Grandes Contribuyentes y entidades
 * primero, después las que venden a más entidades).
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la clasificación de HOY
 * (`pa-free-directory-macro-table.ts`): el código de la fila se re-clasifica y sólo
 * se ofrece si coincide.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`PaFreeDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import { canonicalPanamaRuc } from '@/server/source-catalog/connectors/panamacompra-pa/pa-ruc';
import {
  macroHasPaCoverage,
  PA_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  resolvePaDirectoryMacro,
  resolvePaUnspscRubro,
} from './pa-free-directory-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const PA_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY = 'pa_free_directory_discovery' as const;

/** Etiqueta corta del tamaño oficial «grande» de Panamá para la ficha. */
export const PA_LARGE_TAXPAYER_SIZE_LABEL = 'DGI – Grandes Contribuyentes' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const PA_FREE_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `pa_free_directory` acotada a lo que esta proyección usa. */
export type PaFreeDirectorySnapshotReadRow = {
  record_identity_key: string;
  ruc: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  activity_code: string | null;
  public_entity_area: string | null;
  website_domain: string | null;
  /** «large» si el RUC está en la lista de Grandes Contribuyentes de la DGI. */
  official_size_band: string | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type PaFreeDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly PaFreeDirectorySnapshotReadRow[]>;
};

/** Industria que ve el vendedor en la columna «Industria». */
function declaredIndustry(row: PaFreeDirectorySnapshotReadRow): string | null {
  if (row.directory_kind === 'panamacompra_supplier') return resolvePaUnspscRubro(row.activity_code);
  if (row.directory_kind === 'public_entity') return row.public_entity_area?.trim() || 'Entidad pública';
  return null;
}

function toCompany(row: PaFreeDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const ruc = canonicalPanamaRuc(row.ruc);
  if (legalName === null || ruc === null) return null;
  // La clasificación de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolvePaDirectoryMacro(row.directory_kind, row.activity_code) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: ruc,
    taxIdentifierType: 'RUC',
    countryCode: 'PA',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // El dominio del correo corporativo registrado en PanamaCompra. Sin web la
    // empresa va a Descartadas y el rescate con Claude la busca.
    domain: normalizeDomain(row.website_domain),
    declaredIndustry: declaredIndustry(row),
    industryCode: row.directory_kind === 'panamacompra_supplier' ? row.activity_code?.trim() || null : null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: PA_FREE_DIRECTORY_MACRO_TABLE_VERSION,
    },
    // Tamaño oficial «grande»: está en la lista de Grandes Contribuyentes de la DGI
    // (aprobado por la dueña el 07-10-2026). El rescate lo usa para admitir sin web
    // a una filial de multinacional.
    ...(row.official_size_band === 'large'
      ? { officialSizeBand: { band: 'large' as const, sourceLabel: PA_LARGE_TAXPAYER_SIZE_LABEL } }
      : {}),
  };
}

/**
 * Construye el adapter de descubrimiento de Panamá.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildPaFreeDirectoryDiscoveryAdapter(reads: PaFreeDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: PA_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin fuente clasificada no consulta: nunca una muestra genérica.
    if (!macroHasPaCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), PA_FREE_DIRECTORY_DISCOVERY_MAX_ROWS));
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

    return { sourceKey: PA_FREE_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
