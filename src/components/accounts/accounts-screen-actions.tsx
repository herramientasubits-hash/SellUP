'use client';

import * as React from 'react';
import { Plus } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';
import {
  type GenerateProspectsAgent,
} from '@/components/prospects/generate-prospects-agent';
import { CreateAccountDrawer } from './create-account-drawer';
import { FirstContactOutsideLauncher } from '@/components/first-call/first-contact-outside-launcher';
import { ContactsEnrichmentCTA } from '@/components/contact-enrichment/contacts-enrichment-cta';
import { AccountsAgentChooser, type AccountsAgentFlow } from './accounts-agent-chooser';
import { AGENT_NAME, RumboIcon } from '@/components/chat';

type InternalUserOption = React.ComponentProps<typeof CreateAccountDrawer>['users'][number];

interface AccountsScreenActionsProps {
  users: InternalUserOption[];
  /** ALWAYS-OWNER-ON-CREATE-1 — responsable por defecto al crear una empresa. */
  currentUserId?: string | null;
  /**
   * El asistente «Generar con IA» ya resuelto por el servidor, el mismo de
   * «Por revisar». Sin él (no se pudo resolver) la pantalla no ofrece agente.
   */
  generateAgent?: GenerateProspectsAgent | null;
  /** Agente 3 encendido: «Preparar primer contacto» para cualquier empresa (la elige o la crea). */
  firstCallEnabled?: boolean;
}

type OpenPanel = 'create' | 'choose' | 'generate' | 'contacts' | 'first-contact' | null;

/**
 * Lo que se puede hacer en «Empresas» sin nada marcado: crear una empresa (la
 * acción primaria) y generar empresas candidatas con IA (el agente de la
 * barra, a un clic). No pinta botones propios: le entrega las acciones a la
 * barra flotante de la pantalla (o a la cabecera, con las acciones «En la
 * pantalla») y monta los paneles que abren, controlados desde aquí.
 */
export function AccountsScreenActions({
  users,
  currentUserId = null,
  generateAgent = null,
  firstCallEnabled = false,
}: AccountsScreenActionsProps) {
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

  // El agente de Empresas pregunta primero qué hacer: prospectar, buscar contactos o
  // preparar el primer contacto (dueña 18-10).
  const agentAction = React.useMemo<RailActionSpec>(
    () => ({
      id: 'accounts-agent',
      label: AGENT_NAME,
      icon: <RumboIcon />,
      scope: ['screen'],
      variant: 'ai',
      onSelect: () => setOpenPanel('choose'),
    }),
    [],
  );
  const prospect = !generateAgent ? 'none' : generateAgent.isGenerateAvailable ? 'available' : 'unavailable';
  const choose = (flow: AccountsAgentFlow) => setOpenPanel(flow === 'prospect' ? 'generate' : flow);
  // «Volver» desde cualquiera de los tres caminos: otra vez «¿Qué quieres hacer?».
  const backToChooser = () => setOpenPanel('choose');

  const closeIf = (panel: OpenPanel) => (isOpen: boolean) => {
    if (isOpen) setOpenPanel(panel);
    else setOpenPanel((current) => (current === panel ? null : current));
  };

  return (
    <>
      <RailScreenActions
        actions={actions}
        agent={agentAction}
        isBlocked={openPanel !== null}
      />
      <AccountsAgentChooser
        open={openPanel === 'choose'}
        onOpenChange={closeIf('choose')}
        onChoose={choose}
        prospect={prospect}
        firstContactAvailable={firstCallEnabled}
      />
      <ContactsEnrichmentCTA open={openPanel === 'contacts'} onOpenChange={closeIf('contacts')} onBack={backToChooser} />
      {firstCallEnabled && (
        <FirstContactOutsideLauncher open={openPanel === 'first-contact'} onOpenChange={closeIf('first-contact')} onBack={backToChooser} />
      )}
      <CreateAccountDrawer
        users={users}
        currentUserId={currentUserId}
        open={openPanel === 'create'}
        onOpenChange={closeIf('create')}
      />
      {generateAgent &&
        React.cloneElement(generateAgent.generateDrawer, {
          open: openPanel === 'generate',
          onOpenChange: closeIf('generate'),
          onBack: backToChooser,
        })}
    </>
  );
}
