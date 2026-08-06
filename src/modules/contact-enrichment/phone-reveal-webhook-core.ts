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

import type { ClassifiedPhone } from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import {
  buildRevealPhoneCacheWriteInput,
  type PhoneCacheWriteInput,
} from './phone-cache-core';
import {
  buildApolloPhoneCollectionCapture,
  type ApolloPhoneCollectionCapture,
} from './apollo-phone-collection-capture';
import {
  describeCandidatePhoneCollectionWrite,
  resolvePrimaryPhoneForCandidate,
  type CandidatePhoneCollectionLogFields,
  type CandidatePhoneCollectionWriteResult,
  type PersistCandidatePhoneCollection,
} from './candidate-phone-collection-writer';
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
import {
  reportPhoneSuppressionNotEvaluable,
  type PhoneSuppressionNotEvaluableSink,
} from './phone-reveal-suppression-audit';
import type {
  ContactCandidateEnrichmentMetadata,
  ContactCandidatePhoneMetadata,
} from './types';

// ── Código de la colección no persistible (4O-C) ───────────────

/**
 * Los teléfonos llegaron y la supresión estaba comprobada, pero la colección
 * canónica no se pudo escribir.
 *
 * Es fail-closed por la MISMA razón que `suppression_check_unavailable`: cerrar
 * el reveal como éxito dejaría el candidato con un teléfono visible y la
 * colección incompleta —el estado exactamente prohibido— y además marcaría como
 * terminal un resultado que todavía se puede recuperar GRATIS. No terminalizar
 * deja al candidato en vuelo, y el siguiente poll de recuperación reprocesa el
 * MISMO payload sin gastar créditos.
 */
export const COLLECTION_PERSISTENCE_UNAVAILABLE_ERROR_CODE =
  'collection_persistence_unavailable' as const;

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
  /**
   * Señal de "todavía procesando" (APOLLO-PHONE-RECOVERY-L3). Apollo confirmó que
   * `GET /webhook_result/{request_id}` puede responder con un estado pendiente y un
   * `retry_after_seconds` en vez del resultado. Campos OPCIONALES y solo de lectura
   * defensiva: el webhook real nunca los trae y su ausencia deja todo igual. Los
   * consume el recovery core para NO terminalizar como `no_phone_found` un payload
   * que solo dice "aún no está listo".
   */
  status?: string | null;
  state?: string | null;
  retry_after_seconds?: number | string | null;
  phone_enrichment?: {
    status?: string | null;
    retry_after_seconds?: number | string | null;
  } | null;
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
  /**
   * Momento REAL del reveal: el instante en que llegó un teléfono que se persistió.
   * Solo se emite en el camino `revealed` — un `no_phone_found` no reveló nada, y un
   * bloqueo por supresión tampoco, así que ahí queda ausente y la columna no se toca
   * (AGENT2A-PHONE-REVEAL-4N § 6). Antes de este hito el camino Apollo NUNCA lo escribía,
   * mientras el camino Lusha sí, y esa asimetría dejaba candidatos revelados por Apollo
   * sin fecha de revelación.
   */
  phone_revealed_at?: string;
  phone_reveal_cost_credits: number | null;
  /**
   * Procedencia de la cifra de créditos de la columna anterior, con el mismo vocabulario
   * cerrado que ya usa el camino Lusha (mig. 095/097).
   *
   *   * `reported`    — Apollo devolvió un número de créditos en el callback.
   *   * `unknown`     — no lo devolvió, y todavía NO se ha liquidado la reserva. Es el
   *     caso REAL de Apollo hoy: el webhook no puede afirmar un costo que nadie reportó.
   *
   * `assumed_cap` no lo escribe este core: esa cifra es ECONÓMICA (el tope autorizado que
   * la reserva confirmó) y la conoce la reconciliación, que la escribe después. Ver
   * `reconcilePhoneRevealCreditReservationForRun`.
   */
  phone_reveal_cost_source: 'reported' | 'unknown';
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
      | typeof SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE
      // 4O-C: los teléfonos llegaron pero la colección no se pudo escribir.
      | typeof COLLECTION_PERSISTENCE_UNAVAILABLE_ERROR_CODE;
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
    /**
     * `phone_reveal_waterfall_runs.id` cuando este callback cierra la PRIMERA pata
     * de un waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1). Id de fila PROPIO
     * de SellUp: correlaciona esta pata con la de Lusha bajo UNA autorización, sin
     * mezclar créditos (cada pata conserva su fila y su `credits_used`). NO es un
     * id de proveedor y NO es PII.
     *
     * La clave se OMITE cuando no hay waterfall (dep no cableada o sin corrida
     * activa), así que con el flag apagado la metadata es la de antes de este hito.
     */
    phone_reveal_waterfall_id?: string;
    /**
     * Cifras de la colección de teléfonos (AGENT2A-PHONE-REVEAL-4O-C). Forma
     * CERRADA y sin PII: conteos y banderas, jamás un número, un display ni una
     * `dedupe_key`. Las claves se OMITEN cuando la dep del writer no está
     * cableada, así que sin ella la metadata es la de antes de este hito.
     */
    phone_collection?: CandidatePhoneCollectionLogFields;
  };
}

// ── Hook de continuación del waterfall (AGENT2A-PHONE-WATERFALL-1) ──

/**
 * Desenlaces Apollo que este webhook puede comunicar al waterfall. Se declara
 * estructuralmente (sin importar phone-reveal-waterfall-core) para que este core
 * siga sin dependencias de la capa del waterfall y no exista riesgo de ciclo.
 */
export type WebhookWaterfallApolloOutcome =
  | 'revealed'
  | 'no_phone_found'
  | 'blocked_suppressed'
  | 'suppression_check_unavailable';

export interface WebhookWaterfallContinuationArgs {
  candidateId: string;
  apolloOutcome: WebhookWaterfallApolloOutcome;
  /** Créditos que Apollo reportó. null si no los reportó (nunca 0 por defecto). */
  apolloCostCredits: number | null;
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

  /**
   * Persiste TODOS los teléfonos del payload en la colección canónica
   * (AGENT2A-PHONE-REVEAL-4O-C). OPCIONAL: sin esta dep el webhook se comporta
   * exactamente como antes del hito — un solo teléfono en el escalar y los demás
   * perdidos — y ni siquiera añade la clave `phone_collection` a la metadata.
   *
   * NO es best-effort, a diferencia de la caché. Se invoca ANTES de persistir el
   * candidato y si LANZA el reveal NO se cierra: la caché es un optimizador cuyo
   * fallo no pierde nada, mientras que aquí lo que se está guardando son números
   * ya pagados que no existen en ningún otro sitio. Un fallo silencioso sería
   * repetir la pérdida que este hito corrige.
   *
   * Debe devolver la clave que quedó REALMENTE como principal: el escalar del
   * candidato se decide con ese valor, no con la preferencia enviada, para que
   * colección y escalar no puedan discrepar.
   */
  persistCandidatePhoneCollection?: PersistCandidatePhoneCollection;

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
  /**
   * Notifica que la supresión no se pudo EVALUAR (FIX 4): sin Apollo person id
   * resoluble o sin cuenta no existe clave con la que emparejar un tombstone. El
   * teléfono se persiste igual — no se bloquea por inferencia — pero el caso queda
   * registrado con un evento de forma CERRADA y sin PII.
   */
  onSuppressionNotEvaluable?: PhoneSuppressionNotEvaluableSink;

  // ── Waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1) ─────
  // Las DOS deps son OPCIONALES y solo se cablean cuando
  // ENABLE_PHONE_REVEAL_WATERFALL está encendido. Sin ellas este core se comporta
  // exactamente como antes de este hito: no resuelve corrida, no añade la clave a
  // la metadata y no continúa nada.

  /**
   * Resuelve el id de la corrida activa del waterfall para el candidato, SOLO para
   * incluirlo en la metadata del usage-log. Best-effort por contrato: el caller
   * (este core) traga cualquier excepción y sigue sin la clave — un problema al
   * correlacionar NUNCA puede perder un teléfono ya pagado.
   */
  resolveWaterfallRunId?: (candidateId: string) => Promise<string | null>;
  /**
   * Continúa el waterfall tras terminalizar Apollo. Se invoca DESPUÉS de persistir
   * el desenlace y DESPUÉS del usage-log, y es el único camino por el que la pata
   * Lusha puede llegar a ejecutarse.
   *
   * BEST-EFFORT por contrato: su resultado se ignora y sus excepciones se tragan
   * aquí de forma acotada. Un fallo de la pata Lusha NO puede convertir un webhook
   * correcto en 5xx, porque eso haría a Apollo reintentar el callback sin resolver
   * nada. La idempotencia (claim atómico) vive en el core del waterfall.
   */
  continueWaterfall?: (args: WebhookWaterfallContinuationArgs) => Promise<unknown>;
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
  | 'suppression_check_unavailable'
  // 4O-C — los teléfonos llegaron pero la colección canónica no se pudo
  // escribir. Fail-closed y NO terminal, por el mismo motivo que el anterior: el
  // candidato sigue en vuelo y el recovery puede reprocesar el MISMO resultado
  // con 0 créditos. NO se escribe el escalar, así que nunca queda un teléfono
  // visible sin su colección. HTTP 200: un 5xx solo haría reintentar a Apollo.
  | 'collection_persistence_unavailable';

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

/**
 * Reúne los teléfonos del payload sin importar dónde vengan anidados.
 *
 * ⚠️ Devuelve una lista PLANA: pierde la ubicación de cada entrada y por tanto no
 * permite distinguir «dos teléfonos distintos» de «el mismo objeto repetido por
 * Apollo en la raíz y bajo `person`». Ese es exactamente el motivo por el que
 * `sumWebhookCredits` podía contar un cargo dos veces. Desde 4O-C la captura y la
 * contabilidad usan `collectLocatedApolloPhoneNumbers`, que conserva la
 * ubicación; esta función se mantiene porque su salida plana es la que
 * `pickBestApolloPhone` consume y la que varios tests fijan.
 */
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
 * Procedencia de la cifra de créditos que este webhook puede afirmar
 * (AGENT2A-PHONE-REVEAL-4N § 6).
 *
 * Solo dos valores son honestos aquí: `reported` cuando Apollo devolvió un número, y
 * `unknown` cuando no. NUNCA `assumed_cap` — el tope autorizado es un hecho ECONÓMICO de
 * la reserva, no algo que el proveedor haya dicho, y quien lo conoce es la reconciliación.
 * Escribirlo desde aquí sería presentar una suposición nuestra como un dato del proveedor.
 */
function resolveWebhookCostSource(credits: number | null): 'reported' | 'unknown' {
  return typeof credits === 'number' && Number.isFinite(credits) ? 'reported' : 'unknown';
}

/**
 * Suma los créditos consumidos reportados por el webhook (null si no hay dato).
 *
 * ⚠️ Suma CADA elemento de la lista que reciba. Sobre la salida plana de
 * `collectWebhookPhoneNumbers` eso duplica el cargo de un registro que Apollo
 * haya repetido en varias ubicaciones. Los caminos terminales de webhook y
 * recovery ya NO la usan: desde 4O-C contabilizan con
 * `sumApolloPhoneCreditsAcrossLocations`, que reconoce esa repetición. Se
 * conserva exportada porque es el contrato que fijan los tests previos y porque
 * sigue siendo correcta para una lista de una sola ubicación.
 */
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

/**
 * Resuelve el id de la corrida del waterfall sin poder romper el webhook
 * (AGENT2A-PHONE-WATERFALL-1). Solo alimenta una clave de metadata, así que
 * cualquier fallo se traga y se devuelve null: correlacionar es deseable, no
 * imprescindible. Con la dep sin cablear (flag apagado) devuelve null sin I/O.
 */
async function resolveWaterfallRunIdBestEffort(
  deps: ApolloPhoneRevealWebhookDeps,
  candidateId: string,
): Promise<string | null> {
  if (!deps.resolveWaterfallRunId) return null;
  try {
    return cleanText(await deps.resolveWaterfallRunId(candidateId));
  } catch {
    return null;
  }
}

/**
 * Continúa el waterfall sin poder romper el webhook. El desenlace Apollo ya está
 * persistido y logueado cuando esto corre, así que un fallo aquí solo significa
 * "la 2ª pata no se intentó ahora": jamás un 5xx que haga a Apollo reintentar.
 */
async function continueWaterfallBestEffort(
  deps: ApolloPhoneRevealWebhookDeps,
  args: WebhookWaterfallContinuationArgs,
): Promise<void> {
  if (!deps.continueWaterfall) return;
  try {
    await deps.continueWaterfall(args);
  } catch {
    // Silencio deliberado y acotado: el wrapper del waterfall ya registra el
    // fallo sin PII, y este callback no puede degradarse a un reintento de Apollo.
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

  // 5b. Corrida del waterfall (AGENT2A-PHONE-WATERFALL-1). Se resuelve una sola
  //     vez, después de tener candidato y antes de cualquier usage-log, para que
  //     TODOS los desenlaces de este callback queden correlacionados con la misma
  //     autorización. Con el flag apagado la dep no está cableada ⇒ null, sin I/O.
  const waterfallRunId = await resolveWaterfallRunIdBestEffort(deps, candidate.id);
  const waterfallMeta = waterfallRunId
    ? { phone_reveal_waterfall_id: waterfallRunId }
    : {};

  // 6. Capturar TODOS los teléfonos del payload (AGENT2A-PHONE-REVEAL-4O-C) y,
  //    dentro de esa captura, el que el camino heredado habría elegido
  //    (`legacyBest`) — que sigue siendo el que decide el escalar salvo que la
  //    base diga otra cosa. `credits` sale ahora del cálculo por ubicación, que
  //    corrige el doble conteo de un mismo registro repetido en la raíz y bajo
  //    `person`; para un payload sin duplicados estructurales da lo mismo que
  //    `sumWebhookCredits`.
  const capture: ApolloPhoneCollectionCapture = buildApolloPhoneCollectionCapture({
    payload: input.payload,
    context: {
      phase: 'webhook',
      waterfallRunId,
      // Ni la reserva ni el usage-log de ESTE callback existen todavía cuando se
      // construye la captura, así que se declaran null en vez de inventarse: la
      // migración los admite nulos precisamente para no fabricar correlaciones.
      reservationId: null,
      providerUsageLogId: null,
      observedAt: deps.nowIso,
    },
  });
  const credits = capture.credits;
  const best = capture.legacyBest;
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

    // FIX 4 — no EVALUABLE (sin person id resoluble o sin cuenta): la política no
    // cambia — no hay fuzzy matching por teléfono/email/nombre/LinkedIn y el
    // teléfono se persiste igual — pero el caso se registra en vez de quedar
    // invisible. Es un efecto de auditoría: no bloquea ni desbloquea nada.
    if (suppression.kind === 'not_evaluable') {
      reportPhoneSuppressionNotEvaluable({
        phase: 'webhook',
        reason: suppression.reason,
        candidateId: candidate.id,
        accountId: candidate.accountId,
        sink: deps.onSuppressionNotEvaluable,
      });
    }

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
          ...waterfallMeta,
        },
      });
      // Waterfall: la supresión no se pudo verificar, así que la 2ª pata NO se
      // gasta. La corrida se cierra fail-closed (nunca se lee como "sin
      // tombstone"); el candidato sigue en vuelo para el recovery, y si el
      // operador quiere volver a intentarlo tendrá que autorizarlo de nuevo.
      await continueWaterfallBestEffort(deps, {
        candidateId: candidate.id,
        apolloOutcome: SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
        apolloCostCredits: credits,
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
        // Sin `phone_revealed_at`: el teléfono llegó pero un tombstone impidió
        // persistirlo, así que NO hay revelación que fechar.
        phone_reveal_cost_credits: credits,
        phone_reveal_cost_source: resolveWebhookCostSource(credits),
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
          ...waterfallMeta,
        },
      });
      // Waterfall: hay tombstone ⇒ la corrida se aborta y la pata Lusha no se
      // intenta. Una supresión registrada bloquea a TODOS los proveedores.
      await continueWaterfallBestEffort(deps, {
        candidateId: candidate.id,
        apolloOutcome: SUPPRESSION_BLOCKED_ERROR_CODE,
        apolloCostCredits: credits,
      });
      return { httpStatus: 200, outcome: 'blocked_suppressed' };
    }

    // ── 4O-C — COLECCIÓN COMPLETA ────────────────────────────────
    // Se escribe ANTES del candidato, y ese orden es la garantía: si la
    // colección no se puede guardar, el escalar tampoco se escribe y el estado
    // prohibido «teléfono visible sin colección» no llega a existir. Sin la dep
    // cableada este bloque no hace nada y el camino queda como antes del hito.
    let collection: CandidatePhoneCollectionWriteResult | null = null;
    if (deps.persistCandidatePhoneCollection && capture.phones.length > 0) {
      try {
        collection = await deps.persistCandidatePhoneCollection({
          candidateId: candidate.id,
          phones: capture.phones,
          primaryPreference: capture.primaryPreference,
          observedAt: deps.nowIso,
        });
      } catch {
        // Fail-closed y SIN ruido con PII: el writer ya propagó el error de la
        // base, que describe la operación y no el dato. No se persiste nada del
        // candidato, así que sigue en vuelo y recuperable con 0 créditos.
        await deps.logUsage({
          operationKey: PHONE_REVEAL_OPERATION_KEY,
          provider: 'apollo',
          creditsUsed: credits,
          status: 'error',
          errorCode: COLLECTION_PERSISTENCE_UNAVAILABLE_ERROR_CODE,
          metadata: {
            candidate_id: candidate.id,
            account_id: candidate.accountId,
            provider: 'apollo',
            reveal_status: COLLECTION_PERSISTENCE_UNAVAILABLE_ERROR_CODE,
            reveal_phase: 'webhook',
            suppression_state: suppressionState,
            request_id: requestId,
            webhook_ref: ref,
            correlation_source: correlationSource,
            phone_revealed: false,
            phone_type: null,
            credits_used: credits,
            phone_collection: describeCandidatePhoneCollectionWrite({
              result: null,
              duplicatePhoneCount: capture.counters.duplicate_phone_count,
              canonicalPhoneCount: capture.counters.canonical_phone_count,
              sourceCount: capture.counters.source_count,
            }),
            ...waterfallMeta,
          },
        });
        // El waterfall NO se continúa: este reveal no ha concluido, solo no ha
        // podido guardarse. Cerrar la corrida haría que la recuperación posterior
        // —que sí va a terminarlo— se encontrara la puerta cerrada, y llamar a
        // Lusha gastaría créditos por un teléfono que Apollo YA entregó.
        return { httpStatus: 200, outcome: 'collection_persistence_unavailable' };
      }
    }

    // El escalar sale del principal que la base dejó REALMENTE marcado, no de la
    // preferencia enviada: si un tombstone tumbó la primera opción, el escalar
    // sigue al principal superviviente en vez de contradecirlo.
    const primary = resolvePrimaryPhoneForCandidate({
      phones: capture.phones,
      primaryDedupeKey: collection?.primary_dedupe_key ?? null,
      legacy: best,
    });
    const revealed: ClassifiedPhone = {
      number: primary.number,
      type: primary.type,
      source: 'apollo_reveal',
      raw_type: primary.raw_type,
    };
    const collectionMeta = deps.persistCandidatePhoneCollection
      ? {
          phone_collection: describeCandidatePhoneCollectionWrite({
            result: collection,
            duplicatePhoneCount: capture.counters.duplicate_phone_count,
            canonicalPhoneCount: capture.counters.canonical_phone_count,
            sourceCount: capture.counters.source_count,
          }),
        }
      : {};
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
      // ÚNICO camino que revela: es el que fecha la revelación (§ 6).
      phone_revealed_at: deps.nowIso,
      phone_reveal_cost_credits: credits,
      phone_reveal_cost_source: resolveWebhookCostSource(credits),
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
        // 4O-C: conteos de la colección. Clave omitida sin la dep cableada.
        ...collectionMeta,
        ...waterfallMeta,
      },
    });
    // Waterfall: Apollo entregó el teléfono ⇒ la corrida se cierra con
    // final_provider = apollo y la pata Lusha NUNCA se intenta (0 créditos Lusha).
    await continueWaterfallBestEffort(deps, {
      candidateId: candidate.id,
      apolloOutcome: 'revealed',
      apolloCostCredits: credits,
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
    // Sin `phone_revealed_at`: no hubo teléfono, así que no hay nada que fechar.
    phone_reveal_cost_credits: credits,
    phone_reveal_cost_source: resolveWebhookCostSource(credits),
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
      ...waterfallMeta,
    },
  });
  // Waterfall: ÚNICO desenlace que puede abrir la 2ª pata. El `no_phone_found` de
  // Apollo ya quedó persistido arriba (no se altera), y la continuación decide —
  // con claim atómico, TTL y re-chequeo de supresión/DNC — si Lusha corre. Si el
  // candidato no tiene id Lusha propio, la corrida se cierra `exhausted` con 0
  // llamadas. Best-effort: un fallo aquí no convierte este 200 en 5xx.
  await continueWaterfallBestEffort(deps, {
    candidateId: candidate.id,
    apolloOutcome: 'no_phone_found',
    apolloCostCredits: credits,
  });
  return { httpStatus: 200, outcome: 'no_phone_found' };
}
