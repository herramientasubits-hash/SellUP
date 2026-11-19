// Agente 2A — El cambio de empresa de un contacto oficial: el trabajo, sin la frontera de acciones
// (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11; empresa elegida a mano en la
// «Revisión», AGENT2A-CONTACT-APPROVED-REVIEW, Bryan 19-11).
//
// NO es un módulo `'use server'` a propósito: lo que exporta NO valida sesión, alcance ni rol, así
// que no puede ser una acción que el navegador invoque. Lo llaman `confirmOfficialContactCompanyChangeAction`
// y `moveOfficialContactCompanyAction`, que validan antes.
//
// Orden: primero se crea el candidato nuevo; si eso falla, NO se toca nada más (ni HubSpot ni el
// archivo). Después HubSpot (best-effort, nunca bloquea) y al final el archivo.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logContactAudit } from '@/modules/contacts/contact-audit.server';
import { canonicalLinkedin } from './candidate-identity-completion-core';
import { hasPendingCompanyChange, readEmailCheckBlock } from './email-change-classifier-core';
import type { CompanyCandidate } from './types';
import { readContactWithSourceCandidate } from './official-contact-identity-completion.server';
import { markEmailCheckResolution } from './official-contact-email-check.server';
import {
  COMPANY_CHANGE_COPY,
  buildCandidateCompanyChangeBlock,
  buildCompanyChangeArchivePatch,
  buildCompanyChangeSearchData,
  buildContactCompanyChangeBlock,
  buildManualCompanyChangeCheck,
  companyChangeNewCompanyName,
  evaluateCompanyChangeConfirmation,
  isCurrentCompany,
  planCompanyChangeHubSpotPush,
  resolveCompanyChangeHubSpotContactId,
  COMPANY_CHANGE_METADATA_KEY,
} from './contact-company-change-core';
import {
  createCompanyChangeCandidate,
  loadCompanyChangeContact,
  loadCompanyChangePhones,
  loadCompanyChangeSourceCandidate,
  markCompanyChangeCandidateOpenIfOwnerless,
  pushCompanyChangeToHubSpot,
  resolveCompanyChangeCompany,
} from './contact-company-change.server';

export type ConfirmCompanyChangeResult =
  | {
      ok: true;
      candidateId: string;
      companyName: string | null;
      companyAssigned: boolean;
      message: string;
    }
  | {
      ok: false;
      code:
        | 'not_offered'
        | 'unauthorized_role'
        | 'no_pending_change'
        | 'same_company'
        | 'already_pending'
        | 'missing_linkedin'
        | 'error';
      message: string;
    };

/**
 * El cambio de empresa con la empresa elegida A MANO desde la «Revisión» del contacto
 * (AGENT2A-CONTACT-APPROVED-REVIEW, Bryan 19-11, opción A): la empresa es de otro dueño, no tiene
 * dueño o no existe en SellUp. Mismo flujo que el cambio detectado; si no hay una detección
 * pendiente, el candidato nuevo lleva el correo de hoy (nadie trajo otro). La acción que lo llama
 * ya validó el contacto, el rol y la decisión.
 */
export async function runManualCompanyChangeForContact(
  contactId: string,
  actorId: string,
  company: CompanyCandidate,
): Promise<ConfirmCompanyChangeResult> {
  return runContactCompanyChange(contactId, actorId, company);
}

export async function runContactCompanyChange(
  contactId: string,
  internalUserId: string,
  explicitCompany: CompanyCandidate | null,
): Promise<ConfirmCompanyChangeResult> {
  try {
    const { contact: channelContact, candidate: channelCandidate } = await readContactWithSourceCandidate(contactId);
    if (!channelContact || !channelCandidate || channelCandidate.matchedContactsId !== channelContact.id) {
      return { ok: false, code: 'no_pending_change', message: COMPANY_CHANGE_COPY.noPendingChange };
    }
    const detected = readEmailCheckBlock(channelCandidate.enrichmentMetadata);
    const loaded = await loadCompanyChangeContact(contactId);
    const source = await loadCompanyChangeSourceCandidate(channelCandidate.id);
    // El LinkedIn del contacto o, si no lo tiene, el de su candidato.
    const contact = loaded ? { ...loaded, linkedinUrl: loaded.linkedinUrl ?? source?.linkedinUrl ?? null } : null;
    const nowIsoForCheck = new Date().toISOString();
    // Con empresa elegida a mano no hace falta una detección: si no la hay (o ya se resolvió), se
    // usa una con el correo de hoy y la empresa elegida.
    const check =
      explicitCompany && contact && !hasPendingCompanyChange(detected)
        ? buildManualCompanyChangeCheck({ contact, company: explicitCompany, actorId: internalUserId, nowIso: nowIsoForCheck })
        : detected;
    const gate = explicitCompany
      ? contact && !contact.archivedAt
        ? ({ ok: true } as const)
        : ({ ok: false, reason: 'contact_unavailable' } as const)
      : evaluateCompanyChangeConfirmation({ contact, check });
    if (!gate.ok || !contact || !check) {
      const reason = gate.ok ? 'no_pending_change' : gate.reason;
      if (reason === 'missing_linkedin') return { ok: false, code: 'missing_linkedin', message: COMPANY_CHANGE_COPY.missingLinkedin };
      return { ok: false, code: 'no_pending_change', message: COMPANY_CHANGE_COPY.noPendingChange };
    }
    if (!explicitCompany && !canonicalLinkedin(contact.linkedinUrl)) {
      return { ok: false, code: 'missing_linkedin', message: COMPANY_CHANGE_COPY.missingLinkedin };
    }

    // 1. Empresa nueva: la elegida a mano o, si no, sólo empresas que existen (HubSpot primero,
    //    luego SellUp; coincidencia única).
    const resolution = explicitCompany ? null : await resolveCompanyChangeCompany(check);
    const company = explicitCompany ?? (resolution?.status === 'resolved' ? resolution.company : null);
    if (isCurrentCompany(company, contact)) {
      return { ok: false, code: 'same_company', message: COMPANY_CHANGE_COPY.sameCompany };
    }

    // 2. Candidato «Por revisar» en la empresa nueva, vinculado al MISMO contacto de HubSpot.
    const nowIso = new Date().toISOString();
    const hubspotContactId = resolveCompanyChangeHubSpotContactId(contact, source);
    // Bryan 19-11: TODOS sus teléfonos viajan al candidato (quien revisa decide cuál sirve).
    const phones = await loadCompanyChangePhones(contact.id).catch(() => []);
    const created = await createCompanyChangeCandidate({
      data: buildCompanyChangeSearchData({ contact, candidate: source, check, hubspotContactId, nowIso, phones }),
      company,
      companyMatchedBy: resolution?.status === 'resolved' ? resolution.matchedBy : null,
      actorId: internalUserId,
      candidateMetadata: {
        [COMPANY_CHANGE_METADATA_KEY]: buildCandidateCompanyChangeBlock({
          contact,
          check,
          hubspotContactId,
          actorId: internalUserId,
          nowIso,
          phones,
        }),
      },
    });
    if (!created.ok) {
      return created.error === 'already_pending'
        ? { ok: false, code: 'already_pending', message: COMPANY_CHANGE_COPY.alreadyPending }
        : { ok: false, code: 'error', message: COMPANY_CHANGE_COPY.error };
    }

    // Bryan 19-11 (§ 6): si la empresa nueva no tiene dueño (o no hay cuenta), el candidato queda
    // ABIERTO: lo ven todos hasta que alguien lo apruebe.
    await markCompanyChangeCandidateOpenIfOwnerless(created.candidateId, created.accountId);

    // 3. HubSpot ya (D5): correo nuevo como principal, el anterior como adicional; cargo actual.
    //    Sin contacto de HubSpot no se crea aquí: se crea al aprobar (9.2).
    const hubspotPush = hubspotContactId
      ? await pushCompanyChangeToHubSpot(hubspotContactId, planCompanyChangeHubSpotPush({ contact, check }))
      : null;

    // 4. El contacto viejo se archiva con su información de hoy.
    const newCompanyName = companyChangeNewCompanyName(check, company);
    const block = buildContactCompanyChangeBlock({
      contact,
      check,
      actorId: internalUserId,
      nowIso,
      newCandidateId: created.candidateId,
      newCompanyName,
      newAccountId: created.accountId,
      hubspotContactId,
      hubspotPush,
    });
    const admin = createSupabaseAdminClient();
    const { error: archiveError } = await admin
      .from('contacts')
      .update(buildCompanyChangeArchivePatch({ contact, block, actorId: internalUserId, nowIso }))
      .eq('id', contact.id)
      .is('archived_at', null);
    if (archiveError) {
      console.error('[contact-company-change] archive failed', { contactId: contact.id, code: archiveError.code });
    } else {
      await logContactAudit({
        contactId: contact.id,
        accountId: contact.accountId,
        actorUserId: internalUserId,
        actionType: 'contact_archived',
        details: { reason: 'company_change', new_candidate_id: created.candidateId, new_account_id: created.accountId },
      });
    }
    if (hasPendingCompanyChange(detected)) {
      await markEmailCheckResolution(channelCandidate.id, 'company_change_confirmed', internalUserId, {
        new_candidate_id: created.candidateId,
      });
    }

    const assigned = !!created.company;
    return {
      ok: true,
      candidateId: created.candidateId,
      companyName: created.company?.name ?? newCompanyName,
      companyAssigned: assigned,
      message: COMPANY_CHANGE_COPY.confirmed(created.company?.name ?? null, assigned),
    };
  } catch (err) {
    console.error('[contact-company-change] confirm failed', {
      contactId,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return { ok: false, code: 'error', message: COMPANY_CHANGE_COPY.error };
  }
}
