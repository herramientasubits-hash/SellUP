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
      const { hasEmail, emailType, emailDomain } = extractEmailInfoFromLushaEmails(c['emails']);

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
// Company Prospecting V3 — Q3F-5D
// POST https://api.lusha.com/v3/companies/prospecting
//
// ENDPOINT OFICIAL DOCUMENTADO EN LUSHA API V3 (2026-07).
// Requiere plan de Prospecting. Cobra por resultado (api_search).
// Si se piden signals, puede haber cargos adicionales.
//
// ESTADO: EXPERIMENTAL — NO CONECTADO A PRODUCCIÓN.
// No llamar desde wizard, source-catalog ni Agente 1.
// No activa ningún provider. No escribe en DB.
// El schema exacto del body no está confirmado en prueba real;
// se usan tipos conservadores hasta smoke test controlado.
//
// Errors:
//   402 = créditos insuficientes / pago requerido
//   403 = cuenta inactiva o feature no disponible en el plan
// ============================================================

export type LushaCompanyProspectingV3Filter = {
  // field y values son opacos hasta confirmar documentación de filtros
  // via GET /v3/companies/prospecting/filters
  field: string;
  values: unknown[];
};

export type LushaCompanyProspectingV3Request = {
  filters?: LushaCompanyProspectingV3Filter[];
  pagination?: {
    page: number;
    size: number;
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

export async function searchLushaCompaniesV3(input: {
  apiKey: string;
  timeoutMs: number;
  request: LushaCompanyProspectingV3Request;
}): Promise<LushaCompanyProspectingV3Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(`${LUSHA_BASE_URL}/v3/companies/prospecting`, {
      method: 'POST',
      headers: {
        'api_key': input.apiKey.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.request),
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
  // Raw response — shape not confirmed until smoke test
  rawFilters?: unknown;
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

export async function getLushaCompanyProspectingFilterValues(input: {
  apiKey: string;
  timeoutMs: number;
  filterType: string;
}): Promise<LushaCompanyProspectingFiltersResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const encodedType = encodeURIComponent(input.filterType);
    const response = await fetch(
      `${LUSHA_BASE_URL}/v3/companies/prospecting/filters/${encodedType}`,
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
