/**
 * sv-comprasal-directory-discovery-adapter.ts — descubrimiento gratuito de El Salvador
 * sobre quienes venden al Estado (COMPRASAL) y las instituciones públicas vigentes.
 * PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-SV-CLOSE-1.
 *
 * ── Qué ofrece ──────────────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga (`scripts/source-catalog/run-sv-sources-etl.ts`):
 *
 *   - `sv_comprasal_directory`: proveedoras de COMPRASAL (2025-2026) empatadas a UN
 *     solo NIT del registro de Hacienda, sin consorcios, con al menos US$ 50.000
 *     adjudicados y una macro dominante por las palabras de sus procesos. Sin web:
 *     COMPRASAL no publica correos (el rescate con Claude la busca).
 *   - `sv_large_taxpayer_directory`: Grandes Contribuyentes de la DGII (2019) que no
 *     venden al Estado, con la industria de la tabla por NIT revisada por la dueña
 *     (SOURCES-SV-LARGE-TAXPAYERS-1); van detrás de las proveedoras de su macro.
 *   - `sv_public_entities`: instituciones vigentes (Portal de Transparencia o
 *     compradoras de COMPRASAL) con web que las nombra y/o NIT de Hacienda; sólo
 *     Gobierno.
 *
 * Aquí sólo se piden las de la macro pedida, primero las que venden a más
 * instituciones (o, en Gobierno, ministerios y organismos nacionales primero).
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY
 * (`sv-comprasal-macro-table.ts`): la regla dominante se re-clasifica y sólo se
 * ofrece si coincide. La relevancia también se vuelve a comprobar.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`SvComprasalDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import { normalizeSalvadoranNit } from '@/server/source-catalog/connectors/sv-official-sources/sv-nit';
import {
  isSvComprasalRelevant,
  macroHasSvCoverage,
  resolveSvDirectoryMacro,
  resolveSvProcessRuleLabel,
  SV_COMPRASAL_MACRO_TABLE_VERSION,
} from './sv-comprasal-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const SV_COMPRASAL_DIRECTORY_DISCOVERY_SOURCE_KEY = 'sv_comprasal_directory_discovery' as const;

/** Lo que el vendedor ve en «Industria» para un Gran Contribuyente (la macro va aparte). */
export const SV_LARGE_TAXPAYER_DECLARED_INDUSTRY = 'Gran contribuyente (Hacienda)' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const SV_COMPRASAL_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `sv_comprasal_directory` o `sv_public_entities` acotada a lo que esta proyección usa. */
export type SvComprasalDirectorySnapshotReadRow = {
  record_identity_key: string;
  nit: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  activity_code: string | null;
  website_domain: string | null;
  awarded_usd: number | null;
  last_award_year: number | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type SvComprasalDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly SvComprasalDirectorySnapshotReadRow[]>;
};

function toCompany(row: SvComprasalDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;
  // La clasificación de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveSvDirectoryMacro(row.directory_kind, row.activity_code) !== macroIndustryKey) return null;
  const nit = normalizeSalvadoranNit(row.nit);
  const publicEntity = row.directory_kind === 'public_entity';
  const largeTaxpayer = row.directory_kind === 'large_taxpayer';
  const domain = normalizeDomain(row.website_domain);
  if (publicEntity) {
    // La institución se identifica por su web o por su NIT de Hacienda.
    if (domain === null && nit === null) return null;
  } else if (largeTaxpayer) {
    // SOURCES-SV-LARGE-TAXPAYERS-1 — Gran Contribuyente: su NIT basta (no vende al
    // Estado, no hay monto que comprobar).
    if (nit === null) return null;
  } else {
    if (nit === null) return null;
    if (!isSvComprasalRelevant({ awardedUsd: row.awarded_usd ?? 0, lastYear: row.last_award_year })) return null;
  }

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: nit,
    taxIdentifierType: nit !== null ? 'NIT' : null,
    countryCode: 'SV',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // Sólo las instituciones traen web (la de Transparencia). Sin web la empresa va a
    // Descartadas y el rescate con Claude la busca.
    domain,
    declaredIndustry: publicEntity
      ? 'Entidad pública'
      : largeTaxpayer
        ? SV_LARGE_TAXPAYER_DECLARED_INDUSTRY
        : resolveSvProcessRuleLabel(row.activity_code),
    industryCode: publicEntity || largeTaxpayer ? null : row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: SV_COMPRASAL_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * Construye el adapter de descubrimiento de El Salvador.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildSvComprasalDirectoryDiscoveryAdapter(reads: SvComprasalDirectoryDiscoveryReads): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: SV_COMPRASAL_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin fuente clasificada no consulta: nunca una muestra genérica.
    if (!macroHasSvCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), SV_COMPRASAL_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un NIT (o una web, para las instituciones sin NIT), una empresa: la primera fila
    // válida gana (la lectura ya viene ordenada).
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

    return { sourceKey: SV_COMPRASAL_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
