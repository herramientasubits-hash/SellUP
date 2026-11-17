'use client';

/**
 * HubSpot en la PÁGINA de una empresa (`/accounts/[id]`) o de un contacto
 * (`/contacts/[id]`), igual que en su ficha lateral
 * (dueña 17-11, FNL Laboratory: la página no traía nada de HubSpot). La página es del
 * servidor: estas piezas leen HubSpot desde el navegador, por la ruta de consulta, y sólo
 * cuando su pestaña está abierta (las pestañas sin abrir no se montan).
 *
 *  - Actividad: notas, llamadas, reuniones, tareas, negocios y «Creado en HubSpot».
 *  - Contactos: los de HubSpot que aún no están en SellUp, con «Traer».
 *  - HubSpot: todos sus datos, agrupados como en su ficha de HubSpot.
 *
 * Sólo lectura en HubSpot; «Traer» crea el contacto en SellUp (sin teléfono).
 */

import * as React from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { hubspotCompanyUrl, hubspotContactUrl } from '@/components/contact-enrichment/hubspot-company-url';
import { importHubSpotContact } from '@/modules/hubspot-lookup/actions';
import type { HubSpotContactHit } from '@/modules/hubspot-lookup/types';
import { HubSpotActivitySection, useHubSpotActivity } from './hubspot-activity';
import { HubSpotContactsSection, useHubSpotAccountContacts } from './hubspot-contacts-section';
import { HubSpotPropertiesSection, useHubSpotProperties } from './hubspot-properties-section';

interface AccountHubSpotProps {
  accountId: string;
  hubspotCompanyId: string;
}

/** «Actividad en HubSpot» de la empresa (pestaña Actividad de la página). */
export function AccountHubSpotActivity({ hubspotCompanyId }: Pick<AccountHubSpotProps, 'hubspotCompanyId'>) {
  const activity = useHubSpotActivity('company', hubspotCompanyId);
  return (
    <HubSpotActivitySection
      state={activity.state}
      onRetry={activity.retry}
      hubspotUrl={hubspotCompanyUrl(hubspotCompanyId, null)}
    />
  );
}

/** Contactos de HubSpot que aún no están en SellUp, con «Traer» (pestaña Contactos). */
export function AccountHubSpotContacts({ accountId, hubspotCompanyId, archived }: AccountHubSpotProps & { archived: boolean }) {
  const router = useRouter();
  const contacts = useHubSpotAccountContacts(accountId, true);
  const [importingId, setImportingId] = React.useState<string | null>(null);

  async function handleImport(contact: HubSpotContactHit) {
    setImportingId(contact.id);
    try {
      const res = await importHubSpotContact(contact.id, hubspotCompanyId, accountId);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`${contact.fullName} quedó en SellUp`);
      router.refresh();
      contacts.reload();
    } catch {
      toast.error('No pudimos traer el contacto. Vuelve a intentarlo.');
    } finally {
      setImportingId(null);
    }
  }

  return (
    <HubSpotContactsSection
      state={contacts.state ?? { status: 'loading' }}
      onRetry={contacts.reload}
      onlyMissing
      onImport={archived ? undefined : handleImport}
      importingId={importingId}
    />
  );
}

/** Todos los datos de HubSpot de la empresa (pestaña HubSpot). */
export function AccountHubSpotData({ hubspotCompanyId }: Pick<AccountHubSpotProps, 'hubspotCompanyId'>) {
  const properties = useHubSpotProperties('company', hubspotCompanyId, true);
  return (
    <HubSpotPropertiesSection
      kind="company"
      state={properties.state}
      onRetry={properties.retry}
      hubspotUrl={hubspotCompanyUrl(hubspotCompanyId, null)}
    />
  );
}

/** «Actividad en HubSpot» de un contacto (pestaña Actividad de su página). */
export function ContactHubSpotActivity({ hubspotContactId }: { hubspotContactId: string }) {
  const activity = useHubSpotActivity('contact', hubspotContactId);
  return (
    <HubSpotActivitySection
      state={activity.state}
      onRetry={activity.retry}
      hubspotUrl={hubspotContactUrl(hubspotContactId, null)}
    />
  );
}

/** Todos los datos de HubSpot de un contacto (pestaña HubSpot de su página). */
export function ContactHubSpotData({ hubspotContactId }: { hubspotContactId: string }) {
  const properties = useHubSpotProperties('contact', hubspotContactId, true);
  return (
    <HubSpotPropertiesSection
      kind="contact"
      state={properties.state}
      onRetry={properties.retry}
      hubspotUrl={hubspotContactUrl(hubspotContactId, null)}
    />
  );
}
