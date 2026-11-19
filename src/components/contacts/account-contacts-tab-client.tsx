'use client';

/**
 * La pestaña «Contactos» de la PÁGINA de la empresa (`/accounts/[accountId]`), con el nombre de
 * cada contacto clicable (AGENT2A-CONTACT-PAGE-ACTIONS, Bryan 19-11).
 *
 * `ContactsTab` sólo vuelve el nombre clicable si recibe `onViewContact`. El panel de la empresa
 * se lo pasaba; la página no, así que la única salida era «⋯ → Ver detalle». Aquí el clic abre el
 * panel lateral del contacto (igual que en «Lista de contactos»): se revisa y se revela sin salir
 * de la empresa. Al cerrarlo se relee la página para que la tabla muestre lo revelado.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { Contact, ContactsSummary } from '@/modules/contacts/types';
import { ContactsTab } from './contacts-tab';
import { ContactDetailSheet } from './contact-detail-sheet';

export function AccountContactsTabClient({
  accountId,
  contacts,
  summary,
}: {
  accountId: string;
  contacts: Contact[];
  summary: ContactsSummary;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const view = React.useCallback((contactId: string) => {
    setSelectedId(contactId);
    setOpen(true);
  }, []);

  return (
    <>
      <ContactsTab
        accountId={accountId}
        contacts={contacts}
        summary={summary}
        onViewContact={view}
        onContactsChanged={() => router.refresh()}
      />
      <ContactDetailSheet
        contactId={selectedId}
        open={open}
        onClose={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
