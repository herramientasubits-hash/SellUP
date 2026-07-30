/**
 * env-flag-parser.ts — Canonical parser for environment-driven flags and tokens.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * Motivation: several call sites compared `process.env.X === 'true'` raw while
 * others already trimmed and lowercased (see isApolloCompanySearchEnabled in
 * feature-flags.server.ts). The same deployment value could therefore resolve
 * differently depending on which module read it — the provider indicator could
 * disagree with the code that actually spends credits.
 *
 * Rules (single definition for the whole repo):
 *   - trim, then lowercase;
 *   - only the exact tokens `true` / `false` are booleans;
 *   - anything else (missing, empty, `1`, `yes`, `TRUE!`) is NOT true;
 *   - fail-closed: when the value is absent or unparseable the flag is OFF and
 *     the decision records why, so callers can log the reason instead of
 *     silently treating garbage as `false`.
 *
 * Pure: no I/O, no process.env access. Callers pass the raw value in so the
 * parser stays trivially testable and usable from both server and script code.
 */

/** Why a boolean flag resolved the way it did. */
export type EnvFlagSource =
  | 'explicit_true'
  | 'explicit_false'
  | 'absent'
  | 'invalid';

export type EnvFlagDecision = {
  /** Effective value. Fail-closed: only `explicit_true` yields true. */
  enabled: boolean;
  source: EnvFlagSource;
  /** Normalized token actually seen (trimmed + lowercased). Null when absent/empty. */
  normalized: string | null;
};

const TRUE_TOKEN = 'true';
const FALSE_TOKEN = 'false';

/**
 * Trims and lowercases an env value.
 * Returns null for undefined, null, or whitespace-only values.
 */
export function normalizeEnvToken(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed.toLowerCase();
}

/**
 * Parses a boolean env flag with an explicit decision record.
 *
 * `' TRUE '` → explicit_true. `'FALSE'` → explicit_false.
 * `'1'`, `'yes'`, `'on'` → invalid (and therefore disabled).
 */
export function parseEnvBooleanFlag(raw: string | undefined | null): EnvFlagDecision {
  const normalized = normalizeEnvToken(raw);

  if (normalized === null) {
    return { enabled: false, source: 'absent', normalized: null };
  }
  if (normalized === TRUE_TOKEN) {
    return { enabled: true, source: 'explicit_true', normalized };
  }
  if (normalized === FALSE_TOKEN) {
    return { enabled: false, source: 'explicit_false', normalized };
  }
  return { enabled: false, source: 'invalid', normalized };
}

/**
 * Fail-closed boolean read. Convenience wrapper when the reason is not needed.
 */
export function isEnvFlagEnabled(raw: string | undefined | null): boolean {
  return parseEnvBooleanFlag(raw).enabled;
}

/**
 * Compares an env value against an expected token using the same normalization
 * as the boolean parser. Use for enum-style env vars (provider keys, modes).
 *
 * `matchesEnvToken(' Apollo_Organizations ', 'apollo_organizations')` → true.
 */
export function matchesEnvToken(
  raw: string | undefined | null,
  expected: string,
): boolean {
  const normalized = normalizeEnvToken(raw);
  if (normalized === null) return false;
  return normalized === expected.trim().toLowerCase();
}
