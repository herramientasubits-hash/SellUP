/**
 * Lusha API Client
 *
 * Capa de integración con la API de Lusha.
 * Todos los métodos requieren que la API Key esté configurada en Vault.
 *
 * Autenticación oficial: header "api_key: {value}"
 * Base URL: https://api.lusha.com
 *
 * IMPORTANTE: Los métodos de enriquecimiento y prospección consumen
 * créditos del plan de Lusha. Verificar límites antes de invocar en producción.
 *
 * Estado de implementación:
 *   ✅ testLushaHealth         — Activo. No consume créditos de enriquecimiento.
 *   🔜 enrichLushaPerson       — Preparado. Consume créditos.
 *   🔜 enrichLushaCompany      — Preparado. Consume créditos.
 *   🔜 searchLushaPeople       — Preparado. Consume créditos (plan Prospecting).
 *   🔜 searchLushaCompanies    — Preparado. Consume créditos (plan Prospecting).
 */

import { getLushaApiKey } from '@/server/services/lusha-connection';

const LUSHA_BASE_URL = 'https://api.lusha.com';

// ============================================================
// Error codes — mapeados desde HTTP status de Lusha
// ============================================================

export type LushaApiErrorCode =
  | 'provider_auth_error'
  | 'insufficient_credits'
  | 'feature_unavailable'
  | 'rate_limited'
  | 'compliance_blocked'
  | 'provider_error'
  | 'provider_timeout';

export function mapLushaHttpError(status: number): LushaApiErrorCode {
  if (status === 401) return 'provider_auth_error';
  if (status === 402) return 'insufficient_credits';
  if (status === 403) return 'feature_unavailable';
  if (status === 429) return 'rate_limited';
  if (status === 451) return 'compliance_blocked';
  return 'provider_error';
}

// ============================================================
// Tipos base
// ============================================================

export interface LushaApiError {
  error: string;
  message: string;
  statusCode?: number;
}

export interface LushaPerson {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  emails?: { email: string; emailType?: string }[];
  phoneNumbers?: { localizedNumber?: string; countryCode?: string; type?: string }[];
  linkedinUrl?: string | null;
  company?: LushaCompany | null;
}

export interface LushaCompany {
  id?: string;
  name?: string | null;
  domain?: string | null;
  linkedinUrl?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  country?: string | null;
  city?: string | null;
  phone?: string | null;
}

export interface LushaEnrichResult<T> {
  success: boolean;
  data?: T;
  error?: LushaApiError;
}

export interface LushaSearchResult<T> {
  success: boolean;
  data?: T[];
  total?: number;
  error?: LushaApiError;
}

// ============================================================
// Parámetros de enriquecimiento y búsqueda
// ============================================================

export interface EnrichLushaPersonParams {
  firstName?: string;
  lastName?: string;
  company?: string;
  linkedinUrl?: string;
  emailAddress?: string;
}

export interface EnrichLushaCompanyParams {
  domain?: string;
  name?: string;
}

export interface SearchLushaPeopleParams {
  jobTitle?: string[];
  company?: string;
  country?: string;
  department?: string;
  limit?: number;
}

export interface SearchLushaCompaniesParams {
  name?: string;
  domain?: string;
  industry?: string;
  country?: string;
  minEmployees?: number;
  maxEmployees?: number;
  limit?: number;
}

// ============================================================
// Helper interno de fetch autenticado
// ============================================================

async function lushaFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: T; status: number; errorBody?: string }> {
  const apiKey = await getLushaApiKey();

  if (!apiKey) {
    return { ok: false, status: 401, errorBody: 'No API key configured' };
  }

  const isPost = options.method === 'POST';
  const response = await fetch(`${LUSHA_BASE_URL}${path}`, {
    ...options,
    headers: {
      'api_key': apiKey.trim(),
      ...(isPost ? { 'Content-Type': 'application/json' } : {}),
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
// Enriquecimiento de persona
// GET https://api.lusha.com/person
//
// NOTA: Consume créditos del plan Lusha según configuración.
// No activar en UI ni flujos automáticos sin verificar límites.
// ============================================================

export async function enrichLushaPerson(
  params: EnrichLushaPersonParams
): Promise<LushaEnrichResult<LushaPerson>> {
  const qs = new URLSearchParams();
  if (params.firstName) qs.set('firstName', params.firstName);
  if (params.lastName) qs.set('lastName', params.lastName);
  if (params.company) qs.set('company', params.company);
  if (params.linkedinUrl) qs.set('linkedinUrl', params.linkedinUrl);
  if (params.emailAddress) qs.set('emailAddress', params.emailAddress);

  const result = await lushaFetch<LushaPerson>(`/person?${qs.toString()}`, {
    method: 'GET',
  });

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

  return { success: true, data: result.data };
}

// ============================================================
// Enriquecimiento de empresa
// GET https://api.lusha.com/company
//
// NOTA: Consume créditos del plan Lusha.
// ============================================================

export async function enrichLushaCompany(
  params: EnrichLushaCompanyParams
): Promise<LushaEnrichResult<LushaCompany>> {
  const qs = new URLSearchParams();
  if (params.domain) qs.set('domain', params.domain);
  if (params.name) qs.set('name', params.name);

  const result = await lushaFetch<LushaCompany>(`/v2/company?${qs.toString()}`, {
    method: 'GET',
  });

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

  return { success: true, data: result.data };
}

// ============================================================
// Búsqueda de personas (Prospecting API)
// POST https://api.lusha.com/prospecting/search/contacts
//
// NOTA: Requiere plan de Prospecting en Lusha. Consume créditos.
// Verificar plan y permisos antes de activar.
// ============================================================

export async function searchLushaPeople(
  params: SearchLushaPeopleParams
): Promise<LushaSearchResult<LushaPerson>> {
  const result = await lushaFetch<{ contacts?: LushaPerson[]; total?: number }>(
    '/prospecting/search/contacts',
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
        message: result.errorBody ?? 'Error en búsqueda de personas',
        statusCode: result.status,
      },
    };
  }

  return {
    success: true,
    data: result.data?.contacts ?? [],
    total: result.data?.total,
  };
}

// ============================================================
// Búsqueda de empresas (Prospecting API)
// POST https://api.lusha.com/prospecting/search/companies
//
// NOTA: Requiere plan de Prospecting en Lusha. Consume créditos.
// ============================================================

export async function searchLushaCompanies(
  params: SearchLushaCompaniesParams
): Promise<LushaSearchResult<LushaCompany>> {
  const result = await lushaFetch<{ companies?: LushaCompany[]; total?: number }>(
    '/prospecting/search/companies',
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
        message: result.errorBody ?? 'Error en búsqueda de empresas',
        statusCode: result.status,
      },
    };
  }

  return {
    success: true,
    data: result.data?.companies ?? [],
    total: result.data?.total,
  };
}
