// ============================================================
// budgets — period boundary helpers (pure, no DB)
// ============================================================

import type { BudgetPeriodType, PeriodBounds } from './types';

/**
 * Returns [start, end) boundaries for the period that contains `now`.
 * End is exclusive (first instant of the next period).
 *
 * 'custom' is not yet fully supported (requires per-rule start date);
 * falls back to monthly behaviour until the schema carries custom dates.
 */
export function getPeriodBounds(
  periodType: BudgetPeriodType,
  now: Date = new Date(),
): PeriodBounds {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed

  switch (periodType) {
    case 'monthly':
    case 'custom': {
      const start = new Date(Date.UTC(y, m, 1));
      const end = new Date(Date.UTC(y, m + 1, 1));
      return { start, end };
    }

    case 'quarterly': {
      const quarterStart = Math.floor(m / 3) * 3; // 0, 3, 6, 9
      const start = new Date(Date.UTC(y, quarterStart, 1));
      const end = new Date(Date.UTC(y, quarterStart + 3, 1));
      return { start, end };
    }

    case 'annual': {
      const start = new Date(Date.UTC(y, 0, 1));
      const end = new Date(Date.UTC(y + 1, 0, 1));
      return { start, end };
    }
  }
}

/** ISO 8601 string (UTC) for the start of a period. */
export function periodStartIso(periodType: BudgetPeriodType, now?: Date): string {
  return getPeriodBounds(periodType, now).start.toISOString();
}

/** ISO 8601 string (UTC) for the end (exclusive) of a period. */
export function periodEndIso(periodType: BudgetPeriodType, now?: Date): string {
  return getPeriodBounds(periodType, now).end.toISOString();
}
