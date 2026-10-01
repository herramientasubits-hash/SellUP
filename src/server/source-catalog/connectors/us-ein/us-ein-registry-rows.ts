/**
 * us-ein-registry-rows.ts — filas MÍNIMAS de las dos fuentes oficiales gratuitas
 * de Estados Unidos que publican el EIN, para el EIN por nombre dentro de la
 * corrida del Agente 1.
 *
 * SOURCES-US-EIN-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj (la fecha de
 * corte de actividad llega como parámetro).
 *
 *   - SEC EDGAR (`us_sec_edgar_registry`): un JSON por registrante
 *     (submissions.zip). Entran sólo empresas OPERATIVAS con EIN, código SIC y al
 *     menos una presentación desde `activeSince`: así quedan fuera fondos,
 *     personas y sociedades inactivas.
 *   - IRS Exempt Organizations BMF (`us_irs_eo_registry`): organizaciones sin
 *     ánimo de lucro (universidades, hospitales, fundaciones). Entran sólo las de
 *     ingresos o recaudación ≥ `minRevenue` (USD), para no llenar la base con
 *     asociaciones pequeñas.
 *
 * El EIN se guarda como «36-0698440». No tiene dígito verificador: se exige que
 * tenga 9 dígitos y que no sea todo ceros.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeCompanyNameCore, US_LEGAL_FORMS } from '../../company-name-core';

export const US_SEC_EDGAR_REGISTRY_SOURCE_KEY = 'us_sec_edgar_registry' as const;
export const US_IRS_EO_REGISTRY_SOURCE_KEY = 'us_irs_eo_registry' as const;
export const US_COUNTRY_CODE = 'US' as const;

/** Ingresos mínimos (USD) de una organización del IRS para cargarla. */
export const US_IRS_EO_MIN_REVENUE_USD = 5_000_000;

type UsSourceKey = typeof US_SEC_EDGAR_REGISTRY_SOURCE_KEY | typeof US_IRS_EO_REGISTRY_SOURCE_KEY;

export type UsEinRegistryRow = {
  source_key: UsSourceKey;
  country_code: typeof US_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Núcleo del nombre estadounidense: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeUsCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, US_LEGAL_FORMS);
}

/** EIN crudo → «12-3456789», o `null` si no son 9 dígitos útiles. */
export function formatEin(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 9 || /^0+$/.test(digits)) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.replace(/\s+/g, ' ').trim() : null;
}

function buildRow(
  sourceKey: UsSourceKey,
  ein: string,
  legalName: string,
  rawData: Record<string, unknown>,
  params: { sourceYear: number; importedAt: string },
): UsEinRegistryRow | null {
  const core = normalizeUsCompanyCore(legalName);
  if (core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(ein);
  return {
    source_key: sourceKey,
    country_code: US_COUNTRY_CODE,
    source_year: params.sourceYear,
    tax_id: ein,
    normalized_tax_id: ein,
    legal_name: legalName,
    normalized_legal_name: core,
    raw_data: rawData,
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Registrante de la SEC (JSON de submissions) → fila, o `null`. */
export function buildUsSecRegistryRow(
  submission: Record<string, unknown>,
  params: { sourceYear: number; importedAt: string; activeSince: string },
): UsEinRegistryRow | null {
  if (submission['entityType'] !== 'operating') return null;
  const ein = formatEin(submission['ein']);
  const sic = text(submission['sic']);
  const legalName = text(submission['name']);
  if (ein === null || sic === null || legalName === null) return null;

  const filings = (submission['filings'] as { recent?: { filingDate?: unknown } } | undefined)?.recent?.filingDate;
  const dates = Array.isArray(filings) ? filings.filter((d): d is string => typeof d === 'string') : [];
  const lastFiling = dates.reduce<string | null>((max, d) => (max === null || d > max ? d : max), null);
  if (lastFiling === null || lastFiling < params.activeSince) return null;

  const business = (submission['addresses'] as { business?: { stateOrCountry?: unknown } } | undefined)?.business;
  return buildRow(
    US_SEC_EDGAR_REGISTRY_SOURCE_KEY,
    ein,
    legalName,
    {
      sic,
      sic_description: text(submission['sicDescription']),
      state: text(business?.stateOrCountry),
      cik: text(submission['cik']),
    },
    params,
  );
}

/** Registro del IRS EO BMF (CSV) → fila, o `null`. */
export function buildUsIrsEoRegistryRow(
  record: Record<string, string>,
  params: { sourceYear: number; importedAt: string; minRevenue?: number },
): UsEinRegistryRow | null {
  const ein = formatEin(record['EIN']);
  const legalName = text(record['NAME']);
  // El BMF a veces deja REVENUE_AMT en 0 con INCOME_AMT lleno (Harvard: 0 y el
  // tope 1.999.999.998): manda el mayor de los dos.
  const amount = (key: string) => {
    const value = Number((record[key] ?? '').trim() || '0');
    return Number.isFinite(value) ? value : 0;
  };
  const revenue = Math.max(amount('REVENUE_AMT'), amount('INCOME_AMT'));
  const minRevenue = params.minRevenue ?? US_IRS_EO_MIN_REVENUE_USD;
  if (ein === null || legalName === null || revenue < minRevenue) return null;
  return buildRow(
    US_IRS_EO_REGISTRY_SOURCE_KEY,
    ein,
    legalName,
    { ntee: text(record['NTEE_CD']), state: text(record['STATE']), city: text(record['CITY']) },
    params,
  );
}
