import { redirect } from 'next/navigation';
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
    <div className="flex flex-col max-h-screen overflow-hidden">
      <div className="flex items-start justify-between gap-4 shrink-0 px-8 pt-8 pb-4">
        <PageHeader
          title="Usuarios y acceso"
          description="Gestionar solicitudes, roles, jerarquía y estados de acceso de SellUp."
          backHref="/settings"
        />
        {isAdmin && (
          <div className="flex items-center gap-2">
            <ActionButtons groups={groups} />
            <AddUserDrawer roles={roles} activeUsers={activeUsers} groups={groups} />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 px-8 pb-4 overflow-hidden">
        <div className="h-full max-w-6xl mx-auto">
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
      </div>
    </div>
  );
}