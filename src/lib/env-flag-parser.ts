/**
 * env-flag-parser.ts — Canonical, fail-closed parsing of environment values.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§10).
 *
 * Why this exists: several call sites compared raw `process.env` values with
 * strict equality (`=== 'apollo_organizations'`, `!== 'true'`). Vercel declares
 * these variables as `sensitive`, so their literal value is NOT recoverable from
 * outside the running deployment — the deployed code must therefore interpret
 * ANY reasonable spelling correctly instead of assuming one. A stray newline,
 * an uppercase `TRUE` or a leading space silently flipped a gate.
 *
 * Rules (identical for every consumer):
 *   - `undefined` / `null` / empty-after-trim  → not set.
 *   - Comparison is always done on `trim().toLowerCase()`.
 *   - Booleans: ONLY the explicit token `true` enables. Everything else — including
 *     an unrecognised value such as `yes`, `1` or `enabled` — is OFF (fail-closed).
 *   - Enums: only an exact match against the allowlist resolves; anything else is
 *     `null`, which callers must treat as "not configured", never as a default.
 *
 * Pure: no I/O, no env reads of its own. Callers pass the raw value in.
 */

/** Canonical form of a raw env value, or `null` when it carries no value. */
export function normalizeEnvValue(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

/** The only token that turns a boolean flag on. */
export const ENV_TRUE_TOKEN = 'true';

/** The only token that explicitly turns a boolean flag off. */
export const ENV_FALSE_TOKEN = 'false';

/**
 * Returns true only when the value is an explicit `true` (case-insensitive,
 * surrounding whitespace ignored). Absent, empty and unrecognised values are
 * false — fail-closed, because these flags authorise real provider spend.
 */
export function parseBooleanEnvFlag(raw: string | undefined | null): boolean {
  return normalizeEnvValue(raw) === ENV_TRUE_TOKEN;
}

/** Why a boolean flag resolved the way it did — for diagnostics, never for gating. */
export type BooleanEnvFlagReason =
  | 'explicit_true'
  | 'explicit_false'
  | 'not_set'
  | 'invalid_value';

/**
 * Same resolution as {@link parseBooleanEnvFlag}, plus the reason. Useful for
 * diagnostics endpoints that must distinguish "explicitly off" from "absent"
 * and from "misconfigured" without ever leaking the raw value.
 */
export function parseBooleanEnvFlagVerbose(raw: string | undefined | null): {
  enabled: boolean;
  reason: BooleanEnvFlagReason;
} {
  const normalized = normalizeEnvValue(raw);
  if (normalized === null) return { enabled: false, reason: 'not_set' };
  if (normalized === ENV_TRUE_TOKEN) return { enabled: true, reason: 'explicit_true' };
  if (normalized === ENV_FALSE_TOKEN) return { enabled: false, reason: 'explicit_false' };
  return { enabled: false, reason: 'invalid_value' };
}

/**
 * Resolves a raw env value against an allowlist of canonical tokens.
 * Returns `null` for absent, empty or unrecognised values — callers decide the
 * default explicitly instead of inheriting one from a silent mismatch.
 */
export function parseEnvEnumValue<T extends string>(
  raw: string | undefined | null,
  allowed: readonly T[],
): T | null {
  const normalized = normalizeEnvValue(raw);
  if (normalized === null) return null;
  return allowed.find((candidate) => candidate.toLowerCase() === normalized) ?? null;
}
