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
  isHubSpotFillPropertyWritable,
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

/** Lo que la búsqueda puntual por correo necesita de un contacto de HubSpot. */
export interface HubSpotContactProfile {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  phone: string | null;
  mobilePhone: string | null;
  linkedinUrl: string | null;
  ownerId: string | null;
  /** Empresa principal asociada (`associatedcompanyid`). */
  associatedCompanyId: string | null;
}

const HUBSPOT_CONTACT_PROFILE_PROPERTIES = [
  'email',
  'firstname',
  'lastname',
  'jobtitle',
  'phone',
  'mobilephone',
  'hs_linkedin_url',
  'hubspot_owner_id',
  'associatedcompanyid',
] as const;

/**
 * AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — contacto de HubSpot por correo exacto con su perfil,
 * su dueño y su empresa principal. A diferencia de `findHubSpotContactByEmail`, sin conexión
 * LANZA en vez de devolver null: «no se pudo consultar» no es «no existe».
 */
export async function findHubSpotContactProfileByEmail(email: string): Promise<HubSpotContactProfile | null> {
  const token = await getHubSpotToken();
  if (!token) throw new Error('hubspot_not_connected');

  const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: [...HUBSPOT_CONTACT_PROFILE_PROPERTIES],
      limit: 1,
    }),
  });
  if (!response.ok) throw new Error(`HubSpot contact search error: HTTP ${response.status}`);

  const data = (await response.json()) as HubSpotSearchResult;
  const first = data.results?.[0];
  if (!first?.id) return null;
  const props = first.properties ?? {};
  const read = (name: string): string | null => {
    const value = props[name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return {
    id: String(first.id),
    email: read('email'),
    firstName: read('firstname'),
    lastName: read('lastname'),
    jobTitle: read('jobtitle'),
    phone: read('phone'),
    mobilePhone: read('mobilephone'),
    linkedinUrl: read('hs_linkedin_url'),
    ownerId: read('hubspot_owner_id'),
    associatedCompanyId: read('associatedcompanyid'),
  };
}

/**
 * Bryan 17-11 — contacto de HubSpot por su ID, con el mismo perfil que la búsqueda por correo
 * (nombre, cargo, teléfonos, LinkedIn, dueño y empresa principal). Lo usa «Un contacto por
 * LinkedIn, correo o ID de HubSpot». `null` sólo si HubSpot dice que no existe (404); sin
 * conexión o con cualquier otro fallo LANZA: «no se pudo consultar» no es «no existe».
 * Devuelve el `id` que responde HubSpot (un ID fusionado lleva al contacto vigente).
 */
export async function findHubSpotContactProfileById(hubspotContactId: string): Promise<HubSpotContactProfile | null> {
  const token = await getHubSpotToken();
  if (!token) throw new Error('hubspot_not_connected');

  const params = new URLSearchParams({ properties: HUBSPOT_CONTACT_PROFILE_PROPERTIES.join(',') });
  const response = await fetch(
    `${HUBSPOT_BASE}/crm/v3/objects/contacts/${encodeURIComponent(hubspotContactId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HubSpot contact read error: HTTP ${response.status}`);

  const data = (await response.json()) as { id?: string | number; properties?: Record<string, unknown> };
  const props = data.properties ?? {};
  const read = (name: string): string | null => {
    const value = props[name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return {
    id: data.id !== undefined && data.id !== null && String(data.id) ? String(data.id) : hubspotContactId,
    email: read('email'),
    firstName: read('firstname'),
    lastName: read('lastname'),
    jobTitle: read('jobtitle'),
    phone: read('phone'),
    mobilePhone: read('mobilephone'),
    linkedinUrl: read('hs_linkedin_url'),
    ownerId: read('hubspot_owner_id'),
    associatedCompanyId: read('associatedcompanyid'),
  };
}

/**
 * Lee un contacto de HubSpot por su id con las propiedades que SellUp puede completar
 * (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION). Lo usa el sync cuando el contacto ya llegó
 * VINCULADO —los candidatos de «Primero HubSpot» se vinculan al aprobar, antes del sync— para
 * completar sus vacíos igual que en `linked_existing`.
 *
 * `null` si HubSpot dice que no existe (404). Cualquier otro fallo LANZA: el llamador no debe
 * confundir «no pude leer» con «no hay nada que completar».
 */
export async function findHubSpotContactById(
  hubspotContactId: string,
): Promise<HubSpotExistingContactMatch | null> {
  const token = await getHubSpotToken();
  if (!token) throw new Error('HubSpot token unavailable');

  const params = new URLSearchParams({ properties: ['email', ...HUBSPOT_FILL_EMPTY_PROPERTY_NAMES].join(',') });
  const response = await fetch(
    `${HUBSPOT_BASE}/crm/v3/objects/contacts/${encodeURIComponent(hubspotContactId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HubSpot contact read error: HTTP ${response.status}`);

  const data = (await response.json()) as { id?: string; properties?: Record<string, unknown> };
  const id = typeof data.id === 'string' && data.id ? data.id : hubspotContactId;
  if (!data.properties || typeof data.properties !== 'object') return { id };
  const properties: HubSpotExistingContactProperties = {};
  for (const name of HUBSPOT_FILL_EMPTY_PROPERTY_NAMES) {
    const value = data.properties[name];
    properties[name] = typeof value === 'string' ? value : null;
  }
  const email = data.properties.email;
  return { id, properties, email: typeof email === 'string' ? email : null };
}

/**
 * PATCH SÓLO del correo de un contacto ya vinculado cuyo correo está vacío en HubSpot
 * (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION). Separado del resto: HubSpot responde 409 si
 * otro contacto ya usa ese correo, y eso no debe frenar el teléfono ni el LinkedIn. Sólo
 * devuelve el código HTTP: el cuerpo citaría el correo.
 */
export async function fillEmptyHubSpotContactEmail(
  hubspotContactId: string,
  email: string,
): Promise<{ ok: true } | { error: string }> {
  const value = email.trim();
  if (!value) return { error: 'EMPTY_EMAIL' };
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };
  try {
    const result = await patchHubSpotContactProperties(token, hubspotContactId, { email: value });
    return 'ok' in result ? { ok: true } : { error: `HUBSPOT_EMAIL_HTTP_${result.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_EMAIL_FILL_ERROR' };
  }
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
 * Propiedades que, si HubSpot rechaza el PATCH con 400, se quitan para reintentar UNA vez:
 * nunca deben impedir que `phone` / `mobilephone` (y nombre / cargo) lleguen.
 */
const HUBSPOT_FILL_OPTIONAL_PROPERTY_NAMES: readonly HubSpotFillEmptyPropertyName[] = [
  'hs_linkedin_url',
  'company_phone',
  'telefono_alterno',
];

/**
 * Completa SÓLO propiedades vacías de un contacto que ya existía en HubSpot
 * (AGENT2A-HUBSPOT-FILL-EMPTY-ON-APPROVAL).
 *
 * Quien decide QUÉ viaja es `buildHubSpotFillEmptyProperties` (motor puro); este adaptador sólo
 * descarta valores vacíos —una cadena vacía BORRARÍA la propiedad en HubSpot— y hace el PATCH.
 *
 * Propiedades opcionales (`hs_linkedin_url`, `company_phone`, `telefono_alterno`): si HubSpot rechaza
 * el cuerpo con 400 y llevaba alguna, se reintenta UNA vez sin ellas. Un portal que las tenga
 * restringidas (o un formato que su validación no acepte) no puede impedir que `phone` /
 * `mobilephone` lleguen.
 *
 * AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER: un campo de teléfono APAGADO
 * (`HUBSPOT_PHONE_SLOT_WRITE_ENABLED`) nunca se envía, aunque el llamador lo pase.
 */
export async function fillEmptyHubSpotContactProperties(
  hubspotContactId: string,
  input: HubSpotContactFillProperties,
): Promise<{ ok: true; written: HubSpotFillEmptyPropertyName[] } | { error: string }> {
  const properties: Record<string, string> = {};
  for (const name of HUBSPOT_FILL_EMPTY_PROPERTY_NAMES) {
    if (!isHubSpotFillPropertyWritable(name)) continue;
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

    const optionalSent = HUBSPOT_FILL_OPTIONAL_PROPERTY_NAMES.filter((name) => name in properties);
    if (first.status === 400 && optionalSent.length > 0) {
      for (const name of optionalSent) delete properties[name];
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
 * Cuerpo `properties` del POST de creación. Pura: sólo claves con valor (nunca cadena vacía).
 * El LinkedIn viaja en `hs_linkedin_url` (AGENT2A-HUBSPOT-LINKEDIN-ON-CREATE).
 */
export function buildHubSpotContactCreateBody(
  input: HubSpotContactCreateInput,
  markSellUpCreated: boolean,
): Record<string, string> {
  const properties: Record<string, string> = { email: input.email };
  if (input.firstname) properties.firstname = input.firstname;
  if (input.lastname) properties.lastname = input.lastname;
  if (input.jobtitle) properties.jobtitle = input.jobtitle;
  if (input.phone) properties.phone = input.phone;
  if (input.mobilePhone) properties.mobilephone = input.mobilePhone;
  // AGENT2A-HUBSPOT-ALL-PHONES-CREATE-LINK: los campos adicionales sólo si están ENCENDIDOS
  // (`HUBSPOT_PHONE_SLOT_WRITE_ENABLED`), aunque el llamador los pase.
  if (input.companyPhone && isHubSpotFillPropertyWritable('company_phone')) {
    properties.company_phone = input.companyPhone;
  }
  if (input.alternatePhone && isHubSpotFillPropertyWritable('telefono_alterno')) {
    properties.telefono_alterno = input.alternatePhone;
  }
  if (input.linkedinUrl) properties.hs_linkedin_url = input.linkedinUrl;
  if (markSellUpCreated) properties.sellup_created = 'true';
  return properties;
}

/**
 * Envía la creación y, si HubSpot responde 400 (validación de propiedades) con alguna propiedad
 * OPCIONAL en el cuerpo (`hs_linkedin_url`, `company_phone`, `telefono_alterno`), reintenta UNA
 * vez sin ellas: un LinkedIn o un teléfono adicional que HubSpot no acepte nunca debe impedir que
 * el contacto llegue al CRM (con `phone` / `mobilephone`).
 */
export async function postHubSpotContactCreateWithLinkedinFallback(
  properties: Record<string, string>,
  post: (body: Record<string, string>) => Promise<Response>,
): Promise<Response> {
  const response = await post(properties);
  if (response.status !== 400) return response;
  const optionalSent = HUBSPOT_FILL_OPTIONAL_PROPERTY_NAMES.filter((name) => name in properties);
  if (optionalSent.length === 0) return response;
  const withoutOptional = { ...properties };
  for (const name of optionalSent) delete withoutOptional[name];
  return post(withoutOptional);
}

/**
 * Crea un contacto en HubSpot con propiedades estándar mínimas, LinkedIn incluido.
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

  // `sellup_created` sólo se manda si la verificación/creación de la propiedad tuvo éxito: sin
  // permiso de esquema, el contacto se crea igual, simplemente sin esta marca.
  const properties = buildHubSpotContactCreateBody(input, propertyEnsure.ok);

  try {
    const response = await postHubSpotContactCreateWithLinkedinFallback(properties, (body) =>
      fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: body }),
      }),
    );

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

// ── AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE (Bryan 18-11) ────────────────────────────
//
// Correo principal y adicionales, y la empresa principal del contacto. Mismas reglas que el
// resto del adaptador: nunca se devuelve ni se registra el cuerpo de una respuesta de HubSpot
// (citaría el correo); sólo códigos HTTP.

/** Correo principal y adicionales (`hs_additional_emails`, separados por `;`). null = no se pudo leer. */
export async function readHubSpotContactEmails(
  hubspotContactId: string,
): Promise<{ primary: string | null; additional: string[] } | null> {
  const token = await getHubSpotToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams({ properties: 'email,hs_additional_emails' });
    const response = await fetch(
      `${HUBSPOT_BASE}/crm/v3/objects/contacts/${encodeURIComponent(hubspotContactId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { properties?: Record<string, unknown> };
    const primary = typeof data.properties?.email === 'string' ? data.properties.email.trim().toLowerCase() : '';
    const rawAdditional = data.properties?.hs_additional_emails;
    const additional =
      typeof rawAdditional === 'string'
        ? rawAdditional
            .split(';')
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)
        : [];
    return { primary: primary || null, additional };
  } catch {
    return null;
  }
}

/**
 * Agrega un correo ADICIONAL al contacto. `hs_additional_emails` es de sólo lectura en la API v3:
 * la única vía documentada es la API v1 de correos secundarios.
 */
export async function addHubSpotContactSecondaryEmail(
  hubspotContactId: string,
  email: string,
): Promise<{ ok: true } | { error: string }> {
  const value = email.trim().toLowerCase();
  if (!value) return { error: 'EMPTY_EMAIL' };
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };
  try {
    const response = await fetch(
      `${HUBSPOT_BASE}/contacts/v1/secondary-email/${encodeURIComponent(hubspotContactId)}/email/${encodeURIComponent(value)}`,
      { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
    );
    return response.ok ? { ok: true } : { error: `HUBSPOT_SECONDARY_EMAIL_HTTP_${response.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_SECONDARY_EMAIL_ERROR' };
  }
}

/** Cambia el correo PRINCIPAL. 409 = otro contacto de HubSpot ya usa ese correo. */
export async function setHubSpotContactPrimaryEmail(
  hubspotContactId: string,
  email: string,
): Promise<{ ok: true } | { error: string; status?: number }> {
  const value = email.trim().toLowerCase();
  if (!value) return { error: 'EMPTY_EMAIL' };
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };
  try {
    const result = await patchHubSpotContactProperties(token, hubspotContactId, { email: value });
    return 'ok' in result ? { ok: true } : { error: `HUBSPOT_EMAIL_HTTP_${result.status}`, status: result.status };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_EMAIL_ERROR' };
  }
}

/** Cargo actual (información nueva del cambio de empresa: SÍ reemplaza el anterior). */
export async function setHubSpotContactJobTitle(
  hubspotContactId: string,
  jobTitle: string,
): Promise<{ ok: true } | { error: string }> {
  const value = jobTitle.trim();
  if (!value) return { error: 'EMPTY_TITLE' };
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };
  try {
    const result = await patchHubSpotContactProperties(token, hubspotContactId, { jobtitle: value });
    return 'ok' in result ? { ok: true } : { error: `HUBSPOT_TITLE_HTTP_${result.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_TITLE_ERROR' };
  }
}

/** Ids de las empresas asociadas al contacto. null = no se pudieron leer. */
export async function listHubSpotContactCompanyIds(hubspotContactId: string): Promise<string[] | null> {
  const token = await getHubSpotToken();
  if (!token) return null;
  try {
    const response = await fetch(
      `${HUBSPOT_BASE}/crm/v4/objects/contacts/${encodeURIComponent(hubspotContactId)}/associations/companies?limit=500`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { results?: Array<{ toObjectId?: unknown }> };
    return (data.results ?? [])
      .map((row) => (row.toObjectId === undefined || row.toObjectId === null ? '' : String(row.toObjectId)))
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** Tipo de asociación «Principal» contacto → empresa (HUBSPOT_DEFINED). */
const HUBSPOT_PRIMARY_CONTACT_TO_COMPANY_TYPE_ID = 1;

/** Asocia el contacto a la empresa con la etiqueta «Principal» (v4). */
export async function setHubSpotContactPrimaryCompany(
  hubspotContactId: string,
  hubspotCompanyId: string,
): Promise<{ ok: true } | { error: string }> {
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };
  try {
    const response = await fetch(
      `${HUBSPOT_BASE}/crm/v4/objects/contacts/${encodeURIComponent(hubspotContactId)}/associations/companies/${encodeURIComponent(hubspotCompanyId)}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HUBSPOT_PRIMARY_CONTACT_TO_COMPANY_TYPE_ID },
        ]),
      },
    );
    return response.ok ? { ok: true } : { error: `HUBSPOT_PRIMARY_ASSOC_HTTP_${response.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_PRIMARY_ASSOC_ERROR' };
  }
}

/** Quita la asociación contacto ↔ empresa (todas sus etiquetas). No toca deals ni actividades. */
export async function removeHubSpotContactCompanyAssociation(
  hubspotContactId: string,
  hubspotCompanyId: string,
): Promise<{ ok: true } | { error: string }> {
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };
  try {
    const response = await fetch(
      `${HUBSPOT_BASE}/crm/v4/objects/contacts/${encodeURIComponent(hubspotContactId)}/associations/companies/${encodeURIComponent(hubspotCompanyId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    return response.ok ? { ok: true } : { error: `HUBSPOT_REMOVE_ASSOC_HTTP_${response.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_REMOVE_ASSOC_ERROR' };
  }
}

// ── AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE (Bryan 19-11) ─────────────────────────────
//
// Fusionar dos contactos de HubSpot cuando el correo correcto ya lo tiene OTRO contacto (409 al
// cambiar el principal). Mismas reglas: sólo códigos HTTP, nunca el cuerpo (citaría el correo).

/**
 * Fusiona `objectIdToMerge` DENTRO de `primaryObjectId` (`POST /crm/v3/objects/contacts/merge`).
 * Según HubSpot: el correo del principal se queda y el del otro pasa a adicional; en las
 * propiedades gana el principal (lo vacío se llena con el otro); se suman asociaciones y
 * actividades; por defecto el registro resultante recibe un Record ID NUEVO. No se puede deshacer.
 */
export async function mergeHubSpotContacts(
  primaryObjectId: string,
  objectIdToMerge: string,
): Promise<{ ok: true; mergedId: string } | { error: string; status?: number }> {
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };
  try {
    const response = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/merge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryObjectId, objectIdToMerge }),
    });
    if (!response.ok) return { error: `HUBSPOT_MERGE_HTTP_${response.status}`, status: response.status };
    const data = (await response.json().catch(() => null)) as { id?: string | number } | null;
    const mergedId = data?.id !== undefined && data?.id !== null && String(data.id) ? String(data.id) : primaryObjectId;
    return { ok: true, mergedId };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_MERGE_ERROR' };
  }
}

/** Propiedades que la fusión SÍ reemplaza con lo de SellUp (decisión de Bryan, 19-11). */
export interface HubSpotContactReplaceProperties {
  hs_linkedin_url?: string | null;
  jobtitle?: string | null;
  hubspot_owner_id?: string | null;
}

/**
 * Reemplaza (no sólo llena vacíos) LinkedIn, cargo y propietario del contacto. Un valor vacío se
 * omite: una cadena vacía BORRARÍA la propiedad en HubSpot. Si HubSpot rechaza con 400 y llevaba
 * `hs_linkedin_url`, reintenta UNA vez sin ella (mismo criterio que el completado de vacíos).
 */
export async function replaceHubSpotContactProperties(
  hubspotContactId: string,
  input: HubSpotContactReplaceProperties,
): Promise<{ ok: true; written: Array<keyof HubSpotContactReplaceProperties> } | { error: string }> {
  const properties: Record<string, string> = {};
  for (const name of ['hs_linkedin_url', 'jobtitle', 'hubspot_owner_id'] as const) {
    const value = input[name];
    if (typeof value === 'string' && value.trim()) properties[name] = value.trim();
  }
  const names = () => Object.keys(properties) as Array<keyof HubSpotContactReplaceProperties>;
  if (names().length === 0) return { ok: true, written: [] };
  const token = await getHubSpotToken();
  if (!token) return { error: 'TOKEN_UNAVAILABLE' };
  try {
    let result = await patchHubSpotContactProperties(token, hubspotContactId, properties);
    if (!('ok' in result) && result.status === 400 && properties.hs_linkedin_url) {
      delete properties.hs_linkedin_url;
      if (names().length === 0) return { error: 'HUBSPOT_REPLACE_HTTP_400' };
      result = await patchHubSpotContactProperties(token, hubspotContactId, properties);
    }
    return 'ok' in result ? { ok: true, written: names() } : { error: `HUBSPOT_REPLACE_HTTP_${result.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : 'HUBSPOT_REPLACE_ERROR' };
  }
}
