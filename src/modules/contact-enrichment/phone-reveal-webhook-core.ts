// Agente 2A — Apollo Phone Reveal: WEBHOOK core (APOLLO-PHONE-ASYNC-1)
//
// Pure, dependency-injected orchestration for the Apollo phone-reveal webhook
// callback. This is where the actual phone number arrives: the async reveal
// started by phone-reveal-core.ts persists a `requested` state + a request_id,
// and Apollo later POSTs the phone_numbers to our webhook. This module owns ONLY
// validation + correlation + the shape of the DB patch and the (PII-free)
// usage-log entry. It performs NO I/O directly: the expected token, the
// candidate lookup by request_id, the persistence write and the usage-log write
// are all injected, so the whole contract is testable offline.
//
// Security (Apollo does NOT document a webhook signature/secret):
//   * we protect the endpoint with a shared secret token from env
//     (APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN), compared in constant time.
//   * if the token is not configured, the endpoint is fail-closed (rejected).
//
// Correlation (Apollo does NOT document custom metadata pass-through):
//   * the webhook payload carries the same request_id returned at start; we look
//     the candidate up by request_id (partial-unique in migration 097).
//
// Safety contract:
//   * never logs the raw body / phones / emails / names / linkedin.
//   * never creates an official contact, never approves a candidate.
//   * never writes HubSpot, never touches Lusha.
//   * unknown / already-terminal request_id → safe no-op (idempotent).

import {
  pickBestApolloPhone,
  type ApolloPhoneNumber,
  type ClassifiedPhone,
} from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import {
  PHONE_REVEAL_OPERATION_KEY,
  PHONE_REVEAL_PROVIDER,
} from './phone-reveal-core';
import type {
  ContactCandidateEnrichmentMetadata,
  ContactCandidatePhoneMetadata,
} from './types';

// ── Payload de Apollo (defensivo: campos observados, todos opcionales) ──

/** Un teléfono entregado por el webhook de Apollo. */
export interface ApolloWebhookPhoneNumber {
  raw_number?: string | null;
  sanitized_number?: string | null;
  status_cd?: string | null;
  type_cd?: string | null;
  credits_consumed?: number | null;
}

/**
 * Payload del webhook de Apollo. Los teléfonos pueden venir en la raíz, bajo
 * `person` o bajo `people[0]` según endpoint/plan; el id de correlación puede
 * llamarse request_id / async_task_id / id. Se aceptan todas las variantes.
 */
export interface ApolloPhoneRevealWebhookPayload {
  request_id?: string | null;
  async_task_id?: string | null;
  id?: string | null;
  phone_numbers?: ApolloWebhookPhoneNumber[] | null;
  person?: {
    id?: string | null;
    phone_numbers?: ApolloWebhookPhoneNumber[] | null;
  } | null;
  people?: Array<{
    phone_numbers?: ApolloWebhookPhoneNumber[] | null;
  }> | null;
}

// ── Registro mínimo del candidato pendiente ────────────────────

export interface WebhookCandidateRecord {
  id: string;
  accountId: string | null;
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  phoneRevealStatus: string | null;
}

// ── Patch de persistencia terminal (describe el UPDATE) ────────

export interface WebhookRevealPersistencePatch {
  phone?: string | null;
  enrichment_metadata?: ContactCandidateEnrichmentMetadata;
  phone_reveal_status: 'revealed' | 'no_phone_found';
  phone_reveal_completed_at: string;
  phone_reveal_webhook_received_at: string;
  phone_reveal_provider: 'apollo';
  phone_reveal_cost_credits: number | null;
  phone_reveal_error_code: null;
}

// ── Usage-log terminal (SIN PII) ───────────────────────────────

export interface WebhookUsageLogEntry {
  operationKey: typeof PHONE_REVEAL_OPERATION_KEY;
  provider: 'apollo';
  creditsUsed: number | null;
  status: 'success';
  metadata: {
    candidate_id: string;
    account_id: string | null;
    provider: 'apollo';
    reveal_status: 'revealed' | 'no_phone_found';
    reveal_phase: 'webhook';
    request_id: string;
    phone_revealed: boolean;
    phone_type: string | null;
    credits_used: number | null;
  };
}

// ── Deps inyectadas ────────────────────────────────────────────

export interface ApolloPhoneRevealWebhookDeps {
  /** Token esperado (env APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN). null ⇒ fail-closed. */
  expectedToken: string | null;
  /** Timestamp ISO estable (inyectado para tests deterministas). */
  nowIso: string;
  /** Busca el candidato pendiente por request_id. null si no hay match. */
  loadCandidateByRequestId: (
    requestId: string,
  ) => Promise<WebhookCandidateRecord | null>;
  /** Aplica el UPDATE terminal (service role). */
  persist: (
    candidateId: string,
    patch: WebhookRevealPersistencePatch,
  ) => Promise<void>;
  /** Registra el uso/costo en provider_usage_logs (metadata sin PII). */
  logUsage: (entry: WebhookUsageLogEntry) => Promise<void>;
}

// ── Resultado (para que la ruta arme la HTTP response segura) ──

export type WebhookOutcome =
  | 'not_configured'
  | 'unauthorized'
  // Token válido pero sin request_id (body vacío o ping de validación de Apollo).
  // 200 no-op, sin escrituras: evita 422/reintentos destructivos.
  | 'validation_ack'
  | 'unknown_request_id'
  | 'already_terminal'
  | 'revealed'
  | 'no_phone_found';

export interface ApolloPhoneRevealWebhookResult {
  httpStatus: number;
  outcome: WebhookOutcome;
}

export interface ApolloPhoneRevealWebhookInput {
  /** Token recibido (query/header/path) — el wrapper lo extrae. */
  tokenProvided: string | null;
  /** Payload ya parseado (JSON). El wrapper NUNCA loguea el body crudo. */
  payload: ApolloPhoneRevealWebhookPayload | null;
}

// ── Helpers puros ──────────────────────────────────────────────

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Comparación en tiempo constante para no filtrar el token por timing. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verificación pura del token del webhook (query param o header). Fail-closed:
 * token esperado ausente/vacío ⇒ false; token provisto ausente ⇒ false; en otro
 * caso compara en tiempo constante. Reutilizado por el handler de validación
 * (GET/HEAD/OPTIONS/POST-ping) para NUNCA responder 2xx sin token válido.
 */
export function isApolloWebhookTokenAuthorized(
  tokenProvided: string | null,
  expectedToken: string | null,
): boolean {
  const expected = cleanText(expectedToken);
  if (!expected) return false;
  const provided = cleanText(tokenProvided);
  if (!provided) return false;
  return constantTimeEquals(provided, expected);
}

const TERMINAL_STATUSES: readonly string[] = [
  'revealed',
  'no_phone_found',
  'error',
];

/** Extrae el request_id de correlación (todas las variantes observadas). */
export function extractWebhookRequestId(
  payload: ApolloPhoneRevealWebhookPayload | null,
): string | null {
  if (!payload) return null;
  return (
    cleanText(payload.request_id) ??
    cleanText(payload.async_task_id) ??
    cleanText(payload.id)
  );
}

/** Reúne los teléfonos del payload sin importar dónde vengan anidados. */
export function collectWebhookPhoneNumbers(
  payload: ApolloPhoneRevealWebhookPayload | null,
): ApolloWebhookPhoneNumber[] {
  if (!payload) return [];
  const out: ApolloWebhookPhoneNumber[] = [];
  if (Array.isArray(payload.phone_numbers)) out.push(...payload.phone_numbers);
  if (Array.isArray(payload.person?.phone_numbers)) {
    out.push(...(payload.person!.phone_numbers as ApolloWebhookPhoneNumber[]));
  }
  if (Array.isArray(payload.people)) {
    for (const p of payload.people) {
      if (Array.isArray(p?.phone_numbers)) out.push(...p.phone_numbers);
    }
  }
  return out;
}

/**
 * Adapta un teléfono del webhook al shape que entiende `pickBestApolloPhone`:
 * el número sale de sanitized_number (o raw_number como fallback) y el tipo de
 * type_cd. Así reutilizamos la prioridad mobile→direct_dial→work/hq/other.
 */
function webhookPhoneToApolloPhone(
  entry: ApolloWebhookPhoneNumber,
): ApolloPhoneNumber {
  return {
    sanitized_number: cleanText(entry.sanitized_number) ?? cleanText(entry.raw_number),
    type: cleanText(entry.type_cd),
  };
}

/** Suma los créditos consumidos reportados por el webhook (null si no hay dato). */
export function sumWebhookCredits(
  phones: ReadonlyArray<ApolloWebhookPhoneNumber>,
): number | null {
  let total = 0;
  let seen = false;
  for (const p of phones) {
    if (typeof p.credits_consumed === 'number' && Number.isFinite(p.credits_consumed)) {
      total += p.credits_consumed;
      seen = true;
    }
  }
  return seen ? total : null;
}

// ── Orquestación pura del WEBHOOK ──────────────────────────────

/**
 * Procesa un callback de reveal de teléfono de Apollo. Fail-closed en el token,
 * idempotente ante request_id desconocido o ya terminal, y NUNCA expone PII en
 * el resultado (el número se persiste en el candidato, jamás se retorna).
 */
export async function runApolloPhoneRevealWebhook(
  input: ApolloPhoneRevealWebhookInput,
  deps: ApolloPhoneRevealWebhookDeps,
): Promise<ApolloPhoneRevealWebhookResult> {
  // 1. Token no configurado → fail-closed (no confirmamos existencia del hook).
  const expected = cleanText(deps.expectedToken);
  if (!expected) return { httpStatus: 401, outcome: 'not_configured' };

  // 2. Token inválido → 401 (comparación en tiempo constante).
  const provided = cleanText(input.tokenProvided);
  if (!provided || !constantTimeEquals(provided, expected)) {
    return { httpStatus: 401, outcome: 'unauthorized' };
  }

  // 3. request_id ausente → 200 validation_ack, SIN escrituras. Cubre el body
  //    vacío / ping de validación de Apollo y cualquier callback sin id de
  //    correlación (sin id no hay forma de procesar, y un 4xx dispararía
  //    reintentos/422 innecesarios). Idempotente y seguro.
  const requestId = extractWebhookRequestId(input.payload);
  if (!requestId) return { httpStatus: 200, outcome: 'validation_ack' };

  // 4. Candidato desconocido → 200 (ack idempotente, sin PII, sin escribir).
  const candidate = await deps.loadCandidateByRequestId(requestId);
  if (!candidate) return { httpStatus: 200, outcome: 'unknown_request_id' };

  // 5. Ya terminal → 200 (idempotente: no reprocesar ni recobrar créditos).
  if (
    typeof candidate.phoneRevealStatus === 'string' &&
    TERMINAL_STATUSES.includes(candidate.phoneRevealStatus)
  ) {
    return { httpStatus: 200, outcome: 'already_terminal' };
  }

  // 6. Seleccionar el mejor teléfono (mobile → direct_dial → work/hq/other).
  const rawPhones = collectWebhookPhoneNumbers(input.payload);
  const credits = sumWebhookCredits(rawPhones);
  const best = pickBestApolloPhone(rawPhones.map(webhookPhoneToApolloPhone));

  // 6a. Con teléfono → revealed + apollo_reveal, conserva créditos reales.
  if (best) {
    const revealed: ClassifiedPhone = { ...best, source: 'apollo_reveal' };
    const phoneMetadata: ContactCandidatePhoneMetadata = {
      number: revealed.number,
      type: revealed.type,
      source: 'apollo_reveal',
      raw_type: revealed.raw_type,
    };
    const patch: WebhookRevealPersistencePatch = {
      phone: revealed.number,
      enrichment_metadata: {
        ...candidate.enrichmentMetadata,
        phone: phoneMetadata,
      },
      phone_reveal_status: 'revealed',
      phone_reveal_completed_at: deps.nowIso,
      phone_reveal_webhook_received_at: deps.nowIso,
      phone_reveal_provider: PHONE_REVEAL_PROVIDER,
      phone_reveal_cost_credits: credits,
      phone_reveal_error_code: null,
    };
    await deps.persist(candidate.id, patch);
    await deps.logUsage({
      operationKey: PHONE_REVEAL_OPERATION_KEY,
      provider: 'apollo',
      creditsUsed: credits,
      status: 'success',
      metadata: {
        candidate_id: candidate.id,
        account_id: candidate.accountId,
        provider: 'apollo',
        reveal_status: 'revealed',
        reveal_phase: 'webhook',
        request_id: requestId,
        phone_revealed: true,
        phone_type: revealed.type,
        credits_used: credits,
      },
    });
    return { httpStatus: 200, outcome: 'revealed' };
  }

  // 6b. Sin teléfono → no_phone_found, no inventa dato, conserva créditos.
  const patch: WebhookRevealPersistencePatch = {
    phone_reveal_status: 'no_phone_found',
    phone_reveal_completed_at: deps.nowIso,
    phone_reveal_webhook_received_at: deps.nowIso,
    phone_reveal_provider: PHONE_REVEAL_PROVIDER,
    phone_reveal_cost_credits: credits,
    phone_reveal_error_code: null,
  };
  await deps.persist(candidate.id, patch);
  await deps.logUsage({
    operationKey: PHONE_REVEAL_OPERATION_KEY,
    provider: 'apollo',
    creditsUsed: credits,
    status: 'success',
    metadata: {
      candidate_id: candidate.id,
      account_id: candidate.accountId,
      provider: 'apollo',
      reveal_status: 'no_phone_found',
      reveal_phase: 'webhook',
      request_id: requestId,
      phone_revealed: false,
      phone_type: null,
      credits_used: credits,
    },
  });
  return { httpStatus: 200, outcome: 'no_phone_found' };
}
