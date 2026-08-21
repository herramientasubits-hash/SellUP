/**
 * BR Receita CNPJ — CNPJ helpers (normalization, DV validation, masking, hashing).
 *
 * Hito: BR-SOURCE-2 — Receita CNPJ local/sample parser.
 *
 * Pure helpers. NO Supabase, NO filesystem, NO network, NO provider calls.
 * These do not download or import the real dataset; they only operate on
 * in-memory strings supplied by the (synthetic) local/sample parser.
 *
 * ── CNPJ structure (data-contract § 3.1) ────────────────────────────────────
 *   AA AAA AAA / AAAA - DV     raiz(8) + ordem(4) + dígito verificador(2)
 *
 * ── Alphanumeric CNPJ (data-contract § 3.1 / § 3.4, effective July 2026) ─────
 * Positions 1–12 (raiz + ordem) may contain letters AND digits; positions
 * 13–14 (DV) remain numeric. The DV is computed with módulo-11 over the ASCII
 * value of each character (`char − 48`), so '0'..'9' → 0..9 and 'A'..'Z' →
 * 17..42. Legacy all-numeric CNPJs are a strict subset of this rule and remain
 * valid. Consequence: a CNPJ is ALWAYS treated as a normalized alphanumeric
 * STRING, never a number and never "digits only".
 *
 * ── DV algorithm (canonical CNPJ módulo-11, per § 3.4) ───────────────────────
 * Standard CNPJ check-digit weights, applied right-to-left cycling 2→9:
 *   DV1 over the 12 identity chars, DV2 over those 12 + DV1 (13 chars).
 *   remainder = weightedSum % 11;  digit = remainder < 2 ? 0 : 11 − remainder.
 * This is the officially documented algorithm; we do NOT invent or relax it
 * (EC SCVS invalid-RUC discipline: never admit malformed identities).
 */

import { createHash } from 'node:crypto';
import { deriveTaxRecordIdentity } from '../../record-identity';

export const BR_CNPJ_LENGTH = 14 as const;
export const BR_CNPJ_IDENTITY_LENGTH = 12 as const; // raiz(8) + ordem(4), pre-DV

/** Punctuation stripped during normalization (data-contract § 3.4 step 1). */
const BR_CNPJ_PUNCTUATION = /[.\-/\s]/g;

/** Positions 1–12 must be [A-Z0-9]; positions 13–14 (DV) must be [0-9]. */
const BR_CNPJ_IDENTITY_CHARS = /^[A-Z0-9]{12}$/;
const BR_CNPJ_DV_CHARS = /^[0-9]{2}$/;

export type BrCnpjNormalizationStatus = 'valid' | 'invalid_format' | 'invalid_dv' | 'missing';

export type BrCnpjNormalizationReason =
  | 'missing'
  | 'invalid_length'
  | 'invalid_charset'
  | 'invalid_dv';

export interface BrCnpjNormalizationResult {
  readonly status: BrCnpjNormalizationStatus;
  /** The normalized 14-position CNPJ string, only when status === 'valid'. */
  readonly normalized: string | null;
  readonly reason: BrCnpjNormalizationReason | null;
  /** Length after punctuation stripping (for diagnostics; never the raw value). */
  readonly observedLength: number | null;
}

/** ASCII value used by the alphanumeric DV: `char − 48` (§ 3.1). */
function charValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

/**
 * Computes one CNPJ check digit over an ordered list of identity characters
 * using módulo-11 with weights cycling 2→9 from the rightmost position.
 */
function computeSingleCheckDigit(identityChars: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = identityChars.length - 1; i >= 0; i--) {
    sum += charValue(identityChars[i]!) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Computes the two check digits for the 12 identity characters (raiz + ordem),
 * returning the 2-character DV string. Exported so the synthetic fixtures can
 * build DV-valid rows from parts without hardcoding 14-digit literals.
 *
 * @throws if `identityChars` is not exactly 12 chars in [A-Z0-9].
 */
export function computeBrazilCnpjCheckDigits(identityChars: string): string {
  const upper = typeof identityChars === 'string' ? identityChars.toUpperCase() : '';
  if (!BR_CNPJ_IDENTITY_CHARS.test(upper)) {
    throw new Error(
      'computeBrazilCnpjCheckDigits: expected exactly 12 chars in [A-Z0-9] (raiz + ordem)',
    );
  }
  const dv1 = computeSingleCheckDigit(upper);
  const dv2 = computeSingleCheckDigit(`${upper}${dv1}`);
  return `${dv1}${dv2}`;
}

/**
 * Strips punctuation and uppercases; does not validate.
 *
 * 🔴 BR-SOURCE-GATE-ROUND-1 — EXPORTED as `stripBrazilCnpjPunctuationAndUpper`. The snapshot
 * output sanitizer needs the same comparison form this module already uses, and a second
 * normalizer written next door would be a second definition of "the same CNPJ" — the exact
 * divergence `br-receita-cnpj-identifier-shape.ts` exists to prevent on the detection side.
 */
function stripAndUpper(raw: string): string {
  return raw.trim().toUpperCase().replace(BR_CNPJ_PUNCTUATION, '');
}

/** The canonical comparison form for CNPJ-shaped text. Never validates; never throws. */
export function stripBrazilCnpjPunctuationAndUpper(raw: unknown): string {
  return typeof raw === 'string' ? stripAndUpper(raw) : '';
}

/**
 * Normalizes a raw CNPJ (string-based, alphanumeric-safe). Never throws:
 * returns a fail-closed result. Letters in positions 1–12 are preserved
 * (never stripped). A CNPJ that fails DV validation is NOT a valid identity.
 */
export function normalizeBrazilCnpj(raw: unknown): BrCnpjNormalizationResult {
  if (typeof raw !== 'string') {
    return { status: 'missing', normalized: null, reason: 'missing', observedLength: null };
  }
  const stripped = stripAndUpper(raw);
  if (stripped.length === 0) {
    return { status: 'missing', normalized: null, reason: 'missing', observedLength: 0 };
  }
  if (stripped.length !== BR_CNPJ_LENGTH) {
    return {
      status: 'invalid_format',
      normalized: null,
      reason: 'invalid_length',
      observedLength: stripped.length,
    };
  }

  const identity = stripped.slice(0, BR_CNPJ_IDENTITY_LENGTH);
  const dv = stripped.slice(BR_CNPJ_IDENTITY_LENGTH);
  if (!BR_CNPJ_IDENTITY_CHARS.test(identity) || !BR_CNPJ_DV_CHARS.test(dv)) {
    return {
      status: 'invalid_format',
      normalized: null,
      reason: 'invalid_charset',
      observedLength: stripped.length,
    };
  }

  const expectedDv = computeBrazilCnpjCheckDigits(identity);
  if (expectedDv !== dv) {
    return {
      status: 'invalid_dv',
      normalized: null,
      reason: 'invalid_dv',
      observedLength: stripped.length,
    };
  }

  return { status: 'valid', normalized: stripped, reason: null, observedLength: stripped.length };
}

/** True only for a fully DV-valid, normalizable CNPJ. */
export function validateBrazilCnpj(raw: unknown): boolean {
  return normalizeBrazilCnpj(raw).status === 'valid';
}

/**
 * Builds the record identity key `tax:<normalized_14>` for an ALREADY-normalized
 * CNPJ, reusing the shared tax-record-identity helper (family = TAX_GRAIN).
 *
 * @throws if given a value the shared helper cannot turn into a tax identity —
 * an internal invariant guard; the builder only calls this after validation.
 */
export function buildBrazilCnpjRecordIdentityKey(normalizedCnpj: string): string {
  const identity = deriveTaxRecordIdentity(normalizedCnpj);
  if (identity.status !== 'resolved') {
    throw new Error(
      `buildBrazilCnpjRecordIdentityKey: could not derive tax identity (${identity.reason})`,
    );
  }
  return identity.recordIdentityKey;
}

/**
 * Masks a CNPJ for reports/logs. NEVER returns the full identifier: reveals at
 * most a short prefix + the 2-char DV, everything else redacted.
 * Example: "12ABC34501DE35" → "CNPJ-12**********35".
 */
export function maskBrazilCnpjForReport(raw: unknown): string {
  if (typeof raw !== 'string') return 'CNPJ-[missing]';
  const stripped = stripAndUpper(raw);
  if (stripped.length === 0) return 'CNPJ-[empty]';
  if (stripped.length <= 4) return `CNPJ-${'*'.repeat(stripped.length)}`;
  const head = stripped.slice(0, 2);
  const tail = stripped.slice(-2);
  return `CNPJ-${head}${'*'.repeat(stripped.length - 4)}${tail}`;
}

/**
 * Stable, non-reversible SHA-256 hash truncated to 12 hex chars. Used as a
 * safe_identifier for rejections and milestone/report lines so a CNPJ never
 * appears in full anywhere.
 */
export function buildBrazilCnpjHash12(raw: unknown): string {
  const basis = typeof raw === 'string' ? stripAndUpper(raw) : '';
  return createHash('sha256').update(basis).digest('hex').slice(0, 12);
}
