// Scope-aware filter options for Empresas, Prospectos, and other operativa modules.
//
// Returns the users, groups, and roles that the current user is allowed to use
// as filter dimensions — never options outside their commercial scope. This is
// the "filter population" layer; enforcement is the job of the query layer.
//
// Visibility rules:
//  admin      → all active users, all groups, all roles present.
//  team       → users in allowedUserIds, groups in allowedGroupIds, their roles.
//  self       → showScopeFilters = false (no meaningful team-dimension to pick).
//  scope off  → same as admin (all users; flag governs data enforcement elsewhere).

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { resolveCommercialScope } from './commercial-scope';
import { flattenOrgGroups } from './group-tree';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase service credentials not configured');
  }
  return createAdminClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Human-readable role labels (mirrors what roles are seeded in migration 001).
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  seller_bd: 'Vendedor / BD',
  commercial_manager: 'Manager comercial',
  commercial_lead: 'Líder comercial',
};

export interface ScopeUserOption {
  id: string;
  full_name: string | null;
  email: string | null;
  role_key: string | null;
  group_id: string | null;
}

export interface ScopeGroupOption {
  id: string;
  name: string;
  parent_group_id: string | null;
  /** Tree depth (0 = root). Drives visual indentation in dropdowns. */
  depth: number;
}

export interface ScopeRoleOption {
  key: string;
  label: string;
}

export interface ScopeFilterOptions {
  users: ScopeUserOption[];
  groups: ScopeGroupOption[];
  roles: ScopeRoleOption[];
  /** false for seller_bd / self-only scope: omit team-dimension filters in UI. */
  showScopeFilters: boolean;
  currentUserId: string;
}

/** Empty options for use when scope cannot be resolved (unauthenticated). */
export const EMPTY_SCOPE_FILTER_OPTIONS: ScopeFilterOptions = {
  users: [],
  groups: [],
  roles: [],
  showScopeFilters: false,
  currentUserId: '',
};

/**
 * Resolve the effective owner user ids to apply when a userId or groupId filter
 * is requested from URL params. Enforces commercial scope — a manager cannot
 * widen their view by passing an out-of-scope userId/groupId.
 *
 * Returns:
 *  - `null` → no owner filter to apply (admin with no selection, or scope off).
 *  - `[]`   → nothing visible (requested user/group is outside scope).
 *  - `[ids]`→ apply as ownerUserIds in prospect/account queries.
 */
export async function resolveScopeOwnerFilter(
  requestedUserId?: string | null,
  requestedGroupId?: string | null,
): Promise<string[] | null> {
  const scope = await resolveCommercialScope();
  if (!scope) return [];

  const hasUserFilter = !!requestedUserId?.trim();
  const hasGroupFilter = !!requestedGroupId?.trim();
  if (!hasUserFilter && !hasGroupFilter) return null;

  if (scope.canViewAll) {
    // Admin: honour requested filters directly.
    if (hasUserFilter) return [requestedUserId!.trim()];
    if (hasGroupFilter) {
      // Resolve group members via admin client.
      const admin = getAdminClient();
      const { data } = await admin
        .from('internal_users')
        .select('id, group_id')
        .eq('access_status', 'active');
      const allUsers = (data ?? []).map((u) => ({
        id: u.id as string,
        group_id: (u.group_id as string | null) ?? null,
      }));
      const { data: groupsRaw } = await admin
        .from('organization_groups')
        .select('id, name, parent_group_id');
      const allGroups = (groupsRaw ?? []).map((g) => ({
        id: g.id as string,
        name: g.name as string,
        parent_group_id: (g.parent_group_id as string | null) ?? null,
      }));
      const { collectGroupSubtreeIds } = await import('./group-tree');
      const subtreeIds = new Set(
        collectGroupSubtreeIds([requestedGroupId!.trim()], allGroups),
      );
      const members = allUsers
        .filter((u) => u.group_id && subtreeIds.has(u.group_id))
        .map((u) => u.id);
      return members.length > 0 ? members : [];
    }
    return null;
  }

  if (scope.isRestrictedToSelf) {
    // Seller / self: URL params cannot change what they see.
    return null;
  }

  // Team scope: intersect with allowedUserIds.
  const allowed = new Set(scope.allowedUserIds);

  if (hasUserFilter) {
    const uid = requestedUserId!.trim();
    return allowed.has(uid) ? [uid] : [];
  }

  if (hasGroupFilter) {
    const gid = requestedGroupId!.trim();
    // Only honour groups within the manager's allowed group subtree.
    if (!scope.allowedGroupIds.includes(gid)) return [];
    // Users in that group (and descendants) that are also in scope.
    const admin = getAdminClient();
    const { data } = await admin
      .from('internal_users')
      .select('id, group_id')
      .in('id', scope.allowedUserIds)
      .eq('access_status', 'active');
    const { data: groupsRaw } = await admin
      .from('organization_groups')
      .select('id, name, parent_group_id');
    const allGroups = (groupsRaw ?? []).map((g) => ({
      id: g.id as string,
      name: g.name as string,
      parent_group_id: (g.parent_group_id as string | null) ?? null,
    }));
    const { collectGroupSubtreeIds } = await import('./group-tree');
    const subtreeIds = new Set(
      collectGroupSubtreeIds([gid], allGroups),
    );
    const members = (data ?? [])
      .filter((u) => {
        const gId = (u.group_id as string | null) ?? null;
        return gId && subtreeIds.has(gId);
      })
      .map((u) => u.id as string);
    return members.length > 0 ? members : [];
  }

  return null;
}

/**
 * Resolve filter option lists for the current user's commercial scope.
 *
 * Safe to call server-side from any page that renders scope-aware filters.
 * Returns `EMPTY_SCOPE_FILTER_OPTIONS` when there is no authenticated session.
 */
export async function getCommercialScopeFilterOptions(): Promise<ScopeFilterOptions> {
  const scope = await resolveCommercialScope();
  if (!scope) return EMPTY_SCOPE_FILTER_OPTIONS;

  // seller_bd / self-only: no meaningful team dimension to expose.
  if (scope.isRestrictedToSelf) {
    return {
      users: [],
      groups: [],
      roles: [],
      showScopeFilters: false,
      currentUserId: scope.currentUserId,
    };
  }

  const admin = getAdminClient();

  // Read all active users with their role key and group membership.
  const { data: usersRaw } = await admin
    .from('internal_users')
    .select('id, full_name, email, group_id, roles(key)')
    .eq('access_status', 'active')
    .order('full_name', { ascending: true });

  const allUsers: ScopeUserOption[] = (usersRaw ?? []).map((u) => ({
    id: u.id as string,
    full_name: (u.full_name as string | null) ?? null,
    email: (u.email as string | null) ?? null,
    role_key:
      (u.roles as unknown as { key: string } | null)?.key ?? null,
    group_id: (u.group_id as string | null) ?? null,
  }));

  // Read organization_groups for tree building.
  const { data: groupsRaw } = await admin
    .from('organization_groups')
    .select('id, name, parent_group_id')
    .order('name', { ascending: true });

  const allGroups = (groupsRaw ?? []).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    parent_group_id: (g.parent_group_id as string | null) ?? null,
  }));

  if (scope.canViewAll) {
    // Admin: expose everything.
    const flatGroups = flattenOrgGroups(allGroups);
    const roleKeys = [...new Set(allUsers.map((u) => u.role_key).filter(Boolean))] as string[];
    const roles = roleKeys.map((key) => ({
      key,
      label: ROLE_LABELS[key] ?? key,
    }));

    return {
      users: allUsers,
      groups: flatGroups.map(({ group, depth }) => ({ ...group, depth })),
      roles,
      showScopeFilters: true,
      currentUserId: scope.currentUserId,
    };
  }

  // Team scope: restrict to allowedUserIds / allowedGroupIds.
  const allowedUsers = new Set(scope.allowedUserIds);
  const allowedGroups = new Set(scope.allowedGroupIds);

  const scopedUsers = allUsers.filter((u) => allowedUsers.has(u.id));
  const scopedGroupItems = allGroups.filter((g) => allowedGroups.has(g.id));

  const flatGroups = flattenOrgGroups(scopedGroupItems);

  const roleKeys = [
    ...new Set(scopedUsers.map((u) => u.role_key).filter(Boolean)),
  ] as string[];
  const roles = roleKeys.map((key) => ({
    key,
    label: ROLE_LABELS[key] ?? key,
  }));

  return {
    users: scopedUsers,
    groups: flatGroups.map(({ group, depth }) => ({ ...group, depth })),
    roles,
    showScopeFilters: scopedUsers.length > 1 || scopedGroupItems.length > 0,
    currentUserId: scope.currentUserId,
  };
}
