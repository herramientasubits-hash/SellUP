'use client';

/**
 * La parte VIVA de la página `/contacts/[contactId]` (AGENT2A-CONTACT-PAGE-ACTIONS, Bryan 19-11):
 * «Cómo contactarle» con todo lo que se revela o verifica, y el aviso de un contacto archivado
 * porque cambió de empresa. La página es un server component; tras cada acción se relee con
 * `router.refresh()` (el servidor vuelve a leer el contacto y el conteo de números guardados).
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { Contact } from '@/modules/contacts/types';
import { ContactChannelsSection } from './contact-channels-section';
import { OfficialContactCompanyChangeBanner } from './official-contact-company-change-banner';

function useRefresh() {
  const router = useRouter();
  return React.useCallback(() => router.refresh(), [router]);
}

export function ContactPageChannels({
  contact,
  additionalPhoneCount,
}: {
  contact: Contact;
  additionalPhoneCount: number;
}) {
  const refresh = useRefresh();
  return (
    <ContactChannelsSection
      variant="page"
      contact={contact}
      additionalPhoneCount={additionalPhoneCount}
      onChanged={refresh}
    />
  );
}

export function ContactPageCompanyChangeBanner({ contact }: { contact: Contact }) {
  const refresh = useRefresh();
  return (
    <OfficialContactCompanyChangeBanner
      contact={{
        id: contact.id,
        archived_at: contact.archived_at,
        metadata: contact.metadata as Record<string, unknown> | null,
      }}
      onRestored={refresh}
    />
  );
}
