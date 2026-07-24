// Agente 2A — Apollo Phone Reveal: Core (PHONE-3D.3)
//
// Pure, dependency-injected orchestration for the explicit, per-candidate Apollo
// phone reveal. This module owns ONLY validation + decision logic + the shape of
// the DB patch and the (PII-free) usage-log entry. It performs NO I/O directly:
// the flag value, the actor, the candidate load, the do-not-contact check, the
// Apollo call, the persistence write and the usage-log write are all injected as
// deps, so the whole contract is testable offline with no Supabase, no network
// and no real provider.
//
// Legal/product contract enforced here (never by migration 095, which only added
// the nullable audit columns):
//   * reveal is INDIVIDUAL per candidate — one candidateId, never an array
//   * human cost confirmation mandatory (up to 8 Apollo credits per candidate)
//   * phone_processing_basis mandatory; note required for other_approved_basis
//   * authorized roles only: Administrador (admin) / Manager comercial
//     (commercial_manager)
//   * Apollo only — no Lusha, no HubSpot, no auto-write, no auto-approve
//   * no phone / email / linkedin / name / raw payload in the usage-log metadata
//
// The `reveal_phone_number: true` flag lives ONLY in the PHONE-3D.1 helper
// (buildApolloPhoneRevealMatchParams); this core calls that helper and never
// writes the literal itself. Real reveal stays gated behind
// ENABLE_APOLLO_PHONE_REVEAL, which this milestone does NOT activate.

import type { MatchPersonParams } from '@/server/integrations/apollo-client';
import {
  buildApolloPhoneRevealMatchParams,
  type ApolloPhoneRevealInput,
} from '@/server/agents/contact-enrichment-toolkit/apollo-phone-reveal';
import {
  pickBestApolloPhone,
  type ApolloPhoneNumber,
  type ClassifiedPhone,
} from '@/server/agents/contact-enrichment-toolkit/phone-classification';
import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '@/lib/apollo-guardrails';
import type {
  ContactCandidateEnrichmentMetadata,
  ContactCandidatePhoneMetadata,
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
 * Proyección de solo lectura del candidato necesaria para el reveal. Incluye la
 * identidad para Apollo (source_contact_id / email / linkedin), el contexto de
 * empresa, la metadata de enriquecimiento (para preservar/mergear el teléfono) y
 * el estado de reveal previo (para bloquear re-reveal).
 */
export interface RevealCandidateRecord {
  id: string;
  accountId: string | null;
  sourceContactId: string | null;
  email: string | null;
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  existingPhone: string | null;
  enrichmentMetadata: ContactCandidateEnrichmentMetadata;
  phoneRevealStatus: string | null;
}

// ── Respuesta del reveal Apollo (inyectada) ────────────────────

/**
 * Resultado normalizado de la llamada de reveal a Apollo. El wrapper 'use server'
 * es el único que llama a `matchApolloPerson`; aquí solo recibimos la lista de
 * teléfonos ya devuelta o un código de error seguro (sin PII, sin payload crudo).
 */
export type ApolloPhoneRevealCallResult =
  | { ok: true; phoneNumbers: ReadonlyArray<ApolloPhoneNumber> }
  | { ok: false; errorCode: string };

// ── Patch de persistencia (describe el UPDATE, no lo ejecuta) ───

export interface RevealPersistencePatch {
  phone?: string | null;
  enrichment_metadata?: ContactCandidateEnrichmentMetadata;
  phone_reveal_status: 'revealed' | 'no_phone_found' | 'error';
  phone_revealed_at: string;
  phone_revealed_by: string;
  phone_reveal_provider: 'apollo';
  phone_reveal_cost_credits: number | null;
  phone_reveal_cost_usd: number | null;
  phone_reveal_error_code: string | null;
  phone_processing_basis: PhoneProcessingBasis;
  phone_processing_basis_note: string | null;
}

// ── Entrada del usage-log (SIN PII) ────────────────────────────

/**
 * Metadata permitida en provider_usage_logs. Deliberadamente NO contiene
 * teléfono, email, linkedin, nombre ni payload crudo del proveedor.
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
    phone_revealed: boolean;
    credits_used: number | null;
    cost_usd: number | null;
    processing_basis: PhoneProcessingBasis;
    error_code: string | null;
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
  /** Carga la proyección del candidato. Devuelve null si no existe. */
  loadCandidate: (candidateId: string) => Promise<RevealCandidateRecord | null>;
  /**
   * Indica si el candidato/contacto/cuenta está marcado do_not_contact. Cuando
   * no hay forma fiable de consultarlo, el wrapper devuelve false (no se puede
   * detectar). Si devuelve true, el reveal se bloquea antes de llamar a Apollo.
   */
  isDoNotContact: (candidate: RevealCandidateRecord) => Promise<boolean>;
  /** Ejecuta el reveal en Apollo (única llamada de red, en el wrapper). */
  revealViaApollo: (
    params: MatchPersonParams,
  ) => Promise<ApolloPhoneRevealCallResult>;
  /** Aplica el UPDATE de auditoría sobre el candidato (service role). */
  persist: (candidateId: string, patch: RevealPersistencePatch) => Promise<void>;
  /** Registra el uso/costo en provider_usage_logs (metadata sin PII). */
  logUsage: (entry: PhoneRevealUsageLogEntry) => Promise<void>;
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
  | 'candidate_account_invalid'
  | 'already_revealed'
  | 'do_not_contact'
  | 'insufficient_identity'
  | 'revealed'
  | 'no_phone_found'
  | 'error';

export interface RevealCandidatePhoneResult {
  ok: boolean;
  status: RevealCandidatePhoneStatus;
  /** true solo cuando Apollo devolvió un teléfono y se persistió. */
  phoneRevealed: boolean;
  /** Tipo normalizado del teléfono revelado (no es PII). null si no aplica. */
  phoneType: string | null;
  /** Código de error seguro (sin PII) cuando status = error. */
  errorCode: string | null;
}

// ── Helpers puros ──────────────────────────────────────────────

function fail(
  status: RevealCandidatePhoneStatus,
  errorCode: string | null = null,
): RevealCandidatePhoneResult {
  return { ok: false, status, phoneRevealed: false, phoneType: null, errorCode };
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

// ── Orquestación pura ──────────────────────────────────────────

/**
 * Ejecuta el reveal explícito de teléfono para UN candidato. Todas las
 * validaciones fail-closed corren ANTES de cualquier llamada a Apollo o
 * escritura en DB, en orden barato→caro. Con el flag apagado (default de
 * producción) retorna `disabled` sin tocar ninguna dep salvo la lectura del
 * propio flag.
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

  // 8. Debe pertenecer a una cuenta SellUp válida.
  if (!cleanText(candidate.accountId)) return fail('candidate_account_invalid');

  // 9. Bloquear re-reveal: ya revelado o ya tiene teléfono de apollo_reveal.
  if (
    candidate.phoneRevealStatus === 'revealed' ||
    existingPhoneSource(candidate.enrichmentMetadata) === 'apollo_reveal'
  ) {
    return fail('already_revealed');
  }

  // 10. do_not_contact bloquea el reveal (si hay forma de detectarlo).
  if (await deps.isDoNotContact(candidate)) return fail('do_not_contact');

  // 11. Identidad suficiente para Apollo (id / email / linkedin) — helper 3D.1.
  const identity: ApolloPhoneRevealInput = {
    sourceContactId: candidate.sourceContactId,
    email: candidate.email,
    linkedinUrl: candidate.linkedinUrl,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    organizationName: candidate.organizationName,
  };
  const built = buildApolloPhoneRevealMatchParams(identity);
  if (!built.ok) return fail('insufficient_identity');

  // 12. Llamada real a Apollo (única red, en el wrapper).
  const apollo = await deps.revealViaApollo(built.params);

  // 13a. Error Apollo → no borrar teléfono existente, código seguro sin PII.
  if (!apollo.ok) {
    const errorCode = cleanText(apollo.errorCode) ?? 'apollo_reveal_failed';
    const patch: RevealPersistencePatch = {
      phone_reveal_status: 'error',
      phone_revealed_at: deps.nowIso,
      phone_revealed_by: deps.actor.internalUserId,
      phone_reveal_provider: PHONE_REVEAL_PROVIDER,
      phone_reveal_cost_credits: null,
      phone_reveal_cost_usd: null,
      phone_reveal_error_code: errorCode,
      phone_processing_basis: basis,
      phone_processing_basis_note: note,
    };
    await deps.persist(candidateId, patch);
    await deps.logUsage(
      buildUsageLogEntry({
        candidate,
        actorId: deps.actor.internalUserId,
        revealStatus: 'error',
        phoneRevealed: false,
        credits: null,
        basis,
        errorCode,
      }),
    );
    return { ok: false, status: 'error', phoneRevealed: false, phoneType: null, errorCode };
  }

  // 13b. Éxito con teléfono → clasificar y marcar source apollo_reveal.
  const best = pickBestApolloPhone(apollo.phoneNumbers);
  if (best) {
    const revealedPhone: ClassifiedPhone = { ...best, source: 'apollo_reveal' };
    const phoneMetadata: ContactCandidatePhoneMetadata = {
      number: revealedPhone.number,
      type: revealedPhone.type,
      source: 'apollo_reveal',
      raw_type: revealedPhone.raw_type,
    };
    const patch: RevealPersistencePatch = {
      phone: revealedPhone.number,
      enrichment_metadata: {
        ...candidate.enrichmentMetadata,
        phone: phoneMetadata,
      },
      phone_reveal_status: 'revealed',
      phone_revealed_at: deps.nowIso,
      phone_revealed_by: deps.actor.internalUserId,
      phone_reveal_provider: PHONE_REVEAL_PROVIDER,
      phone_reveal_cost_credits: APOLLO_PHONE_REVEAL_CREDITS,
      phone_reveal_cost_usd: null,
      phone_reveal_error_code: null,
      phone_processing_basis: basis,
      phone_processing_basis_note: note,
    };
    await deps.persist(candidateId, patch);
    await deps.logUsage(
      buildUsageLogEntry({
        candidate,
        actorId: deps.actor.internalUserId,
        revealStatus: 'revealed',
        phoneRevealed: true,
        credits: APOLLO_PHONE_REVEAL_CREDITS,
        basis,
        errorCode: null,
      }),
    );
    return {
      ok: true,
      status: 'revealed',
      phoneRevealed: true,
      phoneType: revealedPhone.type,
      errorCode: null,
    };
  }

  // 13c. Éxito sin teléfono → no inventar dato, preservar el existente.
  const patch: RevealPersistencePatch = {
    phone_reveal_status: 'no_phone_found',
    phone_revealed_at: deps.nowIso,
    phone_revealed_by: deps.actor.internalUserId,
    phone_reveal_provider: PHONE_REVEAL_PROVIDER,
    phone_reveal_cost_credits: APOLLO_PHONE_REVEAL_CREDITS,
    phone_reveal_cost_usd: null,
    phone_reveal_error_code: null,
    phone_processing_basis: basis,
    phone_processing_basis_note: note,
  };
  await deps.persist(candidateId, patch);
  await deps.logUsage(
    buildUsageLogEntry({
      candidate,
      actorId: deps.actor.internalUserId,
      revealStatus: 'no_phone_found',
      phoneRevealed: false,
      credits: APOLLO_PHONE_REVEAL_CREDITS,
      basis,
      errorCode: null,
    }),
  );
  return {
    ok: true,
    status: 'no_phone_found',
    phoneRevealed: false,
    phoneType: null,
    errorCode: null,
  };
}

// ── Constructor del log de uso (sin PII) ───────────────────────

function buildUsageLogEntry(args: {
  candidate: RevealCandidateRecord;
  actorId: string;
  revealStatus: 'revealed' | 'no_phone_found' | 'error';
  phoneRevealed: boolean;
  credits: number | null;
  basis: PhoneProcessingBasis;
  errorCode: string | null;
}): PhoneRevealUsageLogEntry {
  return {
    operationKey: PHONE_REVEAL_OPERATION_KEY,
    provider: 'apollo',
    triggeredBy: args.actorId,
    creditsUsed: args.credits,
    costUsd: null,
    status: args.revealStatus === 'error' ? 'error' : 'success',
    errorCode: args.errorCode,
    metadata: {
      candidate_id: args.candidate.id,
      account_id: args.candidate.accountId,
      provider: 'apollo',
      reveal_status: args.revealStatus,
      phone_revealed: args.phoneRevealed,
      credits_used: args.credits,
      cost_usd: null,
      processing_basis: args.basis,
      error_code: args.errorCode,
    },
  };
}
