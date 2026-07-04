/**
 * Honduras Contrataciones Abiertas — RTN Normalizer
 *
 * El Registro Tributario Nacional (RTN) hondureño tiene 14 dígitos.
 * Acepta formatos con prefijo HN-RTN-, guiones y espacios.
 * No inventa ni corrige RTN inválidos.
 * No acepta X-ONCAE-SUPPLIERS-HC1 como RTN.
 *
 * Hito Centroamérica.8C.1
 */

import type { HnRtnNormalizeResult } from './hn-ocds-types';

const RTN_LENGTH = 14;
const RTN_PREFIXES = ['HN-RTN-', 'HN-RTN:'];

function stripRtnPrefix(input: string): string {
  const upper = input.toUpperCase();
  for (const prefix of RTN_PREFIXES) {
    if (upper.startsWith(prefix)) {
      return input.slice(prefix.length);
    }
  }
  return input;
}

/**
 * Normaliza un RTN hondureño.
 *
 * Válido: exactamente 14 dígitos tras eliminar prefijo, espacios y guiones.
 * Inválido: nulo/vacío, longitud incorrecta, caracteres no numéricos.
 */
export function normalizeHondurasRtn(
  input: string | null | undefined,
): HnRtnNormalizeResult {
  if (input == null || input.trim() === '') {
    return { raw: null, normalized: null, isValid: false, reason: 'missing' };
  }

  const raw = input.trim();

  // Reject scheme identifiers that are not RTN
  if (raw.toUpperCase().startsWith('X-ONCAE')) {
    return { raw, normalized: null, isValid: false, reason: 'missing' };
  }

  const stripped = stripRtnPrefix(raw);
  const digitsOnly = stripped.replace(/[\s\-]/g, '');

  if (!/^\d+$/.test(digitsOnly)) {
    return { raw, normalized: null, isValid: false, reason: 'non_numeric' };
  }

  if (digitsOnly.length !== RTN_LENGTH) {
    return { raw, normalized: null, isValid: false, reason: 'invalid_length' };
  }

  return { raw, normalized: digitsOnly, isValid: true };
}

/** Enmascara un RTN válido para logs: primeros 8 dígitos + ****** + últimos 2. */
export function maskRtn(normalized: string): string {
  if (normalized.length !== RTN_LENGTH) return '**masked**';
  return `${normalized.slice(0, 8)}${'*'.repeat(4)}${normalized.slice(12)}`;
}
