/**
 * Consulta de HubSpot desde SellUp — LECTURAS (dueña 17-11: «que todos puedan consultar
 * lo que sea desde SellUp en HubSpot»).
 *
 * Cualquier persona activa puede consultar cualquier empresa o contacto de HubSpot. Se
 * sirven por la ruta `/api/hubspot-lookup` y NO como acciones del servidor: el navegador
 * manda las acciones de a una y la navegación espera detrás (Prod 19-10); una búsqueda
 * mientras se escribe, o la actividad de HubSpot que tarda unos segundos, trababan la
 * pantalla.
 *
 * Sólo lectura: nunca escribe en HubSpot ni en SellUp.
 */

import { getAccountById } from '@/modules/accounts/actions';
import { getHubSpotPortalId } from '@/server/agents/prospecting-toolkit/hubspot-duplicate-checker';
import {
  isHubSpotObjectId,
  normalizeLookupQuery,
  type HubSpotCompanyView,
  type HubSpotContactView,
  type SellUpPresence,
} from '@/server/integrations/hubspot-lookup/hubspot-lookup-core';
import {
  HubSpotLookupError,
  readHubSpotActivity,
  readHubSpotCompany,
  readHubSpotCompanyContacts,
  readHubSpotContact,
  readHubSpotRecordProperties,
  resolveHubSpotOwnerNames,
  searchHubSpotCompaniesAndContacts,
} from '@/server/integrations/hubspot-lookup/hubspot-lookup.server';
import { sellUpPresenceForCompanies, sellUpPresenceForContacts } from './presence.server';
import type {
  HubSpotAccountContactsResult,
  HubSpotActivityLookupResult,
  HubSpotCompanyHit,
  HubSpotCompanyLookupResult,
  HubSpotContactHit,
  HubSpotContactLookupResult,
  HubSpotLookupUnavailable,
  HubSpotPropertiesLookupResult,
  HubSpotSearchResult,
} from './types';

const NONE: SellUpPresence = { status: 'none' };

export function lookupUnavailable(error: unknown, label: string): HubSpotLookupUnavailable {
  if (error instanceof HubSpotLookupError) {
    if (error.reason === 'unavailable') console.warn(`[hubspot-lookup] ${label}:`, error.message);
    return { status: 'unavailable', reason: error.reason };
  }
  console.error(`[hubspot-lookup] ${label}:`, error instanceof Error ? error.message : error);
  return { status: 'unavailable', reason: 'unavailable' };
}

async function presenceOrNone(run: () => Promise<Map<string, SellUpPresence>>): Promise<Map<string, SellUpPresence>> {
  try {
    return await run();
  } catch (error) {
    // Sin poder mirar SellUp, se muestra igual (como consulta); traerla no duplica: la
    // resolución vuelve a buscar por Company ID y dominio antes de crear.
    console.error('[hubspot-lookup] presencia en SellUp:', error instanceof Error ? error.message : error);
    return new Map<string, SellUpPresence>();
  }
}

async function companyHits(companies: readonly HubSpotCompanyView[]): Promise<HubSpotCompanyHit[]> {
  const [presence, owners] = await Promise.all([
    presenceOrNone(() => sellUpPresenceForCompanies(companies.map((c) => c.id))),
    resolveHubSpotOwnerNames(companies.map((c) => c.ownerId)),
  ]);
  return companies.map((c) => ({
    ...c,
    sellup: presence.get(c.id) ?? NONE,
    ownerName: c.ownerId ? owners.get(c.ownerId) ?? null : null,
  }));
}

async function contactHits(contacts: readonly HubSpotContactView[]): Promise<HubSpotContactHit[]> {
  const [presence, owners] = await Promise.all([
    presenceOrNone(() => sellUpPresenceForContacts(contacts.map((c) => c.id))),
    resolveHubSpotOwnerNames(contacts.map((c) => c.ownerId)),
  ]);
  return contacts.map((c) => ({
    ...c,
    sellup: presence.get(c.id) ?? NONE,
    ownerName: c.ownerId ? owners.get(c.ownerId) ?? null : null,
  }));
}

/** Búsqueda general: empresas y contactos de HubSpot que coinciden con lo escrito. */
export async function lookupHubSpotSearch(rawQuery: unknown): Promise<HubSpotSearchResult> {
  const query = normalizeLookupQuery(rawQuery);
  if (!query) return { status: 'ok', companies: [], contacts: [] };
  try {
    const found = await searchHubSpotCompaniesAndContacts(query);
    const [companies, contacts] = await Promise.all([companyHits(found.companies), contactHits(found.contacts)]);
    return { status: 'ok', companies, contacts };
  } catch (error) {
    return lookupUnavailable(error, 'búsqueda');
  }
}

async function portalIdOrNull(): Promise<string | null> {
  try {
    return await getHubSpotPortalId();
  } catch {
    return null;
  }
}

/** Ficha de consulta de una empresa de HubSpot: sus datos y sus contactos. */
export async function lookupHubSpotCompany(hubspotCompanyId: unknown): Promise<HubSpotCompanyLookupResult> {
  if (!isHubSpotObjectId(hubspotCompanyId)) return { status: 'not_found' };
  try {
    const company = await readHubSpotCompany(hubspotCompanyId);
    if (!company) return { status: 'not_found' };
    const contacts = await readHubSpotCompanyContacts(hubspotCompanyId).catch((error: unknown) => {
      console.warn('[hubspot-lookup] contactos de la empresa:', error instanceof Error ? error.message : error);
      return [] as HubSpotContactView[];
    });
    const [[hit], contactList, portalId] = await Promise.all([companyHits([company]), contactHits(contacts), portalIdOrNull()]);
    return { status: 'ok', company: hit, contacts: contactList, portalId };
  } catch (error) {
    return lookupUnavailable(error, 'empresa');
  }
}

/** Contactos de HubSpot de una empresa de SellUp (para su pestaña «Contactos»). */
export async function lookupHubSpotContactsForAccount(accountId: unknown): Promise<HubSpotAccountContactsResult> {
  if (typeof accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(accountId)) return { status: 'not_found' };
  const account = await getAccountById(accountId).catch(() => null);
  if (!account) return { status: 'not_found' };
  const hubspotCompanyId = account.hubspot_company_id;
  if (!isHubSpotObjectId(hubspotCompanyId)) return { status: 'ok', hubspotCompanyId: null, contacts: [], portalId: null };
  try {
    const [contacts, portalId] = await Promise.all([readHubSpotCompanyContacts(hubspotCompanyId), portalIdOrNull()]);
    return { status: 'ok', hubspotCompanyId, contacts: await contactHits(contacts), portalId };
  } catch (error) {
    return lookupUnavailable(error, 'contactos de la empresa');
  }
}

/** Ficha de consulta de un contacto de HubSpot y su empresa. */
export async function lookupHubSpotContact(hubspotContactId: unknown): Promise<HubSpotContactLookupResult> {
  if (!isHubSpotObjectId(hubspotContactId)) return { status: 'not_found' };
  try {
    const contact = await readHubSpotContact(hubspotContactId);
    if (!contact) return { status: 'not_found' };
    const company = contact.companyId ? await readHubSpotCompany(contact.companyId).catch(() => null) : null;
    const [[contactHit], companyList, portalId] = await Promise.all([
      contactHits([contact]),
      company ? companyHits([company]) : Promise.resolve([] as HubSpotCompanyHit[]),
      portalIdOrNull(),
    ]);
    return { status: 'ok', contact: contactHit, company: companyList[0] ?? null, portalId };
  } catch (error) {
    return lookupUnavailable(error, 'contacto');
  }
}

/** Actividad en HubSpot de una empresa o de un contacto. */
export async function lookupHubSpotActivity(kind: unknown, hubspotId: unknown): Promise<HubSpotActivityLookupResult> {
  if ((kind !== 'company' && kind !== 'contact') || !isHubSpotObjectId(hubspotId)) {
    return { status: 'ok', items: [], missingKinds: [] };
  }
  try {
    const result = await readHubSpotActivity(kind === 'company' ? 'companies' : 'contacts', hubspotId);
    return { status: 'ok', items: result.items, missingKinds: result.missingKinds };
  } catch (error) {
    return lookupUnavailable(error, 'actividad');
  }
}

/** Todos los datos de HubSpot de una empresa o de un contacto, agrupados como en su ficha. */
export async function lookupHubSpotProperties(kind: unknown, hubspotId: unknown): Promise<HubSpotPropertiesLookupResult> {
  if ((kind !== 'company' && kind !== 'contact') || !isHubSpotObjectId(hubspotId)) return { status: 'not_found' };
  try {
    const sections = await readHubSpotRecordProperties(kind === 'company' ? 'companies' : 'contacts', hubspotId);
    return sections ? { status: 'ok', sections } : { status: 'not_found' };
  } catch (error) {
    return lookupUnavailable(error, 'datos del registro');
  }
}
