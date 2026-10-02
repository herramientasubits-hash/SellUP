'use client';

/**
 * usage-filter-bar.tsx — la barra de filtros (período, rol, grupo, usuario,
 * agente, estado) que comparten las pestañas «Consumo» y «Logs», y el estado
 * que la gobierna. Los filtros se mandan tal cual a la acción de cada pestaña.
 */

import { useState } from 'react';
import { Check, ChevronDownIcon } from '@/icons';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FilterGroup, FilterUser } from '@/modules/ai-usage/queries';
import type { FilterOptions, UsageFilters } from '../provider-consumption-types';

type UsagePeriod = NonNullable<UsageFilters['period']>;

export const CONSUMPTION_PERIOD_OPTIONS = [
  { value: 'current_month', label: 'Mes actual' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'all', label: 'Todo el período' },
] as const;

const CONSUMPTION_AGENT_DISPLAY: Record<string, string> = {
  prospect_generation: 'Generación de prospectos',
  account_intelligence: 'Inteligencia de cuenta',
  commercial_speech: 'Speech comercial',
  post_meeting_followup: 'Seguimiento post-reunión',
  contact_enrichment: 'Enriquecimiento de contactos',
};

const CONSUMPTION_GROUP_INDENT_PX = 16;

function labelConsumptionAgent(key: string, name: string | null) {
  return CONSUMPTION_AGENT_DISPLAY[key] ?? name ?? key;
}

// Display matrix for the Usuario filter (Q3F-9G Paso 10): fullName is
// preferred, email is the fallback, and the raw internal_users.id never
// reaches the UI — an id-only user shows a readable placeholder instead.
export function consumptionUserIdentity(u: FilterUser): { primary: string; secondary: string | null } {
  if (u.full_name && u.email) return { primary: u.full_name, secondary: u.email };
  if (u.full_name) return { primary: u.full_name, secondary: null };
  if (u.email) return { primary: u.email, secondary: null };
  return { primary: 'Usuario no disponible', secondary: null };
}

export function consumptionDescendantGroupIds(rootId: string, groups: FilterGroup[]): Set<string> {
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

/** Client-side user scoping: the users still visible under the selected role ∩ group. */
export function scopeUsersToFilters(filters: UsageFilters, options: FilterOptions | null | undefined): FilterUser[] {
  const groupScope = filters.groupId
    ? consumptionDescendantGroupIds(filters.groupId, options?.groups ?? [])
    : null;
  return (options?.users ?? []).filter((u) => {
    if (filters.role && u.role_key !== filters.role) return false;
    if (groupScope && (!u.group_id || !groupScope.has(u.group_id))) return false;
    return true;
  });
}

// ── Estado de los filtros ─────────────────────────────────────────────────────

export interface UsageFilterState {
  filters: UsageFilters;
  setFilter: (key: keyof UsageFilters, value: string | null) => void;
  onRoleChange: (value: string | null) => void;
  onGroupChange: (value: string | null) => void;
}

interface UseUsageFiltersOptions {
  initial: UsageFilters;
  /** Opciones cargadas: hacen falta para soltar al usuario que ya no cabe en el rol o el grupo elegido. */
  options: FilterOptions | null | undefined;
  /**
   * Con `true`, elegir «Todo el período» se guarda como `period: 'all'` en vez
   * de quitar el filtro: así el selector y el rótulo dicen el período que de
   * verdad se está viendo. La consulta trata igual `'all'` y la ausencia.
   */
  keepAllPeriod?: boolean;
}

export function useUsageFilters({ initial, options, keepAllPeriod = false }: UseUsageFiltersOptions): UsageFilterState {
  const [filters, setFilters] = useState<UsageFilters>(initial);

  function setFilter(key: keyof UsageFilters, value: string | null) {
    setFilters((prev) => {
      const next = { ...prev };
      const keepsAll = keepAllPeriod && key === 'period' && value === 'all';
      if (!value || (value === 'all' && !keepsAll)) {
        delete next[key];
      } else {
        (next as Record<string, string>)[key] = value;
      }
      return next;
    });
  }

  function onRoleChange(value: string | null) {
    setFilters((prev) => {
      const next: UsageFilters = { ...prev };
      if (!value || value === 'all') {
        delete next.role;
      } else {
        next.role = value;
        const u = (options?.users ?? []).find((u) => u.id === next.user);
        if (u && u.role_key !== next.role) delete next.user;
      }
      return next;
    });
  }

  function onGroupChange(value: string | null) {
    setFilters((prev) => {
      const next: UsageFilters = { ...prev };
      if (!value || value === 'all') {
        delete next.groupId;
      } else {
        next.groupId = value;
        const scope = consumptionDescendantGroupIds(value, options?.groups ?? []);
        const u = (options?.users ?? []).find((u) => u.id === next.user);
        if (u && (!u.group_id || !scope.has(u.group_id))) delete next.user;
      }
      return next;
    });
  }

  return { filters, setFilter, onRoleChange, onGroupChange };
}

// ── Filtro de usuario con buscador ────────────────────────────────────────────

// Searchable Usuario filter (Q3F-9G Paso 9). Local Command + Popover pattern
// (not the shared forms/searchable-select.tsx) because that component filters
// cmdk's own CommandItem `value`, which here must stay the user id for
// selection — searching by fullName/email needs a manually filtered list, so
// filtering is done here and `shouldFilter` is turned off on <Command>.
function ConsumptionUserFilter({
  users,
  selectedUserId,
  onSelect,
}: {
  users: FilterUser[];
  selectedUserId: string | null;
  onSelect: (userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedUser = selectedUserId ? users.find((u) => u.id === selectedUserId) : undefined;
  const triggerLabel = selectedUser ? consumptionUserIdentity(selectedUser).primary : 'Todos los usuarios';

  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = normalizedQuery
    ? users.filter((u) => {
        const identity = consumptionUserIdentity(u);
        const haystack = `${identity.primary} ${identity.secondary ?? ''}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : users;
  const noMatches = normalizedQuery.length > 0 && filteredUsers.length === 0;

  function choose(userId: string | null) {
    onSelect(userId);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            size="sm" className="w-[160px] justify-between border-input bg-transparent px-2 font-normal text-xs hover:bg-surface-muted dark:bg-input/30 dark:hover:bg-input/50">
            <span className="truncate">{triggerLabel}</span>
            <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="w-(--anchor-width) max-w-(--available-width) p-0 rounded-xl border shadow-drawer"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar usuario..." value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[280px] overflow-y-auto">
            <CommandGroup>
              <CommandItem value="__all__" onSelect={() => choose(null)} className="text-xs">
                <span className="flex-1">Todos los usuarios</span>
                {!selectedUserId && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
              </CommandItem>
            </CommandGroup>
            {noMatches ? (
              <div className="py-4 text-center">
                <p className="text-xs text-foreground">No encontramos usuarios</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Prueba con otro nombre o correo.</p>
              </div>
            ) : (
              <CommandGroup>
                {filteredUsers.map((u) => {
                  const identity = consumptionUserIdentity(u);
                  return (
                    <CommandItem
                      key={u.id}
                      value={u.id}
                      onSelect={() => choose(u.id)}
                      className="flex flex-col items-start text-xs"
                    >
                      <div className="flex items-center w-full">
                        <span className="flex-1 truncate">{identity.primary}</span>
                        {selectedUserId === u.id && <Check className="ml-2 h-3.5 w-3.5 shrink-0" />}
                      </div>
                      {identity.secondary && (
                        <span className="text-xs text-muted-foreground leading-tight">
                          {identity.secondary}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Barra ─────────────────────────────────────────────────────────────────────

export interface UsageFilterBarProps extends UsageFilterState {
  options: FilterOptions | null | undefined;
  /** El período que se muestra cuando no hay ninguno elegido. */
  defaultPeriod: UsagePeriod;
}

export function UsageFilterBar({
  filters,
  setFilter,
  onRoleChange,
  onGroupChange,
  options,
  defaultPeriod,
}: UsageFilterBarProps) {
  const period = filters.period ?? defaultPeriod;
  const roles = options?.roles ?? [];
  const groups = options?.groups ?? [];
  const agents = options?.agents ?? [];
  const statuses = options?.statuses ?? [];
  const groupNameMap = new Map(groups.map((g) => [g.id, g.name]));

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtros">
      <Select value={period} onValueChange={(v) => setFilter('period', v)}>
        <SelectTrigger size="sm" className="w-[140px]" aria-label="Período">
          <SelectValue>
            {CONSUMPTION_PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CONSUMPTION_PERIOD_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {roles.length > 0 && (
        <Select value={filters.role ?? 'all'} onValueChange={onRoleChange}>
          <SelectTrigger size="sm" className="w-[150px]" aria-label="Rol">
            <SelectValue placeholder="Rol">
              {filters.role
                ? (roles.find((r) => r.key === filters.role)?.label ?? filters.role)
                : 'Todos los roles'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todos los roles</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r.key} value={r.key} className="text-xs">{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {groups.length > 0 && (
        <Select value={filters.groupId ?? 'all'} onValueChange={onGroupChange}>
          <SelectTrigger size="sm" className="w-[160px]" aria-label="Grupo">
            <SelectValue placeholder="Grupo">
              {filters.groupId
                ? (groupNameMap.get(filters.groupId) ?? filters.groupId)
                : 'Todos los grupos'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todos los grupos</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id} className="text-xs">
                <span style={{ paddingLeft: `${g.depth * CONSUMPTION_GROUP_INDENT_PX}px` }}>
                  {g.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {(options?.users ?? []).length > 0 && (
        <ConsumptionUserFilter
          users={scopeUsersToFilters(filters, options)}
          selectedUserId={filters.user ?? null}
          onSelect={(userId) => setFilter('user', userId)}
        />
      )}

      {agents.length > 0 && (
        <Select value={filters.agent ?? 'all'} onValueChange={(v) => setFilter('agent', v)}>
          <SelectTrigger size="sm" className="w-[180px]" aria-label="Agente">
            <SelectValue placeholder="Agente">
              {filters.agent
                ? labelConsumptionAgent(filters.agent, agents.find((a) => a.key === filters.agent)?.name ?? null)
                : 'Todos los agentes'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todos los agentes</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.key} value={a.key} className="text-xs">
                {labelConsumptionAgent(a.key, a.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {statuses.length > 0 && (
        <Select value={filters.status ?? 'all'} onValueChange={(v) => setFilter('status', v)}>
          <SelectTrigger size="sm" className="w-[130px]" aria-label="Estado">
            <SelectValue placeholder="Estado">
              {filters.status ? filters.status.replace(/_/g, ' ') : 'Todos los estados'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todos los estados</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s} className="text-xs capitalize">
                {s.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
