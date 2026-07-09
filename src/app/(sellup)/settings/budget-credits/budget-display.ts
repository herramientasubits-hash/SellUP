// Truthful "consumido" / "disponible" label helpers shared by
// budget-summary-cards.tsx and budget-providers-table.tsx (17B.4X.5H). Plain
// module (no 'use client'/'use server') so it stays directly unit-testable.

import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';

export interface BudgetAmountDisplay {
  label: string;
  description?: string;
}

/** A positive/zero USD subtotal with unknown cost truth renders with a '+'/"Costo desconocido" marker instead of a bare exact number. */
export function deriveConsumedDisplay(
  credits: number | null,
  usd: number,
  hasUnknownCost: boolean,
): BudgetAmountDisplay {
  const usdDisplay =
    usd > 0 || hasUnknownCost
      ? resolveCostDisplay({
          valueUsd: usd,
          costTruth: toCostTruth(hasUnknownCost),
          formatUsd: (v) => `$${v.toFixed(2)}`,
        })
      : null;

  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usdDisplay) parts.push(usdDisplay.label);

  return { label: parts.join(' · ') || '—', description: usdDisplay?.description ?? undefined };
}
