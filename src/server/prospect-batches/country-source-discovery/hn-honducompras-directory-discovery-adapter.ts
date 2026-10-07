/**
 * hn-honducompras-directory-discovery-adapter.ts — descubrimiento gratuito de
 * Honduras sobre quienes venden al Estado (ONCAE / HonduCompras y SEFIN / SIAFI) y
 * las entidades públicas compradoras. PROYECCIÓN DE SÓLO LECTURA.
 *
 * SOURCES-HN-CLOSE-1.
 *
 * ── Qué ofrece ──────────────────────────────────────────────────────────────
 *
 * Las filas ya vienen filtradas en la carga (`scripts/source-catalog/run-hn-sources-etl.ts`):
 *
 *   - `hn_honducompras_directory`: personas jurídicas con RTN, sin consorcios, sin
 *     la marca «*MIPYME*», con actividad desde 2022, al menos L 5 millones
 *     adjudicados y una macro dominante (UNSPSC o, si no hay artículos, objeto del
 *     gasto de SIAFI).
 *   - `hn_public_entities`: entidades compradoras de ONCAE con web (sólo Gobierno).
 *     ONCAE no publica su RTN: sólo lo llevan las que también venden al Estado.
 *
 * Aquí sólo se piden las de la macro pedida, primero las que venden a más
 * entidades (o, en Gobierno, secretarías y organismos nacionales primero).
 *
 * ── Doble comprobación ──────────────────────────────────────────────────────
 *
 * La macro se guardó en la fila al cargar, pero manda la tabla de HOY
 * (`hn-honducompras-macro-table.ts`): el código dominante se re-clasifica y sólo se
 * ofrece si coincide. La relevancia también se vuelve a comprobar.
 *
 * ── E/S ─────────────────────────────────────────────────────────────────────
 *
 * La lectura se INYECTA (`HnHonducomprasDirectoryDiscoveryReads`). Este módulo no
 * construye ningún cliente, no lee env, no escribe y no sale a la red.
 */

import { normalizeHondurasJuridicalRtn } from '@/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-rtn-registry-rows';
import {
  HN_HONDUCOMPRAS_MACRO_TABLE_VERSION,
  isHnHonducomprasRelevant,
  macroHasHnHonducomprasCoverage,
  resolveHnDirectoryMacro,
  resolveHnDirectoryRubro,
} from './hn-honducompras-macro-table';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
  CountrySourceCriteria,
  CountrySourceDiscoveryResult,
} from './country-source-types';

/** `source_key` que esta proyección declara. */
export const HN_HONDUCOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY = 'hn_honducompras_directory_discovery' as const;

/** Techo de empresas devueltas por consulta (igual que el resto de países). */
export const HN_HONDUCOMPRAS_DIRECTORY_DISCOVERY_MAX_ROWS = 200;

const DOMAIN_SHAPE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase() ?? '';
  return DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** Fila `hn_honducompras_directory` o `hn_public_entities` acotada a lo que esta proyección usa. */
export type HnHonducomprasDirectorySnapshotReadRow = {
  record_identity_key: string;
  rtn: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  city: string | null;
  region: string | null;
  directory_kind: string | null;
  activity_code: string | null;
  website_domain: string | null;
  awarded_hnl: number | null;
  last_award_year: number | null;
  priority_score: number | null;
};

/** Lectura inyectada: sólo lectura, fail-soft (vacío si falla). */
export type HnHonducomprasDirectoryDiscoveryReads = {
  readCompaniesByMacro: (input: {
    macroIndustryKey: string;
    limit: number;
  }) => Promise<readonly HnHonducomprasDirectorySnapshotReadRow[]>;
};

function toCompany(row: HnHonducomprasDirectorySnapshotReadRow, macroIndustryKey: string): CountrySourceCompany | null {
  const legalName = row.legal_name?.trim() || null;
  if (legalName === null) return null;
  // La clasificación de HOY manda: la macro guardada al cargar sólo sirvió para filtrar.
  if (resolveHnDirectoryMacro(row.directory_kind, row.activity_code) !== macroIndustryKey) return null;
  const rtn = normalizeHondurasJuridicalRtn(row.rtn);
  const publicEntity = row.directory_kind === 'public_entity';
  const domain = normalizeDomain(row.website_domain);
  if (publicEntity) {
    // Sin RTN publicado, la entidad sólo se identifica por su web.
    if (domain === null) return null;
  } else {
    if (rtn === null) return null;
    if (!isHnHonducomprasRelevant({ awardedHnl: row.awarded_hnl ?? 0, lastYear: row.last_award_year, mipymeYear: null })) {
      return null;
    }
  }

  return {
    recordIdentityKey: row.record_identity_key,
    legalName,
    normalizedLegalName: row.normalized_legal_name?.trim() || null,
    taxId: rtn,
    taxIdentifierType: rtn !== null ? 'RTN' : null,
    countryCode: 'HN',
    city: row.city?.trim() || null,
    region: row.region?.trim() || null,
    // El dominio del correo corporativo (empresas) o la web que publica ONCAE
    // (entidades). Sin web la empresa va a Descartadas y el rescate con Claude la busca.
    domain,
    // El rubro (familia UNSPSC u objeto del gasto en palabras), no el artículo suelto.
    declaredIndustry: publicEntity ? 'Entidad pública' : resolveHnDirectoryRubro(row.directory_kind, row.activity_code),
    industryCode: row.activity_code?.trim() || null,
    coarseSector: null,
    officialMacroIndustry: {
      macroIndustryKeys: [macroIndustryKey],
      tableVersion: HN_HONDUCOMPRAS_MACRO_TABLE_VERSION,
    },
  };
}

/**
 * Construye el adapter de descubrimiento de Honduras.
 *
 * Devuelve SIEMPRE un resultado; los fallos los traduce el orquestador.
 */
export function buildHnHonducomprasDirectoryDiscoveryAdapter(
  reads: HnHonducomprasDirectoryDiscoveryReads,
): CountrySourceAdapter {
  return async (criteria: CountrySourceCriteria): Promise<CountrySourceDiscoveryResult> => {
    const empty = { sourceKey: HN_HONDUCOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY, companies: [], recordsRead: 0 };

    // Una macro sin fuente clasificada no consulta: nunca una muestra genérica.
    if (!macroHasHnHonducomprasCoverage(criteria.macroIndustryKey)) return empty;

    const limit = Math.max(0, Math.min(Math.trunc(criteria.limit), HN_HONDUCOMPRAS_DIRECTORY_DISCOVERY_MAX_ROWS));
    if (limit === 0) return empty;

    const rows = await reads.readCompaniesByMacro({ macroIndustryKey: criteria.macroIndustryKey, limit });

    // Un RTN (o una web, para las entidades sin RTN), una empresa: la primera fila
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

    return { sourceKey: HN_HONDUCOMPRAS_DIRECTORY_DISCOVERY_SOURCE_KEY, companies, recordsRead: rows.length };
  };
}
