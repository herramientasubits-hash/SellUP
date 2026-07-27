// Agente 2A — Apollo Phone Reveal: interpretación PURA de la respuesta START
// (APOLLO-PHONE-ASYNC-15)
//
// Este módulo NO hace red, NO lee env, NO toca Supabase, NO imprime nada. Sólo
// interpreta el body + headers de la respuesta inmediata de Apollo al INICIAR un
// reveal de teléfono asíncrono (POST /people/match con reveal_phone_number +
// webhook_url) y decide el handle async y la clasificación segura.
//
// Contrato confirmado por Apollo Support:
//   * El handle async correcto vive en `response.body.phone_enrichment.request_id`.
//   * El `response.body.request_id` de nivel superior NO es el handle async: es
//     el id de traza HTTP de Apollo (equivale al header `x-http-request-id`).
//   * Apollo también devuelve `x-transaction-id` (traza Support/observabilidad).
//   * SellUp puede enviar su propio `X-Transaction-Id: <uuid>`; Apollo lo refleja
//     en `x-transaction-id` y lo loguea server-side.
//   * HTTP 200 sin `phone_enrichment` ⇒ NO se creó job async: no habrá webhook, no
//     se debe esperar `pending`, no se consumen créditos.
//   * `phone_enrichment.status = "skipped"` puede aparecer cuando una request
//     previa de la misma persona sigue en progreso; los resultados llegarán al
//     webhook de la request anterior. Si trae request_id se conserva; si no, no
//     se inventa id.
//
// Nunca extrae ni expone teléfonos, emails, linkedin, nombres ni el body crudo:
// sólo el handle async (id opaco de correlación) y metadata técnica de traza.

// ── Nombres de header (traza técnica, no PII) ──────────────────

/** Header propio de SellUp: UUID de correlación por intento (server-side). */
export const OUTBOUND_TRANSACTION_HEADER = 'X-Transaction-Id';
/** Header de traza HTTP de Apollo (equivale al request_id top-level del body). */
export const APOLLO_HTTP_REQUEST_ID_HEADER = 'x-http-request-id';
/** Header de traza transaccional de Apollo (Support / observabilidad). */
export const APOLLO_TRANSACTION_ID_HEADER = 'x-transaction-id';

/** Status de `phone_enrichment` que indica job diferido a una request previa. */
export const PHONE_ENRICHMENT_SKIPPED_STATUS = 'skipped';

// ── Shape defensivo del body inmediato del START ───────────────

/**
 * Bloque `phone_enrichment` de la respuesta inmediata. El `request_id` de aquí
 * (y SÓLO de aquí) es el handle async con el que se correlaciona el webhook.
 */
export interface ApolloPhoneEnrichmentBlock {
  request_id?: string | null;
  /** 'pending' | 'skipped' | otros; se conserva como traza, nunca como PII. */
  status?: string | null;
}

/**
 * Body inmediato del START. `request_id` de nivel superior es SÓLO traza HTTP
 * (x-http-request-id), nunca el handle async. `person` puede venir cuando Apollo
 * resolvió a una Apollo Person; sólo se observa su presencia (booleana), jamás
 * se leen sus campos (teléfono/email/linkedin/nombre).
 */
export interface ApolloPhoneRevealStartBody {
  request_id?: string | null;
  phone_enrichment?: ApolloPhoneEnrichmentBlock | null;
  person?: { id?: string | null } | null;
}

// ── Clasificación segura del START ─────────────────────────────

export type ApolloPhoneRevealStartOutcome =
  // phone_enrichment.request_id presente ⇒ job async creado, esperar webhook.
  | 'pending'
  // HTTP 200 sin phone_enrichment (o sin request_id y sin status skipped) ⇒ no se
  // creó job: no webhook, no pending, no créditos, no id falso.
  | 'no_async_job_created'
  // phone_enrichment.status = skipped pero SIN request_id ⇒ no hay handle usable;
  // los resultados (si los hubiera) llegarían al webhook de la request previa.
  | 'skipped_without_request_id';

/**
 * Metadata técnica de traza (sin PII). Todos los campos son booleanos de
 * presencia o ids de traza técnica (request/transaction ids), que Apollo Support
 * usa para correlacionar; NUNCA teléfono, email, linkedin, nombre ni body crudo.
 */
export interface ApolloPhoneRevealTraceMetadata {
  /** true si se extrajo phone_enrichment.request_id (handle async real). */
  apollo_async_request_id_present: boolean;
  /** true si el body trae el bloque phone_enrichment. */
  apollo_phone_enrichment_present: boolean;
  /** status del phone_enrichment ('pending' | 'skipped' | ...) o null. */
  apollo_phone_enrichment_status: string | null;
  /** true si Apollo resolvió a una Apollo Person (sólo presencia). */
  apollo_person_present: boolean;
  /** true si esa Apollo Person trae id (sólo presencia; el id no se guarda). */
  apollo_person_id_present: boolean;
  /** true si el body trae request_id top-level (traza HTTP, no handle async). */
  apollo_top_level_request_id_present: boolean;
  /** x-http-request-id (header) o, en su defecto, el request_id top-level del body. */
  apollo_http_request_id: string | null;
  /** x-transaction-id devuelto por Apollo (traza técnica). */
  apollo_transaction_id: string | null;
  /** UUID que SellUp envió como X-Transaction-Id (server-side). */
  sellup_transaction_id: string | null;
  /** true si Apollo reflejó exactamente el X-Transaction-Id enviado. */
  apollo_transaction_echoed: boolean;
}

export interface ApolloPhoneRevealStartInterpretation {
  /** Handle async (phone_enrichment.request_id). null si no se creó job. */
  asyncRequestId: string | null;
  outcome: ApolloPhoneRevealStartOutcome;
  /**
   * Código de error seguro cuando NO hay handle async (outcome != 'pending').
   * null en el camino feliz. Sustituye al genérico 'missing_request_id'.
   */
  noAsyncJobCode: string | null;
  trace: ApolloPhoneRevealTraceMetadata;
}

// ── Helpers puros ──────────────────────────────────────────────

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Mapea el outcome sin handle a un código de error estable (sin PII). */
function noAsyncJobCodeForOutcome(
  outcome: ApolloPhoneRevealStartOutcome,
): string | null {
  switch (outcome) {
    case 'pending':
      return null;
    case 'skipped_without_request_id':
      return 'skipped_without_request_id';
    case 'no_async_job_created':
    default:
      return 'no_async_job_created';
  }
}

// ── Interpretación pura ────────────────────────────────────────

/**
 * Interpreta la respuesta inmediata del START (body + headers) de forma pura.
 *
 * Reglas:
 *   1. El handle async SÓLO sale de `phone_enrichment.request_id`. El request_id
 *      top-level NUNCA se usa como handle (sólo como traza HTTP).
 *   2. Con handle ⇒ outcome 'pending' (aunque status sea 'skipped': el handle es
 *      válido y correlaciona con el webhook).
 *   3. Sin handle + status 'skipped' ⇒ 'skipped_without_request_id' (no se inventa id).
 *   4. Sin handle en cualquier otro caso (incl. sin phone_enrichment) ⇒
 *      'no_async_job_created': no webhook, no pending, no créditos.
 */
export function interpretApolloPhoneRevealStartResponse(args: {
  body: ApolloPhoneRevealStartBody | null | undefined;
  getHeader: (name: string) => string | null;
  outboundTransactionId: string | null;
}): ApolloPhoneRevealStartInterpretation {
  const body = args.body ?? null;
  const phoneEnrichment = body?.phone_enrichment ?? null;
  const phoneEnrichmentPresent = !!phoneEnrichment && typeof phoneEnrichment === 'object';

  const asyncRequestId = phoneEnrichmentPresent
    ? cleanText(phoneEnrichment?.request_id)
    : null;
  const enrichmentStatus = phoneEnrichmentPresent
    ? cleanText(phoneEnrichment?.status)
    : null;

  const person = body?.person ?? null;
  const personPresent = !!person && typeof person === 'object';
  const personIdPresent = personPresent ? !!cleanText(person?.id) : false;

  const topLevelRequestId = cleanText(body?.request_id);
  const headerHttpRequestId = cleanText(args.getHeader(APOLLO_HTTP_REQUEST_ID_HEADER));
  const transactionId = cleanText(args.getHeader(APOLLO_TRANSACTION_ID_HEADER));
  const outboundTransactionId = cleanText(args.outboundTransactionId);

  let outcome: ApolloPhoneRevealStartOutcome;
  if (asyncRequestId) {
    outcome = 'pending';
  } else if (enrichmentStatus === PHONE_ENRICHMENT_SKIPPED_STATUS) {
    outcome = 'skipped_without_request_id';
  } else {
    outcome = 'no_async_job_created';
  }

  const trace: ApolloPhoneRevealTraceMetadata = {
    apollo_async_request_id_present: !!asyncRequestId,
    apollo_phone_enrichment_present: phoneEnrichmentPresent,
    apollo_phone_enrichment_status: enrichmentStatus,
    apollo_person_present: personPresent,
    apollo_person_id_present: personIdPresent,
    apollo_top_level_request_id_present: !!topLevelRequestId,
    // Header preferido; el request_id top-level del body es la misma traza HTTP.
    apollo_http_request_id: headerHttpRequestId ?? topLevelRequestId,
    apollo_transaction_id: transactionId,
    sellup_transaction_id: outboundTransactionId,
    apollo_transaction_echoed:
      !!outboundTransactionId &&
      !!transactionId &&
      transactionId === outboundTransactionId,
  };

  return {
    asyncRequestId,
    outcome,
    noAsyncJobCode: noAsyncJobCodeForOutcome(outcome),
    trace,
  };
}
