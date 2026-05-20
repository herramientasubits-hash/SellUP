import { redirect } from 'next/navigation';
import { UserPlus, UserCheck, UserX, Pause, Clock, Layers } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getAllUsers,
  getAllRoles,
  isCurrentUserAdmin,
  getPreapprovals,
  getOrganizationGroups,
} from '@/modules/access/actions';
import { UsersTab, GroupsTab } from './users-groups-tabs';
import { AddUserDrawer } from './add-user-drawer';

export default async function UsersManagementPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [users, roles, preapprovals, groups] = await Promise.all([
    getAllUsers(),
    getAllRoles(),
    getPreapprovals(),
    getOrganizationGroups(),
  ]);

  const activeUsers    = users.filter(u => u.access_status === 'active');
  const pendingUsers   = users.filter(u => u.access_status === 'pending_approval');
  const suspendedUsers = users.filter(u => u.access_status === 'suspended');
  const rejectedUsers  = users.filter(u => u.access_status === 'rejected');

  const summary = {
    pending:   pendingUsers.length,
    preapproved: preapprovals.length,
    active:    activeUsers.length,
    suspended: suspendedUsers.length,
    rejected:  rejectedUsers.length,
    groups:    groups.length,
  };

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
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-su-brand-soft">
              <Layers className="h-4 w-4 text-su-brand" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">{summary.groups}</p>
              <p className="text-xs text-muted-foreground">Grupos</p>
            </div>
          </div>
        </SurfaceCard>
      </div>

      {/* Main tabs: Usuarios | Grupos */}
      <Tabs defaultValue="usuarios" className="space-y-4">
        <TabsList className="bg-muted/50 flex-wrap h-auto gap-1">
          <TabsTrigger value="usuarios" className="gap-2">
            <UserCheck className="h-4 w-4" />
            Usuarios
          </TabsTrigger>
          <TabsTrigger value="grupos" className="gap-2">
            <Layers className="h-4 w-4" />
            Grupos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios">
          <UsersTab
            users={users}
            roles={roles}
            allUsers={users}
            activeUsers={activeUsers}
            groups={groups}
            preapprovals={preapprovals}
            isAdmin={isAdmin}
          />
        </TabsContent>

        <TabsContent value="grupos">
          <GroupsTab
            users={users}
            groups={groups}
            roles={roles}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}