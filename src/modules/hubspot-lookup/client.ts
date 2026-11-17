/**
 * Lecturas de HubSpot desde el navegador, por `/api/hubspot-lookup` (no por acciones del
 * servidor: no deben hacer cola delante de la navegación).
 */

import type {
  HubSpotAccountContactsResult,
  HubSpotActivityLookupResult,
  HubSpotCompanyLookupResult,
  HubSpotContactLookupResult,
  HubSpotSearchResult,
} from './types';

const UNAVAILABLE = { status: 'unavailable', reason: 'unavailable' } as const;

async function getLookup<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T | typeof UNAVAILABLE> {
  try {
    const res = await fetch(`/api/hubspot-lookup?${new URLSearchParams(params).toString()}`, {
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return UNAVAILABLE;
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return UNAVAILABLE;
  }
}

export function fetchHubSpotSearch(q: string, signal?: AbortSignal) {
  return getLookup<HubSpotSearchResult>({ op: 'search', q }, signal);
}

export function fetchHubSpotCompany(id: string, signal?: AbortSignal) {
  return getLookup<HubSpotCompanyLookupResult>({ op: 'company', id }, signal);
}

export function fetchHubSpotContact(id: string, signal?: AbortSignal) {
  return getLookup<HubSpotContactLookupResult>({ op: 'contact', id }, signal);
}

export function fetchHubSpotActivity(kind: 'company' | 'contact', id: string, signal?: AbortSignal) {
  return getLookup<HubSpotActivityLookupResult>({ op: 'activity', kind, id }, signal);
}

export function fetchHubSpotAccountContacts(accountId: string, signal?: AbortSignal) {
  return getLookup<HubSpotAccountContactsResult>({ op: 'account-contacts', accountId }, signal);
}
