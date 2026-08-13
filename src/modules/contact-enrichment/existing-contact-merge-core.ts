// Agente 2A — Núcleo PURO del merge humano hacia un contacto EXISTENTE
// (AGENT2A-PHONE-REVEAL-4O-H3-B)
//
// Sin red, sin DB, sin auth, sin reloj propio. Tres cosas y nada más:
//
//   1. la INVERSIÓN de la procedencia del escalar heredado del CONTACTO hacia el par
//      `(provider, acquisition_mode)` de la 114, con LA MISMA tabla y EL MISMO normalizador que
//      usa la aprobación;
//   2. la construcción de los parámetros de la RPC de la migración 117;
//   3. el parseo del sobre que devuelve, sin confiar en su forma.
//
// La RESOLUCIÓN DE IDENTIDAD del contacto existente NO vive aquí: vive junto a
// `findDuplicateContact()` en `candidate-review-core.ts`, que es donde están `emailKey()` y
// `linkedinKey()`. Partirla en dos módulos habría significado dos normalizaciones de email
// conviviendo, que es exactamente el defecto que la resolución existe para evitar.
//
// Que esto sea puro es lo que permite que las pruebas contra PostgreSQL real invoquen la RPC con
// los MISMOS parámetros que la server action, derivados del MISMO builder, en vez de escribir el
// SQL a mano y demostrar una propiedad de un escritor FICTICIO — la lección de 4O-E4-R1.

import {
  LEGACY_SOURCE_TO_OFFICIAL_PAIR,
  type CandidateScalarFallback,
} from './official-contact-approval-core';
import {
  buildCandidatePhoneSourceEventKey,
  normalizeCandidatePhone,
} from './phone-collection-core';
import type { PhoneType } from './types';

/** Nombre de la función de la migración 117. Un solo sitio lo nombra. */
export const MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN =
  'merge_contact_candidate_into_existing_contact' as const;

// ── 1. Bootstrap del escalar heredado del CONTACTO existente ───────

/**
 * El escalar heredado de un contacto existente, tal y como está hoy en `contacts`.
 *
 * Es el caso NORMAL, no el raro: hoy en Producción todos los contactos tienen `phone` y cero
 * filas en la colección oficial de la 114.
 */
export interface IncumbentContactScalarInput {
  readonly phone: string | null | undefined;
  readonly phoneType: string | null | undefined;
  /** `contacts.phone_source`: el MISMO vocabulario fusionado que invierte la aprobación. */
  readonly phoneSource: string | null | undefined;
  readonly phoneRawType: string | null | undefined;
  /** ISO-2 de la cuenta/corrida. NO fabrica prefijo. */
  readonly countryCode?: string | null;
}

/**
 * Lo que la RPC necesita para bootstrappear el escalar del contacto, ya normalizado.
 *
 * `observed_phone` NO es un dato que se escriba: es el valor que la 117 vuelve a comparar contra
 * `contacts.phone` DENTRO del lock. Si alguien retecleó el número entre la lectura y la
 * transacción, el bootstrap se descarta en vez de colgarle una procedencia a un número que ya no
 * está en la fila.
 */
export interface IncumbentContactBootstrap extends CandidateScalarFallback {
  readonly observed_phone: string;
}

/**
 * Construye el bootstrap del escalar heredado, o `null` cuando no se puede hacer FIELMENTE.
 *
 * Devuelve `null` —y eso NO es un fallo— en tres casos:
 *
 *   * no hay número que representar;
 *   * el número no deja forma canónica utilizable;
 *   * la procedencia NO invierte: `provider_payload`, `unknown`, o `phone_source` nulo.
 *
 * El tercero es `HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING` y es deliberado. Un escalar sin
 * procedencia puede haberlo tecleado una persona o haberlo escrito un proveedor, y las
 * consecuencias de equivocarse son opuestas: inventar `manual` haría que un borrado de proveedor
 * NO alcanzara un número que debía alcanzar, e inventar un proveedor haría que un borrado
 * destruyera un número que una persona escribió a mano. Ninguna de las dos es aceptable, así que
 * no se escribe ninguna: el escalar se queda exactamente como está y la colección oficial recibe
 * sólo los números del candidato.
 */
export function buildIncumbentContactBootstrap(
  input: IncumbentContactScalarInput,
): IncumbentContactBootstrap | null {
  const phone = cleanText(input.phone);
  if (!phone) return null;

  const legacySource = cleanText(input.phoneSource);
  if (!legacySource) return null;

  const pair = LEGACY_SOURCE_TO_OFFICIAL_PAIR[legacySource];
  if (!pair) return null;

  // EL normalizador, no otro: el mismo que produjo cada `dedupe_key` de la colección. Con un
  // segundo algoritmo, el número del contacto y el mismo número del candidato hashearían
  // distinto y la fusión crearía DOS filas canónicas para un solo teléfono.
  const normalized = normalizeCandidatePhone({
    displayPhone: phone,
    sanitizedPhone: phone,
    countryCode: input.countryCode ?? null,
  });
  if (!normalized.normalizedPhone) return null;

  const declaredType = cleanText(input.phoneType);
  const phoneType =
    declaredType && OFFICIAL_PHONE_TYPES.includes(declaredType) ? (declaredType as PhoneType) : null;

  return {
    observed_phone: phone,
    normalized_phone: normalized.normalizedPhone,
    display_phone: normalized.displayPhone,
    dedupe_key: normalized.dedupeKey,
    phone_type: phoneType,
    provider: pair.provider,
    acquisition_mode: pair.acquisitionMode,
    raw_provider_type: cleanText(input.phoneRawType),
    // EL generador de claves, no otro. Sin ids de contabilidad: el escalar heredado no nació de
    // una operación facturada que este proceso conozca. La fase dice de dónde salió, y la 117 le
    // antepone `v1:incumbent:` para que nunca colisione con una promoción del candidato.
    source_event_key: buildCandidatePhoneSourceEventKey({
      provider: pair.provider as never,
      acquisitionMode: pair.acquisitionMode as never,
      phase: INCUMBENT_BOOTSTRAP_PHASE,
      waterfallRunId: null,
      reservationId: null,
      providerUsageLogId: null,
    }),
  };
}

/** Nombra de dónde salió el número, que es lo que hace la clave legible en una auditoría. */
const INCUMBENT_BOOTSTRAP_PHASE = 'existing_contact_scalar' as const;

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

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── 2. Parámetros de la RPC ────────────────────────────────────────

export interface MergeCandidateIntoExistingContactRequest {
  readonly candidateId: string;
  readonly contactId: string;
  readonly accountId: string;
  /** El `CandidateReviewPatch` del veredicto duplicado, sin tocar. */
  readonly reviewPatch: Record<string, unknown>;
  readonly scalarFallback: CandidateScalarFallback | null;
  readonly incumbentBootstrap: IncumbentContactBootstrap | null;
  readonly actorId: string;
  readonly nowIso: string;
}

/**
 * Parámetros de la migración 117, con los nombres exactos de sus argumentos. Un solo sitio los
 * nombra, así que un cambio de firma rompe la compilación en vez de degradar silenciosamente a
 * una llamada que PostgREST no resuelve.
 */
export function buildMergeCandidateIntoExistingContactParams(
  request: MergeCandidateIntoExistingContactRequest,
): Record<string, unknown> {
  return {
    p_candidate_id: request.candidateId,
    p_contact_id: request.contactId,
    p_account_id: request.accountId,
    p_review_patch: request.reviewPatch,
    p_scalar_fallback: request.scalarFallback,
    p_incumbent_bootstrap: request.incumbentBootstrap,
    p_actor_id: request.actorId,
    p_now: request.nowIso,
  };
}

// ── 3. Sobre de respuesta ──────────────────────────────────────────

export type MergeCandidateStatus =
  | 'merged'
  | 'already_merged'
  | 'candidate_not_found'
  | 'candidate_not_mergeable'
  | 'contact_not_found'
  | 'contact_not_mergeable'
  | 'contact_mismatch'
  | 'person_suppressed'
  | 'invalid_input';

export type ScalarProjectionOutcome = 'projected' | 'incumbent_preserved';

export type IncumbentBootstrapOutcome =
  | 'promoted'
  | 'unrepresentable'
  | 'collection_present'
  | 'stale'
  | 'absent';

export type MergeScalarFallbackOutcome = 'promoted' | 'unrepresentable' | 'absent';

export interface MergeCandidateIntoExistingContactOutcome {
  readonly status: MergeCandidateStatus;
  readonly detail: string | null;
  readonly candidateId: string | null;
  readonly contactId: string | null;
  readonly contactCreated: boolean;
  readonly phonesSeen: number;
  readonly phonesInserted: number;
  readonly phonesReused: number;
  readonly phonesSkippedSuppressed: number;
  readonly sourcesInserted: number;
  readonly sourcesReused: number;
  /** SHA-256 por diseño de la 114. NUNCA el número. */
  readonly primaryDedupeKey: string | null;
  /** `true` cuando el contacto YA tenía principal vivo y el merge no lo tocó. */
  readonly primaryPreserved: boolean;
  readonly scalarProjection: ScalarProjectionOutcome;
  readonly scalarFallback: MergeScalarFallbackOutcome;
  readonly incumbentBootstrap: IncumbentBootstrapOutcome;
  readonly candidateTerminal: boolean;
}

const MERGE_STATUSES: readonly MergeCandidateStatus[] = [
  'merged',
  'already_merged',
  'candidate_not_found',
  'candidate_not_mergeable',
  'contact_not_found',
  'contact_not_mergeable',
  'contact_mismatch',
  'person_suppressed',
  'invalid_input',
];

const SCALAR_PROJECTIONS: readonly ScalarProjectionOutcome[] = [
  'projected',
  'incumbent_preserved',
];

const INCUMBENT_OUTCOMES: readonly IncumbentBootstrapOutcome[] = [
  'promoted',
  'unrepresentable',
  'collection_present',
  'stale',
  'absent',
];

const SCALAR_FALLBACK_OUTCOMES: readonly MergeScalarFallbackOutcome[] = [
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

function asMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Parsea el sobre SIN confiar en él. Un estado desconocido no se propaga como éxito: LANZA. Un
 * sobre con forma inesperada tras un COMMIT es exactamente el caso en el que adivinar produce un
 * «fusionado» que nadie escribió.
 */
export function parseMergeCandidateEnvelope(
  data: unknown,
): MergeCandidateIntoExistingContactOutcome {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('merge_contact_candidate_into_existing_contact: envelope is not an object');
  }
  const row = data as Record<string, unknown>;
  const status = row.status;
  if (typeof status !== 'string' || !MERGE_STATUSES.includes(status as MergeCandidateStatus)) {
    throw new Error('merge_contact_candidate_into_existing_contact: unknown envelope status');
  }

  return {
    status: status as MergeCandidateStatus,
    detail: asText(row.detail),
    candidateId: asText(row.candidate_id),
    contactId: asText(row.contact_id),
    contactCreated: row.contact_created === true,
    phonesSeen: asCount(row.phones_seen),
    phonesInserted: asCount(row.phones_inserted),
    phonesReused: asCount(row.phones_reused),
    phonesSkippedSuppressed: asCount(row.phones_skipped_suppressed),
    sourcesInserted: asCount(row.sources_inserted),
    sourcesReused: asCount(row.sources_reused),
    primaryDedupeKey: asText(row.primary_dedupe_key),
    primaryPreserved: row.primary_preserved === true,
    scalarProjection: asMember(row.scalar_projection, SCALAR_PROJECTIONS, 'incumbent_preserved'),
    scalarFallback: asMember(row.scalar_fallback, SCALAR_FALLBACK_OUTCOMES, 'absent'),
    incumbentBootstrap: asMember(row.incumbent_bootstrap, INCUMBENT_OUTCOMES, 'absent'),
    candidateTerminal: row.candidate_terminal === true,
  };
}
