/**
 * Tavily Quota Sync Connector — Hito L2
 *
 * Consulta el uso de créditos desde la API de Tavily.
 * Endpoint: GET https://api.tavily.com/usage
 * Auth:     Authorization: Bearer {api_key}
 *
 * Parser defensivo: acepta múltiples formatos de respuesta conocidos.
 * Campo mínimo para éxito: credits_remaining (o derivable de used+total).
 *
 * NUNCA imprime la API key. NUNCA retorna secretos.
 */

import { getTavilyApiKey } from '@/server/services/tavily-connection';
import { sanitizeQuotaSyncResponse, getResponseShape, sanitizeEndpointUrl } from '@/server/services/quota-sync-sanitizer';

const TAVILY_USAGE_ENDPOINT = 'https://api.tavily.com/usage';
const REQUEST_TIMEOUT_MS = 15_000;

// ── Tipos internos ─────────────────────────────────────────────────────────────

/** Datos normalizados extraídos de la respuesta Tavily */
export interface TavilyQuotaData {
  creditsRemaining: number;
  creditsUsed: number | null;
  planLimitCredits: number | null;
  billingPeriodEnd: string | null;
}

/** Campos de observabilidad incluidos en el resultado para logging seguro */
export interface QuotaSyncObservability {
  httpStatus?: number;
  endpoint: string;
  responseShape: unknown;
  rawResponseSanitized: unknown;
}

export type TavilyQuotaSyncResult =
  | { ok: true; data: TavilyQuotaData; obs: QuotaSyncObservability }
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

function extractFromObject(obj: AnyRecord): TavilyQuotaData | null {
  // Field name candidates (Tavily API may vary by plan/version)
  const remaining =
    coerceNumber(obj['credits_remaining']) ??
    coerceNumber(obj['remaining_credits']) ??
    coerceNumber(obj['creditsRemaining']) ??
    null;

  const directUsed =
    coerceNumber(obj['credits_used']) ??
    coerceNumber(obj['used_credits']) ??
    coerceNumber(obj['creditsUsed']) ??
    coerceNumber(obj['plan_usage']) ??   // real Tavily /usage: account.plan_usage
    null;

  // Fallback: sum individual usage types when plan_usage is absent
  const hasIndividualUsage =
    obj['search_usage'] !== undefined ||
    obj['crawl_usage'] !== undefined ||
    obj['extract_usage'] !== undefined ||
    obj['map_usage'] !== undefined ||
    obj['research_usage'] !== undefined;
  const summedUsage = hasIndividualUsage
    ? (coerceNumber(obj['search_usage']) ?? 0) +
      (coerceNumber(obj['crawl_usage']) ?? 0) +
      (coerceNumber(obj['extract_usage']) ?? 0) +
      (coerceNumber(obj['map_usage']) ?? 0) +
      (coerceNumber(obj['research_usage']) ?? 0)
    : null;

  const used = directUsed ?? summedUsage;

  const limit =
    coerceNumber(obj['max_credits']) ??
    coerceNumber(obj['plan_credits']) ??
    coerceNumber(obj['total_credits']) ??
    coerceNumber(obj['credits_limit']) ??
    coerceNumber(obj['limit_credits']) ??
    coerceNumber(obj['plan_limit']) ??   // real Tavily /usage: account.plan_limit
    null;

  // Derive remaining from used + limit if not directly available
  let creditsRemaining = remaining;
  if (creditsRemaining === null && used !== null && limit !== null) {
    creditsRemaining = limit - used;
  }

  if (creditsRemaining === null) return null;

  const billingPeriodEnd =
    typeof obj['reset_at'] === 'string' ? obj['reset_at'] :
    typeof obj['reset_date'] === 'string' ? obj['reset_date'] :
    typeof obj['billing_period_end'] === 'string' ? obj['billing_period_end'] :
    typeof obj['period_end'] === 'string' ? obj['period_end'] :
    null;

  return {
    creditsRemaining,
    creditsUsed: used,
    planLimitCredits: limit,
    billingPeriodEnd,
  };
}

/**
 * Parsea la respuesta cruda de la API de Tavily.
 * Prueba múltiples formatos posibles de respuesta.
 * Retorna null si no puede extraer el mínimo requerido.
 */
export function parseTavilyUsageResponse(raw: unknown): TavilyQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;

  // Formato 1: { usage: { credits_remaining, credits_used, ... } }
  if (obj['usage'] && typeof obj['usage'] === 'object') {
    const result = extractFromObject(obj['usage'] as AnyRecord);
    if (result) return result;
  }

  // Formato 2: { data: { ... } }
  if (obj['data'] && typeof obj['data'] === 'object') {
    const result = extractFromObject(obj['data'] as AnyRecord);
    if (result) return result;
  }

  // Formato 3: { account: { plan_limit, plan_usage, ... } } — real Tavily /usage endpoint
  if (obj['account'] && typeof obj['account'] === 'object') {
    const result = extractFromObject(obj['account'] as AnyRecord);
    if (result) return result;
  }

  // Formato 4: { key: { usage, limit, ... } } — parser corre antes del sanitizador
  if (obj['key'] && typeof obj['key'] === 'object') {
    const result = extractFromObject(obj['key'] as AnyRecord);
    if (result) return result;
  }

  // Formato 5: campos en raíz
  const result = extractFromObject(obj);
  if (result) return result;

  return null;
}

// ── Fetch ──────────────────────────────────────────────────────────────────────

/**
 * Obtiene los datos de cuota desde la API de Tavily.
 * Seguro: nunca expone la API key en errores ni logs.
 */
export async function fetchTavilyQuota(): Promise<TavilyQuotaSyncResult> {
  const apiKey = await getTavilyApiKey();

  if (!apiKey) {
    return { ok: false, error: 'Credencial no configurada' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const endpoint = sanitizeEndpointUrl(TAVILY_USAGE_ENDPOINT);

  try {
    const response = await fetch(TAVILY_USAGE_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const httpStatus = response.status;

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Proveedor respondió ${response.status}`, obs: { httpStatus, endpoint, responseShape: null, rawResponseSanitized: null } };
    }

    if (response.status === 429) {
      return { ok: false, error: 'Proveedor respondió 429', obs: { httpStatus, endpoint, responseShape: null, rawResponseSanitized: null } };
    }

    if (!response.ok) {
      const rawError = await response.json().catch(() => null);
      return { ok: false, error: `Proveedor respondió ${response.status}`, obs: { httpStatus, endpoint, responseShape: getResponseShape(rawError), rawResponseSanitized: sanitizeQuotaSyncResponse(rawError) } };
    }

    const raw = await response.json().catch(() => null);
    const parsed = parseTavilyUsageResponse(raw);

    const obs: QuotaSyncObservability = {
      httpStatus,
      endpoint,
      responseShape: getResponseShape(raw),
      rawResponseSanitized: sanitizeQuotaSyncResponse(raw),
    };

    if (!parsed) {
      return { ok: false, error: 'Respuesta sin campos de cuota reconocibles', obs };
    }

    return { ok: true, data: parsed, obs };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout al conectar con proveedor' };
    }
    return { ok: false, error: 'Error de conexión con proveedor' };
  }
}
