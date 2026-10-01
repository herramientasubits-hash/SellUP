'use client';

import * as React from 'react';
import { Plus } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';
import { CreateAccountDrawer } from './create-account-drawer';

type InternalUserOption = React.ComponentProps<typeof CreateAccountDrawer>['users'][number];

interface AccountsScreenActionsProps {
  users: InternalUserOption[];
}

/**
 * Lo que se puede hacer en «Empresas» sin nada marcado. No pinta botones: le
 * entrega la acción a la barra flotante de la pantalla y monta el panel que
 * abre, controlado desde aquí.
 */
export function AccountsScreenActions({ users }: AccountsScreenActionsProps) {
  const [isCreating, setIsCreating] = React.useState(false);

  const actions = React.useMemo<RailActionSpec[]>(
    () => [
      {
        id: 'create-account',
        label: 'Crear empresa',
        icon: <Plus aria-hidden="true" />,
        scope: ['screen'],
        primary: true,
        onSelect: () => setIsCreating(true),
      },
    ],
    [],
  );

  return (
    <>
      <RailScreenActions actions={actions} isBlocked={isCreating} />
      <CreateAccountDrawer users={users} open={isCreating} onOpenChange={setIsCreating} />
    </>
  );
}
