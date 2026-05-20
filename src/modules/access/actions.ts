'use server';

import { createClient } from '@/lib/supabase/server';
import type { Role, InternalUser, AccessAuditEntry, UsersSummary, UserPreapproval, OrganizationGroup } from './types';

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
        manager_id,
        group_id,
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
    manager_id: u.manager_id ?? null,
    group_id: u.group_id ?? null,
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

  const [pending, active, suspended, rejected, preapproved] = await Promise.all([
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
    supabase
      .from('user_preapprovals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_claim'),
  ]);

  return {
    pending: pending.count ?? 0,
    active: active.count ?? 0,
    suspended: suspended.count ?? 0,
    rejected: rejected.count ?? 0,
    preapproved: preapproved.count ?? 0,
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
  managerId?: string | null,
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
      manager_id: managerId ?? null,
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

export async function changeUserManager(
  userId: string,
  newManagerId: string | null,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) return { success: false, error: 'No autenticado' };

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();

  if (!adminUser) return { success: false, error: 'No autorizado' };

  const { data: targetUser } = await supabase
    .from('internal_users')
    .select('id, manager_id')
    .eq('id', userId)
    .single();

  if (!targetUser) return { success: false, error: 'Usuario no encontrado' };

  const { error } = await supabase
    .from('internal_users')
    .update({ manager_id: newManagerId, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) return { success: false, error: error.message };

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: userId,
    p_action_type: 'manager_changed',
    p_metadata: {
      previous_manager_id: targetUser.manager_id,
      new_manager_id: newManagerId,
    },
  });

  return { success: true };
}

export async function changeUserGroup(
  userId: string,
  newGroupId: string | null,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  if (!currentUser) return { success: false, error: 'No autenticado' };

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();
  if (!adminUser) return { success: false, error: 'No autorizado' };

  const { data: targetUser } = await supabase
    .from('internal_users')
    .select('id, group_id')
    .eq('id', userId)
    .single();
  if (!targetUser) return { success: false, error: 'Usuario no encontrado' };

  const { error } = await supabase
    .from('internal_users')
    .update({ group_id: newGroupId, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) return { success: false, error: error.message };

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: userId,
    p_action_type: 'group_assigned',
    p_metadata: { previous_group_id: targetUser.group_id, new_group_id: newGroupId },
  });

  return { success: true };
}

// ─── Preapprovals ─────────────────────────────────────────────────────────────

export async function getPreapprovals(): Promise<UserPreapproval[]> {
  const supabase = await createClient();

  const [preResult, rolesResult, usersResult, groupsResult] = await Promise.all([
    supabase
      .from('user_preapprovals')
      .select('id, email, full_name, role_id, manager_id, group_id, status, created_by, notes, created_at, updated_at, claimed_at')
      .eq('status', 'pending_claim')
      .order('created_at', { ascending: false }),
    supabase.from('roles').select('id, key, name'),
    supabase.from('internal_users').select('id, full_name, email'),
    supabase.from('organization_groups').select('id, name'),
  ]);

  if (preResult.error) return [];

  const rolesMap = new Map((rolesResult.data ?? []).map(r => [r.id, r]));
  const usersMap = new Map((usersResult.data ?? []).map(u => [u.id, u]));
  const groupsMap = new Map((groupsResult.data ?? []).map(g => [g.id, g]));

  return (preResult.data ?? []).map(p => ({
    ...p,
    role_key: p.role_id ? (rolesMap.get(p.role_id)?.key ?? null) : null,
    role_name: p.role_id ? (rolesMap.get(p.role_id)?.name ?? null) : null,
    manager_name: p.manager_id
      ? (usersMap.get(p.manager_id)?.full_name ?? usersMap.get(p.manager_id)?.email ?? null)
      : null,
    group_name: p.group_id ? (groupsMap.get(p.group_id)?.name ?? null) : null,
  })) as UserPreapproval[];
}

export async function createPreapproval(data: {
  email: string;
  full_name: string | null;
  role_id: string;
  manager_id: string | null;
  group_id: string | null;
  notes: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  if (!currentUser) return { success: false, error: 'No autenticado' };

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();
  if (!adminUser) return { success: false, error: 'No autorizado' };

  // Check no duplicate in internal_users
  const { data: existing } = await supabase
    .from('internal_users')
    .select('id')
    .ilike('email', data.email)
    .maybeSingle();
  if (existing) return { success: false, error: 'Ya existe un usuario con ese correo' };

  // The DB unique index handles duplicate pending_claim preapprovals
  const { error } = await supabase.from('user_preapprovals').insert({
    email: data.email.toLowerCase(),
    full_name: data.full_name,
    role_id: data.role_id,
    manager_id: data.manager_id,
    group_id: data.group_id,
    notes: data.notes,
    created_by: adminUser.id,
  });

  if (error) {
    if (error.code === '23505') return { success: false, error: 'Ya existe una preautorización pendiente para ese correo' };
    return { success: false, error: error.message };
  }

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: adminUser.id,
    p_action_type: 'preauthorized',
    p_metadata: { email: data.email },
  });

  return { success: true };
}

export async function cancelPreapproval(
  preapprovalId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  if (!currentUser) return { success: false, error: 'No autenticado' };

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();
  if (!adminUser) return { success: false, error: 'No autorizado' };

  const { error } = await supabase
    .from('user_preapprovals')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', preapprovalId)
    .eq('status', 'pending_claim');

  if (error) return { success: false, error: error.message };

  await supabase.rpc('log_access_event', {
    p_actor_user_id: adminUser.id,
    p_target_user_id: adminUser.id,
    p_action_type: 'preapproval_cancelled',
    p_metadata: { preapproval_id: preapprovalId },
  });

  return { success: true };
}

// ─── Organization Groups ───────────────────────────────────────────────────────

export async function getOrganizationGroups(): Promise<OrganizationGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_groups')
    .select('id, name, description, parent_group_id, depth, created_by, created_at, updated_at')
    .order('depth', { ascending: true })
    .order('name', { ascending: true });

  if (error) return [];
  return (data ?? []) as OrganizationGroup[];
}

export async function createOrganizationGroup(data: {
  name: string;
  description: string | null;
  parent_group_id: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const supabase = await createClient();
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  if (!currentUser) return { success: false, error: 'No autenticado' };

  const { data: adminUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', currentUser.id)
    .eq('access_status', 'active')
    .single();
  if (!adminUser) return { success: false, error: 'No autorizado' };

  const { data: newGroup, error } = await supabase
    .from('organization_groups')
    .insert({ name: data.name, description: data.description, parent_group_id: data.parent_group_id, created_by: adminUser.id })
    .select('id')
    .single();

  if (error) {
    if (error.message.includes('máximo de 3 niveles')) return { success: false, error: 'No se puede crear: se supera el máximo de 3 niveles' };
    return { success: false, error: error.message };
  }

  return { success: true, id: newGroup.id };
}