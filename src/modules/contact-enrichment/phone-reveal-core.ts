// Agente 2A — Apollo Phone Reveal: START core (APOLLO-PHONE-ASYNC-1)
//
// Pure, dependency-injected orchestration for the explicit, per-candidate Apollo
// phone reveal — now ASYNCHRONOUS. This module owns ONLY validation + decision
// logic + the shape of the DB patch and the (PII-free) usage-log entry. It
// performs NO I/O directly: the flag value, the actor, the candidate load, the
// do-not-contact check, the webhook URL, the Apollo START call, the persistence
// write and the usage-log write are all injected as deps, so the whole contract
// is testable offline with no Supabase, no network and no real provider.
//
// WHY ASYNC (confirmed Apollo contract):
//   * people/match with reveal_phone_number:true REQUIRES a webhook_url; without
//     it Apollo returns HTTP 422.
//   * the immediate response does NOT carry phone numbers — only a correlation
//     id (request_id). The phones arrive LATER on the webhook callback
//     (see phone-reveal-webhook-core.ts).
// This core therefore only STARTS the reveal: it validates, calls Apollo to
// obtain a request_id, and persists an in-flight `requested` state. It never
// reads phone_numbers from the immediate response (the old synchronous model,
// which could not work).
//
// Legal/product contract enforced here (never by a migration):
//   * reveal is INDIVIDUAL per candidate — one candidateId, never an array
//   * human cost confirmation mandatory (up to 8 Apollo credits per candidate)
//   * phone_processing_basis mandatory; note required for other_approved_basis
//   * authorized roles only: Administrador (admin) / Manager comercial
//     (commercial_manager)
//   * Apollo only — no Lusha, no HubSpot, no auto-write, no auto-approve
//   * no phone / email / linkedin / name / raw payload in the usage-log metadata
//
// The `reveal_phone_number: true` + `webhook_url` literals live ONLY in the
// helper (buildApolloPhoneRevealMatchParams); this core calls that helper and
// never writes those literals itself. Real reveal stays gated behind
// ENABLE_APOLLO_PHONE_REVEAL, which this milestone does NOT activate.

import type { MatchPersonParams } from '@/server/integrations/apollo-client';
import type { ApolloPhoneRevealTraceMetadata } from '@/server/integrations/apollo-phone-reveal-response';
import {
  buildApolloPhoneRevealMatchParams,
  type ApolloPhoneRevealInput,
} from '@/server/agents/contact-enrichment-toolkit/apollo-phone-reveal';
import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '@/lib/apollo-guardrails';
import { normalizeRevealSourceProvider } from '@/server/agents/contact-enrichment-toolkit/apollo-phone-reveal';
import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import {
  buildPhoneCacheHitUsageLog,
  evaluatePhoneCacheLookup,
  evaluatePhoneCacheSuppressionState,
  resolvePhoneCachePersonId,
  resolvePhoneCacheCountryCode,
  PHONE_CACHE_HIT_CREDITS,
  PHONE_CACHE_HIT_PHONE_SOURCE,
  PHONE_CACHE_PROVIDER,
  type PhoneCacheEntry,
  type PhoneCacheHitUsageLogEntry,
  type PhoneCacheLookupKey,
  type PhoneCacheSuppressionLookupKey,
  type PhoneCacheSuppressionState,
} from './phone-cache-core';
import type {
  ContactCandidateEnrichmentMetadata,
  ContactCandidatePhoneMetadata,
  ContactSource,
  PhoneProcessingBasis,
} from './types';

// ── Constantes ─────────────────────────────────────────────────

/** Créditos estimados de un reveal de teléfono Apollo (mucho más caro que email). */
export const APOLLO_PHONE_REVEAL_CREDITS =
  APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.phoneRevealCredits; // 8

/** operation_key único del reveal en provider_usage_logs. */
export const PHONE_REVEAL_OPERATION_KEY = 'person_phone_reveal';

/** Proveedor único del reveal. Sin fallback Lusha por contrato legal/producto. */
export const PHONE_REVEAL_PROVIDER = 'apollo' as const;

/** Roles autorizados para disparar un reveal (Administrador + Manager comercial). */
export const PHONE_REVEAL_AUTHORIZED_ROLE_KEYS: readonly string[] = [
  'admin',
  'commercial_manager',
];

/** Vocabulario de base de tratamiento aprobado (espejo de la migración 095). */
export const VALID_PHONE_PROCESSING_BASES: readonly PhoneProcessingBasis[] = [
  'legitimate_interest_b2b',
  'consent_obtained',
  'existing_business_relationship',
  'customer_requested_contact',
  'other_approved_basis',
];

/** Estados en vuelo que bloquean un segundo reveal del mismo candidato. */
export const PHONE_REVEAL_IN_FLIGHT_STATUSES: readonly string[] = [
  'requested',
  'pending',
];

/**
 * Código de error seguro (sin PII) cuando el START de Apollo aceptó el job async
 * (hay `phone_enrichment.request_id`) pero su respuesta NO trajo el identificador
 * recuperable `apollo_http_request_id`. Sin ese id no hay forma de recuperar el
 * resultado por `GET /webhook_result/{id}` (contrato ASYNC-21C), así que el
 * candidato NO puede quedar en vuelo (`requested`/`pending`): se marca `error`.
 * Espeja el vocabulario del recovery core (`RecoveryOutcome`) para diagnóstico
 * consistente. Invariante START-CONTRACT-1.
 */
export const MISSING_RECOVERY_REQUEST_ID_ERROR_CODE =
  'missing_recovery_request_id';

// ── Entrada de la acción ───────────────────────────────────────

/**
 * Entrada mínima de la acción de reveal. `candidateId` es SIEMPRE un string
 * único: no existe variante en lote (no bulk) — esa invariante se verifica
 * estáticamente además de en runtime.
 */
export interface RevealCandidatePhoneInput {
  candidateId: string;
  /** Confirmación humana explícita del costo (hasta 8 créditos). Debe ser true. */
  confirmCost: boolean;
  /** Base de tratamiento (habeas data). Obligatoria. */
  phoneProcessingBasis: PhoneProcessingBasis | string | null | undefined;
  /** Nota escrita: obligatoria SOLO si basis = other_approved_basis. */
  phoneProcessingBasisNote?: string | null;
  /** Tope de créditos que el operador acepta. Default 8. */
  expectedMaxCredits?: number;
}

// ── Registro del candidato (proyección mínima para el reveal) ───

/**
 * Proyección de solo lectura del candidato necesaria para iniciar el reveal.
 * Incluye la identidad para Apollo (source_contact_id / email / linkedin), el
 * contexto de empresa, la metadata de enriquecimiento (para preservar/mergear el
 * teléfono) y el estado de reveal previo (para bloquear re-reveal / reveal en
 * vuelo).
 */
export interface RevealCandidateRecord {
  id: string;
  accountId: string | null;
  /**
   * Proveedor/origen del candidato (contact_enrichment_candidates.source).
   * Determina si `sourceContactId` puede reenviarse a Apollo como person id: sólo
   * los candidatos origen Apollo tienen un id compatible. Para Lusha (u otros) el
   * id es de otro espacio y Apollo lo rechaza (HTTP 422), así que se omite y el
   * match se hace por email/linkedin/name/company. Opcional/nullable: ausente o
   * distinto de 'apollo' ⇒ NO se reenvía el id (fail-closed anti-contaminación).
   */
  source?: ContactSource | null;
  sourceContactId: string | null;
  email: string | null;
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  existingPhone: string | null;
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  phoneRevealStatus: string | null;
  /** Nº de intentos previos (migración 097). Default 0 en filas nuevas. */
  phoneRevealAttemptCount?: number | null;
  /**
   * Apollo person id ya persistido (columna de la migración 098, CACHE-1a). Es
   * la clave preferente del fast path de caché (APOLLO-PHONE-CACHE-1b). Opcional:
   * ausente ⇒ se intenta el fallback por `sourceContactId` cuando el candidato es
   * origen Apollo, y si tampoco hay id válido el resultado es un cache miss.
   */
  apolloPersonId?: string | null;
  /** País del candidato (texto crudo del proveedor). Alcance de caché. */
  candidateCountry?: string | null;
  /** País ISO-2 de la empresa del run. Fallback del alcance de caché. */
  runCompanyCountryCode?: string | null;
}

// ── Respuesta del START de Apollo (inyectada) ──────────────────

/**
 * Resultado normalizado del INICIO del reveal asíncrono en Apollo. No trae
 * teléfonos: solo el id de correlación (request_id) o un código de error seguro
 * (sin PII, sin payload crudo). El teléfono llega después por el webhook.
 *
 * `errorHint` (opcional) es una razón corta ya sanitizada/allowlisted (sin PII,
 * sin body crudo, sin secretos) que el wrapper extrae del error de Apollo para
 * diagnóstico. Se registra SOLO en provider_usage_logs.metadata; nunca sustituye
 * al `errorCode` mecánico (p.ej. HTTP_422) ni toca el schema del candidato.
 */
export type ApolloPhoneRevealStartCallResult =
  | {
      ok: true;
      requestId: string | null;
      /**
       * Código de error seguro cuando Apollo respondió 200 pero NO creó job async
       * (sin phone_enrichment.request_id): 'no_async_job_created' |
       * 'skipped_without_request_id'. Sustituye al genérico 'missing_request_id'.
       * null en el camino feliz (hay requestId).
       */
      noAsyncJobCode?: string | null;
      /** Metadata técnica de traza (sin PII) para el usage-log. */
      trace?: ApolloPhoneRevealTraceMetadata | null;
    }
  | {
      ok: false;
      errorCode: string;
      errorHint?: string | null;
      /** Metadata técnica de traza (sin PII) para el usage-log. */
      trace?: ApolloPhoneRevealTraceMetadata | null;
    };

// ── Patch de persistencia del START (describe el UPDATE, no lo ejecuta) ──

/**
 * Patch escrito al INICIAR el reveal. No toca `phone` ni el teléfono existente:
 * el número real solo se persiste cuando llegue el webhook. En `requested`
 * guardamos el request_id de correlación y el timestamp; en `error` (start
 * fallido) guardamos el código seguro y NO tocamos el teléfono previo.
 */
export interface RevealStartPersistencePatch {
  phone_reveal_status: 'requested' | 'error';
  phone_reveal_request_id: string | null;
  phone_reveal_requested_at: string | null;
  phone_reveal_completed_at: string | null;
  phone_revealed_by: string;
  phone_reveal_provider: 'apollo';
  phone_reveal_cost_credits: number | null;
  phone_reveal_cost_usd: number | null;
  phone_reveal_error_code: string | null;
  phone_reveal_attempt_count: number;
  phone_processing_basis: PhoneProcessingBasis;
  phone_processing_basis_note: string | null;
  /**
   * Apollo person id VALIDADO (24 hex) resuelto en el START (APOLLO-PHONE-CACHE-1a):
   * de la traza (`trace.apollo_person_id`) o, como fallback, del
   * `source_contact_id` SÓLO cuando el candidato es origen Apollo. null si no se
   * pudo resolver un id Apollo válido (ausente / inválido / Lusha `v1.*`). El
   * wrapper NUNCA sobrescribe un valor existente con null/inválido (sólo escribe
   * cuando es truthy). Id opaco de correlación, NO PII.
   */
  apollo_person_id: string | null;
}

// ── Patch de persistencia del CACHE HIT (APOLLO-PHONE-CACHE-1b) ──

/**
 * Patch escrito cuando el teléfono se sirve desde la caché en lugar de llamar a
 * Apollo. A diferencia del START, aquí SÍ se persiste el número (ya estaba
 * pagado) y el estado queda terminal `revealed` en un solo paso: no hay webhook
 * que esperar.
 *
 * La procedencia es SIEMPRE `apollo_cache`, nunca `apollo_reveal`: un número
 * reutilizado tiene que ser distinguible de un reveal nuevo en el candidato, en
 * la UI y en el contacto oficial. El costo es 0 créditos porque no hubo llamada
 * al proveedor, y la base de tratamiento es obligatoria igual que en el reveal.
 */
export interface RevealCacheHitPersistencePatch {
  phone: string;
  enrichment_metadata: ContactCandidateEnrichmentMetadata;
  phone_reveal_status: 'revealed';
  phone_reveal_provider: 'apollo';
  phone_reveal_request_id: null;
  phone_revealed_at: string;
  phone_reveal_completed_at: string;
  phone_revealed_by: string;
  /** Cache hit = 0 créditos: no hubo llamada al proveedor. */
  phone_reveal_cost_credits: typeof PHONE_CACHE_HIT_CREDITS;
  phone_reveal_cost_usd: 0;
  phone_reveal_error_code: null;
  phone_reveal_attempt_count: number;
  phone_processing_basis: PhoneProcessingBasis;
  phone_processing_basis_note: string | null;
  apollo_person_id: string;
}

// ── Entrada del usage-log (SIN PII) ────────────────────────────

/**
 * Metadata permitida en provider_usage_logs para el START. Deliberadamente NO
 * contiene teléfono, email, linkedin, nombre ni payload crudo. El request_id es
 * un id opaco de correlación (no dato personal). Al iniciar NO se cobran
 * créditos (el costo real llega con el webhook), así que credits_used = null.
 */
export interface PhoneRevealUsageLogEntry {
  operationKey: typeof PHONE_REVEAL_OPERATION_KEY;
  provider: 'apollo';
  triggeredBy: string;
  creditsUsed: number | null;
  costUsd: number | null;
  status: 'success' | 'error';
  errorCode: string | null;
  metadata: {
    candidate_id: string;
    account_id: string | null;
    provider: 'apollo';
    reveal_status: string;
    reveal_phase: 'start';
    request_id: string | null;
    /** true cuando Apollo devolvió un request_id de correlación (START aceptado). */
    has_request_id: boolean;
    credits_used: number | null;
    cost_usd: number | null;
    processing_basis: PhoneProcessingBasis;
    error_code: string | null;
    /**
     * Razón corta ya sanitizada del error de Apollo (sin PII, sin body crudo,
     * sin secretos). null en el camino feliz. Diagnóstico del 422 sin schema.
     */
    apollo_error_hint: string | null;
    /**
     * true sólo si se envió `id` (Apollo person id) en el payload de match. Para
     * candidatos Lusha/otros es false (el id ajeno se omite). Diagnóstico de
     * contaminación cross-provider; no es PII (booleano derivado).
     */
    id_forwarded_to_apollo: boolean;
    /**
     * Proveedor de origen normalizado del candidato ('apollo' | 'lusha' | otro |
     * null). NO es dato personal: es la fuente que encontró al candidato. Permite
     * correlacionar el 422 con el origen sin exponer el id ni identidad alguna.
     */
    source_provider_for_id: string | null;
    /**
     * Traza técnica del START de Apollo (presencia de phone_enrichment/person,
     * request/transaction ids de traza HTTP). SIN PII: sólo booleanos de presencia
     * e ids técnicos de correlación (nunca teléfono/email/linkedin/nombre/body).
     * null cuando Apollo no devolvió una respuesta interpretable (p.ej. error HTTP).
     */
    apollo_trace: ApolloPhoneRevealTraceMetadata | null;
  };
}

// ── Deps inyectadas ────────────────────────────────────────────

export interface RevealCandidatePhoneDeps {
  /** Valor del flag ENABLE_APOLLO_PHONE_REVEAL resuelto por el wrapper. */
  flagEnabled: boolean;
  /** Actor autenticado + su role key (resueltos por el wrapper). */
  actor: { internalUserId: string; roleKey: string | null };
  /** Timestamp ISO estable (inyectado para tests deterministas). */
  nowIso: string;
  /**
   * URL pública del webhook de Apollo (env APOLLO_PHONE_REVEAL_WEBHOOK_URL,
   * resuelta por el wrapper). Si es null/vacía el reveal se bloquea con
   * `provider_not_configured` ANTES de llamar a Apollo (Apollo respondería 422).
   */
  webhookUrl: string | null;
  /** Carga la proyección del candidato. Devuelve null si no existe. */
  loadCandidate: (candidateId: string) => Promise<RevealCandidateRecord | null>;
  /**
   * Indica si el candidato/contacto/cuenta está marcado do_not_contact. Cuando
   * no hay forma fiable de consultarlo, el wrapper devuelve false (no se puede
   * detectar). Si devuelve true, el reveal se bloquea antes de llamar a Apollo.
   */
  isDoNotContact: (candidate: RevealCandidateRecord) => Promise<boolean>;
  /**
   * Inicia el reveal asíncrono en Apollo (única llamada de red, en el wrapper).
   * Devuelve el request_id de correlación, nunca teléfonos.
   */
  startRevealViaApollo: (
    params: MatchPersonParams,
  ) => Promise<ApolloPhoneRevealStartCallResult>;
  /** Aplica el UPDATE de auditoría sobre el candidato (service role). */
  persist: (
    candidateId: string,
    patch: RevealStartPersistencePatch,
  ) => Promise<void>;
  /** Registra el uso/costo en provider_usage_logs (metadata sin PII). */
  logUsage: (entry: PhoneRevealUsageLogEntry) => Promise<void>;

  // ── Cumplimiento de SUPRESIÓN (APOLLO-PHONE-CACHE-1b, FIX 2) ──
  // A diferencia del fast path, esto NO depende de `cacheEnabled`: el flag
  // gobierna la REUTILIZACIÓN de un teléfono cacheado, nunca el cumplimiento de
  // una supresión ya registrada.

  /**
   * Busca el tombstone de (provider, person, MISMA cuenta). Se invoca SIEMPRE que
   * el candidato tenga Apollo person id y cuenta, con el flag de caché encendido o
   * apagado, y ANTES de cualquier llamada a Apollo.
   *
   * Debe LANZAR si la lectura no se puede completar: el core lo traduce a
   * `suppression_check_unavailable` y no llama al proveedor. Si la dep no está
   * cableada el reveal también se detiene — no hay reveal sin comprobación de
   * supresión.
   */
  lookupPhoneCacheSuppression?: (
    key: PhoneCacheSuppressionLookupKey,
  ) => Promise<PhoneCacheSuppressionState | null>;
  /**
   * Notifica que la supresión no se pudo verificar. Recibe SOLO un mensaje
   * mecánico: nunca teléfono, person id, email, nombre ni linkedin.
   */
  onSuppressionCheckUnavailable?: (message: string) => void;

  // ── Fast path de caché (APOLLO-PHONE-CACHE-1b) ───────────────
  // TODAS estas deps son OPCIONALES. Con `cacheEnabled` en false/undefined
  // (default de producción) el core NO las invoca: no se reutiliza ningún
  // teléfono y el camino Apollo es el de antes de la caché. La comprobación de
  // supresión de más arriba sí corre.

  /**
   * Valor del flag ENABLE_APOLLO_PHONE_CACHE resuelto por el wrapper. Default
   * false (fail-closed): sin él no se REUTILIZA ningún teléfono cacheado y el
   * reveal sigue el camino Apollo normal. NO gobierna la supresión.
   */
  cacheEnabled?: boolean;
  /**
   * Busca la entrada de caché de (provider, person, account). Devuelve también
   * las entradas SUPRIMIDAS (tombstone) para que el core pueda bloquear: filtrar
   * la supresión en el store rompería la garantía de bloqueo.
   */
  lookupPhoneCache?: (key: PhoneCacheLookupKey) => Promise<PhoneCacheEntry | null>;
  /** Aplica el UPDATE terminal del cache hit sobre el candidato (service role). */
  persistCacheHit?: (
    candidateId: string,
    patch: RevealCacheHitPersistencePatch,
  ) => Promise<void>;
  /** Registra el hit en provider_usage_logs (0 créditos, metadata sin PII). */
  logCacheHitUsage?: (entry: PhoneCacheHitUsageLogEntry) => Promise<void>;
  /**
   * Marca el uso de la entrada (last_used_at + hit_count). NUNCA extiende el
   * TTL. Best-effort: un fallo aquí no debe romper un hit ya persistido.
   */
  touchPhoneCacheEntry?: (cacheEntryId: string, usedAtIso: string) => Promise<void>;
  /**
   * Hash del person id para el usage-log (el core es puro y no usa crypto). Si
   * no se inyecta se registra 'unavailable' — nunca el id en claro.
   */
  hashProviderPersonId?: (personId: string) => string;
  /**
   * Notifica que la búsqueda en caché no se pudo completar (APOLLO-PHONE-CACHE-1b,
   * FIX H4). Recibe SOLO un mensaje mecánico del driver: nunca teléfono, id de
   * persona, email, nombre ni linkedin. El core es puro, así que el logging real
   * lo hace el wrapper.
   */
  onCacheLookupUnavailable?: (message: string) => void;
  /**
   * Notifica que la persistencia del cache hit no se pudo completar
   * (APOLLO-PHONE-CACHE-1b, FIX H4-b). Recibe SOLO un mensaje mecánico YA
   * redactado por el core: nunca teléfono, email, nombre, linkedin ni id de
   * persona en claro. El core es puro, así que el logging real lo hace el wrapper.
   */
  onCacheHitPersistFailed?: (message: string) => void;
  /**
   * Notifica que el usage-log del cache hit falló (APOLLO-PHONE-CACHE-1b, FIX
   * H4-b). Best-effort: el teléfono ya quedó persistido y el hit NO se revierte.
   * Mensaje mecánico redactado, sin PII.
   */
  onCacheHitUsageLogFailed?: (message: string) => void;
}

// ── Resultado de la acción ─────────────────────────────────────

export type RevealCandidatePhoneStatus =
  | 'disabled'
  | 'unauthorized_role'
  | 'invalid_candidate'
  | 'cost_confirmation_required'
  | 'processing_basis_required'
  | 'invalid_processing_basis'
  | 'processing_basis_note_required'
  | 'candidate_not_found'
  // Reservado por compatibilidad: ya no se emite. account_id es opcional para el
  // reveal (ver paso 8 en runRevealCandidatePhone). No reintroducir como gate.
  | 'candidate_account_invalid'
  | 'already_revealed'
  | 'already_pending'
  | 'do_not_contact'
  | 'insufficient_identity'
  | 'provider_not_configured'
  // Estado feliz del START asíncrono: solicitud aceptada, esperando webhook.
  | 'requested'
  // APOLLO-PHONE-CACHE-1b: el teléfono se sirvió desde un reveal ya pagado.
  // Terminal e inmediato (no hay webhook), 0 créditos, sin llamada a Apollo.
  | 'revealed_from_cache'
  // APOLLO-PHONE-CACHE-1b: existe un tombstone de supresión para esta persona
  // en esta cuenta. Bloquea el hit Y el reveal automático. No se llama a Apollo.
  // Se emite con ENABLE_APOLLO_PHONE_CACHE encendido o apagado (FIX 2).
  | 'blocked_suppressed'
  // APOLLO-PHONE-CACHE-1b (FIX 2): la SUPRESIÓN no se pudo verificar (tabla
  // ausente, timeout, dep no cableada). Fail-closed: NO se llama a Apollo, porque
  // podría existir un tombstone sin haber sido visto. Independiente del flag de
  // caché. 0 créditos, sin teléfono, reintentable.
  | 'suppression_check_unavailable'
  // APOLLO-PHONE-CACHE-1b (FIX H4): la caché no se pudo consultar. Fail-closed:
  // NO se llama a Apollo. Solo alcanzable con el flag de caché encendido (con el
  // flag apagado no hay lectura de caché que pueda fallar). 0 créditos.
  //
  // FIX H4-b: este mismo estado cubre el fallo de la PERSISTENCIA del hit
  // (`errorCode = 'cache_persist_failed'`). Las garantías para el operador son
  // idénticas — sin llamada a Apollo, 0 créditos, sin teléfono, reintentable —
  // así que se reutiliza el estado en vez de ampliar la superficie de la UI. El
  // errorCode distingue ambos casos en observabilidad.
  | 'cache_unavailable'
  | 'error';

export interface RevealCandidatePhoneResult {
  ok: boolean;
  status: RevealCandidatePhoneStatus;
  /**
   * true solo cuando Apollo aceptó la solicitud asíncrona y quedó un request_id
   * persistido. El teléfono NO está disponible aún (llega por webhook).
   */
  requestAccepted: boolean;
  /** Código de error seguro (sin PII) cuando status = error. */
  errorCode: string | null;
  /**
   * true solo cuando el teléfono se sirvió desde la caché (APOLLO-PHONE-CACHE-1b).
   * El número NUNCA viaja en el resultado: esto es solo una señal booleana para
   * que la UI sepa que ya hay teléfono persistido sin esperar webhook.
   */
  servedFromCache?: boolean;
}

// ── Helpers puros ──────────────────────────────────────────────

function fail(
  status: RevealCandidatePhoneStatus,
  errorCode: string | null = null,
): RevealCandidatePhoneResult {
  return { ok: false, status, requestAccepted: false, errorCode };
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Deja pasar SOLO texto mecánico de un error de driver (APOLLO-PHONE-CACHE-1b,
 * FIX H4-b). Postgres cita los valores del payload en sus mensajes de error
 * (p. ej. `Key (phone)=(+57...)`), y el patch del cache hit contiene el teléfono
 * y el id de persona: propagar `err.message` en claro filtraría PII al log. Se
 * borran URLs de LinkedIn, correos, ids hexadecimales largos y secuencias de
 * dígitos, y se acota el largo. El error crudo NUNCA sale del core.
 */
function redactDriverMessage(raw: unknown): string {
  const text =
    raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '';
  const trimmed = text.trim();
  if (!trimmed) return 'unknown error';
  return trimmed
    .replace(/https?:\/\/\S*linkedin\.com\S*/gi, '[redacted-url]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\b[0-9a-f]{16,}\b/gi, '[redacted-id]')
    .replace(/\+?\d[\d\s().-]{3,}\d/g, '[redacted-number]')
    .slice(0, 300);
}

function isValidBasis(value: unknown): value is PhoneProcessingBasis {
  return (
    typeof value === 'string' &&
    (VALID_PHONE_PROCESSING_BASES as readonly string[]).includes(value)
  );
}

function existingPhoneSource(
  metadata: ContactCandidateEnrichmentMetadata,
): string | null {
  const phone = metadata.phone as ContactCandidatePhoneMetadata | null | undefined;
  const source = phone?.source;
  return typeof source === 'string' ? source : null;
}

/**
 * Procedencias que ya representan un teléfono revelado y por tanto bloquean un
 * segundo reveal. Incluye `apollo_cache` (APOLLO-PHONE-CACHE-1b): un número
 * servido desde caché es tan definitivo como uno recién revelado — reintentarlo
 * gastaría créditos por un dato que ya tenemos.
 */
const ALREADY_REVEALED_PHONE_SOURCES: readonly string[] = [
  'apollo_reveal',
  PHONE_CACHE_HIT_PHONE_SOURCE,
];

// ── Orquestación pura del START ────────────────────────────────

/**
 * INICIA el reveal explícito de teléfono para UN candidato (asíncrono). Todas
 * las validaciones fail-closed corren ANTES de cualquier llamada a Apollo o
 * escritura en DB, en orden barato→caro. Con el flag apagado (default de
 * producción) retorna `disabled` sin tocar ninguna dep salvo la lectura del
 * propio flag. NO lee teléfonos: el resultado real llega por el webhook.
 */
export async function runRevealCandidatePhone(
  input: RevealCandidatePhoneInput,
  deps: RevealCandidatePhoneDeps,
): Promise<RevealCandidatePhoneResult> {
  // 1. Flag OFF → nada de Apollo, nada de DB.
  if (!deps.flagEnabled) return fail('disabled');

  // 2. Rol autorizado (Administrador / Manager comercial).
  if (
    !deps.actor.roleKey ||
    !PHONE_REVEAL_AUTHORIZED_ROLE_KEYS.includes(deps.actor.roleKey)
  ) {
    return fail('unauthorized_role');
  }

  // 3. candidateId válido y único (no bulk: solo string).
  const candidateId = cleanText(
    typeof input.candidateId === 'string' ? input.candidateId : null,
  );
  if (!candidateId) return fail('invalid_candidate');

  // 4. Confirmación de costo explícita (hasta 8 créditos).
  const acceptedMax =
    typeof input.expectedMaxCredits === 'number' &&
    Number.isFinite(input.expectedMaxCredits)
      ? input.expectedMaxCredits
      : APOLLO_PHONE_REVEAL_CREDITS;
  if (input.confirmCost !== true || acceptedMax < APOLLO_PHONE_REVEAL_CREDITS) {
    return fail('cost_confirmation_required');
  }

  // 5. Base de tratamiento obligatoria y válida.
  const basisRaw = cleanText(
    typeof input.phoneProcessingBasis === 'string'
      ? input.phoneProcessingBasis
      : null,
  );
  if (!basisRaw) return fail('processing_basis_required');
  if (!isValidBasis(basisRaw)) return fail('invalid_processing_basis');
  const basis: PhoneProcessingBasis = basisRaw;

  // 6. Nota obligatoria si basis = other_approved_basis.
  const note = cleanText(input.phoneProcessingBasisNote);
  if (basis === 'other_approved_basis' && !note) {
    return fail('processing_basis_note_required');
  }

  // 7. Cargar candidato.
  const candidate = await deps.loadCandidate(candidateId);
  if (!candidate) return fail('candidate_not_found');

  // 8. account_id es OPCIONAL — NO se bloquea por su ausencia (PHONE-3D.6C). El
  //    reveal se resuelve por IDENTIDAD (source_contact_id / email / linkedin,
  //    validada en el paso 12). do_not_contact (paso 11) sí sigue bloqueando
  //    cuando hay forma de evaluarlo. `candidate_account_invalid` se conserva en
  //    la unión por compatibilidad, pero ya no se emite.

  // 9. Bloquear re-reveal: ya revelado, o ya tiene teléfono de apollo_reveal /
  //    apollo_cache (un número servido desde caché también es definitivo).
  const currentPhoneSource = existingPhoneSource(candidate.enrichmentMetadata);
  if (
    candidate.phoneRevealStatus === 'revealed' ||
    (currentPhoneSource !== null &&
      ALREADY_REVEALED_PHONE_SOURCES.includes(currentPhoneSource))
  ) {
    return fail('already_revealed');
  }

  // 10. Bloquear reveal en vuelo: ya hay una solicitud requested/pending
  //     esperando su webhook. Sin reintento automático.
  if (
    typeof candidate.phoneRevealStatus === 'string' &&
    PHONE_REVEAL_IN_FLIGHT_STATUSES.includes(candidate.phoneRevealStatus)
  ) {
    return fail('already_pending');
  }

  // 11. do_not_contact bloquea el reveal (si hay forma de detectarlo).
  if (await deps.isDoNotContact(candidate)) return fail('do_not_contact');

  // 12. webhook_url obligatoria ANTES de gastar la llamada (Apollo → 422 sin
  //     ella). Fail-closed cuando el entorno no está configurado.
  const webhookUrl = cleanText(deps.webhookUrl);
  if (!webhookUrl) return fail('provider_not_configured');

  // 13. Identidad suficiente + payload asíncrono (helper: único punto con
  //     reveal_phone_number: true + webhook_url).
  const identity: ApolloPhoneRevealInput = {
    // El proveedor de origen decide si source_contact_id viaja como Apollo id.
    // Sólo 'apollo' lo reenvía; Lusha/otros lo omiten (evita el HTTP 422 por id
    // ajeno) y hacen match por email/linkedin/name/company.
    sourceProvider: candidate.source ?? null,
    sourceContactId: candidate.sourceContactId,
    email: candidate.email,
    linkedinUrl: candidate.linkedinUrl,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    organizationName: candidate.organizationName,
    webhookUrl,
  };
  const built = buildApolloPhoneRevealMatchParams(identity);
  if (!built.ok) {
    if (built.error === 'webhook_url_required') {
      return fail('provider_not_configured');
    }
    return fail('insufficient_identity');
  }

  // Observabilidad (sin PII): ¿se reenvió un Apollo id? ¿desde qué proveedor?
  const idForwardedToApollo = Boolean(built.params.id);
  const sourceProviderForId = normalizeRevealSourceProvider(candidate.source);

  const nextAttempt = (candidate.phoneRevealAttemptCount ?? 0) + 1;

  // 13b. CUMPLIMIENTO DE SUPRESIÓN (APOLLO-PHONE-CACHE-1b, FIX 2). Corre DESPUÉS
  //      de todos los gates fail-closed y ANTES de cualquier llamada a Apollo,
  //      con el flag de caché ENCENDIDO O APAGADO. `ENABLE_APOLLO_PHONE_CACHE`
  //      decide si se REUTILIZA un teléfono ya pagado; no puede decidir si se
  //      respeta una supresión ya registrada. Sin esta comprobación, un tombstone
  //      escrito mientras el flag estaba encendido dejaría de bloquear en cuanto
  //      el flag se apagase, y el reveal manual volvería a traer el número.
  const suppressionOutcome = await enforcePhoneRevealSuppression({
    candidate,
    deps,
  });
  if (suppressionOutcome) return suppressionOutcome;

  // 13c. FAST PATH DE CACHÉ (APOLLO-PHONE-CACHE-1b). Corre DESPUÉS de todos los
  //      gates fail-closed (flag de reveal, rol, candidato, sin teléfono, no en
  //      vuelo, base de tratamiento, confirmación de costo, do-not-contact,
  //      identidad suficiente, supresión) y ANTES de cualquier llamada a Apollo.
  //      Con `cacheEnabled` en false — el default de producción — este bloque no
  //      se ejecuta y ningún teléfono se reutiliza.
  const cacheOutcome = await tryServeFromPhoneCache({
    candidate,
    candidateId,
    basis,
    note,
    nextAttempt,
    deps,
  });
  if (cacheOutcome) return cacheOutcome;

  // Cierre común del START fallido: persiste estado `error` (sin tocar el
  // teléfono previo, sin créditos) + usage-log sin PII, y devuelve el resultado
  // de error. Lo comparten TODOS los caminos de fallo del START: error real de
  // Apollo, HTTP 200 sin job async, y HTTP 200 con handle pero sin identificador
  // recuperable. Mantiene un único punto de verdad para el patch de error.
  const persistStartError = async (
    errorCode: string,
    errorHint: string | null,
    trace: ApolloPhoneRevealTraceMetadata | null,
  ): Promise<RevealCandidatePhoneResult> => {
    const patch: RevealStartPersistencePatch = {
      phone_reveal_status: 'error',
      phone_reveal_request_id: null,
      phone_reveal_requested_at: deps.nowIso,
      phone_reveal_completed_at: deps.nowIso,
      phone_revealed_by: deps.actor.internalUserId,
      phone_reveal_provider: PHONE_REVEAL_PROVIDER,
      phone_reveal_cost_credits: null,
      phone_reveal_cost_usd: null,
      phone_reveal_error_code: errorCode,
      phone_reveal_attempt_count: nextAttempt,
      phone_processing_basis: basis,
      phone_processing_basis_note: note,
      // START fallido: no hay reveal ⇒ ningún id que persistir. El wrapper no
      // sobrescribe un apollo_person_id previo con este null.
      apollo_person_id: null,
    };
    await deps.persist(candidateId, patch);
    await deps.logUsage(
      buildUsageLogEntry({
        candidate,
        actorId: deps.actor.internalUserId,
        revealStatus: 'error',
        requestId: null,
        basis,
        errorCode,
        errorHint,
        idForwardedToApollo,
        sourceProviderForId,
        trace,
      }),
    );
    return { ok: false, status: 'error', requestAccepted: false, errorCode };
  };

  // 14. Iniciar el reveal asíncrono en Apollo (única red, en el wrapper).
  const started = await deps.startRevealViaApollo(built.params);

  // 15a. Error o request_id ausente → estado error, código seguro sin PII.
  //      Sin request_id no hay forma de correlacionar el webhook.
  //      Cuando Apollo respondió 200 pero NO creó job async (sin
  //      phone_enrichment.request_id) el cliente entrega un código específico
  //      ('no_async_job_created' | 'skipped_without_request_id') que usamos en
  //      lugar del genérico 'missing_request_id'. En ese caso NO se espera
  //      webhook, NO se marca pending y NO se consumen créditos.
  if (!started.ok || !cleanText(started.requestId)) {
    const errorCode = !started.ok
      ? cleanText(started.errorCode) ?? 'apollo_reveal_start_failed'
      : cleanText(started.noAsyncJobCode) ?? 'missing_request_id';
    // Hint sanitizado (sin PII) solo cuando Apollo devolvió un error real; nunca
    // se persiste en el candidato (solo en el usage-log). Sin request_id => hint
    // no aplica.
    const errorHint = !started.ok ? cleanText(started.errorHint) : null;
    return persistStartError(errorCode, errorHint, started.trace ?? null);
  }

  // 15b. INVARIANTE DE RECUPERABILIDAD (APOLLO-PHONE-REVEAL-START-CONTRACT-1):
  //      un candidato SOLO puede quedar en vuelo (`requested`/`pending`) si
  //      existe un identificador ACTIVAMENTE recuperable: el
  //      `apollo_http_request_id` (top-level request_id / x-http-request-id) con
  //      el que el recovery hace GET /webhook_result/{id} (contrato ASYNC-21C).
  //      El handle async `phone_enrichment.request_id` NO sirve para recovery
  //      (devuelve 404). Si Apollo aceptó el job pero su respuesta NO trajo un
  //      apollo_http_request_id, el reveal no sería recuperable por poll y
  //      quedaría colgado en "Revelación en proceso" para siempre si el webhook
  //      nunca llega. Fail-closed: se marca `error` (no `requested`), sin
  //      créditos. La traza (con apollo_http_request_id: null) va al usage-log
  //      para diagnóstico; el candidato queda terminal y reintentable.
  const recoveryRequestId = cleanText(
    started.trace?.apollo_http_request_id ?? null,
  );
  if (!recoveryRequestId) {
    return persistStartError(
      MISSING_RECOVERY_REQUEST_ID_ERROR_CODE,
      null,
      started.trace ?? null,
    );
  }

  // 15c. Solicitud aceptada + id recuperable presente → estado requested +
  //      request_id. Sin créditos aún (el costo real llega con el webhook). Sin
  //      teléfono todavía.
  const requestId = cleanText(started.requestId);
  // Apollo person id (APOLLO-PHONE-CACHE-1a): prioriza el id validado de la traza
  // del START; si no vino, cae al source_contact_id SÓLO cuando el candidato es
  // origen Apollo (ids de otros proveedores, p.ej. Lusha `v1.*`, se descartan en
  // el validador). Prerrequisito reutilizable; NO sirve teléfono ni cachea nada.
  const apolloPersonId =
    normalizeApolloPersonId(started.trace?.apollo_person_id ?? null) ??
    (normalizeRevealSourceProvider(candidate.source) === PHONE_REVEAL_PROVIDER
      ? normalizeApolloPersonId(candidate.sourceContactId)
      : null);
  const patch: RevealStartPersistencePatch = {
    phone_reveal_status: 'requested',
    phone_reveal_request_id: requestId,
    phone_reveal_requested_at: deps.nowIso,
    phone_reveal_completed_at: null,
    phone_revealed_by: deps.actor.internalUserId,
    phone_reveal_provider: PHONE_REVEAL_PROVIDER,
    phone_reveal_cost_credits: null,
    phone_reveal_cost_usd: null,
    phone_reveal_error_code: null,
    phone_reveal_attempt_count: nextAttempt,
    phone_processing_basis: basis,
    phone_processing_basis_note: note,
    apollo_person_id: apolloPersonId,
  };
  await deps.persist(candidateId, patch);
  await deps.logUsage(
    buildUsageLogEntry({
      candidate,
      actorId: deps.actor.internalUserId,
      revealStatus: 'requested',
      requestId,
      basis,
      errorCode: null,
      errorHint: null,
      idForwardedToApollo,
      sourceProviderForId,
      trace: started.trace ?? null,
    }),
  );
  return { ok: true, status: 'requested', requestAccepted: true, errorCode: null };
}

// ── Cumplimiento de supresión (APOLLO-PHONE-CACHE-1b, FIX 2) ───

/**
 * Comprueba el tombstone de supresión ANTES de llamar a Apollo, con
 * independencia de `ENABLE_APOLLO_PHONE_CACHE`. Devuelve:
 *   * `blocked_suppressed` — existe supresión para (apollo, persona, cuenta): no
 *     se llama a Apollo, no se gastan créditos y no se revela teléfono;
 *   * `suppression_check_unavailable` — la comprobación no se pudo hacer (dep no
 *     cableada o lectura fallida): tampoco se llama a Apollo, porque "no pude
 *     comprobarlo" no equivale a "no está suprimido". Reintentable, 0 créditos;
 *   * `null` — no hay supresión (o no existe clave posible) y el reveal continúa.
 *
 * Límite conocido y deliberado: el tombstone se identifica por Apollo person id +
 * cuenta, la misma clave con la que se escribe. Un candidato sin `apollo_person_id`
 * resoluble o sin cuenta no puede emparejarse con ninguna supresión registrada, así
 * que continúa por el camino Apollo normal. No se intenta emparejar por
 * teléfono/email/nombre: un match difuso aquí sería un bloqueo (o un no-bloqueo)
 * decidido por inferencia. El país NO entra en la clave: una supresión bloquea a
 * esa persona en esa cuenta aunque el país del candidato cambie o sea desconocido.
 */
async function enforcePhoneRevealSuppression(args: {
  candidate: RevealCandidateRecord;
  deps: RevealCandidatePhoneDeps;
}): Promise<RevealCandidatePhoneResult | null> {
  const { candidate, deps } = args;

  const personId = resolvePhoneCachePersonId({
    apolloPersonId: candidate.apolloPersonId ?? null,
    sourceProvider: candidate.source ?? null,
    sourceContactId: candidate.sourceContactId,
  });
  const accountId = cleanText(candidate.accountId);
  // Sin clave no puede existir tombstone alguno que consultar.
  if (!personId || !accountId) return null;

  const unavailable = (message: string): RevealCandidatePhoneResult => {
    deps.onSuppressionCheckUnavailable?.(message);
    return {
      ok: false,
      status: 'suppression_check_unavailable',
      requestAccepted: false,
      errorCode: 'suppression_check_unavailable',
      servedFromCache: false,
    };
  };

  // Dep ausente = wiring incompleto. Fail-closed: no hay reveal sin comprobación
  // de supresión, ni siquiera con el flag de caché apagado.
  if (!deps.lookupPhoneCacheSuppression) {
    return unavailable('suppression lookup not wired');
  }

  let state: PhoneCacheSuppressionState | null;
  try {
    state = await deps.lookupPhoneCacheSuppression({
      provider: PHONE_CACHE_PROVIDER,
      providerPersonId: personId,
      accountId,
    });
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : 'unknown error');
  }

  if (evaluatePhoneCacheSuppressionState(state) === 'suppressed') {
    return {
      ok: false,
      status: 'blocked_suppressed',
      requestAccepted: false,
      errorCode: null,
      servedFromCache: false,
    };
  }

  return null;
}

// ── Fast path de caché (APOLLO-PHONE-CACHE-1b) ─────────────────

/**
 * Intenta servir el teléfono desde un reveal Apollo ya pagado en vez de llamar
 * al proveedor. Corre DESPUÉS de `enforcePhoneRevealSuppression`, así que cuando
 * llega aquí ya se sabe que no hay supresión; su propio chequeo de tombstone se
 * conserva como defensa en profundidad. Devuelve:
 *   * `RevealCandidatePhoneResult` cuando decide el desenlace — hit servido
 *     (`revealed_from_cache`) o tombstone que bloquea (`blocked_suppressed`);
 *   * `null` cuando NO decide nada y el reveal debe continuar por Apollo
 *     (flag de caché apagado, sin deps cableadas, o cualquier miss).
 *
 * Reglas de política aplicadas aquí (todas fail-closed, todas ⇒ miss):
 *   * sin `cacheEnabled` ⇒ ni siquiera se construye la clave (0 lecturas);
 *   * sin Apollo person id válido (incluido un id Lusha `v1.*`) ⇒ miss;
 *   * sin `account_id` ⇒ miss (no hay alcance de reutilización posible);
 *   * sin país ISO-2 resoluble ⇒ miss (país desconocido = no reuso);
 *   * la búsqueda es SIEMPRE por (provider, person, MISMA cuenta, MISMO país):
 *     no existe consulta cross-account ni cross-country;
 *   * entrada expirada (TTL 90d) ⇒ miss, y el hit NUNCA extiende el TTL.
 *
 * Un hit persiste el número con procedencia `apollo_cache`, 0 créditos y la base
 * de tratamiento del operador, y registra `person_phone_cache_hit` sin PII.
 *
 * FIX H4-b — ningún efecto posterior al hit puede escalar a 500 ni degradar a
 * Apollo. Los tres efectos están acotados y NINGUNO propaga la excepción:
 *   * `persistCacheHit` falla ⇒ `cache_unavailable` / `cache_persist_failed`:
 *     sin teléfono, sin usage-log, sin telemetría, sin Apollo, 0 créditos,
 *     reintentable;
 *   * `logCacheHitUsage` falla ⇒ el hit YA persistido se mantiene exitoso
 *     (`revealed_from_cache`); solo se notifica la pérdida del log;
 *   * `touchPhoneCacheEntry` falla ⇒ telemetría no crítica, silencio acotado.
 */
async function tryServeFromPhoneCache(args: {
  candidate: RevealCandidateRecord;
  candidateId: string;
  basis: PhoneProcessingBasis;
  note: string | null;
  nextAttempt: number;
  deps: RevealCandidatePhoneDeps;
}): Promise<RevealCandidatePhoneResult | null> {
  const { candidate, candidateId, basis, note, nextAttempt, deps } = args;

  // Flag OFF o wiring ausente ⇒ camino Apollo intacto, sin ninguna lectura.
  if (deps.cacheEnabled !== true) return null;
  if (!deps.lookupPhoneCache || !deps.persistCacheHit || !deps.logCacheHitUsage) {
    return null;
  }

  const personId = resolvePhoneCachePersonId({
    apolloPersonId: candidate.apolloPersonId ?? null,
    sourceProvider: candidate.source ?? null,
    sourceContactId: candidate.sourceContactId,
  });
  if (!personId) return null;

  const accountId = cleanText(candidate.accountId);
  if (!accountId) return null;

  const countryCode = resolvePhoneCacheCountryCode({
    candidateCountry: candidate.candidateCountry ?? null,
    runCompanyCountryCode: candidate.runCompanyCountryCode ?? null,
  });
  if (!countryCode) return null;

  const key: PhoneCacheLookupKey = {
    provider: PHONE_CACHE_PROVIDER,
    providerPersonId: personId,
    accountId,
    countryCode,
  };

  // FIX H4: la lectura de caché puede fallar (tabla ausente, timeout, error de
  // Postgres). NO se puede degradar a "miss" y llamar a Apollo: un tombstone de
  // supresión podría existir sin haber sido visto, y revelar de nuevo violaría la
  // supresión además de gastar créditos. Fail-closed y reintentable.
  let found: PhoneCacheEntry | null;
  try {
    found = await deps.lookupPhoneCache(key);
  } catch (err) {
    deps.onCacheLookupUnavailable?.(redactDriverMessage(err));
    return {
      ok: false,
      status: 'cache_unavailable',
      requestAccepted: false,
      errorCode: 'cache_unavailable',
      servedFromCache: false,
    };
  }

  const evaluation = evaluatePhoneCacheLookup(key, found, deps.nowIso);

  // Tombstone: bloquea el hit Y el reveal automático. No se llama a Apollo y no
  // se devuelve teléfono alguno.
  if (evaluation.outcome === 'blocked_suppressed') {
    return {
      ok: false,
      status: 'blocked_suppressed',
      requestAccepted: false,
      errorCode: null,
      servedFromCache: false,
    };
  }

  if (evaluation.outcome !== 'hit' || !evaluation.entry) return null;

  const entry = evaluation.entry;
  const phone = cleanText(entry.normalizedPhone);
  // Defensa en profundidad: el evaluador ya exige teléfono, pero nunca
  // persistimos un hit vacío — ante la duda, reveal normal.
  if (!phone) return null;

  const phoneType =
    typeof entry.phoneType === 'string' && entry.phoneType.trim()
      ? entry.phoneType.trim()
      : 'unknown';

  const phoneMetadata: ContactCandidatePhoneMetadata = {
    number: phone,
    type: phoneType as ContactCandidatePhoneMetadata['type'],
    // Procedencia distinguible: NUNCA 'apollo_reveal' para un número reutilizado.
    source: PHONE_CACHE_HIT_PHONE_SOURCE,
    raw_type: null,
  };

  const patch: RevealCacheHitPersistencePatch = {
    phone,
    enrichment_metadata: {
      ...candidate.enrichmentMetadata,
      phone: phoneMetadata,
    },
    phone_reveal_status: 'revealed',
    phone_reveal_provider: PHONE_REVEAL_PROVIDER,
    phone_reveal_request_id: null,
    phone_revealed_at: deps.nowIso,
    phone_reveal_completed_at: deps.nowIso,
    phone_revealed_by: deps.actor.internalUserId,
    phone_reveal_cost_credits: PHONE_CACHE_HIT_CREDITS,
    phone_reveal_cost_usd: 0,
    phone_reveal_error_code: null,
    phone_reveal_attempt_count: nextAttempt,
    phone_processing_basis: basis,
    phone_processing_basis_note: note,
    apollo_person_id: personId,
  };
  // FIX H4-b: la persistencia del hit puede fallar (timeout, RLS, columna
  // ausente, constraint). Un throw aquí escapaba del server action y terminaba
  // en 500, sin decirle al operador que NO se llamó a Apollo ni se cobró nada.
  // Fail-closed y reintentable: mismo estado seguro que un fallo de lectura, con
  // errorCode propio. Sin persistencia NO hubo hit, así que tampoco se emite el
  // usage-log ni la telemetría de reutilización, y el teléfono no se devuelve.
  try {
    await deps.persistCacheHit(candidateId, patch);
  } catch (err) {
    deps.onCacheHitPersistFailed?.(redactDriverMessage(err));
    return {
      ok: false,
      status: 'cache_unavailable',
      requestAccepted: false,
      errorCode: 'cache_persist_failed',
      servedFromCache: false,
    };
  }

  // FIX H4-b: el teléfono YA quedó persistido con procedencia `apollo_cache`, 0
  // créditos y la base de tratamiento del operador. Un fallo del usage-log no
  // puede revertir eso ni escalar a 500: bloquearía al operador por una
  // operación gratuita y lo empujaría a reintentar un reveal ya resuelto. El
  // rastro de auditoría mínimo sobrevive en el candidato (procedencia + base +
  // 0 créditos); la pérdida se observa por el notificador, sin PII.
  try {
    await deps.logCacheHitUsage(
      buildPhoneCacheHitUsageLog({
        candidateId,
        accountId,
        cacheEntryId: entry.id,
        // El id del proveedor NUNCA se registra en claro: si no hay hasher
        // inyectado se marca 'unavailable' en vez de degradar la garantía.
        providerPersonIdHash: deps.hashProviderPersonId
          ? deps.hashProviderPersonId(personId)
          : 'unavailable',
        actorUserId: deps.actor.internalUserId,
        actorRole: deps.actor.roleKey ?? 'unknown',
        phoneType,
        originalRevealedAt: entry.originalRevealedAt,
        processingBasis: basis,
      }),
    );
  } catch (err) {
    deps.onCacheHitUsageLogFailed?.(redactDriverMessage(err));
  }

  // Telemetría de reutilización (last_used_at + hit_count). Best-effort: el hit
  // ya está persistido, así que un fallo aquí no puede revertirlo ni escalar.
  // NO extiende el TTL.
  if (deps.touchPhoneCacheEntry) {
    try {
      await deps.touchPhoneCacheEntry(entry.id, deps.nowIso);
    } catch {
      // Silencio deliberado y acotado: telemetría no crítica. El error real ya
      // se observa en el store, y propagarlo rompería un reveal correcto.
    }
  }

  return {
    ok: true,
    status: 'revealed_from_cache',
    requestAccepted: false,
    errorCode: null,
    servedFromCache: true,
  };
}

// ── Constructor del log de uso (sin PII) ───────────────────────

function buildUsageLogEntry(args: {
  candidate: RevealCandidateRecord;
  actorId: string;
  revealStatus: 'requested' | 'error';
  requestId: string | null;
  basis: PhoneProcessingBasis;
  errorCode: string | null;
  errorHint: string | null;
  idForwardedToApollo: boolean;
  sourceProviderForId: string | null;
  trace: ApolloPhoneRevealTraceMetadata | null;
}): PhoneRevealUsageLogEntry {
  return {
    operationKey: PHONE_REVEAL_OPERATION_KEY,
    provider: 'apollo',
    triggeredBy: args.actorId,
    creditsUsed: null,
    costUsd: null,
    status: args.revealStatus === 'error' ? 'error' : 'success',
    errorCode: args.errorCode,
    metadata: {
      candidate_id: args.candidate.id,
      account_id: args.candidate.accountId,
      provider: 'apollo',
      reveal_status: args.revealStatus,
      reveal_phase: 'start',
      request_id: args.requestId,
      has_request_id: Boolean(args.requestId),
      credits_used: null,
      cost_usd: null,
      processing_basis: args.basis,
      error_code: args.errorCode,
      apollo_error_hint: args.errorHint,
      id_forwarded_to_apollo: args.idForwardedToApollo,
      source_provider_for_id: args.sourceProviderForId,
      apollo_trace: args.trace,
    },
  };
}
