'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type {
  Contact,
  ContactAuditEntry,
  ContactAuditAction,
  ContactsSummary,
  CreateContactInput,
  UpdateContactInput,
  ContactStatus,
} from './types';
import {
  buildManualContactPhoneEditPatch,
  resolveManualContactPhoneEdit,
} from './contact-phone-provenance';
import type { SyncContactToHubSpotResult } from './contact-hubspot-sync-core';
import {
  runContactHubSpotAutoPhoneUpdateWired,
  runContactHubSpotSyncWired,
} from './contact-hubspot-sync-runner';
import type { ContactAutoPhoneUpdateReport } from './contact-hubspot-auto-phone-update-core';

// ============================================================
// Auth helpers
// ============================================================

async function requireActiveUser(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');
  return { internalUserId: internalUser.id };
}

async function requireAdmin(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') {
    throw new Error('Acceso restringido: se requiere rol admin');
  }

  return { internalUserId: internalUser.id };
}

// ============================================================
// Validaciones puras
// ============================================================
//
// Se IMPORTAN, no se reexportan. Este módulo lleva `'use server'`, y Next
// convierte en Server Action todo lo que salga de él exigiendo que sea una
// función async; `checkAccountActiveForContact` es una función SÍNCRONA y pura.
// Quien la necesite —los tests incluidos— la toma de `./account-active-guard`,
// que es donde vive y donde ya la buscan.

import {
  HUBSPOT_SYNC_STALE_SOURCES,
  markContactHubSpotSyncStaleForPhoneChange,
} from './contact-hubspot-sync-state';
import { checkAccountActiveForContact } from './account-active-guard';

import { findContactDuplicate, dedupErrorMessage } from './contact-dedup';
export type { ExistingContactForDedup, ContactDedupInput, DedupMatch } from './contact-dedup';

// ============================================================
// Utilidades
// ============================================================

function buildFullName(firstName?: string, lastName?: string, explicitFullName?: string): string {
  if (explicitFullName?.trim()) return explicitFullName.trim();
  const parts = [firstName?.trim(), lastName?.trim()].filter(Boolean);
  return parts.join(' ');
}

function sanitizeEmail(email?: string): string | null {
  if (!email?.trim()) return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

// ============================================================
// getAllContacts — vista global
// ============================================================

export interface ContactListItem extends Contact {
  account_name: string | null;
}

export async function getAllContacts(): Promise<ContactListItem[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('*, account:account_id ( name )')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw new Error(`getAllContacts: ${error.message}`);

  return (data ?? []).map((row) => ({
    ...(row as unknown as Contact),
    account_name: (row.account as unknown as { name: string } | null)?.name ?? null,
  }));
}

// ============================================================
// getContactsByAccount
// ============================================================

export async function getContactsByAccount(accountId: string): Promise<Contact[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`getContactsByAccount: ${error.message}`);
  return (data ?? []) as Contact[];
}

// ============================================================
// getContactsSummary
// ============================================================

export async function getContactsSummary(accountId: string): Promise<ContactsSummary> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('contact_status, role_in_account, is_primary')
    .eq('account_id', accountId);

  if (error) throw new Error(`getContactsSummary: ${error.message}`);

  const rows = data ?? [];
  return {
    total: rows.length,
    decision_makers: rows.filter((r) => r.role_in_account === 'decision_maker').length,
    champions: rows.filter((r) => r.role_in_account === 'champion').length,
    primary: rows.filter((r) => r.is_primary).length,
    inactive_or_archived: rows.filter((r) =>
      ['inactive', 'archived', 'left_company', 'do_not_contact'].includes(r.contact_status),
    ).length,
  };
}

// ============================================================
// getContactById
// ============================================================

export async function getContactById(id: string): Promise<Contact | null> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`getContactById: ${error.message}`);
  }

  return data as Contact;
}

// ============================================================
// createContact
// ============================================================

export async function createContact(
  input: CreateContactInput,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  if (!input.account_id) return { success: false, error: 'account_id es requerido' };

  const { data: account } = await supabase
    .from('accounts')
    .select('id, archived_at, pipeline_status')
    .eq('id', input.account_id)
    .single();

  const accountCheck = checkAccountActiveForContact(
    account as { archived_at: string | null; pipeline_status: string } | null,
  );
  if (!accountCheck.ok) return { success: false, error: accountCheck.error };

  const fullName = buildFullName(input.first_name, input.last_name, input.full_name);
  if (!fullName) return { success: false, error: 'El nombre completo es requerido' };

  const email = sanitizeEmail(input.email);

  // ── Deduplicación server-side (Hito 17A.7D) ─────────────────────
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('id, email, linkedin_url, full_name')
    .eq('account_id', input.account_id)
    .is('archived_at', null);

  const dupMatch = findContactDuplicate(
    { email: input.email, linkedin_url: input.linkedin_url, full_name: fullName },
    existingContacts ?? [],
  );
  if (dupMatch) return { success: false, error: dedupErrorMessage(dupMatch.matchedBy) };
  // ────────────────────────────────────────────────────────────────

  const isPrimary = input.is_primary ?? false;

  if (isPrimary) {
    await supabase
      .from('contacts')
      .update({ is_primary: false })
      .eq('account_id', input.account_id)
      .eq('is_primary', true);
  }

  const payload = {
    account_id: input.account_id,
    first_name: input.first_name?.trim() || null,
    last_name: input.last_name?.trim() || null,
    full_name: fullName,
    email,
    // 4O-H0.5 — el número y su procedencia entran en el MISMO INSERT, con el contrato
    // que ya usa `updateContact`: un teléfono tecleado por un humano es `'manual'` y no
    // arrastra metadata de proveedor. Sin teléfono, la tupla entera queda NULL (no hay
    // dato del que declarar origen). Antes de H0.5 el INSERT escribía `phone` y dejaba
    // `phone_source` en NULL, es decir «se desconoce»: un teléfono demostrablemente
    // manual quedaba indistinguible de uno sin procedencia conocida.
    // NO se declara nada sobre `mobile_phone`: esa columna sigue sin procedencia propia
    // (`MOBILE_PHONE_PROVENANCE_PENDING`) y `phone_source` describe `phone`, no a ella.
    ...buildManualContactPhoneEditPatch(input.phone?.trim() || null),
    mobile_phone: input.mobile_phone?.trim() || null,
    linkedin_url: input.linkedin_url?.trim() || null,
    job_title: input.job_title?.trim() || null,
    department: input.department?.trim() || null,
    seniority: input.seniority || null,
    role_in_account: input.role_in_account || null,
    contact_status: (input.contact_status ?? 'active') as ContactStatus,
    source: 'manual' as const,
    is_primary: isPrimary,
    notes: input.notes?.trim() || null,
    created_by: internalUserId,
    updated_by: internalUserId,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };

  const { data, error } = await supabase.from('contacts').insert(payload).select('id').single();
  if (error) return { success: false, error: error.message };

  await logContactAudit({
    contactId: data.id,
    accountId: input.account_id,
    actorUserId: internalUserId,
    actionType: 'contact_created',
    details: { full_name: fullName, source: 'manual' },
  });

  if (isPrimary) {
    await logContactAudit({
      contactId: data.id,
      accountId: input.account_id,
      actorUserId: internalUserId,
      actionType: 'contact_primary_changed',
      details: { is_primary: true },
    });
  }

  return { success: true, id: data.id };
}

// ============================================================
// updateContact
// ============================================================

/**
 * CUT-3C — resultado de `updateContact`.
 *
 * `hubspotAutoPhoneUpdate` está deliberadamente FUERA de `success`: `success` describe si el
 * contacto se guardó, y en el momento en que este informe existe eso ya está decidido y escrito.
 * Ninguna pantalla debe leerlo para decidir si la edición falló —un HubSpot caído no es una
 * edición fallida—; está aquí para que la fase automática sea auditable en vez de invisible.
 *
 * Ausente cuando la edición no llegó a escribir (validación, permisos, error de base de datos):
 * sin escritura no hay segunda fase, y afirmar un informe sería inventarlo.
 */
export type UpdateContactActionResult =
  | { success: true; hubspotAutoPhoneUpdate?: ContactAutoPhoneUpdateReport }
  | { success: false; error: string };

export async function updateContact(
  id: string,
  input: UpdateContactInput,
): Promise<UpdateContactActionResult> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const current = await getContactById(id);
  if (!current) return { success: false, error: 'Contacto no encontrado' };

  const roleChanged =
    input.role_in_account !== undefined && input.role_in_account !== current.role_in_account;
  const statusChanged =
    input.contact_status !== undefined && input.contact_status !== current.contact_status;
  const primaryChanged =
    input.is_primary !== undefined && input.is_primary !== current.is_primary;

  if (input.is_primary === true && !current.is_primary) {
    await supabase
      .from('contacts')
      .update({ is_primary: false })
      .eq('account_id', current.account_id)
      .eq('is_primary', true)
      .neq('id', id);
  }

  const fullName = buildFullName(
    input.first_name ?? current.first_name ?? undefined,
    input.last_name ?? current.last_name ?? undefined,
    input.full_name,
  );

  const payload: Partial<Contact> & { updated_by: string } = {
    updated_by: internalUserId,
  };

  if (input.first_name !== undefined) payload.first_name = input.first_name?.trim() || null;
  if (input.last_name !== undefined) payload.last_name = input.last_name?.trim() || null;
  if (fullName !== current.full_name) payload.full_name = fullName;
  if (input.email !== undefined) payload.email = sanitizeEmail(input.email);

  // 4O-E4.1-R1 — el número y su procedencia viajan JUNTOS o no viajan.
  //
  // `contacts.phone_source` es la única evidencia que la supresión de privacidad
  // acepta para borrar el teléfono oficial. Antes de R1 esta acción escribía `phone`
  // sin tocar la procedencia, así que un número tecleado a mano heredaba el
  // `apollo_reveal` / `lusha_reveal` del proveedor y una DSAR posterior lo borraba.
  //
  // El patch va dentro del MISMO `update()` de abajo a propósito: dos escrituras
  // dejarían una ventana con el número nuevo y la procedencia vieja, que es
  // exactamente el estado que borra el dato equivocado. Y la decisión compara con el
  // valor guardado, no con la presencia del campo: el formulario reenvía `phone` en
  // cada guardado, así que reaccionar a la presencia convertiría en `manual` la
  // procedencia de todos los teléfonos de proveedor al editar cualquier otro campo.
  const phoneEdit = resolveManualContactPhoneEdit({
    currentPhone: current.phone,
    inputPhone: input.phone,
  });
  if (phoneEdit.kind === 'replaced' || phoneEdit.kind === 'cleared') {
    Object.assign(payload, phoneEdit.patch);
  }

  // `mobile_phone` NO participa de esta procedencia: no la escribe ningún proveedor
  // y `phone_source` no la describe (4O-E4.1). Se escribe tal cual, como siempre.
  if (input.mobile_phone !== undefined) payload.mobile_phone = input.mobile_phone?.trim() || null;
  if (input.linkedin_url !== undefined) payload.linkedin_url = input.linkedin_url?.trim() || null;
  if (input.job_title !== undefined) payload.job_title = input.job_title?.trim() || null;
  if (input.department !== undefined) payload.department = input.department?.trim() || null;
  if (input.seniority !== undefined) payload.seniority = input.seniority;
  if (input.role_in_account !== undefined) payload.role_in_account = input.role_in_account;
  if (input.contact_status !== undefined) payload.contact_status = input.contact_status;
  if (input.is_primary !== undefined) payload.is_primary = input.is_primary;
  if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
  if (input.metadata !== undefined) payload.metadata = input.metadata;

  // AGENT2-CONTACT-HUBSPOT-UPDATE-CUT2 — si este guardado cambia el teléfono que HubSpot
  // recibiría y el contacto YA estaba sincronizado, la ficha pasa a `stale`.
  //
  // La decisión la toma la autoridad central, no esta acción: los caminos que tocan el
  // teléfono oficial son varios y una copia de la regla por escritor acabaría con fichas que
  // discrepan sobre si HubSpot está al día.
  //
  // Va DENTRO del mismo `update()` a propósito. Una segunda escritura dejaría una ventana en
  // la que el teléfono nuevo ya está guardado y el estado sigue diciendo `synced`, que es
  // exactamente la mentira que este corte existe para eliminar. Y NO llama a HubSpot: marcar
  // pendiente es un hecho local; enviarlo sigue siendo un clic humano.
  const staleDecision = markContactHubSpotSyncStaleForPhoneChange({
    // La metadata base es la que este guardado va a dejar escrita, no la de la fila: si el
    // formulario trae metadata propia, el bloque debe proyectarse sobre ESA.
    metadata: (payload.metadata ?? current.metadata) as Record<string, unknown> | null,
    hubspotContactId: current.hubspot_contact_id,
    previous: current,
    // La fila TAL COMO QUEDARÁ tras este guardado. Se compone con el spread y no campo a campo
    // a propósito: un campo ausente en el payload es un campo NO tocado, así que hereda el
    // valor guardado y editar el cargo no puede parecer que borra el teléfono.
    next: { ...current, ...payload },
    nowIso: new Date().toISOString(),
    // CUT-3C — este formulario es, literalmente, una persona editando. `user_edit` es lo que
    // ocurrió, y se declara aquí en vez de heredarse de un defecto: el día que este camino
    // dejara de ser el de una persona, el compilador no avisaría de nada si el valor viniera
    // implícito.
    source: HUBSPOT_SYNC_STALE_SOURCES.userEdit,
  });
  if (staleDecision.marked) payload.metadata = staleDecision.metadata;

  const { error } = await supabase.from('contacts').update(payload).eq('id', id);
  if (error) return { success: false, error: error.message };

  // ── CUT-3C · SEGUNDA FASE — PATCH automático hacia HubSpot ────
  //
  // Empieza AQUÍ, después del `if (error)`, y ese orden es todo el corte: en este punto la
  // edición ya está guardada. Nada de lo que ocurra a continuación puede revertirla —no hay
  // transacción abierta que pudiera arrastrarla— y por eso el resultado que se devuelve más
  // abajo sigue siendo `{ success: true }` sea cual sea el desenlace de HubSpot.
  //
  // Es deliberado que el informe NO viaje en el resultado de esta acción. `updateContact` la
  // usan varios formularios y su contrato es «¿se guardó el contacto?»; meter ahí el veredicto
  // de un tercero invitaría a que alguna pantalla lo leyera como un fallo de guardado y le
  // dijera a la persona que su edición no entró. Cuando el PATCH falla, la ficha lo cuenta ella
  // sola: `stale` sobrevive y el badge ofrece «Reintentar actualización».
  //
  // Se dispara SIEMPRE que hubo escritura, sin comprobar nada aquí: el portero se planta solo si
  // no hay vínculo o no hay pendiente —el caso normal—, y duplicar esa comprobación en este
  // sitio crearía una segunda regla capaz de discrepar de la durable.
  const hubspotAutoPhoneUpdate = await runContactHubSpotAutoPhoneUpdateWired(id, {
    actorId: internalUserId,
    nowIso: new Date().toISOString(),
    logAudit: async (entry) => {
      await logContactAudit({
        contactId: entry.contactId,
        accountId: entry.accountId,
        actorUserId: entry.actorUserId,
        actionType: 'contact_updated',
        details: {
          hubspot_sync: {
            mode: entry.mode,
            hubspot_contact_id: entry.hubspotContactId,
            hubspot_company_id: entry.hubspotCompanyId,
            company_association: entry.companyAssociation,
            // Sin esto una fila de auditoría automática sería indistinguible de un clic.
            method: 'auto',
          },
        },
      });
    },
  });

  if (statusChanged) {
    await logContactAudit({
      contactId: id,
      accountId: current.account_id,
      actorUserId: internalUserId,
      actionType: 'contact_status_changed',
      details: { from: current.contact_status, to: input.contact_status },
    });
  } else if (roleChanged) {
    await logContactAudit({
      contactId: id,
      accountId: current.account_id,
      actorUserId: internalUserId,
      actionType: 'contact_role_changed',
      details: { from: current.role_in_account, to: input.role_in_account },
    });
  } else if (primaryChanged) {
    await logContactAudit({
      contactId: id,
      accountId: current.account_id,
      actorUserId: internalUserId,
      actionType: 'contact_primary_changed',
      details: { is_primary: input.is_primary },
    });
  } else {
    await logContactAudit({
      contactId: id,
      accountId: current.account_id,
      actorUserId: internalUserId,
      actionType: 'contact_updated',
      details: {},
    });
  }

  return { success: true, hubspotAutoPhoneUpdate };
}

// ============================================================
// archiveContact
// ============================================================

export async function archiveContact(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  let internalUserId: string;
  try {
    ({ internalUserId } = await requireAdmin());
  } catch {
    return { success: false, error: 'Se requiere rol admin para archivar contactos' };
  }

  const supabase = await createClient();

  const current = await getContactById(id);
  if (!current) return { success: false, error: 'Contacto no encontrado' };

  const { error } = await supabase
    .from('contacts')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: internalUserId,
      contact_status: 'archived' as ContactStatus,
      is_primary: false,
      updated_by: internalUserId,
    })
    .eq('id', id)
    .is('archived_at', null);

  if (error) return { success: false, error: error.message };

  await logContactAudit({
    contactId: id,
    accountId: current.account_id,
    actorUserId: internalUserId,
    actionType: 'contact_archived',
    details: {},
  });

  return { success: true };
}

// ============================================================
// setPrimaryContact
// ============================================================

export async function setPrimaryContact(
  accountId: string,
  contactId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  await supabase
    .from('contacts')
    .update({ is_primary: false, updated_by: internalUserId })
    .eq('account_id', accountId)
    .eq('is_primary', true);

  const { error } = await supabase
    .from('contacts')
    .update({ is_primary: true, updated_by: internalUserId })
    .eq('id', contactId)
    .eq('account_id', accountId);

  if (error) return { success: false, error: error.message };

  await logContactAudit({
    contactId,
    accountId,
    actorUserId: internalUserId,
    actionType: 'contact_primary_changed',
    details: { is_primary: true },
  });

  return { success: true };
}

// ============================================================
// changeContactStatus
// ============================================================

export async function changeContactStatus(
  id: string,
  newStatus: ContactStatus,
): Promise<{ success: true } | { success: false; error: string }> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const current = await getContactById(id);
  if (!current) return { success: false, error: 'Contacto no encontrado' };

  const { error } = await supabase
    .from('contacts')
    .update({ contact_status: newStatus, updated_by: internalUserId })
    .eq('id', id);

  if (error) return { success: false, error: error.message };

  await logContactAudit({
    contactId: id,
    accountId: current.account_id,
    actorUserId: internalUserId,
    actionType: 'contact_status_changed',
    details: { from: current.contact_status, to: newStatus },
  });

  return { success: true };
}

// ============================================================
// logContactAudit — interno
// ============================================================

export async function logContactAudit({
  contactId,
  accountId,
  actorUserId,
  actionType,
  details,
}: {
  contactId: string;
  accountId: string;
  actorUserId: string | null;
  actionType: ContactAuditAction;
  details: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.from('contact_audit').insert({
    contact_id: contactId,
    account_id: accountId,
    actor_user_id: actorUserId,
    action_type: actionType,
    details,
  });
}

// ============================================================
// getContactAudit
// ============================================================

export async function getContactAudit(contactId: string): Promise<ContactAuditEntry[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('contact_audit')
    .select(`*, actor:actor_user_id ( full_name, email )`)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`getContactAudit: ${error.message}`);
  return (data ?? []) as unknown as ContactAuditEntry[];
}

// ============================================================
// syncContactToHubSpot — Hito 17A.4C
// ============================================================
// Sincronización MANUAL, controlada, uno a uno, de un contacto aprobado hacia
// HubSpot. NO es automática al aprobar. NO hace bulk. NO crea empresas/deals/
// notas. NO llama a Apollo ni toca candidatos. La lógica vive en el core puro
// contact-hubspot-sync-core.ts; aquí se cablean las dependencias reales.

export type { SyncContactToHubSpotResult } from './contact-hubspot-sync-core';

export async function syncContactToHubSpot(
  contactId: string,
): Promise<SyncContactToHubSpotResult> {
  let internalUserId: string;
  try {
    ({ internalUserId } = await requireActiveUser());
  } catch {
    return { ok: false, errorCode: 'UNKNOWN_ERROR', message: 'Sesión no válida.' };
  }

  try {
    return await runContactHubSpotSyncWired(contactId, {
      actorId: internalUserId,
      nowIso: new Date().toISOString(),
      // CUT-3B — este camino es, y sigue siendo, el del BOTÓN. Una persona miró la ficha y
      // pulsó: `manual` es literalmente lo que ocurrió, y por eso se declara aquí en vez de
      // heredarse de un valor por defecto que un día podría cambiar bajo los pies.
      method: 'manual',
      logAudit: async (entry) => {
        await logContactAudit({
          contactId: entry.contactId,
          accountId: entry.accountId,
          actorUserId: entry.actorUserId,
          actionType: 'contact_updated',
          details: {
            hubspot_sync: {
              mode: entry.mode,
              hubspot_contact_id: entry.hubspotContactId,
              // `null` en un PATCH: la empresa no participa, y escribir el id de todos modos
              // haría parecer que la asociación se revisó en este intento.
              hubspot_company_id: entry.hubspotCompanyId,
              company_association: entry.companyAssociation,
            },
          },
        });
      },
    });
  } catch {
    // No exponer detalles crípticos/sensibles a la UI (token, payload, HTTP raw).
    return {
      ok: false,
      errorCode: 'HUBSPOT_ERROR',
      message: 'No fue posible sincronizar el contacto con HubSpot.',
    };
  }
}
