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

export interface ConsumedCell {
  /** El dato principal, en una sola línea. */
  primary: string;
  /** El dato de apoyo, debajo y apagado. */
  secondary?: string;
  description?: string;
}

/**
 * El consumo del mes partido en valor principal + subtítulo, para que una
 * celda no tenga que romper «17 cr · $24.03» en dos renglones a su suerte.
 * Manda lo que se cuenta en créditos; el costo en dólares acompaña. Un
 * proveedor cuyo consumo no se mide desde SellUp no afirma «0»: queda en «—».
 */
export function deriveConsumedCell(
  row: { consumedCredits: number; consumedUsd: number; hasUnknownCost: boolean },
  isMeasured: boolean,
): ConsumedCell {
  if (!isMeasured) return { primary: '—' };
  const usd = deriveConsumedDisplay(null, row.consumedUsd, row.hasUnknownCost);
  const hasUsd = usd.label !== '—';
  const credits =
    row.consumedCredits > 0
      ? `${row.consumedCredits.toLocaleString('es-CO')} ${row.consumedCredits === 1 ? 'crédito' : 'créditos'}`
      : null;

  // «Costo desconocido» no es una cifra: no lleva unidad.
  const usdLabel = usd.label.startsWith('$') ? `${usd.label} USD` : usd.label;

  if (credits) {
    return { primary: credits, secondary: hasUsd ? usdLabel : undefined, description: usd.description };
  }
  if (hasUsd) return { primary: usdLabel, description: usd.description };
  return { primary: 'Sin consumo' };
}
