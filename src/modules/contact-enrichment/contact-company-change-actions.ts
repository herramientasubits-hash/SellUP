'use server';

// Agente 2A — «Cambió de empresa» desde la ficha del contacto OFICIAL
// (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
//   * `confirmOfficialContactCompanyChangeAction` — el usuario confirma el cambio detectado:
//     candidato «Por revisar» en la empresa nueva (vinculado al MISMO contacto de HubSpot), la
//     información nueva a HubSpot ya (D5) y el contacto viejo archivado con su información de hoy.
//   * `restoreCompanyChangeContactAction` — desarchivar un contacto archivado por este flujo.
//
// Archivar fuera de `archiveContact` (que es sólo de admin) es una EXCEPCIÓN acotada y
// deliberada (Bryan 18-11): sólo se archiva un contacto con un cambio de empresa detectado por un
// proveedor y confirmado por alguien que puede revelar en esa ficha, y siempre se puede deshacer.
//
// Orden: primero se crea el candidato nuevo; si eso falla, NO se toca nada más (ni HubSpot ni el
// archivo). Después HubSpot (best-effort, nunca bloquea) y al final el archivo.

import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logContactAudit } from '@/modules/contacts/contact-audit.server';
import { requireActiveActor } from './current-actor.server';
import { canSeeOfficialContact } from './candidate-scope.server';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import { canonicalLinkedin } from './candidate-identity-completion-core';
import { readEmailCheckBlock } from './email-change-classifier-core';
import { readContactWithSourceCandidate } from './official-contact-identity-completion.server';
import { markEmailCheckResolution } from './official-contact-email-check.server';
import {
  COMPANY_CHANGE_COPY,
  buildCandidateCompanyChangeBlock,
  buildCompanyChangeArchivePatch,
  buildCompanyChangeRestorePatch,
  buildCompanyChangeSearchData,
  buildContactCompanyChangeBlock,
  companyChangeNewCompanyName,
  evaluateCompanyChangeConfirmation,
  evaluateCompanyChangeRestore,
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

export async function confirmOfficialContactCompanyChangeAction(input: {
  contactId: string;
}): Promise<ConfirmCompanyChangeResult> {
  const contactId = typeof input?.contactId === 'string' ? input.contactId.trim() : '';
  const { internalUserId, roleKey } = await requireActiveActor();
  if (!contactId || !(await canSeeOfficialContact(await createClient(), contactId))) {
    return { ok: false, code: 'not_offered', message: COMPANY_CHANGE_COPY.noPendingChange };
  }
  if (!isPhoneRevealRoleAuthorized(roleKey)) {
    return { ok: false, code: 'unauthorized_role', message: 'No tienes permisos para esta acción.' };
  }

  try {
    const { contact: channelContact, candidate: channelCandidate } = await readContactWithSourceCandidate(contactId);
    if (!channelContact || !channelCandidate || channelCandidate.matchedContactsId !== channelContact.id) {
      return { ok: false, code: 'no_pending_change', message: COMPANY_CHANGE_COPY.noPendingChange };
    }
    const check = readEmailCheckBlock(channelCandidate.enrichmentMetadata);
    const loaded = await loadCompanyChangeContact(contactId);
    const source = await loadCompanyChangeSourceCandidate(channelCandidate.id);
    // El LinkedIn del contacto o, si no lo tiene, el de su candidato.
    const contact = loaded ? { ...loaded, linkedinUrl: loaded.linkedinUrl ?? source?.linkedinUrl ?? null } : null;
    const gate = evaluateCompanyChangeConfirmation({ contact, check });
    if (!gate.ok || !contact || !check) {
      const reason = gate.ok ? 'no_pending_change' : gate.reason;
      if (reason === 'missing_linkedin') return { ok: false, code: 'missing_linkedin', message: COMPANY_CHANGE_COPY.missingLinkedin };
      return { ok: false, code: 'no_pending_change', message: COMPANY_CHANGE_COPY.noPendingChange };
    }
    if (!canonicalLinkedin(contact.linkedinUrl)) {
      return { ok: false, code: 'missing_linkedin', message: COMPANY_CHANGE_COPY.missingLinkedin };
    }

    // 1. Empresa nueva: sólo empresas que existen (HubSpot primero, luego SellUp; coincidencia única).
    const resolution = await resolveCompanyChangeCompany(check);
    const company = resolution.status === 'resolved' ? resolution.company : null;
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
      companyMatchedBy: resolution.status === 'resolved' ? resolution.matchedBy : null,
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
    await markEmailCheckResolution(channelCandidate.id, 'company_change_confirmed', internalUserId, {
      new_candidate_id: created.candidateId,
    });

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

export async function restoreCompanyChangeContactAction(input: {
  contactId: string;
}): Promise<{ ok: boolean; message: string }> {
  const contactId = typeof input?.contactId === 'string' ? input.contactId.trim() : '';
  const { internalUserId, roleKey } = await requireActiveActor();
  if (!contactId || !isPhoneRevealRoleAuthorized(roleKey) || !(await canSeeOfficialContact(await createClient(), contactId))) {
    return { ok: false, message: COMPANY_CHANGE_COPY.restoreUnavailable };
  }
  try {
    const contact = await loadCompanyChangeContact(contactId);
    const gate = evaluateCompanyChangeRestore(contact);
    if (!gate.ok || !contact) return { ok: false, message: COMPANY_CHANGE_COPY.restoreUnavailable };
    const nowIso = new Date().toISOString();
    const patch = buildCompanyChangeRestorePatch({ contact, block: gate.block, actorId: internalUserId, nowIso });
    const { error } = await createSupabaseAdminClient()
      .from('contacts')
      .update(patch)
      .eq('id', contact.id)
      .not('archived_at', 'is', null);
    if (error) return { ok: false, message: COMPANY_CHANGE_COPY.restoreUnavailable };
    await logContactAudit({
      contactId: contact.id,
      accountId: contact.accountId,
      actorUserId: internalUserId,
      actionType: 'contact_status_changed',
      details: { from: 'archived', to: patch.contact_status, reason: 'company_change_restored' },
    });
    return { ok: true, message: COMPANY_CHANGE_COPY.restored };
  } catch {
    return { ok: false, message: COMPANY_CHANGE_COPY.restoreUnavailable };
  }
}
