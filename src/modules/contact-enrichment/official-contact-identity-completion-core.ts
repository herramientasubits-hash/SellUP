// Agente 2A — «Revelar correo» / «Revelar LinkedIn» / «Verificar correo» desde la ficha del
// contacto OFICIAL (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE, Bryan 17-11; ampliado en
// AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
// Núcleo PURO. Lo que el candidato sabe revelar (identity completion) se ofrece en la ficha del
// contacto, reutilizando el MISMO pipeline: mismos proveedores, mismo costo, mismo «otro nombre ⇒
// no se guarda», mismo «intento sin fruto con los mismos datos ⇒ no se vuelve a ofrecer».
//
// Con la prueba durable del origen: `contacts.metadata.source_candidate_id` apunta al candidato, el
// candidato está APROBADO y su `matched_contacts_id` es este contacto. Lo revelado se escribe en el
// candidato (y de ahí a HubSpot) y luego se lleva al contacto, sólo a los campos vacíos.
//
// 18-11:
//   * aplica a TODO contacto aprobado, venga de HubSpot, Apollo, Lusha o de una creación manual;
//   * un contacto SIN candidato de origen (creado a mano o traído antes de #904) también: al
//     primer clic se le crea uno (`needsSourceCandidate`), para usar el mismo pipeline;
//   * se busca con el dato del candidato O del contacto;
//   * «Verificar correo» cuando ya tiene correo y LinkedIn.

import { evaluateCandidateIdentityCompletion } from './candidate-identity-completion-core';
import { resolveOfficialContactSourceCandidateId } from './post-approval-reveal-core';

export type OfficialContactChannel = 'email' | 'linkedin';

export interface OfficialContactForChannelReveal {
  id: string;
  archivedAt: string | null;
  email: string | null;
  linkedinUrl: string | null;
  metadata: unknown;
}

export interface SourceCandidateForChannelReveal {
  id: string;
  status: string | null;
  source: string | null;
  sourceContactId: string | null;
  matchedContactsId: string | null;
  apolloPersonId: string | null;
  email: string | null;
  linkedinUrl: string | null;
  enrichmentMetadata: Record<string, unknown> | null;
}

export type OfficialContactChannelOfferReason =
  | 'ok'
  /** Sin candidato de origen: se ofrece igual y se crea uno al primer clic. */
  | 'needs_source_candidate'
  | 'contact_unavailable'
  | 'missing_source_candidate'
  | 'candidate_unavailable'
  | 'not_linked'
  | 'not_hubspot_candidate'
  | 'unauthorized_role';

export interface OfficialContactChannelOffer {
  reason: OfficialContactChannelOfferReason;
  candidateId: string | null;
  email: boolean;
  linkedin: boolean;
  /** «Verificar correo»: ya tiene correo y hay un LinkedIn con qué preguntar. */
  verifyEmail: boolean;
  /** Hay que crear el candidato de origen antes de gastar (contacto sin candidato). */
  needsSourceCandidate: boolean;
}

function clean(value: string | null | undefined): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? v : null;
}

const NONE = (reason: OfficialContactChannelOfferReason, candidateId: string | null = null): OfficialContactChannelOffer => ({
  reason,
  candidateId,
  email: false,
  linkedin: false,
  verifyEmail: false,
  needsSourceCandidate: false,
});

/** ¿El candidato es de verdad el origen aprobado de este contacto? (fail-closed) */
export function resolveDurableSourceCandidate(
  contact: OfficialContactForChannelReveal | null,
  candidate: SourceCandidateForChannelReveal | null,
): { ok: true; candidateId: string } | { ok: false; reason: Exclude<OfficialContactChannelOfferReason, 'ok' | 'needs_source_candidate' | 'unauthorized_role' | 'not_hubspot_candidate'> } {
  if (!contact || clean(contact.archivedAt)) return { ok: false, reason: 'contact_unavailable' };
  const link = resolveOfficialContactSourceCandidateId(contact.metadata);
  if (link.kind !== 'resolved') return { ok: false, reason: 'missing_source_candidate' };
  if (!candidate || candidate.id !== link.candidateId) return { ok: false, reason: 'candidate_unavailable' };
  if (candidate.status !== 'approved' || candidate.matchedContactsId !== contact.id) return { ok: false, reason: 'not_linked' };
  return { ok: true, candidateId: candidate.id };
}

/** El dato con el que se busca: el del candidato o, si no lo tiene, el del contacto. */
export function mergedSearchChannels(
  contact: Pick<OfficialContactForChannelReveal, 'email' | 'linkedinUrl'>,
  candidate: Pick<SourceCandidateForChannelReveal, 'email' | 'linkedinUrl'> | null,
): { email: string | null; linkedinUrl: string | null } {
  return {
    email: clean(candidate?.email) ?? clean(contact.email),
    linkedinUrl: clean(candidate?.linkedinUrl) ?? clean(contact.linkedinUrl),
  };
}

/**
 * Qué se ofrece en la ficha. SOLO LECTURA. Se ofrece un canal cuando al CONTACTO le falta y hay
 * con qué buscarlo (correo → LinkedIn, LinkedIn → correo) sin un intento previo sin fruto con los
 * mismos datos. «Verificar correo» cuando el contacto ya tiene correo y hay LinkedIn.
 */
export function classifyOfficialContactChannelOffer(input: {
  contact: OfficialContactForChannelReveal | null;
  candidate: SourceCandidateForChannelReveal | null;
  roleAuthorized: boolean;
}): OfficialContactChannelOffer {
  const contact = input.contact;
  if (!contact || clean(contact.archivedAt)) return NONE('contact_unavailable');
  const link = resolveOfficialContactSourceCandidateId(contact.metadata);

  // Sin candidato de origen (creado a mano o traído antes de #904): se ofrece con lo que tiene
  // el contacto; el servidor crea el candidato al primer clic. Un vínculo ROTO (apunta a algo que
  // no es su candidato aprobado) no se repara aquí: fail-closed, como siempre.
  if (link.kind === 'missing') {
    if (!input.roleAuthorized) return NONE('unauthorized_role');
    const evaluation = evaluateCandidateIdentityCompletion(
      { email: contact.email, linkedinUrl: contact.linkedinUrl, source: 'manual' },
      { anySource: true },
    );
    return {
      reason: 'needs_source_candidate',
      candidateId: null,
      email: evaluation.canRevealEmail,
      linkedin: evaluation.canRevealLinkedin,
      verifyEmail: evaluation.hasEmail && evaluation.hasLinkedin,
      needsSourceCandidate: true,
    };
  }

  const durable = resolveDurableSourceCandidate(contact, input.candidate);
  if (!durable.ok) return NONE(durable.reason);
  const candidate = input.candidate as SourceCandidateForChannelReveal;
  if (!input.roleAuthorized) return NONE('unauthorized_role', candidate.id);

  const merged = mergedSearchChannels(contact, candidate);
  const evaluation = evaluateCandidateIdentityCompletion(
    {
      email: merged.email,
      linkedinUrl: merged.linkedinUrl,
      apolloPersonId: candidate.apolloPersonId,
      source: candidate.source,
      sourceContactId: candidate.sourceContactId,
      enrichmentMetadata: candidate.enrichmentMetadata,
    },
    { anySource: true },
  );
  const contactHasEmail = !!clean(contact.email);
  return {
    reason: 'ok',
    candidateId: candidate.id,
    // Si el candidato YA tiene el dato que le falta al contacto, no se paga: se copia gratis.
    email: !contactHasEmail && evaluation.canRevealEmail,
    linkedin: !clean(contact.linkedinUrl) && evaluation.canRevealLinkedin,
    verifyEmail: contactHasEmail && evaluation.hasLinkedin,
    needsSourceCandidate: false,
  };
}

/** Lo que el candidato ya tiene y al contacto le falta: sólo campos VACÍOS del contacto. */
export function planOfficialContactChannelFill(input: {
  contact: Pick<OfficialContactForChannelReveal, 'email' | 'linkedinUrl'>;
  candidate: Pick<SourceCandidateForChannelReveal, 'email' | 'linkedinUrl'>;
}): { email?: string; linkedin_url?: string } {
  const patch: { email?: string; linkedin_url?: string } = {};
  const email = clean(input.candidate.email);
  const linkedin = clean(input.candidate.linkedinUrl);
  if (email && !clean(input.contact.email)) patch.email = email;
  if (linkedin && !clean(input.contact.linkedinUrl)) patch.linkedin_url = linkedin;
  return patch;
}

/** Lo que el contacto tiene y al candidato le falta (para buscar con ello): sólo vacíos. */
export function planCandidateChannelFillFromContact(input: {
  contact: Pick<OfficialContactForChannelReveal, 'email' | 'linkedinUrl'>;
  candidate: Pick<SourceCandidateForChannelReveal, 'email' | 'linkedinUrl'>;
}): { email?: string; linkedin_url?: string } {
  return planOfficialContactChannelFill({ contact: input.candidate, candidate: input.contact });
}

// ── Candidato de origen para un contacto que no tenía ───────────────

/** `summary.entry_mode` de la corrida interna (oculta en el historial de búsquedas). */
export const OFFICIAL_CONTACT_SOURCE_ENTRY_MODE = 'official_contact_source' as const;

export interface OfficialContactForSourceAttach {
  id: string;
  accountId: string;
  accountName: string | null;
  accountDomain: string | null;
  accountCountryCode: string | null;
  accountHubSpotCompanyId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  email: string | null;
  linkedinUrl: string | null;
  jobTitle: string | null;
  hubspotContactId: string | null;
}

export function buildOfficialContactSourceRunRow(contact: OfficialContactForSourceAttach, triggeredBy: string) {
  return {
    account_id: contact.accountId,
    company_name: clean(contact.accountName) ?? 'Empresa',
    company_domain: clean(contact.accountDomain),
    company_country_code: clean(contact.accountCountryCode),
    hubspot_company_id: clean(contact.accountHubSpotCompanyId),
    status: 'completed' as const,
    triggered_by: triggeredBy,
    providers_used: [] as string[],
    summary: {
      entry_mode: OFFICIAL_CONTACT_SOURCE_ENTRY_MODE,
      contact_id: contact.id,
      totalCandidates: 1,
      candidates_created: 1,
      hito: 'AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE',
    },
  };
}

/**
 * El candidato de origen: YA aprobado y apuntando a este contacto (no pasa por la aprobación: el
 * contacto ya existe). De HubSpot si el contacto está vinculado (así lo revelado viaja a ese
 * contacto de HubSpot); si no, «manual».
 */
export function buildOfficialContactSourceCandidateRow(
  contact: OfficialContactForSourceAttach,
  runId: string,
  reviewedBy: string,
  nowIso: string,
) {
  const hubspotId = clean(contact.hubspotContactId);
  return {
    enrichment_run_id: runId,
    first_name: clean(contact.firstName),
    last_name: clean(contact.lastName),
    full_name: contact.fullName.trim() || 'Contacto',
    title: clean(contact.jobTitle),
    seniority: null,
    department: null,
    country: null,
    linkedin_url: clean(contact.linkedinUrl),
    email: clean(contact.email)?.toLowerCase() ?? null,
    // Sin teléfono: el del contacto no tiene procedencia de proveedor.
    phone: null,
    source: hubspotId ? ('hubspot' as const) : ('manual' as const),
    source_contact_id: hubspotId,
    matched_hubspot_contact_id: hubspotId,
    matched_contacts_id: contact.id,
    confidence: 1,
    status: 'approved' as const,
    duplicate_status: 'no_match' as const,
    reviewed_by: reviewedBy,
    reviewed_at: nowIso,
    enrichment_metadata: {
      official_contact_source: true,
      contact_id: contact.id,
      ...(hubspotId ? { hubspot_contact_id: hubspotId } : {}),
      hito: 'AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE',
    },
  };
}

export const OFFICIAL_CHANNEL_REVEAL_COPY = {
  emailCompleted: 'Correo encontrado: quedó en el contacto y en HubSpot (si allá estaba vacío).',
  linkedinCompleted: 'LinkedIn encontrado: quedó en el contacto y en HubSpot (si allá estaba vacío).',
} as const;
