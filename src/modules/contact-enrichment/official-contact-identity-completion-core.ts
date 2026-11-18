// Agente 2A — «Revelar correo» / «Revelar LinkedIn» desde la ficha del contacto OFICIAL
// (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE, Bryan 17-11).
//
// Núcleo PURO. El contacto traído de HubSpot (o aprobado desde «Primero HubSpot») nace de un
// candidato de HubSpot; lo que el candidato sabe revelar (identity completion) se ofrece ahora
// también en la ficha del contacto, reutilizando el MISMO pipeline: mismos proveedores, mismo
// costo, mismo «otro nombre ⇒ no se guarda», mismo «intento sin fruto ⇒ no se vuelve a ofrecer».
//
// Sólo con la prueba durable del origen: `contacts.metadata.source_candidate_id` apunta al
// candidato, el candidato está APROBADO y su `matched_contacts_id` es este contacto. Lo revelado
// se escribe en el candidato (y de ahí a HubSpot, sólo vacíos) y luego se lleva al contacto, sólo
// a los campos que estén vacíos.

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
});

/** ¿El candidato es de verdad el origen aprobado de este contacto? (fail-closed) */
export function resolveDurableSourceCandidate(
  contact: OfficialContactForChannelReveal | null,
  candidate: SourceCandidateForChannelReveal | null,
): { ok: true; candidateId: string } | { ok: false; reason: Exclude<OfficialContactChannelOfferReason, 'ok' | 'unauthorized_role' | 'not_hubspot_candidate'> } {
  if (!contact || clean(contact.archivedAt)) return { ok: false, reason: 'contact_unavailable' };
  const link = resolveOfficialContactSourceCandidateId(contact.metadata);
  if (link.kind !== 'resolved') return { ok: false, reason: 'missing_source_candidate' };
  if (!candidate || candidate.id !== link.candidateId) return { ok: false, reason: 'candidate_unavailable' };
  if (candidate.status !== 'approved' || candidate.matchedContactsId !== contact.id) return { ok: false, reason: 'not_linked' };
  return { ok: true, candidateId: candidate.id };
}

/**
 * Qué se ofrece en la ficha. SOLO LECTURA. Se ofrece un canal cuando al CONTACTO le falta y el
 * candidato tiene con qué buscarlo (correo → LinkedIn, LinkedIn → correo) sin un intento previo
 * sin fruto.
 */
export function classifyOfficialContactChannelOffer(input: {
  contact: OfficialContactForChannelReveal | null;
  candidate: SourceCandidateForChannelReveal | null;
  roleAuthorized: boolean;
}): OfficialContactChannelOffer {
  const durable = resolveDurableSourceCandidate(input.contact, input.candidate);
  if (!durable.ok) return NONE(durable.reason);
  const candidate = input.candidate as SourceCandidateForChannelReveal;
  const contact = input.contact as OfficialContactForChannelReveal;
  if (clean(candidate.source)?.toLowerCase() !== 'hubspot') return NONE('not_hubspot_candidate', candidate.id);
  if (!input.roleAuthorized) return NONE('unauthorized_role', candidate.id);

  const evaluation = evaluateCandidateIdentityCompletion({
    email: candidate.email,
    linkedinUrl: candidate.linkedinUrl,
    apolloPersonId: candidate.apolloPersonId,
    source: candidate.source,
    sourceContactId: candidate.sourceContactId,
    enrichmentMetadata: candidate.enrichmentMetadata,
  });
  return {
    reason: 'ok',
    candidateId: candidate.id,
    email: !clean(contact.email) && evaluation.canRevealEmail,
    linkedin: !clean(contact.linkedinUrl) && evaluation.canRevealLinkedin,
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

export const OFFICIAL_CHANNEL_REVEAL_COPY = {
  emailCompleted: 'Correo encontrado: quedó en el contacto y en HubSpot (si allá estaba vacío).',
  linkedinCompleted: 'LinkedIn encontrado: quedó en el contacto y en HubSpot (si allá estaba vacío).',
} as const;
