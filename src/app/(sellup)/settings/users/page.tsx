import { redirect } from 'next/navigation';
import { Users as UsersIcon, UserPlus, UserCheck, UserX, Pause, Play, Shield } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  getAllUsers,
  getUsersSummary,
  getAllRoles,
  isCurrentUserAdmin,
  approveUser,
  rejectUser,
  suspendUser,
  reactivateUser,
  changeUserRole,
} from '@/modules/access/actions';
import { UserActions } from './user-actions';
import type { InternalUser, Role } from '@/modules/access/types';

function getStatusBadge(status: string) {
  const statusConfig: Record<string, { label: string; className: string }> = {
    pending_approval: { label: 'Pendiente', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
    active: { label: 'Activo', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
    rejected: { label: 'Rechazado', className: 'bg-destructive/10 text-destructive border-destructive/30' },
    suspended: { label: 'Suspendido', className: 'bg-orange-500/10 text-orange-500 border-orange-500/30' },
  };
  return statusConfig[status] ?? { label: status, className: '' };
}

function getRoleLabel(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  const role = roles.find((r) => r.key === roleKey);
  return role?.name ?? roleKey;
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface UserRowProps {
  user: InternalUser;
  roles: Role[];
  isAdmin: boolean;
}

function UserRow({ user, roles, isAdmin }: UserRowProps) {
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

      <div className="hidden min-w-[140px] text-xs text-muted-foreground md:block">
        {user.access_status === 'pending_approval'
          ? `Solicitado: ${formatDate(user.requested_at)}`
          : user.access_status === 'active'
          ? `Aprobado: ${formatDate(user.approved_at)}`
          : user.access_status === 'rejected'
          ? `Rechazado: ${formatDate(user.rejected_at)}`
          : `Suspendido: ${formatDate(user.suspended_at)}`}
      </div>

      {isAdmin && (
        <UserActions user={user} roles={roles} />
      )}
    </div>
  );
}

export default async function UsersManagementPage() {
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    redirect('/settings');
  }

  const [users, summary, roles] = await Promise.all([
    getAllUsers(),
    getUsersSummary(),
    getAllRoles(),
  ]);

  const pendingUsers = users.filter((u) => u.access_status === 'pending_approval');
  const activeUsers = users.filter((u) => u.access_status === 'active');
  const suspendedUsers = users.filter((u) => u.access_status === 'suspended');
  const rejectedUsers = users.filter((u) => u.access_status === 'rejected');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios y acceso"
        description="Gestionar solicitudes, roles y estados de acceso de SellUp."
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SurfaceCard>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
              <UserPlus className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground">{summary.pending}</p>
              <p className="text-sm text-muted-foreground">Pendientes</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
              <UserCheck className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground">{summary.active}</p>
              <p className="text-sm text-muted-foreground">Activos</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10">
              <Pause className="h-6 w-6 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground">{summary.suspended}</p>
              <p className="text-sm text-muted-foreground">Suspendidos</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
              <UserX className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground">{summary.rejected}</p>
              <p className="text-sm text-muted-foreground">Rechazados</p>
            </div>
          </div>
        </SurfaceCard>
      </div>

      {/* Users list with tabs */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="all" className="gap-2">
            <UsersIcon className="h-4 w-4" />
            Todos ({users.length})
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            <UserPlus className="h-4 w-4" />
            Pendientes ({pendingUsers.length})
          </TabsTrigger>
          <TabsTrigger value="active" className="gap-2">
            <UserCheck className="h-4 w-4" />
            Activos ({activeUsers.length})
          </TabsTrigger>
          <TabsTrigger value="suspended" className="gap-2">
            <Pause className="h-4 w-4" />
            Suspendidos ({suspendedUsers.length})
          </TabsTrigger>
          <TabsTrigger value="rejected" className="gap-2">
            <UserX className="h-4 w-4" />
            Rechazados ({rejectedUsers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-3">
          {users.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay usuarios registrados.
            </div>
          ) : (
            users.map((user) => (
              <UserRow key={user.id} user={user} roles={roles} isAdmin={isAdmin} />
            ))
          )}
        </TabsContent>

        <TabsContent value="pending" className="space-y-3">
          {pendingUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay solicitudes pendientes.
            </div>
          ) : (
            pendingUsers.map((user) => (
              <UserRow key={user.id} user={user} roles={roles} isAdmin={isAdmin} />
            ))
          )}
        </TabsContent>

        <TabsContent value="active" className="space-y-3">
          {activeUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay usuarios activos.
            </div>
          ) : (
            activeUsers.map((user) => (
              <UserRow key={user.id} user={user} roles={roles} isAdmin={isAdmin} />
            ))
          )}
        </TabsContent>

        <TabsContent value="suspended" className="space-y-3">
          {suspendedUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay usuarios suspendidos.
            </div>
          ) : (
            suspendedUsers.map((user) => (
              <UserRow key={user.id} user={user} roles={roles} isAdmin={isAdmin} />
            ))
          )}
        </TabsContent>

        <TabsContent value="rejected" className="space-y-3">
          {rejectedUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay usuarios rechazados.
            </div>
          ) : (
            rejectedUsers.map((user) => (
              <UserRow key={user.id} user={user} roles={roles} isAdmin={isAdmin} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}