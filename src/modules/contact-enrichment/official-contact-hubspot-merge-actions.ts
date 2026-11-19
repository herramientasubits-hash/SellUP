'use server';

// Agente 2A — «Fusionar en HubSpot» desde la ficha del contacto OFICIAL
// (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE, Bryan 19-11).
//
//   * `getOfficialContactHubSpotMergeOfferAction` — si «Verificar correo» dejó un 409 (otro contacto
//     de HubSpot ya tiene el correo correcto), quién lo tiene. SOLO LECTURA.
//   * `mergeOfficialContactInHubSpotAction` — tras la confirmación: fusiona en HubSpot dejando como
//     principal al contacto que tiene el correo y repunta SellUp al registro resultante.
//
// Mismo alcance que «Verificar correo»: quien puede abrir la ficha y tiene el rol de reveal.

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/modules/access/actions';
import { requireActiveActor } from './current-actor.server';
import { canSeeOfficialContact } from './candidate-scope.server';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import { getHubSpotMergeOffer, runHubSpotMergeForContact } from './contact-hubspot-merge.server';
import { hubspotMergeOutcomeText, type HubSpotMergeOffer, type HubSpotMergeOutcome } from './contact-hubspot-merge-core';

export async function getOfficialContactHubSpotMergeOfferAction(input: { contactId: string }): Promise<HubSpotMergeOffer> {
  try {
    const contactId = typeof input?.contactId === 'string' ? input.contactId.trim() : '';
    const { roleKey } = await requireActiveActor();
    if (!contactId || !isPhoneRevealRoleAuthorized(roleKey)) return { status: 'none' };
    if (!(await canSeeOfficialContact(await createClient(), contactId))) return { status: 'none' };
    return await getHubSpotMergeOffer(contactId);
  } catch {
    return { status: 'none' };
  }
}

export interface MergeOfficialContactInHubSpotResult {
  ok: boolean;
  outcome: HubSpotMergeOutcome | 'unauthorized' | 'error';
  message: string;
  /** Otros contactos de SellUp vinculados al mismo contacto de HubSpot (pendiente de unificar). */
  otherSellupContacts: number;
}

export async function mergeOfficialContactInHubSpotAction(input: { contactId: string }): Promise<MergeOfficialContactInHubSpotResult> {
  const contactId = typeof input?.contactId === 'string' ? input.contactId.trim() : '';
  const { internalUserId, roleKey } = await requireActiveActor();
  const unauthorized: MergeOfficialContactInHubSpotResult = {
    ok: false,
    outcome: 'unauthorized',
    message: 'No tienes permiso para fusionar este contacto.',
    otherSellupContacts: 0,
  };
  if (!contactId || !isPhoneRevealRoleAuthorized(roleKey)) return unauthorized;
  if (!(await canSeeOfficialContact(await createClient(), contactId))) return unauthorized;

  const user = await getCurrentUser().catch(() => null);
  const report = await runHubSpotMergeForContact({
    contactId,
    actorId: internalUserId,
    actorEmail: user?.email ?? null,
  });
  if (!report) {
    return { ok: false, outcome: 'error', message: 'No pudimos completar la fusión. Vuelve a abrir la ficha.', otherSellupContacts: 0 };
  }
  const ok = report.outcome === 'merged' || report.outcome === 'promoted_on_retry' || report.outcome === 'already_same';
  return {
    ok,
    outcome: report.outcome,
    message: hubspotMergeOutcomeText(report.outcome, report.httpStatus),
    otherSellupContacts: report.otherSellupContactIds.length,
  };
}
