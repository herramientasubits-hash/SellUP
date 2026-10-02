'use client';

import * as React from 'react';
import { UserPlus, Users } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';
import { ActionButtons } from './action-buttons';
import { AddUserDrawer } from './add-user-drawer';

type AddUserDrawerProps = React.ComponentProps<typeof AddUserDrawer>;

interface UsersScreenActionsProps {
  roles: AddUserDrawerProps['roles'];
  activeUsers: AddUserDrawerProps['activeUsers'];
  groups: AddUserDrawerProps['groups'];
}

/**
 * Lo que se puede hacer en «Usuarios y acceso» sin nada marcado: agregar un
 * usuario (la acción primaria) y agregar un grupo. No pinta botones: le entrega
 * las acciones a la barra flotante de la pantalla y monta los paneles que
 * abren, controlados desde aquí.
 */
export function UsersScreenActions({ roles, activeUsers, groups }: UsersScreenActionsProps) {
  const [isAddingUser, setIsAddingUser] = React.useState(false);
  const [isAddingGroup, setIsAddingGroup] = React.useState(false);

  const actions = React.useMemo<RailActionSpec[]>(
    () => [
      {
        id: 'add-group',
        label: 'Agregar grupo',
        icon: <Users aria-hidden="true" />,
        scope: ['screen'],
        onSelect: () => setIsAddingGroup(true),
      },
      {
        id: 'add-user',
        label: 'Agregar usuario',
        icon: <UserPlus aria-hidden="true" />,
        scope: ['screen'],
        primary: true,
        onSelect: () => setIsAddingUser(true),
      },
    ],
    [],
  );

  return (
    <>
      <RailScreenActions actions={actions} isBlocked={isAddingUser || isAddingGroup} />
      <ActionButtons groups={groups} open={isAddingGroup} onOpenChange={setIsAddingGroup} />
      <AddUserDrawer
        roles={roles}
        activeUsers={activeUsers}
        groups={groups}
        open={isAddingUser}
        onOpenChange={setIsAddingUser}
      />
    </>
  );
}
