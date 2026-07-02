// HubSpot Contacts Reader — Hito 17A.2A
// Solo lectura. No escribe nada. No expone tokens.
// Devuelve skipped si HubSpot no está conectado o faltan scopes de lectura.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { ExistingContactSnapshot, ExistingContactsSourceResult } from '@/modules/contact-enrichment/types';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';
const INTEGRATION_KEY = 'hubspot';
const CONTACTS_READ_SCOPE = 'crm.objects.contacts.read';
const COMPANIES_READ_SCOPE = 'crm.objects.companies.read';
const MAX_CONTACTS = 100;

const CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'phone',
  'mobilephone',
  'jobtitle',
  'hs_linkedin_url',
];

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

// ── Tipos de readiness para snapshot (solo lectura) ───────────

export type HubSpotSnapshotSkipReason =
  | 'not_connected'
  | 'credentials_not_stored'
  | 'no_vault_secret'
  | 'missing_contacts_read_scope'
  | 'missing_companies_read_scope';

export interface HubSpotSnapshotReadiness {
  canRead: boolean;
  skipReason?: HubSpotSnapshotSkipReason;
  scopes: string[];
}

export interface HubSpotConnectionRow {
  connection_status: string | null;
  credentials_status: string | null;
  vault_secret_id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Lógica pura (sin DB) que evalúa si una conexión HubSpot puede hacer
 * lectura de contactos (snapshot). Exportada para tests.
 *
 * Reglas:
 *  - connection_status debe ser 'connected'
 *  - credentials_status debe ser 'stored'
 *  - vault_secret_id no puede ser null
 *  - Si hay scopes declarados, deben incluir contacts.read y companies.read
 *  - Si no hay scopes declarados, se permite (la API responderá 403 si falta)
 */
export function evaluateHubSpotSnapshotReadiness(
  row: HubSpotConnectionRow | null,
): HubSpotSnapshotReadiness {
  if (!row || row.connection_status !== 'connected') {
    return { canRead: false, skipReason: 'not_connected', scopes: [] };
  }
  if (row.credentials_status !== 'stored') {
    return { canRead: false, skipReason: 'credentials_not_stored', scopes: [] };
  }
  if (!row.vault_secret_id) {
    return { canRead: false, skipReason: 'no_vault_secret', scopes: [] };
  }

  const scopes = Array.isArray(row.metadata?.scopes)
    ? (row.metadata.scopes as string[])
    : [];

  if (scopes.length > 0 && !scopes.includes(CONTACTS_READ_SCOPE)) {
    return { canRead: false, skipReason: 'missing_contacts_read_scope', scopes };
  }
  if (scopes.length > 0 && !scopes.includes(COMPANIES_READ_SCOPE)) {
    return { canRead: false, skipReason: 'missing_companies_read_scope', scopes };
  }

  return { canRead: true, scopes };
}

function snapshotSkipReasonText(reason: HubSpotSnapshotSkipReason): string {
  switch (reason) {
    case 'not_connected':
      return 'HubSpot no está conectado';
    case 'credentials_not_stored':
      return 'HubSpot conectado sin credenciales almacenadas';
    case 'no_vault_secret':
      return 'HubSpot conectado sin credenciales almacenadas en Vault';
    case 'missing_contacts_read_scope':
      return `HubSpot conectado sin scope ${CONTACTS_READ_SCOPE}`;
    case 'missing_companies_read_scope':
      return `HubSpot conectado sin scope ${COMPANIES_READ_SCOPE}`;
  }
}

/**
 * Dos pasos: resuelve el id de la integración desde external_integrations
 * (que tiene integration_key), luego busca la conexión en
 * external_integration_connections por integration_id.
 *
 * external_integration_connections NO tiene columna integration_key directa.
 */
async function loadHubSpotConnectionRow(): Promise<HubSpotConnectionRow | null> {
  const admin = getAdminSupabase();

  const { data: integration, error: intError } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', INTEGRATION_KEY)
    .single();

  if (intError || !integration) return null;

  const { data: connection } = await admin
    .from('external_integration_connections')
    .select('connection_status, credentials_status, vault_secret_id, metadata')
    .eq('integration_id', integration.id)
    .maybeSingle();

  return connection as HubSpotConnectionRow | null;
}

interface HubSpotAssociationResult {
  results: Array<{ id: string; type: string }>;
  paging?: { next?: { after?: string } };
}

interface HubSpotContactProperties {
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  mobilephone?: string;
  jobtitle?: string;
  hs_linkedin_url?: string;
}

interface HubSpotContactObject {
  id: string;
  properties: HubSpotContactProperties;
}

interface HubSpotBatchReadResult {
  results: HubSpotContactObject[];
}

function normalizeContactSnapshot(obj: HubSpotContactObject): ExistingContactSnapshot {
  const p = obj.properties;
  const firstName = p.firstname?.trim() || null;
  const lastName = p.lastname?.trim() || null;
  const fullName =
    [firstName, lastName].filter(Boolean).join(' ') || `HubSpot Contact ${obj.id}`;
  const email = p.email?.trim().toLowerCase() || null;
  const phone = p.phone?.trim() || p.mobilephone?.trim() || null;
  const linkedinUrl = p.hs_linkedin_url?.trim() || null;
  const title = p.jobtitle?.trim() || null;

  return {
    id: obj.id,
    source: 'hubspot',
    fullName,
    firstName,
    lastName,
    email,
    phone,
    linkedinUrl,
    title,
    completeness: {
      hasEmail: !!email,
      hasPhone: !!phone,
      hasLinkedin: !!linkedinUrl,
    },
  };
}

/**
 * Lee contactos asociados a una empresa HubSpot.
 * Requiere scope crm.objects.contacts.read y crm.objects.companies.read.
 * Devuelve skipped con razón específica si la conexión no es usable.
 */
export async function readHubSpotContactsForCompany(
  hubspotCompanyId: string
): Promise<ExistingContactsSourceResult> {
  try {
    const connectionRow = await loadHubSpotConnectionRow();
    const readiness = evaluateHubSpotSnapshotReadiness(connectionRow);

    if (!readiness.canRead) {
      return {
        status: 'skipped',
        contacts: [],
        count: 0,
        reason: snapshotSkipReasonText(readiness.skipReason!),
      };
    }

    const token = await getHubSpotToken();
    if (!token) {
      return {
        status: 'skipped',
        contacts: [],
        count: 0,
        reason: 'Token HubSpot no disponible',
      };
    }

    // 1. Obtener IDs de contactos asociados a la empresa
    const assocUrl = `https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(hubspotCompanyId)}/associations/contacts?limit=${MAX_CONTACTS}`;
    const assocResponse = await fetch(assocUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!assocResponse.ok) {
      if (assocResponse.status === 401 || assocResponse.status === 403) {
        return {
          status: 'skipped',
          contacts: [],
          count: 0,
          reason: `Scope ${CONTACTS_READ_SCOPE} no autorizado (HTTP ${assocResponse.status})`,
        };
      }
      return {
        status: 'error',
        contacts: [],
        count: 0,
        reason: `HubSpot associations error: HTTP ${assocResponse.status}`,
      };
    }

    const assocData = (await assocResponse.json()) as HubSpotAssociationResult;
    const contactIds = assocData.results.map((r) => r.id);

    if (contactIds.length === 0) {
      return { status: 'success', contacts: [], count: 0 };
    }

    // 2. Batch read propiedades de los contactos
    const batchResponse = await fetch(
      'https://api.hubapi.com/crm/v3/objects/contacts/batch/read',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: contactIds.slice(0, MAX_CONTACTS).map((id) => ({ id })),
          properties: CONTACT_PROPERTIES,
        }),
      }
    );

    if (!batchResponse.ok) {
      if (batchResponse.status === 401 || batchResponse.status === 403) {
        return {
          status: 'skipped',
          contacts: [],
          count: 0,
          reason: `Scope ${CONTACTS_READ_SCOPE} no autorizado en batch/read (HTTP ${batchResponse.status})`,
        };
      }
      return {
        status: 'error',
        contacts: [],
        count: 0,
        reason: `HubSpot batch/read error: HTTP ${batchResponse.status}`,
      };
    }

    const batchData = (await batchResponse.json()) as HubSpotBatchReadResult;
    const contacts = batchData.results.map(normalizeContactSnapshot);

    return { status: 'success', contacts, count: contacts.length };
  } catch (err) {
    return {
      status: 'error',
      contacts: [],
      count: 0,
      reason: err instanceof Error ? err.message : 'Error inesperado leyendo HubSpot contacts',
    };
  }
}
