/**
 * HubSpot — ubicación de los contactos asociados a una empresa (ACCOUNT-PROFILE-COMPLETION-1)
 *
 * Sólo lectura. Devuelve país y teléfonos de hasta 25 contactos asociados a la empresa, como
 * pista para deducir el país de la empresa cuando su propia ficha no lo trae. Nunca lanza:
 * si HubSpot no responde o falta el permiso, devuelve lista vacía.
 */

import { getHubSpotToken } from './hubspot-company-create';

const MAX_CONTACTS = 25;

export interface HubSpotContactLocation {
  country: string | null;
  phone: string | null;
}

export async function readHubSpotCompanyContactLocations(
  hubspotCompanyId: string,
): Promise<HubSpotContactLocation[]> {
  try {
    const token = await getHubSpotToken();
    if (!token) return [];
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const assoc = await fetch(
      `https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(hubspotCompanyId)}/associations/contacts?limit=${MAX_CONTACTS}`,
      { headers },
    );
    if (!assoc.ok) return [];
    const ids = ((await assoc.json()) as { results?: Array<{ id: string }> }).results?.map((r) => r.id) ?? [];
    if (ids.length === 0) return [];

    const batch = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/read', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        inputs: ids.slice(0, MAX_CONTACTS).map((id) => ({ id })),
        properties: ['country', 'phone', 'mobilephone'],
      }),
    });
    if (!batch.ok) return [];
    const results =
      ((await batch.json()) as { results?: Array<{ properties?: Record<string, string | null> }> }).results ?? [];
    return results.map((r) => ({
      country: r.properties?.country?.trim() || null,
      phone: r.properties?.phone?.trim() || r.properties?.mobilephone?.trim() || null,
    }));
  } catch {
    return [];
  }
}
