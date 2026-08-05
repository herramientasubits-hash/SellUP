// Agente 2A — Resolución del presupuesto de créditos del reveal de teléfono
// (AGENT2A-PHONE-WATERFALL-4D, endurecido en 4E)
//
// Único punto con I/O del preflight. La decisión vive en el core PURO
// (phone-reveal-credit-budget-core.ts) y la reserva ATÓMICA en la migración 104; aquí
// solo se RESUELVE la regla de crédito de cada proveedor y se traduce al vocabulario del
// core. No escribe, no reserva, no descuenta y no llama a ningún proveedor:
// `checkBudget` es de solo lectura por contrato.
//
// EL MODELO ES POR PROVEEDOR. `checkBudget(providerKey, userId)` resuelve UNA regla de
// `budget_rules` para ese proveedor caminando user → group → role → global y agrega el
// consumo de `provider_usage_logs` dentro del período de la regla. Por eso este módulo
// devuelve UN POZO POR PROVEEDOR —con su límite, su consumo, su scope y su período— y no
// un número combinado: los 8 de Apollo solo pueden salir de la regla de Apollo y los 5
// de Lusha de la de Lusha. La identidad del pozo (scope + período) viaja porque es lo
// que la reserva atómica necesita para sumar la exposición del pozo CORRECTO.
//
// La traducción respeta la semántica del módulo de presupuestos, con UN cambio
// deliberado respecto de 4D:
//
//   * SIN regla de crédito aplicable ⇒ `not_configured`, y eso BLOQUEA. En 4D esto era
//     `unlimited` y autorizaba el gasto. Con reserva atómica ya no puede serlo: no hay
//     disponibilidad contra la que reservar, así que el waterfall no arranca en vez de
//     correr sobre un techo imaginario. Un límite expresado SOLO en USD tampoco produce
//     saldo en créditos y cae aquí: el preflight compara créditos contra créditos.
//   * CON regla de crédito ⇒ `configured` con límite, consumo y la identidad del pozo
//     (el consumo puede igualar o superar el límite: 0 disponible es un dato, no una
//     ausencia de dato).
//   * FALLO de lectura ⇒ `unavailable`, fail-closed. No se autoriza gasto sobre un
//     presupuesto que nadie pudo leer, y el copy que ve el operador dice exactamente
//     eso — nunca "no hay créditos suficientes", que sería afirmar un hecho que no se
//     comprobó, ni "no hay presupuesto configurado", que sería otro.

import { checkBudget } from '@/modules/budgets/budget-resolution';
import type {
  PhoneRevealCreditPool,
  PhoneRevealCreditPoolState,
  PhoneRevealCreditProviderKey,
} from './phone-reveal-credit-budget-core';

/**
 * Regla de crédito de UN proveedor. Cualquier excepción se convierte en `unavailable`
 * (nunca en `not_configured`): un error de lectura no puede leerse como "no hay regla".
 */
async function readProviderCreditPool(
  providerKey: PhoneRevealCreditProviderKey,
  internalUserId: string,
): Promise<PhoneRevealCreditPoolState> {
  try {
    const result = await checkBudget(providerKey, internalUserId);
    const rule = result.matchedRule;

    // `scopeApplied === 'none'` y `limitCredits === null` significan lo mismo para este
    // gate: no hay disponibilidad EN CRÉDITOS que reservar.
    if (!rule || rule.limitCredits === null || result.scopeApplied === 'none') {
      return { kind: 'not_configured' };
    }

    const limitCredits = rule.limitCredits;
    const consumedCredits = result.consumedCredits;
    if (
      typeof limitCredits !== 'number' ||
      !Number.isFinite(limitCredits) ||
      typeof consumedCredits !== 'number' ||
      !Number.isFinite(consumedCredits)
    ) {
      // Cifras rotas del driver: NO verificable, no "grande".
      return { kind: 'unavailable' };
    }

    return {
      kind: 'configured',
      limitCredits,
      consumedCredits,
      scopeType: result.scopeApplied,
      scopeId: rule.scopeId,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
    };
  } catch (err) {
    // Sin PII: solo el mensaje mecánico. El presupuesto no maneja datos personales,
    // pero el mensaje del driver puede arrastrar cualquier cosa.
    console.error(
      '[phone-reveal-credit-budget] budget resolution failed, failing closed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { kind: 'unavailable' };
  }
}

/**
 * Pozos de los proveedores que la autorización puede llegar a llamar. Se leen en
 * paralelo: son lecturas independientes y ninguna depende de la otra.
 */
export async function readPhoneRevealCreditPools(
  providerKeys: readonly PhoneRevealCreditProviderKey[],
  internalUserId: string,
): Promise<readonly PhoneRevealCreditPool[]> {
  return Promise.all(
    providerKeys.map(async (providerKey) => ({
      providerKey,
      state: await readProviderCreditPool(providerKey, internalUserId),
    })),
  );
}
