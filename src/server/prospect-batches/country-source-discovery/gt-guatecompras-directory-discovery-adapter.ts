/**
 * gt-guatecompras-directory-discovery-adapter.ts — descubrimiento gratuito de
 * Guatemala sobre las sociedades a las que el Estado adjudicó (Guatecompras).
 * PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-GT-CLOSE-1.
 *
 * ── Qué empresas ofrece ─────────────────────────────────────────────────────
 *
 * Las filas `gt_guatecompras_directory` ya vienen filtradas en la carga
 * (`scripts/source-catalog/run-gt-sources-etl.ts`): sociedades (nunca personas
 * individuales, copropiedades ni consorcios) con adjudicaciones en 2023-2026, una
 * macro dominante por lo que venden al Estado, y relevantes (agentes de retención
 * del IVA o al menos Q5 millones adjudicados). Aquí sólo se piden las de la macro
 * pedida, primero los agentes del IVA y luego las que venden a más entidades.
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY
 * (`gt-guatecompras-macro-table.ts`): la familia UNSPSC dominante se re-clasifica y
 * sólo se ofrece si coincide. La relevancia también se vuelve a comprobar.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`GtGuatecomprasDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import { canonicalGuatemalaNit } from '@/server/source-catalog/connectors/gt-guatecompras/gt-nit';
import {
  GT_GUATECOMPRAS_MACRO_TABLE_VERSION,
  isGtGuatecomprasRelevant,
  macroHasGtGuatecomprasCoverage,
  resolveGtUnspscMacro,
  resolveGtUnspscRubro,
} from './gt-guatecompras-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY = 'gt_guatecompras_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `gt_guatecompras_directory` acotada a lo que esta proyección usa. */
export type GtGuatecomprasDirectorySnapshotReadRow = {
  record_identity_key: string;
  nit: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  unspsc_family: string | null;
  activity_text: string | null;
  website_domain: string | null;
  sat_iva_agent: boolean;
  awarded_gtq: number | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type GtGuatecomprasDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly GtGuatecomprasDirectorySnapshotReadRow[]>;
};

function toCompany(row: GtGuatecomprasDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  const nit = canonicalGuatemalaNit(row.nit);
  if (legalName === null || nit === null) return null;
  if (!isGtGuatecomprasRelevant({ satIvaAgent: row.sat_iva_agent, awardedGtq: row.awarded_gtq ?? 0 })) return null;
  // La tabla de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveGtUnspscMacro(row.unspsc_family) !== macroIndustryKey) return null;

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: nit,
    taxIdentifierType: 'NIT',
    countryCode: 'GT',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // El dominio de su correo corporativo en Guatecompras. Sin web la empresa va a
    // Descartadas y el rescate con Claude la busca.
    domain: normalizeDomain(row.website_domain),
    // El rubro (familia UNSPSC en palabras), no el artículo suelto.
    declaredIndustry: resolveGtUnspscRubro(row.unspsc_family) ?? (row.activity_text?.trim() || null),
    industryCode: row.unspsc_family?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: GT_GUATECOMPRAS_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * Construye el adapter de descubrimiento de Guatemala.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildGtGuatecomprasDirectoryDiscoveryAdapter(
  reads: GtGuatecomprasDirectoryDiscoveryReads,
): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin clases clasificadas no consulta: nunca una muestra genérica.
    if (!macroHasGtGuatecomprasCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un NIT, una empresa: la primera fila válida gana (la lectura ya viene ordenada).
    const seen = new Set<string>();
    const companies: CountrySourceCompany[] = [];
    for (const row of rows) {
      const company = toCompany(row, criteria.macroIndustryKey);
      if (company === null || company.taxId === null || seen.has(company.taxId)) continue;
      seen.add(company.taxId);
      companies.push(company);
    }

    return { sourceKey: GT_GUATECOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
