/**
 * HubSpot Company Search — Capa de preparación para validación de duplicidad futura.
 *
 * STATUS: Implementado de forma aislada. NO está conectado aún al flujo de Prospectos.
 *
 * Este helper estará disponible para ser invocado desde el módulo de Prospectos
 * en la fase siguiente, cuando se construya la validación de duplicidad de empresas.
 *
 * Uso futuro esperado:
 *   const result = await checkHubSpotCompanyDuplicate({ companyName: 'Acme', domain: 'acme.com' });
 *   if (result.hasDuplicate) { ... }
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';

async function getHubSpotToken(): Promise<string | null> {
  const admin = createAdminClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
    p_name: VAULT_SECRET_NAME,
  });
  if (error) return null;
  return data as string | null;
}

async function isHubSpotConnected(): Promise<boolean> {
  const admin = createAdminClient(supabaseUrl, supabaseServiceKey);
  const { data } = await admin
    .from('external_integration_connections')
    .select('connection_status, credentials_status')
    .eq('connection_status', 'connected')
    .single();
  return !!data;
}

// ============================================================
// Types
// ============================================================

export interface HubSpotCompany {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
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
    properties: ['name', 'domain', 'website'],
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
    properties: ['name', 'domain', 'website'],
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
    })
  );
}

// ============================================================
// Función principal — disponible para uso futuro en Prospectos
// ============================================================

/**
 * Verifica si una empresa ya existe en HubSpot por dominio (prioritario) o nombre.
 *
 * - Si HubSpot no está conectado, retorna `skipped: true` sin error.
 * - El dominio es el identificador recomendado por HubSpot para deduplicación.
 * - Si no hay dominio, busca por nombre como fallback.
 *
 * @example
 * // En el flujo de Prospectos (fase siguiente):
 * const dup = await checkHubSpotCompanyDuplicate({ domain: 'acme.com', companyName: 'Acme Inc.' });
 * if (dup.hasDuplicate) {
 *   // Mostrar advertencia al usuario con dup.matches
 * }
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
