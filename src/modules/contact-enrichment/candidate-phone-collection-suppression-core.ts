// Agente 2A — Contrato PURO de la propagación de la supresión a la colección
// (AGENT2A-PHONE-REVEAL-4O-E2)
//
// Mitad pura de la propagación: el vocabulario de alcances, los estados mecánicos
// que la función de la migración 112 puede devolver, la construcción del payload y
// la interpretación del sobre. Se separa de la escritura para que el
// comportamiento —incluido el fail-closed ante una respuesta que no se entiende—
// se pueda probar sin base de datos y sin mocks del cliente de Supabase.
//
// PURO: sin red, sin Supabase, sin reloj (el instante entra como dato), sin
// logging. Ningún valor de entrada ni de salida contiene un número de teléfono:
// el payload lleva ids opacos, un vocabulario cerrado y una fecha, y el sobre
// devuelve conteos, banderas y una `dedupe_key` (SHA-256 por diseño de la 109).

import type { CandidatePhoneSuppressionReason } from './phone-collection-core';

/** Nombre de la función de la migración 112. Única fuente para código y pruebas. */
export const SUPPRESS_CANDIDATE_PHONE_COLLECTION_FN =
  'suppress_candidate_phone_collection' as const;

// ── Alcance ────────────────────────────────────────────────────

/**
 * Alcances de la propagación.
 *
 *   * `all_candidate_phones` — todos los números del candidato. Es lo que pide la
 *     DSAR actual (la supresión existente deja el teléfono del candidato en null,
 *     no elige entre varios) y el ÚNICO alcance con llamador en Producción.
 *   * `exact_phone` — UN número, direccionado por su `dedupe_key`. No tiene
 *     llamador: existe porque la reelección del principal solo se puede ejercer
 *     con supresión PARCIAL, y «un superviviente asciende» frente a «no queda
 *     nada» es justamente la invariante que este hito garantiza. Declarado,
 *     probado y sin cablear.
 */
export const CANDIDATE_PHONE_SUPPRESSION_SCOPES = [
  'all_candidate_phones',
  'exact_phone',
] as const;

export type CandidatePhoneSuppressionScope =
  (typeof CANDIDATE_PHONE_SUPPRESSION_SCOPES)[number];

/** Alcance que usa el flujo DSAR real. */
export const DSAR_CANDIDATE_PHONE_SUPPRESSION_SCOPE: CandidatePhoneSuppressionScope =
  'all_candidate_phones';

// ── Estados mecánicos ──────────────────────────────────────────

/**
 * Veredictos de la función. Cerrados y sin PII.
 *
 *   * `suppressed`             — esta llamada CAMBIÓ algo.
 *   * `already_suppressed`     — el estado final ya estaba puesto (repetición
 *                                idempotente de la misma DSAR).
 *   * `no_matching_phone_rows` — alcance `exact_phone` cuya clave no existe: no se
 *                                tocó nada, y en particular no se tocó el escalar.
 *   * `candidate_not_found`    — el candidato no existe, o no pertenece al run que
 *                                el llamador usó para resolver la cuenta.
 *   * `invalid_input`          — el payload no cumple el contrato. Nada escrito.
 */
export const CANDIDATE_PHONE_SUPPRESSION_STATUSES = [
  'suppressed',
  'already_suppressed',
  'no_matching_phone_rows',
  'candidate_not_found',
  'invalid_input',
] as const;

export type CandidatePhoneSuppressionStatus =
  (typeof CANDIDATE_PHONE_SUPPRESSION_STATUSES)[number];

/** Estados en los que el candidato quedó en el estado que la supresión pedía. */
const SETTLED_STATUSES: readonly CandidatePhoneSuppressionStatus[] = [
  'suppressed',
  'already_suppressed',
];

// ── Petición ───────────────────────────────────────────────────

export interface CandidatePhoneCollectionSuppressionRequest {
  candidateId: string;
  /**
   * Run que resolvió la CUENTA del candidato. La tabla de la colección no tiene
   * columna de cuenta, así que el run es lo que reafirma el alcance dentro del
   * lock, igual que hacía el `.eq('enrichment_run_id', …)` del UPDATE anterior.
   * `null` significa que el llamador no lo pudo resolver y NO restringe — nunca
   * que restringió y casó.
   */
  expectedEnrichmentRunId: string | null;
  scope: CandidatePhoneSuppressionScope;
  /** Obligatoria con `exact_phone`, prohibida con `all_candidate_phones`. */
  dedupeKey: string | null;
  /** Vocabulario de la migración 109. Ya traducido; aquí no se traduce nada. */
  reason: CandidatePhoneSuppressionReason;
  /** `internal_users.id` del operador. Id opaco. */
  suppressedBy: string | null;
  /** ISO-8601. Entra como dato: este módulo no lee el reloj. */
  suppressedAt: string;
}

/** Parámetros nombrados de la RPC, tal como los espera la migración 112. */
export interface CandidatePhoneCollectionSuppressionParams {
  p_candidate_id: string;
  p_expected_enrichment_run_id: string | null;
  p_scope: CandidatePhoneSuppressionScope;
  p_dedupe_key: string | null;
  p_suppression_reason: CandidatePhoneSuppressionReason;
  p_suppressed_by: string | null;
  p_suppressed_at: string;
}

/**
 * Construye el payload. Normaliza la única asimetría del contrato: con el alcance
 * amplio la clave viaja SIEMPRE como `null`, porque la función rechaza una clave
 * junto al alcance amplio en vez de ignorarla — ensanchar en silencio una petición
 * que PARECE dirigida a un número es la sobre-supresión que una operación de
 * privacidad no puede permitirse por accidente.
 */
export function buildCandidatePhoneCollectionSuppressionParams(
  request: CandidatePhoneCollectionSuppressionRequest,
): CandidatePhoneCollectionSuppressionParams {
  return {
    p_candidate_id: request.candidateId,
    p_expected_enrichment_run_id: request.expectedEnrichmentRunId,
    p_scope: request.scope,
    p_dedupe_key: request.scope === 'exact_phone' ? request.dedupeKey : null,
    p_suppression_reason: request.reason,
    p_suppressed_by: request.suppressedBy,
    p_suppressed_at: request.suppressedAt,
  };
}

// ── Resultado ──────────────────────────────────────────────────

export interface CandidatePhoneCollectionSuppressionResult {
  status: Exclude<CandidatePhoneSuppressionStatus, 'invalid_input'>;
  /** Filas que ESTA llamada convirtió en tombstone. Reportadas por la base. */
  suppressedCount: number;
  /** Filas del alcance que ya eran tombstone antes de la llamada. */
  alreadySuppressedCount: number;
  /** Números vivos y elegibles que quedan tras la supresión. */
  survivorCount: number;
  /** `dedupe_key` (SHA-256) del principal resultante, o null si no queda ninguno. */
  primaryDedupeKey: string | null;
  primaryChanged: boolean;
  /** true cuando `contact_enrichment_candidates.phone` quedó en null. */
  candidatePhoneCleared: boolean;
  /** true solo si el UPDATE del candidato cambió algún valor. */
  candidateUpdated: boolean;
  /**
   * true cuando el candidato fue alcanzado y quedó en el estado pedido. Distinto
   * de `candidateUpdated`, que es false en una repetición idempotente: el conteo
   * auditado de «candidatos limpiados» tiene que seguir contando el candidato que
   * ya estaba limpio, igual que lo contaba el UPDATE incondicional anterior.
   */
  candidateSettled: boolean;
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/**
 * Interpreta el sobre de la RPC.
 *
 * FAIL-CLOSED ante cualquier forma que no reconozca, y ante `invalid_input`: una
 * respuesta que no se entiende NO puede tratarse como éxito, porque «éxito» aquí
 * autoriza al flujo DSAR a reportar que la propagación se completó.
 *
 * LANZA en vez de devolver un estado degradado. El llamador traduce la excepción a
 * un código mecánico de fallo y la supresión se reporta INCOMPLETA.
 */
export function parseCandidatePhoneCollectionSuppressionEnvelope(
  data: unknown,
): CandidatePhoneCollectionSuppressionResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'candidate phone collection suppression returned a non-object envelope',
    );
  }
  const envelope = data as Record<string, unknown>;
  const status = envelope.status;
  if (typeof status !== 'string') {
    throw new Error('candidate phone collection suppression returned no status');
  }
  if (status === 'invalid_input') {
    // El payload que este módulo construyó no cumple el contrato de la función:
    // defecto de programación, no condición operativa. `detail` es un literal
    // mecánico que nombra el CAMPO, nunca su valor.
    const detail =
      typeof envelope.detail === 'string' ? envelope.detail : 'unspecified';
    throw new Error(
      `candidate phone collection suppression rejected the payload: ${detail}`,
    );
  }
  if (
    !(CANDIDATE_PHONE_SUPPRESSION_STATUSES as readonly string[]).includes(status)
  ) {
    throw new Error(
      'candidate phone collection suppression returned an unknown status',
    );
  }

  const typed = status as Exclude<
    CandidatePhoneSuppressionStatus,
    'invalid_input'
  >;
  return {
    status: typed,
    suppressedCount: asCount(envelope.suppressed_count),
    alreadySuppressedCount: asCount(envelope.already_suppressed_count),
    survivorCount: asCount(envelope.survivor_count),
    primaryDedupeKey:
      typeof envelope.primary_dedupe_key === 'string'
        ? envelope.primary_dedupe_key
        : null,
    primaryChanged: envelope.primary_changed === true,
    candidatePhoneCleared: envelope.candidate_phone_cleared === true,
    candidateUpdated: envelope.candidate_updated === true,
    // No se deriva del estado: se cree a la base. Pero se exige coherencia — un
    // `settled` afirmado sobre un estado que no alcanzó el candidato sería una
    // afirmación que el flujo DSAR no puede aceptar.
    candidateSettled:
      envelope.candidate_settled === true && SETTLED_STATUSES.includes(typed),
  };
}
