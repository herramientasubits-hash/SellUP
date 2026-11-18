// Agente 2A — «Cambió de empresa» (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
// Núcleo PURO. Cuando «Verificar correo» (o revelar LinkedIn / correo / teléfono) detecta que la
// persona ya trabaja en otra empresa, el usuario confirma y:
//
//   1. se resuelve la empresa nueva SÓLO entre empresas que existen en HubSpot o en SellUp
//      (coincidencia única; si no, el candidato queda «Sin empresa asociada» y quien lo revise la
//      asocia con «Reasignar empresa» antes de aprobar);
//   2. se crea un candidato «Por revisar» en la empresa nueva con la información nueva (el correo
//      nuevo como «Correo», el cargo actual, el LinkedIn) vinculado al MISMO contacto de HubSpot.
//      Lo ve el dueño de esa empresa (alcance por cuenta) y quien lo detectó;
//   3. si el contacto ya está en HubSpot, la información nueva viaja YA a ese contacto (correo
//      nuevo como principal, el anterior como adicional; cargo actual). Así, aunque rechacen el
//      candidato, HubSpot queda al día. Si no está en HubSpot, se crea al aprobar el candidato;
//   4. el contacto de SellUp se archiva con su información de hoy (se puede desarchivar).
//
// Al aprobar el candidato: en HubSpot la empresa nueva queda como principal y el contacto se
// desasocia de las demás. Al rechazarlo: nada más en HubSpot; el contacto viejo sigue archivado.

import { canonicalLinkedin } from './candidate-identity-completion-core';
import {
  CONTACT_EMAIL_CHECK_HITO,
  hasPendingCompanyChange,
  type EmailChangeCase,
  type EmailCheckBlock,
} from './email-change-classifier-core';
import { normalizeLinkedinProfileUrl } from './linkedin-profile-url';
import type { SearchedContactData } from './linkedin-contact-search-core';
import type { CompanyCandidate } from './types';

/** Clave en `contacts.metadata` (contacto viejo) y en `enrichment_metadata` (candidato nuevo). */
export const COMPANY_CHANGE_METADATA_KEY = 'company_change';

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ── Entrada ─────────────────────────────────────────────────────────

export interface CompanyChangeContact {
  id: string;
  accountId: string;
  accountName: string | null;
  accountDomain: string | null;
  accountHubSpotCompanyId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  email: string | null;
  linkedinUrl: string | null;
  jobTitle: string | null;
  seniority: string | null;
  hubspotContactId: string | null;
  contactStatus: string | null;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface CompanyChangeSourceCandidate {
  id: string;
  source: string | null;
  sourceContactId: string | null;
  matchedHubSpotContactId: string | null;
  apolloPersonId: string | null;
  linkedinUrl: string | null;
}

// ── ¿Se puede confirmar? ────────────────────────────────────────────

export type CompanyChangeBlockReason =
  | 'contact_unavailable'
  | 'no_pending_change'
  | 'already_confirmed'
  | 'missing_linkedin';

export function evaluateCompanyChangeConfirmation(input: {
  contact: CompanyChangeContact | null;
  check: EmailCheckBlock | null;
}): { ok: true } | { ok: false; reason: CompanyChangeBlockReason } {
  const { contact, check } = input;
  if (!contact || clean(contact.archivedAt)) return { ok: false, reason: 'contact_unavailable' };
  if (check?.resolution === 'company_change_confirmed') return { ok: false, reason: 'already_confirmed' };
  if (!hasPendingCompanyChange(check)) return { ok: false, reason: 'no_pending_change' };
  if (!canonicalLinkedin(contact.linkedinUrl)) return { ok: false, reason: 'missing_linkedin' };
  return { ok: true };
}

/** El contacto de HubSpot de esta persona: el vínculo del contacto manda; si no, el del candidato. */
export function resolveCompanyChangeHubSpotContactId(
  contact: Pick<CompanyChangeContact, 'hubspotContactId'>,
  candidate: Pick<CompanyChangeSourceCandidate, 'source' | 'sourceContactId' | 'matchedHubSpotContactId'> | null,
): string | null {
  return (
    clean(contact.hubspotContactId) ??
    clean(candidate?.matchedHubSpotContactId) ??
    (candidate?.source === 'hubspot' ? clean(candidate.sourceContactId) : null)
  );
}

/** Con qué se busca la empresa nueva (nunca la empresa de HubSpot del contacto: es la vieja). */
export function companyChangeLookupInput(check: EmailCheckBlock): {
  hubspotCompanyId: null;
  companyName: string | null;
  companyDomain: string | null;
  email: string | null;
} {
  return {
    hubspotCompanyId: null,
    companyName: clean(check.employment?.current_company),
    companyDomain: clean(check.employment?.organization_domain),
    email: check.found_email,
  };
}

/** ¿La empresa resuelta es la MISMA en la que ya está el contacto? Entonces no es un cambio. */
export function isCurrentCompany(company: CompanyCandidate | null, contact: CompanyChangeContact): boolean {
  if (!company) return false;
  if (company.sellupAccountId && company.sellupAccountId === contact.accountId) return true;
  return !!company.hubspotCompanyId && company.hubspotCompanyId === clean(contact.accountHubSpotCompanyId);
}

/** Nombre de la empresa nueva para los avisos (la resuelta o la que dice el proveedor). */
export function companyChangeNewCompanyName(check: EmailCheckBlock | null, company: CompanyCandidate | null): string | null {
  return clean(company?.name) ?? clean(check?.employment?.current_company) ?? clean(check?.found_email_domain);
}

// ── El candidato en la empresa nueva ────────────────────────────────

/**
 * Los datos del candidato nuevo con la forma de la búsqueda puntual, para crearlo con el MISMO
 * camino (`createQuickSearchCandidate`): request de la empresa (o «manual» sin empresa) + corrida +
 * candidato «Por revisar». No se llamó a ningún proveedor aquí: lo gastado ya se registró al
 * verificar.
 *
 * Con contacto de HubSpot, el candidato es de origen HubSpot con ese id: al aprobarlo, el contacto
 * nuevo se vincula al MISMO contacto de HubSpot. Sin él, es de origen Apollo (de donde salió la
 * información nueva) y, al aprobarlo, el autosync lo crea en HubSpot (9.2).
 */
export function buildCompanyChangeSearchData(input: {
  contact: CompanyChangeContact;
  candidate: CompanyChangeSourceCandidate | null;
  check: EmailCheckBlock;
  hubspotContactId: string | null;
  nowIso: string;
}): SearchedContactData {
  const { contact, candidate, check, hubspotContactId } = input;
  const normalized = normalizeLinkedinProfileUrl(contact.linkedinUrl ?? candidate?.linkedinUrl ?? null);
  const linkedinUrl = normalized.ok ? normalized.canonicalUrl : null;
  const linkedinSlug = normalized.ok ? normalized.slug : null;
  const employment = check.employment;
  const title = clean(employment?.current_title) ?? (employment?.status === 'other_company' ? null : clean(contact.jobTitle));
  return {
    entryMode: 'company_change',
    linkedinUrl,
    linkedinSlug,
    profile: {
      provider: hubspotContactId ? 'hubspot' : 'apollo',
      sourceContactId: hubspotContactId ?? clean(candidate?.apolloPersonId),
      firstName: clean(contact.firstName),
      lastName: clean(contact.lastName),
      fullName: contact.fullName,
      title,
      seniority: null,
      country: null,
      email: check.found_email,
      providerCompanyName: clean(employment?.current_company),
      providerCompanyDomain: clean(employment?.organization_domain) ?? clean(check.found_email_domain),
      providerCompanyWebsiteUrl: null,
      phoneAvailable: null,
      linkedinUrl,
      // Los teléfonos del contacto viejo NO viajan: pueden ser fijos de la empresa anterior.
      phone: null,
    },
    // Sin la empresa de HubSpot del contacto: es la VIEJA.
    hubspotContact: hubspotContactId ? { id: hubspotContactId, associatedCompanyId: null } : null,
    providersCalled: [],
    creditsSpent: 0,
    searchedAt: input.nowIso,
  };
}

export interface CandidateCompanyChangeBlock {
  hito: typeof CONTACT_EMAIL_CHECK_HITO;
  previous_contact_id: string;
  previous_account_id: string;
  previous_account_name: string | null;
  previous_hubspot_contact_id: string | null;
  previous_email_domain: string | null;
  detected_case: EmailChangeCase;
  confirmed_at: string;
  confirmed_by: string;
}

export function buildCandidateCompanyChangeBlock(input: {
  contact: CompanyChangeContact;
  check: EmailCheckBlock;
  hubspotContactId: string | null;
  actorId: string;
  nowIso: string;
}): CandidateCompanyChangeBlock {
  const email = clean(input.contact.email)?.toLowerCase() ?? null;
  return {
    hito: CONTACT_EMAIL_CHECK_HITO,
    previous_contact_id: input.contact.id,
    previous_account_id: input.contact.accountId,
    previous_account_name: clean(input.contact.accountName),
    previous_hubspot_contact_id: input.hubspotContactId,
    previous_email_domain: email ? email.slice(email.lastIndexOf('@') + 1) : null,
    detected_case: input.check.case,
    confirmed_at: input.nowIso,
    confirmed_by: input.actorId,
  };
}

export function readCandidateCompanyChange(metadata: unknown): CandidateCompanyChangeBlock | null {
  if (!isRecord(metadata)) return null;
  const raw = metadata[COMPANY_CHANGE_METADATA_KEY];
  if (!isRecord(raw)) return null;
  const previousContactId = clean(raw.previous_contact_id);
  const previousAccountId = clean(raw.previous_account_id);
  if (!previousContactId || !previousAccountId) return null;
  return {
    hito: CONTACT_EMAIL_CHECK_HITO,
    previous_contact_id: previousContactId,
    previous_account_id: previousAccountId,
    previous_account_name: clean(raw.previous_account_name),
    previous_hubspot_contact_id: clean(raw.previous_hubspot_contact_id),
    previous_email_domain: clean(raw.previous_email_domain),
    detected_case: (clean(raw.detected_case) ?? 'company_change') as EmailChangeCase,
    confirmed_at: clean(raw.confirmed_at) ?? '',
    confirmed_by: clean(raw.confirmed_by) ?? '',
  };
}

// ── Lo que viaja a HubSpot antes de la revisión (D5) ────────────────

export function planCompanyChangeHubSpotPush(input: {
  contact: Pick<CompanyChangeContact, 'email' | 'jobTitle'>;
  check: EmailCheckBlock;
}): { email: string | null; jobTitle: string | null } {
  const current = clean(input.contact.email)?.toLowerCase() ?? null;
  const found = input.check.found_email;
  const title = clean(input.check.employment?.current_title);
  return {
    email: found && found !== current ? found : null,
    jobTitle: title && title !== clean(input.contact.jobTitle) ? title : null,
  };
}

// ── El contacto viejo ───────────────────────────────────────────────

export type ContactCompanyChangeOutcome = 'pending_review' | 'approved' | 'rejected';

export interface ContactCompanyChangeBlock {
  hito: typeof CONTACT_EMAIL_CHECK_HITO;
  detected_case: EmailChangeCase;
  confirmed_at: string;
  confirmed_by: string;
  new_candidate_id: string;
  new_company_name: string | null;
  new_account_id: string | null;
  /** Estado del contacto antes de archivarlo (para desarchivarlo tal cual). */
  previous_status: string | null;
  hubspot_contact_id: string | null;
  /** Desenlace del envío a HubSpot antes de la revisión (sin valores). */
  hubspot_push: { email: string | null; job_title: string | null } | null;
  outcome: ContactCompanyChangeOutcome;
  outcome_at: string | null;
  approved_contact_id: string | null;
  hubspot_reassociation: string | null;
  restored_at: string | null;
  restored_by: string | null;
}

export function buildContactCompanyChangeBlock(input: {
  contact: CompanyChangeContact;
  check: EmailCheckBlock;
  actorId: string;
  nowIso: string;
  newCandidateId: string;
  newCompanyName: string | null;
  newAccountId: string | null;
  hubspotContactId: string | null;
  hubspotPush: ContactCompanyChangeBlock['hubspot_push'];
}): ContactCompanyChangeBlock {
  return {
    hito: CONTACT_EMAIL_CHECK_HITO,
    detected_case: input.check.case,
    confirmed_at: input.nowIso,
    confirmed_by: input.actorId,
    new_candidate_id: input.newCandidateId,
    new_company_name: input.newCompanyName,
    new_account_id: input.newAccountId,
    previous_status: clean(input.contact.contactStatus),
    hubspot_contact_id: input.hubspotContactId,
    hubspot_push: input.hubspotPush,
    outcome: 'pending_review',
    outcome_at: null,
    approved_contact_id: null,
    hubspot_reassociation: null,
    restored_at: null,
    restored_by: null,
  };
}

export function readContactCompanyChange(metadata: unknown): ContactCompanyChangeBlock | null {
  if (!isRecord(metadata)) return null;
  const raw = metadata[COMPANY_CHANGE_METADATA_KEY];
  if (!isRecord(raw)) return null;
  const newCandidateId = clean(raw.new_candidate_id);
  const confirmedAt = clean(raw.confirmed_at);
  if (!newCandidateId || !confirmedAt) return null;
  const push = isRecord(raw.hubspot_push)
    ? { email: clean(raw.hubspot_push.email), job_title: clean(raw.hubspot_push.job_title) }
    : null;
  const outcome = raw.outcome === 'approved' || raw.outcome === 'rejected' ? raw.outcome : 'pending_review';
  return {
    hito: CONTACT_EMAIL_CHECK_HITO,
    detected_case: (clean(raw.detected_case) ?? 'company_change') as EmailChangeCase,
    confirmed_at: confirmedAt,
    confirmed_by: clean(raw.confirmed_by) ?? '',
    new_candidate_id: newCandidateId,
    new_company_name: clean(raw.new_company_name),
    new_account_id: clean(raw.new_account_id),
    previous_status: clean(raw.previous_status),
    hubspot_contact_id: clean(raw.hubspot_contact_id),
    hubspot_push: push,
    outcome,
    outcome_at: clean(raw.outcome_at),
    approved_contact_id: clean(raw.approved_contact_id),
    hubspot_reassociation: clean(raw.hubspot_reassociation),
    restored_at: clean(raw.restored_at),
    restored_by: clean(raw.restored_by),
  };
}

/** El archivo del contacto viejo: con su información de hoy, más el rastro del cambio. */
export function buildCompanyChangeArchivePatch(input: {
  contact: CompanyChangeContact;
  block: ContactCompanyChangeBlock;
  actorId: string;
  nowIso: string;
}) {
  return {
    archived_at: input.nowIso,
    archived_by: input.actorId,
    contact_status: 'archived' as const,
    is_primary: false,
    updated_by: input.actorId,
    metadata: { ...input.contact.metadata, [COMPANY_CHANGE_METADATA_KEY]: input.block },
  };
}

const RESTORABLE_STATUSES = new Set(['active', 'inactive', 'left_company', 'do_not_contact']);

/** ¿Se puede desarchivar? Sólo un contacto archivado POR este flujo. */
export function evaluateCompanyChangeRestore(contact: Pick<CompanyChangeContact, 'archivedAt' | 'metadata'> | null):
  | { ok: true; block: ContactCompanyChangeBlock }
  | { ok: false; reason: 'contact_unavailable' | 'not_archived' | 'not_company_change' } {
  if (!contact) return { ok: false, reason: 'contact_unavailable' };
  if (!clean(contact.archivedAt)) return { ok: false, reason: 'not_archived' };
  const block = readContactCompanyChange(contact.metadata);
  if (!block) return { ok: false, reason: 'not_company_change' };
  return { ok: true, block };
}

export function buildCompanyChangeRestorePatch(input: {
  contact: Pick<CompanyChangeContact, 'metadata'>;
  block: ContactCompanyChangeBlock;
  actorId: string;
  nowIso: string;
}) {
  const status = input.block.previous_status && RESTORABLE_STATUSES.has(input.block.previous_status) ? input.block.previous_status : 'active';
  return {
    archived_at: null,
    archived_by: null,
    contact_status: status,
    updated_by: input.actorId,
    metadata: {
      ...input.contact.metadata,
      [COMPANY_CHANGE_METADATA_KEY]: { ...input.block, restored_at: input.nowIso, restored_by: input.actorId },
    },
  };
}

/** El contacto viejo tras la decisión sobre el candidato nuevo. */
export function withCompanyChangeOutcome(
  metadata: Record<string, unknown>,
  block: ContactCompanyChangeBlock,
  update: { outcome: ContactCompanyChangeOutcome; nowIso: string; approvedContactId?: string | null; hubspotReassociation?: string | null },
): Record<string, unknown> {
  return {
    ...metadata,
    [COMPANY_CHANGE_METADATA_KEY]: {
      ...block,
      outcome: update.outcome,
      outcome_at: update.nowIso,
      approved_contact_id: update.approvedContactId ?? block.approved_contact_id,
      hubspot_reassociation: update.hubspotReassociation ?? block.hubspot_reassociation,
    },
  };
}

// ── Copy ────────────────────────────────────────────────────────────

export const COMPANY_CHANGE_COPY = {
  confirmed: (company: string | null, assigned: boolean) =>
    assigned && company
      ? `Listo: el contacto se archivó y la persona quedó en «Por revisar» en ${company}.`
      : 'Listo: el contacto se archivó y la persona quedó en «Por revisar» sin empresa asociada. Quien lo revise debe asociarla con «Reasignar empresa» antes de aprobar.',
  alreadyPending: 'Esta persona ya está en «Por revisar». No se archivó el contacto.',
  sameCompany: 'La empresa que encontramos es la misma en la que ya está este contacto. No se hizo ningún cambio.',
  noPendingChange: 'Ya no hay un cambio de empresa pendiente para este contacto. Vuelve a abrir la ficha.',
  missingLinkedin: 'Para mandarlo a revisión, el contacto necesita su LinkedIn.',
  error: 'No pudimos completar el cambio de empresa. No se archivó el contacto.',
  restored: 'Contacto desarchivado.',
  restoreUnavailable: 'Este contacto no se archivó por un cambio de empresa.',
} as const;
