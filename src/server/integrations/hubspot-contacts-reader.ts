// HubSpot Contacts Reader — Hito 17A.2A
// Solo lectura. No escribe nada. No expone tokens.
// Devuelve skipped si HubSpot no está conectado o falta el scope contacts.read.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { ExistingContactSnapshot, ExistingContactsSourceResult } from '@/modules/contact-enrichment/types';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';
const CONTACTS_READ_SCOPE = 'crm.objects.contacts.read';
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

async function getHubSpotConnectionMeta(): Promise<{ connected: boolean; scopes: string[] }> {
  const admin = getAdminSupabase();
  const { data } = await admin
    .from('external_integration_connections')
    .select('connection_status, metadata')
    .eq('connection_status', 'connected')
    .single();

  if (!data) return { connected: false, scopes: [] };

  const meta = data.metadata as Record<string, unknown> | null;
  const scopes = Array.isArray(meta?.scopes) ? (meta.scopes as string[]) : [];
  return { connected: true, scopes };
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
 * Requiere scope crm.objects.contacts.read.
 * Devuelve skipped si no hay conexión o falta el scope.
 */
export async function readHubSpotContactsForCompany(
  hubspotCompanyId: string
): Promise<ExistingContactsSourceResult> {
  try {
    const { connected, scopes } = await getHubSpotConnectionMeta();

    if (!connected) {
      return {
        status: 'skipped',
        contacts: [],
        count: 0,
        reason: 'HubSpot no está conectado',
      };
    }

    // Si tenemos scopes en metadata y el scope no está → skip sin llamar la API
    if (scopes.length > 0 && !scopes.includes(CONTACTS_READ_SCOPE)) {
      return {
        status: 'skipped',
        contacts: [],
        count: 0,
        reason: `Scope ${CONTACTS_READ_SCOPE} no disponible en la conexión actual`,
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
