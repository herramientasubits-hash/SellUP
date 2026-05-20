import { redirect } from 'next/navigation';
import {
  Users as UsersIcon,
  UserPlus,
  UserCheck,
  UserX,
  Pause,
  Clock,
  Layers,
  Archive,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  getAllUsers,
  getUsersSummary,
  getAllRoles,
  isCurrentUserAdmin,
  getPreapprovals,
  getOrganizationGroups,
} from '@/modules/access/actions';
import { UserActions } from './user-actions';
import { OrgChart } from './org-chart';
import { ActiveUsersPanel } from './active-users-panel';
import { GroupsView } from './groups-view';
import { GroupManagementPanel } from './group-management-panel';
import { AddUserDrawer } from './add-user-drawer';
import { PreapprovalCancelButton } from './preapproval-cancel-button';
import { SelectableUsersList } from './selectable-users-list';
import type { InternalUser, Role, UserPreapproval } from '@/modules/access/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusBadge(status: string) {
  const cfg: Record<string, { label: string; className: string }> = {
    pending_approval: { label: 'Pendiente',   className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
    active:           { label: 'Activo',       className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
    rejected:         { label: 'Rechazado',    className: 'bg-destructive/10 text-destructive border-destructive/30' },
    suspended:        { label: 'Suspendido',   className: 'bg-orange-500/10 text-orange-500 border-orange-500/30' },
    archived:         { label: 'Archivado',    className: 'bg-slate-500/10 text-slate-500 border-slate-500/30' },
  };
  return cfg[status] ?? { label: status, className: '' };
}

function getRoleLabel(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find(r => r.key === roleKey)?.name ?? roleKey;
}

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getManagerLabel(managerId: string | null, users: InternalUser[]): string {
  if (!managerId) return 'Sin jefe asignado';
  const m = users.find(u => u.id === managerId);
  return m ? (m.full_name ?? m.email) : 'Sin jefe asignado';
}

// ─── UserRow (for All / Archived tabs that don't need bulk select) ─────────────

interface UserRowProps {
  user: InternalUser;
  roles: Role[];
  allUsers: InternalUser[];
  activeUsers: InternalUser[];
  isAdmin: boolean;
}

function UserRow({ user, roles, allUsers, activeUsers, isAdmin }: UserRowProps) {
  const statusBadge = getStatusBadge(user.access_status);

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border/80">
      <Avatar className="h-10 w-10">
        <AvatarFallback className="bg-su-brand-soft text-su-brand text-xs">
          {getInitials(user.full_name, user.email)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {user.full_name ?? 'Sin nombre'}
          </span>
          <Badge variant="outline" className={`text-[10px] ${statusBadge.className}`}>
            {statusBadge.label}
          </Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
      </div>

      <div className="hidden min-w-[100px] text-sm text-muted-foreground md:block">
        {getRoleLabel(user.role_key, roles)}
      </div>

      <div className="hidden min-w-[120px] text-xs text-muted-foreground md:block">
        {user.access_status === 'active' ? getManagerLabel(user.manager_id, allUsers) : null}
      </div>

      <div className="hidden min-w-[140px] text-xs text-muted-foreground md:block">
        {user.access_status === 'pending_approval' && `Solicitado: ${formatDate(user.requested_at)}`}
        {user.access_status === 'active'           && `Aprobado: ${formatDate(user.approved_at)}`}
        {user.access_status === 'rejected'         && `Rechazado: ${formatDate(user.rejected_at)}`}
        {user.access_status === 'suspended'        && `Suspendido: ${formatDate(user.suspended_at)}`}
        {user.access_status === 'archived'         && `Archivado: ${formatDate(user.archived_at)}`}
      </div>

      {isAdmin && (
        <UserActions user={user} roles={roles} activeUsers={activeUsers} />
      )}
    </div>
  );
}

// ─── PreapprovalRow ───────────────────────────────────────────────────────────

interface PreapprovalRowProps {
  preapproval: UserPreapproval;
  isSelected?: boolean;
  onToggle?: () => void;
  isAdmin: boolean;
  showCheckbox?: boolean;
}

function PreapprovalRow({ preapproval, isSelected, onToggle, isAdmin, showCheckbox }: PreapprovalRowProps) {
  return (
    <div className={`flex items-center gap-4 rounded-xl border p-4 transition-colors ${
      isSelected
        ? 'border-su-brand/40 bg-su-brand-soft/20'
        : 'border-su-brand/20 bg-su-brand-soft/30'
    }`}>
      {showCheckbox && isAdmin && (
        <input
          type="checkbox"
          checked={isSelected ?? false}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 rounded border-border accent-su-brand cursor-pointer"
        />
      )}

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
          <Badge variant="outline" className="text-[10px] bg-su-brand-soft text-su-brand border-su-brand/30">
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function UsersManagementPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [users, summary, roles, preapprovals, groups] = await Promise.all([
    getAllUsers(),
    getUsersSummary(),
    getAllRoles(),
    getPreapprovals(),
    getOrganizationGroups(),
  ]);

  const pendingUsers   = users.filter(u => u.access_status === 'pending_approval');
  const activeUsers    = users.filter(u => u.access_status === 'active');
  const suspendedUsers = users.filter(u => u.access_status === 'suspended');
  const rejectedUsers  = users.filter(u => u.access_status === 'rejected');
  const archivedUsers  = users.filter(u => u.access_status === 'archived');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Usuarios y acceso"
          description="Gestionar solicitudes, roles, jerarquía y estados de acceso de SellUp."
          backHref="/settings"
        />
        {isAdmin && (
          <div className="shrink-0 pt-1">
            <AddUserDrawer roles={roles} activeUsers={activeUsers} groups={groups} />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <SurfaceCard>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10">
              <UserPlus className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">{summary.pending}</p>
              <p className="text-xs text-muted-foreground">Pendientes</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-su-brand-soft">
              <Clock className="h-4 w-4 text-su-brand" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">{summary.preapproved}</p>
              <p className="text-xs text-muted-foreground">Preautorizados</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10">
              <UserCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">{summary.active}</p>
              <p className="text-xs text-muted-foreground">Activos</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/10">
              <Pause className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">{summary.suspended}</p>
              <p className="text-xs text-muted-foreground">Suspendidos</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10">
              <UserX className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">{summary.rejected}</p>
              <p className="text-xs text-muted-foreground">Rechazados</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-500/10">
              <Archive className="h-4 w-4 text-slate-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">{summary.archived}</p>
              <p className="text-xs text-muted-foreground">Archivados</p>
            </div>
          </div>
        </SurfaceCard>
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="active" className="space-y-4">
        <TabsList className="bg-muted/50 flex-wrap h-auto gap-1">
          <TabsTrigger value="active" className="gap-2">
            <UserCheck className="h-4 w-4" />
            Activos ({activeUsers.length})
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <UserPlus className="h-4 w-4" />
            Pendientes ({pendingUsers.length})
          </TabsTrigger>
          <TabsTrigger value="preapproved" className="gap-2">
            <Clock className="h-4 w-4" />
            Preautorizados ({preapprovals.length})
          </TabsTrigger>
          <TabsTrigger value="suspended" className="gap-2">
            <Pause className="h-4 w-4" />
            Suspendidos ({suspendedUsers.length})
          </TabsTrigger>
          <TabsTrigger value="rejected" className="gap-2">
            <UserX className="h-4 w-4" />
            Rechazados ({rejectedUsers.length})
          </TabsTrigger>
          <TabsTrigger value="archived" className="gap-2">
            <Archive className="h-4 w-4" />
            Archivados ({archivedUsers.length})
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-2">
            <UsersIcon className="h-4 w-4" />
            Todos ({users.length})
          </TabsTrigger>
          <TabsTrigger value="groups_mgmt" className="gap-2">
            <Layers className="h-4 w-4" />
            Grupos ({groups.length})
          </TabsTrigger>
        </TabsList>

        {/* Active — with Lista / Organigrama / Grupos view + bulk select */}
        <TabsContent value="active">
          {activeUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No hay usuarios activos.</div>
          ) : (
            <ActiveUsersPanel
              userCount={activeUsers.length}
              listContent={
                <SelectableUsersList
                  users={activeUsers}
                  roles={roles}
                  allUsers={users}
                  activeUsers={activeUsers}
                  groups={groups}
                  mode="active"
                  isAdmin={isAdmin}
                />
              }
              orgContent={
                <SurfaceCard className="overflow-hidden">
                  <OrgChart users={users} roles={roles} />
                </SurfaceCard>
              }
              groupsContent={
                <GroupsView users={activeUsers} groups={groups} roles={roles} />
              }
            />
          )}
        </TabsContent>

        {/* Pending — bulk reject */}
        <TabsContent value="pending">
          {pendingUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No hay solicitudes pendientes.</div>
          ) : (
            <SelectableUsersList
              users={pendingUsers}
              roles={roles}
              allUsers={users}
              activeUsers={activeUsers}
              groups={groups}
              mode="pending"
              isAdmin={isAdmin}
            />
          )}
        </TabsContent>

        {/* Preapproved */}
        <TabsContent value="preapproved" className="space-y-3">
          {preapprovals.length === 0 ? (
            <div className="py-12 text-center">
              <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">No hay preautorizaciones pendientes.</p>
              <p className="text-xs text-muted-foreground mt-1 opacity-70">
                Usa &quot;Agregar usuario&quot; para preautorizar un correo corporativo.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Estos usuarios han sido preautorizados manualmente. Ingresarán automáticamente
                cuando inicien sesión con su correo corporativo por primera vez.
              </p>
              {preapprovals.map(p => (
                <PreapprovalRow key={p.id} preapproval={p} isAdmin={isAdmin} />
              ))}
            </>
          )}
        </TabsContent>

        {/* Suspended — bulk reactivate + archive */}
        <TabsContent value="suspended">
          {suspendedUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No hay usuarios suspendidos.</div>
          ) : (
            <SelectableUsersList
              users={suspendedUsers}
              roles={roles}
              allUsers={users}
              activeUsers={activeUsers}
              groups={groups}
              mode="suspended"
              isAdmin={isAdmin}
            />
          )}
        </TabsContent>

        {/* Rejected — bulk archive, individual activate */}
        <TabsContent value="rejected">
          {rejectedUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No hay usuarios rechazados.</div>
          ) : (
            <SelectableUsersList
              users={rejectedUsers}
              roles={roles}
              allUsers={users}
              activeUsers={activeUsers}
              groups={groups}
              mode="rejected"
              isAdmin={isAdmin}
            />
          )}
        </TabsContent>

        {/* Archived — read-only list */}
        <TabsContent value="archived" className="space-y-3">
          {archivedUsers.length === 0 ? (
            <div className="py-12 text-center">
              <Archive className="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">No hay usuarios archivados.</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Usuarios archivados. No tienen acceso a SellUp. Usa el menú &quot;…&quot; individual para gestionar.
              </p>
              {archivedUsers.map(user => (
                <UserRow key={user.id} user={user} roles={roles} allUsers={users} activeUsers={activeUsers} isAdmin={isAdmin} />
              ))}
            </>
          )}
        </TabsContent>

        {/* All */}
        <TabsContent value="all" className="space-y-3">
          {users.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No hay usuarios registrados.</div>
          ) : (
            users.map(user => (
              <UserRow key={user.id} user={user} roles={roles} allUsers={users} activeUsers={activeUsers} isAdmin={isAdmin} />
            ))
          )}
        </TabsContent>

        {/* Groups management */}
        <TabsContent value="groups_mgmt">
          <SurfaceCard>
            <div className="mb-4">
              <h3 className="text-base font-semibold text-foreground">Estructura de grupos</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Define la estructura organizacional. Máximo 3 niveles. Independiente de la jerarquía de jefes directos.
              </p>
            </div>
            <GroupManagementPanel groups={groups} />
          </SurfaceCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
