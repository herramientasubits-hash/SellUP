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
// Contact Search V3 — Agente 2A · 17B.4C
// POST https://api.lusha.com/v3/contacts/search
//
// BÚSQUEDA PREVIEW SIN REVEAL. No devuelve emails ni teléfonos.
// No crea candidatos. No inserta provider_usage_logs.
// No usar enrich ni search-and-enrich en este endpoint.
// ============================================================

export type LushaContactSearchRequest = {
  contacts: Array<{
    firstName?: string;
    lastName?: string;
    fullName?: string;
    linkedinUrl?: string;
    email?: string;
    companyName?: string;
    companyDomain?: string;
  }>;
  signals?: string[];
};

export type LushaContactSearchResult = {
  ok: boolean;
  status:
    | 'success'
    | 'no_results'
    | 'provider_auth_error'
    | 'insufficient_credits'
    | 'feature_unavailable'
    | 'rate_limited'
    | 'compliance_blocked'
    | 'provider_error'
    | 'provider_timeout';
  httpStatus?: number;
  requestId?: string | null;
  rateLimit?: Record<string, string | null>;
  resultsReturned: number;
  creditsCharged?: number | null;
  rawShape?: Record<string, unknown>;
  sanitizedResults?: Array<{
    id: string | null;
    fullName: string | null;
    title: string | null;
    companyName: string | null;
    companyDomain: string | null;
    linkedinUrl: string | null;
    has: unknown;
    canReveal: unknown;
  }>;
  errorMessage?: string;
};

export async function searchLushaContactsV3(input: {
  apiKey: string;
  timeoutMs: number;
  contacts: Array<{
    firstName?: string;
    lastName?: string;
    fullName?: string;
    linkedinUrl?: string;
    email?: string;
    companyName?: string;
    companyDomain?: string;
  }>;
}): Promise<LushaContactSearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const body: LushaContactSearchRequest = {
      contacts: input.contacts,
    };

    const response = await fetch(`${LUSHA_BASE_URL}/v3/contacts/search`, {
      method: 'POST',
      headers: {
        'api_key': input.apiKey.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const rateLimit: Record<string, string | null> = {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: response.headers.get('x-ratelimit-reset'),
    };
    const requestId = response.headers.get('x-request-id');

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: mapLushaHttpError(response.status),
        httpStatus: response.status,
        resultsReturned: 0,
        rateLimit,
        requestId,
        errorMessage: errorBody.slice(0, 300) || undefined,
      };
    }

    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;

    const contacts = Array.isArray(raw['contacts'])
      ? (raw['contacts'] as Record<string, unknown>[])
      : Array.isArray(raw['data'])
        ? (raw['data'] as Record<string, unknown>[])
        : [];

    if (contacts.length === 0) {
      return {
        ok: true,
        status: 'no_results',
        httpStatus: response.status,
        resultsReturned: 0,
        creditsCharged: typeof raw['creditsCharged'] === 'number' ? raw['creditsCharged'] : null,
        rawShape: buildRawShape(raw),
        rateLimit,
        requestId,
      };
    }

    const sanitizedResults = contacts.map((c) => ({
      id: typeof c['id'] === 'string' ? c['id'] : null,
      fullName: pickString(c, ['fullName', 'name', 'full_name']) ?? null,
      title: pickString(c, ['title', 'jobTitle', 'job_title']) ?? null,
      companyName: pickString(c, ['companyName', 'company_name', 'company']) ?? null,
      companyDomain: pickString(c, ['companyDomain', 'company_domain', 'domain']) ?? null,
      linkedinUrl: pickString(c, ['linkedinUrl', 'linkedin_url', 'linkedin']) ?? null,
      has: c['has'] ?? null,
      canReveal: c['canReveal'] ?? null,
      // emails and phones deliberately omitted
    }));

    return {
      ok: true,
      status: 'success',
      httpStatus: response.status,
      resultsReturned: sanitizedResults.length,
      creditsCharged: typeof raw['creditsCharged'] === 'number' ? raw['creditsCharged'] : null,
      rawShape: buildRawShape(raw),
      sanitizedResults,
      rateLimit,
      requestId,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: isTimeout ? 'provider_timeout' : 'provider_error',
      resultsReturned: 0,
      errorMessage: isTimeout
        ? 'Request timed out'
        : err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k]) return obj[k] as string;
  }
  return undefined;
}

function buildRawShape(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(raw).map((k) => [k, typeof raw[k]])
  );
}

// ============================================================
// Account Usage — health check seguro (Agente 2A · 17B.4A)
// GET https://api.lusha.com/v3/account/usage
//
// No consume créditos. No busca personas. No revela emails/teléfonos.
// Usado exclusivamente para diagnóstico y health check de cuenta.
// ============================================================

export type LushaAccountUsageResult = {
  ok: boolean;
  status: 'success' | 'provider_auth_error' | 'insufficient_credits' | 'feature_unavailable' | 'rate_limited' | 'compliance_blocked' | 'provider_error' | 'provider_timeout';
  httpStatus?: number;
  usage?: unknown;
  billing?: unknown;
  rateLimit?: Record<string, string | null>;
  requestId?: string | null;
  errorMessage?: string;
};

export async function getLushaAccountUsage(input: {
  apiKey: string;
  timeoutMs: number;
}): Promise<LushaAccountUsageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(`${LUSHA_BASE_URL}/v3/account/usage`, {
      method: 'GET',
      headers: { 'api_key': input.apiKey.trim() },
      signal: controller.signal,
    });

    clearTimeout(timer);

    const rateLimit: Record<string, string | null> = {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: response.headers.get('x-ratelimit-reset'),
    };
    const requestId = response.headers.get('x-request-id');

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: mapLushaHttpError(response.status),
        httpStatus: response.status,
        rateLimit,
        requestId,
        errorMessage: errorBody.slice(0, 300) || undefined,
      };
    }

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;

    return {
      ok: true,
      status: 'success',
      httpStatus: response.status,
      usage: body['usage'] ?? body,
      billing: body['billing'] ?? undefined,
      rateLimit,
      requestId,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: isTimeout ? 'provider_timeout' : 'provider_error',
      errorMessage: isTimeout ? 'Request timed out' : (err instanceof Error ? err.message : 'Unknown error'),
    };
  }
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
