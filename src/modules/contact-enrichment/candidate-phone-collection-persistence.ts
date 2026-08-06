// Agente 2A — Escritura TRANSACCIONAL del resultado `revealed` de Apollo
// (AGENT2A-PHONE-REVEAL-4O-C · transaccional en 4O-C-R1)
//
// Implementación server-only del contrato `PersistCandidatePhoneCollection`
// (candidate-phone-collection-writer.ts). Es el ÚNICO sitio del repositorio que
// escribe la colección de teléfonos: el webhook y el recovery la inyectan, y
// ninguno de los dos arma SQL por su cuenta.
//
// ── UNA TRANSACCIÓN, UNA LLAMADA ───────────────────────────────
//
// 4O-C escribía aquí cuatro cosas en secuencia (filas canónicas, procedencias,
// principal, y después el caller tocaba el candidato). Ordenarlas hacía
// inalcanzable el PEOR estado —escalar con teléfono y colección vacía— pero no
// hacía inalcanzable un estado a medias, y «el siguiente poll gratuito lo
// completa» es una promesa sobre un evento futuro, no una propiedad de este.
//
// Desde 4O-C-R1 este módulo hace EXACTAMENTE UNA llamada: la función
// `persist_candidate_apollo_phone_reveal_result` de la migración 110, que bloquea
// el candidato y escribe las cuatro cosas en una sola transacción de PostgreSQL.
// Este archivo ya no contiene ni un `.insert()`, ni un `.update()`, ni un
// `.select()`: solo prepara el payload, llama, e interpreta la respuesta.
//
// ── SIN FALLBACK SECUENCIAL ────────────────────────────────────
//
// Si la RPC falla —error del servidor, error de transporte, función ausente,
// respuesta con forma inesperada— este módulo LANZA y no intenta nada más. En
// particular NO reintenta y NO cae al camino de escrituras sueltas: un reintento
// ciego podría duplicar el trabajo de una transacción que sí llegó a hacer COMMIT
// pero cuya respuesta se perdió, y un fallback secuencial reintroduciría
// literalmente el defecto que este hito corrige. El caller trata la excepción
// como `collection_persistence_unavailable`: nada terminal se escribe, el
// candidato sigue en vuelo y el mismo payload se puede reprocesar con 0 créditos.
//
// Por qué la ausencia de reintento es SEGURA y no una renuncia: la RPC es
// idempotente por construcción (`(candidate_id, dedupe_key)` y
// `(candidate_phone_id, source_event_key)` son UNIQUE, y un evento repetido
// devuelve `idempotent` sin reescribir). Un reproceso posterior converge; lo que
// no se hace es reintentar a ciegas dentro de la misma llamada, porque ahí no se
// sabe si hubo COMMIT.
//
// ── PRIVILEGIOS ────────────────────────────────────────────────
// La función es SECURITY INVOKER, así que corre con el sobre del service role que
// la migración 109 concedió: SELECT/INSERT/UPDATE en la tabla canónica (sin
// DELETE) y SELECT/INSERT en la de procedencias. No se le regala nada.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada. Los números viajan en el payload de la llamada y jamás en un
// log: los mensajes de error se recortan y describen la operación, y la respuesta
// de la RPC solo contiene cifras, banderas, un status y una `dedupe_key` (hash).

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type {
  CandidatePhoneCollectionWriteRequest,
  CandidatePhoneCollectionWriteResult,
  CandidatePhoneCollectionWriteStatus,
} from './candidate-phone-collection-writer';

/** Nombre de la función de la migración 110. */
export const PERSIST_CANDIDATE_APOLLO_PHONE_REVEAL_RESULT_FN =
  'persist_candidate_apollo_phone_reveal_result';

/** Los cinco veredictos que la RPC puede devolver. */
const WRITE_STATUSES: readonly CandidatePhoneCollectionWriteStatus[] = [
  'persisted',
  'idempotent',
  'stale_event',
  'candidate_not_eligible',
  'suppressed',
];

/** Longitud máxima de un mensaje de error propagado. Corta antes de que crezca. */
const MAX_ERROR_DETAIL = 200;

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Interpreta el sobre de la RPC.
 *
 * FAIL-CLOSED ante cualquier forma que no reconozca: una respuesta que no se
 * entiende no se puede tratar como éxito, porque «éxito» aquí autoriza al caller a
 * NO volver a escribir el candidato.
 */
function parseWriteEnvelope(data: unknown): CandidatePhoneCollectionWriteResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('candidate phone reveal persistence returned a non-object envelope');
  }
  const envelope = data as Record<string, unknown>;
  const status = envelope.status;
  if (typeof status !== 'string') {
    throw new Error('candidate phone reveal persistence returned no status');
  }
  if (status === 'invalid_input') {
    // El payload que este módulo construyó no cumple el contrato de la función.
    // Es un defecto de programación, no una condición operativa, y `detail` es un
    // string mecánico cerrado que nombra el CAMPO, nunca su valor.
    const detail = typeof envelope.detail === 'string' ? envelope.detail : 'unspecified';
    throw new Error(`candidate phone reveal persistence rejected the payload: ${detail}`);
  }
  if (!WRITE_STATUSES.includes(status as CandidatePhoneCollectionWriteStatus)) {
    throw new Error('candidate phone reveal persistence returned an unknown status');
  }
  return {
    status: status as CandidatePhoneCollectionWriteStatus,
    inserted_phone_count: asCount(envelope.inserted_phone_count),
    updated_phone_count: asCount(envelope.updated_phone_count),
    inserted_source_count: asCount(envelope.inserted_source_count),
    suppressed_skipped_count: asCount(envelope.suppressed_skipped_count),
    primary_dedupe_key:
      typeof envelope.primary_dedupe_key === 'string' ? envelope.primary_dedupe_key : null,
    primary_persisted: envelope.primary_set === true,
    candidate_terminalized: envelope.candidate_terminalized === true,
  };
}

/**
 * Persiste el resultado `revealed` completo en UNA transacción y devuelve qué
 * quedó realmente escrito.
 *
 * FUSIÓN, no reemplazo: lo que ya estaba en la colección se conserva y se
 * refresca. Un callback que trae dos números no borra un tercero visto antes; el
 * modelo acumula evidencia, y sustituir la colección haría exactamente la pérdida
 * que este hito corrige, solo que un evento más tarde.
 */
export async function persistCandidatePhoneCollection(
  request: CandidatePhoneCollectionWriteRequest,
): Promise<CandidatePhoneCollectionWriteResult> {
  const { terminal } = request;

  // ── Payload: colección canónica ──────────────────────────────
  // Las claves son las del contrato de la migración 110 y nada más. `extension`
  // no viaja porque la tabla de la 109 no tiene esa columna: mandarla sería pedir
  // a la función que escriba algo que no existe.
  const phones = request.phones.map((phone) => ({
    dedupe_key: phone.dedupeKey,
    normalized_phone: phone.normalizedPhone,
    display_phone: phone.displayPhone,
    phone_type: phone.phoneType,
    phone_status: phone.phoneStatus,
    first_seen_at: phone.firstSeenAt,
    last_seen_at: phone.lastSeenAt,
  }));

  // ── Payload: procedencias, aplanadas con su clave ────────────
  // Van en una lista plana con `dedupe_key` porque la función necesita resolver el
  // `candidate_phone_id` ella misma: ese id no existe todavía cuando se construye
  // este payload, y fabricarlo aquí obligaría a una lectura previa fuera de la
  // transacción — es decir, a la carrera que la transacción elimina.
  const sources = request.phones.flatMap((phone) =>
    phone.sources.map((source) => ({
      dedupe_key: phone.dedupeKey,
      provider: source.provider,
      acquisition_mode: source.acquisitionMode,
      raw_provider_type: source.rawProviderType,
      raw_provider_status: source.rawProviderStatus,
      waterfall_run_id: source.waterfallRunId,
      reservation_id: source.reservationId,
      provider_usage_log_id: source.providerUsageLogId,
      source_event_key: source.sourceEventKey,
      observed_at: source.observedAt,
    })),
  );

  const primaryCandidates = request.primaryCandidates.map((candidate) => ({
    dedupe_key: candidate.dedupeKey,
    phone: candidate.phone,
    phone_type: candidate.phoneType,
    raw_type: candidate.rawType,
  }));

  const params = {
    p_candidate_id: request.candidateId,
    p_expected_request_id: terminal.expectedRequestId,
    p_reveal_phase: terminal.phase,
    p_observed_at: request.observedAt,
    p_phones: phones,
    p_sources: sources,
    p_primary_candidates: primaryCandidates,
    p_legacy_phone: terminal.legacyPhone,
    p_legacy_phone_type: terminal.legacyPhoneType,
    p_legacy_raw_type: terminal.legacyRawType,
    p_phone_reveal_status: 'revealed',
    p_phone_reveal_provider: 'apollo',
    p_phone_revealed_at: terminal.revealedAt,
    p_phone_reveal_completed_at: terminal.completedAt,
    p_phone_reveal_webhook_received_at: terminal.webhookReceivedAt,
    p_phone_reveal_last_checked_at: terminal.lastCheckedAt,
    p_phone_reveal_cost_credits: terminal.costCredits,
    p_phone_reveal_cost_source: terminal.costSource,
    // Este camino es el de éxito: un código de error viajando con él sería una
    // contradicción, y la función lo rechaza además por su cuenta.
    p_phone_reveal_error_code: null,
    p_phone_processing_basis: terminal.processingBasis,
    p_apollo_person_id: terminal.apolloPersonId,
  };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    PERSIST_CANDIDATE_APOLLO_PHONE_REVEAL_RESULT_FN,
    params,
  );
  if (error) {
    // Un error REPORTADO por el servidor significa que la transacción se deshizo:
    // no hay estado a medias que limpiar y no hay nada que reintentar aquí.
    throw new Error(
      `candidate phone reveal persistence failed: ${error.message.slice(0, MAX_ERROR_DETAIL)}`,
    );
  }
  return parseWriteEnvelope(data);
}
