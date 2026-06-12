// ── Text normalization helpers — Hito 16AB.37 ─────────────────────────────────
// Pure, side-effect-free utilities. No external calls, no randomness, no dates.

import type { ClassificationWarning } from './import-classification-types';

// ── Security limits ───────────────────────────────────────────────────────────

export const MAX_INDUSTRY_VALUE_LENGTH = 200;
export const MAX_SUBINDUSTRY_VALUE_LENGTH = 250;

// ── Core normalization ────────────────────────────────────────────────────────
// Structural normalization only: no translation, no stemming, no equivalences.

export function normalizeClassificationValue(value: string): string {
  return (
    value
      .replace(/[\x00-\x1F\x7F]/g, '') // strip control characters
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove combining diacritics (ó→o, ñ→n, ü→u)
      .replace(/[-_/\\]/g, ' ') // hyphens, underscores, slashes → space
      .replace(/[^\p{L}\p{N}\s]/gu, '') // remove remaining non-semantic chars
      .replace(/\s+/g, ' ') // collapse runs of spaces
      .trim()
  );
}

// ── Input sanitization ────────────────────────────────────────────────────────
// Strips control chars, enforces max length, appends warning if truncated.

export function sanitizeClassificationInput(
  value: string | null,
  maxLength: number,
  field: 'industry' | 'subindustry',
  warnings: ClassificationWarning[],
): string | null {
  if (value === null) return null;

  const cleaned = value.replace(/[\x00-\x1F\x7F]/g, '');

  if (cleaned.trim() === '') return null;

  if (cleaned.length > maxLength) {
    warnings.push({
      code: 'VALUE_TRUNCATED',
      field,
      message: `Value exceeds ${maxLength} characters and was truncated for normalization.`,
    });
    return cleaned.slice(0, maxLength);
  }

  return cleaned;
}
