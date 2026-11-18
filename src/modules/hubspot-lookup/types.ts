/** Tipos de la consulta de HubSpot que usan las pantallas (sin código de servidor). */

import type {
  HubSpotActivityItem,
  HubSpotActivityKind,
  HubSpotCompanyView,
  HubSpotContactView,
  SellUpPresence,
} from '@/server/integrations/hubspot-lookup/hubspot-lookup-core';
import type {
  HubSpotPropertyEntry,
  HubSpotPropertySection,
  HubSpotPropertyValueKind,
} from '@/server/integrations/hubspot-lookup/hubspot-properties-core';

export type { HubSpotPropertyEntry, HubSpotPropertySection, HubSpotPropertyValueKind };

export type { HubSpotActivityKind, HubSpotCompanyView, HubSpotContactView, SellUpPresence };

/** Por qué no hay datos de HubSpot: no está conectado o no respondió. */
export type HubSpotLookupUnavailable = { status: 'unavailable'; reason: 'not_connected' | 'unavailable' };

export interface HubSpotCompanyHit extends HubSpotCompanyView {
  sellup: SellUpPresence;
  ownerName: string | null;
}

export interface HubSpotContactHit extends HubSpotContactView {
  sellup: SellUpPresence;
  ownerName: string | null;
}

export type HubSpotSearchResult =
  | { status: 'ok'; companies: HubSpotCompanyHit[]; contacts: HubSpotContactHit[] }
  | HubSpotLookupUnavailable;

export type HubSpotCompanyLookupResult =
  | { status: 'ok'; company: HubSpotCompanyHit; contacts: HubSpotContactHit[]; portalId: string | null }
  | { status: 'not_found' }
  | HubSpotLookupUnavailable;

export type HubSpotContactLookupResult =
  | { status: 'ok'; contact: HubSpotContactHit; company: HubSpotCompanyHit | null; portalId: string | null }
  | { status: 'not_found' }
  | HubSpotLookupUnavailable;

export type HubSpotAccountContactsResult =
  | { status: 'ok'; hubspotCompanyId: string | null; contacts: HubSpotContactHit[]; portalId: string | null }
  | { status: 'not_found' }
  | HubSpotLookupUnavailable;

export type HubSpotActivityEntry = HubSpotActivityItem & { ownerName: string | null };

export type HubSpotActivityLookupResult =
  | { status: 'ok'; items: HubSpotActivityEntry[]; missingKinds: HubSpotActivityKind[] }
  | HubSpotLookupUnavailable;

export type HubSpotPropertiesLookupResult =
  | { status: 'ok'; sections: HubSpotPropertySection[] }
  | { status: 'not_found' }
  | HubSpotLookupUnavailable;

export type ImportHubSpotCompanyResult =
  | { success: true; accountId: string; created: boolean }
  | { success: false; error: string };

export type ImportHubSpotContactResult =
  | {
      success: true;
      accountId: string;
      contactId: string;
      created: boolean;
      /** Lo que le falta al contacto traído («correo · teléfono»), o null si no le falta nada. */
      missing?: string | null;
      /** Ya estaba en «Por revisar» y se aprobó ése (no queda dos veces). */
      approvedFromReview?: boolean;
    }
  | { success: false; error: string };

/** Ruta que abre una empresa de HubSpot en modo consulta (lista de Empresas). */
export const HUBSPOT_COMPANY_PARAM = 'hubspot';
/** Ruta que abre un contacto de HubSpot en modo consulta (lista de Contactos). */
export const HUBSPOT_CONTACT_PARAM = 'hubspot';

export function hubspotCompanyHref(hubspotCompanyId: string): string {
  return `/accounts?${HUBSPOT_COMPANY_PARAM}=${encodeURIComponent(hubspotCompanyId)}`;
}

export function hubspotContactHref(hubspotContactId: string): string {
  return `/contacts?${HUBSPOT_CONTACT_PARAM}=${encodeURIComponent(hubspotContactId)}`;
}

/**
 * Abrir un registro de HubSpot en modo consulta estando YA en su pantalla: la búsqueda
 * general avisa con este evento (navegar a la misma ruta no vuelve a montar la lista).
 */
export const HUBSPOT_OPEN_EVENT = 'sellup:open-hubspot-record';
export interface HubSpotOpenDetail {
  kind: 'company' | 'contact';
  id: string;
}

export function hubspotRecordPath(kind: 'company' | 'contact'): string {
  return kind === 'company' ? '/accounts' : '/contacts';
}

/** Escucha el evento para un tipo de registro. Devuelve cómo dejar de escuchar. */
export function onHubSpotOpen(kind: 'company' | 'contact', handler: (id: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<HubSpotOpenDetail>).detail;
    if (detail?.kind === kind && /^\d{1,20}$/.test(detail.id)) handler(detail.id);
  };
  window.addEventListener(HUBSPOT_OPEN_EVENT, listener);
  return () => window.removeEventListener(HUBSPOT_OPEN_EVENT, listener);
}

/** Lee `?hubspot=<id>` de la dirección (y devuelve la dirección sin él). */
export function readHubSpotParam(search: string): { hubspotId: string | null; rest: string } {
  const params = new URLSearchParams(search);
  const raw = params.get(HUBSPOT_COMPANY_PARAM)?.trim() ?? '';
  params.delete(HUBSPOT_COMPANY_PARAM);
  const rest = params.toString();
  return { hubspotId: /^\d{1,20}$/.test(raw) ? raw : null, rest: rest ? `?${rest}` : '' };
}
