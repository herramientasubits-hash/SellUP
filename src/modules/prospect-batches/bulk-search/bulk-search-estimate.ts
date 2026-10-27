import type { BulkRoundWorstCase, BulkTargetCount } from './bulk-search-types';

/**
 * El tope de créditos de una búsqueda masiva, antes de arrancar. Puro: el
 * servidor le pasa el peor caso de una ronda por proveedor (lo mismo que ya
 * reserva una corrida normal) y aquí sólo se multiplica.
 *
 * Lo confirma Growth en pantalla, pero el que se guarda es SIEMPRE el que
 * vuelve a calcular el servidor (PR 2): un número del cliente nunca autoriza
 * gasto.
 */

/** Una corrida del asistente apunta a al menos 5 empresas (`WIZARD_TARGET_USEFUL_COMPANIES`). */
export const BULK_ROUND_MIN_YIELD = 5;
/**
 * Lo que rinde una ronda para calcular el tope (entrega entre 5 y 10). Con 10,
 * el tope de 200 empresas es la mitad que con 5; como una ronda casi nunca gasta
 * su peor caso, alcanza para más rondas de las que dice la cuenta.
 */
export const BULK_ESTIMATE_ROUND_YIELD = 10;
/** Margen de rondas sobre las necesarias en el peor rendimiento. */
export const BULK_EXTRA_ROUNDS = 2;
/** Lo que dura una ronda, en minutos (una corrida del asistente: de 2 a 5). */
export const BULK_ROUND_MINUTES = { min: 2, max: 5 } as const;

export interface BulkSearchEstimate {
  targetCount: BulkTargetCount;
  /** Rondas que el tope paga en el rendimiento de cálculo. */
  plannedRounds: number;
  /** Techo duro de rondas: la búsqueda se detiene ahí aunque falten empresas. */
  maxRounds: number;
  /** El peor caso PAGO de una ronda (Apollo + Lusha): la unidad con la que se cuida el tope. */
  perRoundPaidCredits: number;
  /** El tope de créditos pagos de la búsqueda entera. */
  creditCap: number;
  /** Desglose por proveedor, para mostrarlo y para chequear cada cupo mensual. */
  breakdown: { apollo: number; lusha: number; tavily: number };
  /** Cuánto puede tardar, con SellUp abierto. */
  minutes: { min: number; max: number };
}

export function bulkMaxRounds(targetCount: BulkTargetCount): number {
  return Math.ceil(targetCount / BULK_ROUND_MIN_YIELD) + BULK_EXTRA_ROUNDS;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function estimateBulkSearch(targetCount: BulkTargetCount, perRound: BulkRoundWorstCase): BulkSearchEstimate {
  const apollo = nonNegative(perRound.apollo);
  const lusha = nonNegative(perRound.lusha);
  const tavily = nonNegative(perRound.tavily);
  const plannedRounds = Math.ceil(targetCount / BULK_ESTIMATE_ROUND_YIELD);
  const maxRounds = bulkMaxRounds(targetCount);
  const perRoundPaidCredits = apollo + lusha;
  return {
    targetCount,
    plannedRounds,
    maxRounds,
    perRoundPaidCredits,
    creditCap: plannedRounds * perRoundPaidCredits,
    breakdown: {
      apollo: plannedRounds * apollo,
      lusha: plannedRounds * lusha,
      // Tavily no entra en el tope pagado: lo acotan las rondas máximas y su cupo.
      tavily: maxRounds * tavily,
    },
    minutes: {
      min: plannedRounds * BULK_ROUND_MINUTES.min,
      max: Math.ceil(targetCount / BULK_ROUND_MIN_YIELD) * BULK_ROUND_MINUTES.max,
    },
  };
}

/**
 * ¿El tope que confirmó Growth cubre el que calcula el servidor? Si el servidor
 * calcula más (cambió un precio, se encendió Lusha), hay que volver a confirmar.
 */
export function confirmedCapCoversEstimate(confirmedCreditCap: unknown, estimate: BulkSearchEstimate): boolean {
  return (
    typeof confirmedCreditCap === 'number' &&
    Number.isFinite(confirmedCreditCap) &&
    confirmedCreditCap >= estimate.creditCap
  );
}
