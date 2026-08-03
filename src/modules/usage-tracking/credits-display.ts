// ============================================================
// usage-tracking — truthful credit-completeness display
// (A1-APOLLO-TWO-ROUND-QA-READINESS-1 § 3–5)
//
// UNKNOWN CREDITS != ZERO CREDITS.
//
// `provider_usage_logs.credits_used` is nullable and NULL is a real, meaningful
// state: the provider may have processed (and billed) the operation while the
// exact consumption could not be determined automatically. The two-round
// accounting writes exactly that — see
// `apollo-organization-enrichment-usage-log.ts`, which leaves `credits_used`
// NULL on purpose and raises `billing_state = 'unknown'` /
// `manual_reconciliation_required`.
//
// Reading that NULL as `Number(row.credits_used ?? 0)` turns "we don't know"
// into "confirmed free", which is the one reading that is never safe. This
// module is the single boundary that keeps the two states apart, mirroring the
// existing cost-truth boundary in `cost-display.ts` (which does the same job
// for `estimated_cost_usd`).
//
// It changes NO persisted value and performs NO backfill: it only decides how
// an already-stored row is counted and rendered.
// ============================================================

/**
 * A single operation's credit consumption.
 *
 * `unknown` carries `credits: null` rather than a number so that no caller can
 * accidentally add it to a total: there is no numeric value to add.
 */
export type UsageCreditsValue =
  | { state: 'known'; credits: number }
  | { state: 'unknown'; credits: null };

/** Billing states the accounting layer persists alongside a usage log. */
export type UsageBillingState = 'known' | 'unknown' | null | undefined;

export const KNOWN_CREDITS_ZERO: UsageCreditsValue = { state: 'known', credits: 0 };
export const UNKNOWN_CREDITS: UsageCreditsValue = { state: 'unknown', credits: null };

// ─── Labels ───────────────────────────────────────────────────────────────────
//
// Deliberately non-alarmist: an indeterminate charge is a bookkeeping gap, not
// an incident. It must never read as "free".

export const UNKNOWN_CREDITS_LABEL = 'Pendiente de reconciliación';
export const UNKNOWN_CREDITS_DESCRIPTION =
  'El proveedor pudo haber procesado la operación, pero el consumo exacto no pudo determinarse automáticamente.';
export const PARTIAL_CREDITS_DESCRIPTION =
  'Total parcial: existen operaciones con consumo pendiente de reconciliación.';
/** Short marker for dense table cells, where the full label does not fit. */
export const UNKNOWN_CREDITS_SHORT_LABEL = '—';

// ─── Row-level resolution ─────────────────────────────────────────────────────

/**
 * Resolves one row's credit consumption.
 *
 * Unknown wins over any stored number: an operation whose billing state is
 * `unknown` is indeterminate even if some numeric value was written next to it.
 * A non-finite value (NaN from a malformed numeric string) is unknown too —
 * coercing it to 0 is the same lie in a different disguise.
 */
export function resolveUsageCredits(
  creditsUsed: number | string | null | undefined,
  billingState: UsageBillingState = null,
): UsageCreditsValue {
  if (billingState === 'unknown') return UNKNOWN_CREDITS;
  if (creditsUsed === null || creditsUsed === undefined) return UNKNOWN_CREDITS;

  const numeric = Number(creditsUsed);
  if (!Number.isFinite(numeric)) return UNKNOWN_CREDITS;

  return { state: 'known', credits: numeric };
}

/**
 * Reads the billing state a producer left on a usage-log row.
 *
 * Two carriers exist by design and both are checked:
 *   - the native `billing_state` column (migration 100), populated only while
 *     `ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS` is ON;
 *   - `metadata.run_correlation.billing_state`, which is written unconditionally
 *     and is therefore the only carrier present today.
 *
 * Anything unreadable yields `null` (no opinion), never a fabricated 'known'.
 */
export function readUsageBillingState(row: {
  billing_state?: unknown;
  metadata?: unknown;
}): UsageBillingState {
  const fromColumn = row.billing_state;
  if (fromColumn === 'unknown' || fromColumn === 'known') return fromColumn;

  const metadata = row.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const correlation = (metadata as Record<string, unknown>)['run_correlation'];
  if (!correlation || typeof correlation !== 'object') return null;
  const fromMetadata = (correlation as Record<string, unknown>)['billing_state'];
  if (fromMetadata === 'unknown' || fromMetadata === 'known') return fromMetadata;

  return null;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/**
 * A credit total that never pretends to be complete when it isn't.
 *
 * The contract (§ 4): 10 known credits + 1 unknown-credit operation yields
 * `knownCreditsTotal = 10` and `unknownCreditOperations = 1`. It must NOT be
 * presented as "total definitivo = 10", and no cost is invented for the
 * unknown operation.
 */
export interface UsageCreditsTotals {
  /** Sum of the operations whose consumption IS known. Never includes unknowns. */
  knownCreditsTotal: number;
  /** How many operations have indeterminate consumption. */
  unknownCreditOperations: number;
  /** Convenience mirror of `unknownCreditOperations > 0`. */
  hasUnknownCredits: boolean;
}

export function emptyUsageCreditsTotals(): UsageCreditsTotals {
  return { knownCreditsTotal: 0, unknownCreditOperations: 0, hasUnknownCredits: false };
}

/** Folds one operation into a running total. Pure — returns a new object. */
export function accumulateUsageCredits(
  totals: UsageCreditsTotals,
  value: UsageCreditsValue,
): UsageCreditsTotals {
  if (value.state === 'unknown') {
    return {
      knownCreditsTotal: totals.knownCreditsTotal,
      unknownCreditOperations: totals.unknownCreditOperations + 1,
      hasUnknownCredits: true,
    };
  }
  return {
    knownCreditsTotal: totals.knownCreditsTotal + value.credits,
    unknownCreditOperations: totals.unknownCreditOperations,
    hasUnknownCredits: totals.hasUnknownCredits,
  };
}

/** Convenience fold over a list of rows. */
export function aggregateUsageCredits(
  values: readonly UsageCreditsValue[],
): UsageCreditsTotals {
  return values.reduce(accumulateUsageCredits, emptyUsageCreditsTotals());
}

// ─── Presentation ─────────────────────────────────────────────────────────────

export interface CreditsDisplayValue {
  label: string;
  /** True when the number shown is a lower bound rather than a settled total. */
  isPartial: boolean;
  description: string | null;
}

export interface CreditsTotalsDisplayInput {
  totals: UsageCreditsTotals;
  /** Formats a known credit amount. Defaults to an integer count. */
  formatCredits?: (value: number) => string;
}

const defaultFormatCredits = (value: number): string => value.toFixed(0);

/**
 * Renders an aggregate.
 *
 * With unknown operations present the number is suffixed with `+` and flagged
 * partial: it is a floor, not a total. When nothing is known at all, the number
 * disappears entirely rather than showing a `0` that would read as "no
 * consumption".
 */
export function resolveCreditsTotalsDisplay(
  input: CreditsTotalsDisplayInput,
): CreditsDisplayValue {
  const { totals } = input;
  const format = input.formatCredits ?? defaultFormatCredits;

  if (!totals.hasUnknownCredits) {
    return { label: format(totals.knownCreditsTotal), isPartial: false, description: null };
  }

  if (totals.knownCreditsTotal === 0) {
    return {
      label: UNKNOWN_CREDITS_LABEL,
      isPartial: true,
      description: UNKNOWN_CREDITS_DESCRIPTION,
    };
  }

  return {
    label: `${format(totals.knownCreditsTotal)}+`,
    isPartial: true,
    description: PARTIAL_CREDITS_DESCRIPTION,
  };
}

/**
 * Renders a SINGLE operation's credits.
 *
 * `zeroDisplay` exists because a *known* zero is legitimate and must stay
 * visible as zero — the prohibition is on showing zero for an *indeterminate*
 * operation, not on showing a confirmed zero.
 */
export function resolveCreditsDisplay(
  value: UsageCreditsValue,
  options: { formatCredits?: (value: number) => string } = {},
): CreditsDisplayValue {
  if (value.state === 'unknown') {
    return {
      label: UNKNOWN_CREDITS_LABEL,
      isPartial: true,
      description: UNKNOWN_CREDITS_DESCRIPTION,
    };
  }
  const format = options.formatCredits ?? defaultFormatCredits;
  return { label: format(value.credits), isPartial: false, description: null };
}
