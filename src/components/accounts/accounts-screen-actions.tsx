'use client';

import * as React from 'react';
import { Plus } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';
import {
  useGenerateProspectsAgentAction,
  type GenerateProspectsAgent,
} from '@/components/prospects/generate-prospects-agent';
import { CreateAccountDrawer } from './create-account-drawer';

type InternalUserOption = React.ComponentProps<typeof CreateAccountDrawer>['users'][number];

interface AccountsScreenActionsProps {
  users: InternalUserOption[];
  /**
   * El asistente «Generar con IA» ya resuelto por el servidor, el mismo de
   * «Por revisar». Sin él (no se pudo resolver) la pantalla no ofrece agente.
   */
  generateAgent?: GenerateProspectsAgent | null;
}

type OpenPanel = 'create' | 'generate' | null;

/**
 * Lo que se puede hacer en «Empresas» sin nada marcado: crear una empresa (la
 * acción primaria) y generar empresas candidatas con IA (el agente de la
 * barra, a un clic). No pinta botones propios: le entrega las acciones a la
 * barra flotante de la pantalla (o a la cabecera, con las acciones «En la
 * pantalla») y monta los paneles que abren, controlados desde aquí.
 */
export function AccountsScreenActions({ users, generateAgent = null }: AccountsScreenActionsProps) {
  const [openPanel, setOpenPanel] = React.useState<OpenPanel>(null);

  const actions = React.useMemo<RailActionSpec[]>(
    () => [
      {
        id: 'create-account',
        label: 'Crear empresa',
        icon: <Plus aria-hidden="true" />,
        scope: ['screen'],
        primary: true,
        onSelect: () => setOpenPanel('create'),
      },
    ],
    [],
  );

  const agentAction = useGenerateProspectsAgentAction(generateAgent?.isGenerateAvailable ?? false, () =>
    setOpenPanel('generate'),
  );

  const closeIf = (panel: OpenPanel) => (isOpen: boolean) => {
    if (isOpen) setOpenPanel(panel);
    else setOpenPanel((current) => (current === panel ? null : current));
  };

  return (
    <>
      <RailScreenActions
        actions={actions}
        agent={generateAgent ? agentAction : null}
        isBlocked={openPanel !== null}
      />
      <CreateAccountDrawer users={users} open={openPanel === 'create'} onOpenChange={closeIf('create')} />
      {generateAgent &&
        React.cloneElement(generateAgent.generateDrawer, {
          open: openPanel === 'generate',
          onOpenChange: closeIf('generate'),
        })}
    </>
  );
}
