// Agente 2A — Apollo person id validation (APOLLO-PHONE-CACHE-1a)
//
// Pure, dependency-free validator for an Apollo *person id*. This is the single
// place that decides whether an opaque candidate/payload id is a valid Apollo
// person id worth persisting as `contact_enrichment_candidates.apollo_person_id`.
//
// Why this exists: APOLLO-PHONE-CACHE-1a persists the Apollo person id as a
// reusable technical prerequisite for a FUTURE phone cache. This module does NOT
// build that cache, does NOT serve phones and does NOT call any provider — it
// only normalizes/validates an id string so nothing but a real Apollo id ever
// lands in the column.
//
// An Apollo person id is a MongoDB ObjectId: exactly 24 hexadecimal characters
// (e.g. `6a6826ba804c600014ead739`). Ids from other providers live in a
// different id space and MUST be rejected — most importantly Lusha contact ids,
// which are shaped `v1.<token>` and would poison the column / a future cache.
//
// The id is an opaque correlation identifier, NOT PII: it is not a phone, email,
// linkedin, name or raw payload. This module never logs it.

/**
 * Prefixes known to belong to NON-Apollo provider id spaces. Defensive, explicit
 * rejection (the 24-hex allowlist below would already reject these, but the
 * denylist documents intent and keeps the Lusha `v1.<token>` case unambiguous).
 */
const NON_APOLLO_PERSON_ID_PREFIXES: readonly string[] = ['v1.'];

/** Apollo person id shape: MongoDB ObjectId — exactly 24 hex chars. */
const APOLLO_PERSON_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * Normalizes and validates an Apollo person id.
 *
 * Returns the trimmed id ONLY when it is a valid Apollo person id:
 *   1. non-empty after trim;
 *   2. does not start with a known non-Apollo prefix (e.g. Lusha `v1.`);
 *   3. matches the Apollo ObjectId shape (24 hex chars, case-insensitive).
 *
 * Any other input (null, undefined, empty, a Lusha `v1.*` id, or anything not
 * shaped like an Apollo ObjectId) returns null so the caller never persists an
 * invalid or cross-provider id. Never throws, never logs.
 */
export function normalizeApolloPersonId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const lower = trimmed.toLowerCase();
  if (NON_APOLLO_PERSON_ID_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return null;
  }

  return APOLLO_PERSON_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** True when `value` is a valid, persistable Apollo person id. */
export function isValidApolloPersonId(
  value: string | null | undefined,
): boolean {
  return normalizeApolloPersonId(value) !== null;
}
