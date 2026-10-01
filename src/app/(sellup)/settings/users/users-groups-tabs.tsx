'use client';

import { formatInAppZone } from '@/lib/format-date';
import { useState, useMemo, useEffect } from 'react';
import { LayoutList, GitBranch, Users, UserCheck, Clock, UserPlus, PauseCircle, UserX, type LucideIcon } from "@/icons";
import { FilterChips } from '@/components/filters/filter-chips';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SurfaceCard } from '@/components/shared/surface-card';
import { OrgChart } from './org-chart';
import { GroupsView } from './groups-view';
import { SelectableUsersList } from './selectable-users-list';
import { GroupManagementPanel } from './group-management-panel';
import { PreapprovalCancelButton } from './preapproval-cancel-button';
import type { InternalUser, Role, UserPreapproval, OrganizationGroup } from '@/modules/access/types';
import type { SelectableListMode } from './selectable-users-list';

type UserFilter = 'all' | 'active' | 'pending' | 'preapproved' | 'suspended' | 'rejected';
type UserViewMode = 'list' | 'org';
type GroupViewMode = 'list' | 'org';

interface UsersTabProps {
  users: InternalUser[];
  roles: Role[];
  allUsers: InternalUser[];
  activeUsers: InternalUser[];
  groups: OrganizationGroup[];
  preapprovals: UserPreapproval[];
  isAdmin: boolean;
  initialFilter?: UserFilter;
  onFilterChange?: (filter: UserFilter) => void;
}

interface GroupsTabProps {
  users: InternalUser[];
  groups: OrganizationGroup[];
  roles: Role[];
  isAdmin?: boolean;
  initialGroupFilter?: string;
  onGroupFilterChange?: (g: string | null) => void;
}

const USER_FILTERS: { id: UserFilter; label: string; icon: LucideIcon }[] = [
  { id: 'all',         label: 'Todos',          icon: Users },
  { id: 'active',      label: 'Activos',        icon: UserCheck },
  { id: 'pending',     label: 'Pendientes',     icon: Clock },
  { id: 'preapproved', label: 'Preautorizados', icon: UserPlus },
  { id: 'suspended',   label: 'Suspendidos',    icon: PauseCircle },
  { id: 'rejected',    label: 'Rechazados',     icon: UserX },
];

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatInAppZone(dateStr, { day: 'numeric', month: 'short', year: 'numeric' }, 'es-CO');
}

// ─── UserList (passes correct mode to SelectableUsersList) ───────────────────

interface UserListProps {
  users: InternalUser[];
  roles: Role[];
  allUsers: InternalUser[];
  activeUsers: InternalUser[];
  groups: OrganizationGroup[];
  filter: UserFilter;
  isAdmin: boolean;
}

function UserList({ users, roles, allUsers, activeUsers, groups, filter, isAdmin }: UserListProps) {
  const mode: SelectableListMode = filter === 'all' ? 'all' : filter as Exclude<SelectableListMode, 'all'>;
  return (
    <SelectableUsersList
      users={users}
      roles={roles}
      allUsers={allUsers}
      activeUsers={activeUsers}
      groups={groups}
      mode={mode}
      isAdmin={isAdmin}
    />
  );
}

// ─── PreapprovalCard ─────────────────────────────────────────────────────────

interface PreapprovalCardProps {
  preapproval: UserPreapproval;
  isAdmin: boolean;
}

function PreapprovalCard({ preapproval, isAdmin }: PreapprovalCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <Avatar className="h-10 w-10">
        <AvatarFallback className="bg-primary/10 text-primary text-xs">
          {getInitials(preapproval.full_name, preapproval.email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {preapproval.full_name ?? 'Sin nombre registrado'}
          </span>
          <Badge variant="brand" className="shrink-0">
            Esperando primer login
          </Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">{preapproval.email}</div>
      </div>
      <div className="hidden min-w-[100px] text-sm text-muted-foreground md:block">
        {preapproval.role_name ?? 'Sin rol'}
      </div>
      <div className="hidden min-w-[120px] text-xs text-muted-foreground md:block">
        {preapproval.manager_name ?? 'Sin jefe'}
      </div>
      <div className="hidden min-w-[140px] text-xs text-muted-foreground md:block">
        Preautorizado: {formatDate(preapproval.created_at)}
      </div>
      {isAdmin && (
        <PreapprovalCancelButton preapprovalId={preapproval.id} email={preapproval.email} />
      )}
    </div>
  );
}

// ─── UsersTab ─────────────────────────────────────────────────────────────────

export function UsersTab({
  users, roles, allUsers, activeUsers, groups, preapprovals, isAdmin,
  initialFilter = 'active', onFilterChange,
}: UsersTabProps) {
  const [filter, setFilter] = useState<UserFilter>(initialFilter);
  const [viewMode, setViewMode] = useState<UserViewMode>('list');

  const statusMap: Record<string, string> = {
    active: 'active',
    pending: 'pending_approval',
    suspended: 'suspended',
    rejected: 'rejected',
  };

  const activeFilters = new Set(['active', 'pending_approval', 'suspended', 'rejected']);
  const filteredUsers = useMemo(() => {
    if (filter === 'all') return users.filter(u => activeFilters.has(u.access_status));
    if (filter === 'preapproved') return [];
    const mapped = statusMap[filter];
    return mapped ? users.filter(u => u.access_status === mapped) : [];
  }, [users, filter]);

  const filterCounts = useMemo(() => ({
    all:         users.filter(u => activeFilters.has(u.access_status)).length,
    active:      users.filter(u => u.access_status === 'active').length,
    pending:     users.filter(u => u.access_status === 'pending_approval').length,
    preapproved: preapprovals.length,
    suspended:   users.filter(u => u.access_status === 'suspended').length,
    rejected:    users.filter(u => u.access_status === 'rejected').length,
  }), [users, preapprovals]);

  const showOrgChart = (filter === 'active' || filter === 'all') && viewMode === 'org';
  const showPreapprovedList = filter === 'preapproved';
  const showUserList = viewMode === 'list' && !showPreapprovedList;
  const showViewToggle = filter === 'active' || filter === 'all';

  return (
    <div className="flex flex-col flex-1 min-h-0 space-y-4">
      {/* Filter bar + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Thema: fila de chips con contador encima de la lista. Mismo estado y
            mismos conteos que antes; solo cambia la pieza que los pinta. */}
        <FilterChips
          ariaLabel="Filtrar usuarios"
          value={filter}
          onChange={(value) => {
            const next = value as UserFilter;
            setFilter(next);
            onFilterChange?.(next);
          }}
          options={USER_FILTERS.map((f) => ({
            value: f.id,
            label: f.label,
            count: filterCounts[f.id],
            icon: f.icon,
          }))}
          className="min-w-0 flex-1"
        />

        {showViewToggle && (
          <div className="flex items-center gap-1 rounded-lg bg-tab-track p-1" role="group" aria-label="Vista">
            <button
              type="button"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
                viewMode === 'list' ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
              Lista
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'org'}
              onClick={() => setViewMode('org')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
                viewMode === 'org' ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Organigrama
            </button>
          </div>
        )}
      </div>

      {/* Preapproved list */}
      {showPreapprovedList && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {preapprovals.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No hay preautorizaciones pendientes.
            </div>
          ) : (
            preapprovals.map(p => <PreapprovalCard key={p.id} preapproval={p} isAdmin={isAdmin} />)
          )}
        </div>
      )}

      {/* Org chart */}
      {showOrgChart && viewMode === 'org' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <OrgChart users={users} roles={roles} />
        </div>
      )}

      {/* User list */}
      {showUserList && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No hay usuarios en esta categoría.
            </div>
          ) : (
            <UserList
              users={filteredUsers}
              roles={roles}
              allUsers={allUsers}
              activeUsers={activeUsers}
              groups={groups}
              filter={filter}
              isAdmin={isAdmin}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── GroupsTab ─────────────────────────────────────────────────────────────────

interface GroupsTabProps {
  users: InternalUser[];
  groups: OrganizationGroup[];
  roles: Role[];
}

export function GroupsTab({ users, groups, roles, isAdmin = false }: GroupsTabProps) {
  const [viewMode, setViewMode] = useState<GroupViewMode>('list');
  const activeUsers = useMemo(() => users.filter(u => u.access_status === 'active'), [users]);

  return (
    <div className="flex flex-col flex-1 min-h-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}
        </span>
        <div className="flex items-center gap-1 rounded-lg bg-tab-track p-1" role="group" aria-label="Vista">
          <button
            type="button"
            aria-pressed={viewMode === 'list'}
            onClick={() => setViewMode('list')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
              viewMode === 'list' ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutList className="h-3.5 w-3.5" />
            Lista
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'org'}
            onClick={() => setViewMode('org')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
              viewMode === 'org' ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Organigrama
          </button>
        </div>
      </div>

      {viewMode === 'list' && (
        <SurfaceCard className="flex-1">
          <GroupManagementPanel groups={groups} />
        </SurfaceCard>
      )}

      {viewMode === 'org' && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border/60 bg-card">
          <GroupsView users={activeUsers} groups={groups} roles={roles} isAdmin={isAdmin} />
        </div>
      )}
    </div>
  );
}