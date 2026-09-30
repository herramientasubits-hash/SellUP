/**
 * AGENT1-IMPORT-PARITY-2 — el identificador fiscal importado se valida con las
 * MISMAS reglas por país que el alta manual (`tax-identifier-rules.ts`).
 *
 * Antes la importación sólo hacía `trim()`: un NIT con el dígito verificador mal
 * entraba igual, y `tax_identifier_type` nunca se llenaba.
 *
 * Diferencia deliberada con el alta manual: aquí un identificador inválido NO
 * bloquea la fila, queda como aviso. Una importación trae cientos de filas y la
 * vendedora debe poder corregir después; Apollo/Lusha tampoco rechazan una
 * empresa por su identificador fiscal.
 *
 * Puro, sin I/O: lo usan el parser (aviso en la vista previa) y la ruta
 * (columnas persistidas).
 */

import {
  calculateColombianCheckDigit,
  getTaxIdentifierRule,
  validateTaxIdentifier,
} from './tax-identifier-rules';

export type ImportTaxIdentifierStatus =
  | 'absent'
  | 'valid'
  | 'valid_check_digit_computed'
  | 'invalid'
  | 'unsupported_country'
  | 'missing_country'
  /** AGENT1-IMPORT-PARITY-8 — no venía en el archivo; lo encontró un catálogo oficial. */
  | 'official_source';

export type ImportTaxIdentifierResolution = {
  status: ImportTaxIdentifierStatus;
  /** Valor a persistir: normalizado si es válido; si no, el original recortado. */
  value: string | null;
  /** Etiqueta de la regla del país (NIT, RUC, CNPJ…) sólo cuando es válido. */
  type: string | null;
  /** Aviso para la vista previa; `null` cuando no hay nada que avisar. */
  warning: string | null;
};

/** NIT colombiano de 9 dígitos sin DV: el DV es determinístico, se calcula. */
const CO_NIT_WITHOUT_CHECK_DIGIT = /^\d{9}$/;

export function resolveImportTaxIdentifier(
  rawValue: string | null | undefined,
  countryCode: string | null | undefined,
): ImportTaxIdentifierResolution {
  const value = rawValue?.trim() || null;
  if (!value) return { status: 'absent', value: null, type: null, warning: null };

  const cc = countryCode?.trim().toUpperCase() || null;
  if (!cc) {
    return {
      status: 'missing_country',
      value,
      type: null,
      warning: 'Identificador fiscal sin país — no se pudo validar',
    };
  }

  const rule = getTaxIdentifierRule(cc);
  if (!rule) {
    // Sin regla para el país: se guarda tal cual, sin inventar un tipo.
    return { status: 'unsupported_country', value, type: null, warning: null };
  }

  const compact = value.replace(/^(nit|rut|rfc|ruc|cuit|cnpj)\s*[:.]?\s*/i, '').replace(/[\s.]/g, '');
  if (cc === 'CO' && CO_NIT_WITHOUT_CHECK_DIGIT.test(compact)) {
    const dv = calculateColombianCheckDigit(compact);
    return {
      status: 'valid_check_digit_computed',
      value: `${compact}-${dv}`,
      type: rule.label,
      warning: null,
    };
  }

  const result = validateTaxIdentifier(compact, cc);
  if (result.valid) {
    return { status: 'valid', value: result.normalized ?? compact, type: rule.label, warning: null };
  }
  return {
    status: 'invalid',
    value,
    type: null,
    warning: `${rule.label} no válido: "${value}" — revisar`,
  };
}
