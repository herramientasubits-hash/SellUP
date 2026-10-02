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
import { UsersScreenActions } from './users-screen-actions';
import { ListActionRailProvider } from '@/components/action-rail';

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
    <ListActionRailProvider label="Acciones de usuarios" gender="m">
      {/* El hueco inferior deja sitio a la barra flotante de acciones. */}
      <SettingsPage
        title="Usuarios y acceso"
        description="Aprueba solicitudes y gestiona roles, grupos y accesos del equipo."
        className="pb-24"
        actions={<UsersScreenActions roles={roles} activeUsers={activeUsers} groups={groups} />}
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
    </ListActionRailProvider>
  );
}
