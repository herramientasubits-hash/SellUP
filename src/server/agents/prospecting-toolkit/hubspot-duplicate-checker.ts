/**
 * Prospecting Toolkit — hubspot_duplicate_checker
 *
 * Verifica si una empresa candidata ya existe en HubSpot CRM de UBITS.
 * Solo lectura. Usa el token almacenado en Supabase Vault.
 * No crea ni modifica empresas en HubSpot.
 *
 * Endpoint: POST /crm/v3/objects/companies/search
 * Propiedades validadas en portal UBITS: hs_object_id, name, domain, website,
 *   country, city, industry, lifecyclestage, hs_lead_status, nit
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { DuplicateCheckInput, DuplicateMatch } from './types';
import { buildCompanySearchTerms, normalizeCompanyName } from './normalization';

// ============================================================
// Admin client + Vault
// ============================================================

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';
const INTEGRATION_KEY = 'hubspot';

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

async function isHubSpotConnected(): Promise<boolean> {
  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from('external_integration_connections')
      .select('connection_status, credentials_status')
      .eq('integration_key', INTEGRATION_KEY)
      .eq('connection_status', 'connected')
      .single();
    return !!data;
  } catch {
    return false;
  }
}

// ============================================================
// Tipos HubSpot
// ============================================================

interface HubSpotCompanyProperties {
  name: string | null;
  domain: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  industry: string | null;
  lifecyclestage: string | null;
  hs_lead_status: string | null;
  nit: string | null;
}

interface HubSpotSearchResult {
  id: string;
  properties: HubSpotCompanyProperties;
}

interface HubSpotSearchResponse {
  results: HubSpotSearchResult[];
  total: number;
}

// Propiedades confirmadas en portal UBITS (ver HUBSPOT_ACCOUNT_FIELD_MAPPING.md)
const HS_PROPERTIES = [
  'name',
  'domain',
  'website',
  'country',
  'city',
  'industry',
  'lifecyclestage',
  'hs_lead_status',
  'nit',
];

// ============================================================
// Búsquedas HubSpot — Solo lectura
// ============================================================

async function searchByDomain(
  token: string,
  domain: string
): Promise<HubSpotSearchResult[]> {
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
    properties: HS_PROPERTIES,
    limit: 5,
  };

  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];
  const data = (await res.json()) as HubSpotSearchResponse;
  return data.results ?? [];
}

async function searchByName(
  token: string,
  name: string
): Promise<HubSpotSearchResult[]> {
  const body = {
    query: name.trim(),
    properties: HS_PROPERTIES,
    limit: 5,
  };

  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];
  const data = (await res.json()) as HubSpotSearchResponse;
  return data.results ?? [];
}

// ============================================================
// Clasificación de resultados HubSpot
// ============================================================

function classifyHubSpotResult(
  result: HubSpotSearchResult,
  input: DuplicateCheckInput,
  searchedDomain: string | null
): DuplicateMatch {
  const p = result.properties;
  const rDomain = p.domain?.toLowerCase().trim() ?? null;
  const rName = p.name ?? null;

  // Dominio exacto → existing_in_hubspot
  if (searchedDomain && rDomain && rDomain === searchedDomain) {
    return {
      source: 'hubspot',
      status: 'existing_in_hubspot',
      confidence: 92,
      matchedId: result.id,
      matchedName: rName,
      matchedDomain: rDomain,
      matchedWebsite: p.website,
      matchedTaxIdentifier: p.nit,
      reason: `Dominio exacto coincide en HubSpot: ${rDomain}`,
      raw: { id: result.id, domain: rDomain, name: rName, lifecyclestage: p.lifecyclestage },
    };
  }

  // Nombre normalizado muy similar → possible_duplicate o existing_in_hubspot
  if (rName && input.name) {
    const rNorm = normalizeCompanyName(rName);
    const iNorm = normalizeCompanyName(input.name);

    if (rNorm === iNorm) {
      return {
        source: 'hubspot',
        status: 'existing_in_hubspot',
        confidence: 82,
        matchedId: result.id,
        matchedName: rName,
        matchedDomain: rDomain,
        matchedWebsite: p.website,
        matchedTaxIdentifier: p.nit,
        reason: `Nombre normalizado exacto coincide en HubSpot: "${rName}"`,
        raw: { id: result.id, domain: rDomain, name: rName, lifecyclestage: p.lifecyclestage },
      };
    }

    const contained = rNorm.includes(iNorm) || iNorm.includes(rNorm);
    if (contained && rNorm.length >= 3 && iNorm.length >= 3) {
      return {
        source: 'hubspot',
        status: 'possible_duplicate',
        confidence: 65,
        matchedId: result.id,
        matchedName: rName,
        matchedDomain: rDomain,
        matchedWebsite: p.website,
        matchedTaxIdentifier: p.nit,
        reason: `Nombre similar por contenido en HubSpot: "${rName}"`,
        raw: { id: result.id, domain: rDomain, name: rName, lifecyclestage: p.lifecyclestage },
      };
    }
  }

  // Resultado devuelto por HubSpot pero sin match claro → posible duplicado débil
  return {
    source: 'hubspot',
    status: 'possible_duplicate',
    confidence: 50,
    matchedId: result.id,
    matchedName: rName,
    matchedDomain: rDomain,
    matchedWebsite: p.website,
    matchedTaxIdentifier: p.nit,
    reason: `HubSpot devolvió coincidencia por búsqueda de nombre pero similitud baja`,
    raw: { id: result.id, domain: rDomain, name: rName },
  };
}

// ============================================================
// checkHubSpotDuplicates — función principal
// ============================================================

export type HubSpotCheckOutcome =
  | { connected: false; skipped: true; matches: []; error?: string }
  | { connected: true; matches: DuplicateMatch[]; error?: string };

/**
 * Verifica duplicados en HubSpot CRM de UBITS.
 *
 * Flujo:
 *   1. Verificar que HubSpot esté conectado
 *   2. Obtener token desde Vault
 *   3. Buscar por dominio (prioritario)
 *   4. Buscar por nombre como fallback
 *
 * Si HubSpot no está conectado: retorna { connected: false, skipped: true }
 * Si falla la API: retorna error en el result
 */
export async function checkHubSpotDuplicates(
  input: DuplicateCheckInput
): Promise<HubSpotCheckOutcome> {
  const isInsufficient =
    !input.name?.trim() && !input.domain && !input.website;

  if (isInsufficient) {
    return { connected: true, matches: [] };
  }

  // Verificar conexión
  const connected = await isHubSpotConnected();
  if (!connected) {
    return { connected: false, skipped: true, matches: [] };
  }

  const token = await getHubSpotToken();
  if (!token) {
    return { connected: false, skipped: true, matches: [], error: 'Token de HubSpot no disponible en Vault' };
  }

  const { domain } = buildCompanySearchTerms(input);

  try {
    const matches: DuplicateMatch[] = [];

    // ── Búsqueda por dominio ──────────────────────────────────
    if (domain) {
      const results = await searchByDomain(token, domain);
      for (const r of results) {
        matches.push(classifyHubSpotResult(r, input, domain));
      }
    }

    // Si encontramos match exacto por dominio, ya no buscamos por nombre
    const hasExactDomainMatch = matches.some(
      (m) => m.status === 'existing_in_hubspot' && m.confidence >= 90
    );

    // ── Búsqueda por nombre (fallback o complemento) ──────────
    if (!hasExactDomainMatch && input.name && input.name.trim().length >= 3) {
      const results = await searchByName(token, input.name.trim());
      for (const r of results) {
        // Evitar duplicar si ya apareció en búsqueda por dominio
        const alreadyFound = matches.some((m) => m.matchedId === r.id);
        if (!alreadyFound) {
          matches.push(classifyHubSpotResult(r, input, domain));
        }
      }
    }

    return { connected: true, matches };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar HubSpot';
    return { connected: true, matches: [], error: msg };
  }
}

// ============================================================
// resolveHubSpotStatus
// ============================================================

export function resolveHubSpotStatus(outcome: HubSpotCheckOutcome): {
  status: import('./types').DuplicateStatus;
  confidence: number;
} {
  if (!outcome.connected) {
    return { status: 'unchecked', confidence: 0 };
  }

  if (outcome.error) {
    return { status: 'error', confidence: 0 };
  }

  const matches = outcome.matches;
  if (matches.length === 0) {
    return { status: 'new_candidate', confidence: 85 };
  }

  const exact = matches.find((m) => m.status === 'existing_in_hubspot');
  if (exact) return { status: 'existing_in_hubspot', confidence: exact.confidence };

  const possible = matches.find((m) => m.status === 'possible_duplicate');
  if (possible) return { status: 'possible_duplicate', confidence: possible.confidence };

  return { status: 'new_candidate', confidence: 80 };
}
