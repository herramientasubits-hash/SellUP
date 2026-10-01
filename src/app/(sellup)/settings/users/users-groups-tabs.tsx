'use client';

import { formatInAppZone } from '@/lib/format-date';
import { useState, useMemo } from 'react';
import { LayoutList, GitBranch, Users, UserCheck, Clock, UserPlus, PauseCircle, UserX, type LucideIcon } from "@/icons";
import { FilterChips } from '@/components/filters/filter-chips';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
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

// ─── ViewToggle ───────────────────────────────────────────────────────────────

interface ViewToggleProps {
  value: 'list' | 'org';
  onChange: (value: 'list' | 'org') => void;
  className?: string;
}

const VIEW_OPTIONS = [
  { id: 'list', label: 'Lista', icon: LayoutList },
  { id: 'org', label: 'Organigrama', icon: GitBranch },
] as const;

/** Lista u organigrama: dos formas de ver a las mismas personas o grupos. */
function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  return (
    <div
      className={cn('flex w-fit items-center gap-1 rounded-lg bg-tab-track p-1', className)}
      role="group"
      aria-label="Vista"
    >
      {VIEW_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
            value === option.id ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <option.icon className="h-3.5 w-3.5" />
          {option.label}
        </button>
      ))}
    </div>
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
            Aún no ha entrado
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
        Preautorizado el {formatDate(preapproval.created_at)}
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

  const canShowOrgChart = filter === 'active' || filter === 'all';
  const showPreapprovedList = filter === 'preapproved';
  const showOrgChart = canShowOrgChart && viewMode === 'org';
  const showUserList = !showPreapprovedList && !showOrgChart;
  const listMode: SelectableListMode =
    filter === 'preapproved' ? 'all' : filter;
  const listTitle = USER_FILTERS.find((f) => f.id === filter)?.label ?? 'Usuarios';

  return (
    <div className="flex flex-col gap-4">
      {/* Una sola fila de estados: cada chip filtra la lista y dice cuántos hay.
          Envuelve a la línea siguiente en vez de salirse por la derecha. */}
      <FilterChips
        wrap
        ariaLabel="Filtrar usuarios por estado"
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
      />

      {canShowOrgChart && (
        <ViewToggle value={viewMode} onChange={setViewMode} className="self-end" />
      )}

      {/* Preautorizados: personas con acceso concedido que aún no han entrado */}
      {showPreapprovedList && (
        preapprovals.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No hay nadie preautorizado"
            description="Con «Agregar usuario» puedes dejar aprobado el acceso de alguien antes de que entre por primera vez."
          />
        ) : (
          <div className="space-y-2">
            {preapprovals.map(p => <PreapprovalCard key={p.id} preapproval={p} isAdmin={isAdmin} />)}
          </div>
        )
      )}

      {showOrgChart && (
        <div className="h-128 min-h-0 overflow-hidden">
          <OrgChart users={users} roles={roles} />
        </div>
      )}

      {showUserList && (
        <SelectableUsersList
          // Al cambiar de estado cambian las acciones en lote: la tabla empieza
          // de cero para no arrastrar una selección de otra vista.
          key={listMode}
          users={filteredUsers}
          roles={roles}
          allUsers={allUsers}
          activeUsers={activeUsers}
          groups={groups}
          mode={listMode}
          isAdmin={isAdmin}
          title={listTitle}
        />
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}
        </span>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {viewMode === 'list' && (
        <SurfaceCard>
          <GroupManagementPanel groups={groups} />
        </SurfaceCard>
      )}

      {viewMode === 'org' && (
        <div className="h-128 min-h-0 overflow-y-auto rounded-2xl border border-border/60 bg-card">
          <GroupsView users={activeUsers} groups={groups} roles={roles} isAdmin={isAdmin} />
        </div>
      )}
    </div>
  );
}
