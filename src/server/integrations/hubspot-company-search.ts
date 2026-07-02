/**
 * HubSpot Company Search — Búsqueda y deduplicación de empresas en HubSpot.
 *
 * Incluye:
 *  - checkHubSpotCompanyDuplicate: validación de duplicidad (para creación de prospectos)
 *  - searchHubSpotCompaniesForResolver: búsqueda enriquecida (para el wizard de enriquecimiento)
 *
 * Ambas funciones son de solo lectura. No escriben en HubSpot.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';
const INTEGRATION_KEY = 'hubspot';

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

/**
 * Verifica si HubSpot está conectado usando el mismo patrón de dos pasos que
 * hubspot-contacts-reader.ts: primero busca el integration_id por integration_key,
 * luego verifica connection_status y credentials_status.
 *
 * Evita el error de .single() cuando no hay filas o hay múltiples.
 */
async function isHubSpotConnected(): Promise<boolean> {
  const admin = getAdminSupabase();

  const { data: integration, error: intError } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', INTEGRATION_KEY)
    .single();

  if (intError || !integration) return false;

  const { data: connection } = await admin
    .from('external_integration_connections')
    .select('connection_status, credentials_status, vault_secret_id')
    .eq('integration_id', integration.id)
    .maybeSingle();

  return (
    connection?.connection_status === 'connected' &&
    connection?.credentials_status === 'stored' &&
    !!connection?.vault_secret_id
  );
}

// ============================================================
// Types
// ============================================================

export interface HubSpotCompany {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
}

export interface DuplicateCheckInput {
  companyName?: string;
  domain?: string;
}

export interface DuplicateCheckResult {
  checked: boolean;
  hasDuplicate: boolean;
  matches: HubSpotCompany[];
  error?: string;
  /** True si HubSpot no está conectado — la validación es opcional */
  skipped?: boolean;
}

// ============================================================
// Búsqueda de empresas por dominio (identificador recomendado por HubSpot)
// ============================================================

const COMPANY_PROPERTIES = ['name', 'domain', 'website', 'country', 'city'];

async function searchCompaniesByDomain(
  token: string,
  domain: string
): Promise<HubSpotCompany[]> {
  const body = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'domain',
            operator: 'EQ',
            value: domain.toLowerCase().trim(),
          },
        ],
      },
    ],
    properties: COMPANY_PROPERTIES,
    limit: 5,
  };

  const response = await fetch(
    'https://api.hubapi.com/crm/v3/objects/companies/search',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) return [];

  const data = await response.json();
  return (data.results ?? []).map(
    (r: { id: string; properties: Record<string, string | null> }) => ({
      id: r.id,
      name: r.properties.name ?? null,
      domain: r.properties.domain ?? null,
      website: r.properties.website ?? null,
      country: r.properties.country ?? null,
      city: r.properties.city ?? null,
    })
  );
}

// ============================================================
// Búsqueda por nombre (fallback cuando no hay dominio)
// ============================================================

async function searchCompaniesByName(
  token: string,
  name: string
): Promise<HubSpotCompany[]> {
  const body = {
    query: name.trim(),
    properties: COMPANY_PROPERTIES,
    limit: 5,
  };

  const response = await fetch(
    'https://api.hubapi.com/crm/v3/objects/companies/search',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) return [];

  const data = await response.json();
  return (data.results ?? []).map(
    (r: { id: string; properties: Record<string, string | null> }) => ({
      id: r.id,
      name: r.properties.name ?? null,
      domain: r.properties.domain ?? null,
      website: r.properties.website ?? null,
      country: r.properties.country ?? null,
      city: r.properties.city ?? null,
    })
  );
}

// ============================================================
// Función principal — validación de duplicidad para Prospectos
// ============================================================

/**
 * Verifica si una empresa ya existe en HubSpot por dominio (prioritario) o nombre.
 *
 * - Si HubSpot no está conectado, retorna `skipped: true` sin error.
 * - El dominio es el identificador recomendado por HubSpot para deduplicación.
 * - Si no hay dominio, busca por nombre como fallback.
 */
export async function checkHubSpotCompanyDuplicate(
  input: DuplicateCheckInput
): Promise<DuplicateCheckResult> {
  const connected = await isHubSpotConnected();

  if (!connected) {
    return {
      checked: false,
      hasDuplicate: false,
      matches: [],
      skipped: true,
    };
  }

  const token = await getHubSpotToken();

  if (!token) {
    return {
      checked: false,
      hasDuplicate: false,
      matches: [],
      skipped: true,
    };
  }

  try {
    let matches: HubSpotCompany[] = [];

    if (input.domain && input.domain.trim().length > 0) {
      matches = await searchCompaniesByDomain(token, input.domain);
    }

    if (matches.length === 0 && input.companyName && input.companyName.trim().length > 0) {
      matches = await searchCompaniesByName(token, input.companyName);
    }

    return {
      checked: true,
      hasDuplicate: matches.length > 0,
      matches,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return {
      checked: false,
      hasDuplicate: false,
      matches: [],
      error: msg,
    };
  }
}

// ============================================================
// Búsqueda enriquecida para el wizard de enriquecimiento (17A.9F)
// ============================================================

export type HubSpotCompanySearchSkipReason =
  | 'not_connected'
  | 'no_token'
  | 'no_search_terms';

export interface HubSpotCompanySearchResult {
  /** true si se encontraron resultados. */
  found: boolean;
  companies: HubSpotCompany[];
  /** true si HubSpot no está disponible — no es error fatal. */
  skipped: boolean;
  skipReason?: HubSpotCompanySearchSkipReason;
  error?: string;
}

/**
 * Busca empresas en HubSpot por dominio (exacto) o nombre (fulltext).
 * Diseñada para el wizard de enriquecimiento — devuelve datos enriquecidos
 * incluyendo country y city para mapear countryCode.
 *
 * - Si HubSpot no está conectado: skipped: true, sin error fatal.
 * - Si no hay dominio ni nombre: skipped: true.
 * - Busca por dominio primero; si 0 resultados, busca por nombre.
 * - Devuelve hasta 5 empresas por búsqueda.
 */
export async function searchHubSpotCompaniesForResolver(opts: {
  domain?: string;
  name?: string;
}): Promise<HubSpotCompanySearchResult> {
  if (!opts.domain && !opts.name) {
    return { found: false, companies: [], skipped: true, skipReason: 'no_search_terms' };
  }

  const connected = await isHubSpotConnected();
  if (!connected) {
    return { found: false, companies: [], skipped: true, skipReason: 'not_connected' };
  }

  const token = await getHubSpotToken();
  if (!token) {
    return { found: false, companies: [], skipped: true, skipReason: 'no_token' };
  }

  try {
    let companies: HubSpotCompany[] = [];

    if (opts.domain && opts.domain.trim().length > 0) {
      companies = await searchCompaniesByDomain(token, opts.domain);
    }

    if (companies.length === 0 && opts.name && opts.name.trim().length > 0) {
      companies = await searchCompaniesByName(token, opts.name);
    }

    return { found: companies.length > 0, companies, skipped: false };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Error desconocido';
    return { found: false, companies: [], skipped: false, error };
  }
}
