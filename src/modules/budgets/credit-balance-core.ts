// ============================================================
// budgets — cuánto se puede gastar este período bajo una regla (dueña 10-11)
// ============================================================
// Puro: sin base de datos. El servidor lee recargas, aprobaciones y consumo y
// aquí sólo se suma.
//
//   tope de hoy = límite de la regla
//               + recargas del período (para todo el pozo)
//               + lo aprobado a esta persona en el período
//               + reserva: lo que sobró en los períodos anteriores
//
// La reserva se acumula período a período desde noviembre de 2026 (antes no se
// cuenta: una regla vieja casi sin uso no aparece con una reserva enorme). En
// cada período cerrado: sobrante = límite + recargas + aprobaciones + reserva
// que traía − lo gastado, nunca negativo. Lo de un período cerrado se mide con
// el límite que la regla tiene hoy: el histórico de cambios del límite no se
// guarda.

import type { BudgetPeriodType, PeriodBounds, RuleCreditBalance } from './types';
import { getPeriodBounds } from './periods';

/** Primer período cuya sobra pasa al siguiente (dueña 10-11: «desde este mes»). */
export const CREDIT_ROLLOVER_START = new Date(Date.UTC(2026, 10, 1));

export type CreditAdjustmentKind = 'top_up' | 'grant';

export interface CreditAdjustment {
  periodStart: string;
  kind: CreditAdjustmentKind;
  credits: number;
  beneficiaryUserId: string | null;
}

/** Suma de lo que se agregó a un período: recargas y, aparte, lo aprobado. */
export function sumAdjustments(
  adjustments: readonly CreditAdjustment[],
  periodStartIso: string,
  userId: string | null,
): { topUps: number; grantsForUser: number; grantsTotal: number } {
  const target = Date.parse(periodStartIso);
  let topUps = 0;
  let grantsForUser = 0;
  let grantsTotal = 0;
  for (const adjustment of adjustments) {
    if (Date.parse(adjustment.periodStart) !== target) continue;
    const credits = Number.isFinite(adjustment.credits) && adjustment.credits > 0 ? adjustment.credits : 0;
    if (adjustment.kind === 'top_up') {
      topUps += credits;
    } else {
      grantsTotal += credits;
      if (userId !== null && adjustment.beneficiaryUserId === userId) grantsForUser += credits;
    }
  }
  return { topUps, grantsForUser, grantsTotal };
}

/**
 * Los períodos ya cerrados que cuentan para la reserva, del más viejo al más
 * nuevo: desde noviembre de 2026 (o desde el período en que nació la regla, si
 * es posterior) hasta el anterior al actual.
 */
export function closedPeriodsForRollover(
  periodType: BudgetPeriodType,
  now: Date,
  ruleCreatedAt: string | null,
): PeriodBounds[] {
  const current = getPeriodBounds(periodType, now);
  const createdMs = ruleCreatedAt ? Date.parse(ruleCreatedAt) : Number.NaN;
  const firstFrom = Number.isFinite(createdMs) && createdMs > CREDIT_ROLLOVER_START.getTime()
    ? new Date(createdMs)
    : CREDIT_ROLLOVER_START;

  const periods: PeriodBounds[] = [];
  let bounds = getPeriodBounds(periodType, firstFrom);
  // Tope de vueltas por si una fecha rara llegara a producir un bucle: 50 años de meses.
  for (let guard = 0; guard < 600 && bounds.start < current.start; guard += 1) {
    periods.push(bounds);
    bounds = getPeriodBounds(periodType, bounds.end);
  }
  return periods;
}

export interface ClosedPeriodFigures {
  /** Recargas + todo lo aprobado en ese período. */
  added: number;
  /** Lo que se gastó (y quedó reservado) en ese período. */
  consumed: number;
}

/** La reserva que llega al período actual, sumando sobrantes uno por uno. */
export function carryForward(baseLimit: number, closed: readonly ClosedPeriodFigures[]): number {
  let carry = 0;
  for (const period of closed) {
    const added = Number.isFinite(period.added) ? period.added : 0;
    const consumed = Number.isFinite(period.consumed) ? period.consumed : 0;
    carry = Math.max(0, baseLimit + added + carry - consumed);
  }
  return carry;
}

export function buildRuleCreditBalance(input: {
  base: number;
  topUps: number;
  grantsForUser: number;
  carriedIn: number;
}): RuleCreditBalance {
  return {
    ...input,
    effective: input.base + input.topUps + input.grantsForUser + input.carriedIn,
  };
}
