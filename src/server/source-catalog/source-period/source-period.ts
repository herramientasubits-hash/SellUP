/**
 * Canonical monthly source-period parser/validator for `source_company_snapshots`.
 * Hito: BR-SOURCE-FUNCTIONAL-CUT-A — monthly Receita snapshot identity foundation.
 *
 * ONE definition of "a valid source period", deliberately placed beside
 * `record-identity/` rather than inside a connector: `source_period` is a column on the GENERIC
 * snapshot table, and a per-connector copy of this regex is exactly the drift
 * `br-receita-cnpj-identifier-shape.ts` exists to prevent on the CNPJ side.
 *
 * ── The canonical grain ─────────────────────────────────────────────────────
 *
 *   YYYY-MM     e.g. 2026-07, 2026-08
 *
 * `SOURCE_PERIOD_PATTERN` is the single source of truth, and migration 125 embeds the SAME regex
 * body in its CHECK constraint so the database and the application cannot disagree about what a
 * period is. The CUT-A suite asserts that equality against the real migration file.
 *
 * ── Fail-closed, and deliberately not forgiving ─────────────────────────────
 *
 * Rejected: `2026` (year only), `202607` (no separator), `2026-7` (unpadded month), `26-07`
 * (two-digit year), `2026-00` and `2026-13` (impossible months), `''`, `null`, `undefined`, and any
 * value carrying surrounding whitespace.
 *
 * 🔴 Whitespace is REJECTED rather than trimmed. A period reaches this function from a manifest or
 * an operator argument, and silently repairing ` 2026-07 ` would make the validator a normalizer —
 * at which point the string that identifies a snapshot is no longer the string the caller supplied.
 * The month bound lives in the pattern itself (`0[1-9]|1[0-2]`) rather than in a numeric range
 * check, so there is one rule to read and one rule to keep in sync with the DDL.
 *
 * 🔴 There is deliberately NO "current period" helper. A period is always an explicit input:
 * deriving it from a clock or from `created_at` would let a mislabelled import silently overwrite
 * the wrong month.
 */

/** The one canonical `YYYY-MM` pattern. Mirrored verbatim by migration 125's CHECK constraint. */
export const SOURCE_PERIOD_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** The pattern body as SQL sees it, so a test can compare code and DDL without reformatting. */
export const SOURCE_PERIOD_SQL_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$' as const;

/** Human-facing grain label, used in error messages and recorded contracts. */
export const SOURCE_PERIOD_GRAIN = 'YYYY-MM' as const;

export type SourcePeriodInvalidReason =
  | 'missing'
  | 'not_a_string'
  | 'malformed';

export type SourcePeriodParseResult =
  | { readonly valid: true; readonly sourcePeriod: string }
  | { readonly valid: false; readonly reason: SourcePeriodInvalidReason };

/** Thrown by `assertValidSourcePeriod`. Named so a caller can catch it precisely. */
export class InvalidSourcePeriodError extends Error {
  readonly reason: SourcePeriodInvalidReason;

  constructor(reason: SourcePeriodInvalidReason) {
    super(
      `source_period is invalid (${reason}): expected the canonical ${SOURCE_PERIOD_GRAIN} grain, e.g. "2026-07"`,
    );
    this.name = 'InvalidSourcePeriodError';
    this.reason = reason;
  }
}

/**
 * Parses a candidate period. PURE, never throws.
 *
 * 🔴 The reason is a CATEGORY, never the rejected value: a period is not sensitive, but this
 * function is called from the same code paths that handle CNPJ material and a diagnostic that
 * echoes its input is the habit that leaks one.
 */
export function parseSourcePeriod(value: unknown): SourcePeriodParseResult {
  if (value === null || value === undefined) {
    return { valid: false, reason: 'missing' };
  }
  if (typeof value !== 'string') {
    return { valid: false, reason: 'not_a_string' };
  }
  if (value.length === 0) {
    return { valid: false, reason: 'missing' };
  }
  if (!SOURCE_PERIOD_PATTERN.test(value)) {
    return { valid: false, reason: 'malformed' };
  }
  return { valid: true, sourcePeriod: value };
}

/** Boolean form, for guards and predicates. */
export function isValidSourcePeriod(value: unknown): value is string {
  return parseSourcePeriod(value).valid;
}

/** Fail-closed form. Returns the validated period so callers cannot forget to use it. */
export function assertValidSourcePeriod(value: unknown): string {
  const parsed = parseSourcePeriod(value);
  if (!parsed.valid) {
    throw new InvalidSourcePeriodError(parsed.reason);
  }
  return parsed.sourcePeriod;
}

/**
 * The calendar year of an ALREADY-VALIDATED period.
 *
 * Exists because the generic table's `source_year int NOT NULL` predates the monthly grain and
 * still has to be populated. The period is the authority; this is the only sanctioned way to obtain
 * the year from it, so the two can never be supplied independently and drift.
 */
export function sourcePeriodYear(sourcePeriod: string): number {
  return Number.parseInt(assertValidSourcePeriod(sourcePeriod).slice(0, 4), 10);
}

/**
 * Orders two periods lexicographically, which for `YYYY-MM` is also chronological order.
 * Returns a negative number when `a` precedes `b`. Used to identify the greatest period present.
 */
export function compareSourcePeriods(a: string, b: string): number {
  return assertValidSourcePeriod(a).localeCompare(assertValidSourcePeriod(b));
}
