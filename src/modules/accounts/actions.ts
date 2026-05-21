'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type {
  Account,
  AccountWithOwner,
  AccountAuditEntry,
  AccountListItem,
  AccountsSummary,
  CreateAccountInput,
  UpdateAccountInput,
  InternalUserOption,
  AccountAuditAction,
  PipelineStatus,
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

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(website: string): string | null {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// ============================================================
// getAccountsSummary
// ============================================================

export async function getAccountsSummary(): Promise<AccountsSummary> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('accounts')
    .select('pipeline_status')
    .is('archived_at', null);

  if (error) throw new Error(`getAccountsSummary: ${error.message}`);

  const counts = (data ?? []).reduce(
    (acc, row) => {
      const s = row.pipeline_status as PipelineStatus;
      acc.total += 1;
      if (s === 'new') acc.new += 1;
      if (s === 'ready_for_research') acc.ready_for_research += 1;
      if (s === 'ready_for_outreach') acc.ready_for_outreach += 1;
      return acc;
    },
    { total: 0, new: 0, ready_for_research: 0, ready_for_outreach: 0, archived: 0 },
  );

  const { count: archivedCount } = await supabase
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .not('archived_at', 'is', null);

  counts.archived = archivedCount ?? 0;

  return counts;
}

// ============================================================
// getAccountsList
// ============================================================

export async function getAccountsList(): Promise<AccountListItem[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('accounts')
    .select(
      `id, name, country, country_code, industry, website, domain,
       pipeline_status, source, created_at,
       owner:owner_id ( full_name )`,
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(`getAccountsList: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    country: row.country,
    country_code: row.country_code,
    industry: row.industry,
    website: row.website,
    domain: row.domain,
    pipeline_status: row.pipeline_status as PipelineStatus,
    source: row.source as Account['source'],
    created_at: row.created_at,
    owner_name: (row.owner as unknown as { full_name: string | null } | null)?.full_name ?? null,
  }));
}

// ============================================================
// getAccountById
// ============================================================

export async function getAccountById(id: string): Promise<AccountWithOwner | null> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('accounts')
    .select(
      `*, owner:owner_id ( id, full_name, email ),
       created_by_user:created_by ( id, full_name )`,
    )
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`getAccountById: ${error.message}`);
  }

  return data as unknown as AccountWithOwner;
}

// ============================================================
// getAccountAudit
// ============================================================

export async function getAccountAudit(accountId: string): Promise<AccountAuditEntry[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('account_audit')
    .select(`*, actor:actor_user_id ( full_name, email )`)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`getAccountAudit: ${error.message}`);

  return (data ?? []) as unknown as AccountAuditEntry[];
}

// ============================================================
// createAccount
// ============================================================

export async function createAccount(
  input: CreateAccountInput,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const name = input.name.trim();
  if (!name) return { success: false, error: 'El nombre es requerido' };

  const domain = input.website ? extractDomain(input.website) : null;
  const normalizedName = normalizeText(name);

  const payload = {
    name,
    legal_name: input.legal_name?.trim() || null,
    normalized_name: normalizedName,
    website: input.website?.trim() || null,
    domain,
    country: input.country?.trim() || null,
    country_code: input.country_code?.trim() || null,
    city: input.city?.trim() || null,
    region: input.region?.trim() || null,
    industry: input.industry || null,
    company_size: input.company_size || null,
    tax_identifier: input.tax_identifier?.trim() || null,
    tax_identifier_type: input.tax_identifier_type || null,
    owner_id: input.owner_id || null,
    notes: input.notes?.trim() || null,
    source: 'manual' as const,
    pipeline_status: 'new' as const,
    created_by: internalUserId,
    updated_by: internalUserId,
  };

  const { data, error } = await supabase
    .from('accounts')
    .insert(payload)
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };

  await logAccountAudit({
    accountId: data.id,
    actorUserId: internalUserId,
    actionType: 'account_created',
    details: { name, source: 'manual' },
  });

  return { success: true, id: data.id };
}

// ============================================================
// updateAccount
// ============================================================

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const { internalUserId } = await requireActiveUser();
  const supabase = await createClient();

  const current = await getAccountById(id);
  if (!current) return { success: false, error: 'Cuenta no encontrada' };

  const payload: Partial<Account> & { updated_by: string } = {
    updated_by: internalUserId,
  };

  if (input.name !== undefined) {
    payload.name = input.name.trim();
    payload.normalized_name = normalizeText(input.name);
  }
  if (input.legal_name !== undefined) payload.legal_name = input.legal_name.trim() || null;
  if (input.website !== undefined) {
    payload.website = input.website.trim() || null;
    payload.domain = input.website ? extractDomain(input.website) : null;
  }
  if (input.country !== undefined) payload.country = input.country.trim() || null;
  if (input.country_code !== undefined) payload.country_code = input.country_code.trim() || null;
  if (input.city !== undefined) payload.city = input.city.trim() || null;
  if (input.region !== undefined) payload.region = input.region.trim() || null;
  if (input.industry !== undefined) payload.industry = input.industry || null;
  if (input.company_size !== undefined) payload.company_size = input.company_size || null;
  if (input.tax_identifier !== undefined) payload.tax_identifier = input.tax_identifier.trim() || null;
  if (input.tax_identifier_type !== undefined) payload.tax_identifier_type = input.tax_identifier_type || null;
  if (input.notes !== undefined) payload.notes = input.notes.trim() || null;
  if (input.metadata !== undefined) payload.metadata = input.metadata;

  const ownerChanged = input.owner_id !== undefined && input.owner_id !== current.owner_id;
  const statusChanged =
    input.pipeline_status !== undefined && input.pipeline_status !== current.pipeline_status;

  if (input.owner_id !== undefined) payload.owner_id = input.owner_id || null;
  if (input.pipeline_status !== undefined) payload.pipeline_status = input.pipeline_status;
  if (input.pipeline_substatus !== undefined) payload.pipeline_substatus = input.pipeline_substatus;

  const { error } = await supabase.from('accounts').update(payload).eq('id', id);
  if (error) return { success: false, error: error.message };

  if (statusChanged) {
    await logAccountAudit({
      accountId: id,
      actorUserId: internalUserId,
      actionType: 'account_status_changed',
      details: { from: current.pipeline_status, to: input.pipeline_status },
    });
  } else if (ownerChanged) {
    await logAccountAudit({
      accountId: id,
      actorUserId: internalUserId,
      actionType: 'account_owner_changed',
      details: { from: current.owner_id, to: input.owner_id },
    });
  } else {
    await logAccountAudit({
      accountId: id,
      actorUserId: internalUserId,
      actionType: 'account_updated',
      details: {},
    });
  }

  return { success: true };
}

// ============================================================
// archiveAccount
// ============================================================

export async function archiveAccount(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  let internalUserId: string;
  try {
    ({ internalUserId } = await requireAdmin());
  } catch {
    return { success: false, error: 'Se requiere rol admin para archivar cuentas' };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from('accounts')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: internalUserId,
      pipeline_status: 'archived',
      updated_by: internalUserId,
    })
    .eq('id', id)
    .is('archived_at', null);

  if (error) return { success: false, error: error.message };

  await logAccountAudit({
    accountId: id,
    actorUserId: internalUserId,
    actionType: 'account_archived',
    details: {},
  });

  return { success: true };
}

// ============================================================
// logAccountAudit — interno
// ============================================================

export async function logAccountAudit({
  accountId,
  actorUserId,
  actionType,
  details,
}: {
  accountId: string;
  actorUserId: string | null;
  actionType: AccountAuditAction;
  details: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.from('account_audit').insert({
    account_id: accountId,
    actor_user_id: actorUserId,
    action_type: actionType,
    details,
  });
}

// ============================================================
// getActiveUsers — para selector de owner
// ============================================================

export async function getActiveUsers(): Promise<InternalUserOption[]> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('internal_users')
    .select('id, full_name, email')
    .eq('access_status', 'active')
    .order('full_name', { ascending: true });

  if (error) throw new Error(`getActiveUsers: ${error.message}`);
  return (data ?? []) as InternalUserOption[];
}
