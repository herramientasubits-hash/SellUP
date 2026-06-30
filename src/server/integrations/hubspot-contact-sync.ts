// HubSpot Contact Sync — Hito 17A.4C
//
// Escrituras mínimas y controladas para sincronizar un contacto aprobado de
// SellUp hacia HubSpot: buscar por email, crear contacto, asociar a empresa.
// NO crea empresas/deals/notas. NO expone tokens. Token vía Vault (service role).
//
// Espeja el patrón seguro de hubspot-contacts-reader.ts (lectura) para escritura.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { HubSpotContactCreateInput } from '@/modules/contacts/contact-hubspot-sync-core';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';
const INTEGRATION_KEY = 'hubspot';
const CONTACTS_WRITE_SCOPE = 'crm.objects.contacts.write';
const HUBSPOT_BASE = 'https://api.hubapi.com';

function getAdminSupabase() {
  if (!supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

async function getHubSpotToken(): Promise<string | null> {
  const admin = getAdminSupabase();
  const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
    p_name: VAULT_SECRET_NAME,
  });
  if (error) return null;
  return data as string | null;
}

export interface HubSpotConnectionRow {
  connection_status: string | null;
  credentials_status: string | null;
  vault_secret_id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Lógica pura (sin DB) que evalúa una fila de conexión HubSpot.
 * Exportada para testear sin Supabase.
 *
 * Reglas:
 *  - connection_status debe ser 'connected'
 *  - credentials_status debe ser 'stored'
 *  - vault_secret_id no puede ser null
 *  - canWriteContacts: true si metadata.scopes incluye contacts.write (o si
 *    no hay scopes declarados → se intenta y la API responderá 403 en ese caso)
 *
 * No depende de scope_readiness (puede ser null en producción).
 */
export function evaluateHubSpotConnectionRow(row: HubSpotConnectionRow | null): {
  connected: boolean;
  canWriteContacts: boolean;
} {
  if (!row) return { connected: false, canWriteContacts: false };
  if (row.connection_status !== 'connected') return { connected: false, canWriteContacts: false };
  if (row.credentials_status !== 'stored') return { connected: false, canWriteContacts: false };
  if (!row.vault_secret_id) return { connected: false, canWriteContacts: false };

  const scopes = Array.isArray(row.metadata?.scopes) ? (row.metadata.scopes as string[]) : [];
  const canWriteContacts = scopes.length === 0 || scopes.includes(CONTACTS_WRITE_SCOPE);
  return { connected: true, canWriteContacts };
}

/**
 * Estado de conexión para escribir contactos. Filtra por integration_key='hubspot',
 * connection_status='connected' y credentials_status='stored'. Si la conexión
 * declara scopes y no incluye contacts.write → canWriteContacts=false. Si no hay
 * scopes declarados, se permite intentar (la API responderá 403 si faltan permisos).
 */
export async function getHubSpotContactSyncConnection(): Promise<{
  connected: boolean;
  canWriteContacts: boolean;
}> {
  try {
    const admin = getAdminSupabase();
    const { data, error } = await admin
      .from('external_integration_connections')
      .select('connection_status, credentials_status, vault_secret_id, metadata')
      .eq('integration_key', INTEGRATION_KEY)
      .eq('connection_status', 'connected')
      .eq('credentials_status', 'stored')
      .single();

    if (error || !data) return { connected: false, canWriteContacts: false };

    return evaluateHubSpotConnectionRow(data as HubSpotConnectionRow);
  } catch {
    return { connected: false, canWriteContacts: false };
  }
}

interface HubSpotSearchResult {
  results?: Array<{ id: string }>;
}

/**
 * Busca un contacto en HubSpot por email exacto. Devuelve el primer match o null.
 */
export async function findHubSpotContactByEmail(
  email: string,
): Promise<{ id: string } | null> {
  const token = await getHubSpotToken();
  if (!token) return null;

  const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
        },
      ],
      properties: ['email'],
      limit: 1,
    }),
  });

  if (!response.ok) {
    // Una búsqueda fallida no debe crear duplicados: propagamos como "no encontrado"
    // solo si es seguro. Para 4xx/5xx lanzamos para que el caller lo trate como error.
    throw new Error(`HubSpot contact search error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as HubSpotSearchResult;
  const first = data.results?.[0];
  return first ? { id: first.id } : null;
}

/**
 * Crea un contacto en HubSpot con propiedades estándar mínimas.
 * No envía LinkedIn (sin mapeo de escritura validado en este hito).
 */
export async function createHubSpotContact(
  input: HubSpotContactCreateInput,
): Promise<{ id: string } | { error: string }> {
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };

  const properties: Record<string, string> = { email: input.email };
  if (input.firstname) properties.firstname = input.firstname;
  if (input.lastname) properties.lastname = input.lastname;
  if (input.jobtitle) properties.jobtitle = input.jobtitle;
  if (input.phone) properties.phone = input.phone;

  try {
    const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (!response.ok) {
      // No exponer payload crudo ni token. Solo el código de estado.
      return { error: `HUBSPOT_CREATE_HTTP_${response.status}` };
    }

    const data = (await response.json()) as { id?: string };
    if (!data.id) return { error: 'HUBSPOT_CREATE_NO_ID' };
    return { id: data.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_CREATE_ERROR' };
  }
}

/**
 * Asocia un contacto con una empresa en HubSpot usando la asociación por defecto
 * (v4). No crea la empresa. No toca deals ni pipelines.
 */
export async function associateHubSpotContactWithCompany(
  hubspotContactId: string,
  hubspotCompanyId: string,
): Promise<{ ok: true } | { error: string }> {
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };

  try {
    const response = await fetch(
      `${HUBSPOT_BASE}/crm/v4/objects/contacts/${encodeURIComponent(hubspotContactId)}/associations/default/companies/${encodeURIComponent(hubspotCompanyId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      return { error: `HUBSPOT_ASSOC_HTTP_${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_ASSOC_ERROR' };
  }
}
