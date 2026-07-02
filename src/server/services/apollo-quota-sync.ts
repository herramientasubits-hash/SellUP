/**
 * Apollo Quota Sync Connector — Hito L3A
 *
 * Consulta el estado de cuenta desde la API de Apollo.
 * Endpoint: GET https://api.apollo.io/v1/auth/health
 * Auth:     X-Api-Key: {api_key}
 *
 * IMPORTANTE: Este endpoint NO consume créditos del plan Apollo.
 * Es el mismo endpoint usado en el health check de /settings/prospecting.
 *
 * Apollo puede exponer créditos separados (email, phone, words).
 * Parser defensivo: extrae email_credits como crédito principal.
 * Si la respuesta cambia de forma, queda logueada la estructura completa.
 *
 * NUNCA imprime la API key. NUNCA retorna secretos.
 */

import { getApolloApiKey } from '@/server/services/apollo-connection';
import { sanitizeQuotaSyncResponse, getResponseShape, sanitizeEndpointUrl } from '@/server/services/quota-sync-sanitizer';
import type { QuotaSyncObservability } from '@/server/services/tavily-quota-sync';

const APOLLO_HEALTH_ENDPOINT = 'https://api.apollo.io/v1/auth/health';
const REQUEST_TIMEOUT_MS = 15_000;

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

// ── Fetch ──────────────────────────────────────────────────────────────────────

/**
 * Obtiene los datos de cuota desde el health endpoint de Apollo.
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

  const endpoint = sanitizeEndpointUrl(APOLLO_HEALTH_ENDPOINT);

  try {
    const response = await fetch(APOLLO_HEALTH_ENDPOINT, {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey.trim(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const httpStatus = response.status;

    if (response.status === 401) {
      return {
        ok: false,
        error: 'Proveedor respondió 401 — API key inválida o sin permisos',
        obs: { httpStatus, endpoint, responseShape: null, rawResponseSanitized: null },
      };
    }

    if (response.status === 403) {
      return {
        ok: false,
        error: 'Proveedor respondió 403 — API key sin permisos para este endpoint',
        obs: { httpStatus, endpoint, responseShape: null, rawResponseSanitized: null },
      };
    }

    if (response.status === 429) {
      return {
        ok: false,
        error: 'Proveedor respondió 429 — límite de rate alcanzado',
        obs: { httpStatus, endpoint, responseShape: null, rawResponseSanitized: null },
      };
    }

    if (!response.ok) {
      const rawError = await response.json().catch(() => null);
      return {
        ok: false,
        error: `Proveedor respondió ${response.status}`,
        obs: {
          httpStatus,
          endpoint,
          responseShape: getResponseShape(rawError),
          rawResponseSanitized: sanitizeQuotaSyncResponse(rawError),
        },
      };
    }

    const raw = await response.json().catch(() => null);

    const obs: QuotaSyncObservability = {
      httpStatus,
      endpoint,
      responseShape: getResponseShape(raw),
      rawResponseSanitized: sanitizeQuotaSyncResponse(raw),
    };

    // Verificar is_logged_in antes de parsear cuota
    if (raw && typeof raw === 'object') {
      const body = raw as AnyRecord;
      if (body['is_logged_in'] === false) {
        return {
          ok: false,
          error: 'Apollo respondió pero no confirmó la autenticación (is_logged_in: false)',
          obs,
        };
      }
    }

    const parsed = parseApolloHealthResponse(raw);

    if (!parsed) {
      // La respuesta fue exitosa pero no contiene campos de cuota reconocibles.
      // Esto es informativo: logueamos la shape para poder ajustar el parser.
      return {
        ok: false,
        error: 'Respuesta sin campos de cuota reconocibles — ver response_shape en logs',
        obs,
      };
    }

    return { ok: true, data: parsed, obs };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout al conectar con Apollo' };
    }
    return { ok: false, error: 'Error de conexión con Apollo' };
  }
}
