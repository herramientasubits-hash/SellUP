'use server';

// Agente 2A — «Revelar correo» / «Revelar LinkedIn» / «Verificar correo» desde la ficha del
// contacto OFICIAL (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE, Bryan 17-11; ampliado en
// AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
//   * `getOfficialContactChannelRevealOfferAction` — qué ofrecer y qué se sabe del empleo y del
//     correo. SOLO LECTURA.
//   * `revealOfficialContactChannelAction` — un clic: identifica con el candidato de origen (el
//     mismo pipeline del candidato: Apollo y, si no trae lo que falta, Lusha), guarda en el
//     candidato, lo envía a HubSpot (sólo vacíos) y lo lleva al contacto (sólo vacíos). Un correo
//     de OTRA empresa no se guarda: queda como cambio de empresa detectado.
//   * `verifyOfficialContactEmailAction` — «Verificar correo» (ya tiene correo y LinkedIn): pregunta
//     dónde trabaja hoy y su correo, y aplica según el caso (principal, personal o cambio de empresa).
//   * `keepOfficialContactAtCompanyAction` — «Sigue aquí» ante señales contradictorias.
//
// El alcance es el del CONTACTO (`canSeeOfficialContact`): quien puede abrir la ficha puede
// completarla, igual que «Revelar teléfono» en esa misma ficha. El rol se revalida en el núcleo.

import { createClient } from '@/lib/supabase/server';
import { requireActiveActor } from './current-actor.server';
import { canSeeOfficialContact } from './candidate-scope.server';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import type { IdentityCompletionStatus } from './candidate-identity-completion-core';
import {
  runEmailVerificationForCandidate,
  runIdentityCompletionForCandidate,
} from './candidate-identity-completion-runner.server';
import {
  classifyOfficialContactChannelOffer,
  type OfficialContactChannel,
  type OfficialContactForChannelReveal,
  type SourceCandidateForChannelReveal,
} from './official-contact-identity-completion-core';
import {
  ensureOfficialContactSourceCandidate,
  fillSourceCandidateChannelsFromContact,
  readContactWithSourceCandidate,
  syncApprovedCandidateChannelsOntoContact,
} from './official-contact-identity-completion.server';
import {
  EMPTY_OFFICIAL_CONTACT_EMAIL_STATE,
  buildOfficialContactEmailState,
  type OfficialContactEmailState,
} from './official-contact-email-check-view';
import { readEmailCheckBlock, type EmailChangeCase } from './email-change-classifier-core';
import {
  applyPersonalEmail,
  applySameCompanyNewEmail,
  markEmailCheckResolution,
} from './official-contact-email-check.server';
import { loadCompanyChangeContact } from './contact-company-change.server';

export interface OfficialContactChannelRevealOfferView {
  email: boolean;
  linkedin: boolean;
  /** «Verificar correo». */
  verifyEmail: boolean;
  /** Empleo actual y última verificación del correo (del candidato de origen). */
  emailState: OfficialContactEmailState;
}

const NO_OFFER: OfficialContactChannelRevealOfferView = {
  email: false,
  linkedin: false,
  verifyEmail: false,
  emailState: EMPTY_OFFICIAL_CONTACT_EMAIL_STATE,
};

export async function getOfficialContactChannelRevealOfferAction(input: {
  contactId: string;
}): Promise<OfficialContactChannelRevealOfferView> {
  try {
    const contactId = typeof input?.contactId === 'string' ? input.contactId.trim() : '';
    const { roleKey } = await requireActiveActor();
    if (!contactId || !(await canSeeOfficialContact(await createClient(), contactId))) return NO_OFFER;
    const { contact, candidate } = await readContactWithSourceCandidate(contactId);
    const offer = classifyOfficialContactChannelOffer({
      contact,
      candidate,
      roleAuthorized: isPhoneRevealRoleAuthorized(roleKey),
    });
    // El empleo y la verificación se leen aunque no haya nada que ofrecer (p. ej. sin rol).
    const linked = !!candidate && !!contact && candidate.matchedContactsId === contact.id;
    return {
      email: offer.email,
      linkedin: offer.linkedin,
      verifyEmail: offer.verifyEmail,
      emailState: linked ? buildOfficialContactEmailState(candidate.enrichmentMetadata) : EMPTY_OFFICIAL_CONTACT_EMAIL_STATE,
    };
  } catch {
    return NO_OFFER;
  }
}

/**
 * El contacto y su candidato de origen, listos para gastar: si el contacto no tenía candidato se le
 * crea uno; y el candidato recibe el correo / LinkedIn del contacto que le falten (para buscar con
 * ellos). Devuelve la oferta recalculada sobre ese estado.
 */
async function prepareSourceCandidate(
  contactId: string,
  actor: { internalUserId: string; roleKey: string | null },
): Promise<{
  contact: OfficialContactForChannelReveal | null;
  candidate: SourceCandidateForChannelReveal | null;
  offer: ReturnType<typeof classifyOfficialContactChannelOffer>;
}> {
  const roleAuthorized = isPhoneRevealRoleAuthorized(actor.roleKey);
  let { contact, candidate } = await readContactWithSourceCandidate(contactId);
  let offer = classifyOfficialContactChannelOffer({ contact, candidate, roleAuthorized });
  if (offer.needsSourceCandidate) {
    await ensureOfficialContactSourceCandidate(contactId, actor.internalUserId);
    ({ contact, candidate } = await readContactWithSourceCandidate(contactId));
    offer = classifyOfficialContactChannelOffer({ contact, candidate, roleAuthorized });
  }
  if (contact && candidate && offer.reason === 'ok') {
    candidate = await fillSourceCandidateChannelsFromContact(contact, candidate);
    offer = classifyOfficialContactChannelOffer({ contact, candidate, roleAuthorized });
  }
  return { contact, candidate, offer };
}

export interface OfficialContactChannelRevealResult {
  ok: boolean;
  status: IdentityCompletionStatus | 'not_offered';
  /** El dato quedó en el contacto. */
  contactUpdated: boolean;
}

export async function revealOfficialContactChannelAction(input: {
  contactId: string;
  channel: OfficialContactChannel;
}): Promise<OfficialContactChannelRevealResult> {
  const contactId = typeof input?.contactId === 'string' ? input.contactId.trim() : '';
  const channel: OfficialContactChannel | null =
    input?.channel === 'email' || input?.channel === 'linkedin' ? input.channel : null;
  const { internalUserId, roleKey } = await requireActiveActor();
  if (!contactId || !channel || !(await canSeeOfficialContact(await createClient(), contactId))) {
    return { ok: false, status: 'candidate_not_found', contactUpdated: false };
  }

  try {
    const { offer } = await prepareSourceCandidate(contactId, { internalUserId, roleKey });
    if (offer.reason === 'unauthorized_role') return { ok: false, status: 'unauthorized_role', contactUpdated: false };
    // Lo mismo que se ofreció: nada que no se pudiera ver en la ficha gasta un crédito. Si el
    // candidato ya tenía el dato (se copia gratis), se sincroniza sin gastar.
    if (!offer.candidateId) return { ok: false, status: 'not_offered', contactUpdated: false };
    const field = channel === 'email' ? 'email' : 'linkedin_url';
    if (!offer[channel]) {
      const synced = await syncApprovedCandidateChannelsOntoContact(offer.candidateId);
      return synced.updated.includes(field)
        ? { ok: true, status: 'nothing_to_complete', contactUpdated: true }
        : { ok: false, status: 'not_offered', contactUpdated: false };
    }

    const result = await runIdentityCompletionForCandidate(
      offer.candidateId,
      channel,
      { internalUserId, roleKey },
      { allowApproved: true, allowAnySource: true, surface: 'official_contact' },
    );
    if (result.status !== 'completed' && result.status !== 'nothing_to_complete') {
      return { ok: false, status: result.status, contactUpdated: false };
    }
    const synced = await syncApprovedCandidateChannelsOntoContact(offer.candidateId);
    return { ok: true, status: result.status, contactUpdated: synced.updated.includes(field) };
  } catch {
    return { ok: false, status: 'provider_error', contactUpdated: false };
  }
}

// ── «Verificar correo» ──────────────────────────────────────────────

export type VerifyOfficialContactEmailStatus =
  | 'checked'
  | 'not_found'
  | 'not_offered'
  | 'unauthorized_role'
  | 'identity_mismatch'
  | 'provider_unavailable'
  | 'provider_error';

export interface VerifyOfficialContactEmailResult {
  ok: boolean;
  status: VerifyOfficialContactEmailStatus;
  case: EmailChangeCase | null;
  /** Desenlace en HubSpot cuando se aplicó un correo (sin valores). */
  hubspot: string | null;
}

export async function verifyOfficialContactEmailAction(input: { contactId: string }): Promise<VerifyOfficialContactEmailResult> {
  const contactId = typeof input?.contactId === 'string' ? input.contactId.trim() : '';
  const { internalUserId, roleKey } = await requireActiveActor();
  const fail = (status: VerifyOfficialContactEmailStatus): VerifyOfficialContactEmailResult => ({
    ok: false,
    status,
    case: null,
    hubspot: null,
  });
  if (!contactId || !(await canSeeOfficialContact(await createClient(), contactId))) return fail('not_offered');

  try {
    const { contact, offer } = await prepareSourceCandidate(contactId, { internalUserId, roleKey });
    if (offer.reason === 'unauthorized_role') return fail('unauthorized_role');
    if (!contact || !offer.candidateId || !offer.verifyEmail) return fail('not_offered');

    const full = await loadCompanyChangeContact(contactId);
    const verified = await runEmailVerificationForCandidate(
      offer.candidateId,
      { internalUserId, roleKey },
      {
        currentEmail: contact.email,
        linkedinUrl: contact.linkedinUrl,
        companyDomains: [full?.accountDomain ?? null],
      },
      { allowApproved: true, surface: 'official_contact' },
    );
    if (verified.status === 'unauthorized_role') return fail('unauthorized_role');
    if (verified.status === 'identity_mismatch') return fail('identity_mismatch');
    if (verified.status === 'provider_unavailable') return fail('provider_unavailable');
    if (!verified.check || (verified.status !== 'checked' && verified.status !== 'not_found')) return fail('provider_error');

    const check = verified.check;
    let hubspot: string | null = null;
    if (check.case === 'same_company_new_email' && check.found_email) {
      hubspot = (
        await applySameCompanyNewEmail({
          contactId,
          candidateId: offer.candidateId,
          newEmail: check.found_email,
          actorId: internalUserId,
        })
      ).hubspot;
    } else if (check.case === 'personal_email' && check.found_email) {
      hubspot = (
        await applyPersonalEmail({
          contactId,
          candidateId: offer.candidateId,
          email: check.found_email,
          provider: check.provider,
          actorId: internalUserId,
        })
      ).hubspot;
    }
    return { ok: true, status: verified.status === 'checked' ? 'checked' : 'not_found', case: check.case, hubspot };
  } catch {
    return fail('provider_error');
  }
}

/**
 * «Sigue aquí»: ante señales contradictorias, si el proveedor trajo OTRO correo, se usa como el
 * principal (es de una persona que sigue en la empresa); en los demás casos sólo se descarta el
 * aviso de cambio de empresa.
 */
export async function keepOfficialContactAtCompanyAction(input: {
  contactId: string;
}): Promise<{ ok: boolean; applied: boolean; hubspot: string | null }> {
  const contactId = typeof input?.contactId === 'string' ? input.contactId.trim() : '';
  const { internalUserId, roleKey } = await requireActiveActor();
  if (!contactId || !isPhoneRevealRoleAuthorized(roleKey) || !(await canSeeOfficialContact(await createClient(), contactId))) {
    return { ok: false, applied: false, hubspot: null };
  }
  try {
    const { contact, candidate } = await readContactWithSourceCandidate(contactId);
    if (!contact || !candidate || candidate.matchedContactsId !== contact.id || contact.archivedAt) {
      return { ok: false, applied: false, hubspot: null };
    }
    const check = readEmailCheckBlock(candidate.enrichmentMetadata);
    if (!check || check.resolution !== null) return { ok: false, applied: false, hubspot: null };
    const current = contact.email?.trim().toLowerCase() ?? null;
    // Sólo ante señales CONTRADICTORIAS el correo encontrado es de la persona en esta empresa. Un
    // «cambio de empresa» descartado no convierte en principal un correo de otra empresa.
    if (check.case === 'conflicting' && check.found_email && check.found_email !== current) {
      const report = await applySameCompanyNewEmail({
        contactId,
        candidateId: candidate.id,
        newEmail: check.found_email,
        actorId: internalUserId,
      });
      return { ok: report.contactUpdated, applied: report.contactUpdated, hubspot: report.hubspot };
    }
    await markEmailCheckResolution(candidate.id, 'dismissed', internalUserId);
    return { ok: true, applied: false, hubspot: null };
  } catch {
    return { ok: false, applied: false, hubspot: null };
  }
}
