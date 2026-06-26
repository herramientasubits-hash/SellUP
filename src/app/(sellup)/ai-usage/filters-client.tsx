'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FilterGroup, FilterOptions, FilterUser } from '@/modules/ai-usage/queries';

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Todo el período' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'current_month', label: 'Mes actual' },
] as const;

const PROVIDER_DISPLAY: Record<string, string> = {
  tavily: 'Tavily',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  samu_ia: 'Samu IA',
};

const AGENT_DISPLAY: Record<string, string> = {
  prospect_generation: 'Generación de prospectos',
  account_intelligence: 'Inteligencia de cuenta',
  commercial_speech: 'Speech comercial',
  post_meeting_followup: 'Seguimiento post-reunión',
};

function labelProvider(key: string) {
  return PROVIDER_DISPLAY[key] ?? key;
}

function labelAgent(key: string, name: string | null) {
  return AGENT_DISPLAY[key] ?? name ?? key;
}

function labelUser(u: FilterUser) {
  if (u.full_name && u.email) return `${u.full_name} (${u.email})`;
  return u.full_name ?? u.email ?? u.id.slice(0, 8);
}

// Resolve the selected group plus every descendant from the real hierarchy
// (organization_groups, max 3 levels). Selecting a parent therefore scopes to
// the whole subtree — matching the server-side resolution.
function descendantGroupIds(rootId: string, groups: FilterGroup[]): Set<string> {
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
    for (const childId of childrenByParent.get(id) ?? []) stack.push(childId);
  }
  return result;
}

interface FiltersClientProps {
  options: FilterOptions;
  currentPeriod: string;
  currentProvider: string;
  currentAgent: string;
  currentStatus: string;
  currentUser: string;
  currentRole: string;
  currentGroupId: string;
}

export function FiltersClient({
  options,
  currentPeriod,
  currentProvider,
  currentAgent,
  currentStatus,
  currentUser,
  currentRole,
  currentGroupId,
}: FiltersClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === '' || value === 'all') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // Scope of the currently selected group (the group + its descendants).
  const groupScope = useMemo(
    () => (currentGroupId ? descendantGroupIds(currentGroupId, options.groups) : null),
    [currentGroupId, options.groups],
  );

  // Changing the role may invalidate the selected user: if the user no longer
  // matches the role, clear it to avoid an impossible combination.
  const onRoleChange = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === 'all') {
        params.delete('role');
      } else {
        params.set('role', value);
        const selected = options.users.find((u) => u.id === currentUser);
        if (selected && selected.role_key !== value) params.delete('user');
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, options.users, currentUser],
  );

  // Changing the group may invalidate the selected user: if the user is not in
  // the new group scope (group + descendants), clear it.
  const onGroupChange = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === 'all') {
        params.delete('groupId');
      } else {
        params.set('groupId', value);
        const scope = descendantGroupIds(value, options.groups);
        const selected = options.users.find((u) => u.id === currentUser);
        if (selected && (!selected.group_id || !scope.has(selected.group_id))) {
          params.delete('user');
        }
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, options.users, options.groups, currentUser],
  );

  // Usuario dropdown is scoped to the selected role and/or group so the filters
  // always express a possible combination (intersection).
  const visibleUsers = useMemo(() => {
    return options.users.filter((u) => {
      if (currentRole && u.role_key !== currentRole) return false;
      if (groupScope && (!u.group_id || !groupScope.has(u.group_id))) return false;
      return true;
    });
  }, [options.users, currentRole, groupScope]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mr-1">
        Filtrar
      </span>

      {/* Período */}
      <Select
        value={currentPeriod || 'all'}
        onValueChange={(v) => setParam('period', v)}
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue placeholder="Período" />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Proveedor */}
      {options.providers.length > 0 && (
        <Select
          value={currentProvider || 'all'}
          onValueChange={(v) => setParam('provider', v)}
        >
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="Proveedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los proveedores
            </SelectItem>
            {options.providers.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">
                {labelProvider(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Agente */}
      {options.agents.length > 0 && (
        <Select
          value={currentAgent || 'all'}
          onValueChange={(v) => setParam('agent', v)}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Agente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los agentes
            </SelectItem>
            {options.agents.map((a) => (
              <SelectItem key={a.key} value={a.key} className="text-xs">
                {labelAgent(a.key, a.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Estado */}
      {options.statuses.length > 0 && (
        <Select
          value={currentStatus || 'all'}
          onValueChange={(v) => setParam('status', v)}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los estados
            </SelectItem>
            {options.statuses.map((s) => (
              <SelectItem key={s} value={s} className="text-xs capitalize">
                {s.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Rol (perfil del usuario) */}
      {options.roles.length > 0 && (
        <Select value={currentRole || 'all'} onValueChange={onRoleChange}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder="Rol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los roles
            </SelectItem>
            {options.roles.map((r) => (
              <SelectItem key={r.key} value={r.key} className="text-xs">
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Grupo (estructura organizacional real) */}
      {options.groups.length > 0 && (
        <Select value={currentGroupId || 'all'} onValueChange={onGroupChange}>
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue placeholder="Grupo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los grupos
            </SelectItem>
            {options.groups.map((g) => (
              <SelectItem key={g.id} value={g.id} className="text-xs">
                <span style={{ paddingLeft: `${g.depth * 12}px` }}>{g.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Usuario */}
      {options.users.length > 0 ? (
        <Select
          value={currentUser || 'all'}
          onValueChange={(v) => setParam('user', v)}
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Usuario" />
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
      ) : (
        <Select disabled value="none">
          <SelectTrigger className="h-8 w-[180px] text-xs opacity-50 cursor-not-allowed">
            <SelectValue placeholder="Sin usuarios" />
          </SelectTrigger>
        </Select>
      )}
    </div>
  );
}
