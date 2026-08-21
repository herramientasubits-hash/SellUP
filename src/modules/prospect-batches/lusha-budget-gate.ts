/**
 * lusha-budget-gate.ts — la ruta Lusha de Agente 1 no puede tocar al proveedor
 * antes de tener reserva de presupuesto.
 *
 * AGENT1-LUSHA-BUDGET-GATE-1 § 7/§ 8/§ 9/§ 10.
 *
 * El hueco que cierra: `generateLushaPendingReviewBatchAction` tenía UNA puerta,
 * la de flag (`guardLushaPreviewEnabled`). Con el flag encendido, la corrida
 * resolvía la credencial, construía el cliente y llamaba a Lusha sin que ninguna
 * reserva hubiera comprobado que el período tenía sitio. La ruta Apollo/Tavily
 * pasa por `try_reserve_wizard_credits` desde el paso 7; ésta no pasaba por
 * nada. No es un presupuesto propio de Lusha: es EL MISMO período global.
 *
 * Este módulo copia deliberadamente la forma de `guardLushaPreviewEnabled`:
 * control de flujo puro con `blocked()` y `run()` inyectados. La propiedad que
 * eso compra es estructural, no una convención de revisión — `run()` es lo
 * ÚNICO que resuelve la credencial, construye el cliente y llama a Lusha, así
 * que un bloqueo de presupuesto es incapaz de gastar, igual que un flag apagado.
 *
 * NO env, NO I/O, NO cliente de proveedor, NO DB. La reserva atómica llega
 * inyectada; aquí sólo se decide el orden.
 */

/** Instantánea del período, sólo para explicar un bloqueo ya decidido. */
export type LushaBudgetPeriodSnapshot = {
  availableCredits: number;
};

/** Reserva concedida por `try_reserve_wizard_credits`. */
export type LushaBudgetReservation = {
  status: 'reserved' | 'already_reserved';
  reservationId: string;
  creditsReserved: number;
};

/** Resultado de intentar reservar. `blocked` NUNCA debe llegar al proveedor. */
export type LushaBudgetReserveOutcome =
  | LushaBudgetReservation
  | {
      status: 'blocked';
      code: string;
      message: string;
      /** `null` si no se pudo leer el período (no se inventan cifras). */
      budgetSnapshot: LushaBudgetPeriodSnapshot | null;
    };

/**
 * Detalle estructurado del bloqueo, con la MISMA forma que el `budgetExceeded`
 * de la ruta Apollo (`wizard-execution-types` / `wizard-budget-preflight`), para
 * que el cliente lo redacte con `mapBudgetExceeded` y el aviso de Lusha no
 * pueda divergir del de Apollo ni en el texto ni en los números.
 */
export type LushaBudgetExceededDetail = {
  reason: 'exhausted' | 'insufficient_for_run';
  availableCredits: number;
  requiredCredits: number;
};

/** Código de error estable cuando el presupuesto bloquea la corrida. */
export const LUSHA_BUDGET_BLOCKED_ERROR = 'lusha_budget_blocked' as const;

/** Código estable cuando la reserva no pudo ni intentarse (fail-closed). */
export const LUSHA_BUDGET_UNAVAILABLE_ERROR = 'lusha_budget_unavailable' as const;

/** Mensaje genérico; el cliente lo sustituye cuando hay detalle estructurado. */
export const LUSHA_BUDGET_BLOCKED_MESSAGE =
  'El presupuesto de generación con IA no permite ejecutar esta búsqueda.';

/**
 * Motivo del bloqueo a partir del período leído.
 *
 * `null` cuando no hubo instantánea: se bloquea igual (la reserva ya dijo que
 * no), pero sin cifras inventadas. «Agotado» sólo si no queda NADA — la misma
 * distinción que ya hace Apollo.
 */
export function resolveLushaBudgetExceededDetail(
  snapshot: LushaBudgetPeriodSnapshot | null,
  requiredCredits: number,
): LushaBudgetExceededDetail | null {
  if (!snapshot) return null;
  if (!Number.isFinite(snapshot.availableCredits)) return null;
  return {
    reason: snapshot.availableCredits <= 0 ? 'exhausted' : 'insufficient_for_run',
    availableCredits: snapshot.availableCredits,
    requiredCredits,
  };
}

/**
 * Ejecuta el trabajo de Lusha SÓLO con reserva concedida.
 *
 * Orden (§ 10): el llamador ya pasó la puerta de flag y la autenticación; aquí
 * se reserva, y sólo un `reserved`/`already_reserved` invoca `run()`. Cualquier
 * otro camino —bloqueo de la RPC o excepción al intentar reservar— devuelve
 * `blocked()` sin haber tocado credencial ni proveedor. Falla CERRADO: a
 * diferencia del preflight de diagnóstico de la superficie (que ante un fallo de
 * lectura deja la pantalla intacta), aquí «no pude reservar» significa «no
 * ejecutas», porque lo que está en juego es el gasto y no un aviso.
 */
export async function guardLushaRunBudget<T>(
  reserve: () => Promise<LushaBudgetReserveOutcome>,
  blocked: (input: {
    code: string;
    message: string;
    budgetExceeded: LushaBudgetExceededDetail | null;
  }) => T,
  run: (reservation: LushaBudgetReservation) => Promise<T>,
  requiredCredits: number,
): Promise<T> {
  let outcome: LushaBudgetReserveOutcome;
  try {
    outcome = await reserve();
  } catch {
    // Credenciales de servicio ausentes, RPC inalcanzable, red caída… Ninguna de
    // esas cosas autoriza gastar. No se filtra el mensaje crudo.
    return blocked({
      code: LUSHA_BUDGET_UNAVAILABLE_ERROR,
      message: LUSHA_BUDGET_BLOCKED_MESSAGE,
      budgetExceeded: null,
    });
  }

  if (outcome.status === 'blocked') {
    return blocked({
      code: LUSHA_BUDGET_BLOCKED_ERROR,
      message: LUSHA_BUDGET_BLOCKED_MESSAGE,
      budgetExceeded: resolveLushaBudgetExceededDetail(
        outcome.budgetSnapshot,
        requiredCredits,
      ),
    });
  }

  return run(outcome);
}

// ── Reconciliación (§ 9) ──────────────────────────────────────────────────────

/**
 * Cuántos créditos confirmar tras una corrida que SÍ llegó al proveedor.
 *
 * `creditsChargedTotal` es la suma de `billing.creditsCharged` que Lusha
 * reportó por página, y es `null` cuando NINGUNA página reportó un número.
 *
 *   · `null` → gasto no verificable ⇒ se confirma la reserva ENTERA. Mismo sesgo
 *     conservador que la ruta Apollo/Tavily: ante duda no se devuelve headroom.
 *   · número ≥ 0 → gasto verificado ⇒ se confirma ese número, y el headroom no
 *     usado vuelve al período (lo hace `confirm_wizard_credits`, igual que para
 *     Apollo). Aquí un 0 sí se respeta, al contrario que en el camino Tavily
 *     (`consumed > 0 ? consumed : reserved`), porque para Lusha «0 cobrado» y
 *     «no reportado» son dos valores DISTINTOS del payload del proveedor, no el
 *     mismo hueco: el core ya los separa (`addCredits` deja `null` intacto).
 *   · número > reservado → se confirma lo reportado, no se recorta a la reserva.
 *     Un sobrepaso real debe quedar registrado como sobrepaso.
 */
export function decideLushaCreditsToConfirm(input: {
  creditsReserved: number;
  creditsChargedTotal: number | null | undefined;
}): number {
  const { creditsReserved, creditsChargedTotal } = input;
  if (typeof creditsChargedTotal !== 'number' || !Number.isFinite(creditsChargedTotal)) {
    return creditsReserved;
  }
  if (creditsChargedTotal < 0) return creditsReserved;
  return creditsChargedTotal;
}

/**
 * ¿Se libera la reserva en lugar de confirmarla?
 *
 * Sólo cuando la corrida es estructuralmente incapaz de haber gastado: no se
 * pidió ninguna página Y no hay cobro reportado. Un fallo DESPUÉS de la primera
 * petición se confirma conservador, porque el proveedor pudo cobrarla — es la
 * misma regla que la ruta Apollo aplica en su `catch` del pipeline.
 */
export function shouldReleaseLushaReservation(input: {
  pagesRequested: number | null | undefined;
  creditsChargedTotal: number | null | undefined;
}): boolean {
  const { pagesRequested, creditsChargedTotal } = input;
  if (typeof creditsChargedTotal === 'number' && creditsChargedTotal > 0) return false;
  return pagesRequested === 0;
}

// ── Liquidación observable (AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 § 10/§ 11/§ 12) ──
//
// Lo que faltaba: `settleReservation` devolvía `Promise<void>` y sus dos llamadas
// hacían `.catch(() => undefined)`. Eso deja TRES hechos distintos —liquidada,
// liquidada con sobrepaso, y no liquidada— con exactamente la misma huella: ninguna.
// El sobrepaso que la migración 121 ahora sabe registrar seguiría siendo invisible,
// y un fallo de reconciliación (la RPC caída, credenciales de servicio ausentes)
// también.
//
// Estos tipos y funciones son PUROS: no escriben en consola, no leen entorno y no
// tocan la DB. Deciden QUÉ es digno de registrarse y con qué campos; quién lo
// escribe es la server action. Así el contenido del log se puede probar sin
// interceptar `console`.

/** Resultado de liquidar la reserva de una corrida Lusha. Nunca lanza. */
export type LushaBudgetSettlementOutcome =
  | { status: 'confirmed' }
  | {
      status: 'confirmed_with_overage';
      creditsReserved: number;
      creditsActual: number;
      overageCredits: number;
    }
  | { status: 'released' }
  /** La reserva ya estaba cerrada (confirmada o liberada): nada que liquidar. */
  | { status: 'already_terminal' }
  /** La liquidación NO ocurrió. `code` es una clasificación estable, nunca un mensaje crudo. */
  | {
      status: 'failed';
      code: string;
      /**
       * Los créditos que se INTENTÓ liquidar. `null` cuando la liquidación fue una
       * liberación (no hay número que confirmar) o cuando lanzó antes de decidirlo.
       */
      creditsReportedActual: number | null;
    };

/** Código estable del log de sobrepaso confirmado. */
export const LUSHA_BUDGET_OVERAGE_LOG_CODE = 'lusha_budget_overage_confirmed' as const;

/** Código estable del log de liquidación fallida. */
export const LUSHA_BUDGET_SETTLEMENT_FAILED_LOG_CODE =
  'lusha_budget_settlement_failed' as const;

/** Clasificación cuando la liquidación lanzó en lugar de devolver un código de la RPC. */
export const LUSHA_BUDGET_SETTLEMENT_THREW_CODE = 'settlement_threw' as const;

/**
 * Telemetría segura de una liquidación, o `null` cuando no hay nada que reportar.
 *
 * Sólo dos salidas producen log: el sobrepaso (§ 11) y el fallo (§ 12). Una
 * liquidación normal, una liberación y un `already_terminal` son el curso esperado
 * y ya viajan en el log de la corrida.
 *
 * Los campos son deliberadamente CIFRAS e IDs internos. Nada de payload crudo del
 * proveedor, nada de clave de API, ningún dato de la empresa o de la persona: un log
 * de contabilidad no necesita saber a quién se buscó, y si lo supiera se convertiría
 * en una copia no gobernada de los datos del proveedor.
 */
export function buildLushaBudgetSettlementTelemetry(
  outcome: LushaBudgetSettlementOutcome,
  context: { reservationId: string; creditsReserved: number; batchId?: string | null },
): { code: string; payload: Record<string, unknown> } | null {
  if (outcome.status === 'confirmed_with_overage') {
    return {
      code: LUSHA_BUDGET_OVERAGE_LOG_CODE,
      payload: {
        provider: 'lusha',
        reservationId: context.reservationId,
        creditsReserved: outcome.creditsReserved,
        creditsReportedActual: outcome.creditsActual,
        overageCredits: outcome.overageCredits,
        batchId: context.batchId ?? null,
      },
    };
  }

  if (outcome.status === 'failed') {
    return {
      code: LUSHA_BUDGET_SETTLEMENT_FAILED_LOG_CODE,
      payload: {
        provider: 'lusha',
        reservationId: context.reservationId,
        creditsReserved: context.creditsReserved,
        creditsReportedActual: outcome.creditsReportedActual,
        rpcCode: outcome.code,
        batchId: context.batchId ?? null,
      },
    };
  }

  return null;
}
