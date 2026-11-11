// Núcleo del alcance comercial SIN sesión (dueña 11-11, asistente de Slack).
//
// `commercial-scope.ts` ('use server') resuelve el alcance de quien tiene la
// sesión abierta. Este archivo hace lo mismo a partir de un `internal_users.id`
// conocido, para lugares que no traen sesión del navegador (el asistente de
// Slack, que identifica a la persona por su correo de Slack). NO es una acción
// de servidor: no se puede llamar desde el navegador con un id cualquiera.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { collectGroupSubtreeIds } from './group-tree';
import { classifyRole, uniqueIds, type CommercialScope } from './commercial-scope-logic';

const ACTIVE_USER_STATUS = 'active';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export interface ScopeUserRow {
  id: string;
  email: string | null;
  groupId: string | null;
  roleKey: string | null;
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
 * El alcance comercial de una persona activa ya identificada. Misma regla que
 * `resolveCommercialScope`: admin ve todo, líder/manager su grupo y sus
 * reportes, el resto sólo lo suyo.
 */
export async function resolveCommercialScopeForUser(
  admin: AdminClient,
  current: ScopeUserRow,
): Promise<CommercialScope> {
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
