'use client';

import * as React from 'react';
import { Sparkles, UserPlus } from '@/icons';

import { RailScreenActions, type RailActionSpec } from '@/components/action-rail';
import { ContactsEnrichmentCTA } from '@/components/contact-enrichment/contacts-enrichment-cta';
import { CreateContactDrawer } from './create-contact-drawer';

type AccountOption = NonNullable<React.ComponentProps<typeof CreateContactDrawer>['accounts']>[number];

interface ContactsScreenActionsProps {
  /** Las empresas entre las que elegir al crear un contacto a mano. */
  accounts: AccountOption[];
}

/**
 * Lo que se puede hacer en «Contactos» y en «Por revisar» sin nada marcado:
 * crear un contacto a mano (la acción primaria) y buscar contactos con IA (el
 * agente de la barra, con el degradado de IA, a un clic). No pinta botones
 * propios: le entrega las acciones a la barra flotante de la pantalla (o a la
 * cabecera, con las acciones «En la pantalla») y monta los paneles que abren,
 * controlados desde aquí.
 */
export function ContactsScreenActions({ accounts }: ContactsScreenActionsProps) {
  const [isSearching, setIsSearching] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);

  const actions = React.useMemo<RailActionSpec[]>(
    () => [
      {
        id: 'create-contact',
        label: 'Crear contacto',
        icon: <UserPlus aria-hidden="true" />,
        scope: ['screen'],
        primary: true,
        onSelect: () => setIsCreating(true),
      },
    ],
    [],
  );

  const agent = React.useMemo<RailActionSpec>(
    () => ({
      id: 'search-contacts-ai',
      label: 'Buscar contactos con IA',
      icon: <Sparkles aria-hidden="true" />,
      scope: ['screen'],
      variant: 'ai',
      onSelect: () => setIsSearching(true),
    }),
    [],
  );

  return (
    <>
      <RailScreenActions actions={actions} agent={agent} isBlocked={isSearching || isCreating} />
      <ContactsEnrichmentCTA open={isSearching} onOpenChange={setIsSearching} />
      <CreateContactDrawer accounts={accounts} open={isCreating} onOpenChange={setIsCreating} />
    </>
  );
}
