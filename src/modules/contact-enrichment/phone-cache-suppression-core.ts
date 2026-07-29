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
//   2. contact_enrichment_candidates → phone = NULL and the phone block removed
//                                from enrichment_metadata, for every candidate
//                                carrying that apollo_person_id in that account.
//   3. contacts                → phone / mobile_phone / phone_type /
//                                phone_source / phone_raw_type nulled, for the
//                                official contacts safely linked to those
//                                candidates.
//
// The contact link is DETERMINISTIC (verified before this milestone was built):
//   * contact_enrichment_candidates.matched_contacts_id → contacts.id (FK), and
//   * contacts.metadata->>'source_candidate_id' → the candidate that produced it
//     (written on approval by buildContactTraceMetadata).
// Both are scoped by account_id. No fuzzy matching on phone/email/name is used
// or allowed: a phone is only erased where the provenance is provable.
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

// ── Entrada ────────────────────────────────────────────────────

export interface PhoneCacheSuppressionInput {
  /** Apollo person id a suprimir. Se revalida (nunca un id Lusha `v1.*`). */
  providerPersonId: string;
  /** Cuenta afectada. Obligatoria: la supresión es siempre scoped por cuenta. */
  accountId: string;
  /** País opcional para acotar aún más. ISO-2; cualquier otra cosa se ignora. */
  countryCode?: string | null;
  /** Motivo mecánico y corto (p.ej. 'dsar_request'). NUNCA texto con PII. */
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
  suppression_reason: string;
  suppressed_by: string;
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
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  /** Contacto oficial creado/emparejado desde este candidato (FK), si lo hay. */
  matchedContactId: string | null;
}

export interface SuppressibleContact {
  id: string;
  accountId: string | null;
  /** candidate id de `contacts.metadata.source_candidate_id`, si existe. */
  sourceCandidateId: string | null;
}

// ── Plan de supresión (resultado puro) ─────────────────────────

export type PhoneCacheSuppressionRejection =
  | 'unauthorized_role'
  | 'invalid_person_id'
  | 'missing_account'
  | 'missing_reason';

export interface PhoneCacheSuppressionPlan {
  providerPersonId: string;
  accountId: string;
  countryCode: string | null;
  cacheEntryPatch: PhoneCacheEntrySuppressionPatch;
  candidatePatches: Array<{ candidateId: string; patch: CandidatePhoneSuppressionPatch }>;
  contactPatches: Array<{ contactId: string; patch: ContactPhoneSuppressionPatch }>;
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

/**
 * Construye el plan de supresión completo. Fail-closed: rol no autorizado, id
 * inválido, cuenta ausente o motivo vacío ⇒ rechazo SIN plan (nada se borra a
 * medias). Solo se incluyen candidatos/contactos de la MISMA cuenta y con enlace
 * de procedencia probable — nunca se borra "por si acaso".
 */
export function buildPhoneCacheSuppressionPlan(
  input: PhoneCacheSuppressionInput,
  context: {
    nowIso: string;
    candidates: readonly SuppressibleCandidate[];
    contacts: readonly SuppressibleContact[];
  },
): PhoneCacheSuppressionPlanResult {
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

  const actorUserId = cleanText(input.actorUserId) ?? '';

  // Solo candidatos de la misma cuenta (o sin cuenta resuelta pero enlazados por
  // el person id, que el store ya filtró). Cross-account nunca se toca.
  const scopedCandidates = context.candidates.filter(
    (c) => c.accountId === null || c.accountId === accountId,
  );
  const candidateIds = new Set(scopedCandidates.map((c) => c.id));

  const candidatePatches = scopedCandidates.map((candidate) => ({
    candidateId: candidate.id,
    patch: {
      phone: null,
      enrichment_metadata: stripPhoneFromEnrichmentMetadata(
        candidate.enrichmentMetadata,
      ),
      phone_reveal_error_code: null,
    } satisfies CandidatePhoneSuppressionPatch,
  }));

  // Contactos oficiales: solo los enlazados de forma PROBABLE al candidato
  // (FK matched_contacts_id o metadata.source_candidate_id) y en la misma cuenta.
  const linkedContactIds = new Set<string>();
  for (const candidate of scopedCandidates) {
    const matched = cleanText(candidate.matchedContactId);
    if (matched) linkedContactIds.add(matched);
  }
  for (const contact of context.contacts) {
    if (contact.accountId !== accountId) continue;
    const sourceCandidateId = cleanText(contact.sourceCandidateId);
    if (sourceCandidateId && candidateIds.has(sourceCandidateId)) {
      linkedContactIds.add(contact.id);
    }
  }

  const contactPatches = [...linkedContactIds].map((contactId) => ({
    contactId,
    patch: {
      phone: null,
      mobile_phone: null,
      phone_type: null,
      phone_source: null,
      phone_raw_type: null,
    } satisfies ContactPhoneSuppressionPatch,
  }));

  return {
    ok: true,
    plan: {
      providerPersonId,
      accountId,
      countryCode: normalizePhoneCacheCountryCode(input.countryCode),
      cacheEntryPatch: {
        normalized_phone: null,
        phone_type: null,
        suppressed_at: context.nowIso,
        suppression_reason: reason,
        suppressed_by: actorUserId,
      },
      candidatePatches,
      contactPatches,
    },
  };
}

// ── Contrato de la acción de supresión (SIN PII) ───────────────
// Vive en el core (y no en el archivo 'use server') porque un módulo
// 'use server' solo puede exportar funciones async.

export interface SuppressPhoneCacheEntryInput {
  /** Apollo person id (24 hex). Se revalida en el plan. */
  providerPersonId: string;
  accountId: string;
  countryCode?: string | null;
  /** Motivo mecánico y corto (p.ej. 'dsar_request'). Nunca texto con PII. */
  reason: string;
}

/** Resultado de la supresión: solo conteos y el motivo de rechazo. Sin PII. */
export interface SuppressPhoneCacheEntryResult {
  ok: boolean;
  rejection: PhoneCacheSuppressionRejection | null;
  cacheEntriesSuppressed: number;
  candidatesCleared: number;
  contactsCleared: number;
}

// ── Auditoría de la supresión (SIN PII) ────────────────────────

/**
 * Registro de auditoría de la supresión. Deliberadamente NO contiene teléfono,
 * email, nombre ni linkedin: solo el hash del person id, la cuenta, el motivo
 * mecánico y los conteos de filas afectadas.
 */
export interface PhoneCacheSuppressionAuditEntry {
  action: typeof PHONE_CACHE_SUPPRESSION_AUDIT_ACTION;
  provider: typeof PHONE_CACHE_PROVIDER;
  actorUserId: string;
  metadata: {
    account_id: string;
    provider_person_id_hash: string;
    country_code: string | null;
    reason: string;
    cache_entries_suppressed: number;
    candidates_cleared: number;
    contacts_cleared: number;
    tombstone: true;
    hard_delete: true;
  };
}

export function buildPhoneCacheSuppressionAudit(args: {
  plan: PhoneCacheSuppressionPlan;
  providerPersonIdHash: string;
  actorUserId: string;
  reason: string;
  cacheEntriesSuppressed: number;
}): PhoneCacheSuppressionAuditEntry {
  return {
    action: PHONE_CACHE_SUPPRESSION_AUDIT_ACTION,
    provider: PHONE_CACHE_PROVIDER,
    actorUserId: args.actorUserId,
    metadata: {
      account_id: args.plan.accountId,
      provider_person_id_hash: args.providerPersonIdHash,
      country_code: args.plan.countryCode,
      reason: args.reason,
      cache_entries_suppressed: args.cacheEntriesSuppressed,
      candidates_cleared: args.plan.candidatePatches.length,
      contacts_cleared: args.plan.contactPatches.length,
      tombstone: true,
      hard_delete: true,
    },
  };
}
