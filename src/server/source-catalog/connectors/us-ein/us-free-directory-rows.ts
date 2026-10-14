/**
 * us-free-directory-rows.ts — filas del buscador gratuito de Estados Unidos
 * (`us_free_directory`): un EIN, una fila.
 *
 * SOURCES-US-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj (la fecha de
 * corte llega como parámetro).
 *
 *   - IRS EO BMF: organizaciones sin ánimo de lucro con ingresos ≥ US$ 25 M y una
 *     macro según su NTEE (`us-free-directory-macro-table.ts`).
 *   - SEC EDGAR: empresas operativas con EIN, presentación reciente y categoría de
 *     emisor «Large accelerated» o «Accelerated» (capitalización flotante ≥ US$ 75 M;
 *     las «Large accelerated», ≥ US$ 700 M, se marcan como grandes). La SEC no
 *     publica ingresos ni empleados: la categoría es el único tamaño oficial.
 *
 * Ninguna de las dos publica la web (medido el 14-10-2026: 0 de 6.314 en la SEC);
 * `website_domain` queda vacío salvo que otra fuente oficial la aporte.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  resolveUsIrsMacro,
  resolveUsSicMacro,
  US_IRS_DISCOVERY_MIN_REVENUE_USD,
} from '@/server/prospect-batches/country-source-discovery/us-free-directory-macro-table';
import { formatEin, normalizeUsCompanyCore, US_COUNTRY_CODE } from './us-ein-registry-rows';

export const US_FREE_DIRECTORY_SOURCE_KEY = 'us_free_directory' as const;

/** Ingresos (USD) desde los que una organización del IRS cuenta como grande. */
export const US_IRS_LARGE_REVENUE_USD = 100_000_000;

/** Grupo mayor NTEE → texto de la actividad en la ficha. */
const NTEE_MAJOR_TEXT: Readonly<Record<string, string>> = Object.freeze({
  B: 'Educación',
  C: 'Medio ambiente',
  E: 'Salud',
  F: 'Salud mental',
  G: 'Enfermedades y trastornos',
  H: 'Investigación médica',
  J: 'Empleo',
  K: 'Alimentos y agricultura',
  L: 'Vivienda',
  P: 'Servicios humanos',
  S: 'Desarrollo comunitario',
  W: 'Bienestar público',
});

export type UsFreeDirectoryKind = 'irs_eo' | 'sec';

export type UsFreeDirectoryRow = {
  source_key: typeof US_FREE_DIRECTORY_SOURCE_KEY;
  country_code: typeof US_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  city: string | null;
  region: string | null;
  priority_score: number;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.replace(/\s+/g, ' ').trim() : null;
}

function amount(record: Record<string, string>, key: string): number {
  const value = Number((record[key] ?? '').trim() || '0');
  return Number.isFinite(value) ? value : 0;
}

function buildRow(input: {
  ein: string;
  legalName: string;
  city: string | null;
  region: string | null;
  priority: number;
  rawData: Record<string, unknown>;
  sourceYear: number;
  importedAt: string;
}): UsFreeDirectoryRow | null {
  const core = normalizeUsCompanyCore(input.legalName);
  if (core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(input.ein);
  return {
    source_key: US_FREE_DIRECTORY_SOURCE_KEY,
    country_code: US_COUNTRY_CODE,
    source_year: input.sourceYear,
    tax_id: input.ein,
    normalized_tax_id: input.ein,
    legal_name: input.legalName,
    normalized_legal_name: core,
    city: input.city,
    region: input.region,
    priority_score: input.priority,
    raw_data: input.rawData,
    imported_at: input.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Registro del IRS EO BMF (CSV) → fila del buscador, o `null` si no se ofrece. */
export function buildUsIrsDirectoryRow(
  record: Record<string, string>,
  params: { sourceYear: number; importedAt: string },
): UsFreeDirectoryRow | null {
  const ein = formatEin(record['EIN']);
  const legalName = text(record['NAME']);
  if (ein === null || legalName === null) return null;
  // Mismo criterio que el registro: manda el mayor de ingresos y recaudación.
  const revenue = Math.max(amount(record, 'REVENUE_AMT'), amount(record, 'INCOME_AMT'));
  if (revenue < US_IRS_DISCOVERY_MIN_REVENUE_USD) return null;
  const ntee = text(record['NTEE_CD'])?.toUpperCase() ?? null;
  const subsection = text(record['SUBSECTION']);
  const macro = resolveUsIrsMacro({ ntee, subsection, legalName });
  if (macro === null) return null;
  const major = ntee?.charAt(0) ?? '';
  return buildRow({
    ein,
    legalName,
    city: text(record['CITY']),
    region: text(record['STATE']),
    // Relevancia = ingresos en millones (las grandes primero).
    priority: Math.round(revenue / 1_000_000),
    rawData: {
      directory_kind: 'irs_eo' satisfies UsFreeDirectoryKind,
      macro_industry_key: macro,
      activity_system: ntee ? 'NTEE' : 'IRS_SUBSECTION',
      activity_code: ntee ?? `501(c)(${Number(subsection)})`,
      activity_text: NTEE_MAJOR_TEXT[major] ?? (ntee ? null : 'Cooperativa eléctrica'),
      revenue_usd: revenue,
      size_band: revenue >= US_IRS_LARGE_REVENUE_USD ? 'large' : null,
      size_source: 'IRS – ingresos declarados',
      website_domain: null,
    },
    sourceYear: params.sourceYear,
    importedAt: params.importedAt,
  });
}

/** Categoría de emisor de la SEC → `large` | `accelerated` | `null` (las pequeñas no entran). */
export function classifySecFilerCategory(category: unknown): 'large' | 'accelerated' | null {
  const value = typeof category === 'string' ? category.toLowerCase() : '';
  if (value.includes('large accelerated')) return 'large';
  if (value.includes('smaller reporting') || value.includes('non-accelerated')) return null;
  return value.includes('accelerated filer') ? 'accelerated' : null;
}

/** Registrante de la SEC (JSON de submissions) → fila del buscador, o `null`. */
export function buildUsSecDirectoryRow(
  submission: Record<string, unknown>,
  params: { sourceYear: number; importedAt: string; activeSince: string },
): UsFreeDirectoryRow | null {
  if (submission['entityType'] !== 'operating') return null;
  const ein = formatEin(submission['ein']);
  const legalName = text(submission['name']);
  const sic = text(submission['sic']);
  if (ein === null || legalName === null || sic === null) return null;
  const tier = classifySecFilerCategory(submission['category']);
  if (tier === null) return null;
  const macro = resolveUsSicMacro(sic);
  if (macro === null) return null;

  const filings = (submission['filings'] as { recent?: { filingDate?: unknown } } | undefined)?.recent?.filingDate;
  const dates = Array.isArray(filings) ? filings.filter((d): d is string => typeof d === 'string') : [];
  const lastFiling = dates.reduce<string | null>((max, d) => (max === null || d > max ? d : max), null);
  if (lastFiling === null || lastFiling < params.activeSince) return null;

  const business = (submission['addresses'] as { business?: Record<string, unknown> } | undefined)?.business;
  const state = text(business?.['stateOrCountry']);
  // Sede fuera de EE. UU. (código de país de la SEC con dígito): no es empresa del país.
  if (state === null || !/^[A-Z]{2}$/.test(state)) return null;
  return buildRow({
    ein,
    legalName,
    city: text(business?.['city']),
    region: state,
    // Sin ingresos publicados: las «Large accelerated» delante (≈ US$ 1.000 M).
    priority: tier === 'large' ? 1000 : 100,
    rawData: {
      directory_kind: 'sec' satisfies UsFreeDirectoryKind,
      macro_industry_key: macro,
      activity_system: 'SIC',
      activity_code: sic,
      activity_text: text(submission['sicDescription']),
      filer_category: text(submission['category'])?.replace(/<br>/g, ' · ') ?? null,
      size_band: tier === 'large' ? 'large' : null,
      size_source: 'SEC – Large accelerated filer',
      cik: text(submission['cik']),
      website_domain: null,
    },
    sourceYear: params.sourceYear,
    importedAt: params.importedAt,
  });
}
