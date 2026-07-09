/**
 * EC RUC Normalizer — Ecuador SCVS ingest
 *
 * Normalización CONSERVADORA de ingesta para bi_compania.csv.
 *
 * Existe una regla EC-RUC-v1 en
 * src/modules/prospect-batches/tax-identifier-rules.ts, pero NO es reutilizable
 * aquí: esa regla es para validación de INPUT MANUAL de usuario en un módulo
 * distinto (prospect-batches), exige formatPattern con sufijo de establecimiento
 * "00[1-9]" (rechaza 000 y cualquier sufijo >009), y no está exportada como
 * utilidad genérica de ingesta por lotes. El dataset SCVS contiene sufijos de
 * establecimiento distintos de 001 (EC.2 profiling: ~99.1% terminan en 001,
 * el resto no) y este hito EXPLÍCITAMENTE prohíbe exigir el sufijo 001. Por lo
 * tanto se implementa un normalizador local, documentado aquí, con un contrato
 * más permisivo y correcto para el propósito de perfilar duplicados.
 *
 * Reglas aplicadas (y solo estas):
 *   1. trim
 *   2. eliminar espacios internos y guiones (puntuación de agrupación común)
 *   3. exigir que el resultado sea numérico puro
 *   4. exigir longitud exacta de 13 dígitos
 *
 * NO implementa:
 *   - checksum
 *   - validación SRI
 *   - validación del tercer dígito (tipo de contribuyente)
 *   - exigencia de sufijo 001
 *   - heurísticas de corrección de caracteres (O→0, I→1, etc.)
 *
 * Hito: Catálogo.EC.3
 */

import type { EcRucNormalizationResult } from './ec-scvs-types';

export const EC_RUC_EXPECTED_LENGTH = 13;

/** Puntuación de agrupación tolerada antes de exigir numeric-only. */
const EC_RUC_ALLOWED_PUNCTUATION = /[\s\-]/g;

/**
 * Normaliza un RUC crudo de Ecuador para propósitos de ingesta/profiling.
 * Nunca lanza — devuelve status='invalid_format' o 'missing' con reason.
 */
export function normalizeEcuadorRuc(
  raw: string | number | null | undefined,
): EcRucNormalizationResult {
  if (raw === null || raw === undefined) {
    return { status: 'missing', normalized: null, reason: 'missing', observedLength: null };
  }

  const rawStr = typeof raw === 'number' ? String(raw) : raw;
  const trimmed = rawStr.trim();

  if (trimmed === '') {
    return { status: 'missing', normalized: null, reason: 'missing', observedLength: null };
  }

  const stripped = trimmed.replace(EC_RUC_ALLOWED_PUNCTUATION, '');

  if (!/^\d+$/.test(stripped)) {
    return {
      status: 'invalid_format',
      normalized: null,
      reason: 'alphabetic_contamination',
      observedLength: stripped.length,
    };
  }

  if (stripped.length !== EC_RUC_EXPECTED_LENGTH) {
    return {
      status: 'invalid_format',
      normalized: null,
      reason: 'invalid_length',
      observedLength: stripped.length,
    };
  }

  return { status: 'valid', normalized: stripped, reason: null, observedLength: stripped.length };
}

/**
 * Enmascara un RUC para logs y reportes.
 * Nunca imprime el RUC completo.
 * Ejemplo: "1790013731001" → "RUC-*********001"
 */
export function maskEcuadorRuc(ruc: string): string {
  if (!ruc || ruc.length === 0) return 'RUC-[vacío]';
  if (ruc.length <= 4) return `RUC-${'*'.repeat(ruc.length)}`;
  const visible = ruc.slice(-4);
  return `RUC-${'*'.repeat(ruc.length - 4)}${visible}`;
}
