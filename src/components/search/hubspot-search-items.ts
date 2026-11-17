/**
 * Resultados de HubSpot en la búsqueda general (presentación pura).
 *
 *  - Lo que ya está en SellUp y quien busca puede abrir va a su grupo de siempre
 *    («Empresas», «Contactos»), con el mismo `id` que los registros en memoria: así no
 *    sale dos veces, y aparece aunque no esté entre los 200 más recientes.
 *  - Lo demás va a «En HubSpot» y abre la ficha en modo consulta.
 */

import { Building2, User as UserIcon } from '@/icons';
import type { SearchObjectItem } from './global-search';
import {
  hubspotCompanyHref,
  hubspotContactHref,
  type HubSpotCompanyHit,
  type HubSpotContactHit,
  type SellUpPresence,
} from '@/modules/hubspot-lookup/types';
import { openRecordHref, type OpenRecordKind } from '@/modules/global-search/open-record-link';

export const HUBSPOT_SEARCH_GROUP = 'En HubSpot';

/** Cómo se abre un registro de HubSpot (navegar, o avisar a la pantalla si ya se está en ella). */
export type OpenHubSpotRecord = (kind: 'company' | 'contact', id: string) => void;

/** Cómo se abre la ficha lateral de un registro de SellUp (no su página). */
export type OpenSellUpDrawer = (kind: OpenRecordKind, id: string) => void;

function compact(values: ReadonlyArray<string | null | undefined>): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function presenceNote(presence: SellUpPresence): string | null {
  if (presence.status !== 'other_owner') return null;
  return presence.ownerName ? `En SellUp la lleva ${presence.ownerName}` : 'En SellUp la lleva otra persona';
}

export function hubspotCompanySearchItem(
  company: HubSpotCompanyHit,
  open?: OpenHubSpotRecord,
  openDrawer?: OpenSellUpDrawer,
): SearchObjectItem {
  if (company.sellup.status === 'visible') {
    return {
      id: `account-${company.sellup.id}`,
      title: company.name,
      meta: compact([company.industry, company.country]),
      keywords: compact([company.domain, company.website]),
      icon: Building2,
      group: 'Empresas',
      href: openRecordHref('account', company.sellup.id),
      onSelect: openDrawer ? () => openDrawer('account', (company.sellup as { id: string }).id) : undefined,
    };
  }
  return {
    id: `hubspot-company-${company.id}`,
    title: company.name,
    meta: compact(['Empresa', company.domain, company.country, presenceNote(company.sellup)]),
    keywords: compact([company.domain, company.website, company.taxId]),
    icon: Building2,
    group: HUBSPOT_SEARCH_GROUP,
    href: hubspotCompanyHref(company.id),
    onSelect: open ? () => open('company', company.id) : undefined,
    actionLabel: 'Consultar',
  };
}

export function hubspotContactSearchItem(
  contact: HubSpotContactHit,
  open?: OpenHubSpotRecord,
  openDrawer?: OpenSellUpDrawer,
): SearchObjectItem {
  if (contact.sellup.status === 'visible') {
    return {
      id: `contact-${contact.sellup.id}`,
      title: contact.fullName,
      meta: compact([contact.jobTitle, contact.companyName]),
      keywords: compact([contact.email]),
      icon: UserIcon,
      group: 'Contactos',
      href: openRecordHref('contact', contact.sellup.id),
      onSelect: openDrawer ? () => openDrawer('contact', (contact.sellup as { id: string }).id) : undefined,
    };
  }
  return {
    id: `hubspot-contact-${contact.id}`,
    title: contact.fullName,
    meta: compact(['Contacto', contact.jobTitle, contact.companyName, presenceNote(contact.sellup)]),
    keywords: compact([contact.email]),
    icon: UserIcon,
    group: HUBSPOT_SEARCH_GROUP,
    href: hubspotContactHref(contact.id),
    onSelect: open ? () => open('contact', contact.id) : undefined,
    actionLabel: 'Consultar',
  };
}

/** Todos los resultados de HubSpot, en el orden en que se pintan. */
export function hubspotSearchItems(
  companies: readonly HubSpotCompanyHit[],
  contacts: readonly HubSpotContactHit[],
  open?: OpenHubSpotRecord,
  openDrawer?: OpenSellUpDrawer,
): SearchObjectItem[] {
  return [
    ...companies.map((c) => hubspotCompanySearchItem(c, open, openDrawer)),
    ...contacts.map((c) => hubspotContactSearchItem(c, open, openDrawer)),
  ];
}
