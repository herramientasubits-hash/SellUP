/**
 * wizard-pilot-types.ts — Types and result codes for the wizard pilot guardrails.
 *
 * Server-only. Never import from client components.
 *
 * These types are wired up in the NEXT hito (16AB.43.17). They exist here so the
 * service layer (wizard-pilot-guardrails.ts, wizard-budget-reservations.ts) can
 * be typed without referencing the wizard action.
 */

// ── DB row types (read from Supabase) ────────────────────────────────────────

export type WizardPilotSettings = {
  id: string;
  pilotEnabled: boolean;
  maxCreditsPerExecution: number;
  maxActiveExecutionsPerUser: number;
  budgetTimezone: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type WizardPilotParticipant = {
  userId: string;
  isEnabled: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  enabledBy: string | null;
};

export type WizardMonthlyBudgetPeriod = {
  periodStart: string; // ISO date 'YYYY-MM-01'
  budgetCredits: number;
  creditsReserved: number;
  creditsConsumed: number;
  isClosed: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type WizardBudgetReservation = {
  id: string;
  periodStart: string;
  userId: string;
  clientRequestId: string;
  batchId: string | null;
  creditsReserved: number;
  creditsConsumed: number;
  status: WizardReservationStatus;
  createdAt: string;
  confirmedAt: string | null;
  releasedAt: string | null;
  metadata: Record<string, unknown>;
};

export type WizardReservationStatus = 'reserved' | 'confirmed' | 'released' | 'failed';

// ── RPC result codes ─────────────────────────────────────────────────────────
//
// These codes are returned by try_reserve_wizard_credits, confirm_wizard_credits,
// and release_wizard_credits. They are kept as string literals so they can be
// compared without importing an enum.

export type ReserveCreditsResult =
  | 'reserved'
  | 'already_reserved'
  | 'pilot_paused'
  | 'user_not_allowed'
  | 'period_not_configured'
  | 'period_closed'
  | 'execution_limit_exceeded'
  | 'insufficient_budget'
  | 'concurrent_execution_active';

export type ConfirmCreditsResult =
  | 'confirmed'
  // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 (migración 121) — la liquidación SÍ ocurrió
  // y es terminal; lo que la distingue de `confirmed` es que el proveedor cobró MÁS
  // de lo reservado y el período registró el excedente entero. Es un ÉXITO, no un
  // error: tratarla como fallo devolvería el defecto que la 121 cierra (la reserva
  // se quedaba en `reserved` y bloqueaba la corrida siguiente). Se mantiene como
  // código propio —y no colapsado en `confirmed`— porque un sobrepaso real es lo
  // único que el llamador tiene que poder registrar sin volver a leer la fila.
  | 'confirmed_with_overage'
  | 'already_confirmed'
  | 'reservation_not_found'
  | 'invalid_actual_credits';

export type ReleaseCreditsResult =
  | 'released'
  | 'already_released'
  | 'already_confirmed'
  | 'reservation_not_found';

// ── Pilot guardrail error codes ──────────────────────────────────────────────
//
// Used by the future wizard action when the guardrail layer is connected.
// Defined here so the action can import them without circular deps.

export type PilotGuardrailCode =
  | 'PILOT_PAUSED'
  | 'NOT_IN_PILOT'
  | 'BUDGET_PERIOD_NOT_CONFIGURED'
  | 'BUDGET_PERIOD_CLOSED'
  | 'EXECUTION_CREDIT_LIMIT_EXCEEDED'
  | 'BUDGET_EXCEEDED'
  | 'CONCURRENT_EXECUTION_ACTIVE'
  | 'BUDGET_RESERVATION_FAILED';

export class PilotGuardrailError extends Error {
  constructor(
    public readonly code: PilotGuardrailCode,
    message: string,
  ) {
    super(message);
    this.name = 'PilotGuardrailError';
  }
}

// ── Reserve input / output ───────────────────────────────────────────────────

export type ReserveWizardCreditsInput = {
  userId: string;
  clientRequestId: string;
  requestedCredits: number;
  periodStart: string; // 'YYYY-MM-01'
};

export type ReserveWizardCreditsOutput =
  | { status: 'reserved'; reservationId: string }
  | { status: 'already_reserved' }
  | { status: 'blocked'; code: PilotGuardrailCode; message: string };

// ── Confirm input / output ───────────────────────────────────────────────────

export type ConfirmWizardCreditsInput = {
  reservationId: string;
  actualCreditsConsumed: number;
  batchId?: string | null;
  /**
   * Lo que la reserva sostiene, SÓLO para poder describir un sobrepaso.
   *
   * Opcional y sin efecto sobre la liquidación: quien decide si hubo sobrepaso es
   * la RPC (que tiene la fila bloqueada), nunca este número. Cuando falta, la
   * salida `confirmed_with_overage` llega con `creditsReserved`/`overageCredits`
   * en `null` — el sobrepaso sigue siendo un hecho, sólo sin su magnitud, y eso
   * es preferible a inventarla o a hacer una segunda lectura que puede fallar.
   */
  creditsReserved?: number | null;
};

export type ConfirmWizardCreditsOutput =
  | { status: 'confirmed' }
  /**
   * Liquidada con sobrepaso (migración 121). Es un resultado EXITOSO.
   *
   * Lleva las dos cifras porque el llamador ya no puede derivarlas: la RPC no
   * devuelve la fila, y `credits_reserved` se conserva a propósito sin reescribir
   * (el par reservado/consumido ES la evidencia del sobrepaso). Sin ellas, un log
   * de sobrepaso tendría que releer `wizard_budget_reservations` —una segunda
   * lectura que puede fallar— para poder decir de cuánto fue.
   *
   * `creditsReserved` y `creditsActual` son lo que el llamador pidió y lo que la
   * RPC confirmó; `overageCredits` es la diferencia, siempre > 0 en esta rama.
   */
  | {
      status: 'confirmed_with_overage';
      creditsReserved: number | null;
      creditsActual: number;
      overageCredits: number | null;
    }
  | { status: 'already_confirmed' }
  | { status: 'error'; code: ConfirmCreditsResult; message: string };

// ── Release input / output ───────────────────────────────────────────────────

export type ReleaseWizardCreditsInput = {
  reservationId: string;
  batchId?: string | null;
  reason?: string | null;
};

export type ReleaseWizardCreditsOutput =
  | { status: 'released' }
  | { status: 'already_released' }
  | { status: 'already_confirmed' }
  | { status: 'error'; code: ReleaseCreditsResult; message: string };
