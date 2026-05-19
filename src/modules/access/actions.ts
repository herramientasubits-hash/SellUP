'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { Role, InternalUser, AccessAuditEntry, UsersSummary } from './types';

export async function getCurrentUser(): Promise<InternalUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase.rpc('get_internal_user', {
    p_auth_user_id: user.id,
  });

  if (!data || data.length === 0) return null;

  return data[0] as InternalUser;
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data } = await supabase.rpc('is_admin', {
    p_auth_user_id: user.id,
  });

  return data ?? false;
}

export async function hasActiveAccess(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data } = await supabase.rpc('has_active_access', {
    p_auth_user_id: user.id,
  });

  return data ?? false;
}

export async function getAllRoles(): Promise<Role[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('roles')
    .select('id, key, name, description')
    .order('name');

  if (error) {
    console.error('Error fetching roles:', error);
    return [];
  }

  return (data as Role[]) ?? [];
}

export async function getAllUsers(): Promise<InternalUser[]> {
  const supabase = await createClient();
  
  const [usersResult, rolesResult] = await Promise.all([
    supabase
      .from('internal_users')
      .select(`
        id,
        auth_user_id,
        email,
        full_name,
        avatar_url,
        access_status,
        role_id,
        requested_at,
        approved_at,
        rejected_at,
        suspended_at,
        last_login_at
      `)
      .order('created_at', { ascending: false }),
    supabase.from('roles').select('id, key, name')
  ]);

  if (usersResult.error) {
    console.error('Error fetching users:', usersResult.error);
    return [];
  }

  const rolesMap = new Map((rolesResult.data ?? []).map(r => [r.id, r.key]));
  
  return (usersResult.data ?? []).map((u) => ({
    ...u,
    role_key: u.role_id ? rolesMap.get(u.role_id) ?? null : null,
  })) as InternalUser[];
}

export async function getUsersByStatus(status: string): Promise<InternalUser[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('internal_users')
    .select(`
      id,
      auth_user_id,
      email,
      full_name,
      avatar_url,
      access_status,
      role_id,
      requested_at,
      approved_at,
      rejected_at,
      suspended_at,
      last_login_at,
      role:roles(key, name)
    `)
    .eq('access_status', status)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching users by status:', error);
    return [];
  }

  return (data ?? []).map((u: Record<string, unknown>) => ({
    ...u,
    role_key: (u.role as Record<string, string> | null)?.key ?? null,
  })) as InternalUser[];
}

export async function getUsersSummary(): Promise<UsersSummary> {
  const supabase = await createClient();

  const [pending, active, suspended, rejected] = await Promise.all([
    supabase
      .from('internal_users')
      .select('id', { count: 'exact', head: true })
      .eq('access_status', 'pending_approval'),
    supabase
      .from('internal_users')
      .select('id', { count: 'exact', head: true })
      .eq('access_status', 'active'),
    supabase
      .from('internal_users')
      .select('id', { count: 'exact', head: true })
      .eq('access_status', 'suspended'),
    supabase
      .from('internal_users')
      .select('id', { count: 'exact', head: true })
      .eq('access_status', 'rejected'),
  ]);

  return {
    pending: pending.count ?? 0,
    active: active.count ?? 0,
    suspended: suspended.count ?? 0,
    rejected: rejected.count ?? 0,
  };
}

export async function getUserAccessHistory(
  userId: string
): Promise<AccessAuditEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_user_access_history', {
    p_target_user_id: userId,
  });

  if (error) {
    console.error('Error fetching access history:', error);
    return [];
  }

  return (data ?? []) as AccessAuditEntry[];
}

export async function approveUser(
  userId: string,
  roleId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) {
    return { success: false, error: 'No autorizado' };
  }

  const { data: targetUser } = await supabase
    .from('internal_users')
    .select('id, access_status, role_id')
    .eq('id', userId)
    .single();

  if (!targetUser) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const { error: updateError } = await supabase
    .from('internal_users')
    .update({
      access_status: 'active',
      role_id: roleId,
      approved_at: new Date().toISOString(),
      approved_by: adminUser.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: userId,
    p_action_type: 'approved',
    p_previous_status: targetUser.access_status,
    p_new_status: 'active',
    p_previous_role_id: targetUser.role_id,
    p_new_role_id: roleId,
    p_reason: reason,
  });

  return { success: true };
}

export async function rejectUser(
  userId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) {
    return { success: false, error: 'No autorizado' };
  }

  const { data: targetUser } = await supabase
    .from('internal_users')
    .select('id, access_status')
    .eq('id', userId)
    .single();

  if (!targetUser) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const { error: updateError } = await supabase
    .from('internal_users')
    .update({
      access_status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejected_by: adminUser.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: userId,
    p_action_type: 'rejected',
    p_previous_status: targetUser.access_status,
    p_new_status: 'rejected',
    p_reason: reason,
  });

  return { success: true };
}

export async function suspendUser(
  userId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) {
    return { success: false, error: 'No autorizado' };
  }

  const { data: targetUser } = await supabase
    .from('internal_users')
    .select('id, access_status')
    .eq('id', userId)
    .single();

  if (!targetUser) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const { error: updateError } = await supabase
    .from('internal_users')
    .update({
      access_status: 'suspended',
      suspended_at: new Date().toISOString(),
      suspended_by: adminUser.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: userId,
    p_action_type: 'suspended',
    p_previous_status: targetUser.access_status,
    p_new_status: 'suspended',
    p_reason: reason,
  });

  return { success: true };
}

export async function reactivateUser(
  userId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) {
    return { success: false, error: 'No autorizado' };
  }

  const { data: targetUser } = await supabase
    .from('internal_users')
    .select('id, access_status')
    .eq('id', userId)
    .single();

  if (!targetUser) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const { error: updateError } = await supabase
    .from('internal_users')
    .update({
      access_status: 'active',
      suspended_at: null,
      suspended_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: userId,
    p_action_type: 'reactivated',
    p_previous_status: targetUser.access_status,
    p_new_status: 'active',
    p_reason: reason,
  });

  return { success: true };
}

export async function changeUserRole(
  userId: string,
  newRoleId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return { success: false, error: 'No autenticado' };
  }

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) {
    return { success: false, error: 'No autorizado' };
  }

  const { data: targetUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('id', userId)
    .single();

  if (!targetUser) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const { error: updateError } = await supabase
    .from('internal_users')
    .update({
      role_id: newRoleId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: userId,
    p_action_type: 'role_changed',
    p_previous_role_id: targetUser.role_id,
    p_new_role_id: newRoleId,
    p_reason: reason,
  });

  return { success: true };
}