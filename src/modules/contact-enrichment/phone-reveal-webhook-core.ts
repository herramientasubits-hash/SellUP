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
// Correlation (ASYNC-21 — Apollo does NOT guarantee request_id in the payload):
//   * PRIMARY when present: the payload's request_id (async handle) matches the
//     candidate stored at start (phone_reveal_request_id, partial-unique in
//     migration 097). Kept as the backward-compatible fast path.
//   * ROBUST FALLBACK: our own opaque `ref` (query param added to webhook_url at
//     start; Apollo reflects query params on the callback). The route resolves
//     the start log by that ref (safe metadata webhook_ref / sellup_transaction_id)
//     and hands us the candidate — used whenever the payload has no reliable
//     request_id or the request_id yields no candidate. If neither correlates we
//     never persist a phone against the wrong candidate.
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
import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import {
  buildRevealPhoneCacheWriteInput,
  type PhoneCacheWriteInput,
} from './phone-cache-core';
import {
  PHONE_REVEAL_OPERATION_KEY,
  PHONE_REVEAL_PROVIDER,
} from './phone-reveal-core';
import {
  describeInFlightSuppression,
  evaluateInFlightPhoneSuppression,
  resolveInFlightSuppressionPersonId,
  SUPPRESSION_BLOCKED_ERROR_CODE,
  SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
  type InFlightSuppressionAuditState,
  type InFlightSuppressionLookup,
} from './phone-reveal-suppression-guard';
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
    id?: string | null;
    phone_numbers?: ApolloWebhookPhoneNumber[] | null;
  }> | null;
}

// ── Registro mínimo del candidato pendiente ────────────────────

export interface WebhookCandidateRecord {
  id: string;
  accountId: string | null;
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  phoneRevealStatus: string | null;
  /**
   * País del candidato (texto crudo del proveedor) y país ISO-2 de la empresa
   * del run. Alimentan el alcance de la caché (APOLLO-PHONE-CACHE-1b): si
   * ninguno resuelve a ISO-2 el reveal simplemente NO se cachea (país
   * desconocido = no reuso). Opcionales: ausentes ⇒ sin caché.
   */
  candidateCountry?: string | null;
  runCompanyCountryCode?: string | null;
  /**
   * Apollo person id ya persistido (mig. 098, CACHE-1a) y origen del candidato.
   * Alimentan la comprobación de SUPRESIÓN en vuelo (FIX 3) cuando el payload del
   * webhook no trae `person.id`: sin ellos la supresión no se puede evaluar por
   * falta de clave (`not_evaluable`), nunca se bloquea por inferencia.
   */
  apolloPersonId?: string | null;
  source?: string | null;
  sourceContactId?: string | null;
}

// ── Patch de persistencia terminal (describe el UPDATE) ────────

export interface WebhookRevealPersistencePatch {
  phone?: string | null;
  enrichment_metadata?: ContactCandidateEnrichmentMetadata;
  /**
   * `error` SOLO lo emite el bloqueo por supresión (FIX 3), acompañado de
   * `phone_reveal_error_code = 'blocked_suppressed'`. Se reutiliza el vocabulario
   * existente de la columna (mig. 095/097) en vez de añadir un estado nuevo.
   */
  phone_reveal_status: 'revealed' | 'no_phone_found' | 'error';
  phone_reveal_completed_at: string;
  phone_reveal_webhook_received_at: string;
  phone_reveal_provider: 'apollo';
  phone_reveal_cost_credits: number | null;
  phone_reveal_error_code: null | typeof SUPPRESSION_BLOCKED_ERROR_CODE;
  /**
   * Apollo person id VALIDADO (24 hex) del payload (APOLLO-PHONE-CACHE-1a): de
   * `people[0].id` o `person.id`. null si ausente/inválido/otro proveedor. El
   * wrapper sólo escribe la columna cuando es truthy (nunca fuerza ni sobrescribe
   * con null). Id opaco de correlación, NO PII. No cachea ni sirve teléfono.
   */
  apollo_person_id?: string | null;
}

// ── Usage-log terminal (SIN PII) ───────────────────────────────

export interface WebhookUsageLogEntry {
  operationKey: typeof PHONE_REVEAL_OPERATION_KEY;
  provider: 'apollo';
  creditsUsed: number | null;
  status: 'success' | 'error';
  /** Código mecánico cuando la supresión no se pudo verificar (FIX 3). */
  errorCode?: string | null;
  metadata: {
    candidate_id: string;
    account_id: string | null;
    provider: 'apollo';
    reveal_status:
      | 'revealed'
      | 'no_phone_found'
      // FIX 3: el teléfono llegó pero un tombstone impidió persistirlo.
      | typeof SUPPRESSION_BLOCKED_ERROR_CODE
      // FIX 3: la supresión no se pudo verificar; nada se persistió.
      | typeof SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE;
    reveal_phase: 'webhook';
    /**
     * Resultado PII-free de la comprobación de supresión (FIX 3). Presente solo
     * cuando había teléfono que persistir (es el único camino que la ejecuta);
     * ausente en `no_phone_found`, donde no hay número que suprimir.
     */
    suppression_state?: InFlightSuppressionAuditState;
    /** request_id de correlación del payload (async handle). null si correlacionó por ref. */
    request_id: string | null;
    /** ref opaco del webhook_url usado para correlacionar (null si vino por request_id). */
    webhook_ref: string | null;
    /** Estrategia que resolvió el candidato: por request_id del payload o por ref opaco. */
    correlation_source: 'request_id' | 'webhook_ref';
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
  /** Busca el candidato pendiente por request_id (async handle). null si no hay match. */
  loadCandidateByRequestId: (
    requestId: string,
  ) => Promise<WebhookCandidateRecord | null>;
  /**
   * Correlación robusta por ref opaco (ASYNC-21): resuelve el candidato desde el
   * start log (metadata segura webhook_ref / sellup_transaction_id) cuando el
   * payload no trae un request_id confiable. Opcional: si no se inyecta, sólo se
   * usa la correlación por request_id. NUNCA recibe ni devuelve PII.
   */
  loadCandidateByWebhookRef?: (
    ref: string,
  ) => Promise<WebhookCandidateRecord | null>;
  /** Aplica el UPDATE terminal (service role). */
  persist: (
    candidateId: string,
    patch: WebhookRevealPersistencePatch,
  ) => Promise<void>;
  /** Registra el uso/costo en provider_usage_logs (metadata sin PII). */
  logUsage: (entry: WebhookUsageLogEntry) => Promise<void>;
  /**
   * Cachea el teléfono recién revelado (APOLLO-PHONE-CACHE-1b). OPCIONAL: sin
   * esta dep — o con ENABLE_APOLLO_PHONE_CACHE apagado, que es lo que el wrapper
   * comprueba — no se escribe caché y el webhook se comporta exactamente igual
   * que antes de este hito.
   *
   * BEST-EFFORT por contrato: se invoca DESPUÉS de persistir el reveal y su
   * resultado se ignora, de modo que un fallo de caché no puede perder un
   * teléfono ya pagado. Solo se llama en el camino `revealed`: nunca en
   * no_phone_found, nunca en error, nunca en un candidato ya terminal.
   */
  cacheRevealedPhone?: (input: PhoneCacheWriteInput) => Promise<unknown>;

  // ── Cumplimiento de SUPRESIÓN en vuelo (FIX 3) ────────────────
  // NO depende de `ENABLE_APOLLO_PHONE_CACHE`: el flag gobierna la reutilización
  // de un teléfono cacheado, jamás el cumplimiento de una supresión registrada.

  /**
   * Lee el tombstone de (apollo, persona, MISMA cuenta). Se invoca SIEMPRE que el
   * webhook traiga un teléfono que persistir, con el flag de caché encendido o
   * apagado, y ANTES de escribir cualquier cosa.
   *
   * Debe LANZAR si la lectura no se puede completar: el core lo traduce a
   * `suppression_check_unavailable` y NO persiste el teléfono. Si la dep no está
   * cableada el resultado es el mismo — no hay persistencia tardía sin
   * comprobación de supresión.
   */
  lookupPhoneCacheSuppression?: InFlightSuppressionLookup;
  /**
   * Notifica que la supresión no se pudo verificar. Recibe SOLO un mensaje
   * mecánico YA redactado: nunca teléfono, person id, email, nombre ni linkedin.
   */
  onSuppressionCheckUnavailable?: (message: string) => void;
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
  | 'no_phone_found'
  // FIX 3 — el teléfono llegó, pero existe un tombstone de supresión para esta
  // persona en esta cuenta. NO se persiste teléfono, NO se escribe caché, NO se
  // consumen créditos nuevos. Se cierra terminal (`error` +
  // `blocked_suppressed`) para que el recovery tampoco vuelva a traerlo.
  // HTTP 200: la respuesta de Apollo era correcta, el bloqueo es de privacidad.
  | 'blocked_suppressed'
  // FIX 3 — la supresión NO se pudo verificar (dep ausente o lectura fallida).
  // Fail-closed: el teléfono NO se persiste y NO se cachea. NO es terminal: el
  // candidato sigue en vuelo y el recovery puede repolear el MISMO resultado
  // (0 créditos) cuando la comprobación vuelva a estar disponible. HTTP 200: un
  // 4xx/5xx dispararía reintentos de Apollo sin resolver la causa.
  | 'suppression_check_unavailable';

export interface ApolloPhoneRevealWebhookResult {
  httpStatus: number;
  outcome: WebhookOutcome;
}

export interface ApolloPhoneRevealWebhookInput {
  /** Token recibido (query/header/path) — el wrapper lo extrae. */
  tokenProvided: string | null;
  /** Payload ya parseado (JSON). El wrapper NUNCA loguea el body crudo. */
  payload: ApolloPhoneRevealWebhookPayload | null;
  /**
   * ref opaco leído del query param `ref` del callback (ASYNC-21). Es la
   * estrategia de correlación robusta cuando el payload no trae request_id
   * confiable. Opaco, sin PII. Opcional/nullable.
   */
  ref?: string | null;
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

/**
 * Extrae el Apollo person id VALIDADO del payload (APOLLO-PHONE-CACHE-1a). Mira
 * `people[0].id` primero (variante multi-persona) y luego `person.id`. Devuelve
 * sólo un id Apollo real (24 hex); descarta vacíos, inválidos y de otros
 * proveedores (p.ej. Lusha `v1.*`). null si no hay ninguno válido. Es un id
 * opaco de correlación, NO PII: nunca teléfono/email/nombre/linkedin.
 */
export function extractWebhookPersonId(
  payload: ApolloPhoneRevealWebhookPayload | null,
): string | null {
  if (!payload) return null;
  const fromPeople =
    Array.isArray(payload.people) && payload.people.length > 0
      ? normalizeApolloPersonId(payload.people[0]?.id)
      : null;
  return fromPeople ?? normalizeApolloPersonId(payload.person?.id);
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

/**
 * Escribe el teléfono revelado en la caché sin poder romper el reveal
 * (APOLLO-PHONE-CACHE-1b). Se llama SOLO en el camino `revealed` y SOLO después
 * de persistir el candidato. Cualquier excepción se traga aquí de forma acotada:
 * el teléfono ya está guardado y ya se pagó, así que un fallo de caché no puede
 * degradarse a pérdida de datos ni a un 500 que haga a Apollo reintentar. El
 * store subyacente ya registra el error sin PII.
 */
async function cacheRevealedPhoneBestEffort(
  deps: ApolloPhoneRevealWebhookDeps,
  args: {
    candidate: WebhookCandidateRecord;
    phone: string;
    phoneType: string | null;
    personId: string | null;
  },
): Promise<void> {
  if (!deps.cacheRevealedPhone) return;
  try {
    await deps.cacheRevealedPhone(
      buildRevealPhoneCacheWriteInput({
        personId: args.personId,
        accountId: args.candidate.accountId,
        candidateCountry: args.candidate.candidateCountry ?? null,
        runCompanyCountryCode: args.candidate.runCompanyCountryCode ?? null,
        phone: args.phone,
        phoneType: args.phoneType,
        revealedAtIso: deps.nowIso,
        candidateId: args.candidate.id,
      }),
    );
  } catch {
    // Silencio deliberado y acotado: la caché es un optimizador, nunca la
    // fuente de verdad. El error ya quedó registrado (sin PII) en el store.
  }
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

  // 3. Sin request_id NI ref → 200 validation_ack, SIN escrituras. Cubre el body
  //    vacío / ping de validación de Apollo y cualquier callback sin señal de
  //    correlación (un 4xx dispararía reintentos/422 innecesarios). Idempotente.
  const requestId = extractWebhookRequestId(input.payload);
  const ref = cleanText(input.ref);
  if (!requestId && !ref) return { httpStatus: 200, outcome: 'validation_ack' };

  // 4. Resolver el candidato. PRIMARIO: request_id del payload (async handle) si
  //    viene y matchea (fast path retrocompatible). FALLBACK ROBUSTO: ref opaco
  //    (Apollo no garantiza request_id en el payload). Sin candidato por ninguna
  //    vía → 200 ack idempotente, sin PII, sin escribir (nunca contra el
  //    candidato equivocado).
  let candidate: WebhookCandidateRecord | null = null;
  let correlationSource: 'request_id' | 'webhook_ref' = 'request_id';
  if (requestId) {
    candidate = await deps.loadCandidateByRequestId(requestId);
  }
  if (!candidate && ref && deps.loadCandidateByWebhookRef) {
    candidate = await deps.loadCandidateByWebhookRef(ref);
    if (candidate) correlationSource = 'webhook_ref';
  }
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
  // Apollo person id (APOLLO-PHONE-CACHE-1a): se captura si el payload lo trae
  // válido; el wrapper sólo escribe la columna cuando es truthy (no la fuerza en
  // no_phone_found ni sobrescribe con null). Prerrequisito, no caché.
  const apolloPersonId = extractWebhookPersonId(input.payload);

  // 6a. Con teléfono → revealed + apollo_reveal, conserva créditos reales.
  if (best) {
    // FIX 3 — SUPRESIÓN EN VUELO. El reveal es asíncrono, así que una DSAR pudo
    // registrarse DESPUÉS del START y ANTES de este callback. Se comprueba el
    // tombstone antes de escribir nada, con el flag de caché encendido o apagado.
    // Solo se ejecuta en este camino: si Apollo no entregó teléfono no hay número
    // que suprimir, y el camino `no_phone_found` queda idéntico (0 lecturas).
    const suppression = await evaluateInFlightPhoneSuppression({
      personId: resolveInFlightSuppressionPersonId({
        payloadPersonId: apolloPersonId,
        candidateApolloPersonId: candidate.apolloPersonId ?? null,
        candidateSource: candidate.source ?? null,
        candidateSourceContactId: candidate.sourceContactId ?? null,
      }),
      accountId: candidate.accountId,
      lookup: deps.lookupPhoneCacheSuppression,
    });
    const suppressionState = describeInFlightSuppression(suppression);

    // No verificable ⇒ fail-closed. NO se persiste el teléfono y NO se toca el
    // status: el candidato sigue en vuelo, así que el recovery puede repolear el
    // MISMO payload sin gastar créditos. Se deja rastro en el usage-log.
    if (suppression.kind === 'check_unavailable') {
      deps.onSuppressionCheckUnavailable?.(suppression.message);
      await deps.logUsage({
        operationKey: PHONE_REVEAL_OPERATION_KEY,
        provider: 'apollo',
        creditsUsed: credits,
        status: 'error',
        errorCode: SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
        metadata: {
          candidate_id: candidate.id,
          account_id: candidate.accountId,
          provider: 'apollo',
          reveal_status: SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
          reveal_phase: 'webhook',
          suppression_state: suppressionState,
          request_id: requestId,
          webhook_ref: ref,
          correlation_source: correlationSource,
          phone_revealed: false,
          phone_type: null,
          credits_used: credits,
        },
      });
      return { httpStatus: 200, outcome: 'suppression_check_unavailable' };
    }

    // Tombstone ⇒ el teléfono se descarta. NO se escribe `phone`, NO se toca
    // `enrichment_metadata.phone`, NO se propaga `apollo_person_id` (no se añade
    // ningún dato nuevo de una persona suprimida) y NO se escribe caché. Se
    // cierra terminal para que el recovery no lo vuelva a traer.
    if (suppression.kind === 'blocked_suppressed') {
      await deps.persist(candidate.id, {
        phone_reveal_status: 'error',
        phone_reveal_completed_at: deps.nowIso,
        phone_reveal_webhook_received_at: deps.nowIso,
        phone_reveal_provider: PHONE_REVEAL_PROVIDER,
        phone_reveal_cost_credits: credits,
        phone_reveal_error_code: SUPPRESSION_BLOCKED_ERROR_CODE,
      });
      await deps.logUsage({
        operationKey: PHONE_REVEAL_OPERATION_KEY,
        provider: 'apollo',
        creditsUsed: credits,
        status: 'success',
        errorCode: SUPPRESSION_BLOCKED_ERROR_CODE,
        metadata: {
          candidate_id: candidate.id,
          account_id: candidate.accountId,
          provider: 'apollo',
          reveal_status: SUPPRESSION_BLOCKED_ERROR_CODE,
          reveal_phase: 'webhook',
          suppression_state: suppressionState,
          request_id: requestId,
          webhook_ref: ref,
          correlation_source: correlationSource,
          phone_revealed: false,
          phone_type: null,
          credits_used: credits,
        },
      });
      return { httpStatus: 200, outcome: 'blocked_suppressed' };
    }

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
      apollo_person_id: apolloPersonId,
    };
    await deps.persist(candidate.id, patch);
    // Caché (APOLLO-PHONE-CACHE-1b): solo tras persistir el reveal, solo con
    // teléfono, y best-effort. Sin person id válido / cuenta / país ISO-2 la
    // propia decisión de escritura lo descarta con un motivo mecánico.
    await cacheRevealedPhoneBestEffort(deps, {
      candidate,
      phone: revealed.number,
      phoneType: revealed.type,
      personId: apolloPersonId,
    });
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
        // FIX 3: queda constancia de que la comprobación SE HIZO (o de por qué no
        // era evaluable) también cuando el teléfono sí se persiste.
        suppression_state: suppressionState,
        request_id: requestId,
        webhook_ref: ref,
        correlation_source: correlationSource,
        phone_revealed: true,
        phone_type: revealed.type,
        credits_used: credits,
      },
    });
    return { httpStatus: 200, outcome: 'revealed' };
  }

  // 6b. Sin teléfono → no_phone_found, no inventa dato, conserva créditos. El
  //     apollo_person_id sólo se propaga si el payload lo trae válido (null si no
  //     existe: el wrapper NO fuerza ni sobrescribe). No escribe caché.
  const patch: WebhookRevealPersistencePatch = {
    phone_reveal_status: 'no_phone_found',
    phone_reveal_completed_at: deps.nowIso,
    phone_reveal_webhook_received_at: deps.nowIso,
    phone_reveal_provider: PHONE_REVEAL_PROVIDER,
    phone_reveal_cost_credits: credits,
    phone_reveal_error_code: null,
    apollo_person_id: apolloPersonId,
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
      webhook_ref: ref,
      correlation_source: correlationSource,
      phone_revealed: false,
      phone_type: null,
      credits_used: credits,
    },
  });
  return { httpStatus: 200, outcome: 'no_phone_found' };
}
