// Agente 2A — Candidate Review Core (Hito 17A.4B)
// Lógica pura y orquestación inyectable para aprobar/rechazar candidatos de
// contacto. Sin red, sin DB, sin auth: las dependencias se inyectan para poder
// testear sin Supabase. Las server actions (actions.ts) cablean las
// implementaciones reales sobre estos contratos.
//
// Reglas del hito:
//  - Aprobar crea un contacto oficial en `contacts` y marca el candidato approved.
//  - Para crear contacto oficial DEBE existir una cuenta SellUp (contacts.account_id
//    es NOT NULL). Sin account_id ⇒ se bloquea la aprobación.
//  - Antes de crear, se valida duplicidad contra los contactos de la cuenta.
//  - NUNCA se llama a Apollo ni a HubSpot desde aquí.

import type {
  ContactSource as OfficialContactSource,
  ContactSeniority,
} from '@/modules/contacts/types';
import type {
  ContactSource as CandidateSource,
  ContactCandidateStatus,
  ContactDuplicateStatus,
  PhoneType,
  PhoneSource,
} from './types';

// ── Normalización de claves de deduplicación ───────────────────
// Espejo de las reglas de contact-deduplicator.ts (email/linkedin exactos,
// nombre como posible duplicado), pero aplicadas contra `contacts` por cuenta.

export function emailKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase();
  return k.length > 0 ? k : null;
}

export function linkedinKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.trim().toLowerCase().replace(/\/+$/, '');
  return k.length > 0 ? k : null;
}

export function nameKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
  return k.length > 0 ? k : null;
}

// ── Deduplicación contra contactos existentes de la cuenta ──────

export interface ExistingContactForDedup {
  id: string;
  email: string | null;
  linkedin_url: string | null;
  full_name: string;
}

export interface CandidateDedupInput {
  email: string | null;
  linkedin_url: string | null;
  full_name: string;
}

export interface DuplicateMatch {
  contactId: string;
  matchedBy: 'email' | 'linkedin' | 'name';
}

/**
 * Encuentra un contacto existente que duplique al candidato dentro de la misma
 * cuenta. Orden: email → linkedin → (solo si no hay email ni linkedin) nombre.
 * Devuelve `null` si no hay coincidencia.
 */
export function findDuplicateContact(
  candidate: CandidateDedupInput,
  existing: ExistingContactForDedup[],
): DuplicateMatch | null {
  const eKey = emailKey(candidate.email);
  const lKey = linkedinKey(candidate.linkedin_url);
  const nKey = nameKey(candidate.full_name);

  if (eKey) {
    const match = existing.find((c) => emailKey(c.email) === eKey);
    if (match) return { contactId: match.id, matchedBy: 'email' };
  }

  if (lKey) {
    const match = existing.find((c) => linkedinKey(c.linkedin_url) === lKey);
    if (match) return { contactId: match.id, matchedBy: 'linkedin' };
  }

  // Fallback por nombre solo cuando el candidato no tiene email ni linkedin.
  if (!eKey && !lKey && nKey) {
    const match = existing.find((c) => nameKey(c.full_name) === nKey);
    if (match) return { contactId: match.id, matchedBy: 'name' };
  }

  return null;
}

export function duplicateStatusFromMatch(match: DuplicateMatch): ContactDuplicateStatus {
  return match.matchedBy === 'name' ? 'possible_duplicate' : 'exact_duplicate';
}

// ── Mapeo candidato → contacto oficial ──────────────────────────

const CANDIDATE_SOURCE_TO_CONTACT: Record<CandidateSource, OfficialContactSource> = {
  apollo: 'apollo',
  lusha: 'lusha',
  hubspot: 'hubspot',
  manual: 'manual',
  // `contacts.source` no admite 'mock'; lo registramos como 'other'.
  mock: 'other',
};

export function mapCandidateSource(source: CandidateSource): OfficialContactSource {
  return CANDIDATE_SOURCE_TO_CONTACT[source] ?? 'other';
}

// Vocabulario de seniority del normalizador Apollo → enum CHECK de `contacts`.
// Valores fuera del mapa quedan en null (la columna lo permite) para no violar
// la restricción CHECK de la tabla.
const CANDIDATE_SENIORITY_TO_CONTACT: Record<string, ContactSeniority> = {
  owner: 'c_level',
  executive: 'c_level',
  c_level: 'c_level',
  c_suite: 'c_level',
  vp: 'vp',
  director: 'director',
  head: 'director',
  manager: 'manager',
  employee: 'individual_contributor',
  entry: 'individual_contributor',
  senior: 'individual_contributor',
  individual_contributor: 'individual_contributor',
};

export function mapCandidateSeniority(raw: string | null | undefined): ContactSeniority | null {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return CANDIDATE_SENIORITY_TO_CONTACT[key] ?? null;
}

function sanitizeEmail(email: string | null | undefined): string | null {
  if (!email || !email.trim()) return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parsea un nombre completo en firstName y lastName.
 * Reglas simples: una palabra → lastName null; dos o más → primera + resto.
 * Colapsa espacios múltiples. Preserva acentos y caracteres latinos.
 */
export function parseContactName(fullName: string): {
  firstName: string | null;
  lastName: string | null;
  normalizedFullName: string;
} {
  const normalized = fullName.trim().replace(/\s+/g, ' ');
  if (!normalized) return { firstName: null, lastName: null, normalizedFullName: '' };
  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null, normalizedFullName: normalized };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
    normalizedFullName: normalized,
  };
}

/**
 * Normaliza una URL de LinkedIn para almacenamiento:
 * añade https:// si parece linkedin.com/... sin protocolo.
 */
function normalizeLinkedinUrl(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  if (/^(www\.)?linkedin\.com\//i.test(cleaned)) {
    return 'https://' + cleaned.replace(/^www\./i, '');
  }
  return cleaned;
}

// ── Registro del candidato cargado (proyección para review) ─────

export interface CandidateRecord {
  id: string;
  status: ContactCandidateStatus;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  source: CandidateSource;
  enrichment_metadata: Record<string, unknown>;
  enrichment_run_id: string | null;
  /** account_id resuelto desde el run que originó al candidato. */
  account_id: string | null;
  /** HubSpot company id del run. Presente en candidatos HubSpot-only. */
  hubspot_company_id: string | null;
  /** Nombre de empresa del run (para crear cuenta si no existe). */
  company_name: string | null;
  /** Dominio de empresa del run (para dedup por dominio). */
  company_domain: string | null;
  /** Código ISO-2 del país resuelto en el run (MX, CO, CL…). Puede ser null. */
  country_code: string | null;
}

export interface ContactInsertPayload {
  account_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  job_title: string | null;
  department: string | null;
  seniority: ContactSeniority | null;
  source: OfficialContactSource;
  contact_status: 'active';
  // PHONE-3C: metadata de teléfono trasladada desde el candidato enriquecido.
  // Aditivo y nullable — el teléfono nunca es obligatorio y NO se revela aquí.
  phone_type: PhoneType | null;
  phone_source: PhoneSource | null;
  phone_raw_type: string | null;
  phone_revealed_at: string | null;
  phone_processing_basis: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  updated_by: string;
}

/**
 * Trazabilidad de origen guardada en `contacts.metadata`. Solo referencias y
 * resúmenes; nunca payload crudo del proveedor.
 */
export function buildContactTraceMetadata(candidate: CandidateRecord): Record<string, unknown> {
  const meta = candidate.enrichment_metadata ?? {};
  return {
    source: 'contact_enrichment_candidate',
    source_candidate_id: candidate.id,
    source_enrichment_run_id: candidate.enrichment_run_id,
    candidate_source: candidate.source,
    relevance: (meta.relevance as unknown) ?? null,
    completion: (meta.completion ?? meta.contact_completion ?? null) as unknown,
    post_completion: (meta.post_completion ?? null) as unknown,
    company_consistency: (meta.company_consistency ?? null) as unknown,
  };
}

// ── Copia de metadata de teléfono al contacto oficial (PHONE-3C) ─
// Traslada el tipo/fuente/raw_type que PHONE-3A ya conservó de forma gratuita
// en `enrichment_metadata.phone` (payload de búsqueda de Apollo). NO revela
// teléfonos, NO llama proveedores, NO gasta créditos: solo mueve metadata ya
// existente. Valores de tipo/fuente fuera del vocabulario estable → null.

const ALLOWED_PHONE_TYPES: readonly PhoneType[] = [
  'personal_mobile',
  'mobile',
  'direct_dial',
  'work',
  'hq',
  'other',
  'unknown',
];

const ALLOWED_PHONE_SOURCES: readonly PhoneSource[] = [
  'apollo_search',
  'apollo_reveal',
  'lusha_reveal',
  'provider_payload',
  'manual',
  'unknown',
];

function normalizePhoneType(value: unknown): PhoneType | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return (ALLOWED_PHONE_TYPES as readonly string[]).includes(v) ? (v as PhoneType) : null;
}

function normalizePhoneSource(value: unknown): PhoneSource | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return (ALLOWED_PHONE_SOURCES as readonly string[]).includes(v) ? (v as PhoneSource) : null;
}

export interface ContactPhoneMetadataCopy {
  phone_type: PhoneType | null;
  phone_source: PhoneSource | null;
  phone_raw_type: string | null;
  phone_revealed_at: string | null;
  phone_processing_basis: string | null;
}

/**
 * Extrae la metadata de teléfono a copiar en el contacto oficial desde
 * `candidate.enrichment_metadata.phone`. Si no hay metadata, todos los campos
 * quedan null (comportamiento actual intacto: el teléfono nunca es obligatorio).
 *
 * `phone_revealed_at` y `phone_processing_basis` quedan SIEMPRE null en este
 * hito: no se revela ningún teléfono (apollo_search entrega el tipo gratis en
 * la búsqueda) y no hay una política legal de reveal definida todavía.
 */
export function buildContactPhoneMetadata(
  candidate: Pick<CandidateRecord, 'enrichment_metadata'>,
): ContactPhoneMetadataCopy {
  const empty: ContactPhoneMetadataCopy = {
    phone_type: null,
    phone_source: null,
    phone_raw_type: null,
    phone_revealed_at: null,
    phone_processing_basis: null,
  };

  const phoneMeta = candidate.enrichment_metadata?.phone as
    | { type?: unknown; source?: unknown; raw_type?: unknown }
    | null
    | undefined;
  if (!phoneMeta || typeof phoneMeta !== 'object') return empty;

  const rawType = typeof phoneMeta.raw_type === 'string' ? phoneMeta.raw_type : null;

  return {
    phone_type: normalizePhoneType(phoneMeta.type),
    phone_source: normalizePhoneSource(phoneMeta.source),
    phone_raw_type: cleanString(rawType),
    // No reveal en este hito → siempre null para apollo_search / search-derived.
    phone_revealed_at: null,
    // Sin política legal de reveal definida → null para apollo_search.
    phone_processing_basis: null,
  };
}

/** Construye el payload de inserción en `contacts` a partir del candidato. */
export function buildContactInsertPayload(args: {
  candidate: CandidateRecord;
  accountId: string;
  internalUserId: string;
}): ContactInsertPayload {
  const { candidate, accountId, internalUserId } = args;

  // Normalización de nombre: usa first/last del candidato si ya vienen completos,
  // con fallback a parsear full_name cuando son null (p. ej. aprobaciones manuales).
  const parsedName = parseContactName(candidate.full_name);
  const firstName = cleanString(candidate.first_name) ?? parsedName.firstName;
  const lastName = cleanString(candidate.last_name) ?? parsedName.lastName;
  const fullName = parsedName.normalizedFullName || candidate.full_name.trim();

  const email = sanitizeEmail(candidate.email);
  const linkedinUrl = normalizeLinkedinUrl(candidate.linkedin_url);
  const phone = cleanString(candidate.phone);

  const normalizedFields: string[] = ['full_name'];
  if (firstName !== null) normalizedFields.push('first_name');
  if (lastName !== null) normalizedFields.push('last_name');
  if (email !== null) normalizedFields.push('email');
  if (linkedinUrl !== null) normalizedFields.push('linkedin_url');
  if (phone !== null) normalizedFields.push('phone');

  const titleNormalization =
    (candidate.enrichment_metadata?.apollo_title_normalization as Record<string, unknown> | null | undefined) ?? null;

  // PHONE-3C: traslada tipo/fuente de teléfono ya conservados por PHONE-3A.
  // Sin metadata ⇒ todos null (el teléfono nunca es obligatorio).
  const phoneMetadata = buildContactPhoneMetadata(candidate);

  return {
    account_id: accountId,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    email,
    phone,
    linkedin_url: linkedinUrl,
    job_title: cleanString(candidate.title),
    department: cleanString(candidate.department),
    seniority: mapCandidateSeniority(candidate.seniority),
    source: mapCandidateSource(candidate.source),
    contact_status: 'active',
    phone_type: phoneMetadata.phone_type,
    phone_source: phoneMetadata.phone_source,
    phone_raw_type: phoneMetadata.phone_raw_type,
    phone_revealed_at: phoneMetadata.phone_revealed_at,
    phone_processing_basis: phoneMetadata.phone_processing_basis,
    metadata: {
      ...buildContactTraceMetadata(candidate),
      normalization: { status: 'normalized', fields: normalizedFields },
      ...(titleNormalization ? { apollo_title_normalization: titleNormalization } : {}),
    },
    created_by: internalUserId,
    updated_by: internalUserId,
  };
}

// ── Metadata de revisión (enrichment_metadata.review) ───────────

/**
 * Evidencia truthful de un override humano de discrepancia de identidad
 * (Hito 17B.4W.8). Solo se persiste cuando el candidato es `mismatch` y el
 * humano aprobó explícitamente con acknowledgement + motivo.
 */
export interface IdentityApprovalOverrideEvidenceV1 {
  acknowledged: true;
  reason: string;
  identity_state_at_override: 'mismatch';
  reviewed_by: string;
  reviewed_at: string;
}

export interface ReviewMetadata {
  status: 'approved' | 'discarded' | 'duplicate';
  reason?: string;
  reviewed_at: string;
  reviewed_by: string;
  created_contact_id?: string;
  matched_contact_id?: string;
  matched_by?: DuplicateMatch['matchedBy'];
  identity_override?: IdentityApprovalOverrideEvidenceV1;
}

/** Inserta/actualiza la clave `review` sin perder relevance/completion previos. */
export function mergeReview(
  existing: Record<string, unknown> | null | undefined,
  review: ReviewMetadata,
): Record<string, unknown> {
  return { ...(existing ?? {}), review };
}

// ── Identity approval state (Hito 17B.4W.8) ─────────────────────
// Clasifica al candidato según la evidencia persistida en
// enrichment_metadata.person_identity (17B.4W.6). Política genérica: no usa
// provider_key, source, email local-part, confianza ni heurísticas — solo
// identity_consistency.

export type CandidateIdentityApprovalStateV1 =
  | 'consistent'
  | 'mismatch'
  | 'insufficient_evidence'
  | 'no_evidence';

/** Payload de entrada de un override humano de discrepancia de identidad. */
export interface IdentityApprovalOverrideInputV1 {
  acknowledged: boolean;
  reason: string;
}

const IDENTITY_CONSISTENCY_TO_STATE: Record<string, CandidateIdentityApprovalStateV1> = {
  consistent: 'consistent',
  mismatch: 'mismatch',
  insufficient_evidence: 'insufficient_evidence',
};

/**
 * Resuelve el estado de aprobación de identidad de un candidato a partir de
 * `enrichment_metadata.person_identity?.identity_consistency`. Ausente, nulo
 * o valor no reconocido ⇒ `no_evidence` (candidatos legacy o sin proveedor
 * que registre evidencia).
 */
export function resolveCandidateIdentityApprovalState(
  candidate: Pick<CandidateRecord, 'enrichment_metadata'>,
): CandidateIdentityApprovalStateV1 {
  const personIdentity = candidate.enrichment_metadata?.person_identity as
    | { identity_consistency?: unknown }
    | null
    | undefined;
  const raw = personIdentity?.identity_consistency;
  if (typeof raw !== 'string') return 'no_evidence';
  return IDENTITY_CONSISTENCY_TO_STATE[raw] ?? 'no_evidence';
}

/**
 * Valida un override humano: requiere acknowledgement explícito y un motivo
 * no vacío (tras trim). Devuelve el motivo ya recortado cuando es válido.
 */
export function validateIdentityApprovalOverride(
  input: IdentityApprovalOverrideInputV1 | null | undefined,
): { valid: true; reason: string } | { valid: false } {
  if (!input || input.acknowledged !== true) return { valid: false };
  const reason = input.reason.trim();
  if (reason.length === 0) return { valid: false };
  return { valid: true, reason };
}

/** Construye la evidencia truthful de override para persistir en `review`. */
export function buildIdentityApprovalOverrideEvidence(args: {
  reason: string;
  actorId: string;
  nowIso: string;
}): IdentityApprovalOverrideEvidenceV1 {
  return {
    acknowledged: true,
    reason: args.reason,
    identity_state_at_override: 'mismatch',
    reviewed_by: args.actorId,
    reviewed_at: args.nowIso,
  };
}

// ── Patch aplicado al candidato ─────────────────────────────────

export interface CandidateReviewPatch {
  status: ContactCandidateStatus;
  duplicate_status?: ContactDuplicateStatus;
  matched_contacts_id?: string | null;
  review_notes?: string | null;
  reviewed_by: string;
  reviewed_at: string;
  enrichment_metadata: Record<string, unknown>;
}

// ── Resultados ──────────────────────────────────────────────────

export type ApproveResult =
  | { ok: true; contactId: string; message: string; accountCreated?: boolean }
  | {
      ok: false;
      error: string;
      duplicate?: boolean;
      contactId?: string;
      code?: 'IDENTITY_MISMATCH_REQUIRES_REVIEW' | 'IDENTITY_OVERRIDE_REASON_REQUIRED';
    };

export type DiscardResult = { ok: true; message: string } | { ok: false; error: string };

const MSG = {
  invalid: 'Candidato inválido.',
  notFound: 'El candidato no existe o ya fue revisado.',
  notPending: 'El candidato ya fue revisado.',
  noAccount:
    'No se puede aprobar este candidato porque no está asociado a una cuenta SellUp ni vinculado a HubSpot.',
  duplicate: 'Este candidato parece estar duplicado con un contacto existente.',
  createFailed: 'No fue posible crear el contacto oficial.',
  approveFailed: 'No fue posible aprobar el candidato.',
  discardFailed: 'No fue posible rechazar el candidato.',
  approved: 'Contacto aprobado y creado en SellUp.',
  approvedNewAccount: 'Cuenta creada en SellUp y contacto aprobado.',
  approvedLinkedAccount: 'Contacto aprobado y asociado a la cuenta existente.',
  discarded: 'Candidato rechazado.',
  identityMismatchRequiresReview:
    'Este candidato tiene una discrepancia de identidad sin revisar. Revísala antes de aprobar.',
  identityOverrideReasonRequired:
    'Debes confirmar que revisaste la discrepancia e indicar un motivo antes de aprobar.',
} as const;

// ── Dependencias inyectables ────────────────────────────────────

export interface AuditEntry {
  contactId: string;
  accountId: string;
  actorUserId: string | null;
  /** true solo cuando el candidato era `mismatch` y se aprobó vía override humano válido. */
  identityOverrideApplied?: boolean;
}

export interface ApproveDeps {
  actorId: string;
  nowIso: string;
  loadCandidate: (id: string) => Promise<CandidateRecord | null>;
  loadExistingContacts: (accountId: string) => Promise<ExistingContactForDedup[]>;
  insertContact: (
    payload: ContactInsertPayload,
  ) => Promise<{ id: string } | { error: string }>;
  updateCandidate: (id: string, patch: CandidateReviewPatch) => Promise<{ error?: string }>;
  logAudit?: (entry: AuditEntry) => Promise<void>;
  /**
   * Resuelve o crea una cuenta SellUp para candidatos HubSpot-only
   * (cuando run.account_id es null pero hubspot_company_id existe).
   * Si no se provee y account_id es null, la aprobación se bloquea.
   */
  resolveOrCreateAccount?: (args: {
    hubspot_company_id: string;
    company_name: string | null;
    company_domain: string | null;
    run_id: string | null;
    country_code: string | null;
  }) => Promise<{ accountId: string; outcome: string; countryCodeApplied: string | null; countryResolutionSource: string } | { error: string }>;
  /**
   * Actualiza contact_enrichment_runs con el account_id recién resuelto/creado
   * y registra metadata de trazabilidad. Se llama solo cuando se resuelve una
   * cuenta nueva para un candidato HubSpot-only.
   */
  updateRunAccountId?: (
    runId: string,
    accountId: string,
    outcome: string,
    countryCodeApplied: string | null,
    countryResolutionSource: string,
  ) => Promise<void>;
}

export interface DiscardDeps {
  actorId: string;
  nowIso: string;
  loadCandidate: (id: string) => Promise<CandidateRecord | null>;
  updateCandidate: (id: string, patch: CandidateReviewPatch) => Promise<{ error?: string }>;
}

// ── Orquestación: aprobar ───────────────────────────────────────

/**
 * Aprueba un candidato: valida estado y cuenta, deduplica, crea el contacto
 * oficial y marca el candidato approved. NO ejecuta Apollo ni HubSpot.
 */
export async function runApproveCandidate(
  candidateId: string,
  deps: ApproveDeps,
  identityOverride?: IdentityApprovalOverrideInputV1,
): Promise<ApproveResult> {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    return { ok: false, error: MSG.invalid };
  }

  const candidate = await deps.loadCandidate(candidateId.trim());
  if (!candidate) return { ok: false, error: MSG.notFound };
  if (candidate.status !== 'pending_review') return { ok: false, error: MSG.notPending };

  // Gate de identidad (Hito 17B.4W.8): se evalúa ANTES de cualquier mutación
  // (cuenta, contacto, estado del candidato, audit). Política genérica: solo
  // mismatch requiere override explícito; consistent/insufficient_evidence/
  // no_evidence siguen el flujo normal sin cambios.
  const identityState = resolveCandidateIdentityApprovalState(candidate);
  let identityOverrideEvidence: IdentityApprovalOverrideEvidenceV1 | undefined;

  if (identityState === 'mismatch') {
    const validation = validateIdentityApprovalOverride(identityOverride);
    if (!identityOverride) {
      return {
        ok: false,
        error: MSG.identityMismatchRequiresReview,
        code: 'IDENTITY_MISMATCH_REQUIRES_REVIEW',
      };
    }
    if (!validation.valid) {
      return {
        ok: false,
        error: MSG.identityOverrideReasonRequired,
        code: 'IDENTITY_OVERRIDE_REASON_REQUIRED',
      };
    }
    identityOverrideEvidence = buildIdentityApprovalOverrideEvidence({
      reason: validation.reason,
      actorId: deps.actorId,
      nowIso: deps.nowIso,
    });
  }

  // Resolver cuenta SellUp: usa la existente o crea/vincula una para candidatos HubSpot-only.
  let accountId = candidate.account_id;
  let resolvedAccountOutcome: string | null = null;

  if (!accountId) {
    if (!candidate.hubspot_company_id || !deps.resolveOrCreateAccount) {
      return { ok: false, error: MSG.noAccount };
    }
    const resolved = await deps.resolveOrCreateAccount({
      hubspot_company_id: candidate.hubspot_company_id,
      company_name: candidate.company_name,
      company_domain: candidate.company_domain,
      run_id: candidate.enrichment_run_id,
      country_code: candidate.country_code,
    });
    if ('error' in resolved) return { ok: false, error: resolved.error };
    accountId = resolved.accountId;
    resolvedAccountOutcome = resolved.outcome;
    if (candidate.enrichment_run_id && deps.updateRunAccountId) {
      await deps.updateRunAccountId(
        candidate.enrichment_run_id,
        accountId,
        resolved.outcome,
        resolved.countryCodeApplied,
        resolved.countryResolutionSource,
      );
    }
  }

  // Deduplicación contra los contactos existentes de la cuenta.
  const existing = await deps.loadExistingContacts(accountId);
  const duplicate = findDuplicateContact(candidate, existing);

  if (duplicate) {
    const review: ReviewMetadata = {
      status: 'duplicate',
      reason: 'Duplicado de un contacto existente',
      reviewed_at: deps.nowIso,
      reviewed_by: deps.actorId,
      matched_contact_id: duplicate.contactId,
      matched_by: duplicate.matchedBy,
    };
    await deps.updateCandidate(candidate.id, {
      status: 'duplicate',
      duplicate_status: duplicateStatusFromMatch(duplicate),
      matched_contacts_id: duplicate.contactId,
      review_notes: 'Duplicado de un contacto existente',
      reviewed_by: deps.actorId,
      reviewed_at: deps.nowIso,
      enrichment_metadata: mergeReview(candidate.enrichment_metadata, review),
    });
    return { ok: false, error: MSG.duplicate, duplicate: true, contactId: duplicate.contactId };
  }

  // Crear contacto oficial.
  const payload = buildContactInsertPayload({
    candidate,
    accountId,
    internalUserId: deps.actorId,
  });
  const insertResult = await deps.insertContact(payload);
  if ('error' in insertResult) {
    return { ok: false, error: MSG.createFailed };
  }

  const contactId = insertResult.id;

  // Marcar candidato approved con referencia al contacto creado. El override
  // de identidad solo se persiste cuando el estado evaluado fue `mismatch`;
  // nunca se escribe para consistent/insufficient_evidence/no_evidence aunque
  // el llamador haya enviado un payload de override innecesario.
  const review: ReviewMetadata = {
    status: 'approved',
    reviewed_at: deps.nowIso,
    reviewed_by: deps.actorId,
    created_contact_id: contactId,
    ...(identityOverrideEvidence ? { identity_override: identityOverrideEvidence } : {}),
  };
  const updateResult = await deps.updateCandidate(candidate.id, {
    status: 'approved',
    duplicate_status: 'no_match',
    matched_contacts_id: contactId,
    review_notes: null,
    reviewed_by: deps.actorId,
    reviewed_at: deps.nowIso,
    enrichment_metadata: mergeReview(candidate.enrichment_metadata, review),
  });
  if (updateResult.error) {
    // El contacto ya existe; la falla al marcar el candidato no debe ocultar el
    // éxito de creación. Se reporta como error suave para revisar el candidato.
    return { ok: false, error: MSG.approveFailed, contactId };
  }

  await deps.logAudit?.({
    contactId,
    accountId,
    actorUserId: deps.actorId,
    identityOverrideApplied: identityOverrideEvidence !== undefined,
  });

  let message: string = MSG.approved;
  if (resolvedAccountOutcome === 'created') message = MSG.approvedNewAccount;
  else if (resolvedAccountOutcome !== null) message = MSG.approvedLinkedAccount;

  return { ok: true, contactId, message };
}

// ── Orquestación: rechazar ──────────────────────────────────────

/**
 * Rechaza un candidato: valida estado y lo marca discarded guardando el motivo.
 * No crea contacto.
 */
export async function runDiscardCandidate(
  candidateId: string,
  rawReason: string | null | undefined,
  deps: DiscardDeps,
): Promise<DiscardResult> {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    return { ok: false, error: MSG.invalid };
  }

  const candidate = await deps.loadCandidate(candidateId.trim());
  if (!candidate) return { ok: false, error: MSG.notFound };
  if (candidate.status !== 'pending_review') return { ok: false, error: MSG.notPending };

  const reason = cleanString(rawReason) ?? 'Otro';

  const review: ReviewMetadata = {
    status: 'discarded',
    reason,
    reviewed_at: deps.nowIso,
    reviewed_by: deps.actorId,
  };
  const updateResult = await deps.updateCandidate(candidate.id, {
    status: 'discarded',
    review_notes: reason,
    reviewed_by: deps.actorId,
    reviewed_at: deps.nowIso,
    enrichment_metadata: mergeReview(candidate.enrichment_metadata, review),
  });
  if (updateResult.error) {
    return { ok: false, error: MSG.discardFailed };
  }

  return { ok: true, message: MSG.discarded };
}
