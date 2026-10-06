// HubSpot Contact Sync — Hito 17A.4C
//
// Escrituras mínimas y controladas para sincronizar un contacto aprobado de
// SellUp hacia HubSpot: buscar por email, crear contacto, asociar a empresa.
// NO crea empresas/deals/notas. NO expone tokens. Token vía Vault (service role).
//
// Espeja el patrón seguro de hubspot-contacts-reader.ts (lectura) para escritura.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  HUBSPOT_FILL_EMPTY_PROPERTY_NAMES,
  buildHubSpotContactUpdateProperties,
  type HubSpotContactCreateInput,
  type HubSpotContactFillProperties,
  type HubSpotContactUpdateInput,
  type HubSpotExistingContactMatch,
  type HubSpotExistingContactProperties,
  type HubSpotFillEmptyPropertyName,
} from '@/modules/contacts/contact-hubspot-sync-core';
import { ensureHubSpotSellUpCreatedPropertyCached } from './hubspot-property-ensure-cache';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';
const INTEGRATION_KEY = 'hubspot';
const CONTACTS_WRITE_SCOPE = 'crm.objects.contacts.write';
const HUBSPOT_BASE = 'https://api.hubapi.com';

const CONTACT_SYNC_REQUIRED_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
] as const;

export type ContactSyncStatus =
  | 'ready'
  | 'not_connected'
  | 'missing_credentials'
  | 'missing_vault_secret'
  | 'missing_scopes';

export interface HubSpotContactSyncReadiness {
  ok: boolean;
  status: ContactSyncStatus;
  checks: {
    integrationConnected: boolean;
    credentialsStored: boolean;
    vaultSecretLinked: boolean;
    contactsRead: boolean;
    contactsWrite: boolean;
    companiesRead: boolean;
    companiesWrite: boolean;
  };
  missingScopes: string[];
}

const EMPTY_CHECKS = {
  integrationConnected: false,
  credentialsStored: false,
  vaultSecretLinked: false,
  contactsRead: false,
  contactsWrite: false,
  companiesRead: false,
  companiesWrite: false,
} as const;

/**
 * Lógica pura (sin DB) que evalúa una fila de conexión para determinar si
 * HubSpot está listo para sincronizar contactos.
 * Valida: connection_status, credentials_status, vault_secret_id, y los 4 scopes
 * requeridos (contacts.read/write, companies.read/write).
 * No depende de scope_readiness — puede ser null en producción.
 */
export function computeHubSpotContactSyncReadiness(
  row: HubSpotConnectionRow | null,
): HubSpotContactSyncReadiness {
  if (!row || row.connection_status !== 'connected') {
    return {
      ok: false,
      status: 'not_connected',
      checks: { ...EMPTY_CHECKS },
      missingScopes: [...CONTACT_SYNC_REQUIRED_SCOPES],
    };
  }

  if (row.credentials_status !== 'stored') {
    return {
      ok: false,
      status: 'missing_credentials',
      checks: { ...EMPTY_CHECKS, integrationConnected: true },
      missingScopes: [...CONTACT_SYNC_REQUIRED_SCOPES],
    };
  }

  if (!row.vault_secret_id) {
    return {
      ok: false,
      status: 'missing_vault_secret',
      checks: { ...EMPTY_CHECKS, integrationConnected: true, credentialsStored: true },
      missingScopes: [...CONTACT_SYNC_REQUIRED_SCOPES],
    };
  }

  const scopes = Array.isArray(row.metadata?.scopes) ? (row.metadata.scopes as string[]) : [];
  const hasScopes = scopes.length > 0;

  const contactsRead = !hasScopes || scopes.includes('crm.objects.contacts.read');
  const contactsWrite = !hasScopes || scopes.includes('crm.objects.contacts.write');
  const companiesRead = !hasScopes || scopes.includes('crm.objects.companies.read');
  const companiesWrite = !hasScopes || scopes.includes('crm.objects.companies.write');

  const missingScopes = hasScopes
    ? CONTACT_SYNC_REQUIRED_SCOPES.filter((s) => !scopes.includes(s))
    : [];

  const ok = contactsRead && contactsWrite && companiesRead && companiesWrite;

  return {
    ok,
    status: ok ? 'ready' : 'missing_scopes',
    checks: {
      integrationConnected: true,
      credentialsStored: true,
      vaultSecretLinked: true,
      contactsRead,
      contactsWrite,
      companiesRead,
      companiesWrite,
    },
    missingScopes,
  };
}

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
 * Estado de conexión para escribir contactos.
 * Dos pasos: primero resuelve el id de la integración desde external_integrations
 * (que sí tiene integration_key), luego busca la conexión en
 * external_integration_connections por integration_id.
 *
 * external_integration_connections NO tiene columna integration_key — el join
 * es por integration_id → external_integrations.id.
 */
export async function getHubSpotContactSyncConnection(): Promise<{
  connected: boolean;
  canWriteContacts: boolean;
}> {
  try {
    const admin = getAdminSupabase();

    // Paso 1: resolver el id de la integración HubSpot.
    const { data: integration, error: intError } = await admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', INTEGRATION_KEY)
      .single();

    if (intError || !integration) {
      console.error('[hubspot-contact-sync] HubSpot integration not found', {
        errorCode: intError?.code,
        errorMessage: intError?.message,
      });
      return { connected: false, canWriteContacts: false };
    }

    // Paso 2: buscar la conexión activa por integration_id.
    const { data: connection, error: connError } = await admin
      .from('external_integration_connections')
      .select('connection_status, credentials_status, vault_secret_id, metadata')
      .eq('integration_id', integration.id)
      .eq('connection_status', 'connected')
      .eq('credentials_status', 'stored')
      .maybeSingle();

    if (connError) {
      console.error('[hubspot-contact-sync] Failed to load HubSpot connection', {
        errorCode: connError.code,
        errorMessage: connError.message,
      });
      return { connected: false, canWriteContacts: false };
    }

    return evaluateHubSpotConnectionRow(connection as HubSpotConnectionRow | null);
  } catch (err) {
    console.error('[hubspot-contact-sync] Unexpected error loading connection', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { connected: false, canWriteContacts: false };
  }
}

interface HubSpotSearchResult {
  results?: Array<{ id: string; properties?: Record<string, string | null | undefined> }>;
}

/**
 * Busca un contacto en HubSpot por email exacto. Devuelve el primer match o null.
 *
 * AGENT2A-HUBSPOT-FILL-EMPTY-ON-APPROVAL: además del id trae las propiedades que SellUp puede
 * completar (`HUBSPOT_FILL_EMPTY_PROPERTY_NAMES`), para saber cuáles están VACÍAS en el CRM.
 */
export async function findHubSpotContactByEmail(
  email: string,
): Promise<HubSpotExistingContactMatch | null> {
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
      properties: ['email', ...HUBSPOT_FILL_EMPTY_PROPERTY_NAMES],
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
  if (!first) return null;
  // Sin bloque `properties` en la respuesta no se afirma nada sobre qué está vacío: se omite y
  // el motor no completa (fail closed).
  if (!first.properties || typeof first.properties !== 'object') return { id: first.id };
  const properties: HubSpotExistingContactProperties = {};
  for (const name of HUBSPOT_FILL_EMPTY_PROPERTY_NAMES) {
    const value = first.properties[name];
    properties[name] = typeof value === 'string' ? value : null;
  }
  return { id: first.id, properties };
}

/** PATCH crudo de propiedades. Sólo devuelve el código HTTP: el cuerpo citaría el teléfono. */
async function patchHubSpotContactProperties(
  token: string,
  hubspotContactId: string,
  properties: Record<string, string>,
): Promise<{ ok: true } | { status: number }> {
  const response = await fetch(
    `${HUBSPOT_BASE}/crm/v3/objects/contacts/${encodeURIComponent(hubspotContactId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    },
  );
  return response.ok ? { ok: true } : { status: response.status };
}

/**
 * Completa SÓLO propiedades vacías de un contacto que ya existía en HubSpot
 * (AGENT2A-HUBSPOT-FILL-EMPTY-ON-APPROVAL).
 *
 * Quien decide QUÉ viaja es `buildHubSpotFillEmptyProperties` (motor puro); este adaptador sólo
 * descarta valores vacíos —una cadena vacía BORRARÍA la propiedad en HubSpot— y hace el PATCH.
 *
 * `hs_linkedin_url` es la única propiedad nueva en escritura. Si HubSpot rechaza el cuerpo con
 * 400 y lo llevaba, se reintenta UNA vez sin ella: un portal que la tenga restringida no puede
 * impedir que el teléfono llegue.
 */
export async function fillEmptyHubSpotContactProperties(
  hubspotContactId: string,
  input: HubSpotContactFillProperties,
): Promise<{ ok: true; written: HubSpotFillEmptyPropertyName[] } | { error: string }> {
  const properties: Record<string, string> = {};
  for (const name of HUBSPOT_FILL_EMPTY_PROPERTY_NAMES) {
    const value = input[name];
    if (typeof value === 'string' && value.trim().length > 0) properties[name] = value.trim();
  }
  const names = () => Object.keys(properties) as HubSpotFillEmptyPropertyName[];
  if (names().length === 0) return { ok: true, written: [] };

  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };

  try {
    const first = await patchHubSpotContactProperties(token, hubspotContactId, properties);
    if ('ok' in first) return { ok: true, written: names() };

    if (first.status === 400 && 'hs_linkedin_url' in properties) {
      delete properties.hs_linkedin_url;
      if (names().length === 0) return { error: 'HUBSPOT_FILL_HTTP_400' };
      const retry = await patchHubSpotContactProperties(token, hubspotContactId, properties);
      if ('ok' in retry) return { ok: true, written: names() };
      return { error: `HUBSPOT_FILL_HTTP_${retry.status}` };
    }
    return { error: `HUBSPOT_FILL_HTTP_${first.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_FILL_ERROR' };
  }
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

  const propertyEnsure = await ensureHubSpotSellUpCreatedPropertyCached('contacts', {
    token,
    fetchImpl: fetch,
  });

  const properties: Record<string, string> = { email: input.email };
  if (input.firstname) properties.firstname = input.firstname;
  if (input.lastname) properties.lastname = input.lastname;
  if (input.jobtitle) properties.jobtitle = input.jobtitle;
  if (input.phone) properties.phone = input.phone;
  if (input.mobilePhone) properties.mobilephone = input.mobilePhone;
  // Sólo se manda el campo si la verificación/creación tuvo éxito: sin permiso de esquema, el
  // contacto se crea igual, simplemente sin esta marca.
  if (propertyEnsure.ok) properties.sellup_created = 'true';

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
 * Actualiza un contacto YA vinculado en HubSpot (AGENT2-CONTACT-HUBSPOT-UPDATE-CUT2).
 *
 * La identidad es el `hubspotContactId` DURABLE que SellUp ya guardó. No busca por email, no
 * crea y no reintenta la asociación con la empresa: un PATCH que pudiera crear convertiría un
 * fallo de identidad en un contacto duplicado en el CRM del cliente.
 *
 * AGENT2A Task A2/A4: el cuerpo lleva DOS propiedades — `phone` y `mobilephone`—, cada una
 * traducida de forma independiente desde su propio campo del contacto (`null` → cadena vacía,
 * que es como HubSpot borra una propiedad). Ya NO es una sola propiedad: CUT-2 sólo enviaba
 * `phone` con el valor colapsado `mobile_phone ?? phone`; A2 extendió el contrato con
 * `mobilephone` y A4 terminó de cablear el PATCH para que los dos campos viajen sin colapsar.
 * Nada de email, LinkedIn ni campos custom fuera de estos dos — enviar un campo cuyo mapeo no
 * está validado sobrescribe en HubSpot algo que nadie revisó.
 *
 * CUT-3A: el cuerpo lo construye `buildHubSpotContactUpdateProperties` y no este archivo. La
 * representación del BORRADO —cadena vacía— es de HubSpot, pero es UNA sola y vive con el
 * contrato, no repartida entre el dominio y el adaptador.
 */
export async function updateHubSpotContact(
  hubspotContactId: string,
  input: HubSpotContactUpdateInput,
): Promise<{ ok: true } | { error: string }> {
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };

  try {
    const response = await fetch(
      `${HUBSPOT_BASE}/crm/v3/objects/contacts/${encodeURIComponent(hubspotContactId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: buildHubSpotContactUpdateProperties(input) }),
      },
    );

    // No exponer payload crudo ni token: sólo el código de estado. El cuerpo de error de
    // HubSpot cita las propiedades enviadas, y una de ellas es el teléfono del contacto.
    if (!response.ok) return { error: `HUBSPOT_UPDATE_HTTP_${response.status}` };
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_UPDATE_ERROR' };
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
