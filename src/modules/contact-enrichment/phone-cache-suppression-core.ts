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
//                                official contacts that were CREATED/PROMOTED
//                                from one of those candidates (provenance proven
//                                by the contact's own metadata) and whose phone
//                                actually came from an Apollo reveal/cache hit.
//
// ── Why erasing a contact needs CREATED/PROMOTED provenance (FIX 1) ────────
// `contact_enrichment_candidates.matched_contacts_id` is NOT a proof of
// provenance. `candidate-review-core.ts` writes it on TWO different paths:
//   * approval  → the contact was CREATED from this candidate; the insert stamps
//                 `contacts.metadata.source_candidate_id = candidate.id`
//                 (`buildContactTraceMetadata`), and
//   * duplicate → the contact is a PRE-EXISTING one matched by email, linkedin
//                 or, as a last resort, by NAME. On this path only the CANDIDATE
//                 row is updated: the contact is never written, so it never gets
//                 a `source_candidate_id` pointing back.
// v1 therefore requires CREATED/PROMOTED provenance and nothing weaker:
//
//     contacts.metadata.source_candidate_id === candidate.id
//   AND contacts.account_id === the suppressed account
//   AND contacts.phone_source ∈ (apollo_reveal, apollo_cache)
//
// A duplicate match — even an "exact" one by email or linkedin — is NOT accepted
// as sufficient in v1. It identifies the same *person* with reasonable confidence,
// but it does not prove that THIS candidate is what put the phone in THAT contact
// row; the number may predate the reveal, come from another provider, or belong to
// a row curated by a human. Deleting on that basis destroys third-party data on an
// inference, which is the opposite of what a privacy operation should do. Weak
// links are surfaced by the counts (nothing erased) rather than acted upon.
// `matched_contacts_id` and `review.created_contact_id` are still used, but ONLY
// to FIND candidate contact rows — never to authorize the delete. No fuzzy
// matching on phone/email/name is used or allowed anywhere.
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
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  /**
   * `enrichment_metadata.review.created_contact_id`. SOLO para DESCUBRIR filas de
   * `contacts`: nunca autoriza por sí mismo el borrado (FIX 1).
   */
  createdContactId: string | null;
  /**
   * FK `matched_contacts_id`. SOLO para DESCUBRIR filas de `contacts`: apunta
   * tanto a un contacto creado desde el candidato como a un duplicado
   * preexistente emparejado por email/linkedin/NOMBRE, así que nunca autoriza
   * por sí mismo el borrado (FIX 1).
   */
  matchedContactId: string | null;
}

export interface SuppressibleContact {
  id: string;
  accountId: string | null;
  /**
   * candidate id de `contacts.metadata.source_candidate_id`. ÚNICA prueba de
   * procedencia aceptada en v1: solo la escribe el INSERT del contacto creado
   * desde el candidato (`buildContactTraceMetadata`).
   */
  sourceCandidateId: string | null;
  /** `contacts.phone_source`. Solo apollo_reveal / apollo_cache son borrables. */
  phoneSource: string | null;
}

// ── Fuerza del vínculo candidato → contacto (FIX 1) ────────────

export type CandidateContactLinkStrength =
  /**
   * El contacto fue CREADO/PROMOVIDO desde el candidato suprimido y él mismo lo
   * acredita (`metadata.source_candidate_id`). Único nivel que autoriza borrar.
   */
  | 'provenance_proven'
  /**
   * Todo lo demás: duplicado (exacto o posible, por email, linkedin o nombre),
   * FK sin respaldo en la metadata del contacto, o sin evidencia alguna. NUNCA
   * se borra. En v1 no existe un nivel intermedio "erase-safe": un duplicado
   * identifica a la persona, pero no demuestra que ESTE candidato pusiera el
   * teléfono en ESA fila.
   */
  | 'weak';

/**
 * Clasifica el vínculo candidato → contacto con la regla estricta de v1: el
 * contacto solo es borrable si ÉL MISMO acredita haber nacido de un candidato del
 * conjunto suprimido, vía `contacts.metadata.source_candidate_id`.
 *
 * Deliberadamente NO recibe la evidencia de revisión del candidato
 * (`duplicate_status` / `matched_by` / `created_contact_id`): ninguna de ellas
 * demuestra procedencia del teléfono, y aceptarlas fue el riesgo residual que
 * este endurecimiento cierra. Un match por NOMBRE ("José Pérez" vs "Jose Perez")
 * y un duplicado exacto por email quedan igualados en `weak`, porque en ambos
 * casos el contacto es una fila preexistente que este candidato nunca escribió.
 */
export function resolveContactErasureProvenance(args: {
  contact: SuppressibleContact;
  /** Ids de los candidatos suprimidos YA acotados a la cuenta de la supresión. */
  suppressedCandidateIds: ReadonlySet<string>;
}): CandidateContactLinkStrength {
  const sourceCandidateId = cleanText(args.contact.sourceCandidateId);
  if (!sourceCandidateId) return 'weak';
  return args.suppressedCandidateIds.has(sourceCandidateId)
    ? 'provenance_proven'
    : 'weak';
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
 * contactos de la MISMA cuenta, y los contactos SOLO cuando ellos mismos
 * acreditan haber sido creados/promovidos desde uno de esos candidatos
 * (`metadata.source_candidate_id`) Y su teléfono proviene de un reveal/hit
 * Apollo — nunca se borra "por si acaso" ni por parecido de identidad (FIX 1).
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

  const contactPatches: PhoneCacheSuppressionPlan['contactPatches'] = [];
  const seenContacts = new Set<string>();
  for (const contact of context.contacts) {
    if (seenContacts.has(contact.id)) continue;
    // Alcance de cuenta simétrico: se comprueba SIEMPRE, venga el contacto del
    // FK o de la metadata (FIX M2/M3).
    if (cleanText(contact.accountId) !== accountId) continue;
    // FIX M1: nunca se borra un teléfono manual o curado.
    if (!isSuppressibleContactPhoneSource(contact.phoneSource)) continue;

    // FIX 1: procedencia CREADO/PROMOVIDO obligatoria. El FK del candidato sirvió
    // para encontrar esta fila; solo su propia metadata autoriza borrarla.
    const strength = resolveContactErasureProvenance({
      contact,
      suppressedCandidateIds: candidateIds,
    });
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
