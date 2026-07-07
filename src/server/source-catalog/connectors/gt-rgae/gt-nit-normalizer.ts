/**
 * GT NIT Normalizer — Guatemala
 *
 * Normaliza NIT de proveedores RGAE.
 * Guardrail técnico basado en el dataset 2025 auditado (rango 5–10 dígitos).
 * NO es validación SAT ni validación fiscal oficial.
 *
 * Hito: Centroamérica.7G.1
 */

import type { GtNitNormalizationResult } from './gt-rgae-types';
import { GT_NIT_MIN_LENGTH, GT_NIT_MAX_LENGTH } from './gt-rgae-types';

/**
 * Normaliza un NIT crudo de Guatemala.
 * Acepta string, number, null o undefined.
 * Nunca lanza — devuelve isValid=false con reason en caso de error.
 */
export function normalizeGuatemalaNit(
  raw: string | number | null | undefined,
): GtNitNormalizationResult {
  if (raw === null || raw === undefined || raw === '') {
    return { isValid: false, normalized: null, reason: 'missing', observedLength: null };
  }

  // Convertir number a string sin notación científica
  let str: string;
  if (typeof raw === 'number') {
    str = Number.isFinite(raw) ? raw.toFixed(0) : '';
  } else {
    str = String(raw);
  }

  // Trim + remover espacios y guiones
  str = str.trim().replace(/[\s\-]/g, '');

  // Solo dígitos
  if (!/^\d+$/.test(str)) {
    return { isValid: false, normalized: null, reason: 'non_numeric', observedLength: null };
  }

  const len = str.length;

  if (len < GT_NIT_MIN_LENGTH) {
    return { isValid: false, normalized: null, reason: 'too_short', observedLength: len };
  }

  if (len > GT_NIT_MAX_LENGTH) {
    return { isValid: false, normalized: null, reason: 'too_long', observedLength: len };
  }

  return { isValid: true, normalized: str, reason: null, observedLength: len };
}

/**
 * Enmascara un NIT para logs y reportes.
 * Nunca imprime el NIT completo.
 * Ejemplo: "1234567" → "NIT-***4567"
 */
export function maskGuatemalaNit(nit: string): string {
  if (!nit || nit.length === 0) return 'NIT-[vacío]';
  if (nit.length <= 4) return `NIT-${'*'.repeat(nit.length)}`;
  const visible = nit.slice(-4);
  return `NIT-${'*'.repeat(nit.length - 4)}${visible}`;
}
