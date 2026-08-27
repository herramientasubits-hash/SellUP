// Agente 2A — Verificación/creación idempotente de una propiedad custom en HubSpot
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Primera vez que este código base MODIFICA EL ESQUEMA de un objeto en HubSpot, en vez de sólo
// llenar campos existentes. Es una operación distinta y más sensible: crea algo que queda
// visible para todo el que use HubSpot en la organización, y no se revierte solo.
//
// Por eso: se comprueba SIEMPRE antes de crear (GET), se crea como MUCHO una vez (POST sólo si
// el GET dice 404), y un permiso insuficiente para crear ESQUEMA —distinto del permiso para
// escribir VALORES, que es el que ya usa el resto de la integración— nunca lanza ni bloquea
// nada: se reporta y el llamador sigue sin el campo.

const HUBSPOT_BASE = 'https://api.hubapi.com';

export const SELLUP_CREATED_PROPERTY_NAME = 'sellup_created' as const;

export type HubSpotSchemaObjectType = 'contacts' | 'companies';

export type EnsureHubSpotPropertyResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: string };

export interface EnsureHubSpotPropertyDeps {
  token: string | null;
  /**
   * Inyectado para poder probar sin red. En producción: `fetch` global.
   *
   * Tipado sólo con la forma que este módulo realmente invoca (URL como `string`) en vez de
   * `typeof fetch` — ese tipo global exige aceptar también `URL | Request`, lo que un mock de
   * prueba tipado con `url: string` no cumple estructuralmente. El `fetch` real sigue siendo
   * asignable aquí sin cambios (acepta `string` de sobra).
   */
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Verifica si `sellup_created` existe en el objeto dado y la crea si falta. Nunca lanza.
 *
 * `created: false` con `ok: true` significa "ya existía, no hizo falta tocar nada" — el caso
 * normal a partir del segundo contacto/empresa que se sincroniza.
 */
export async function ensureHubSpotSellUpCreatedProperty(
  objectType: HubSpotSchemaObjectType,
  deps: EnsureHubSpotPropertyDeps,
): Promise<EnsureHubSpotPropertyResult> {
  if (!deps.token) return { ok: false, reason: 'TOKEN_UNAVAILABLE' };

  try {
    const getResponse = await deps.fetchImpl(
      `${HUBSPOT_BASE}/crm/v3/properties/${objectType}/${SELLUP_CREATED_PROPERTY_NAME}`,
      { headers: { Authorization: `Bearer ${deps.token}` } },
    );
    if (getResponse.ok) return { ok: true, created: false };
    if (getResponse.status !== 404) {
      return { ok: false, reason: `HUBSPOT_PROPERTY_GET_HTTP_${getResponse.status}` };
    }

    const createResponse = await deps.fetchImpl(
      `${HUBSPOT_BASE}/crm/v3/properties/${objectType}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deps.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: SELLUP_CREATED_PROPERTY_NAME,
          label: 'Creado por SellUp',
          type: 'bool',
          fieldType: 'booleancheckbox',
          groupName: objectType === 'contacts' ? 'contactinformation' : 'companyinformation',
          options: [
            { label: 'Sí', value: 'true', displayOrder: 0 },
            { label: 'No', value: 'false', displayOrder: 1 },
          ],
        }),
      },
    );
    if (!createResponse.ok) {
      return { ok: false, reason: `HUBSPOT_PROPERTY_CREATE_HTTP_${createResponse.status}` };
    }
    return { ok: true, created: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_PROPERTY_ENSURE_ERROR',
    };
  }
}
