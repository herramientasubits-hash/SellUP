// Agente 2A — Apollo Phone Reveal: RECOVERY POLL scaffold
// (APOLLO-PHONE-ASYNC-1, contrato corregido en APOLLO-PHONE-ASYNC-21)
//
// SCAFFOLD ONLY. The primary delivery path for an async reveal is the webhook
// (phone-reveal-webhook-core.ts). This module prepares the FALLBACK path used
// when a webhook is lost: recovering the result by polling Apollo. It is
// intentionally inert:
//
//   * NO network / NO fetch — it only DESCRIBES the request to make.
//   * NO Supabase / NO env / NO logs.
//   * NO automatic/scheduled job is wired in this hito (that would expand scope
//     and risk spending credits without a human trigger). A future milestone can
//     drive this from an explicit, admin-gated action or a capped cron.
//
// CONTRACT (confirmed by Apollo human — ASYNC-21):
//   * Recovery endpoint: GET /api/v1/webhook_result/{request_id}
//   * `request_id` here means the TOP-LEVEL request_id / `x-http-request-id`
//     (a signed 64-bit integer as string, e.g. `-4594297923800105423`). It is
//     stored as `apollo_http_request_id` in the safe start-trace metadata.
//   * It is NOT `phone_enrichment.request_id` (the internal enrichment/job id):
//     that value returns 404 on /webhook_result/.
//   * Auth: `X-Api-Key`. Requires the `webhook_result_read` scope or a Master
//     API key. No request body. Does NOT create a reveal, does NOT call
//     /people/match, does NOT consume new credits — it only recovers a payload
//     that a lost webhook would have delivered.
//   * 401 ⇒ likely missing `webhook_result_read` scope / not a Master key.
//   * 404 ⇒ ambiguous per Apollo (pending / not found / expired): never assumed
//     to mean "no phone found".
//
// The recovered payload has the SAME shape the webhook receives, so the caller
// can hand it to runApolloPhoneRevealWebhook (same terminal path, idempotent by
// correlation id). This module stays pure so eligibility + request construction
// + HTTP-status classification are unit-tested offline.

import type { ApolloPhoneRevealWebhookPayload } from './phone-reveal-webhook-core';

/** Prefijo del endpoint de recovery de Apollo (GET webhook_result/{request_id}). */
export const APOLLO_WEBHOOK_RESULT_PATH_PREFIX = '/api/v1/webhook_result/';

/** Header de auth del recovery poll (requiere webhook_result_read scope o Master key). */
export const APOLLO_WEBHOOK_RESULT_AUTH_HEADER = 'X-Api-Key';

/** Estados en vuelo que justifican un poll de recuperación. */
export const POLLABLE_STATUSES: readonly string[] = ['requested', 'pending'];

/**
 * Construye el path GET del recovery para un recovery request id. Codifica sólo
 * el segmento (URL-safe) — nunca pre-encodea otra cosa. Preserva el signo del
 * entero firmado (p.ej. `-4594297923800105423`) porque `encodeURIComponent` no
 * altera dígitos ni `-`.
 */
export function buildApolloWebhookResultPath(recoveryRequestId: string): string {
  return `${APOLLO_WEBHOOK_RESULT_PATH_PREFIX}${encodeURIComponent(recoveryRequestId)}`;
}

// ── Proyección mínima para decidir el poll ─────────────────────

export interface PollableCandidateRecord {
  id: string;
  phoneRevealStatus: string | null;
  /**
   * Recovery polling id = Apollo top-level request_id / x-http-request-id (signed
   * 64-bit int como string, p.ej. `-4594297923800105423`). NO es
   * phone_enrichment.request_id (ese es el job/enrichment handle y devuelve 404
   * en /webhook_result/). Un runtime futuro lo obtiene de la metadata segura del
   * start log (`apollo_trace.apollo_http_request_id`); NUNCA se hardcodea.
   */
  apolloHttpRequestId: string | null;
}

// ── Plan de poll (descriptivo, no ejecuta nada) ────────────────

export type PollEligibility =
  | 'eligible'
  | 'not_in_flight'
  | 'missing_recovery_request_id';

export interface ApolloPhoneRevealPollPlan {
  eligibility: PollEligibility;
  /** recovery request id (apollo_http_request_id) cuando eligibility = 'eligible'. */
  recoveryRequestId: string | null;
  /** Descripción del request de recovery a Apollo (scaffold; runtime real futuro). */
  request: {
    method: 'GET';
    path: string;
    /** El recovery poll NUNCA envía body. */
    body: null;
    /** Auth: X-Api-Key (webhook_result_read scope o Master key). */
    authHeader: typeof APOLLO_WEBHOOK_RESULT_AUTH_HEADER;
  } | null;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Decide si un candidato es elegible para un poll de recuperación y describe el
 * request GET a Apollo. Solo candidatos en vuelo (requested/pending) con un
 * recovery request id (apollo_http_request_id). No ejecuta la llamada; devuelve
 * la forma del request para el runtime futuro.
 */
export function planApolloPhoneRevealPoll(
  candidate: PollableCandidateRecord,
): ApolloPhoneRevealPollPlan {
  const status = cleanText(candidate.phoneRevealStatus);
  if (!status || !POLLABLE_STATUSES.includes(status)) {
    return { eligibility: 'not_in_flight', recoveryRequestId: null, request: null };
  }
  const recoveryRequestId = cleanText(candidate.apolloHttpRequestId);
  if (!recoveryRequestId) {
    return {
      eligibility: 'missing_recovery_request_id',
      recoveryRequestId: null,
      request: null,
    };
  }
  return {
    eligibility: 'eligible',
    recoveryRequestId,
    request: {
      method: 'GET',
      path: buildApolloWebhookResultPath(recoveryRequestId),
      body: null,
      authHeader: APOLLO_WEBHOOK_RESULT_AUTH_HEADER,
    },
  };
}

// ── Clasificación pura del status HTTP del recovery ────────────

/**
 * Disposición segura del status HTTP de GET /webhook_result/{request_id}:
 *   * 200 ⇒ 'ok' (intentar leer el payload).
 *   * 404 ⇒ 'not_found' — ambiguo (pending / not found / expired). NUNCA se
 *     interpreta como "no phone found".
 *   * 401 / 403 ⇒ 'unauthorized' — posible falta de webhook_result_read scope o
 *     de Master API key.
 *   * cualquier otro ⇒ 'error'.
 */
export type WebhookResultHttpDisposition =
  | 'ok'
  | 'not_found'
  | 'unauthorized'
  | 'error';

export function classifyWebhookResultHttpStatus(
  status: number,
): WebhookResultHttpDisposition {
  if (status === 200) return 'ok';
  if (status === 404) return 'not_found';
  if (status === 401 || status === 403) return 'unauthorized';
  return 'error';
}

// ── Runner del poll (scaffold, DI) ─────────────────────────────

/**
 * Resultado de bajo nivel del recovery fetch (lo produce la dep inyectada). Es
 * puro: mapea el status HTTP a una disposición segura + payload si lo hubo.
 */
export type PollFetchResult =
  | { kind: 'result'; payload: ApolloPhoneRevealWebhookPayload }
  | { kind: 'no_result_yet' }
  | { kind: 'not_found' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; code: string | null };

export interface ApolloPhoneRevealPollDeps {
  /**
   * Ejecuta GET /api/v1/webhook_result/{recoveryRequestId} con X-Api-Key y
   * clasifica el status. En el hito actual NADIE cablea esta dep en producción
   * (no hay job). En tests se inyecta un stub. NUNCA imprime ni persiste el raw.
   */
  fetchWebhookResult: (recoveryRequestId: string) => Promise<PollFetchResult>;
}

export type PollRunOutcome =
  | 'not_in_flight'
  | 'missing_recovery_request_id'
  | 'no_result_yet'
  // 404: ambiguo (pending / not found / expired). NO es no_phone_found.
  | 'not_found'
  // 401/403: posible falta de webhook_result_read scope o Master key.
  | 'possible_missing_webhook_result_read_scope'
  | 'error'
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
 * Ejecuta el poll de recuperación de forma pura/DI: valida elegibilidad, pide el
 * recovery result por apollo_http_request_id (GET /webhook_result/{id}) y mapea
 * la disposición a un outcome seguro. NO persiste ni loguea: el caller pasa el
 * payload al webhook core (misma ruta terminal que el callback real, idempotente
 * por correlación). Un 404 NUNCA implica no_phone_found; un 401 sugiere scope.
 */
export async function runApolloPhoneRevealPoll(
  candidate: PollableCandidateRecord,
  deps: ApolloPhoneRevealPollDeps,
): Promise<ApolloPhoneRevealPollRunResult> {
  const plan = planApolloPhoneRevealPoll(candidate);
  if (plan.eligibility !== 'eligible' || !plan.recoveryRequestId) {
    return {
      outcome:
        plan.eligibility === 'missing_recovery_request_id'
          ? 'missing_recovery_request_id'
          : 'not_in_flight',
      payload: null,
    };
  }

  const fetched = await deps.fetchWebhookResult(plan.recoveryRequestId);
  switch (fetched.kind) {
    case 'result':
      return { outcome: 'result_available', payload: fetched.payload };
    case 'not_found':
      return { outcome: 'not_found', payload: null };
    case 'unauthorized':
      return {
        outcome: 'possible_missing_webhook_result_read_scope',
        payload: null,
      };
    case 'error':
      return { outcome: 'error', payload: null };
    case 'no_result_yet':
    default:
      return { outcome: 'no_result_yet', payload: null };
  }
}
