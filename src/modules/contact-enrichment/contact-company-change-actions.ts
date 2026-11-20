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
import {
  COMPANY_CHANGE_COPY,
  buildCompanyChangeRestorePatch,
  evaluateCompanyChangeRestore,
} from './contact-company-change-core';
import { loadCompanyChangeContact } from './contact-company-change.server';
import { runContactCompanyChange, type ConfirmCompanyChangeResult } from './contact-company-change-runner.server';

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
  return runContactCompanyChange(contactId, internalUserId, null);
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
