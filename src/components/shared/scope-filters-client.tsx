'use client';

// Scope-aware filter dropdowns (Usuario / Grupo / Rol) for operativa modules.
//
// Rendered client-side; reads/writes query params via useRouter so each filter
// change is reflected in the URL and triggers a server re-fetch for modules
// that apply these filters server-side (e.g. Prospectos).
//
// For modules with client-side TanStack filtering (e.g. Empresas), this
// component is not used — the DataTable column filters handle that flow.

import { useCallback, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

const GROUP_INDENT_STEP_PX = 16;

function labelUser(u: { full_name: string | null; email: string | null }): string {
  if (u.full_name && u.email) return `${u.full_name} (${u.email})`;
  return u.full_name ?? u.email ?? '—';
}

// Resolve the selected group plus its descendants from the full flat list.
function groupDescendantIds(rootId: string, groups: ScopeFilterOptions['groups']): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const g of groups) {
    if (!g.parent_group_id) continue;
    const arr = childrenByParent.get(g.parent_group_id) ?? [];
    arr.push(g.id);
    childrenByParent.set(g.parent_group_id, arr);
  }
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child);
  }
  return result;
}

interface ScopeFiltersClientProps {
  scopeFilterOptions: ScopeFilterOptions;
  currentUserId: string;
  currentGroupId: string;
  currentRoleKey: string;
  /** Query param keys to use (defaults: 'userId', 'groupId', 'roleKey'). */
  paramKeys?: { user?: string; group?: string; role?: string };
}

export function ScopeFiltersClient({
  scopeFilterOptions,
  currentUserId,
  currentGroupId,
  currentRoleKey,
  paramKeys = {},
}: ScopeFiltersClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const userKey = paramKeys.user ?? 'userId';
  const groupKey = paramKeys.group ?? 'groupId';
  const roleKey = paramKeys.role ?? 'roleKey';

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === 'all') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // Selecting a group may invalidate the selected user.
  const onGroupChange = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === 'all') {
        params.delete(groupKey);
      } else {
        params.set(groupKey, value);
        const scope = groupDescendantIds(value, scopeFilterOptions.groups);
        const selectedUser = scopeFilterOptions.users.find((u) => u.id === currentUserId);
        if (selectedUser && (!selectedUser.group_id || !scope.has(selectedUser.group_id))) {
          params.delete(userKey);
        }
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, scopeFilterOptions, currentUserId, groupKey, userKey],
  );

  // Selecting a role may invalidate the selected user.
  const onRoleChange = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === 'all') {
        params.delete(roleKey);
      } else {
        params.set(roleKey, value);
        const selectedUser = scopeFilterOptions.users.find((u) => u.id === currentUserId);
        if (selectedUser && selectedUser.role_key !== value) params.delete(userKey);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, scopeFilterOptions, currentUserId, roleKey, userKey],
  );

  // Visible users: respect active role and group filters.
  const groupScope = useMemo(
    () =>
      currentGroupId ? groupDescendantIds(currentGroupId, scopeFilterOptions.groups) : null,
    [currentGroupId, scopeFilterOptions.groups],
  );

  const visibleUsers = useMemo(() => {
    return scopeFilterOptions.users.filter((u) => {
      if (currentRoleKey && u.role_key !== currentRoleKey) return false;
      if (groupScope && (!u.group_id || !groupScope.has(u.group_id))) return false;
      return true;
    });
  }, [scopeFilterOptions.users, currentRoleKey, groupScope]);

  const groupName = useMemo(
    () => new Map(scopeFilterOptions.groups.map((g) => [g.id, g.name])),
    [scopeFilterOptions.groups],
  );
  const userById = useMemo(
    () => new Map(scopeFilterOptions.users.map((u) => [u.id, u])),
    [scopeFilterOptions.users],
  );
  const roleLabelByKey = useMemo(
    () => new Map(scopeFilterOptions.roles.map((r) => [r.key, r.label])),
    [scopeFilterOptions.roles],
  );

  const groupTriggerLabel = (v: string) =>
    !v || v === 'all' ? 'Todos los grupos' : (groupName.get(v) ?? 'Grupo no encontrado');
  const userTriggerLabel = (v: string) => {
    if (!v || v === 'all') return 'Todos los usuarios';
    const u = userById.get(v);
    return u ? labelUser(u) : 'Usuario no encontrado';
  };
  const roleTriggerLabel = (v: string) =>
    !v || v === 'all' ? 'Todos los roles' : (roleLabelByKey.get(v) ?? 'Rol no encontrado');

  if (!scopeFilterOptions.showScopeFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mr-1">
        Equipo
      </span>

      {scopeFilterOptions.roles.length > 1 && (
        <Select value={currentRoleKey || 'all'} onValueChange={onRoleChange}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder="Rol">{roleTriggerLabel(currentRoleKey)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los roles
            </SelectItem>
            {scopeFilterOptions.roles.map((r) => (
              <SelectItem key={r.key} value={r.key} className="text-xs">
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {scopeFilterOptions.groups.length > 0 && (
        <Select value={currentGroupId || 'all'} onValueChange={onGroupChange}>
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue placeholder="Grupo">{groupTriggerLabel(currentGroupId)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los grupos
            </SelectItem>
            {scopeFilterOptions.groups.map((g) => (
              <SelectItem key={g.id} value={g.id} className="text-xs">
                <span style={{ paddingLeft: `${g.depth * GROUP_INDENT_STEP_PX}px` }}>
                  {g.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {visibleUsers.length > 0 && (
        <Select value={currentUserId || 'all'} onValueChange={(v) => setParam(userKey, v)}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Usuario">{userTriggerLabel(currentUserId)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los usuarios
            </SelectItem>
            {visibleUsers.map((u) => (
              <SelectItem key={u.id} value={u.id} className="text-xs">
                {labelUser(u)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
