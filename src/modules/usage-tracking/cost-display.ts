// ============================================================
// usage-tracking — truthful cost-completeness display (17B.4X.5H)
//
// UNKNOWN COST != ZERO COST. Upstream producers expose completeness via
// different vocabularies (has_unknown_cost, hasUnknownCost, usdCostTruth).
// This module is the single presentation-boundary normalizer + renderer:
// callers pass cost truth explicitly, never derive it from a numeric value.
// ============================================================

export type CostTruth = 'complete' | 'unknown';

export const UNKNOWN_COST_LABEL = 'Costo desconocido';
export const UNKNOWN_COST_DESCRIPTION = 'Costo no disponible para una o más operaciones.';
export const PARTIAL_COST_DESCRIPTION = 'Costo parcial: existen operaciones con costo no calculado.';
export const INDETERMINATE_REMAINING_LABEL = 'Indeterminado';
export const INDETERMINATE_REMAINING_DESCRIPTION =
  'El consumo USD incluye operaciones con costo no calculado.';

/** Normalizes any upstream `has_unknown_cost`/`hasUnknownCost` boolean into the shared truth vocabulary. */
export function toCostTruth(hasUnknownCost: boolean): CostTruth {
  return hasUnknownCost ? 'unknown' : 'complete';
}

export interface CostDisplayInput {
  valueUsd: number;
  costTruth: CostTruth;
  /** Formats a known positive (or complete-zero) USD amount, e.g. the page's local `formatCost`. */
  formatUsd: (value: number) => string;
  /** Convention for a complete-zero value. Defaults to '$0.00'. */
  zeroDisplay?: string;
}

export interface CostDisplayValue {
  label: string;
  isPartial: boolean;
  description: string | null;
}

/**
 * Resolves a known-cost subtotal + explicit completeness truth into a
 * truthful display value. Never infers unknown-ness from `valueUsd === 0` —
 * `costTruth` must be passed by the caller.
 */
export function resolveCostDisplay(input: CostDisplayInput): CostDisplayValue {
  const { valueUsd, costTruth, formatUsd, zeroDisplay = '$0.00' } = input;

  if (costTruth === 'complete') {
    return {
      label: valueUsd === 0 ? zeroDisplay : formatUsd(valueUsd),
      isPartial: false,
      description: null,
    };
  }

  if (valueUsd === 0) {
    return { label: UNKNOWN_COST_LABEL, isPartial: true, description: UNKNOWN_COST_DESCRIPTION };
  }

  return {
    label: `${formatUsd(valueUsd)}+`,
    isPartial: true,
    description: PARTIAL_COST_DESCRIPTION,
  };
}

/**
 * Resolves a *remaining* USD capacity display. Unlike a known-cost subtotal,
 * an incomplete consumed total does not yield a trustworthy lower bound for
 * what remains, so unknown truth renders as "Indeterminado" rather than a
 * numeric value with a '+' suffix.
 */
export function resolveRemainingCostDisplay(
  valueUsd: number,
  costTruth: CostTruth,
  formatUsd: (value: number) => string,
): CostDisplayValue {
  if (costTruth === 'unknown') {
    return {
      label: INDETERMINATE_REMAINING_LABEL,
      isPartial: true,
      description: INDETERMINATE_REMAINING_DESCRIPTION,
    };
  }
  return { label: formatUsd(valueUsd), isPartial: false, description: null };
}
