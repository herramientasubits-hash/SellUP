/**
 * EC RUC — Lookup-specific semantic validator — EC-SCVS-12FIX
 *
 * Purpose
 * -------
 * Decide whether an Ecuador RUC is eligible to be looked up against
 * `source_company_snapshots` by the ec_scvs enrichment adapter. This is a
 * LOOKUP gate, NOT an ingest normalizer.
 *
 * Why this exists (EC-SCVS-11B / EC-SCVS-12 deviation)
 * ---------------------------------------------------
 * The controlled live pilot (EC-SCVS-11B) found that a structurally invalid RUC
 * (`0000000000000`) reached the snapshot probe and came back as
 * `no_match / no_snapshot_match_by_ruc`. The expected outcome is
 * `skipped / invalid_ruc_format` — an invalid identifier must never trigger a
 * lookup.
 *
 * Root cause: `normalizeEcuadorRuc` is DELIBERATELY conservative for INGEST
 * (bi_compania.csv): it only enforces "13 numeric digits". It does not (and must
 * not) reject all-zeros or semantically impossible province codes, because
 * changing it could affect imports and existing snapshots. So this module layers
 * a lookup-only semantic check ON TOP of the normalizer, without modifying it.
 *
 * Rules applied here (and only these)
 * -----------------------------------
 *   1. Must normalize via `normalizeEcuadorRuc` (trim, strip [ \-], numeric,
 *      exactly 13 digits).
 *   2. Not all zeros.
 *   3. Province code (first two digits) must be a real Ecuador province:
 *        - 01–24 (the 24 provinces), or
 *        - 30 (SRI convention for entities registered from the exterior).
 *   4. Establishment suffix stays PERMISSIVE — the SCVS dataset contains suffixes
 *      other than "001", so a suffix is NEVER a rejection reason here.
 *   5. NO full checksum / verifier-digit validation (there is no SCVS-compatible
 *      checksum utility to reuse, and false negatives would drop real records).
 *
 * On rejection the caller must return status='skipped', reason='invalid_ruc_format',
 * confidence=0, and MUST NOT perform a snapshot lookup. Never logs the full RUC.
 *
 * Server-side only.
 */

import { normalizeEcuadorRuc } from './ec-ruc-normalizer';

/** Lowest valid Ecuador province code. */
const EC_MIN_PROVINCE_CODE = 1;
/** Highest numbered Ecuador province code (24 provinces). */
const EC_MAX_PROVINCE_CODE = 24;
/** Special SRI province code for entities registered from the exterior. */
const EC_EXTERIOR_PROVINCE_CODE = 30;

export interface EcuadorRucLookupValidation {
  /** True only when the RUC is eligible for an ec_scvs snapshot lookup. */
  valid: boolean;
  /** The normalized 13-digit RUC, present only when `valid` is true. */
  normalizedTaxId?: string;
  /** Machine-readable rejection reason, present only when `valid` is false. */
  reason?: string;
}

/**
 * Validates a raw RUC for ec_scvs snapshot lookup eligibility. Never throws.
 * Returns `{ valid: false, reason }` for any structurally or semantically
 * invalid identifier so the caller can skip the lookup entirely.
 */
export function validateEcuadorRucForScvsLookup(
  raw: string | number | null | undefined,
): EcuadorRucLookupValidation {
  const normalization = normalizeEcuadorRuc(raw);

  // Reuse the conservative normalizer for shape (numeric, 13 digits, trimming).
  if (normalization.status !== 'valid' || !normalization.normalized) {
    return { valid: false, reason: normalization.reason ?? normalization.status };
  }

  const digits = normalization.normalized; // guaranteed 13 numeric characters

  // 2) All-zeros is a placeholder, never a real RUC.
  if (/^0+$/.test(digits)) {
    return { valid: false, reason: 'all_zero_ruc' };
  }

  // 3) Province code must be a real Ecuador province (01–24) or the exterior (30).
  const provinceCode = Number(digits.slice(0, 2));
  const provinceIsValid =
    (provinceCode >= EC_MIN_PROVINCE_CODE && provinceCode <= EC_MAX_PROVINCE_CODE) ||
    provinceCode === EC_EXTERIOR_PROVINCE_CODE;
  if (!provinceIsValid) {
    return { valid: false, reason: 'invalid_province_code' };
  }

  // 4) Suffix intentionally NOT checked (permissive per SCVS dataset).
  // 5) No checksum by design.
  return { valid: true, normalizedTaxId: digits };
}
