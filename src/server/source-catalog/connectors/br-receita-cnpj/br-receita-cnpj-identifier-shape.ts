/**
 * BR Receita CNPJ — CANONICAL alphanumeric-aware CNPJ-shape detector (BR-SOURCE-14B.0M § 21-25).
 *
 * BR-SOURCE-14B.0L reported `CNPJ_IDENTIFIER_CONTRACT = alphanumeric_compatible`. An audit for this
 * milestone found that claim true for the join/parse path (opaque-string equality throughout) but
 * FALSE for the leak/PII-detection surface: the classifier, the local-dry-run hard-block guard, the
 * public output sanitizer, and the private metric channel each independently re-detect "CNPJ-shaped"
 * content using their own digit-only heuristics (`\d{14}`, `\d{8}`, contiguous-digit-run counting).
 * None of them tolerate a letter, so an alphanumeric CNPJ (§ 3.1/§ 3.4, effective July 2026) leaking
 * into an unexpected place would pass every one of them undetected.
 *
 * This module is the single canonical helper those four sites now share for the ALPHANUMERIC case.
 * It does not replace the existing numeric-only patterns (CPF stays numeric forever, and the legacy
 * numeric-CNPJ patterns are still correct for what they matched before) — it closes the letters gap
 * alongside them.
 *
 * ── Why DV validation, not just shape, is the discriminator (§ 23) ─────────────
 * A bare `[A-Z0-9]{14}` scan would flag every SHA-1 prefix, UUID fragment, and arbitrary uppercase
 * technical token as a "leaked CNPJ" — false positives that would make every public report unusable.
 * Reusing `br-cnpj.ts`'s official módulo-11 check-digit algorithm as the filter means a candidate
 * substring is only reported when its trailing two characters are ALSO the correct check digits for
 * the preceding twelve — something a random 14-character string satisfies by chance only about
 * 1-in-10,000 times (two independent mod-11 digits). Real CNPJ-shaped leaks pass; hashes, UUIDs, and
 * arbitrary tokens overwhelmingly do not.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - invents the CNPJ grammar or the DV algorithm — both are re-used, unmodified, from `br-cnpj.ts`.
 *   - returns, logs, or persists a value it detects. Callers decide redaction; this module only finds
 *     candidate substrings and says whether each one is CNPJ-shaped-and-DV-valid.
 *   - touches CPF detection. CPF remains a purely numeric 11-digit identifier under the same official
 *     transition (§ 3.1 only affects CNPJ), so CPF patterns elsewhere are untouched by this module.
 */

import { normalizeBrazilCnpj } from './br-cnpj';

/** A 14-character alphanumeric run, not touching another alphanumeric char on either side. */
const CNPJ_ALNUM_CONTINUOUS = /(?<![A-Z0-9])[A-Z0-9]{14}(?![A-Z0-9])/gi;

/** The official punctuated mask (`AA.AAA.AAA/AAAA-DV`) with letters allowed in raiz+ordem. */
const CNPJ_ALNUM_FORMATTED =
  /(?<![A-Z0-9])[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-[0-9]{2}(?![A-Z0-9])/gi;

/**
 * True when `candidate` (already isolated as a 14-character or formatted CNPJ-shaped substring)
 * also passes the official módulo-11 check-digit algorithm. The one and only DV authority is
 * `br-cnpj.ts`; this function never re-implements it.
 */
function isDvValidCnpjCandidate(candidate: string): boolean {
  return normalizeBrazilCnpj(candidate).status === 'valid';
}

/**
 * Scans `text` for every alphanumeric-CNPJ-shaped substring (continuous or officially formatted)
 * that ALSO passes DV validation, and returns the distinct matches found (as they appeared in the
 * text, not normalized). Returns `[]` for non-string or empty input. Never throws.
 */
export function findBrazilCnpjLikeIdentifiers(text: unknown): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(CNPJ_ALNUM_CONTINUOUS)) {
    if (isDvValidCnpjCandidate(match[0])) found.add(match[0]);
  }
  for (const match of text.matchAll(CNPJ_ALNUM_FORMATTED)) {
    if (isDvValidCnpjCandidate(match[0])) found.add(match[0]);
  }
  return [...found];
}

/** True when `text` contains at least one alphanumeric-CNPJ-shaped, DV-valid substring. */
export function containsBrazilCnpjLikeIdentifier(text: unknown): boolean {
  return findBrazilCnpjLikeIdentifiers(text).length > 0;
}
