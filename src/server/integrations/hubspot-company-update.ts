/**
 * HubSpot Company Update — ACCOUNT-PROFILE-COMPLETION-1
 *
 * Escribe propiedades en una empresa EXISTENTE de HubSpot (PATCH /crm/v3/objects/companies).
 * Sólo lo usa el completado de perfil, y siempre con propiedades que estaban vacías allá:
 * el llamador decide qué (`buildHubSpotFillProperties`); este módulo sólo envía.
 * Si HubSpot rechaza el lote por una propiedad desconocida, reintenta propiedad por
 * propiedad para no perder las demás. Token desde Vault; nunca se registra.
 */

import { getHubSpotToken } from './hubspot-company-create';

export interface UpdateHubSpotCompanyResult {
  ok: boolean;
  /** Propiedades que HubSpot aceptó. */
  written: string[];
  /** Propiedades que HubSpot rechazó (con el código HTTP). */
  rejected: Array<{ property: string; statusCode: number }>;
  error?: string;
}

async function patchCompany(
  token: string,
  hubspotCompanyId: string,
  properties: Record<string, string>,
): Promise<{ ok: boolean; statusCode: number }> {
  const response = await fetch(
    `https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(hubspotCompanyId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties }),
    },
  );
  return { ok: response.ok, statusCode: response.status };
}

export async function updateHubSpotCompanyProperties(
  hubspotCompanyId: string,
  properties: Record<string, string>,
): Promise<UpdateHubSpotCompanyResult> {
  const names = Object.keys(properties);
  if (names.length === 0) return { ok: true, written: [], rejected: [] };
  const token = await getHubSpotToken();
  if (!token) return { ok: false, written: [], rejected: [], error: 'TOKEN_UNAVAILABLE' };

  try {
    const batch = await patchCompany(token, hubspotCompanyId, properties);
    if (batch.ok) return { ok: true, written: names, rejected: [] };
    // 404 = la empresa no existe en este HubSpot: reintentar no cambia nada.
    if (batch.statusCode === 404 || names.length === 1) {
      return {
        ok: false,
        written: [],
        rejected: names.map((property) => ({ property, statusCode: batch.statusCode })),
        error: `HTTP_${batch.statusCode}`,
      };
    }
    const written: string[] = [];
    const rejected: UpdateHubSpotCompanyResult['rejected'] = [];
    for (const name of names) {
      const single = await patchCompany(token, hubspotCompanyId, { [name]: properties[name] });
      if (single.ok) written.push(name);
      else rejected.push({ property: name, statusCode: single.statusCode });
    }
    return { ok: written.length > 0, written, rejected };
  } catch (err: unknown) {
    return {
      ok: false,
      written: [],
      rejected: [],
      error: err instanceof Error ? err.message.slice(0, 200) : 'Network error',
    };
  }
}
