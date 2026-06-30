'use server';

// Global commercial visibility scope — the single source of truth for "who can
// see whose data" across SellUp operativa surfaces (Empresas, Prospectos, Uso
// de IA, …).
//
// This resolves the current authenticated user into a `CommercialScope` snapshot
// that downstream queries apply server-side. It is intentionally read-only and
// uses the service-role client to read across `internal_users` (a vendedor can't
// read other users' rows under RLS, but the scope must still compute their
// team), exactly like the existing ai-usage and activity-feed queries.
//
// Hierarchy model: a líder/manager's reach is the UNION of two axes that already
// exist in the codebase, so neither under- nor over-exposes:
//   1. organization_groups subtree of their home group (the axis the
//      "Usuarios y grupos" screen and the Uso de IA "Grupo" filter use), and
//   2. their manager_id report subtree via the get_subordinate_ids RPC (the axis
//      the activity feed uses).
// Admin sees everything; vendedor/BD and any unknown/misconfigured role see only
// themselves (safe fallback).

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { collectGroupSubtreeIds } from './group-tree';
import {
  classifyRole,
  uniqueIds,
  type CommercialScope,
} from './commercial-scope-logic';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ACTIVE_USER_STATUS = 'active';

function getAdminClient() {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase service credentials not configured');
  }
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

type AdminClient = ReturnType<typeof getAdminClient>;

interface CurrentUserRow {
  id: string;
  email: string | null;
  groupId: string | null;
  roleKey: string | null;
}

async function resolveCurrentUserRow(
  admin: AdminClient,
): Promise<CurrentUserRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await admin
    .from('internal_users')
    .select('id, email, group_id, role_id, roles(key)')
    .eq('auth_user_id', user.id)
    .eq('access_status', ACTIVE_USER_STATUS)
    .maybeSingle();

  if (!data) return null;

  const roleKey = (data.roles as unknown as { key: string } | null)?.key ?? null;
  return {
    id: data.id as string,
    email: (data.email as string | null) ?? null,
    groupId: (data.group_id as string | null) ?? null,
    roleKey,
  };
}

/** All active internal_users.ids whose group_id falls inside the subtree. */
async function getActiveUserIdsInGroups(
  admin: AdminClient,
  groupIds: string[],
): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const { data } = await admin
    .from('internal_users')
    .select('id')
    .in('group_id', groupIds)
    .eq('access_status', ACTIVE_USER_STATUS);
  return (data ?? []).map((u) => u.id as string);
}

/** Recursive manager_id report subtree (subordinates only, not self). */
async function getSubordinateIds(
  admin: AdminClient,
  managerId: string,
): Promise<string[]> {
  try {
    const { data } = await admin.rpc('get_subordinate_ids', {
      p_manager_id: managerId,
    });
    return (data ?? []).map((r: { user_id: string }) => r.user_id);
  } catch {
    // RPC missing or failed: degrade to no reports rather than throwing. The
    // group axis still applies; worst case the user sees only their group.
    return [];
  }
}

/**
 * Resolve the current user's commercial scope. Returns `null` only when there is
 * no authenticated active internal user (callers treat that as "no access").
 *
 * This always computes the real, role-based scope; it does NOT consult the
 * `ENABLE_COMMERCIAL_SCOPE` feature flag. Call sites decide whether to apply the
 * result (see `isCommercialScopeEnabled`), so the flag governs rollout without
 * this resolver having to know about per-surface semantics.
 */
export async function resolveCommercialScope(): Promise<CommercialScope | null> {
  const admin = getAdminClient();
  const current = await resolveCurrentUserRow(admin);
  if (!current) return null;

  const roleClass = classifyRole(current.roleKey, false);

  // Always compute the user's own group subtree (used as currentUserGroupIds and
  // as the team group axis). Cheap single read of organization_groups.
  let ownGroupSubtree: string[] = [];
  if (current.groupId) {
    const { data: groups } = await admin
      .from('organization_groups')
      .select('id, parent_group_id');
    ownGroupSubtree = collectGroupSubtreeIds(
      [current.groupId],
      (groups ?? []).map((g) => ({
        id: g.id as string,
        name: '',
        parent_group_id: (g.parent_group_id as string | null) ?? null,
      })),
    );
  }

  const base = {
    currentUserId: current.id,
    currentUserEmail: current.email,
    currentUserRole: current.roleKey,
    currentUserGroupIds: ownGroupSubtree,
  } as const;

  if (roleClass === 'admin') {
    return {
      ...base,
      allowedUserIds: [],
      allowedGroupIds: [],
      canViewAll: true,
      isRestrictedToSelf: false,
      scopeReason: 'admin',
    };
  }

  if (roleClass === 'self') {
    return {
      ...base,
      allowedUserIds: [current.id],
      allowedGroupIds: [],
      canViewAll: false,
      isRestrictedToSelf: true,
      scopeReason: 'self',
    };
  }

  // roleClass === 'team' (líder/manager): union of group subtree members and
  // direct/indirect reports, plus self.
  const [groupMemberIds, subordinateIds] = await Promise.all([
    getActiveUserIdsInGroups(admin, ownGroupSubtree),
    getSubordinateIds(admin, current.id),
  ]);

  const allowedUserIds = uniqueIds([
    current.id,
    ...groupMemberIds,
    ...subordinateIds,
  ]);

  // A team role with neither a group nor any report resolves to self only —
  // never to global — so a misconfigured user can't accidentally see everything.
  const hasRealScope = ownGroupSubtree.length > 0 || subordinateIds.length > 0;

  return {
    ...base,
    allowedUserIds,
    allowedGroupIds: ownGroupSubtree,
    canViewAll: false,
    isRestrictedToSelf: !hasRealScope,
    scopeReason: hasRealScope
      ? 'team_group_and_reports'
      : 'team_without_scope_fallback_self',
  };
}
