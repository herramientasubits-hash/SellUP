/**
 * HubSpot Company Create — Hito 16AK.5B
 *
 * Crea una nueva Company en HubSpot via POST /crm/v3/objects/companies.
 * Solo escritura; nunca actualiza ni hace merge de companies existentes.
 *
 * Guardrails:
 * - Token resuelto desde Vault; nunca expuesto ni logueado.
 * - Solo propiedades seguras para V1 (no deals, contactos, tasks, notas).
 * - NIT Colombia: se limpia dígito de verificación antes de enviar.
 * - Si falla, retorna ok:false con error sanitizado.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

async function getHubSpotToken(): Promise<string | null> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: VAULT_SECRET_NAME,
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

// NIT Colombia: "900123456-7" → "900123456", "800236140" → "800236140"
function cleanNitForHubSpot(taxIdentifier: string): string {
  return taxIdentifier.replace(/-\d+$/, '').replace(/\s/g, '').trim();
}

export interface CreateHubSpotCompanyInput {
  name: string;
  country?: string | null;
  countryCode?: string | null;
  taxIdentifier?: string | null;
  website?: string | null;
  domain?: string | null;
  city?: string | null;
  region?: string | null;
}

export interface CreateHubSpotCompanyResult {
  ok: boolean;
  hubspotCompanyId?: string;
  error?: string;
  statusCode?: number;
}

export async function createHubSpotCompany(
  input: CreateHubSpotCompanyInput
): Promise<CreateHubSpotCompanyResult> {
  const token = await getHubSpotToken();
  if (!token) {
    return { ok: false, error: 'TOKEN_UNAVAILABLE' };
  }

  const properties: Record<string, string> = { name: input.name };

  if (input.country) properties.country = input.country;
  if (input.website) properties.website = input.website;
  if (input.domain) properties.domain = input.domain;
  if (input.city) properties.city = input.city;
  if (input.region) properties.state = input.region;

  // NIT solo para Colombia — propiedad confirmada en portal UBITS HubSpot
  if (input.countryCode === 'CO' && input.taxIdentifier) {
    const cleanNit = cleanNitForHubSpot(input.taxIdentifier);
    if (cleanNit.length >= 5) {
      properties.nit = cleanNit;
    }
  }

  // Propiedades omitidas (no enviar):
  // lifecyclestage, hs_lead_status, hubspot_owner_id, industry,
  // numberofemployees, deal fields, contact fields, propiedades custom no confirmadas

  try {
    const response = await fetch('https://api.hubapi.com/crm/v3/objects/companies', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (!response.ok) {
      const statusCode = response.status;
      return { ok: false, error: `HTTP_${statusCode}`, statusCode };
    }

    const data = (await response.json()) as { id?: string };
    if (!data.id) {
      return { ok: false, error: 'NO_ID_IN_RESPONSE' };
    }

    return { ok: true, hubspotCompanyId: data.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : 'Network error';
    return { ok: false, error: msg };
  }
}
