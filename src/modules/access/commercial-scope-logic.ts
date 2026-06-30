// Pure, dependency-free logic for the global commercial visibility scope.
//
// This module holds the side-effect-free decisions of the scope layer so they
// can be unit-tested without a database: how a role key maps to a visibility
// class, and how a concrete id set is resolved when a scope is combined with a
// requested query-param filter (the anti-tampering rule).
//
// The async resolver that actually reads Supabase lives in
// `commercial-scope.ts` ('use server'). Keep this file free of 'use server' and
// of any Supabase import so it stays importable from tests and client-safe code.

/**
 * Visibility class derived from a user's role:
 *  - 'admin' → sees everything, can filter by anyone.
 *  - 'team'  → líder/manager: sees their group subtree + direct reports.
 *  - 'self'  → vendedor/BD and any unknown role: sees only their own data.
 */
export type CommercialRoleClass = 'admin' | 'team' | 'self';

/** Role keys seeded in migration 001 that grant full visibility. */
export const ADMIN_ROLE_KEYS: readonly string[] = ['admin'];

/**
 * Role keys seeded in migration 001 that grant team (group + reports) scope.
 * Líder and manager share the exact same technical scope today — there is no
 * behavioural difference between them, so they map to the same class.
 */
export const TEAM_ROLE_KEYS: readonly string[] = [
  'commercial_manager',
  'commercial_lead',
];

/**
 * Classify a role key into a visibility class.
 *
 * `isAdmin` is the authoritative admin signal (e.g. the `is_admin` RPC); when
 * true the result is always 'admin' regardless of the key. Any role that is not
 * a known admin/team key falls back to the most restrictive class, 'self', so a
 * new or misconfigured role can never accidentally widen visibility.
 */
export function classifyRole(
  roleKey: string | null,
  isAdmin: boolean,
): CommercialRoleClass {
  if (isAdmin) return 'admin';
  const key = roleKey?.trim().toLowerCase() ?? null;
  if (key && ADMIN_ROLE_KEYS.includes(key)) return 'admin';
  if (key && TEAM_ROLE_KEYS.includes(key)) return 'team';
  return 'self';
}

/** De-duplicate a list of ids, preserving first-seen order. */
export function uniqueIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)];
}

/**
 * Snapshot of what the current user is allowed to see, in commercial terms.
 *
 * `allowedUserIds` always includes the user themselves for non-admins and is
 * empty for admins (who carry `canViewAll`). `allowedGroupIds` is the user's
 * group subtree (empty for admins / users without a group).
 */
export interface CommercialScope {
  /** internal_users.id of the viewer. */
  currentUserId: string;
  currentUserEmail: string | null;
  /** role key (e.g. 'seller_bd'); null when no role is assigned. */
  currentUserRole: string | null;
  /** The viewer's own group plus its descendants (organization_groups). */
  currentUserGroupIds: string[];
  /** internal_users.ids the viewer may see. Empty when `canViewAll`. */
  allowedUserIds: string[];
  /** organization_groups.ids in scope. Empty when `canViewAll`. */
  allowedGroupIds: string[];
  /** Admin: no constraint should be applied anywhere. */
  canViewAll: boolean;
  /** Vendedor/BD or fallback: the viewer only ever sees their own rows. */
  isRestrictedToSelf: boolean;
  /** Why the scope resolved the way it did — surfaced for debugging/audit. */
  scopeReason:
    | 'admin'
    | 'team_group_and_reports'
    | 'team_without_scope_fallback_self'
    | 'self'
    | 'scope_disabled';
}

/**
 * Resolve the concrete set of user ids to apply for a "user" dimension, given
 * the scope and an optional requested user id from query params.
 *
 * Return contract (used directly to drive Supabase `.in()` filters):
 *  - `null` → apply NO user constraint (admin, or non-admin with no request and
 *    — by construction — never reached for non-admins since they always carry a
 *    finite allowed set).
 *  - `[]`   → constraint that matches nothing (requested a user outside scope).
 *  - `[ids]`→ constrain to exactly these ids.
 *
 * This is the anti-tampering rule: a non-admin can never widen results by
 * passing `?userId=` for someone outside `allowedUserIds`; the intersection
 * collapses to `[]` (no rows) instead.
 */
export function resolveScopedUserIds(
  scope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'>,
  requestedUserId?: string | null,
): string[] | null {
  const requested = requestedUserId?.trim() || null;

  if (scope.canViewAll) {
    return requested ? [requested] : null;
  }

  const allowed = scope.allowedUserIds;
  if (requested) {
    return allowed.includes(requested) ? [requested] : [];
  }
  return allowed;
}

/**
 * Intersect the scope's user set with the ids that belong to a requested group
 * subtree (already expanded by the caller). Mirrors `resolveScopedUserIds` but
 * for the "group" dimension; the group is honoured only insofar as its members
 * are already inside the viewer's allowed set.
 *
 *  - `null` → no constraint (admin with no group requested).
 *  - `[]`   → nothing matches.
 *  - `[ids]`→ the allowed members of the requested group.
 */
export function resolveScopedGroupMembers(
  scope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'>,
  requestedGroupMemberIds: string[] | null,
): string[] | null {
  if (scope.canViewAll) {
    return requestedGroupMemberIds ?? null;
  }
  const allowed = new Set(scope.allowedUserIds);
  if (requestedGroupMemberIds) {
    return requestedGroupMemberIds.filter((id) => allowed.has(id));
  }
  return scope.allowedUserIds;
}
