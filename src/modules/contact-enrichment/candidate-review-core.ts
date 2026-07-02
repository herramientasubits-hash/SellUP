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
    metadata: {
      ...buildContactTraceMetadata(candidate),
      normalization: { status: 'normalized', fields: normalizedFields },
    },
    created_by: internalUserId,
    updated_by: internalUserId,
  };
}

// ── Metadata de revisión (enrichment_metadata.review) ───────────

export interface ReviewMetadata {
  status: 'approved' | 'discarded' | 'duplicate';
  reason?: string;
  reviewed_at: string;
  reviewed_by: string;
  created_contact_id?: string;
  matched_contact_id?: string;
  matched_by?: DuplicateMatch['matchedBy'];
}

/** Inserta/actualiza la clave `review` sin perder relevance/completion previos. */
export function mergeReview(
  existing: Record<string, unknown> | null | undefined,
  review: ReviewMetadata,
): Record<string, unknown> {
  return { ...(existing ?? {}), review };
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
  | { ok: true; contactId: string; message: string }
  | { ok: false; error: string; duplicate?: boolean; contactId?: string };

export type DiscardResult = { ok: true; message: string } | { ok: false; error: string };

const MSG = {
  invalid: 'Candidato inválido.',
  notFound: 'El candidato no existe o ya fue revisado.',
  notPending: 'El candidato ya fue revisado.',
  noAccount:
    'No se puede aprobar este candidato porque no está asociado a una cuenta SellUp.',
  duplicate: 'Este candidato parece estar duplicado con un contacto existente.',
  createFailed: 'No fue posible crear el contacto oficial.',
  approveFailed: 'No fue posible aprobar el candidato.',
  discardFailed: 'No fue posible rechazar el candidato.',
  approved: 'Contacto aprobado y creado en SellUp.',
  discarded: 'Candidato rechazado.',
} as const;

// ── Dependencias inyectables ────────────────────────────────────

export interface AuditEntry {
  contactId: string;
  accountId: string;
  actorUserId: string | null;
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
): Promise<ApproveResult> {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    return { ok: false, error: MSG.invalid };
  }

  const candidate = await deps.loadCandidate(candidateId.trim());
  if (!candidate) return { ok: false, error: MSG.notFound };
  if (candidate.status !== 'pending_review') return { ok: false, error: MSG.notPending };
  if (!candidate.account_id) return { ok: false, error: MSG.noAccount };

  const accountId = candidate.account_id;

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

  // Marcar candidato approved con referencia al contacto creado.
  const review: ReviewMetadata = {
    status: 'approved',
    reviewed_at: deps.nowIso,
    reviewed_by: deps.actorId,
    created_contact_id: contactId,
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

  await deps.logAudit?.({ contactId, accountId, actorUserId: deps.actorId });

  return { ok: true, contactId, message: MSG.approved };
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
