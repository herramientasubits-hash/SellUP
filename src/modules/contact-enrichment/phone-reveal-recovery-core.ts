// Agente 2A — Apollo Phone Reveal: RECOVERY core (APOLLO-PHONE-RECOVERY-AUTOMATION-1)
//
// Official, SAFE recovery for Apollo phone-reveal requests that stayed in-flight
// (`requested` / `pending`) because the webhook never arrived or could not be
// correlated. Apollo does NOT expose webhook delivery logs; the confirmed
// fallback is to POLL the result the lost webhook would have delivered:
//
//   GET /api/v1/webhook_result/{apollo_http_request_id}   (auth: X-Api-Key)
//
// This module is PURE and dependency-injected, exactly like the START core
// (phone-reveal-core.ts) and the WEBHOOK core (phone-reveal-webhook-core.ts):
//   * NO network / NO fetch — the Apollo GET is an injected dep.
//   * NO Supabase / NO env / NO logs — the load / persist / usage-log are deps.
//   * NO automatic/scheduled job — nothing here schedules or self-runs. A future,
//     admin-gated runtime (separate PR) wires the deps and decides WHEN to run.
//
// Contract confirmed by Apollo (ASYNC-21/22/23):
//   * The recovery id is the TOP-LEVEL request_id / `x-http-request-id` (a signed
//     64-bit integer as string, e.g. `-4594297923800105423`). It is stored in the
//     safe start-trace metadata as `apollo_trace.apollo_http_request_id` and is
//     resolved here via an injected dep — NEVER hardcoded.
//   * It is NOT `phone_enrichment.request_id` (the internal job/enrichment id):
//     that value returns 404 on /webhook_result/.
//   * A recovery poll does NOT create a reveal, does NOT call /people/match, and
//     does NOT consume new credits — it only recovers an already-produced payload.
//
// Recovery is NOT gated by ENABLE_APOLLO_PHONE_REVEAL: that flag controls the
// CREATION of new reveals (phone-reveal-core.ts). Recovery only reads a result
// that a prior, already-authorized reveal produced. It stays safe by other means:
// no public endpoint, an explicit actor, capped batch size, no retry loop, and a
// strictly PII-free usage log.
//
// Safety contract (mirrors the webhook core):
//   * never logs / returns the phone, raw_number, sanitized_number, email,
//     linkedin, name, company or the raw payload.
//   * never creates an official contact, never approves a candidate.
//   * never writes HubSpot, never touches Lusha.
//   * 404 is NEVER interpreted as "no phone found"; 401/403 is a technical scope
//     problem, never a business-terminal error — the candidate stays recoverable.
//   * APOLLO-PHONE-RECOVERY-L3: a 200 body that explicitly says "still processing"
//     (status/state pending, or a `retry_after_seconds`) and carries NO phone is
//     NOT the result either — it stays non-terminal instead of being closed as
//     `no_phone_found`. See `isPendingWebhookResultPayload`.

import type { ClassifiedPhone } from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import {
  extractWebhookPersonId,
  COLLECTION_PERSISTENCE_UNAVAILABLE_ERROR_CODE,
  type ApolloPhoneRevealWebhookPayload,
} from './phone-reveal-webhook-core';
import {
  buildApolloPhoneCollectionCapture,
  type ApolloPhoneCollectionCapture,
} from './apollo-phone-collection-capture';
import {
  buildCandidatePrimaryPhoneCandidates,
  describeCandidatePhoneCollectionWrite,
  resolvePrimaryPhoneForCandidate,
  type CandidatePhoneCollectionLogFields,
  type CandidatePhoneCollectionWriteResult,
  type PersistCandidatePhoneCollection,
} from './candidate-phone-collection-writer';
import {
  runApolloPhoneRevealPoll,
  POLLABLE_STATUSES,
  type PollFetchResult,
  type PollableCandidateRecord,
} from './phone-reveal-poll-core';
import {
  buildRevealPhoneCacheWriteInput,
  PHONE_CACHE_HIT_PHONE_SOURCE,
  type PhoneCacheWriteInput,
} from './phone-cache-core';
import { PHONE_REVEAL_OPERATION_KEY, PHONE_REVEAL_PROVIDER } from './phone-reveal-core';
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
  ContactSource,
  PhoneProcessingBasis,
} from './types';

// ── Constantes ─────────────────────────────────────────────────

/** reveal_phase del usage-log de recuperación (distinto de 'start' / 'webhook'). */
export const RECOVERY_REVEAL_PHASE = 'recovery_poll' as const;

/** Base de tratamiento por defecto si la fila en vuelo no la tenía (no la degrada). */
export const DEFAULT_RECOVERY_PROCESSING_BASIS: PhoneProcessingBasis =
  'legitimate_interest_b2b';

/** Tamaño de lote por defecto del batch de recuperación (pequeño, seguro). */
export const DEFAULT_BATCH_MAX_CANDIDATES = 5;

/** Tope duro del batch: nunca se procesan más de estos por ejecución. */
export const MAX_BATCH_MAX_CANDIDATES = 10;

/** Antigüedad mínima por defecto (min) para considerar un request stale. */
export const DEFAULT_BATCH_MIN_AGE_MINUTES = 15;

// ── Proyección mínima del candidato para recovery ──────────────

/**
 * Proyección de solo lectura para decidir y persistir la recuperación. NO
 * incluye el recovery id: ese vive en el usage-log del START
 * (metadata.apollo_trace.apollo_http_request_id) y se resuelve con una dep
 * aparte (`resolveRecoveryRequestId`), nunca se hardcodea.
 */
export interface RecoveryCandidateRecord {
  id: string;
  accountId: string | null;
  /** Proveedor del reveal en vuelo. Recovery es Apollo-only: otro ⇒ inelegible. */
  phoneRevealProvider: string | null;
  /** Origen del candidato (solo diagnóstico; el gate real es phoneRevealProvider). */
  source?: ContactSource | null;
  phoneRevealStatus: string | null;
  /** Teléfono ya persistido en el candidato (si lo hay ⇒ inelegible). */
  existingPhone: string | null;
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  /** Base de tratamiento existente; se conserva (no se degrada) en la recuperación. */
  phoneProcessingBasis: PhoneProcessingBasis | string | null;
  /**
   * Apollo person id ya persistido (mig. 098) y países del candidato/run.
   * Alimentan la escritura de caché (APOLLO-PHONE-CACHE-1b) cuando el recovery
   * recupera un teléfono. Opcionales: si falta alguno el reveal simplemente NO
   * se cachea (fail-closed: sin id / sin cuenta / sin país ISO-2, no hay caché).
   */
  apolloPersonId?: string | null;
  candidateCountry?: string | null;
  runCompanyCountryCode?: string | null;
  /**
   * `source_contact_id` del candidato. Solo se usa como clave de supresión (FIX 3)
   * cuando el candidato es de origen Apollo; un id de otro proveedor (Lusha
   * `v1.*`) lo descarta el validador. Opcional: ausente ⇒ una vía menos para
   * emparejar el tombstone, nunca un bloqueo inferido.
   */
  sourceContactId?: string | null;
}

// ── Entrada de la recuperación de UN candidato ─────────────────

export interface RecoverApolloPhoneRevealInput {
  candidateId: string;
  /** Actor que dispara la recuperación (auditoría). Opaco, no PII. */
  actorUserId?: string | null;
  /**
   * Motivo libre de la recuperación. NO se persiste su texto (evita PII): solo se
   * registra su presencia (`has_reason`) en el usage-log.
   */
  reason?: string | null;
  /**
   * Modo simulación. Cuando es true la recuperación corre TODAS las validaciones
   * fail-closed y resuelve el recovery id, pero NO consulta Apollo (no llama a
   * `fetchWebhookResult`), NO persiste y NO registra usage-log: solo reporta que el
   * candidato es elegible y qué haría (`dry_run_eligible`). Default (undefined) =
   * ejecución normal. Permite que un runtime admin-gated valide sin gastar ni
   * escribir. NO existía en el hito RECOVERY-AUTOMATION-1; es aditivo y no cambia
   * el comportamiento cuando se omite.
   */
  dryRun?: boolean;
}

// ── Patch de persistencia (describe el UPDATE, no lo ejecuta) ──

/**
 * Patch de recuperación. SIEMPRE fija `phone_reveal_last_checked_at` (acabamos de
 * consultar). En el camino terminal (revealed / no_phone_found) añade los campos
 * de cierre. NUNCA fija `phone_reveal_webhook_received_at`: el teléfono NO llegó
 * por webhook (por eso hay recovery); se usa `phone_revealed_at` +
 * `phone_reveal_completed_at`. Todas las columnas existen (migraciones 095/097).
 */
export interface RecoveryPersistencePatch {
  phone?: string | null;
  enrichment_metadata?: ContactCandidateEnrichmentMetadata;
  /**
   * `error` SOLO lo emite el bloqueo por supresión (FIX 3), junto a
   * `phone_reveal_error_code = 'blocked_suppressed'`. Reutiliza el vocabulario
   * existente de la columna (mig. 095/097) en vez de añadir un estado nuevo.
   */
  phone_reveal_status?: 'revealed' | 'no_phone_found' | 'error';
  phone_reveal_completed_at?: string | null;
  phone_revealed_at?: string | null;
  phone_reveal_provider?: 'apollo';
  phone_reveal_cost_credits?: number | null;
  /**
   * Procedencia de la cifra anterior (AGENT2A-PHONE-REVEAL-4N § 6), con el mismo
   * vocabulario cerrado del camino Lusha. `reported` cuando el payload recuperado trae
   * créditos, `unknown` cuando no. NUNCA `assumed_cap`: el tope autorizado es un hecho de
   * la reserva y lo escribe la reconciliación, no la recuperación.
   */
  phone_reveal_cost_source?: 'reported' | 'unknown';
  phone_reveal_error_code?: null | typeof SUPPRESSION_BLOCKED_ERROR_CODE;
  phone_processing_basis?: PhoneProcessingBasis;
  /** Siempre presente: marca de la última verificación de recuperación. */
  phone_reveal_last_checked_at: string;
  /**
   * Apollo person id VALIDADO (24 hex) del payload recuperado
   * (APOLLO-PHONE-CACHE-1a): de `people[0].id` o `person.id`. null si
   * ausente/inválido/otro proveedor. El wrapper sólo escribe la columna cuando es
   * truthy (no la fuerza ni sobrescribe con null). Id opaco de correlación, NO
   * PII. No cachea ni sirve teléfono.
   */
  apollo_person_id?: string | null;
}

// ── Usage-log de recuperación (SIN PII) ────────────────────────

/** reveal_status derivado del outcome (vocabulario propio del recovery_poll). */
export type RecoveryLogRevealStatus =
  | 'revealed'
  | 'no_phone_found'
  | 'pending'
  | 'not_found'
  | 'unauthorized'
  | 'error'
  // FIX 3: el poll trajo teléfono pero un tombstone impidió persistirlo.
  | typeof SUPPRESSION_BLOCKED_ERROR_CODE
  // FIX 3: la supresión no se pudo verificar; nada terminal se persistió.
  | typeof SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE
  // 4O-C: los teléfonos llegaron pero la colección no se pudo escribir.
  | typeof COLLECTION_PERSISTENCE_UNAVAILABLE_ERROR_CODE;

export interface RecoveryUsageLogEntry {
  operationKey: typeof PHONE_REVEAL_OPERATION_KEY;
  provider: 'apollo';
  /** Actor que disparó la recuperación (id opaco). null si no se pasó. */
  triggeredBy: string | null;
  /** Créditos si Apollo los reporta numéricos en el payload recuperado; null si no. */
  creditsUsed: number | null;
  status: 'success' | 'error';
  errorCode: string | null;
  metadata: {
    candidate_id: string;
    account_id: string | null;
    provider: 'apollo';
    reveal_phase: typeof RECOVERY_REVEAL_PHASE;
    reveal_status: RecoveryLogRevealStatus;
    /** Outcome mecánico de la recuperación (diagnóstico, sin PII). */
    recovery_outcome: RecoveryOutcome;
    /**
     * recovery id = apollo_http_request_id (top-level request_id /
     * x-http-request-id). Id opaco de correlación, NO PII. NUNCA es
     * phone_enrichment.request_id.
     */
    request_id: string | null;
    apollo_http_request_id: string | null;
    phone_present: boolean;
    phone_type: string | null;
    credits_used: number | null;
    /** true si el actor pasó un motivo (el texto NO se guarda). */
    has_reason: boolean;
    /**
     * Resultado PII-free de la comprobación de supresión (FIX 3). Presente solo
     * cuando el poll trajo un teléfono que persistir — el único camino que la
     * ejecuta. Ausente en pending / 404 / 401 / no_phone_found.
     */
    suppression_state?: InFlightSuppressionAuditState;
    /**
     * `phone_reveal_waterfall_runs.id` cuando este poll cierra la PRIMERA pata de
     * un waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1). Id de fila PROPIO
     * de SellUp: correlaciona esta pata con la de Lusha bajo UNA autorización sin
     * mezclar créditos (cada pata conserva su fila y su `credits_used`). NO es un
     * id de proveedor y NO es PII. Clave OMITIDA cuando no hay waterfall.
     */
    phone_reveal_waterfall_id?: string;
    /**
     * Cifras de la colección de teléfonos (AGENT2A-PHONE-REVEAL-4O-C). Forma
     * CERRADA y sin PII: conteos y banderas, jamás un número, un display ni una
     * `dedupe_key`. Clave OMITIDA cuando la dep del writer no está cableada.
     */
    phone_collection?: CandidatePhoneCollectionLogFields;
  };
}

// ── Hook de continuación del waterfall (AGENT2A-PHONE-WATERFALL-1) ──

/**
 * Desenlaces Apollo que el recovery puede comunicar al waterfall. Declarado
 * estructuralmente (sin importar phone-reveal-waterfall-core) para que este core
 * no dependa de la capa del waterfall ni exista riesgo de ciclo de imports.
 */
export type RecoveryWaterfallApolloOutcome =
  | 'revealed'
  | 'no_phone_found'
  | 'blocked_suppressed'
  | 'suppression_check_unavailable';

export interface RecoveryWaterfallContinuationArgs {
  candidateId: string;
  apolloOutcome: RecoveryWaterfallApolloOutcome;
  /** Créditos que Apollo reportó. null si no los reportó (nunca 0 por defecto). */
  apolloCostCredits: number | null;
}

// ── Deps inyectadas (todo el I/O real vive fuera del core) ─────

export interface RecoverApolloPhoneRevealDeps {
  /** Timestamp ISO estable (inyectado para tests deterministas). */
  nowIso: string;
  /** Carga la proyección del candidato. null si no existe. */
  loadCandidate: (candidateId: string) => Promise<RecoveryCandidateRecord | null>;
  /**
   * Resuelve el recovery id (apollo_http_request_id) del START log del candidato
   * en provider_usage_logs (metadata.apollo_trace.apollo_http_request_id). null si
   * no hay traza usable. NUNCA devuelve phone_enrichment.request_id.
   */
  resolveRecoveryRequestId: (candidateId: string) => Promise<string | null>;
  /**
   * Ejecuta GET /api/v1/webhook_result/{recoveryRequestId} (X-Api-Key, sin body,
   * sin retry) y clasifica el status. En este hito NADIE la cablea en producción
   * (no hay job). En tests se inyecta un stub. NUNCA imprime ni persiste el raw.
   */
  fetchWebhookResult: (recoveryRequestId: string) => Promise<PollFetchResult>;
  /** Aplica el UPDATE sobre el candidato (service role). */
  persist: (candidateId: string, patch: RecoveryPersistencePatch) => Promise<void>;
  /** Registra el uso en provider_usage_logs (metadata sin PII). */
  logUsage: (entry: RecoveryUsageLogEntry) => Promise<void>;
  /**
   * Cachea el teléfono recuperado (APOLLO-PHONE-CACHE-1b). OPCIONAL y
   * BEST-EFFORT, exactamente igual que en el webhook: se invoca solo en el
   * camino `revealed`, solo después de persistir, y su resultado se ignora. Sin
   * esta dep — o con ENABLE_APOLLO_PHONE_CACHE apagado — el recovery se comporta
   * igual que antes de este hito.
   */
  cacheRevealedPhone?: (input: PhoneCacheWriteInput) => Promise<unknown>;

  /**
   * Persiste TODOS los teléfonos del payload recuperado en la colección canónica
   * (AGENT2A-PHONE-REVEAL-4O-C). Mismo contrato EXACTO que en el webhook: la
   * misma dep, el mismo writer y la misma idempotencia, para que un candidato
   * cerrado por recuperación quede con la misma colección que si lo hubiera
   * cerrado el callback.
   *
   * OPCIONAL: sin ella el recovery se comporta como antes del hito. NO es
   * best-effort: se invoca ANTES de persistir el candidato y si LANZA nada
   * terminal se escribe — el candidato sigue recuperable y el mismo payload se
   * puede repolear sin gastar créditos.
   */
  persistCandidatePhoneCollection?: PersistCandidatePhoneCollection;

  // ── Cumplimiento de SUPRESIÓN en vuelo (FIX 3) ────────────────
  // Igual que en el webhook: NO depende de `ENABLE_APOLLO_PHONE_CACHE`. Un flag de
  // reutilización no puede desactivar el cumplimiento de una supresión.

  /**
   * Lee el tombstone de (apollo, persona, MISMA cuenta). Se invoca SIEMPRE que el
   * poll recupere un teléfono, con el flag de caché encendido o apagado, y ANTES
   * de persistirlo. Debe LANZAR si la lectura falla: el core lo traduce a
   * `suppression_check_unavailable`, no persiste teléfono y deja el candidato
   * recuperable. Dep ausente ⇒ mismo resultado (fail-closed).
   */
  lookupPhoneCacheSuppression?: InFlightSuppressionLookup;
  /**
   * Notifica que la supresión no se pudo verificar. Mensaje mecánico YA redactado:
   * nunca teléfono, person id, email, nombre ni linkedin.
   */
  onSuppressionCheckUnavailable?: (message: string) => void;
  /**
   * Notifica que la supresión no se pudo EVALUAR (FIX 4): sin Apollo person id
   * resoluble o sin cuenta no existe clave con la que emparejar un tombstone. El
   * teléfono recuperado se persiste igual — no se bloquea por inferencia — pero el
   * caso queda registrado con un evento de forma CERRADA y sin PII.
   */
  onSuppressionNotEvaluable?: PhoneSuppressionNotEvaluableSink;

  // ── Waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1) ─────
  // Las DOS deps son OPCIONALES y solo se cablean con
  // ENABLE_PHONE_REVEAL_WATERFALL encendido. Sin ellas el recovery se comporta
  // exactamente como antes de este hito.

  /**
   * Resuelve el id de la corrida activa del waterfall del candidato, SOLO para
   * incluirlo en la metadata del usage-log. Best-effort: cualquier excepción se
   * traga y se sigue sin la clave.
   */
  resolveWaterfallRunId?: (candidateId: string) => Promise<string | null>;
  /**
   * Continúa el waterfall tras terminalizar Apollo. Se invoca DESPUÉS de persistir
   * y loguear el desenlace, y es el único camino por el que la pata Lusha puede
   * ejecutarse desde el recovery (cron L2 o revisión manual L3).
   *
   * BEST-EFFORT: resultado ignorado y excepciones tragadas. Un fallo de la pata
   * Lusha no puede convertir una recuperación correcta en un error, ni provocar
   * reintentos contra Apollo. La idempotencia entre webhook / cron / L3 la
   * garantiza el claim atómico del core del waterfall, no este caller.
   */
  continueWaterfall?: (args: RecoveryWaterfallContinuationArgs) => Promise<unknown>;
}

// ── Resultado (sin PII) ────────────────────────────────────────

export type RecoveryOutcome =
  // Inelegibles (no se consulta Apollo):
  | 'invalid_candidate'
  | 'candidate_not_found'
  | 'not_apollo_provider'
  | 'already_revealed'
  | 'already_no_phone_found'
  | 'terminal_error_skipped'
  | 'already_has_phone'
  | 'not_in_flight'
  | 'missing_recovery_request_id'
  // Simulación (dryRun): elegible, recovery id resuelto, SIN poll/persist/log:
  | 'dry_run_eligible'
  // Terminales tras el poll:
  | 'revealed'
  | 'no_phone_found'
  // FIX 3 — el poll trajo teléfono pero existe tombstone: NO se persiste, NO se
  // cachea, 0 créditos nuevos. Terminal (`error` + `blocked_suppressed`) para que
  // el propio recovery no lo vuelva a intentar.
  | 'blocked_suppressed'
  // No terminales (candidato sigue recuperable):
  // FIX 3 — la supresión no se pudo verificar: sin teléfono, sin caché, el
  // candidato sigue en vuelo y se puede repolear (0 créditos) más tarde.
  | 'suppression_check_unavailable'
  // 4O-C — el poll trajo teléfonos pero la colección canónica no se pudo
  // escribir. NO terminal y fail-closed: no se escribe el escalar, así que nunca
  // queda un teléfono visible sin su colección, y el mismo payload se puede
  // repolear gratis cuando la escritura vuelva a estar disponible.
  | 'collection_persistence_unavailable'
  | 'still_pending'
  | 'not_found_or_pending_ambiguous'
  | 'possible_missing_webhook_result_read_scope'
  | 'provider_error_transient';

export interface RecoverApolloPhoneRevealResult {
  outcome: RecoveryOutcome;
  /** true solo cuando el poll entregó un teléfono y se persistió revealed. */
  phoneRevealed: boolean;
  /** Créditos numéricos del payload recuperado; null si Apollo no los reporta. */
  creditsUsed: number | null;
  /** true si se resolvió un recovery id (apollo_http_request_id). Sin PII. */
  recoveryRequestIdPresent: boolean;
  /**
   * `retry_after_seconds` que Apollo sugirió cuando el resultado todavía se está
   * procesando (APOLLO-PHONE-RECOVERY-L3). null salvo en `still_pending` y solo si
   * el payload lo trae numérico y plausible. Es un número de segundos, NO PII.
   *
   * OPCIONAL a propósito: es aditivo, así que los stubs y fixtures previos a este
   * hito siguen satisfaciendo el tipo. `toResult` siempre lo rellena.
   */
  retryAfterSeconds?: number | null;
  /**
   * Categoría del teléfono recuperado (mobile / direct_dial / work / other …) o
   * null. NO es PII: es una etiqueta de tipo, nunca el número. Solo se rellena en
   * el camino `revealed`; null en cualquier otro outcome.
   */
  phoneType: string | null;
}

// ── Helpers puros ──────────────────────────────────────────────

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function existingPhoneSource(
  metadata: ContactCandidateEnrichmentMetadata,
): string | null {
  const phone = metadata.phone as ContactCandidatePhoneMetadata | null | undefined;
  const source = phone?.source;
  return typeof source === 'string' ? source : null;
}

function normalizeBasis(
  value: PhoneProcessingBasis | string | null,
): PhoneProcessingBasis {
  return cleanText(value) ? (value as PhoneProcessingBasis) : DEFAULT_RECOVERY_PROCESSING_BASIS;
}

/**
 * Procedencia de la cifra de créditos que la recuperación puede afirmar
 * (AGENT2A-PHONE-REVEAL-4N § 6). Misma regla que el webhook: `reported` solo si el payload
 * recuperado trae un número; nunca `assumed_cap`, que es un hecho de la reserva.
 */
function resolveRecoveryCostSource(credits: number | null): 'reported' | 'unknown' {
  return typeof credits === 'number' && Number.isFinite(credits) ? 'reported' : 'unknown';
}

function toResult(
  outcome: RecoveryOutcome,
  extra: Partial<Omit<RecoverApolloPhoneRevealResult, 'outcome'>> = {},
): RecoverApolloPhoneRevealResult {
  return {
    outcome,
    phoneRevealed: extra.phoneRevealed ?? false,
    creditsUsed: extra.creditsUsed ?? null,
    recoveryRequestIdPresent: extra.recoveryRequestIdPresent ?? false,
    phoneType: extra.phoneType ?? null,
    retryAfterSeconds: extra.retryAfterSeconds ?? null,
  };
}

/**
 * Resuelve el id de la corrida del waterfall sin poder romper el recovery
 * (AGENT2A-PHONE-WATERFALL-1). Solo alimenta una clave de metadata: cualquier
 * fallo se traga y devuelve null. Con la dep sin cablear (flag apagado) no hay I/O.
 */
async function resolveWaterfallRunIdBestEffort(
  deps: RecoverApolloPhoneRevealDeps,
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
 * Continúa el waterfall sin poder romper el recovery. El desenlace Apollo ya está
 * persistido y logueado cuando esto corre, así que un fallo aquí solo significa
 * "la 2ª pata no se intentó en esta pasada".
 */
async function continueWaterfallBestEffort(
  deps: RecoverApolloPhoneRevealDeps,
  args: RecoveryWaterfallContinuationArgs,
): Promise<void> {
  if (!deps.continueWaterfall) return;
  try {
    await deps.continueWaterfall(args);
  } catch {
    // Silencio deliberado y acotado: el wrapper del waterfall ya registra el
    // fallo sin PII, y una recuperación correcta no puede degradarse por esto.
  }
}

// ── Payload "todavía procesando" (APOLLO-PHONE-RECOVERY-L3) ────

/** Estados que Apollo usa para decir "el resultado aún no está listo". */
const PENDING_PAYLOAD_STATUSES: readonly string[] = [
  'pending',
  'processing',
  'in_progress',
  'queued',
];

/** Tope de `retry_after_seconds` aceptado (1 h). Fuera de rango ⇒ se ignora. */
const MAX_RETRY_AFTER_SECONDS = 3600;

function normalizeStatusText(value: unknown): string | null {
  return typeof value === 'string' ? cleanText(value.toLowerCase()) : null;
}

/**
 * Extrae `retry_after_seconds` del payload recuperado (raíz o `phone_enrichment`).
 * Solo acepta enteros positivos y plausibles (≤ 1 h); cualquier otra cosa ⇒ null.
 * Es un número de segundos: NO es PII y nunca se persiste, solo se devuelve a la UI.
 */
export function extractRetryAfterSeconds(
  payload: ApolloPhoneRevealWebhookPayload | null,
): number | null {
  const candidates = [payload?.retry_after_seconds, payload?.phone_enrichment?.retry_after_seconds];
  for (const raw of candidates) {
    const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const seconds = Math.floor(value);
    if (seconds >= 1 && seconds <= MAX_RETRY_AFTER_SECONDS) return seconds;
  }
  return null;
}

/**
 * ¿El payload recuperado dice explícitamente "todavía procesando"? Apollo confirmó
 * que `GET /webhook_result/{id}` puede responder 200 con un estado pendiente y un
 * `retry_after_seconds` en vez del resultado. Sin este guard ese cuerpo se leería
 * como "resultado entregado sin teléfonos" y se terminalizaría como
 * `no_phone_found`, cerrando en falso un reveal que sí podía resolverse.
 *
 * Deliberadamente ESTRECHO (solo cambia el caso que hoy se decide mal):
 *   * exige una señal explícita — `status`/`state`/`phone_enrichment.status`
 *     pendiente, o un `retry_after_seconds` válido;
 *   * el caller solo lo consulta cuando el payload NO trajo ningún teléfono, así
 *     que un resultado con número sigue siendo terminal `revealed` sin cambios.
 */
export function isPendingWebhookResultPayload(
  payload: ApolloPhoneRevealWebhookPayload | null,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const statuses = [
    normalizeStatusText(payload.status),
    normalizeStatusText(payload.state),
    normalizeStatusText(payload.phone_enrichment?.status),
  ];
  if (statuses.some((s) => s !== null && PENDING_PAYLOAD_STATUSES.includes(s))) {
    return true;
  }
  return extractRetryAfterSeconds(payload) !== null;
}

// ── Recuperación de UN candidato ───────────────────────────────

/**
 * Recupera de forma SEGURA el resultado de un reveal Apollo en vuelo. Corre todas
 * las validaciones fail-closed ANTES de consultar Apollo (barato→caro), resuelve
 * el recovery id correcto (apollo_http_request_id), hace UN poll (sin retry, sin
 * loop) y mapea la disposición a persistencia + usage-log sin PII. Un 404 NUNCA
 * es no_phone_found; un 401 NUNCA es terminal de negocio.
 */
export async function recoverApolloPhoneRevealForCandidate(
  input: RecoverApolloPhoneRevealInput,
  deps: RecoverApolloPhoneRevealDeps,
): Promise<RecoverApolloPhoneRevealResult> {
  const candidateId = cleanText(input.candidateId);
  if (!candidateId) return toResult('invalid_candidate');

  const candidate = await deps.loadCandidate(candidateId);
  if (!candidate) return toResult('candidate_not_found');

  // Recovery es Apollo-only.
  if (cleanText(candidate.phoneRevealProvider) !== PHONE_REVEAL_PROVIDER) {
    return toResult('not_apollo_provider');
  }

  // No terminal / no re-procesar.
  const status = cleanText(candidate.phoneRevealStatus);
  if (status === 'revealed') return toResult('already_revealed');
  if (status === 'no_phone_found') return toResult('already_no_phone_found');
  if (status === 'error') return toResult('terminal_error_skipped');

  // No debe tener ya un teléfono persistido (por columna o por metadata reveal).
  // `apollo_cache` cuenta igual que `apollo_reveal`: un número servido desde la
  // caché ya es el resultado final (APOLLO-PHONE-CACHE-1b).
  const currentPhoneSource = existingPhoneSource(candidate.enrichmentMetadata);
  if (
    cleanText(candidate.existingPhone) ||
    currentPhoneSource === 'apollo_reveal' ||
    currentPhoneSource === PHONE_CACHE_HIT_PHONE_SOURCE
  ) {
    return toResult('already_has_phone');
  }

  // Solo estados en vuelo (requested / pending).
  if (!status || !POLLABLE_STATUSES.includes(status)) {
    return toResult('not_in_flight');
  }

  // Recovery id correcto: apollo_http_request_id del START log. NUNCA el
  // phone_enrichment.request_id (ese devuelve 404 en /webhook_result/).
  const recoveryRequestId = cleanText(await deps.resolveRecoveryRequestId(candidateId));
  if (!recoveryRequestId) return toResult('missing_recovery_request_id');

  // Simulación: el candidato es elegible y el recovery id está resuelto, pero NO
  // se consulta Apollo, NO se persiste y NO se registra usage-log. Corta aquí
  // (después de todas las validaciones fail-closed) para que un runtime pueda
  // validar sin gastar créditos ni escribir. NO usa `fetchWebhookResult`.
  if (input.dryRun === true) {
    return toResult('dry_run_eligible', { recoveryRequestIdPresent: true });
  }

  // UN poll GET /webhook_result/{apollo_http_request_id}. Sin retry, sin loop.
  const pollable: PollableCandidateRecord = {
    id: candidate.id,
    phoneRevealStatus: status,
    apolloHttpRequestId: recoveryRequestId,
  };
  const poll = await runApolloPhoneRevealPoll(pollable, {
    fetchWebhookResult: deps.fetchWebhookResult,
  });

  switch (poll.outcome) {
    case 'result_available':
      return handleRecoveredPayload({
        candidate,
        recoveryRequestId,
        payload: poll.payload,
        input,
        deps,
      });
    case 'no_result_yet':
      return finalizeNonTerminal({
        candidate,
        recoveryRequestId,
        outcome: 'still_pending',
        revealStatus: 'pending',
        logStatus: 'success',
        errorCode: null,
        input,
        deps,
      });
    case 'not_found':
      return finalizeNonTerminal({
        candidate,
        recoveryRequestId,
        outcome: 'not_found_or_pending_ambiguous',
        revealStatus: 'not_found',
        logStatus: 'success',
        errorCode: null,
        input,
        deps,
      });
    case 'possible_missing_webhook_result_read_scope':
      return finalizeNonTerminal({
        candidate,
        recoveryRequestId,
        outcome: 'possible_missing_webhook_result_read_scope',
        revealStatus: 'unauthorized',
        logStatus: 'error',
        errorCode: 'possible_missing_webhook_result_read_scope',
        input,
        deps,
      });
    case 'error':
    default:
      return finalizeNonTerminal({
        candidate,
        recoveryRequestId,
        outcome: 'provider_error_transient',
        revealStatus: 'error',
        logStatus: 'error',
        errorCode: 'apollo_webhook_result_error',
        input,
        deps,
      });
  }
}

// ── Camino terminal: se recuperó un payload (mismo shape que el webhook) ──

async function handleRecoveredPayload(args: {
  candidate: RecoveryCandidateRecord;
  recoveryRequestId: string;
  payload: ApolloPhoneRevealWebhookPayload | null;
  input: RecoverApolloPhoneRevealInput;
  deps: RecoverApolloPhoneRevealDeps;
}): Promise<RecoverApolloPhoneRevealResult> {
  const { candidate, recoveryRequestId, payload, input, deps } = args;
  // Corrida del waterfall (AGENT2A-PHONE-WATERFALL-1): se resuelve UNA vez, solo
  // en el camino en el que Apollo entregó un resultado, para no añadir una lectura
  // a cada poll pendiente del cron. Con el flag apagado la dep no está cableada.
  const waterfallRunId = await resolveWaterfallRunIdBestEffort(deps, candidate.id);
  // Captura COMPLETA (AGENT2A-PHONE-REVEAL-4O-C), con el MISMO módulo que el
  // webhook: mismo normalizador, mismo ranking, misma contabilidad. Que ambos
  // caminos compartan esta llamada es lo que garantiza que un candidato cerrado
  // por recuperación no acabe con una colección distinta de la que tendría si el
  // callback hubiera llegado.
  const capture: ApolloPhoneCollectionCapture = buildApolloPhoneCollectionCapture({
    payload,
    context: {
      phase: RECOVERY_REVEAL_PHASE,
      waterfallRunId,
      reservationId: null,
      providerUsageLogId: null,
      observedAt: deps.nowIso,
    },
  });
  const credits = capture.credits;
  const best = capture.legacyBest;
  // Apollo person id (APOLLO-PHONE-CACHE-1a): se captura si el payload recuperado
  // lo trae válido; el wrapper sólo escribe la columna cuando es truthy. No caché.
  const apolloPersonId = extractWebhookPersonId(payload);

  if (best) {
    // FIX 3 — SUPRESIÓN EN VUELO. El recovery recupera un payload producido hace
    // tiempo: una DSAR pudo registrarse entre el START y este poll. Se comprueba el
    // tombstone antes de persistir, con el flag de caché encendido o apagado. Solo
    // corre en este camino: sin teléfono recuperado no hay número que suprimir, así
    // que `no_phone_found` y los no terminales quedan idénticos (0 lecturas).
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
    // teléfono recuperado se persiste igual — pero el caso se registra en vez de
    // quedar invisible. Es un efecto de auditoría: no bloquea ni desbloquea nada.
    if (suppression.kind === 'not_evaluable') {
      reportPhoneSuppressionNotEvaluable({
        phase: 'recovery',
        reason: suppression.reason,
        candidateId: candidate.id,
        accountId: candidate.accountId,
        sink: deps.onSuppressionNotEvaluable,
      });
    }

    // No verificable ⇒ fail-closed por el camino NO terminal que ya existe: solo
    // se marca `phone_reveal_last_checked_at`, el status sigue en vuelo y el mismo
    // resultado se puede repolear sin gastar créditos.
    if (suppression.kind === 'check_unavailable') {
      deps.onSuppressionCheckUnavailable?.(suppression.message);
      const nonTerminal = await finalizeNonTerminal({
        candidate,
        recoveryRequestId,
        outcome: 'suppression_check_unavailable',
        revealStatus: SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
        logStatus: 'error',
        errorCode: SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
        suppressionState,
        waterfallRunId,
        input,
        deps,
      });
      // Waterfall: la supresión no se pudo verificar ⇒ la 2ª pata NO se gasta. El
      // candidato sigue recuperable (nada terminal se persistió), pero la corrida
      // se cierra fail-closed: no se lee "no verificable" como "sin tombstone".
      await continueWaterfallBestEffort(deps, {
        candidateId: candidate.id,
        apolloOutcome: SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
        apolloCostCredits: credits,
      });
      return nonTerminal;
    }

    // Tombstone ⇒ el teléfono recuperado se descarta. NO se escribe `phone`, NO se
    // toca `enrichment_metadata.phone`, NO se propaga `apollo_person_id` (no se
    // añade dato nuevo de una persona suprimida) y NO se escribe caché.
    if (suppression.kind === 'blocked_suppressed') {
      await deps.persist(candidate.id, {
        phone_reveal_status: 'error',
        phone_reveal_completed_at: deps.nowIso,
        phone_reveal_last_checked_at: deps.nowIso,
        phone_reveal_provider: PHONE_REVEAL_PROVIDER,
        phone_reveal_cost_credits: credits,
        phone_reveal_cost_source: resolveRecoveryCostSource(credits),
        phone_reveal_error_code: SUPPRESSION_BLOCKED_ERROR_CODE,
      });
      await deps.logUsage(
        buildRecoveryLog({
          candidate,
          recoveryRequestId,
          revealStatus: SUPPRESSION_BLOCKED_ERROR_CODE,
          outcome: 'blocked_suppressed',
          logStatus: 'success',
          errorCode: SUPPRESSION_BLOCKED_ERROR_CODE,
          phonePresent: false,
          phoneType: null,
          credits,
          suppressionState,
          waterfallRunId,
          input,
        }),
      );
      // Waterfall: tombstone confirmado ⇒ corrida abortada, pata Lusha nunca
      // intentada. Una supresión registrada bloquea a todos los proveedores.
      await continueWaterfallBestEffort(deps, {
        candidateId: candidate.id,
        apolloOutcome: SUPPRESSION_BLOCKED_ERROR_CODE,
        apolloCostCredits: credits,
      });
      return toResult('blocked_suppressed', {
        creditsUsed: credits,
        recoveryRequestIdPresent: true,
      });
    }

    // ── 4O-C-R1 — COLECCIÓN Y ESTADO TERMINAL, EN UNA TRANSACCIÓN ──
    // Exactamente la misma transacción que el webhook (migración 110), con la
    // misma dep: un candidato cerrado por recuperación tiene que acabar con la
    // misma colección y el mismo estado terminal que si el callback hubiera
    // llegado. Sin la dep cableada este bloque no hace nada y el camino queda como
    // antes del hito.
    let collection: CandidatePhoneCollectionWriteResult | null = null;
    if (deps.persistCandidatePhoneCollection && capture.phones.length > 0) {
      try {
        collection = await deps.persistCandidatePhoneCollection({
          candidateId: candidate.id,
          phones: capture.phones,
          primaryCandidates: buildCandidatePrimaryPhoneCandidates({
            phones: capture.phones,
            primaryPreference: capture.primaryPreference,
            legacy: best,
          }),
          observedAt: deps.nowIso,
          terminal: {
            phase: RECOVERY_REVEAL_PHASE,
            // null a propósito: el id de recuperación vive en la metadata del
            // usage-log (`apollo_trace.apollo_http_request_id`), NO en una columna
            // del candidato, así que no hay nada contra lo que compararlo. La
            // guarda de evento es entonces el estado en vuelo comprobado bajo el
            // bloqueo — la misma condición que este poll ya exigió antes de gastar
            // la llamada, solo que ahora no se puede colar una carrera en medio.
            expectedRequestId: null,
            legacyPhone: best.number,
            legacyPhoneType: best.type,
            legacyRawType: best.raw_type,
            revealedAt: deps.nowIso,
            completedAt: deps.nowIso,
            // La recuperación no recibió callback: no sella `webhook_received_at`.
            webhookReceivedAt: null,
            lastCheckedAt: deps.nowIso,
            costCredits: credits,
            costSource: resolveRecoveryCostSource(credits),
            // Conserva la base existente; solo la fija si la fila no la tenía.
            processingBasis: normalizeBasis(candidate.phoneProcessingBasis),
            apolloPersonId: apolloPersonId,
          },
        });
      } catch {
        // Silencio deliberado: el writer ya propagó el error de la base, que
        // describe la operación y no el dato. `collection` sigue null ⇒ fail-closed.
      }
      // Fail-closed también cuando la RPC respondió SIN terminalizar (`suppressed`,
      // `stale_event`, `candidate_not_eligible`): esas respuestas escriben 0 filas,
      // y darlas por buenas dejaría un `revealed` que nadie escribió.
      //
      // Sale por el camino NO terminal que ya existe: solo se sella
      // `phone_reveal_last_checked_at`, el candidato sigue en vuelo y el mismo
      // resultado se puede repolear sin gastar créditos. El waterfall NO se
      // continúa: este reveal no ha concluido, únicamente no se ha podido guardar,
      // y llamar a Lusha pagaría por un teléfono que Apollo YA dio.
      if (!collection?.candidate_terminalized) {
        return finalizeNonTerminal({
          candidate,
          recoveryRequestId,
          outcome: 'collection_persistence_unavailable',
          revealStatus: COLLECTION_PERSISTENCE_UNAVAILABLE_ERROR_CODE,
          logStatus: 'error',
          errorCode: COLLECTION_PERSISTENCE_UNAVAILABLE_ERROR_CODE,
          suppressionState,
          collectionFields: describeCandidatePhoneCollectionWrite({
            result: collection,
            duplicatePhoneCount: capture.counters.duplicate_phone_count,
            canonicalPhoneCount: capture.counters.canonical_phone_count,
            sourceCount: capture.counters.source_count,
          }),
          waterfallRunId,
          input,
          deps,
        });
      }
    }

    // El escalar sale del principal REALMENTE marcado por la base, nunca de la
    // preferencia enviada, para que colección y escalar no puedan discrepar.
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
    const collectionFields = deps.persistCandidatePhoneCollection
      ? describeCandidatePhoneCollectionWrite({
          result: collection,
          duplicatePhoneCount: capture.counters.duplicate_phone_count,
          canonicalPhoneCount: capture.counters.canonical_phone_count,
          sourceCount: capture.counters.source_count,
        })
      : undefined;
    const phoneMetadata: ContactCandidatePhoneMetadata = {
      number: revealed.number,
      type: revealed.type,
      source: 'apollo_reveal',
      raw_type: revealed.raw_type,
    };
    // 4O-C-R1: igual que en el webhook, el candidato solo se escribe AQUÍ cuando la
    // transacción no lo hizo — es decir, cuando la dep de la colección no está
    // cableada. En Producción sí lo está. NO es un fallback: si la RPC falló o no
    // terminalizó, el bloque de arriba ya salió por el camino no terminal y aquí no
    // se llega.
    if (!collection?.candidate_terminalized) {
      const patch: RecoveryPersistencePatch = {
        phone: revealed.number,
        enrichment_metadata: {
          ...candidate.enrichmentMetadata,
          phone: phoneMetadata,
        },
        phone_reveal_status: 'revealed',
        phone_reveal_completed_at: deps.nowIso,
        phone_revealed_at: deps.nowIso,
        phone_reveal_last_checked_at: deps.nowIso,
        phone_reveal_provider: PHONE_REVEAL_PROVIDER,
        phone_reveal_cost_credits: credits,
        phone_reveal_cost_source: resolveRecoveryCostSource(credits),
        phone_reveal_error_code: null,
        // Conserva la base existente; solo la fija si la fila en vuelo no la tenía.
        phone_processing_basis: normalizeBasis(candidate.phoneProcessingBasis),
        apollo_person_id: apolloPersonId,
      };
      await deps.persist(candidate.id, patch);
    }
    // Caché (APOLLO-PHONE-CACHE-1b): igual que en el webhook — solo tras
    // persistir, solo con teléfono, best-effort y con la MISMA política.
    if (deps.cacheRevealedPhone) {
      try {
        await deps.cacheRevealedPhone(
          buildRevealPhoneCacheWriteInput({
            personId: apolloPersonId ?? candidate.apolloPersonId ?? null,
            accountId: candidate.accountId,
            candidateCountry: candidate.candidateCountry ?? null,
            runCompanyCountryCode: candidate.runCompanyCountryCode ?? null,
            phone: revealed.number,
            phoneType: revealed.type,
            revealedAtIso: deps.nowIso,
            candidateId: candidate.id,
          }),
        );
      } catch {
        // Silencio deliberado y acotado: la caché nunca puede tumbar una
        // recuperación correcta. El store ya registró el error sin PII.
      }
    }
    await deps.logUsage(
      buildRecoveryLog({
        candidate,
        recoveryRequestId,
        revealStatus: 'revealed',
        outcome: 'revealed',
        logStatus: 'success',
        errorCode: null,
        phonePresent: true,
        phoneType: revealed.type,
        credits,
        // FIX 3: constancia de que la comprobación se hizo también cuando el
        // teléfono sí se persiste.
        suppressionState,
        // 4O-C: conteos de la colección. Ausente sin la dep cableada.
        collectionFields,
        waterfallRunId,
        input,
      }),
    );
    // Waterfall: Apollo entregó el teléfono (por recuperación) ⇒ la corrida cierra
    // con final_provider = apollo y la pata Lusha NUNCA se intenta.
    await continueWaterfallBestEffort(deps, {
      candidateId: candidate.id,
      apolloOutcome: 'revealed',
      apolloCostCredits: credits,
    });
    return toResult('revealed', {
      phoneRevealed: true,
      creditsUsed: credits,
      recoveryRequestIdPresent: true,
      // Etiqueta de tipo (no el número): mobile / direct_dial / work / other …
      phoneType: revealed.type,
    });
  }

  // Payload SIN teléfono que dice explícitamente "todavía procesando"
  // (APOLLO-PHONE-RECOVERY-L3): NO es el resultado, así que no se terminaliza. Se
  // sella solo `phone_reveal_last_checked_at` y el candidato sigue recuperable, con
  // el `retry_after_seconds` que Apollo sugirió (si lo trajo) para la UI.
  if (isPendingWebhookResultPayload(payload)) {
    // NO se continúa el waterfall: "aún procesando" no es un desenlace terminal de
    // Apollo, así que la corrida sigue en vuelo y la 2ª pata no se evalúa todavía.
    return finalizeNonTerminal({
      candidate,
      recoveryRequestId,
      outcome: 'still_pending',
      revealStatus: 'pending',
      logStatus: 'success',
      errorCode: null,
      retryAfterSeconds: extractRetryAfterSeconds(payload),
      waterfallRunId,
      input,
      deps,
    });
  }

  // Payload entregado SIN teléfono ni señal de pendiente: es el resultado real (no
  // un 404 ambiguo) ⇒ no_phone_found terminal, con evidencia clara.
  const patch: RecoveryPersistencePatch = {
    phone_reveal_status: 'no_phone_found',
    phone_reveal_completed_at: deps.nowIso,
    phone_reveal_last_checked_at: deps.nowIso,
    phone_reveal_provider: PHONE_REVEAL_PROVIDER,
    phone_reveal_cost_credits: credits,
    phone_reveal_cost_source: resolveRecoveryCostSource(credits),
    phone_reveal_error_code: null,
    // null si el payload no trae person id (no se fuerza); el wrapper no escribe.
    apollo_person_id: apolloPersonId,
  };
  await deps.persist(candidate.id, patch);
  await deps.logUsage(
    buildRecoveryLog({
      candidate,
      recoveryRequestId,
      revealStatus: 'no_phone_found',
      outcome: 'no_phone_found',
      logStatus: 'success',
      errorCode: null,
      phonePresent: false,
      phoneType: null,
      credits,
      waterfallRunId,
      input,
    }),
  );
  // Waterfall: ÚNICO desenlace que puede abrir la 2ª pata. El `no_phone_found` de
  // Apollo ya quedó persistido arriba (no se altera) y la continuación decide —
  // con claim atómico, TTL y re-chequeo de supresión/DNC — si Lusha corre. El claim
  // es lo que garantiza UNA sola llamada aunque el webhook, este cron y la revisión
  // manual L3 vean el mismo resultado.
  await continueWaterfallBestEffort(deps, {
    candidateId: candidate.id,
    apolloOutcome: 'no_phone_found',
    apolloCostCredits: credits,
  });
  return toResult('no_phone_found', {
    creditsUsed: credits,
    recoveryRequestIdPresent: true,
  });
}

// ── Camino no terminal: pending / 404 / 401 / 5xx ──────────────

async function finalizeNonTerminal(args: {
  candidate: RecoveryCandidateRecord;
  recoveryRequestId: string;
  outcome: RecoveryOutcome;
  revealStatus: RecoveryLogRevealStatus;
  logStatus: 'success' | 'error';
  errorCode: string | null;
  /** Solo lo pasa el camino de supresión no verificable (FIX 3). */
  suppressionState?: InFlightSuppressionAuditState;
  /** Solo lo pasa el camino de colección no persistible (4O-C). Cifras, no PII. */
  collectionFields?: CandidatePhoneCollectionLogFields;
  /** Solo lo pasa el camino de payload pendiente (L3). Segundos, no PII. */
  retryAfterSeconds?: number | null;
  /** Id de la corrida del waterfall, ya resuelto por el caller. Opcional. */
  waterfallRunId?: string | null;
  input: RecoverApolloPhoneRevealInput;
  deps: RecoverApolloPhoneRevealDeps;
}): Promise<RecoverApolloPhoneRevealResult> {
  const {
    candidate,
    recoveryRequestId,
    outcome,
    revealStatus,
    logStatus,
    errorCode,
    suppressionState,
    collectionFields,
    retryAfterSeconds,
    waterfallRunId,
    input,
    deps,
  } = args;
  // NO se toca el status del candidato (sigue en vuelo, recuperable): solo se
  // marca la última verificación. NUNCA se degrada a no_phone_found ni a error
  // terminal de negocio.
  await deps.persist(candidate.id, {
    phone_reveal_last_checked_at: deps.nowIso,
  });
  await deps.logUsage(
    buildRecoveryLog({
      candidate,
      recoveryRequestId,
      revealStatus,
      outcome,
      logStatus,
      errorCode,
      phonePresent: false,
      phoneType: null,
      credits: null,
      suppressionState,
      collectionFields,
      waterfallRunId,
      input,
    }),
  );
  return toResult(outcome, {
    recoveryRequestIdPresent: true,
    retryAfterSeconds: retryAfterSeconds ?? null,
  });
}

// ── Constructor del log de recovery (sin PII) ──────────────────

function buildRecoveryLog(args: {
  candidate: RecoveryCandidateRecord;
  recoveryRequestId: string;
  revealStatus: RecoveryLogRevealStatus;
  outcome: RecoveryOutcome;
  logStatus: 'success' | 'error';
  errorCode: string | null;
  phonePresent: boolean;
  phoneType: string | null;
  credits: number | null;
  /** Etiqueta PII-free de la comprobación de supresión (FIX 3). Opcional. */
  suppressionState?: InFlightSuppressionAuditState;
  /** Cifras PII-free de la colección de teléfonos (4O-C). Opcional. */
  collectionFields?: CandidatePhoneCollectionLogFields;
  /** Id de la corrida del waterfall (AGENT2A-PHONE-WATERFALL-1). Opcional. */
  waterfallRunId?: string | null;
  input: RecoverApolloPhoneRevealInput;
}): RecoveryUsageLogEntry {
  const waterfallRunId = cleanText(args.waterfallRunId);
  return {
    operationKey: PHONE_REVEAL_OPERATION_KEY,
    provider: 'apollo',
    triggeredBy: cleanText(args.input.actorUserId),
    creditsUsed: args.credits,
    status: args.logStatus,
    errorCode: args.errorCode,
    metadata: {
      candidate_id: args.candidate.id,
      account_id: args.candidate.accountId,
      provider: 'apollo',
      reveal_phase: RECOVERY_REVEAL_PHASE,
      reveal_status: args.revealStatus,
      recovery_outcome: args.outcome,
      request_id: args.recoveryRequestId,
      apollo_http_request_id: args.recoveryRequestId,
      phone_present: args.phonePresent,
      phone_type: args.phoneType,
      credits_used: args.credits,
      has_reason: Boolean(cleanText(args.input.reason)),
      // Solo se incluye cuando la comprobación llegó a ejecutarse (hubo teléfono).
      ...(args.suppressionState
        ? { suppression_state: args.suppressionState }
        : {}),
      // 4O-C: clave omitida cuando el writer de la colección no está cableado, de
      // modo que sin él la metadata del recovery es la de antes del hito.
      ...(args.collectionFields
        ? { phone_collection: args.collectionFields }
        : {}),
      // Clave omitida cuando no hay waterfall: la metadata del recovery queda
      // idéntica a la de antes de este hito con el flag apagado.
      ...(waterfallRunId ? { phone_reveal_waterfall_id: waterfallRunId } : {}),
    },
  };
}

// ── Batch de recuperación (cron-ready, pero NO agendado) ───────

export interface RecoverStaleApolloPhoneRevealInput {
  /** Tope de candidatos por ejecución. Default 5; hard cap 10. */
  maxCandidates?: number;
  /** Antigüedad mínima (min) del request para considerarlo stale. Default 15. */
  minAgeMinutes?: number;
  /** Actor que dispara el batch (auditoría). Opaco, no PII. */
  actorUserId?: string | null;
  /** Solo selecciona y reporta, sin poll ni escritura. Default true (seguro). */
  dryRun?: boolean;
}

export interface StaleRecoveryQuery {
  maxCandidates: number;
  minAgeMinutes: number;
  nowIso: string;
}

/**
 * Instante límite de la selección stale: un reveal solo es elegible si su
 * `phone_reveal_requested_at` es ANTERIOR o igual a este corte. Puro (aritmética
 * de fechas, sin I/O), exportado para que la query real y sus tests compartan la
 * misma definición del corte en vez de duplicarla.
 */
export function resolveStaleRecoveryCutoffIso(
  nowIso: string,
  minAgeMinutes: number,
): string {
  return new Date(new Date(nowIso).getTime() - minAgeMinutes * 60_000).toISOString();
}

export interface RecoverStaleApolloPhoneRevealDeps {
  nowIso: string;
  /**
   * Selecciona ids de candidatos stale: provider apollo, status requested/pending,
   * phone_reveal_request_id NOT NULL, sin teléfono, phone_reveal_requested_at <=
   * now - minAgeMinutes, ordenados y limitados a maxCandidates. Devuelve solo ids
   * (nunca PII).
   */
  findStaleCandidateIds: (query: StaleRecoveryQuery) => Promise<string[]>;
  /**
   * Recupera UN candidato (típicamente recoverApolloPhoneRevealForCandidate con
   * deps reales cableadas). Solo se invoca fuera de dryRun.
   */
  recoverOne: (candidateId: string) => Promise<RecoveryOutcome>;
}

/** Resumen del batch (sin PII: solo conteos). */
export interface StaleRecoverySummary {
  checked: number;
  recovered: number;
  still_pending: number;
  no_phone_found: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  maxCandidates: number;
  minAgeMinutes: number;
}

function clampMaxCandidates(value: number | undefined): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_BATCH_MAX_CANDIDATES;
  if (n < 1) return 1;
  if (n > MAX_BATCH_MAX_CANDIDATES) return MAX_BATCH_MAX_CANDIDATES;
  return n;
}

function clampMinAgeMinutes(value: number | undefined): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_BATCH_MIN_AGE_MINUTES;
  return n < 0 ? 0 : n;
}

/**
 * Recupera en lote los reveals Apollo stale (requested/pending sin webhook).
 * Selecciona con tope duro (≤10), respeta minAgeMinutes y por defecto corre en
 * dryRun (solo cuenta lo que procesaría, sin poll ni escritura). NO se agenda ni
 * se auto-ejecuta: un runtime admin-gated futuro decide cuándo llamarlo. El
 * resumen es solo conteos (sin PII).
 */
export async function recoverStaleApolloPhoneRevealRequests(
  input: RecoverStaleApolloPhoneRevealInput,
  deps: RecoverStaleApolloPhoneRevealDeps,
): Promise<StaleRecoverySummary> {
  const maxCandidates = clampMaxCandidates(input.maxCandidates);
  const minAgeMinutes = clampMinAgeMinutes(input.minAgeMinutes);
  const dryRun = input.dryRun !== false; // default true (seguro)

  const ids = await deps.findStaleCandidateIds({
    maxCandidates,
    minAgeMinutes,
    nowIso: deps.nowIso,
  });

  const base: StaleRecoverySummary = {
    checked: ids.length,
    recovered: 0,
    still_pending: 0,
    no_phone_found: 0,
    failed: 0,
    skipped: 0,
    dryRun,
    maxCandidates,
    minAgeMinutes,
  };

  if (dryRun) {
    // No se consulta Apollo ni se escribe: todo lo seleccionado queda "skipped".
    return { ...base, skipped: ids.length };
  }

  let recovered = 0;
  let stillPending = 0;
  let noPhoneFound = 0;
  let failed = 0;
  let skipped = 0;
  for (const id of ids) {
    const outcome = await deps.recoverOne(id);
    switch (outcome) {
      case 'revealed':
        recovered += 1;
        break;
      case 'no_phone_found':
        noPhoneFound += 1;
        break;
      case 'still_pending':
      case 'not_found_or_pending_ambiguous':
        stillPending += 1;
        break;
      case 'possible_missing_webhook_result_read_scope':
      case 'provider_error_transient':
      // FIX 3: la supresión no se pudo verificar. Es una condición técnica sin
      // resolver (como un 401/5xx), no un candidato inelegible: cuenta como
      // `failed` para que salte a la vista, no como `skipped`.
      case 'suppression_check_unavailable':
      // 4O-C: la colección no se pudo escribir. También es una condición técnica
      // sin resolver — el teléfono existe y sigue sin guardarse — así que cuenta
      // como `failed`: contarla como `skipped` la escondería entre los
      // candidatos inelegibles, que es justo lo que no es.
      case 'collection_persistence_unavailable':
        failed += 1;
        break;
      // FIX 3: bloqueado por supresión. NO es un fallo — es el resultado correcto
      // y deseado — y tampoco es una recuperación. Cuenta como `skipped`.
      case 'blocked_suppressed':
        skipped += 1;
        break;
      default:
        // Inelegible (ya terminal, sin recovery id, no apollo, etc.).
        skipped += 1;
        break;
    }
  }

  return {
    ...base,
    recovered,
    still_pending: stillPending,
    no_phone_found: noPhoneFound,
    failed,
    skipped,
  };
}
