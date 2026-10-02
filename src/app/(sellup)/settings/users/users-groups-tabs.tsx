'use client';

import { formatInAppZone } from '@/lib/format-date';
import { useState, useMemo } from 'react';
import { LayoutList, GitBranch, Users, UserCheck, Clock, UserPlus, PauseCircle, UserX, type LucideIcon } from "@/icons";
import { FilterChips } from '@/components/filters/filter-chips';
import { ListItem, ListItemGroup } from '@/components/data-display';
import { SegmentedControl } from '@/components/selection/segmented-control';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { SurfaceCard } from '@/components/shared/surface-card';
import { UserAvatar } from './user-avatar';
import { OrgChart } from './org-chart';
import { GroupsView } from './groups-view';
import { SelectableUsersList } from './selectable-users-list';
import { GroupManagementPanel } from './group-management-panel';
import { PreapprovalCancelButton } from './preapproval-cancel-button';
import type { InternalUser, Role, UserPreapproval, OrganizationGroup } from '@/modules/access/types';
import type { SelectableListMode } from './selectable-users-list';

type UserFilter = 'all' | 'active' | 'pending' | 'preapproved' | 'suspended' | 'rejected';

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

/** El estado de acceso que corresponde a cada chip. */
const STATUS_BY_FILTER: Record<string, string> = {
  active: 'active',
  pending: 'pending_approval',
  suspended: 'suspended',
  rejected: 'rejected',
};

/** Los estados que entran en «Todos»: los archivados no se listan. */
const LISTED_STATUSES = new Set<string>(['active', 'pending_approval', 'suspended', 'rejected']);

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return formatInAppZone(dateStr, { day: 'numeric', month: 'short', year: 'numeric' }, 'es-CO');
}

// ─── ViewToggle ───────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'org';

interface ViewOption {
  value: ViewMode;
  label: string;
  icon: LucideIcon;
}

interface ViewToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  options: ViewOption[];
  ariaLabel: string;
  className?: string;
}

/** Lista u organigrama: dos formas de ver a las mismas personas. */
const USER_VIEW_OPTIONS: ViewOption[] = [
  { value: 'list', label: 'Lista', icon: LayoutList },
  { value: 'org', label: 'Organigrama', icon: GitBranch },
];

/** Los grupos se ven como árbol (quién cuelga de quién) o con su gente dentro. */
const GROUP_VIEW_OPTIONS: ViewOption[] = [
  { value: 'list', label: 'Estructura', icon: GitBranch },
  { value: 'org', label: 'Personas', icon: Users },
];

function ViewToggle({ value, onChange, options, ariaLabel, className }: ViewToggleProps) {
  return (
    <SegmentedControl
      size="sm"
      ariaLabel={ariaLabel}
      className={className ? `w-fit ${className}` : 'w-fit'}
      options={options}
      value={value}
      onChange={(next) => onChange(next as ViewMode)}
    />
  );
}

// ─── PreapprovalRow ──────────────────────────────────────────────────────────

interface PreapprovalRowProps {
  preapproval: UserPreapproval;
  isAdmin: boolean;
}

/** Una persona con el acceso ya concedido que todavía no ha entrado. */
function PreapprovalRow({ preapproval, isAdmin }: PreapprovalRowProps) {
  const details = [
    preapproval.email,
    preapproval.role_name ?? 'Sin rol',
    preapproval.manager_name ? `Jefe: ${preapproval.manager_name}` : 'Sin jefe',
  ].join(' · ');

  return (
    <ListItem
      leading={<UserAvatar name={preapproval.full_name} email={preapproval.email} size="lg" />}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{preapproval.full_name ?? 'Sin nombre registrado'}</span>
          <Badge variant="brand" className="shrink-0">
            Aún no ha entrado
          </Badge>
        </span>
      }
      description={details}
      meta={
        <span className="hidden md:inline">
          Preautorizado el {formatDate(preapproval.created_at)}
        </span>
      }
      actions={
        isAdmin ? (
          <PreapprovalCancelButton preapprovalId={preapproval.id} email={preapproval.email} />
        ) : undefined
      }
    />
  );
}

// ─── UsersTab ─────────────────────────────────────────────────────────────────

export function UsersTab({
  users, roles, allUsers, activeUsers, groups, preapprovals, isAdmin,
  initialFilter = 'active', onFilterChange,
}: UsersTabProps) {
  const [filter, setFilter] = useState<UserFilter>(initialFilter);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const filteredUsers = useMemo(() => {
    if (filter === 'all') return users.filter(u => LISTED_STATUSES.has(u.access_status));
    if (filter === 'preapproved') return [];
    const mapped = STATUS_BY_FILTER[filter];
    return mapped ? users.filter(u => u.access_status === mapped) : [];
  }, [users, filter]);

  const filterCounts = useMemo(() => ({
    all:         users.filter(u => LISTED_STATUSES.has(u.access_status)).length,
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
        <ViewToggle
          value={viewMode}
          onChange={setViewMode}
          options={USER_VIEW_OPTIONS}
          ariaLabel="Ver usuarios como lista u organigrama"
          className="self-end"
        />
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
          <ListItemGroup aria-label="Personas preautorizadas">
            {preapprovals.map(p => <PreapprovalRow key={p.id} preapproval={p} isAdmin={isAdmin} />)}
          </ListItemGroup>
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

export function GroupsTab({ users, groups, roles, isAdmin = false }: GroupsTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const activeUsers = useMemo(() => users.filter(u => u.access_status === 'active'), [users]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}
        </span>
        <ViewToggle
          value={viewMode}
          onChange={setViewMode}
          options={GROUP_VIEW_OPTIONS}
          ariaLabel="Ver la estructura de grupos o las personas de cada grupo"
        />
      </div>

      {viewMode === 'list' && (
        <SurfaceCard>
          <GroupManagementPanel groups={groups} />
        </SurfaceCard>
      )}

      {viewMode === 'org' && (
        <GroupsView users={activeUsers} groups={groups} roles={roles} isAdmin={isAdmin} />
      )}
    </div>
  );
}
