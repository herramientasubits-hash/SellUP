// Agente 2A — Escritura APPEND-ONLY de «Buscar más números»
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// Implementación server-only de la ÚNICA escritura de una corrida `search_more`: la
// función `append_candidate_search_more_phones` de la migración 122. Este archivo no
// contiene ni un `.insert()`, ni un `.update()`, ni un `.select()`: prepara el payload,
// llama, e interpreta la respuesta.
//
// ── POR QUÉ NO SE REUSA EL WRITER DEL REVEAL ───────────────────
//
// `persist_candidate_lusha_phone_reveal_result` (migración 111, reafirmada por la 120) ya
// fusiona una respuesta de Lusha en la colección de forma append-safe. Todo eso es
// exactamente lo que hace falta, y NADA de eso se reimplementa aquí.
//
// Lo que ese writer hace ADEMÁS, sin condición, es escribir el estado TERMINAL del reveal:
// `phone_reveal_provider`, `phone_reveal_request_id`, `phone_revealed_at`,
// `phone_reveal_cost_credits`, `phone_reveal_cost_source`, `phone_reveal_attempt_count`. En
// su camino eso es correcto — ES la transacción que cierra el reveal. En una corrida
// `search_more` es FALSO y destructivo: el candidato lo reveló APOLLO, y cuando Lusha sólo
// devuelve un número de rango inferior el teléfono visible SIGUE siendo el de Apollo.
// Escribir `phone_reveal_provider = 'lusha'` atribuiría un número a un proveedor que no lo
// produjo, y `phone_reveal_cost_credits` quedaría sobrescrito con la cifra de la pata de
// Lusha, borrando lo que costó el reveal de Apollo.
//
// El llamador NO puede evitarlo eligiendo parámetros, porque «se conserva el incumbente» se
// decide BAJO EL LOCK, después de que los argumentos ya se pasaron. De ahí una función
// aparte, y de ahí este envoltorio.
//
// ── SIN REINTENTO Y SIN FALLBACK SECUENCIAL ────────────────────
//
// Igual que el writer del reveal: si la RPC falla —error del servidor, error de transporte,
// función ausente porque la 122 no está aplicada, respuesta con forma inesperada— este
// módulo LANZA y no intenta nada más. Un reintento ciego podría duplicar el trabajo de una
// transacción que sí llegó a COMMIT pero cuya respuesta se perdió, y la idempotencia real
// —`(candidate_id, dedupe_key)` y `(candidate_phone_id, source_event_key)` son UNIQUE— hace
// que un reproceso posterior converja sin necesitar el reintento aquí.
//
// Consecuencia asumida y DECLARADA: cuando eso ocurre, Lusha YA cobró. El gasto no se
// pierde de vista, porque el usage-log y la liquidación de la reserva viven FUERA de esta
// transacción precisamente para sobrevivir al fallo que ella reporta. Lo que este camino no
// hace en ningún caso es fingir que costó 0.
//
// ── PRIVILEGIOS ────────────────────────────────────────────────
// La función es SECURITY INVOKER, así que corre con el sobre del service role que la
// migración 109 concedió: SELECT/INSERT/UPDATE en la tabla canónica (SIN DELETE) y
// SELECT/INSERT en la de procedencias. No se le regala nada, y por construcción no puede
// borrar un teléfono.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada. Los números viajan en el payload de la llamada y jamás en un log: los
// mensajes de error se recortan y describen la operación, y la respuesta de la RPC sólo
// contiene cifras, banderas, un status y una `dedupe_key` (hash SHA-256).

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { CandidateLushaPhoneCollectionWriteRequest } from './candidate-lusha-phone-collection-writer';
import type { SearchMorePersistStatus } from './search-more-phones-core';

/** Nombre de la función de la migración 122. */
export const APPEND_CANDIDATE_SEARCH_MORE_PHONES_FN =
  'append_candidate_search_more_phones';

/**
 * Los cuatro veredictos que la RPC de la 122 puede devolver.
 *
 * NO incluye `idempotent` ni `stale_event`, y la ausencia es del contrato de la función, no
 * un olvido: la 122 no valida un token de propiedad (no hay reveal que cerrar, así que no
 * hay estado esperado contra el que comparar) y su idempotencia la dan los índices UNIQUE,
 * que producen `persisted` con contadores en cero — no un status propio.
 */
const APPEND_STATUSES: readonly string[] = [
  'persisted',
  'no_incoming_phones',
  'suppressed',
  'candidate_not_eligible',
];

/** Longitud máxima de un mensaje de error propagado. Corta antes de que crezca. */
const MAX_ERROR_DETAIL = 200;

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Qué quedó escrito. Es un subconjunto ESTRICTO del resultado del writer del reveal: no
 * hay `candidate_terminalized` porque nada se terminaliza, y hay
 * `new_distinct_phone_count`, que la 122 DERIVA de lo que no existía antes.
 */
export interface CandidateSearchMorePhoneAppendResult {
  readonly status: SearchMorePersistStatus;
  readonly inserted_phone_count: number;
  readonly updated_phone_count: number;
  readonly inserted_source_count: number;
  readonly suppressed_skipped_count: number;
  /**
   * Números que la colección NO tenía antes de esta transacción. Es el dato que separa
   * `revealed` de `no_new_distinct_phone`: `0` con `updated_phone_count > 0` significa que
   * Lusha contestó, se le cobró, y todos sus números ya estaban.
   */
  readonly new_distinct_phone_count: number;
  readonly primary_dedupe_key: string | null;
  readonly primary_persisted: boolean;
  /** true SÓLO si el principal cambió legítimamente y el escalar se sincronizó. */
  readonly candidate_scalar_updated: boolean;
}

/**
 * Interpreta el sobre de la RPC.
 *
 * FAIL-CLOSED ante cualquier forma que no reconozca. Una respuesta que no se entiende no se
 * puede tratar como éxito: «éxito» aquí es lo que le permite al clasificador afirmar
 * `revealed` en el ledger, y afirmarlo sobre una escritura desconocida sería inventar un
 * hecho.
 */
function parseAppendEnvelope(data: unknown): CandidateSearchMorePhoneAppendResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('search more phone append returned a non-object envelope');
  }
  const envelope = data as Record<string, unknown>;
  const status = envelope.status;
  if (typeof status !== 'string') {
    throw new Error('search more phone append returned no status');
  }
  if (status === 'invalid_input') {
    // El payload que este módulo construyó no cumple el contrato de la función. Es un
    // defecto de programación, no una condición operativa, y `detail` es un string mecánico
    // cerrado que nombra el CAMPO, nunca su valor.
    const detail = typeof envelope.detail === 'string' ? envelope.detail : 'unspecified';
    throw new Error(`search more phone append rejected the payload: ${detail}`);
  }
  if (!APPEND_STATUSES.includes(status)) {
    throw new Error('search more phone append returned an unknown status');
  }
  return {
    status: status as SearchMorePersistStatus,
    inserted_phone_count: asCount(envelope.inserted_phone_count),
    updated_phone_count: asCount(envelope.updated_phone_count),
    inserted_source_count: asCount(envelope.inserted_source_count),
    suppressed_skipped_count: asCount(envelope.suppressed_skipped_count),
    new_distinct_phone_count: asCount(envelope.new_distinct_phone_count),
    primary_dedupe_key:
      typeof envelope.primary_dedupe_key === 'string'
        ? envelope.primary_dedupe_key
        : null,
    primary_persisted: envelope.primary_set === true,
    candidate_scalar_updated: envelope.candidate_scalar_updated === true,
  };
}

/**
 * Lo que este writer necesita, y NADA más.
 *
 * Reutiliza a propósito la forma de `CandidateLushaPhoneCollectionWriteRequest` para
 * `phones` y `primaryCandidates` —las construye el MISMO
 * `buildLushaPhoneCollectionCapture`, así que una forma propia sería una segunda copia del
 * mismo contrato— pero OMITE el bloque `terminal` entero. Esa omisión es el punto del
 * módulo: no hay estado esperado, no hay request id, no hay costo y no hay contador de
 * intentos, porque no hay reveal que cerrar.
 */
export interface CandidateSearchMorePhoneAppendRequest {
  readonly candidateId: string;
  readonly observedAt: string;
  readonly phones: CandidateLushaPhoneCollectionWriteRequest['phones'];
  readonly primaryCandidates: CandidateLushaPhoneCollectionWriteRequest['primaryCandidates'];
}

/**
 * AÑADE la respuesta de Lusha a una colección cuyo reveal YA cerró, en UNA transacción.
 *
 * Lo que la función garantiza y este envoltorio no puede aflojar: ningún teléfono existente
 * se borra ni se reemplaza; un número repetido gana procedencia sin duplicar su fila; un
 * número de rango inferior NO desplaza al principal; y ninguna columna `phone_reveal_*` se
 * escribe en ninguna rama.
 */
export async function appendCandidateSearchMorePhones(
  request: CandidateSearchMorePhoneAppendRequest,
): Promise<CandidateSearchMorePhoneAppendResult> {
  // ── Payload: colección canónica ──────────────────────────────
  // Mismas claves que la 122 declara, y ninguna más. `extension` no viaja porque la tabla
  // de la 109 no tiene esa columna.
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
  // Van en una lista plana con `dedupe_key` porque la función resuelve el
  // `candidate_phone_id` ella misma: ese id no existe todavía cuando se construye este
  // payload, y fabricarlo aquí obligaría a una lectura previa FUERA de la transacción — es
  // decir, a la carrera que la transacción elimina.
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

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(APPEND_CANDIDATE_SEARCH_MORE_PHONES_FN, {
    p_candidate_id: request.candidateId,
    p_observed_at: request.observedAt,
    p_phones: phones,
    p_sources: sources,
    p_primary_candidates: primaryCandidates,
  });
  if (error) {
    // Un error REPORTADO por el servidor significa que la transacción se deshizo: no hay
    // estado a medias que limpiar y no hay nada que reintentar aquí.
    throw new Error(
      `search more phone append failed: ${error.message.slice(0, MAX_ERROR_DETAIL)}`,
    );
  }
  return parseAppendEnvelope(data);
}
