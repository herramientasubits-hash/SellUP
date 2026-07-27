// Agente 2A — Apollo Phone Reveal: POLL scaffold (APOLLO-PHONE-ASYNC-1)
//
// SCAFFOLD ONLY. The primary delivery path for an async reveal is the webhook
// (phone-reveal-webhook-core.ts). This module prepares the FALLBACK path used
// when a webhook is lost: recovering the result by polling Apollo with the
// stored request_id. It is intentionally inert:
//
//   * NO network / NO fetch — it only DESCRIBES the request to make.
//   * NO Supabase / NO env / NO logs.
//   * NO automatic/scheduled job is wired in this hito (that would expand scope
//     and risk spending credits without a human trigger). A future milestone can
//     drive this from an explicit action or a capped cron.
//
// It stays pure so the correlation + eligibility logic is unit-tested offline,
// and so the webhook core can process whatever the poll retrieves (the poll
// returns the same payload shape the webhook receives).

import type { ApolloPhoneRevealWebhookPayload } from './phone-reveal-webhook-core';

/** Endpoint de Apollo para consultar el resultado de un reveal por request_id. */
export const APOLLO_PHONE_REVEAL_RESULT_PATH = '/api/v1/people/match/result';

/** Estados en vuelo que justifican un poll de recuperación. */
export const POLLABLE_STATUSES: readonly string[] = ['requested', 'pending'];

// ── Proyección mínima para decidir el poll ─────────────────────

export interface PollableCandidateRecord {
  id: string;
  phoneRevealStatus: string | null;
  phoneRevealRequestId: string | null;
}

// ── Plan de poll (descriptivo, no ejecuta nada) ────────────────

export type PollEligibility =
  | 'eligible'
  | 'not_in_flight'
  | 'missing_request_id';

export interface ApolloPhoneRevealPollPlan {
  eligibility: PollEligibility;
  /** request_id a consultar cuando eligibility = 'eligible'. */
  requestId: string | null;
  /** Descripción del request a Apollo (scaffold; el runtime real es futuro). */
  request: {
    method: 'POST';
    path: typeof APOLLO_PHONE_REVEAL_RESULT_PATH;
    body: { request_id: string };
  } | null;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Decide si un candidato es elegible para un poll de recuperación y describe el
 * request a Apollo. Solo candidatos en vuelo (requested/pending) con request_id.
 * No ejecuta la llamada; devuelve la forma del request para el runtime futuro.
 */
export function planApolloPhoneRevealPoll(
  candidate: PollableCandidateRecord,
): ApolloPhoneRevealPollPlan {
  const status = cleanText(candidate.phoneRevealStatus);
  if (!status || !POLLABLE_STATUSES.includes(status)) {
    return { eligibility: 'not_in_flight', requestId: null, request: null };
  }
  const requestId = cleanText(candidate.phoneRevealRequestId);
  if (!requestId) {
    return { eligibility: 'missing_request_id', requestId: null, request: null };
  }
  return {
    eligibility: 'eligible',
    requestId,
    request: {
      method: 'POST',
      path: APOLLO_PHONE_REVEAL_RESULT_PATH,
      body: { request_id: requestId },
    },
  };
}

// ── Runner del poll (scaffold, DI) ─────────────────────────────

export interface ApolloPhoneRevealPollDeps {
  /**
   * Recupera el resultado del reveal por request_id. En el hito actual NADIE
   * cablea esta dep en producción (no hay job). En tests se inyecta un stub que
   * devuelve un payload equivalente al del webhook.
   */
  fetchResultByRequestId: (
    requestId: string,
  ) => Promise<ApolloPhoneRevealWebhookPayload | null>;
}

export type PollRunOutcome =
  | 'not_in_flight'
  | 'missing_request_id'
  | 'no_result_yet'
  | 'result_available';

export interface ApolloPhoneRevealPollRunResult {
  outcome: PollRunOutcome;
  /**
   * Payload recuperado (mismo shape que el webhook) para que el caller lo
   * procese con runApolloPhoneRevealWebhook. null salvo result_available.
   */
  payload: ApolloPhoneRevealWebhookPayload | null;
}

/**
 * Ejecuta el poll de recuperación de forma pura/DI: valida elegibilidad, pide
 * el resultado por request_id y devuelve el payload recuperado. NO persiste ni
 * loguea: el caller debe pasar el payload al webhook core (misma ruta terminal
 * que el callback real), garantizando idempotencia por request_id.
 */
export async function runApolloPhoneRevealPoll(
  candidate: PollableCandidateRecord,
  deps: ApolloPhoneRevealPollDeps,
): Promise<ApolloPhoneRevealPollRunResult> {
  const plan = planApolloPhoneRevealPoll(candidate);
  if (plan.eligibility !== 'eligible' || !plan.requestId) {
    return {
      outcome:
        plan.eligibility === 'missing_request_id'
          ? 'missing_request_id'
          : 'not_in_flight',
      payload: null,
    };
  }

  const payload = await deps.fetchResultByRequestId(plan.requestId);
  if (!payload) return { outcome: 'no_result_yet', payload: null };
  return { outcome: 'result_available', payload };
}
