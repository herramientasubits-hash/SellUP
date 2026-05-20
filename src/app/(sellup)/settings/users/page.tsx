import { redirect } from 'next/navigation';
import {
  UserPlus, UserCheck, UserX, Pause, Clock, Layers,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import {
  getAllUsers,
  getAllRoles,
  isCurrentUserAdmin,
  getPreapprovals,
  getOrganizationGroups,
} from '@/modules/access/actions';
import { UsersSettingsClient } from './users-settings-client';
import { AddUserDrawer } from './add-user-drawer';
import { ActionButtons } from './action-buttons';

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Usuarios y acceso"
          description="Gestionar solicitudes, roles, jerarquía y estados de acceso de SellUp."
          backHref="/settings"
        />
        {isAdmin && (
          <div className="shrink-0 flex items-center gap-2 pt-1">
            <ActionButtons groups={groups} />
            <AddUserDrawer roles={roles} activeUsers={activeUsers} groups={groups} />
          </div>
        )}
      </div>

      <UsersSettingsClient
        users={users}
        roles={roles}
        activeUsers={activeUsers}
        pendingUsers={pendingUsers}
        suspendedUsers={suspendedUsers}
        rejectedUsers={rejectedUsers}
        preapprovals={preapprovals}
        groups={groups}
        isAdmin={isAdmin}
      />
    </div>
  );
}