/**
 * Apollo Quota Sync Connector — Hito L3B
 *
 * Intenta obtener saldo de créditos desde la API de Apollo en dos pasos:
 *
 * Paso 1 — GET https://api.apollo.io/v1/auth/health
 *   Confirma autenticación. No consume créditos. No expone saldo en credenciales estándar.
 *
 * Paso 2 — GET https://api.apollo.io/api/v1/usage_stats/api_usage_stats
 *   Intenta obtener saldo de créditos (email, phone). Disponible solo en ciertos planes.
 *   Si devuelve conteo de llamadas de API (sin saldo de créditos), se ignora.
 *   Si responde 403/404, se registra la shape y se aplica degradación controlada.
 *
 * Degradación controlada:
 *   Cuando ningún endpoint expone el saldo, Apollo queda en estado trazable con
 *   mensaje claro para que el admin configure el límite mensual de forma manual.
 *   quota_source = 'sync_error', mensaje accionable en quota_sync_error.
 *
 * NUNCA imprime la API key. NUNCA retorna secretos.
 */

import { getApolloApiKey } from '@/server/services/apollo-connection';
import { sanitizeQuotaSyncResponse, getResponseShape, sanitizeEndpointUrl } from '@/server/services/quota-sync-sanitizer';
import type { QuotaSyncObservability } from '@/server/services/tavily-quota-sync';

const APOLLO_HEALTH_ENDPOINT = 'https://api.apollo.io/v1/auth/health';
const APOLLO_USAGE_STATS_ENDPOINT = 'https://api.apollo.io/api/v1/usage_stats/api_usage_stats';
const REQUEST_TIMEOUT_MS = 15_000;

/** Mensaje fijo para degradación controlada cuando ningún endpoint expone el saldo */
export const APOLLO_NO_QUOTA_ENDPOINT_MSG =
  'Apollo no expone cuota mensual ni créditos disponibles por API — configura el límite mensual de forma manual';

// ── Tipos internos ─────────────────────────────────────────────────────────────

/** Datos normalizados extraídos de la respuesta Apollo */
export interface ApolloQuotaData {
  creditsRemaining: number;
  creditsUsed: number | null;
  planLimitCredits: number | null;
  billingPeriodEnd: string | null;
  /** Detalle de créditos por tipo si Apollo los expone por separado */
  creditTypeSummary: string | null;
}

export type ApolloQuotaSyncResult =
  | { ok: true; data: ApolloQuotaData; obs: QuotaSyncObservability }
  | { ok: false; error: string; obs?: QuotaSyncObservability };

// ── Parser defensivo ───────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

/** Extrae créditos de email (principal en Apollo) desde un objeto */
function extractEmailCredits(obj: AnyRecord): { remaining: number | null; used: number | null; limit: number | null } {
  // Apollo expone créditos de email en varias estructuras posibles
  const remaining =
    coerceNumber(obj['email_credits_remaining']) ??
    coerceNumber(obj['remaining_email_credits']) ??
    coerceNumber(obj['email_credits']) ??
    null;

  const used =
    coerceNumber(obj['email_credits_used']) ??
    coerceNumber(obj['used_email_credits']) ??
    null;

  const limit =
    coerceNumber(obj['email_credits_limit']) ??
    coerceNumber(obj['max_email_credits']) ??
    coerceNumber(obj['total_email_credits']) ??
    null;

  return { remaining, used, limit };
}

/** Extrae créditos de phone desde un objeto (secundario, solo para summary) */
function extractPhoneCredits(obj: AnyRecord): { remaining: number | null; limit: number | null } {
  const remaining =
    coerceNumber(obj['phone_credits_remaining']) ??
    coerceNumber(obj['remaining_phone_credits']) ??
    coerceNumber(obj['mobile_credits_remaining']) ??
    null;

  const limit =
    coerceNumber(obj['phone_credits_limit']) ??
    coerceNumber(obj['max_mobile_credits']) ??
    null;

  return { remaining, limit };
}

/** Extrae créditos generales (sin tipo específico) desde un objeto */
function extractGenericCredits(obj: AnyRecord): { remaining: number | null; used: number | null; limit: number | null } {
  const remaining =
    coerceNumber(obj['credits_remaining']) ??
    coerceNumber(obj['remaining_credits']) ??
    coerceNumber(obj['credits']) ??
    null;

  const used =
    coerceNumber(obj['credits_used']) ??
    coerceNumber(obj['used_credits']) ??
    null;

  const limit =
    coerceNumber(obj['credits_limit']) ??
    coerceNumber(obj['max_credits']) ??
    coerceNumber(obj['plan_credits']) ??
    null;

  return { remaining, used, limit };
}

function extractDateString(obj: AnyRecord): string | null {
  for (const key of ['credit_refresh_date', 'renewal_date', 'billing_period_end', 'plan_renew_at', 'reset_at']) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return null;
}

function buildCreditTypeSummary(
  emailRemaining: number | null,
  phoneRemaining: number | null,
): string | null {
  const parts: string[] = [];
  if (emailRemaining !== null) parts.push(`email: ${emailRemaining.toLocaleString()}`);
  if (phoneRemaining !== null) parts.push(`phone: ${phoneRemaining.toLocaleString()}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

function extractFromObject(obj: AnyRecord): ApolloQuotaData | null {
  // Intenta créditos de email primero (más comunes en Apollo)
  const email = extractEmailCredits(obj);
  const phone = extractPhoneCredits(obj);
  const generic = extractGenericCredits(obj);

  // Determinar creditsRemaining: email > genérico > derivado
  let creditsRemaining = email.remaining ?? generic.remaining;

  const used = email.used ?? generic.used;
  const limit = email.limit ?? generic.limit;

  // Derivar remaining de limit - used si no está disponible directamente
  if (creditsRemaining === null && limit !== null && used !== null) {
    creditsRemaining = limit - used;
  }

  if (creditsRemaining === null) return null;

  const billingPeriodEnd = extractDateString(obj);
  const creditTypeSummary = buildCreditTypeSummary(email.remaining, phone.remaining);

  return {
    creditsRemaining,
    creditsUsed: used,
    planLimitCredits: limit,
    billingPeriodEnd,
    creditTypeSummary,
  };
}

/**
 * Parsea la respuesta cruda del health endpoint de Apollo.
 * Prueba múltiples estructuras posibles de respuesta.
 * Retorna null si no puede extraer el mínimo requerido (creditsRemaining).
 *
 * Apollo puede devolver créditos en:
 * - user.credits_used / user.email_credits_*
 * - account.credits / account.email_credits_*
 * - user.account.credits_*
 * - raíz del objeto
 */
export function parseApolloHealthResponse(raw: unknown): ApolloQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;

  // Formato 1: { user: { email_credits_remaining, ... } } — más probable en auth/health
  if (obj['user'] && typeof obj['user'] === 'object') {
    const user = obj['user'] as AnyRecord;

    // Sub-objeto account dentro de user
    if (user['account'] && typeof user['account'] === 'object') {
      const result = extractFromObject(user['account'] as AnyRecord);
      if (result) return result;
    }

    const result = extractFromObject(user);
    if (result) return result;
  }

  // Formato 2: { account: { ... } }
  if (obj['account'] && typeof obj['account'] === 'object') {
    const result = extractFromObject(obj['account'] as AnyRecord);
    if (result) return result;
  }

  // Formato 3: { data: { ... } }
  if (obj['data'] && typeof obj['data'] === 'object') {
    const result = extractFromObject(obj['data'] as AnyRecord);
    if (result) return result;
  }

  // Formato 4: campos en raíz
  const result = extractFromObject(obj);
  if (result) return result;

  return null;
}

// ── Parser para usage_stats ────────────────────────────────────────────────────

/**
 * Parsea la respuesta de /api/v1/usage_stats/api_usage_stats.
 *
 * Apollo puede devolver dos formatos distintos:
 * - Formato créditos: { user: { email_credits_limit, email_credits_used, ... } }
 * - Formato conteo de llamadas: { api_usage_stats: [{ api_name, count }] }
 *
 * El formato de conteo de llamadas NO contiene saldo de créditos → retorna null.
 * Solo el formato con campos de créditos es utilizable para quota sync.
 */
export function parseApolloUsageStatsResponse(raw: unknown): ApolloQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;

  // Formato conteo de llamadas — inútil para quota sync
  if (Array.isArray(obj['api_usage_stats'])) return null;

  // Intentar extracción de créditos con los mismos wrappers que health
  if (obj['user'] && typeof obj['user'] === 'object') {
    const user = obj['user'] as AnyRecord;
    if (user['account'] && typeof user['account'] === 'object') {
      const result = extractFromObject(user['account'] as AnyRecord);
      if (result) return result;
    }
    const result = extractFromObject(user);
    if (result) return result;
  }

  if (obj['account'] && typeof obj['account'] === 'object') {
    const result = extractFromObject(obj['account'] as AnyRecord);
    if (result) return result;
  }

  if (obj['data'] && typeof obj['data'] === 'object') {
    const result = extractFromObject(obj['data'] as AnyRecord);
    if (result) return result;
  }

  return extractFromObject(obj);
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

interface RawFetchResult {
  ok: boolean;
  httpStatus: number;
  raw: unknown;
  /** true cuando la respuesta HTTP fue exitosa pero el cuerpo no pudo parsearse */
  parseError?: boolean;
}

async function apolloGet(
  url: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<RawFetchResult> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Api-Key': apiKey.trim(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    signal,
  });

  const httpStatus = response.status;

  if (!response.ok) {
    const raw = await response.json().catch(() => null);
    return { ok: false, httpStatus, raw };
  }

  const raw = await response.json().catch(() => null);
  return { ok: true, httpStatus, raw, parseError: raw === null };
}

// ── Fetch principal ────────────────────────────────────────────────────────────

/**
 * Obtiene los datos de cuota desde la API de Apollo.
 * Intenta dos endpoints en secuencia:
 *   1. GET /v1/auth/health — confirma auth; puede tener créditos en algunos planes
 *   2. GET /api/v1/usage_stats/api_usage_stats — endpoint de créditos/uso
 *
 * Si ninguno expone saldo de créditos, aplica degradación controlada con
 * mensaje accionable para configuración manual.
 *
 * Seguro: nunca expone la API key en errores ni logs.
 * No consume créditos del plan Apollo.
 */
export async function fetchApolloQuota(): Promise<ApolloQuotaSyncResult> {
  let apiKey: string | null;
  try {
    apiKey = await getApolloApiKey();
  } catch {
    return { ok: false, error: 'Credencial no configurada' };
  }

  if (!apiKey) {
    return { ok: false, error: 'Credencial no configurada' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const healthEndpoint = sanitizeEndpointUrl(APOLLO_HEALTH_ENDPOINT);

  try {
    // ── Paso 1: health check ──────────────────────────────────────────────────
    const healthResult = await apolloGet(APOLLO_HEALTH_ENDPOINT, apiKey, controller.signal);
    const healthHttpStatus = healthResult.httpStatus;

    if (healthHttpStatus === 401) {
      clearTimeout(timeoutId);
      return {
        ok: false,
        error: 'Proveedor respondió 401 — API key inválida o sin permisos',
        obs: { httpStatus: healthHttpStatus, endpoint: healthEndpoint, responseShape: null, rawResponseSanitized: null },
      };
    }

    if (healthHttpStatus === 403) {
      clearTimeout(timeoutId);
      return {
        ok: false,
        error: 'Proveedor respondió 403 — API key sin permisos para este endpoint',
        obs: { httpStatus: healthHttpStatus, endpoint: healthEndpoint, responseShape: null, rawResponseSanitized: null },
      };
    }

    if (healthHttpStatus === 429) {
      clearTimeout(timeoutId);
      return {
        ok: false,
        error: 'Proveedor respondió 429 — límite de rate alcanzado',
        obs: { httpStatus: healthHttpStatus, endpoint: healthEndpoint, responseShape: null, rawResponseSanitized: null },
      };
    }

    if (!healthResult.ok) {
      clearTimeout(timeoutId);
      return {
        ok: false,
        error: `Proveedor respondió ${healthHttpStatus}`,
        obs: {
          httpStatus: healthHttpStatus,
          endpoint: healthEndpoint,
          responseShape: getResponseShape(healthResult.raw),
          rawResponseSanitized: sanitizeQuotaSyncResponse(healthResult.raw),
        },
      };
    }

    // Confirmar autenticación
    if (healthResult.raw && typeof healthResult.raw === 'object') {
      const body = healthResult.raw as AnyRecord;
      if (body['is_logged_in'] === false) {
        clearTimeout(timeoutId);
        return {
          ok: false,
          error: 'Apollo respondió pero no confirmó la autenticación (is_logged_in: false)',
          obs: {
            httpStatus: healthHttpStatus,
            endpoint: healthEndpoint,
            responseShape: getResponseShape(healthResult.raw),
            rawResponseSanitized: sanitizeQuotaSyncResponse(healthResult.raw),
          },
        };
      }
    }

    // Intentar extraer créditos del health (algunos planes los incluyen aquí)
    const healthParsed = parseApolloHealthResponse(healthResult.raw);
    if (healthParsed) {
      clearTimeout(timeoutId);
      return {
        ok: true,
        data: healthParsed,
        obs: {
          httpStatus: healthHttpStatus,
          endpoint: healthEndpoint,
          responseShape: getResponseShape(healthResult.raw),
          rawResponseSanitized: sanitizeQuotaSyncResponse(healthResult.raw),
        },
      };
    }

    // ── Paso 2: usage_stats ───────────────────────────────────────────────────
    const usageEndpoint = sanitizeEndpointUrl(APOLLO_USAGE_STATS_ENDPOINT);
    const usageResult = await apolloGet(APOLLO_USAGE_STATS_ENDPOINT, apiKey, controller.signal);
    clearTimeout(timeoutId);

    const usageObs: QuotaSyncObservability = {
      httpStatus: usageResult.httpStatus,
      endpoint: usageEndpoint,
      responseShape: getResponseShape(usageResult.raw),
      rawResponseSanitized: sanitizeQuotaSyncResponse(usageResult.raw),
    };

    if (usageResult.ok) {
      const usageParsed = parseApolloUsageStatsResponse(usageResult.raw);
      if (usageParsed) {
        return { ok: true, data: usageParsed, obs: usageObs };
      }
    }

    // ── Degradación controlada ────────────────────────────────────────────────
    // Auth confirmada pero ningún endpoint expone saldo de créditos.
    // Puede ser credencial estándar sin acceso a endpoint de cuota,
    // o plan que no expone créditos por API.
    return {
      ok: false,
      error: APOLLO_NO_QUOTA_ENDPOINT_MSG,
      obs: usageObs,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout al conectar con Apollo' };
    }
    return { ok: false, error: 'Error de conexión con Apollo' };
  }
}
