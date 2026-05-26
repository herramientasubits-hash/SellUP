/**
 * Apollo.io API Client
 *
 * Capa de integración con la API de Apollo.io.
 * Todos los métodos requieren que la API Key esté configurada en Vault.
 *
 * IMPORTANTE: Los métodos de búsqueda y enriquecimiento pueden consumir
 * créditos del plan de Apollo. Verificar límites antes de invocar en producción.
 *
 * People Search (mixed_people/api_search) puede requerir una Master Key
 * según el plan configurado en Apollo.
 *
 * Estado de implementación:
 *   ✅ testApolloHealth        — Activo. No consume créditos.
 *   🔜 searchOrganizations     — Preparado. Consume créditos.
 *   🔜 enrichOrganization      — Preparado. Consume créditos.
 *   🔜 searchPeople            — Preparado. Puede requerir Master Key.
 *   🔜 matchPerson             — Preparado. Consume créditos.
 */

import { getApolloApiKey } from '@/server/services/apollo-connection';

const APOLLO_BASE_URL = 'https://api.apollo.io';

// ============================================================
// Tipos base
// ============================================================

export interface ApolloApiError {
  error: string;
  message: string;
  statusCode?: number;
}

export interface ApolloOrganization {
  id: string;
  name: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  industry: string | null;
  industry_tag_ids: string[];
  employee_count: number | null;
  estimated_num_employees: number | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  annual_revenue: number | null;
  technologies: string[];
  short_description: string | null;
  keywords: string[];
}

export interface ApolloPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  phone_numbers: { sanitized_number: string; type: string }[];
  organization: Pick<ApolloOrganization, 'id' | 'name' | 'website_url'> | null;
}

// ============================================================
// Parámetros de búsqueda y enriquecimiento
// ============================================================

export interface SearchOrganizationsParams {
  q_organization_name?: string;
  q_organization_domains?: string[];
  q_keywords?: string;
  organization_industry_tag_ids?: string[];
  organization_num_employees_ranges?: string[];
  organization_locations?: string[];
  per_page?: number;
  page?: number;
}

export interface EnrichOrganizationParams {
  domain: string;
  name?: string;
}

export interface SearchPeopleParams {
  q_person_name?: string;
  q_organization_name?: string;
  person_titles?: string[];
  page?: number;
  per_page?: number;
}

export interface MatchPersonParams {
  first_name?: string;
  last_name?: string;
  organization_name?: string;
  email?: string;
  linkedin_url?: string;
  domain?: string;
}

export interface ApolloSearchResult<T> {
  success: boolean;
  data?: T[];
  total?: number;
  page?: number;
  per_page?: number;
  error?: ApolloApiError;
}

export interface ApolloEnrichResult<T> {
  success: boolean;
  data?: T;
  error?: ApolloApiError;
}

// ============================================================
// Helper interno de fetch autenticado
// ============================================================

async function apolloFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: T; status: number; errorBody?: string }> {
  const apiKey = await getApolloApiKey();

  if (!apiKey) {
    return { ok: false, status: 401, errorBody: 'No API key configured' };
  }

  const response = await fetch(`${APOLLO_BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const status = response.status;

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    return { ok: false, status, errorBody: errorBody.slice(0, 500) };
  }

  const data = await response.json().catch(() => undefined) as T;
  return { ok: true, data, status };
}

// ============================================================
// Búsqueda de empresas
// POST https://api.apollo.io/api/v1/mixed_companies/search
//
// NOTA: Consume créditos del plan Apollo según configuración.
// No activar en UI ni flujos automáticos sin verificar límites.
// ============================================================

export async function searchApolloOrganizations(
  params: SearchOrganizationsParams
): Promise<ApolloSearchResult<ApolloOrganization>> {
  const result = await apolloFetch<{
    // Apollo returns results in `accounts` for basic plans; `organizations` is empty
    accounts?: ApolloOrganization[];
    organizations?: ApolloOrganization[];
    pagination?: { total_entries: number; page: number; per_page: number };
  }>('/api/v1/mixed_companies/search', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  if (!result.ok) {
    return {
      success: false,
      error: {
        error: `HTTP_${result.status}`,
        message: result.errorBody ?? 'Error en búsqueda de empresas',
        statusCode: result.status,
      },
    };
  }

  return {
    success: true,
    data: result.data?.accounts ?? result.data?.organizations ?? [],
    total: result.data?.pagination?.total_entries,
    page: result.data?.pagination?.page,
    per_page: result.data?.pagination?.per_page,
  };
}

// ============================================================
// Enriquecimiento de empresa
// GET https://api.apollo.io/api/v1/organizations/enrich
//
// NOTA: Consume créditos del plan Apollo.
// ============================================================

export async function enrichApolloOrganization(
  params: EnrichOrganizationParams
): Promise<ApolloEnrichResult<ApolloOrganization>> {
  const qs = new URLSearchParams();
  qs.set('domain', params.domain);
  if (params.name) qs.set('name', params.name);

  const result = await apolloFetch<{ organization?: ApolloOrganization }>(
    `/api/v1/organizations/enrich?${qs.toString()}`,
    { method: 'GET' }
  );

  if (!result.ok) {
    return {
      success: false,
      error: {
        error: `HTTP_${result.status}`,
        message: result.errorBody ?? 'Error en enriquecimiento de empresa',
        statusCode: result.status,
      },
    };
  }

  return {
    success: true,
    data: result.data?.organization,
  };
}

// ============================================================
// Búsqueda de personas
// POST https://api.apollo.io/api/v1/mixed_people/api_search
//
// NOTA: Puede requerir Master Key según plan de Apollo.
// Consume créditos del plan. Verificar permisos antes de activar.
// ============================================================

export async function searchApolloPeople(
  params: SearchPeopleParams
): Promise<ApolloSearchResult<ApolloPerson>> {
  const result = await apolloFetch<{
    people?: ApolloPerson[];
    pagination?: { total_entries: number; page: number; per_page: number };
  }>('/api/v1/mixed_people/api_search', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  if (!result.ok) {
    return {
      success: false,
      error: {
        error: `HTTP_${result.status}`,
        message: result.errorBody ?? 'Error en búsqueda de personas',
        statusCode: result.status,
      },
    };
  }

  return {
    success: true,
    data: result.data?.people ?? [],
    total: result.data?.pagination?.total_entries,
    page: result.data?.pagination?.page,
    per_page: result.data?.pagination?.per_page,
  };
}

// ============================================================
// Enriquecimiento de persona
// POST https://api.apollo.io/api/v1/people/match
//
// NOTA: Consume créditos del plan Apollo.
// ============================================================

export async function matchApolloPerson(
  params: MatchPersonParams
): Promise<ApolloEnrichResult<ApolloPerson>> {
  const result = await apolloFetch<{ person?: ApolloPerson }>(
    '/api/v1/people/match',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );

  if (!result.ok) {
    return {
      success: false,
      error: {
        error: `HTTP_${result.status}`,
        message: result.errorBody ?? 'Error en enriquecimiento de persona',
        statusCode: result.status,
      },
    };
  }

  return {
    success: true,
    data: result.data?.person,
  };
}
