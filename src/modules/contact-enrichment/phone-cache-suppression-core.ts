// Agente 2A — Apollo Phone Cache: SUPPRESSION core (APOLLO-PHONE-CACHE-1b)
//
// PURE, dependency-injected suppression (DSAR / "borra mi teléfono") for a
// cached Apollo phone. This is the counterpart of the cache: the policy GO was
// granted on the explicit condition that a cached number can be erased
// EVERYWHERE it landed, not just in the cache.
//
// Approved effect — HARD DELETE + TOMBSTONE, in three places:
//   1. phone_reveal_cache      → normalized_phone / phone_type = NULL,
//                                suppressed_at / reason / by set (tombstone).
//                                If NO row exists yet, a phone-free tombstone is
//                                INSERTED: a DSAR must block future hits and
//                                future automatic reveals even on an empty cache.
//   2. contact_enrichment_candidates → phone = NULL and the phone block removed
//                                from enrichment_metadata, for every candidate
//                                carrying that apollo_person_id in that account.
//   3. contacts                → phone / mobile_phone / phone_type /
//                                phone_source / phone_raw_type nulled, ONLY for
//                                official contacts whose link to those candidates
//                                is of PROVABLE provenance and whose phone
//                                actually came from an Apollo reveal/cache hit.
//
// ── Why the contact link needs a strength check (FIX B1) ───────────────────
// `contact_enrichment_candidates.matched_contacts_id` is NOT a proof of
// provenance on its own. `candidate-review-core.ts` writes it on TWO different
// paths:
//   * approval  → the contact was CREATED from this candidate
//                 (status='approved', review.created_contact_id === the FK), and
//   * duplicate → the contact is a PRE-EXISTING one matched by email, linkedin
//                 or, as a last resort, by NAME (`matchedBy: 'name'` ⇒
//                 duplicate_status='possible_duplicate').
// Erasing on a name-only match would delete a DIFFERENT person's phone
// ("José Pérez" vs "Jose Perez"). So the FK is only honoured when it is backed by
// strong evidence:
//   * `provenance_proven`  — the contact was created from this candidate, or the
//                            contact itself carries metadata.source_candidate_id
//                            pointing back at it; or
//   * `strong_duplicate`   — duplicate_status='exact_duplicate' AND the match was
//                            by email or linkedin (never by name).
// Anything else is `weak` and is NEVER erased. No fuzzy matching on
// phone/email/name is used or allowed anywhere.
//
// On top of the link strength, the phone is only erased when its provenance in
// the contact is an Apollo reveal or an Apollo cache hit (FIX M1): a manually
// typed or curated number is never touched by this operation.
//
// The tombstone must survive: it is what blocks a FUTURE cache hit and a FUTURE
// automatic reveal for that person/account. It never contains a phone.
//
// Safety: pure. No Supabase, no network, no clock, no logging. It only decides
// WHICH rows change and HOW. Audit shapes built here are PII-free by
// construction (counts and opaque ids only — no phone/email/name/linkedin).
// Single person/account per call: there is no bulk suppression entry point.

import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import {
  PHONE_CACHE_PROVIDER,
  PHONE_CACHE_REUSE_SCOPE,
  normalizePhoneCacheCountryCode,
} from './phone-cache-core';
import type { ContactCandidateEnrichmentMetadata } from './types';

// ── Roles autorizados ──────────────────────────────────────────

/**
 * Supresión es una operación de privacidad destructiva: solo admin. NO hereda
 * los roles del reveal (commercial_manager puede revelar, no puede borrar).
 */
export const PHONE_CACHE_SUPPRESSION_AUTHORIZED_ROLE_KEYS: readonly string[] = [
  'admin',
];

/** action_type del registro de auditoría de la supresión (sin PII). */
export const PHONE_CACHE_SUPPRESSION_AUDIT_ACTION =
  'phone_cache_suppressed' as const;

/** Tabla de auditoría durable de la supresión (migración 099). */
export const PHONE_CACHE_SUPPRESSION_AUDIT_TABLE =
  'phone_reveal_suppression_audit' as const;

// ── Motivo: allowlist cerrada, nunca texto libre (FIX M5) ──────

/**
 * Vocabulario CERRADO de motivos de supresión. Es una allowlist porque un campo
 * de texto libre acabaría conteniendo PII (nombre, teléfono, email del titular)
 * dentro de un registro de privacidad que existe justamente para no tenerla.
 * El CHECK equivalente vive en la migración 099.
 */
export const PHONE_CACHE_SUPPRESSION_REASON_CODES = [
  'dsar_erasure_request',
  'do_not_contact_request',
  'legal_privacy_request',
  'admin_privacy_correction',
  'test_synthetic',
] as const;

export type PhoneCacheSuppressionReasonCode =
  (typeof PHONE_CACHE_SUPPRESSION_REASON_CODES)[number];

export function isPhoneCacheSuppressionReasonCode(
  value: unknown,
): value is PhoneCacheSuppressionReasonCode {
  return (
    typeof value === 'string' &&
    (PHONE_CACHE_SUPPRESSION_REASON_CODES as readonly string[]).includes(value)
  );
}

// ── Procedencias borrables en contacts (FIX M1) ────────────────

/**
 * Solo se borra el teléfono de un contacto oficial cuando su procedencia es un
 * reveal Apollo o un hit de la caché Apollo. Un número `manual`, `apollo_search`,
 * `provider_payload`, `lusha_reveal`, `unknown` o de cualquier fuente futura no
 * aprobada NO lo escribió este camino y por tanto no se toca: borrarlo sería
 * destruir dato curado ajeno a la supresión.
 */
export const SUPPRESSIBLE_CONTACT_PHONE_SOURCES: readonly string[] = [
  'apollo_reveal',
  'apollo_cache',
];

export function isSuppressibleContactPhoneSource(
  value: string | null | undefined,
): boolean {
  return (
    typeof value === 'string' &&
    SUPPRESSIBLE_CONTACT_PHONE_SOURCES.includes(value.trim())
  );
}

// ── Entrada ────────────────────────────────────────────────────

export interface PhoneCacheSuppressionInput {
  /** Apollo person id a suprimir. Se revalida (nunca un id Lusha `v1.*`). */
  providerPersonId: string;
  /** Cuenta afectada. Obligatoria: la supresión es siempre scoped por cuenta. */
  accountId: string;
  /**
   * País ISO-2. OBLIGATORIO (FIX B2): el tombstone puede tener que INSERTARSE
   * cuando no existe fila de caché, y `country_code` es NOT NULL en la tabla.
   * Sin país no hay tombstone posible ⇒ se rechaza de forma explícita.
   */
  countryCode: string | null;
  /** Motivo mecánico de la allowlist. NUNCA texto libre ni con PII. */
  reason: string;
  /** Actor que ejecuta la supresión. Id opaco. */
  actorUserId: string;
  /** Role key del actor (gate re-verificado aquí, defensa en profundidad). */
  actorRoleKey: string | null;
}

// ── Patches (describen los UPDATE; no los ejecutan) ────────────

/** Tombstone de la fila de caché: borra el teléfono y marca la supresión. */
export interface PhoneCacheEntrySuppressionPatch {
  normalized_phone: null;
  phone_type: null;
  suppressed_at: string;
  suppression_reason: PhoneCacheSuppressionReasonCode;
  suppressed_by: string | null;
}

/**
 * Fila de tombstone a INSERTAR cuando no existe entrada de caché previa
 * (FIX B2). Nace sin teléfono y ya expirada, de modo que ni siquiera un borrado
 * accidental de `suppressed_at` la volvería servible.
 */
export interface PhoneCacheTombstoneInsertRow {
  provider: typeof PHONE_CACHE_PROVIDER;
  provider_person_id: string;
  account_id: string;
  country_code: string;
  normalized_phone: null;
  phone_type: null;
  original_revealed_at: string;
  expires_at: string;
  suppressed_at: string;
  suppression_reason: PhoneCacheSuppressionReasonCode;
  suppressed_by: string | null;
}

/** Borrado del teléfono en un candidato (hard delete del valor). */
export interface CandidatePhoneSuppressionPatch {
  phone: null;
  enrichment_metadata: ContactCandidateEnrichmentMetadata;
  /**
   * La auditoría del reveal se conserva (status/proveedor/base) porque NO es
   * PII y documenta que hubo un tratamiento; solo desaparece el dato personal.
   */
  phone_reveal_error_code: null;
}

/** Borrado del teléfono en un contacto oficial (hard delete del valor). */
export interface ContactPhoneSuppressionPatch {
  phone: null;
  mobile_phone: null;
  phone_type: null;
  phone_source: null;
  phone_raw_type: null;
}

// ── Proyecciones mínimas de entrada ────────────────────────────

export interface SuppressibleCandidate {
  id: string;
  accountId: string | null;
  /** Run del candidato. Se usa para acotar el UPDATE (FIX M2/M3). */
  enrichmentRunId: string | null;
  /** `status` del candidato ('approved' | 'duplicate' | 'pending_review' | …). */
  status: string | null;
  /** `duplicate_status` ('exact_duplicate' | 'possible_duplicate' | …). */
  duplicateStatus: string | null;
  /** `enrichment_metadata.review.matched_by`: 'email' | 'linkedin' | 'name'. */
  matchedBy: string | null;
  /** `enrichment_metadata.review.created_contact_id`: contacto CREADO de aquí. */
  createdContactId: string | null;
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  /** Contacto oficial creado/emparejado desde este candidato (FK), si lo hay. */
  matchedContactId: string | null;
}

export interface SuppressibleContact {
  id: string;
  accountId: string | null;
  /** candidate id de `contacts.metadata.source_candidate_id`, si existe. */
  sourceCandidateId: string | null;
  /** `contacts.phone_source`. Solo apollo_reveal / apollo_cache son borrables. */
  phoneSource: string | null;
}

// ── Fuerza del vínculo candidato → contacto (FIX B1) ───────────

export type CandidateContactLinkStrength =
  /** El contacto se creó desde este candidato: procedencia demostrada. */
  | 'provenance_proven'
  /** Duplicado exacto por email o linkedin: identidad fuerte. */
  | 'strong_duplicate'
  /** Todo lo demás: name-only, possible_duplicate, sin evidencia ⇒ NO se borra. */
  | 'weak';

/**
 * Clasifica el vínculo `matched_contacts_id` según la evidencia persistida. Solo
 * `provenance_proven` y `strong_duplicate` autorizan borrar el teléfono del
 * contacto. Un match por NOMBRE (o un `possible_duplicate`) es siempre `weak`:
 * "José Pérez" y "Jose Perez" pueden ser dos personas distintas y borrar el
 * teléfono de la equivocada sería, en sí mismo, un incidente de privacidad.
 */
export function resolveCandidateContactLinkStrength(
  candidate: SuppressibleCandidate,
): CandidateContactLinkStrength {
  const matched = cleanText(candidate.matchedContactId);
  if (!matched) return 'weak';

  // Nunca por nombre, nunca un duplicado meramente posible.
  const matchedBy = cleanText(candidate.matchedBy);
  if (matchedBy === 'name') return 'weak';
  if (cleanText(candidate.duplicateStatus) === 'possible_duplicate') return 'weak';

  // 1. El contacto se CREÓ desde este candidato (camino de aprobación).
  if (
    cleanText(candidate.status) === 'approved' &&
    cleanText(candidate.createdContactId) === matched
  ) {
    return 'provenance_proven';
  }

  // 2. Duplicado EXACTO con identificador fuerte (email o linkedin).
  if (
    cleanText(candidate.duplicateStatus) === 'exact_duplicate' &&
    (matchedBy === 'email' || matchedBy === 'linkedin')
  ) {
    return 'strong_duplicate';
  }

  return 'weak';
}

// ── Plan de supresión (resultado puro) ─────────────────────────

export type PhoneCacheSuppressionRejection =
  | 'unauthorized_role'
  | 'invalid_person_id'
  | 'missing_account'
  | 'missing_reason'
  | 'invalid_reason'
  | 'missing_country';

/**
 * Plan completo: el tombstone (que se escribe primero e independientemente) más
 * los borrados en candidatos y contactos.
 */
export interface PhoneCacheSuppressionPlan extends PhoneCacheTombstoneDecision {
  candidatePatches: Array<{
    candidateId: string;
    enrichmentRunId: string | null;
    patch: CandidatePhoneSuppressionPatch;
  }>;
  contactPatches: Array<{
    contactId: string;
    linkStrength: Exclude<CandidateContactLinkStrength, 'weak'>;
    patch: ContactPhoneSuppressionPatch;
  }>;
}

export type PhoneCacheSuppressionPlanResult =
  | { ok: true; plan: PhoneCacheSuppressionPlan }
  | { ok: false; rejection: PhoneCacheSuppressionRejection };

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Elimina el bloque `phone` de la metadata de enriquecimiento devolviendo un
 * objeto NUEVO (nunca muta el original). El resto de la metadata — relevancia,
 * completion, trazas de proveedor — se conserva intacto: solo desaparece el dato
 * personal.
 */
export function stripPhoneFromEnrichmentMetadata(
  metadata: ContactCandidateEnrichmentMetadata,
): ContactCandidateEnrichmentMetadata {
  const next: Record<string, unknown> = { ...(metadata ?? {}) };
  delete next.phone;
  return next as ContactCandidateEnrichmentMetadata;
}

// ── Decisión del TOMBSTONE (independiente de candidatos/contactos) ──

export interface PhoneCacheTombstoneDecision {
  providerPersonId: string;
  accountId: string;
  countryCode: string;
  reasonCode: PhoneCacheSuppressionReasonCode;
  actorUserId: string | null;
  cacheEntryPatch: PhoneCacheEntrySuppressionPatch;
  tombstoneInsertRow: PhoneCacheTombstoneInsertRow;
}

export type PhoneCacheTombstoneDecisionResult =
  | { ok: true; tombstone: PhoneCacheTombstoneDecision }
  | { ok: false; rejection: PhoneCacheSuppressionRejection };

/**
 * Valida la petición y construye SOLO lo que necesita el tombstone. Se separa a
 * propósito del plan completo: el tombstone es lo que bloquea hits y reveals
 * futuros, así que debe poder escribirse ANTES de leer candidatos o contactos —
 * y por tanto sin que un fallo de esas lecturas pueda impedirlo (FIX M4).
 */
export function buildPhoneCacheTombstoneDecision(
  input: PhoneCacheSuppressionInput,
  nowIso: string,
): PhoneCacheTombstoneDecisionResult {
  const roleKey = cleanText(input.actorRoleKey);
  if (!roleKey || !PHONE_CACHE_SUPPRESSION_AUTHORIZED_ROLE_KEYS.includes(roleKey)) {
    return { ok: false, rejection: 'unauthorized_role' };
  }

  const providerPersonId = normalizeApolloPersonId(input.providerPersonId);
  if (!providerPersonId) return { ok: false, rejection: 'invalid_person_id' };

  const accountId = cleanText(input.accountId);
  if (!accountId) return { ok: false, rejection: 'missing_account' };

  const reason = cleanText(input.reason);
  if (!reason) return { ok: false, rejection: 'missing_reason' };
  if (!isPhoneCacheSuppressionReasonCode(reason)) {
    return { ok: false, rejection: 'invalid_reason' };
  }

  // FIX B2: sin país ISO-2 no se puede crear el tombstone (country_code es
  // NOT NULL). Fallar explícitamente es más seguro que suprimir a medias.
  const countryCode = normalizePhoneCacheCountryCode(input.countryCode);
  if (!countryCode) return { ok: false, rejection: 'missing_country' };

  const actorUserId = cleanText(input.actorUserId);

  return {
    ok: true,
    tombstone: {
      providerPersonId,
      accountId,
      countryCode,
      reasonCode: reason,
      actorUserId,
      cacheEntryPatch: {
        normalized_phone: null,
        phone_type: null,
        suppressed_at: nowIso,
        suppression_reason: reason,
        suppressed_by: actorUserId,
      },
      tombstoneInsertRow: {
        provider: PHONE_CACHE_PROVIDER,
        provider_person_id: providerPersonId,
        account_id: accountId,
        country_code: countryCode,
        normalized_phone: null,
        phone_type: null,
        // Nace ya expirada: aunque alguien limpiara `suppressed_at`, la fila
        // seguiría siendo un miss y jamás serviría un teléfono.
        original_revealed_at: nowIso,
        expires_at: nowIso,
        suppressed_at: nowIso,
        suppression_reason: reason,
        suppressed_by: actorUserId,
      },
    },
  };
}

/**
 * Construye el plan de supresión completo. Fail-closed: rol no autorizado, id
 * inválido, cuenta ausente, país no resoluble o motivo fuera de la allowlist ⇒
 * rechazo SIN plan (nada se borra a medias). Solo se incluyen candidatos y
 * contactos de la MISMA cuenta, y los contactos solo cuando el vínculo es de
 * procedencia probada (o duplicado exacto por email/linkedin) Y el teléfono
 * proviene de un reveal/hit Apollo — nunca se borra "por si acaso".
 */
export function buildPhoneCacheSuppressionPlan(
  input: PhoneCacheSuppressionInput,
  context: {
    nowIso: string;
    candidates: readonly SuppressibleCandidate[];
    contacts: readonly SuppressibleContact[];
  },
): PhoneCacheSuppressionPlanResult {
  const decided = buildPhoneCacheTombstoneDecision(input, context.nowIso);
  if (!decided.ok) return { ok: false, rejection: decided.rejection };
  const { tombstone } = decided;
  const accountId = tombstone.accountId;

  // FIX M2: solo candidatos cuya cuenta resuelve EXACTAMENTE a la cuenta
  // suprimida. Un candidato sin cuenta resoluble no se procesa (antes se
  // admitía `accountId === null`, lo que dejaba pasar filas sin alcance).
  const scopedCandidates = context.candidates.filter(
    (c) => cleanText(c.accountId) === accountId,
  );
  const candidateIds = new Set(scopedCandidates.map((c) => c.id));

  const candidatePatches = scopedCandidates.map((candidate) => ({
    candidateId: candidate.id,
    enrichmentRunId: cleanText(candidate.enrichmentRunId),
    patch: {
      phone: null,
      enrichment_metadata: stripPhoneFromEnrichmentMetadata(
        candidate.enrichmentMetadata,
      ),
      phone_reveal_error_code: null,
    } satisfies CandidatePhoneSuppressionPatch,
  }));

  // FIX B1: el FK `matched_contacts_id` solo cuenta cuando la evidencia es
  // fuerte. Se indexa por contacto la fuerza máxima observada.
  const fkLinkStrength = new Map<string, Exclude<CandidateContactLinkStrength, 'weak'>>();
  for (const candidate of scopedCandidates) {
    const matched = cleanText(candidate.matchedContactId);
    if (!matched) continue;
    const strength = resolveCandidateContactLinkStrength(candidate);
    if (strength === 'weak') continue;
    if (strength === 'provenance_proven' || !fkLinkStrength.has(matched)) {
      fkLinkStrength.set(matched, strength);
    }
  }

  const contactPatches: PhoneCacheSuppressionPlan['contactPatches'] = [];
  const seenContacts = new Set<string>();
  for (const contact of context.contacts) {
    if (seenContacts.has(contact.id)) continue;
    // Alcance de cuenta simétrico: se comprueba SIEMPRE, venga el contacto del
    // FK o de la metadata (FIX M2/M3).
    if (cleanText(contact.accountId) !== accountId) continue;
    // FIX M1: nunca se borra un teléfono manual o curado.
    if (!isSuppressibleContactPhoneSource(contact.phoneSource)) continue;

    const sourceCandidateId = cleanText(contact.sourceCandidateId);
    const provenLinked =
      sourceCandidateId !== null && candidateIds.has(sourceCandidateId);
    const strength: CandidateContactLinkStrength = provenLinked
      ? 'provenance_proven'
      : (fkLinkStrength.get(contact.id) ?? 'weak');
    if (strength === 'weak') continue;

    seenContacts.add(contact.id);
    contactPatches.push({
      contactId: contact.id,
      linkStrength: strength,
      patch: {
        phone: null,
        mobile_phone: null,
        phone_type: null,
        phone_source: null,
        phone_raw_type: null,
      } satisfies ContactPhoneSuppressionPatch,
    });
  }

  return { ok: true, plan: { ...tombstone, candidatePatches, contactPatches } };
}

// ── Contrato de la acción de supresión (SIN PII) ───────────────
// Vive en el core (y no en el archivo 'use server') porque un módulo
// 'use server' solo puede exportar funciones async.

export interface SuppressPhoneCacheEntryInput {
  /** Apollo person id (24 hex). Se revalida en el plan. */
  providerPersonId: string;
  accountId: string;
  /** País ISO-2. Obligatorio: sin él no se puede crear el tombstone. */
  countryCode: string | null;
  /** Motivo de la allowlist `PHONE_CACHE_SUPPRESSION_REASON_CODES`. */
  reason: string;
}

/** Fallos posteriores al plan (los datos ya cambiaron o no se pudo escribir). */
export type PhoneCacheSuppressionFailureCode =
  | 'cache_tombstone_failed'
  | 'candidate_clear_failed'
  | 'contact_clear_failed'
  | 'audit_write_failed';

/** Resultado de la supresión: solo conteos y códigos. Sin PII. */
export interface SuppressPhoneCacheEntryResult {
  ok: boolean;
  rejection: PhoneCacheSuppressionRejection | null;
  /** Código mecánico cuando la supresión arrancó pero no pudo completarse. */
  failureCode: PhoneCacheSuppressionFailureCode | null;
  cacheEntriesSuppressed: number;
  /** true cuando NO existía fila y se insertó un tombstone nuevo (FIX B2). */
  tombstoneCreated: boolean;
  candidatesCleared: number;
  contactsCleared: number;
  /** true solo cuando la auditoría durable quedó escrita (FIX H3). */
  auditPersisted: boolean;
}

// ── Auditoría durable de la supresión (SIN PII) ─────────────────

/**
 * Fila de `phone_reveal_suppression_audit`. Deliberadamente NO contiene
 * teléfono, email, nombre ni linkedin, y el person id viaja SOLO hasheado: es un
 * registro de privacidad, así que no puede convertirse en una copia de los datos
 * que acaba de borrar. Los conteos son los de filas REALMENTE actualizadas, no
 * los del plan (FIX M2).
 */
export interface PhoneCacheSuppressionAuditRow {
  provider: typeof PHONE_CACHE_PROVIDER;
  provider_person_id_hash: string;
  account_id: string;
  country_code: string | null;
  actor_user_id: string | null;
  reason_code: PhoneCacheSuppressionReasonCode;
  candidates_cleared: number;
  contacts_cleared: number;
  cache_rows_suppressed: number;
  tombstone_created: boolean;
  metadata: {
    action: typeof PHONE_CACHE_SUPPRESSION_AUDIT_ACTION;
    hard_delete: true;
    tombstone: true;
    reuse_scope: typeof PHONE_CACHE_REUSE_SCOPE;
    contact_link_strengths: string[];
  };
}

export function buildPhoneCacheSuppressionAuditRow(args: {
  plan: PhoneCacheSuppressionPlan;
  providerPersonIdHash: string;
  /** Filas de caché realmente marcadas con tombstone. */
  cacheRowsSuppressed: number;
  /** true si el tombstone se creó de cero (no existía entrada). */
  tombstoneCreated: boolean;
  /** Candidatos realmente actualizados. */
  candidatesCleared: number;
  /** Contactos realmente actualizados. */
  contactsCleared: number;
}): PhoneCacheSuppressionAuditRow {
  return {
    provider: PHONE_CACHE_PROVIDER,
    provider_person_id_hash: args.providerPersonIdHash,
    account_id: args.plan.accountId,
    country_code: args.plan.countryCode,
    actor_user_id: args.plan.actorUserId,
    reason_code: args.plan.reasonCode,
    candidates_cleared: args.candidatesCleared,
    contacts_cleared: args.contactsCleared,
    cache_rows_suppressed: args.cacheRowsSuppressed,
    tombstone_created: args.tombstoneCreated,
    metadata: {
      action: PHONE_CACHE_SUPPRESSION_AUDIT_ACTION,
      hard_delete: true,
      tombstone: true,
      reuse_scope: PHONE_CACHE_REUSE_SCOPE,
      // Solo etiquetas mecánicas de fuerza de vínculo — ningún id de contacto,
      // ningún dato personal.
      contact_link_strengths: [
        ...new Set(args.plan.contactPatches.map((c) => c.linkStrength)),
      ].sort(),
    },
  };
}
