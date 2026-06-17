/**
 * wizard-budget-reservations.ts — Reserve, confirm, and release credit wrappers.
 *
 * Server-only. Never import from client components.
 * Not connected to executeProspectWizardGenerationAction yet (16AB.43.17).
 *
 * Wraps the three Supabase RPC functions with typed inputs/outputs and
 * injectable DB client for testability.
 *
 * Consumption policy (section 20 of spec):
 * When actual consumption cannot be verified (e.g., provider_usage_logs failed),
 * callers SHOULD pass actualCreditsConsumed = reservation.creditsReserved to avoid
 * underestimating budget. This is a caller convention enforced upstream; this file
 * does not implement the reconciliation logic.
 */

import type {
  ReserveWizardCreditsInput,
  ReserveWizardCreditsOutput,
  ConfirmWizardCreditsInput,
  ConfirmWizardCreditsOutput,
  ReleaseWizardCreditsInput,
  ReleaseWizardCreditsOutput,
  ReserveCreditsResult,
  ConfirmCreditsResult,
  ReleaseCreditsResult,
  PilotGuardrailCode,
} from './wizard-pilot-types';

// ── Injectable RPC client interface ─────────────────────────────────────────

export type RpcResult<T> = { data: T | null; error: { message: string; code?: string } | null };

export type BudgetReservationsRpcClient = {
  rpc(
    fn: 'try_reserve_wizard_credits',
    params: {
      p_user_id: string;
      p_client_request_id: string;
      p_requested_credits: number;
      p_period_start: string;
    },
  ): Promise<RpcResult<string>>;
  rpc(
    fn: 'confirm_wizard_credits',
    params: {
      p_reservation_id: string;
      p_actual_credits_consumed: number;
      p_batch_id?: string | null;
    },
  ): Promise<RpcResult<string>>;
  rpc(
    fn: 'release_wizard_credits',
    params: {
      p_reservation_id: string;
      p_batch_id?: string | null;
      p_reason?: string | null;
    },
  ): Promise<RpcResult<string>>;
};

// ── Reserve ──────────────────────────────────────────────────────────────────

const RESERVE_TO_GUARDRAIL: Partial<Record<ReserveCreditsResult, PilotGuardrailCode>> = {
  pilot_paused:               'PILOT_PAUSED',
  user_not_allowed:           'NOT_IN_PILOT',
  period_not_configured:      'BUDGET_PERIOD_NOT_CONFIGURED',
  period_closed:              'BUDGET_PERIOD_CLOSED',
  execution_limit_exceeded:   'EXECUTION_CREDIT_LIMIT_EXCEEDED',
  insufficient_budget:        'BUDGET_EXCEEDED',
  concurrent_execution_active: 'CONCURRENT_EXECUTION_ACTIVE',
};

export async function reserveWizardPilotCredits(
  input: ReserveWizardCreditsInput,
  db: BudgetReservationsRpcClient,
): Promise<ReserveWizardCreditsOutput> {
  const { data, error } = await db.rpc('try_reserve_wizard_credits', {
    p_user_id:           input.userId,
    p_client_request_id: input.clientRequestId,
    p_requested_credits: input.requestedCredits,
    p_period_start:      input.periodStart,
  });

  if (error) {
    return {
      status: 'blocked',
      code: 'BUDGET_RESERVATION_FAILED',
      message: error.message,
    };
  }

  const result = data as ReserveCreditsResult | null;

  if (result === 'reserved') {
    // The RPC doesn't return the reservation id directly; callers needing
    // the id should query by (user_id, client_request_id). For now the output
    // returns a stable sentinel so the future action can differentiate.
    return { status: 'reserved', reservationId: '' };
  }

  if (result === 'already_reserved') {
    return { status: 'already_reserved' };
  }

  const guardrailCode = result ? RESERVE_TO_GUARDRAIL[result] : undefined;
  return {
    status: 'blocked',
    code: guardrailCode ?? 'BUDGET_RESERVATION_FAILED',
    message: result ?? 'unknown_reserve_result',
  };
}

// ── Confirm ──────────────────────────────────────────────────────────────────

export async function confirmWizardPilotCredits(
  input: ConfirmWizardCreditsInput,
  db: BudgetReservationsRpcClient,
): Promise<ConfirmWizardCreditsOutput> {
  const { data, error } = await db.rpc('confirm_wizard_credits', {
    p_reservation_id:         input.reservationId,
    p_actual_credits_consumed: input.actualCreditsConsumed,
    p_batch_id:               input.batchId ?? null,
  });

  if (error) {
    return { status: 'error', code: 'reservation_not_found', message: error.message };
  }

  const result = data as ConfirmCreditsResult | null;

  switch (result) {
    case 'confirmed':         return { status: 'confirmed' };
    case 'already_confirmed': return { status: 'already_confirmed' };
    default:
      return {
        status: 'error',
        code: (result as ConfirmCreditsResult) ?? 'reservation_not_found',
        message: result ?? 'unknown_confirm_result',
      };
  }
}

// ── Release ──────────────────────────────────────────────────────────────────

export async function releaseWizardPilotCredits(
  input: ReleaseWizardCreditsInput,
  db: BudgetReservationsRpcClient,
): Promise<ReleaseWizardCreditsOutput> {
  const { data, error } = await db.rpc('release_wizard_credits', {
    p_reservation_id: input.reservationId,
    p_batch_id:       input.batchId ?? null,
    p_reason:         input.reason ?? null,
  });

  if (error) {
    return { status: 'error', code: 'reservation_not_found', message: error.message };
  }

  const result = data as ReleaseCreditsResult | null;

  switch (result) {
    case 'released':          return { status: 'released' };
    case 'already_released':  return { status: 'already_released' };
    case 'already_confirmed': return { status: 'already_confirmed' };
    default:
      return {
        status: 'error',
        code: (result as ReleaseCreditsResult) ?? 'reservation_not_found',
        message: result ?? 'unknown_release_result',
      };
  }
}
