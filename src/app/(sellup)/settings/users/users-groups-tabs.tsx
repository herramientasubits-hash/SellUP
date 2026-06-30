'use client';

import { useState, useMemo, useEffect } from 'react';
import { LayoutList, GitBranch } from 'lucide-react';
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
  initialGroupFilter?: string;
  onGroupFilterChange?: (g: string | null) => void;
}

const USER_FILTERS: { id: UserFilter; label: string }[] = [
  { id: 'all',         label: 'Todos' },
  { id: 'active',      label: 'Activos' },
  { id: 'pending',     label: 'Pendientes' },
  { id: 'preapproved', label: 'Preautorizados' },
  { id: 'suspended',   label: 'Suspendidos' },
  { id: 'rejected',    label: 'Rechazados' },
];

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
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
    <div className="flex items-center gap-4 rounded-xl border border-su-brand/20 bg-su-brand-soft/30 p-4">
      <Avatar className="h-10 w-10">
        <AvatarFallback className="bg-su-brand-soft text-su-brand text-xs">
          {getInitials(preapproval.full_name, preapproval.email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {preapproval.full_name ?? 'Sin nombre registrado'}
          </span>
          <Badge variant="outline" className="text-[10px] bg-su-brand-soft text-su-brand border-su-brand/30 shrink-0">
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
        <div className="flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
          {USER_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                onFilterChange?.(f.id);
              }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                filter === f.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
              <span className={cn(
                'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]',
                filter === f.id ? 'bg-su-brand-soft text-su-brand' : 'bg-muted text-muted-foreground',
              )}>
                {filterCounts[f.id]}
              </span>
            </button>
          ))}
        </div>

        {showViewToggle && (
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                viewMode === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
              Lista
            </button>
            <button
              onClick={() => setViewMode('org')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                viewMode === 'org' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
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
            <div className="py-12 text-center text-muted-foreground text-sm">
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
            <div className="py-12 text-center text-muted-foreground text-sm">
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

export function GroupsTab({ users, groups, roles }: GroupsTabProps) {
  const [viewMode, setViewMode] = useState<GroupViewMode>('list');
  const activeUsers = useMemo(() => users.filter(u => u.access_status === 'active'), [users]);

  return (
    <div className="flex flex-col flex-1 min-h-0 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}
        </span>
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              viewMode === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutList className="h-3.5 w-3.5" />
            Lista
          </button>
          <button
            onClick={() => setViewMode('org')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              viewMode === 'org' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
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
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border/40">
          <GroupsView users={activeUsers} groups={groups} roles={roles} />
        </div>
      )}
    </div>
  );
}