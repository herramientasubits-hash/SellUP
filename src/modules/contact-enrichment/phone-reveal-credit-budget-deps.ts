// Agente 2A — Lectura del saldo de créditos del reveal de teléfono
// (AGENT2A-PHONE-WATERFALL-4D)
//
// Único punto con I/O del preflight de saldo. La decisión vive en el core PURO
// (phone-reveal-credit-budget-core.ts); aquí solo se LEE el saldo y se traduce a su
// vocabulario. No escribe, no reserva, no descuenta y no llama a ningún proveedor:
// `checkBudget` es de solo lectura por contrato.
//
// La traducción respeta la semántica que ya tiene el módulo de presupuestos, y esa
// fidelidad es deliberada:
//
//   * SIN regla de crédito aplicable ⇒ `unlimited`. No se inventa un tope: si un
//     administrador no configuró límite de créditos para el proveedor, este gate no
//     puede bloquear una revelación que hoy funciona.
//   * CON regla de crédito ⇒ `available` con el saldo restante del período (0
//     incluido: 0 es un saldo, no una ausencia de dato).
//   * FALLO de lectura ⇒ `unavailable`, fail-closed. No se autoriza gasto sobre un
//     saldo que nadie pudo verificar, y el copy que ve el operador dice exactamente
//     eso — nunca "no hay créditos suficientes", que sería afirmar un hecho que no
//     se comprobó.
//
// Un límite expresado SOLO en USD no produce un saldo en créditos: el preflight
// compara créditos contra créditos, así que ese caso queda `unlimited` aquí y sigue
// gobernado por la política de presupuesto existente, que no cambia en este hito.

import { checkBudget } from '@/modules/budgets/budget-resolution';
import {
  combinePhoneRevealCreditBalances,
  type PhoneRevealCreditBalance,
} from './phone-reveal-credit-budget-core';

/**
 * Saldo de UN proveedor. Cualquier excepción se convierte en `unavailable` (nunca
 * en `unlimited`): un error de lectura no puede leerse como "no hay límite".
 */
async function readProviderCreditBalance(
  providerKey: string,
  internalUserId: string,
): Promise<PhoneRevealCreditBalance> {
  try {
    const result = await checkBudget(providerKey, internalUserId);
    const limitCredits = result.matchedRule?.limitCredits ?? null;
    if (limitCredits === null) return { kind: 'unlimited' };
    const remaining = result.remainingCredits;
    if (typeof remaining !== 'number' || !Number.isFinite(remaining)) {
      return { kind: 'unavailable' };
    }
    return { kind: 'available', credits: remaining };
  } catch (err) {
    // Sin PII: solo el mensaje mecánico. El presupuesto no maneja datos personales,
    // pero el mensaje del driver puede arrastrar cualquier cosa.
    console.error(
      '[phone-reveal-credit-budget] balance read failed, failing closed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { kind: 'unavailable' };
  }
}

/**
 * Saldo COMBINADO de los proveedores que la autorización puede llegar a llamar. La
 * combinación (fail-closed, mínimo de los saldos) vive en el core puro.
 *
 * Se lee en paralelo: son dos lecturas de solo lectura y ninguna depende de la otra.
 */
export async function readPhoneRevealCreditBalance(
  providerKeys: readonly string[],
  internalUserId: string,
): Promise<PhoneRevealCreditBalance> {
  const balances = await Promise.all(
    providerKeys.map((providerKey) =>
      readProviderCreditBalance(providerKey, internalUserId),
    ),
  );
  return combinePhoneRevealCreditBalances(balances);
}
