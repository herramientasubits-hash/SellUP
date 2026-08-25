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
// La traducción respeta la semántica del módulo de presupuestos. La LÓGICA de este
// módulo no ha cambiado desde 4E; lo que cambió es qué SIGNIFICA uno de sus tres
// resultados aguas abajo (AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1):
//
//   * SIN regla de crédito aplicable ⇒ `not_configured` = UNBOUNDED, y eso YA NO
//     BLOQUEA. 4D lo llamaba `unlimited` y autorizaba; 4E lo convirtió en bloqueo. Con
//     Apollo sin regla en Producción, ese bloqueo dejaba el clic del operador en 0
//     corridas, 0 reservas y 0 llamadas. Ahora significa lo que literalmente es: no hay
//     TOPE PRESUPUESTARIO INTERNO que aplicar. Un límite expresado SOLO en USD tampoco
//     produce saldo en créditos y cae aquí: el preflight compara créditos contra
//     créditos.
//
//     🔴 «Sin regla» NO significa que el proveedor sea gratis. Este módulo no habla del
//     precio: `provider_usage_logs` sigue siendo la verdad del gasto, un costo no
//     reportado sigue siendo `unknown` y jamás 0, y nada de esto crea una `budget_rule`,
//     un límite de 500, un infinito simulado ni un costo 0.
//   * CON regla de crédito ⇒ `configured` con límite, consumo y la identidad del pozo
//     (el consumo puede igualar o superar el límite: 0 disponible es un dato, no una
//     ausencia de dato). Se respeta el límite, el consumo y las reservas vivas,
//     exactamente como antes.
//   * FALLO de lectura ⇒ `unavailable`, fail-closed, SIN CAMBIOS. No se autoriza gasto
//     sobre un presupuesto que nadie pudo leer, y el copy que ve el operador dice
//     exactamente eso — nunca "no hay créditos suficientes", que sería afirmar un hecho
//     que no se comprobó.
//
// Los dos últimos son la razón por la que este módulo devuelve tres estados y no un
// `number | null`: «no hay regla» ahora autoriza y «no se pudo leer la regla» sigue
// bloqueando, así que colapsarlos convertiría un fallo de infraestructura en permiso
// para gastar.

import { checkBudget } from '@/modules/budgets/budget-resolution';
import type {
  PhoneRevealCreditPool,
  PhoneRevealCreditPoolState,
  PhoneRevealCreditProviderKey,
} from './phone-reveal-credit-budget-core';

/**
 * Regla de crédito de UN proveedor. Cualquier excepción se convierte en `unavailable`
 * (nunca en `not_configured`): un error de lectura no puede leerse como "no hay regla".
 *
 * Esa distinción es MÁS crítica desde
 * AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1, no menos: `not_configured` ahora
 * autoriza sin techo, así que degradar un fallo de lectura a `not_configured` sería
 * convertir un error de infraestructura en una autorización de gasto ilimitada.
 */
async function readProviderCreditPool(
  providerKey: PhoneRevealCreditProviderKey,
  internalUserId: string,
): Promise<PhoneRevealCreditPoolState> {
  try {
    const result = await checkBudget(providerKey, internalUserId);
    const rule = result.matchedRule;

    // `scopeApplied === 'none'` y `limitCredits === null` significan lo mismo para este
    // gate: no hay TOPE EN CRÉDITOS que aplicar. Es una lectura EXITOSA cuyo resultado
    // es "no hay regla", no un fallo — por eso sale por aquí y no por el `catch`.
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

    // Exposición ya reservada en el MISMO pozo (AGENT2A-PHONE-REVEAL-4N). Antes de este
    // hito el preflight la ignoraba —`reservedCredits` llegaba ausente y el core la
    // trataba como 0—, así que una autorización en vuelo no ocupaba saldo hasta que la
    // reserva atómica la rechazaba. Ahora el preflight ve exactamente lo mismo que el SQL.
    // Una cifra rota se trata como NO verificable, igual que el límite y el consumo.
    const reservedCredits = result.reservedCredits;
    if (typeof reservedCredits !== 'number' || !Number.isFinite(reservedCredits)) {
      return { kind: 'unavailable' };
    }

    return {
      kind: 'configured',
      limitCredits,
      consumedCredits,
      reservedCredits,
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
