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
  /** Apollo canonical domain — more reliable than extracting from website_url. May be absent on older plan responses. */
  primary_domain?: string | null;
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
  /** SEO-optimized description — supplements short_description for sector signal. May be absent on older plan responses. */
  seo_description?: string | null;
  keywords: string[];
  /**
   * L2.14: Alternative multi-value industry array — Apollo may return this instead of
   * or alongside the scalar `industry` field depending on plan/endpoint version.
   */
  industries?: string[] | null;
  /**
   * L2.14: Alternative keyword array name observed in some Apollo plan responses.
   * Redundant with `keywords` on most plans; capture both to avoid evidence loss.
   */
  organization_keywords?: string[] | null;
  /**
   * L2.14: Full-length description — longer than short_description, may be absent on
   * basic plan responses. Provides richer sector signal than the 200-char short form.
   */
  description?: string | null;
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
  // Campos opcionales adicionales que devuelve mixed_people/api_search.
  // Aditivos: no afectan a los consumidores existentes.
  seniority?: string | null;
  departments?: string[];
  subdepartments?: string[];
  headline?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  email_status?: string | null;
}

// ============================================================
// Parámetros de búsqueda y enriquecimiento
// ============================================================

export interface SearchOrganizationsParams {
  q_organization_name?: string;
  q_organization_domains?: string[];
  /**
   * @deprecated Para Organization Search usar q_organization_keyword_tags (L2.11).
   * Apollo ignora silenciosamente q_keywords en /mixed_companies/search.
   * Mantener en la interfaz para compatibilidad con otros endpoints si aplica.
   */
  q_keywords?: string;
  /**
   * L2.11: Parámetro documentado de Apollo para filtrar empresas por etiquetas de keywords.
   * Reemplaza q_keywords en Organization Search (/mixed_companies/search).
   * Apollo indexa las keywords de empresa bajo este campo, no bajo q_keywords.
   */
  q_organization_keyword_tags?: string[];
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
  q_organization_domains?: string[];
  /**
   * IDs de organización de Apollo (resueltos vía Organization Search).
   * Es el filtro de organización más fiable: cuando se conoce el id real,
   * Apollo lo prioriza sobre el dominio (que puede no matchear empresas grandes).
   */
  organization_ids?: string[];
  person_titles?: string[];
  person_seniorities?: string[];
  person_department_or_subdepartments?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  page?: number;
  per_page?: number;
}

export interface MatchPersonParams {
  /** Apollo person ID — identificador más fuerte; garantiza match al perfil exacto del people_search. */
  id?: string;
  first_name?: string;
  last_name?: string;
  organization_name?: string;
  email?: string;
  linkedin_url?: string;
  domain?: string;
  /** Revelar email personal. Sin este flag Apollo devuelve email: null aunque la persona exista. */
  reveal_personal_emails?: boolean;
  /** Revelar teléfono. No activar: phone reveal está desactivado por política del plan. */
  reveal_phone_number?: boolean;
  /**
   * URL pública de webhook para el reveal de teléfono ASÍNCRONO de Apollo.
   * Contrato confirmado: cuando `reveal_phone_number` es true, Apollo EXIGE
   * `webhook_url` (sin él responde HTTP 422) y entrega los teléfonos más tarde
   * por callback a esta URL; la respuesta inmediata solo trae un `request_id`.
   * Se fija únicamente en el helper de reveal (apollo-phone-reveal.ts).
   */
  webhook_url?: string;
}

/**
 * Respuesta inmediata (síncrona) de un reveal de teléfono ASÍNCRONO. No trae
 * teléfonos: solo el id de correlación con el que Apollo luego llama al webhook
 * y con el que se puede consultar el resultado. Apollo no documenta un nombre
 * único para este id, así que se aceptan las variantes observadas.
 */
export interface ApolloPhoneRevealStartResponse {
  request_id?: string | null;
  /** Variante alterna observada del id de correlación. */
  async_task_id?: string | null;
  /** Variante alterna observada del id de correlación. */
  id?: string | null;
}

export interface ApolloPhoneRevealStartResult {
  success: boolean;
  /** Id de correlación normalizado (request_id ?? async_task_id ?? id). */
  requestId?: string | null;
  error?: ApolloApiError;
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

// ============================================================
// Inicio de reveal de teléfono ASÍNCRONO
// POST https://api.apollo.io/api/v1/people/match  (con webhook_url)
//
// NOTA: Consume créditos del plan Apollo. El teléfono NO llega aquí: la
// respuesta inmediata solo trae el id de correlación (request_id). Apollo
// entrega los teléfonos más tarde por callback al webhook_url. Sin webhook_url
// (cuando reveal_phone_number es true) Apollo responde HTTP 422.
//
// Esta función NO lee teléfonos de la respuesta: devuelve solo el requestId,
// nunca dato personal. El reveal real sigue gated por ENABLE_APOLLO_PHONE_REVEAL.
// ============================================================

export async function startApolloPhoneReveal(
  params: MatchPersonParams
): Promise<ApolloPhoneRevealStartResult> {
  const result = await apolloFetch<ApolloPhoneRevealStartResponse>(
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
        message: result.errorBody ?? 'Error al iniciar el reveal de teléfono',
        statusCode: result.status,
      },
    };
  }

  const requestId =
    result.data?.request_id ??
    result.data?.async_task_id ??
    result.data?.id ??
    null;

  return {
    success: true,
    requestId: typeof requestId === 'string' ? requestId : null,
  };
}
