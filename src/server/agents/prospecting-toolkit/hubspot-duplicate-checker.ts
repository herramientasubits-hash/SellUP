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

    const { data: integration } = await admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', INTEGRATION_KEY)
      .single();

    if (!integration?.id) return false;

    // Check credentials are stored and not explicitly disconnected.
    // We do NOT require connection_status='connected' because a stored credential
    // that hasn't been tested (not_tested) or had a transient error is still usable.
    const { data: connection } = await admin
      .from('external_integration_connections')
      .select('connection_status, credentials_status')
      .eq('integration_id', integration.id)
      .eq('credentials_status', 'stored')
      .neq('connection_status', 'disconnected')
      .single();

    return !!connection;
  } catch {
    return false;
  }
}

// ============================================================
// Tipos HubSpot
// ============================================================

interface HubSpotCompanyProperties extends Record<string, unknown> {
  name: string | null;
  domain: string | null;
  website: string | null;
  createdate: string | null;
  hs_lastmodifieddate: string | null;
  lifecyclestage: string | null;
  country: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  address2: string | null;
  zip: string | null;
  industry: string | null;
  numberofemployees: string | null;
  annualrevenue: string | null;
  phone: string | null;
  description: string | null;
  linkedin_company_page: string | null;
  linkedinbio: string | null;
  founded_year: string | null;
  hubspot_owner_id: string | null;
  hs_lead_status: string | null;
  type: string | null;
  macro_industria: string | null;
  pais: string | null;
  ciudad: string | null;
  identificacion_fiscal: string | null;
  nit: string | null;
  rfc: string | null;
  ruc: string | null;
  tax_id: string | null;
  account_executive: string | null;
  licencias_potenciales: string | null;
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

const DESIRED_PROPERTIES = [
  'name',
  'domain',
  'website',
  'createdate',
  'hs_lastmodifieddate',
  'lifecyclestage',
  'country',
  'city',
  'state',
  'address',
  'address2',
  'zip',
  'industry',
  'numberofemployees',
  'annualrevenue',
  'phone',
  'description',
  'linkedin_company_page',
  'linkedinbio',
  'founded_year',
  'hubspot_owner_id',
  'hs_lead_status',
  'type',
  'macro_industria',
  'pais',
  'ciudad',
  'identificacion_fiscal',
  'nit',
  'rfc',
  'ruc',
  'tax_id',
  'account_executive',
  'licencias_potenciales'
];

const MEDIUM_PROPERTIES = [
  'name',
  'domain',
  'website',
  'country',
  'city',
  'industry',
  'lifecyclestage',
  'hs_lead_status',
  'nit'
];

const MINIMAL_PROPERTIES = [
  'name',
  'domain',
  'website',
  'country',
  'city',
  'industry',
  'lifecyclestage',
  'hs_lead_status'
];

// ============================================================
// Helpers de soporte HubSpot
// ============================================================

async function getHubSpotPortalId(): Promise<string | null> {
  try {
    const admin = getAdminClient();
    const { data: integration } = await admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', INTEGRATION_KEY)
      .single();

    if (!integration?.id) return null;

    const { data: connection } = await admin
      .from('external_integration_connections')
      .select('metadata')
      .eq('integration_id', integration.id)
      .single();

    if (connection?.metadata && typeof connection.metadata === 'object') {
      const meta = connection.metadata as Record<string, unknown>;
      const hubId = meta.hub_id || meta.portalId || meta.portal_id;
      if (hubId) return String(hubId);
    }
    return null;
  } catch {
    return null;
  }
}

async function getHubSpotCompanyProperties(
  token: string,
  companyId: string
): Promise<Record<string, unknown> | null> {
  const levels = [DESIRED_PROPERTIES, MEDIUM_PROPERTIES, MINIMAL_PROPERTIES];
  for (const props of levels) {
    try {
      const url = `https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(companyId)}?properties=${props.map(encodeURIComponent).join(',')}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.properties) {
          return data.properties;
        }
      }
    } catch (err) {
      console.warn(`[getHubSpotCompanyProperties] Failed to fetch company properties:`, err);
    }
  }
  return null;
}

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

async function searchByTaxIdentifier(
  token: string,
  taxIdentifier: string
): Promise<HubSpotSearchResult[]> {
  const cleanedTaxId = taxIdentifier.trim();
  if (!cleanedTaxId) return [];

  // Propiedades fiscales posibles
  const possibleProperties = [
    'nit',
    'identificacion_fiscal',
    'rfc',
    'ruc',
    'tax_id',
    'tax_identifier',
    'identificacion_fiscal_nit_rfc_ruc'
  ];

  // Cada filtro va en un filterGroup separado (es decir, OR)
  const filterGroups = possibleProperties.map(prop => ({
    filters: [
      {
        propertyName: prop,
        operator: 'EQ',
        value: cleanedTaxId
      }
    ]
  }));

  const body = {
    filterGroups,
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

  if (res.status === 400) {
    // Fallback con propiedades confirmadas
    const fallbackProps = ['nit', 'identificacion_fiscal'];
    const fallbackFilterGroups = fallbackProps.map(prop => ({
      filters: [
        {
          propertyName: prop,
          operator: 'EQ',
          value: cleanedTaxId
        }
      ]
    }));

    const fallbackBody = {
      filterGroups: fallbackFilterGroups,
      properties: HS_PROPERTIES,
      limit: 5,
    };

    const fallbackRes = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fallbackBody),
    });

    if (!fallbackRes.ok) return [];
    const data = (await fallbackRes.json()) as HubSpotSearchResponse;
    return data.results ?? [];
  }

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
      raw: { id: result.id, domain: rDomain, name: rName, lifecyclestage: p.lifecyclestage, country: p.country, city: p.city, industry: p.industry },
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
        raw: { id: result.id, domain: rDomain, name: rName, lifecyclestage: p.lifecyclestage, country: p.country, city: p.city, industry: p.industry },
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
        raw: { id: result.id, domain: rDomain, name: rName, lifecyclestage: p.lifecyclestage, country: p.country, city: p.city, industry: p.industry },
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
    raw: { id: result.id, domain: rDomain, name: rName, lifecyclestage: p.lifecyclestage, country: p.country, city: p.city, industry: p.industry },
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
    !input.name?.trim() &&
    !input.domain &&
    !input.website &&
    !input.taxIdentifier &&
    !input.taxIdentifierCandidate;

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

    // ── Búsqueda por identificador fiscal (oficial o candidato) ──────
    const taxId = input.taxIdentifier || input.taxIdentifierCandidate;
    if (taxId && taxId.trim().length >= 4) {
      const results = await searchByTaxIdentifier(token, taxId);
      for (const r of results) {
        const alreadyFound = matches.some((m) => m.matchedId === r.id);
        if (!alreadyFound) {
          if (!input.taxIdentifier && input.taxIdentifierCandidate) {
            const rDomain = r.properties.domain?.toLowerCase().trim() ?? null;
            const rName = r.properties.name ?? null;
            matches.push({
              source: 'hubspot',
              status: 'possible_duplicate',
              confidence: 85,
              matchedId: r.id,
              matchedName: rName,
              matchedDomain: rDomain,
              matchedWebsite: r.properties.website,
              matchedTaxIdentifier: r.properties.nit || r.properties.identificacion_fiscal || r.properties.tax_id || r.properties.rfc || r.properties.ruc,
              reason: `Coincidencia por NIT candidato en HubSpot: ${taxId}`,
              raw: {
                ...r.properties,
                tax_identifier_candidate_used: taxId,
                source: 'hubspot_tax_identifier_candidate',
                requires_human_review: true,
                matched_by: 'tax_identifier_candidate'
              }
            });
          } else {
            const rDomain = r.properties.domain?.toLowerCase().trim() ?? null;
            const rName = r.properties.name ?? null;
            matches.push({
              source: 'hubspot',
              status: 'existing_in_hubspot',
              confidence: 95,
              matchedId: r.id,
              matchedName: rName,
              matchedDomain: rDomain,
              matchedWebsite: r.properties.website,
              matchedTaxIdentifier: r.properties.nit || r.properties.identificacion_fiscal || r.properties.tax_id || r.properties.rfc || r.properties.ruc,
              reason: `Identificador fiscal exacto coincide en HubSpot: ${taxId}`,
              raw: r.properties,
            });
          }
        }
      }
    }

    const hasExactTaxMatch = matches.some(
      (m) => m.status === 'existing_in_hubspot' && m.confidence >= 90
    );

    // ── Búsqueda por dominio ──────────────────────────────────
    if (!hasExactTaxMatch && domain) {
      const results = await searchByDomain(token, domain);
      for (const r of results) {
        const alreadyFound = matches.some((m) => m.matchedId === r.id);
        if (!alreadyFound) {
          matches.push(classifyHubSpotResult(r, input, domain));
        }
      }
    }

    // Si encontramos match exacto por dominio o taxId, ya no buscamos por nombre
    const hasExactMatch = matches.some(
      (m) => m.status === 'existing_in_hubspot' && m.confidence >= 90
    );

    // ── Búsqueda por nombre (fallback o complemento) ──────────
    if (!hasExactMatch && input.name && input.name.trim().length >= 3) {
      const results = await searchByName(token, input.name.trim());
      for (const r of results) {
        // Evitar duplicar si ya apareció en búsqueda por dominio
        const alreadyFound = matches.some((m) => m.matchedId === r.id);
        if (!alreadyFound) {
          matches.push(classifyHubSpotResult(r, input, domain));
        }
      }
    }

    // ── Enriquecer matches con consulta secundaria por companyId ──
    const portalId = await getHubSpotPortalId();
    for (const match of matches) {
      if (match.matchedId && (match.status === 'existing_in_hubspot' || match.status === 'possible_duplicate')) {
        const fullProps = await getHubSpotCompanyProperties(token, match.matchedId);
        const hubspotUrl = portalId && match.matchedId ? `https://app.hubspot.com/contacts/${portalId}/company/${match.matchedId}` : null;
        
        match.raw = {
          id: match.matchedId,
          hubspot_url: hubspotUrl,
          ...(fullProps || {})
        };

        if (fullProps) {
          if (typeof fullProps.domain === 'string') match.matchedDomain = fullProps.domain;
          if (typeof fullProps.website === 'string' && !match.matchedWebsite) {
            match.matchedWebsite = fullProps.website;
          }
          const taxId = fullProps.nit || fullProps.identificacion_fiscal || fullProps.tax_id || fullProps.rfc || fullProps.ruc;
          if (typeof taxId === 'string') match.matchedTaxIdentifier = taxId;
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
