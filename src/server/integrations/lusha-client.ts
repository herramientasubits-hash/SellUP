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
    const headerRequestId = response.headers.get('x-request-id');

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: mapLushaHttpError(response.status),
        httpStatus: response.status,
        resultsReturned: 0,
        rateLimit,
        requestId: headerRequestId,
        errorMessage: errorBody.slice(0, 300) || undefined,
      };
    }

    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;

    // Lusha V3 real response uses "results" key (confirmed 17B.4C live test)
    const contacts = Array.isArray(raw['results'])
      ? (raw['results'] as Record<string, unknown>[])
      : Array.isArray(raw['contacts'])
        ? (raw['contacts'] as Record<string, unknown>[])
        : Array.isArray(raw['data'])
          ? (raw['data'] as Record<string, unknown>[])
          : [];

    // requestId may come in body (Lusha V3) or header
    const requestId =
      typeof raw['requestId'] === 'string' ? raw['requestId'] : headerRequestId;

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
// Contact Enrich V3 — Agente 2A · 17B.4E
// POST https://api.lusha.com/v3/contacts/enrich
//
// REVEAL EMAIL CONTROLADO. Solo emails. Nunca phones.
// reveal: ["emails"] es obligatorio y nunca puede estar vacío.
// No crea candidatos. No inserta provider_usage_logs.
// No usa search-and-enrich. El ID viene del search previo (17B.4D).
// ============================================================

// Note: /v3/contacts/enrich uses "ids" (not "contacts") — confirmed live 17B.4E
export type LushaContactEnrichRequest = {
  ids: Array<string>;
  reveal: Array<'emails'>;
};

export type LushaContactEnrichResult = {
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
  billingShape?: Record<string, string> | null;
  rawShape?: Record<string, unknown>;
  sanitizedResults?: Array<{
    id: string | null;
    hasEmail: boolean;
    emailType?: string | null;
    emailDomain?: string | null;
    hasPhone: false;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    title?: string | null;
    companyName?: string | null;
    companyDomain?: string | null;
    linkedinUrl?: string | null;
    availableFields?: unknown;
    /** For DB storage only. NEVER log or expose in reports. */
    internalEmail?: string | null;
  }>;
  errorMessage?: string;
};

function extractEmailDomain(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;
  const at = email.indexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase() || null;
}

// ============================================================
// Helpers puros para estructuras anidadas de Lusha V3 — 17B.4F
// ============================================================

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNestedString(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = readString(o[k]);
    if (v) return v;
  }
  return null;
}

export function extractLushaJobTitle(value: unknown): string | null {
  const flat = readString(value);
  if (flat) return flat;
  return readNestedString(value, ['title', 'name', 'value']);
}

export function extractLushaCompanyName(value: unknown): string | null {
  const flat = readString(value);
  if (flat) return flat;
  return readNestedString(value, ['name', 'companyName']);
}

export function extractLushaCompanyDomain(value: unknown): string | null {
  const flat = readString(value);
  if (flat) return flat;
  return readNestedString(value, ['domain', 'companyDomain', 'website']);
}

export function extractLushaLinkedinUrl(c: Record<string, unknown>): string | null {
  const direct = pickString(c, ['linkedinUrl', 'linkedin_url', 'linkedin']);
  if (direct) return direct;

  const sl = c['socialLinks'];
  if (sl && typeof sl === 'object' && !Array.isArray(sl)) {
    const slObj = sl as Record<string, unknown>;
    const fromObj = pickString(slObj, ['linkedin', 'linkedinUrl', 'linkedin_url']);
    if (fromObj) return fromObj;
  }

  if (Array.isArray(sl)) {
    for (const item of sl as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const type = readString(entry['type'])?.toLowerCase();
      if (type === 'linkedin') {
        const url = readString(entry['url']) ?? readString(entry['value']);
        if (url) return url;
      }
    }
  }

  return null;
}

export function extractEmailInfoFromLushaEmails(value: unknown): {
  hasEmail: boolean;
  emailType: string | null;
  emailDomain: string | null;
} {
  const emails = Array.isArray(value) ? (value as unknown[]) : [];
  if (emails.length === 0) return { hasEmail: false, emailType: null, emailDomain: null };

  const first = emails[0];
  if (!first || typeof first !== 'object') return { hasEmail: false, emailType: null, emailDomain: null };

  const entry = first as Record<string, unknown>;
  const emailStr = readString(entry['email']) ?? readString(entry['emailAddress']);
  if (!emailStr) return { hasEmail: false, emailType: null, emailDomain: null };

  const emailType = readString(entry['type']) ?? readString(entry['emailType']);
  return { hasEmail: true, emailType, emailDomain: extractEmailDomain(emailStr) };
}

export function extractLushaBilling(value: unknown): {
  creditsCharged: number | null;
  billingShape: Record<string, string> | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { creditsCharged: null, billingShape: null };
  }

  const b = value as Record<string, unknown>;

  let charged: number | null = null;
  if (typeof b['creditsCharged'] === 'number') {
    charged = b['creditsCharged'];
  } else if (typeof b['credits'] === 'number') {
    charged = b['credits'];
  } else if (b['cost'] && typeof b['cost'] === 'object') {
    const cost = b['cost'] as Record<string, unknown>;
    if (typeof cost['credits'] === 'number') charged = cost['credits'];
  } else if (b['reveals'] && typeof b['reveals'] === 'object') {
    const rev = b['reveals'] as Record<string, unknown>;
    if (rev['email'] && typeof rev['email'] === 'object') {
      const emailRev = rev['email'] as Record<string, unknown>;
      if (typeof emailRev['credits'] === 'number') charged = emailRev['credits'];
    }
  }

  const billingShape = Object.fromEntries(
    Object.keys(b).map(k => [k, typeof b[k]])
  ) as Record<string, string>;

  return { creditsCharged: charged, billingShape };
}

function extractLushaEnrichContacts(raw: Record<string, unknown>): Record<string, unknown>[] {
  // results as array (live confirmed 17B.4E)
  if (Array.isArray(raw['results'])) {
    return raw['results'] as Record<string, unknown>[];
  }
  // results as object with contacts key (per spec mock 17B.4F)
  if (raw['results'] && typeof raw['results'] === 'object') {
    const resultsObj = raw['results'] as Record<string, unknown>;
    if (Array.isArray(resultsObj['contacts'])) {
      return resultsObj['contacts'] as Record<string, unknown>[];
    }
  }
  if (Array.isArray(raw['contacts'])) return raw['contacts'] as Record<string, unknown>[];
  if (Array.isArray(raw['data'])) return raw['data'] as Record<string, unknown>[];
  return [];
}

function extractTopLevelCreditsCharged(raw: Record<string, unknown>): number | null {
  if (typeof raw['creditsCharged'] === 'number') return raw['creditsCharged'];
  const { creditsCharged } = extractLushaBilling(raw['billing']);
  return creditsCharged;
}

export async function enrichLushaContactsV3(input: {
  apiKey: string;
  timeoutMs: number;
  contacts: Array<{ id: string }>;
  reveal: Array<'emails'>;
}): Promise<LushaContactEnrichResult> {
  // Guardrails — rechazar antes de llamar API
  if (input.reveal.length === 0) {
    return { ok: false, status: 'provider_error', resultsReturned: 0, errorMessage: 'reveal must not be empty' };
  }
  if ((input.reveal as string[]).includes('phones')) {
    return { ok: false, status: 'provider_error', resultsReturned: 0, errorMessage: 'reveal must not include phones' };
  }
  if (input.contacts.length !== 1) {
    return { ok: false, status: 'provider_error', resultsReturned: 0, errorMessage: 'exactly 1 contact required for this operation' };
  }
  const ids = input.contacts.map(c => c.id);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const body: LushaContactEnrichRequest = {
      ids,
      reveal: input.reveal,
    };

    const response = await fetch(`${LUSHA_BASE_URL}/v3/contacts/enrich`, {
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
    const headerRequestId = response.headers.get('x-request-id');

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: mapLushaHttpError(response.status),
        httpStatus: response.status,
        resultsReturned: 0,
        rateLimit,
        requestId: headerRequestId,
        errorMessage: errorBody.slice(0, 300) || undefined,
      };
    }

    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;

    const contacts = extractLushaEnrichContacts(raw);

    const requestId =
      typeof raw['requestId'] === 'string' ? raw['requestId'] : headerRequestId;

    const creditsCharged = extractTopLevelCreditsCharged(raw);
    const { billingShape } = extractLushaBilling(raw['billing']);

    if (contacts.length === 0) {
      return {
        ok: true,
        status: 'no_results',
        httpStatus: response.status,
        resultsReturned: 0,
        creditsCharged,
        billingShape,
        rawShape: buildRawShape(raw),
        rateLimit,
        requestId,
      };
    }

    const sanitizedResults = contacts.map((c) => {
      const emails = Array.isArray(c['emails']) ? (c['emails'] as unknown[]) : [];
      const { hasEmail, emailType, emailDomain } = extractEmailInfoFromLushaEmails(emails);

      // Extract actual email for DB storage only — NEVER log or print
      let internalEmail: string | null = null;
      if (emails.length > 0) {
        const first = emails[0];
        if (first && typeof first === 'object') {
          const entry = first as Record<string, unknown>;
          const emailStr =
            (typeof entry['email'] === 'string' && entry['email'].trim()) ? entry['email'].trim()
            : (typeof entry['emailAddress'] === 'string' && entry['emailAddress'].trim()) ? entry['emailAddress'].trim()
            : null;
          internalEmail = emailStr;
        }
      }

      // Company may be nested object or string
      const companyVal = c['company'];
      const companyName =
        pickString(c, ['companyName', 'company_name']) ??
        extractLushaCompanyName(companyVal);
      const companyDomain =
        pickString(c, ['companyDomain', 'company_domain']) ??
        extractLushaCompanyDomain(companyVal);

      return {
        id: typeof c['id'] === 'string' ? c['id'] : null,
        hasEmail,
        emailType: emailType ?? null,
        emailDomain,
        hasPhone: false as const, // Phone reveal disabled; never expose phones
        firstName: pickString(c, ['firstName', 'first_name']) ?? null,
        lastName: pickString(c, ['lastName', 'last_name']) ?? null,
        fullName: pickString(c, ['fullName', 'name', 'full_name']) ?? null,
        title: extractLushaJobTitle(c['jobTitle']) ?? pickString(c, ['title', 'job_title']) ?? null,
        companyName: companyName ?? null,
        companyDomain: companyDomain ?? null,
        linkedinUrl: extractLushaLinkedinUrl(c),
        availableFields: c['has'] ?? undefined,
        internalEmail,
      };
    });

    return {
      ok: true,
      status: 'success',
      httpStatus: response.status,
      resultsReturned: sanitizedResults.length,
      creditsCharged,
      billingShape,
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

// ============================================================
// Búsqueda de empresas — LEGACY (Prospecting API sin versión)
// POST https://api.lusha.com/prospecting/search/companies
//
// NOTA: Endpoint legacy. Docs V3 oficiales (2026-07) indican que
// el endpoint correcto es POST /v3/companies/prospecting.
// Esta función se conserva por compatibilidad hacia atrás.
// Para nuevos usos, utilizar searchLushaCompaniesV3.
//
// IMPORTANTE: No conectado a ningún flujo productivo.
// Requiere plan de Prospecting en Lusha. Consume créditos.
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

// ============================================================
// Company Prospecting V3 — Q3F-5D / Q3F-5G
// POST https://api.lusha.com/v3/companies/prospecting
//
// ENDPOINT OFICIAL DOCUMENTADO EN LUSHA API V3 (2026-07).
// Requiere plan de Prospecting. Cobra por resultado (api_search).
// Si se piden signals, puede haber cargos adicionales.
//
// ESTADO: EXPERIMENTAL — NO CONECTADO A PRODUCCIÓN.
// No llamar desde wizard, source-catalog ni Agente 1.
// No activa ningún provider. No escribe en DB.
//
// Errors:
//   400 = body malformado (p.ej. filters como array en lugar de objeto)
//   402 = créditos insuficientes / pago requerido
//   403 = cuenta inactiva o feature no disponible en el plan
// ============================================================

/**
 * Shape real observado en GET /v3/companies/prospecting/filters — Q3F-5F.
 * El filterType es la clave a usar en el objeto filters del POST.
 * Ejemplos confirmados: names, sizes, revenues, locations, sics (y 9 más).
 * requiresQuery indica si el valor del filtro requiere un query string.
 * Se preservan campos adicionales defensivamente.
 */
export type LushaCompanyProspectingFilterEntry = {
  filterType: string;
  requiresQuery: boolean;
  [key: string]: unknown;
};

/**
 * Schema anidado oficial de filters para POST /v3/companies/prospecting.
 * Confirmado en Q3F-5N via OpenAPI oficial de Lusha V3 (2026-07).
 *
 * Nesting observado: filters.companies.include.*
 * El error anterior era enviar locations/sizes en el nivel raíz de filters.
 *
 * locations: usa objeto reducido { country, state?, city? } — no country_grouping ni continent.
 * sizes: usa rangos numéricos { min, max } — no strings como "51-200".
 * mainIndustriesIds: requiere IDs numéricos, no labels (pendiente mapping).
 */
export type LushaCompanyProspectingV3Filters = {
  companies?: {
    include?: {
      /** Objeto reducido: { country: "Colombia" }. No enviar country_grouping ni continent en POST. */
      locations?: Array<{ country?: string; state?: string; city?: string }>;
      /** Rangos numéricos: { min: 51, max: 200 }. No strings. */
      sizes?: Array<{ min?: number; max?: number }>;
      revenues?: Array<{ min?: number; max?: number }>;
      technologies?: string[];
      technologiesCondition?: 'or' | 'and';
      /** IDs numéricos requeridos. Mapping desde labels pendiente. */
      mainIndustriesIds?: number[];
      intentTopics?: string[];
      names?: string[];
      /** Schema exacto no completamente modelado — conservador. */
      sics?: unknown[];
      /** Schema exacto no completamente modelado — conservador. */
      naics?: unknown[];
    };
    exclude?: {
      domains?: string[];
    };
  };
};

export type LushaCompanyProspectingV3Request = {
  /**
   * Q3F-5N confirmó schema anidado oficial via OpenAPI:
   *   filters.companies.include.locations, sizes, etc.
   * Enviar locations/sizes en el nivel raíz de filters era incorrecto.
   * Q3F-5F confirmó que filters DEBE ser un objeto (no array) — HTTP 400 si array.
   * Q3F-5H confirmó que filters sin companies.include/exclude válido → HTTP 400.
   */
  filters?: LushaCompanyProspectingV3Filters;
  pagination?: {
    /**
     * OpenAPI V3 oficial confirma page base 0 (Q3F-5N).
     * Default: 0. No usar 1 como default.
     */
    page: number;
    /**
     * Mínimo observado en smoke test real Q3F-5E: 10.
     * La API rechaza con HTTP 400 ("pagination.size must not be less than 10")
     * cualquier valor menor. El client bloquea size < 10 localmente.
     */
    size: number;
  };
  options?: {
    /** Default: false. Siempre enviar explícitamente. */
    includePartialProfiles?: boolean;
  };
  // signals puede generar cargos adicionales — omitir por defecto
  signals?: string[];
};

export type LushaCompanyProspectingV3Company = {
  id?: string | null;
  name?: string | null;
  domain?: string | null;
  country?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  linkedinUrl?: string | null;
};

export type LushaCompanyProspectingV3Result = {
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
  totalAvailable?: number | null;
  creditsCharged?: number | null;
  rawShape?: Record<string, unknown>;
  results?: LushaCompanyProspectingV3Company[];
  errorMessage?: string;
};

/**
 * Comprueba si filters contiene al menos un filtro real dentro de companies.include o companies.exclude.
 * Q3F-5N: el schema anidado exige filters.companies.include.* o filters.companies.exclude.*.
 * filters:{} o filters.companies:{} o companies sin include/exclude útil → rechazado localmente.
 */
function hasCompanyFilters(filters: LushaCompanyProspectingV3Filters | undefined): boolean {
  if (!filters?.companies) return false;
  const { include, exclude } = filters.companies;
  if (include) {
    if (include.locations?.length) return true;
    if (include.sizes?.length) return true;
    if (include.revenues?.length) return true;
    if (include.technologies?.length) return true;
    if (include.mainIndustriesIds?.length) return true;
    if (include.intentTopics?.length) return true;
    if (include.names?.length) return true;
    if (include.sics?.length) return true;
    if (include.naics?.length) return true;
  }
  if (exclude?.domains?.length) return true;
  return false;
}

export async function searchLushaCompaniesV3(input: {
  apiKey: string;
  timeoutMs: number;
  request: LushaCompanyProspectingV3Request;
}): Promise<LushaCompanyProspectingV3Result> {
  // smoke_test_minimum_page_size_observed=10 (Q3F-5E)
  // Lusha V3 API rechaza HTTP 400 con "pagination.size must not be less than 10"
  if (input.request.pagination !== undefined && input.request.pagination.size < 10) {
    return {
      ok: false,
      status: 'provider_error',
      resultsReturned: 0,
      errorMessage: `pagination.size must not be less than 10 (got ${input.request.pagination.size}). Lusha V3 API rejects values below 10.`,
    };
  }

  // Q3F-5N: schema anidado oficial — filters debe tener companies.include.* o companies.exclude.*
  // Q3F-5H: filters:{} rechazado — HTTP 400 "filters.Company filters cannot be empty"
  if (!hasCompanyFilters(input.request.filters)) {
    return {
      ok: false,
      status: 'provider_error',
      resultsReturned: 0,
      errorMessage: 'Lusha company prospecting requires at least one filter inside filters.companies.include or filters.companies.exclude. filters: {} is rejected by Lusha V3 API (HTTP 400: "filters.Company filters cannot be empty").',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    // Q3F-5N: schema anidado oficial — filters.companies.include/exclude (no nivel raíz)
    // pagination.page base 0 (OpenAPI V3 oficial confirmado Q3F-5N)
    // options.includePartialProfiles=false por defecto
    const pag = input.request.pagination;
    const requestBody: Record<string, unknown> = {
      filters: input.request.filters,
      pagination: {
        page: pag?.page ?? 0,
        size: pag?.size ?? 10,
      },
      options: {
        includePartialProfiles: input.request.options?.includePartialProfiles ?? false,
      },
    };
    if (input.request.signals !== undefined) {
      requestBody['signals'] = input.request.signals;
    }

    const response = await fetch(`${LUSHA_BASE_URL}/v3/companies/prospecting`, {
      method: 'POST',
      headers: {
        'api_key': input.apiKey.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const rateLimit: Record<string, string | null> = {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: response.headers.get('x-ratelimit-reset'),
    };
    const headerRequestId = response.headers.get('x-request-id');

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: mapLushaHttpError(response.status),
        httpStatus: response.status,
        resultsReturned: 0,
        rateLimit,
        requestId: headerRequestId,
        errorMessage: errorBody.slice(0, 300) || undefined,
      };
    }

    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;

    // Response shape not confirmed in live test — try common keys conservatively
    const items = Array.isArray(raw['results'])
      ? (raw['results'] as Record<string, unknown>[])
      : Array.isArray(raw['companies'])
        ? (raw['companies'] as Record<string, unknown>[])
        : Array.isArray(raw['data'])
          ? (raw['data'] as Record<string, unknown>[])
          : [];

    const requestId =
      typeof raw['requestId'] === 'string' ? raw['requestId'] : headerRequestId;

    const totalAvailable =
      typeof raw['total'] === 'number' ? raw['total']
      : typeof raw['totalResults'] === 'number' ? raw['totalResults']
      : null;

    if (items.length === 0) {
      return {
        ok: true,
        status: 'no_results',
        httpStatus: response.status,
        resultsReturned: 0,
        totalAvailable,
        creditsCharged: typeof raw['creditsCharged'] === 'number' ? raw['creditsCharged'] : null,
        rawShape: buildRawShape(raw),
        rateLimit,
        requestId,
      };
    }

    const results: LushaCompanyProspectingV3Company[] = items.map((c) => ({
      id: typeof c['id'] === 'string' ? c['id'] : null,
      name: pickString(c, ['name', 'companyName']) ?? null,
      domain: pickString(c, ['domain', 'website']) ?? null,
      country: pickString(c, ['country', 'countryCode']) ?? null,
      industry: pickString(c, ['industry', 'industryName']) ?? null,
      employeeCount: typeof c['employeeCount'] === 'number' ? c['employeeCount'] : null,
      linkedinUrl: pickString(c, ['linkedinUrl', 'linkedin_url', 'linkedin']) ?? null,
    }));

    return {
      ok: true,
      status: 'success',
      httpStatus: response.status,
      resultsReturned: results.length,
      totalAvailable,
      creditsCharged: typeof raw['creditsCharged'] === 'number' ? raw['creditsCharged'] : null,
      rawShape: buildRawShape(raw),
      results,
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

// ============================================================
// Company Prospecting Filters V3 — Q3F-5D
// GET https://api.lusha.com/v3/companies/prospecting/filters
// GET https://api.lusha.com/v3/companies/prospecting/filters/{filterType}
//
// Permite descubrir filtros válidos antes de llamar al endpoint
// de prospecting. No consume créditos de api_search.
//
// ESTADO: EXPERIMENTAL — NO CONECTADO A PRODUCCIÓN.
// ============================================================

export type LushaCompanyProspectingFiltersResult = {
  ok: boolean;
  status:
    | 'success'
    | 'provider_auth_error'
    | 'insufficient_credits'
    | 'feature_unavailable'
    | 'rate_limited'
    | 'compliance_blocked'
    | 'provider_error'
    | 'provider_timeout';
  httpStatus?: number;
  requestId?: string | null;
  // Raw full response body
  rawFilters?: unknown;
  /**
   * Parsed from real response shape confirmed in Q3F-5E smoke test:
   * { availableFilters: [...] }
   * Undefined if the key is absent or not an array (defensive).
   */
  availableFilters?: unknown[];
  errorMessage?: string;
};

export async function getLushaCompanyProspectingFilters(input: {
  apiKey: string;
  timeoutMs: number;
}): Promise<LushaCompanyProspectingFiltersResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(
      `${LUSHA_BASE_URL}/v3/companies/prospecting/filters`,
      {
        method: 'GET',
        headers: { 'api_key': input.apiKey.trim() },
        signal: controller.signal,
      }
    );

    clearTimeout(timer);

    const headerRequestId = response.headers.get('x-request-id');

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: mapLushaHttpError(response.status),
        httpStatus: response.status,
        requestId: headerRequestId,
        errorMessage: errorBody.slice(0, 300) || undefined,
      };
    }

    const rawFilters = await response.json().catch(() => undefined) as unknown;
    // Q3F-5F confirmó shape real: array directo de { filterType, requiresQuery }
    // También se soporta defensivamente { availableFilters: [...] } por compatibilidad.
    let availableFilters: unknown[] | undefined;
    if (Array.isArray(rawFilters)) {
      availableFilters = rawFilters as LushaCompanyProspectingFilterEntry[];
    } else if (
      rawFilters !== null &&
      rawFilters !== undefined &&
      typeof rawFilters === 'object' &&
      Array.isArray((rawFilters as Record<string, unknown>)['availableFilters'])
    ) {
      availableFilters = (rawFilters as Record<string, unknown>)['availableFilters'] as unknown[];
    }

    return {
      ok: true,
      status: 'success',
      httpStatus: response.status,
      requestId: headerRequestId,
      rawFilters,
      availableFilters,
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

/**
 * filterTypes que requieren query string — observado en Q3F-5I.
 * GET /v3/companies/prospecting/filters/locations sin query → HTTP 400
 *   { "name": "BadRequest", "message": "\"query\" parameter is required for filterType \"locations\"." }
 * Los valores reales para estos filterTypes no están confirmados hasta una llamada real posterior (Q3F-5K).
 */
const FILTER_TYPES_REQUIRING_QUERY = new Set(['locations', 'names']);

export async function getLushaCompanyProspectingFilterValues(input: {
  apiKey: string;
  timeoutMs: number;
  filterType: string;
  /** Required for filterTypes: locations, names (observed Q3F-5I). Optional for sizes, revenues, sics, etc. */
  query?: string;
}): Promise<LushaCompanyProspectingFiltersResult> {
  // Guardrail local: bloquear antes de fetch si filterType requiere query y no se proveyó
  if (FILTER_TYPES_REQUIRING_QUERY.has(input.filterType) && !input.query?.trim()) {
    return {
      ok: false,
      status: 'provider_error',
      errorMessage: `Lusha filter values for ${input.filterType} require query. Observed in Q3F-5I: HTTP 400 "query parameter is required for filterType \\"${input.filterType}\\""`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const encodedType = encodeURIComponent(input.filterType);
    const qs = new URLSearchParams();
    if (input.query?.trim()) {
      qs.set('query', input.query.trim());
    }
    const qsStr = qs.toString();
    const url = `${LUSHA_BASE_URL}/v3/companies/prospecting/filters/${encodedType}${qsStr ? `?${qsStr}` : ''}`;

    const response = await fetch(
      url,
      {
        method: 'GET',
        headers: { 'api_key': input.apiKey.trim() },
        signal: controller.signal,
      }
    );

    clearTimeout(timer);

    const headerRequestId = response.headers.get('x-request-id');

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: mapLushaHttpError(response.status),
        httpStatus: response.status,
        requestId: headerRequestId,
        errorMessage: errorBody.slice(0, 300) || undefined,
      };
    }

    const rawFilters = await response.json().catch(() => undefined) as unknown;
    return {
      ok: true,
      status: 'success',
      httpStatus: response.status,
      requestId: headerRequestId,
      rawFilters,
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
