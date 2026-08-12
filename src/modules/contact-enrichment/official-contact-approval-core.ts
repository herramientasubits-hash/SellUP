// Agente 2A — Núcleo PURO de la aprobación atómica sobre el modelo OFICIAL
// (AGENT2A-PHONE-REVEAL-4O-H3)
//
// Sin red, sin DB, sin auth, sin reloj propio. Tres cosas y nada más:
//
//   1. la INVERSIÓN de la procedencia heredada del candidato escalar-only hacia el par
//      `(provider, acquisition_mode)` de la 114, usando el ÚNICO normalizador que existe;
//   2. la construcción POSICIONAL de los parámetros de la RPC de la migración 116;
//   3. el parseo del sobre que devuelve, sin confiar en su forma.
//
// Que esto sea puro es lo que permite que las pruebas contra PostgreSQL real invoquen la RPC
// con los MISMOS parámetros que la server action, derivados del MISMO builder, en vez de
// escribir el SQL a mano y demostrar una propiedad de un escritor FICTICIO — la lección de
// 4O-E4-R1.

import {
  buildCandidatePhoneSourceEventKey,
  normalizeCandidatePhone,
} from './phone-collection-core';
import type { PhoneType } from './types';

/** Nombre de la función de la migración 116. Una sola constante, un solo sitio que la nombra. */
export const APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN =
  'approve_contact_candidate_with_phones' as const;

// ── 1. Inversión de la procedencia heredada ────────────────────────

/**
 * El vocabulario FUSIONADO de `contacts.phone_source` / `enrichment_metadata.phone.source`,
 * invertido hacia el par ORTOGONAL de la 114.
 *
 * Es la tabla de la migración 112 leída al revés, y solo los miembros que invierten SIN
 * ambigüedad. Faltan dos a propósito:
 *
 *   * `provider_payload` no nombra a ningún proveedor. Escribir `unknown` como proveedor Y
 *     `search` como modo sería inventar el modo de adquisición.
 *   * `unknown` es la AUSENCIA declarada de evidencia. Convertir "no lo sé" en una fila de
 *     procedencia es exactamente lo que la tabla existe para hacer imposible.
 *
 * Un `source` ausente, nulo o fuera del vocabulario cae en el mismo sitio: no se promueve.
 */
const LEGACY_SOURCE_TO_OFFICIAL_PAIR: Readonly<
  Record<string, { provider: string; acquisitionMode: string }>
> = {
  apollo_search: { provider: 'apollo', acquisitionMode: 'search' },
  apollo_reveal: { provider: 'apollo', acquisitionMode: 'reveal' },
  apollo_cache: { provider: 'apollo_cache', acquisitionMode: 'cache' },
  lusha_reveal: { provider: 'lusha', acquisitionMode: 'reveal' },
  manual: { provider: 'manual', acquisitionMode: 'manual' },
};

/** Vocabulario de `contact_phones.phone_type` (114 = 109 = `PhoneType`). */
const OFFICIAL_PHONE_TYPES: readonly string[] = [
  'personal_mobile',
  'mobile',
  'direct_dial',
  'work',
  'hq',
  'other',
  'unknown',
];

/**
 * La fase con la que se marca la clave de evento del escalar promovido. NO es una fase de
 * waterfall: nombra de dónde salió el valor, que es lo que hace la clave legible en una
 * auditoría sin volverla adivinable.
 */
const SCALAR_FALLBACK_PHASE = 'candidate_scalar' as const;

export interface CandidateScalarFallbackInput {
  /** `contact_enrichment_candidates.phone`. */
  readonly phone: string | null | undefined;
  /** `enrichment_metadata.phone`, tal cual lo dejó PHONE-3A. */
  readonly phoneMetadata: { type?: unknown; source?: unknown; raw_type?: unknown } | null | undefined;
  /** ISO-2 del run. NO fabrica prefijo: `normalizeCandidatePhone()` lo ignora para la clave. */
  readonly countryCode?: string | null;
}

/** Lo que la RPC necesita para promover UN número escalar, ya normalizado. */
export interface CandidateScalarFallback {
  readonly normalized_phone: string;
  readonly display_phone: string | null;
  readonly dedupe_key: string;
  readonly phone_type: PhoneType | null;
  readonly provider: string;
  readonly acquisition_mode: string;
  readonly raw_provider_type: string | null;
  readonly source_event_key: string;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Construye la promoción del teléfono ESCALAR de un candidato que no tiene colección.
 *
 * Devuelve `null` —y eso NO es un fallo— cuando no hay número, cuando el número no deja una
 * forma canónica utilizable, o cuando la procedencia no invierte fielmente. En los tres casos
 * el contacto se crea igual y `contacts.phone` conserva exactamente el valor que escribe el
 * payload de hoy: la colección oficial se queda vacía, que es el estado en el que está HOY
 * cada contacto de Producción y el que la H2 ya reconoce como `no_official_collection`.
 *
 * Lo que NO hace es degradar la privacidad futura escribiendo una procedencia falsa. Un número
 * con procedencia `manual` inventada sobreviviría a un borrado de proveedor que debería
 * haberlo alcanzado.
 */
export function buildCandidateScalarFallback(
  input: CandidateScalarFallbackInput,
): CandidateScalarFallback | null {
  const phone = cleanText(input.phone);
  if (!phone) return null;

  const meta = input.phoneMetadata;
  const legacySource =
    meta && typeof meta === 'object' ? cleanText((meta as { source?: unknown }).source) : null;
  if (!legacySource) return null;

  const pair = LEGACY_SOURCE_TO_OFFICIAL_PAIR[legacySource];
  if (!pair) return null;

  // EL normalizador, no otro. La 114 dice que `dedupe_key` lo produce UN algoritmo y que la
  // migración no añade un segundo: dos normalizadores serían el mismo número con dos claves
  // según quién lo viera, que es la deduplicación fallando en silencio y el tombstone con ella.
  const normalized = normalizeCandidatePhone({
    displayPhone: phone,
    sanitizedPhone: phone,
    countryCode: input.countryCode ?? null,
  });

  // Sin forma canónica no hay número que representar. Una fila canónica con
  // `normalized_phone = NULL` y sin tombstone sería una fila que la 114 nunca deja ser
  // principal y que no dice nada de nadie.
  if (!normalized.normalizedPhone) return null;

  const rawType = meta && typeof meta === 'object' ? cleanText((meta as { raw_type?: unknown }).raw_type) : null;
  const declaredType = meta && typeof meta === 'object' ? cleanText((meta as { type?: unknown }).type) : null;
  const phoneType =
    declaredType && OFFICIAL_PHONE_TYPES.includes(declaredType) ? (declaredType as PhoneType) : null;

  return {
    normalized_phone: normalized.normalizedPhone,
    display_phone: normalized.displayPhone,
    dedupe_key: normalized.dedupeKey,
    phone_type: phoneType,
    provider: pair.provider,
    acquisition_mode: pair.acquisitionMode,
    raw_provider_type: rawType,
    // EL generador de claves, no otro. Sin ids de contabilidad porque un escalar derivado de
    // la búsqueda nunca fue un reveal facturado; la fase dice de dónde salió. La migración le
    // antepone `v1:promoted:` igual que a las claves de la colección.
    source_event_key: buildCandidatePhoneSourceEventKey({
      provider: pair.provider as never,
      acquisitionMode: pair.acquisitionMode as never,
      phase: SCALAR_FALLBACK_PHASE,
      waterfallRunId: null,
      reservationId: null,
      providerUsageLogId: null,
    }),
  };
}

// ── 2. Parámetros de la RPC ────────────────────────────────────────

export interface ApproveCandidateWithPhonesRequest {
  readonly candidateId: string;
  readonly accountId: string;
  /** El payload de `buildContactInsertPayload()`, sin tocar. */
  readonly contactPayload: Record<string, unknown>;
  /** El `CandidateReviewPatch` de aprobación, sin tocar. */
  readonly reviewPatch: Record<string, unknown>;
  readonly scalarFallback: CandidateScalarFallback | null;
  readonly actorId: string;
  readonly nowIso: string;
}

/**
 * Parámetros POSICIONALES de la migración 116, con los nombres exactos de sus argumentos.
 * Un solo sitio los nombra, así que un cambio de firma rompe la compilación en vez de degradar
 * silenciosamente a una llamada que PostgREST no resuelve.
 */
export function buildApproveCandidateWithPhonesParams(
  request: ApproveCandidateWithPhonesRequest,
): Record<string, unknown> {
  return {
    p_candidate_id: request.candidateId,
    p_account_id: request.accountId,
    p_contact_payload: request.contactPayload,
    p_review_patch: request.reviewPatch,
    p_scalar_fallback: request.scalarFallback,
    p_actor_id: request.actorId,
    p_now: request.nowIso,
  };
}

// ── 3. Sobre de respuesta ──────────────────────────────────────────

export type ApproveCandidateStatus =
  | 'approved'
  | 'already_approved'
  | 'candidate_not_found'
  | 'candidate_not_approvable'
  | 'person_suppressed'
  | 'invalid_input';

export type ScalarFallbackOutcome = 'promoted' | 'unrepresentable' | 'absent';

export interface ApproveCandidateWithPhonesOutcome {
  readonly status: ApproveCandidateStatus;
  readonly detail: string | null;
  readonly candidateId: string | null;
  readonly contactId: string | null;
  readonly contactMode: string | null;
  readonly contactCreated: boolean;
  readonly phonesSeen: number;
  readonly phonesInserted: number;
  readonly phonesReused: number;
  readonly phonesSkippedSuppressed: number;
  readonly sourcesInserted: number;
  readonly sourcesReused: number;
  /** SHA-256 por diseño de la 114. NUNCA el número. */
  readonly primaryDedupeKey: string | null;
  readonly scalarSynced: boolean;
  readonly scalarFallback: ScalarFallbackOutcome;
  readonly candidateTerminal: boolean;
}

const APPROVE_STATUSES: readonly ApproveCandidateStatus[] = [
  'approved',
  'already_approved',
  'candidate_not_found',
  'candidate_not_approvable',
  'person_suppressed',
  'invalid_input',
];

const SCALAR_FALLBACK_OUTCOMES: readonly ScalarFallbackOutcome[] = [
  'promoted',
  'unrepresentable',
  'absent',
];

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Parsea el sobre SIN confiar en él. Un estado desconocido no se propaga como éxito: LANZA.
 * Un sobre con forma inesperada tras un COMMIT es exactamente el caso en el que adivinar
 * produce un "aprobado" que nadie escribió.
 */
export function parseApproveCandidateWithPhonesEnvelope(
  data: unknown,
): ApproveCandidateWithPhonesOutcome {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('approve_contact_candidate_with_phones: envelope is not an object');
  }
  const row = data as Record<string, unknown>;
  const status = row.status;
  if (typeof status !== 'string' || !APPROVE_STATUSES.includes(status as ApproveCandidateStatus)) {
    throw new Error('approve_contact_candidate_with_phones: unknown envelope status');
  }
  const fallbackRaw = row.scalar_fallback;
  const scalarFallback =
    typeof fallbackRaw === 'string' &&
    SCALAR_FALLBACK_OUTCOMES.includes(fallbackRaw as ScalarFallbackOutcome)
      ? (fallbackRaw as ScalarFallbackOutcome)
      : 'absent';

  return {
    status: status as ApproveCandidateStatus,
    detail: asText(row.detail),
    candidateId: asText(row.candidate_id),
    contactId: asText(row.contact_id),
    contactMode: asText(row.contact_mode),
    contactCreated: row.contact_created === true,
    phonesSeen: asCount(row.phones_seen),
    phonesInserted: asCount(row.phones_inserted),
    phonesReused: asCount(row.phones_reused),
    phonesSkippedSuppressed: asCount(row.phones_skipped_suppressed),
    sourcesInserted: asCount(row.sources_inserted),
    sourcesReused: asCount(row.sources_reused),
    primaryDedupeKey: asText(row.primary_dedupe_key),
    scalarSynced: row.scalar_synced === true,
    scalarFallback,
    candidateTerminal: row.candidate_terminal === true,
  };
}
