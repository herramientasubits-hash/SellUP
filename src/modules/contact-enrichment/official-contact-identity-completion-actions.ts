'use server';

// Agente 2A — «Revelar correo» / «Revelar LinkedIn» desde la ficha del contacto OFICIAL
// (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE, Bryan 17-11).
//
//   * `getOfficialContactChannelRevealOfferAction` — qué ofrecer. SOLO LECTURA.
//   * `revealOfficialContactChannelAction` — un clic: identifica con el candidato de origen (el
//     mismo pipeline del candidato: Apollo y, si no trae lo que falta, Lusha), guarda en el
//     candidato, lo envía a HubSpot (sólo vacíos) y lo lleva al contacto (sólo vacíos).
//
// El alcance es el del CONTACTO (`canSeeOfficialContact`): quien puede abrir la ficha puede
// completarla, igual que «Revelar teléfono» en esa misma ficha. El rol se revalida en el núcleo.

import { createClient } from '@/lib/supabase/server';
import { requireActiveActor } from './current-actor.server';
import { canSeeOfficialContact } from './candidate-scope.server';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import type { IdentityCompletionStatus } from './candidate-identity-completion-core';
import { runIdentityCompletionForCandidate } from './candidate-identity-completion-runner.server';
import {
  classifyOfficialContactChannelOffer,
  type OfficialContactChannel,
} from './official-contact-identity-completion-core';
import {
  readContactWithSourceCandidate,
  syncApprovedCandidateChannelsOntoContact,
} from './official-contact-identity-completion.server';

export interface OfficialContactChannelRevealOfferView {
  email: boolean;
  linkedin: boolean;
}

const NO_OFFER: OfficialContactChannelRevealOfferView = { email: false, linkedin: false };

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
    return { email: offer.email, linkedin: offer.linkedin };
  } catch {
    return NO_OFFER;
  }
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
    const { contact, candidate } = await readContactWithSourceCandidate(contactId);
    const offer = classifyOfficialContactChannelOffer({
      contact,
      candidate,
      roleAuthorized: isPhoneRevealRoleAuthorized(roleKey),
    });
    if (offer.reason === 'unauthorized_role') return { ok: false, status: 'unauthorized_role', contactUpdated: false };
    // Lo mismo que se ofreció: nada que no se pudiera ver en la ficha gasta un crédito.
    if (!offer.candidateId || !offer[channel]) return { ok: false, status: 'not_offered', contactUpdated: false };

    const result = await runIdentityCompletionForCandidate(
      offer.candidateId,
      channel,
      { internalUserId, roleKey },
      { allowApproved: true },
    );
    if (result.status !== 'completed' && result.status !== 'nothing_to_complete') {
      return { ok: false, status: result.status, contactUpdated: false };
    }
    const synced = await syncApprovedCandidateChannelsOntoContact(offer.candidateId);
    const field = channel === 'email' ? 'email' : 'linkedin_url';
    return { ok: true, status: result.status, contactUpdated: synced.updated.includes(field) };
  } catch {
    return { ok: false, status: 'provider_error', contactUpdated: false };
  }
}
