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

  const { data: accountExists } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', input.account_id)
    .single();

  if (!accountExists) return { success: false, error: 'Cuenta no encontrada' };

  const fullName = buildFullName(input.first_name, input.last_name, input.full_name);
  if (!fullName) return { success: false, error: 'El nombre completo es requerido' };

  const email = sanitizeEmail(input.email);
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
    phone: input.phone?.trim() || null,
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

export async function updateContact(
  id: string,
  input: UpdateContactInput,
): Promise<{ success: true } | { success: false; error: string }> {
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
  if (input.phone !== undefined) payload.phone = input.phone?.trim() || null;
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

  const { error } = await supabase.from('contacts').update(payload).eq('id', id);
  if (error) return { success: false, error: error.message };

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

  return { success: true };
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
