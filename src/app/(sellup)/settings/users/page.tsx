import { redirect } from 'next/navigation';
import { SettingsPage } from '@/components/settings/settings-page';
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
import { ScreenActionRail, ScreenActionRailProvider } from '@/components/action-rail';

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

  return (
    <ScreenActionRailProvider>
      {/* El hueco inferior deja sitio a la barra flotante de acciones. */}
      <SettingsPage
        title="Usuarios y acceso"
        description="Aprueba solicitudes y gestiona roles, grupos y accesos del equipo."
        className="pb-24"
        actions={
          <ScreenActionRail label="Acciones de usuarios">
            <ActionButtons groups={groups} />
            <AddUserDrawer roles={roles} activeUsers={activeUsers} groups={groups} />
          </ScreenActionRail>
        }
      >
        <UsersSettingsClient
          users={users}
          roles={roles}
          activeUsers={activeUsers}
          preapprovals={preapprovals}
          groups={groups}
          isAdmin={isAdmin}
        />
      </SettingsPage>
    </ScreenActionRailProvider>
  );
}
