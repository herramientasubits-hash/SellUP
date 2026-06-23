/**
 * SUNAT Peru Bulk Connector — Normalizers
 *
 * Helpers puros para normalizar registros SUNAT.
 * No dependen de fetch, Supabase, ni IO.
 */

import type {
  SunatBulkParsedRecord,
  SunatBulkNormalizedCompany,
  SunatBulkValidationWarning,
} from './types';

const COMPANY_RUC_PREFIXES = ['20'];
const NATURAL_PERSON_RUC_PREFIXES = ['10'];

export function normalizeRuc(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

export function isValidRuc(ruc: string): boolean {
  return /^\d{11}$/.test(ruc);
}

export function isLikelyCompanyRuc(ruc: string): boolean {
  const normalized = normalizeRuc(ruc);
  if (!isValidRuc(normalized)) return false;
  return COMPANY_RUC_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isNaturalPersonRuc(ruc: string): boolean {
  const normalized = normalizeRuc(ruc);
  if (!isValidRuc(normalized)) return false;
  return NATURAL_PERSON_RUC_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function normalizeLegalName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function deriveTaxpayerStatus(
  status: string,
): { isActiveTaxpayer: boolean; normalizedStatus?: string } {
  const upper = status.toUpperCase().trim();
  if (upper.includes('NO ACTIVO') || upper.includes('BAJA') || upper.includes('SUSPENSIÓN') || upper.includes('SUSPENSION')) {
    return { isActiveTaxpayer: false, normalizedStatus: upper };
  }
  if (upper.includes('ACTIVO')) {
    return { isActiveTaxpayer: true, normalizedStatus: 'ACTIVO' };
  }
  return { isActiveTaxpayer: false, normalizedStatus: upper };
}

export function normalizeSunatRecord(
  raw: SunatBulkParsedRecord,
): SunatBulkNormalizedCompany {
  const ruc = normalizeRuc(raw.ruc);
  const validRuc = isValidRuc(ruc);
  const legalName = raw.legalName ? normalizeLegalName(raw.legalName) : '';
  const exclusionReasons: SunatBulkValidationWarning[] = [];

  if (!validRuc) {
    exclusionReasons.push('invalid_ruc');
  }

  if (!raw.legalName || raw.legalName.trim() === '') {
    exclusionReasons.push('empty_legal_name');
  }

  let isLikelyCompany = false;
  if (validRuc) {
    isLikelyCompany = isLikelyCompanyRuc(ruc);
    if (!isLikelyCompany) {
      exclusionReasons.push('possible_natural_person');
    }
  }

  let isActiveTaxpayer: boolean | undefined;
  if (raw.taxpayerStatus) {
    const statusResult = deriveTaxpayerStatus(raw.taxpayerStatus);
    isActiveTaxpayer = statusResult.isActiveTaxpayer;
    if (!isActiveTaxpayer) {
      exclusionReasons.push('inactive_taxpayer');
    }
  }

  const companyName = legalName
    ? legalName
        .replace(
          /\s+(S\.?A\.?C\.?|S\.?A\.?|S\.?R\.?L\.?|E\.?I\.?R\.?L\.?|LTDA\.?)\s*$/i,
          '',
        )
        .trim() || legalName
    : legalName;

  return {
    sourceKey: 'pe_sunat_bulk',
    countryCode: 'PE',
    taxIdentifier: ruc,
    taxIdentifierType: 'RUC',
    legalName,
    companyName,
    taxpayerStatus: raw.taxpayerStatus,
    domicileCondition: raw.domicileCondition,
    ubigeo: raw.ubigeo,
    isActiveTaxpayer,
    isLikelyCompany,
    exclusionReasons,
  };
}
