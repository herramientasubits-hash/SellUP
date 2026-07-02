/**
 * Anthropic Cost Sync Connector — Hito L4A
 *
 * Consulta el gasto acumulado del mes (MTD) desde la API de administración de Anthropic.
 *
 * Requiere una Admin API key distinta a la clave de inferencia:
 *   - Variable de entorno: ANTHROPIC_ADMIN_API_KEY
 *   - Vault secret: sellup_anthropic_admin
 *
 * La clave de inferencia estándar (ANTHROPIC_API_KEY) NO tiene acceso a este endpoint.
 * Si no existe Admin key, se aplica degradación controlada con mensaje accionable.
 *
 * Anthropic se mide en USD, no en créditos.
 * credits_remaining_external y monthly_credits_allowance NO aplican para este proveedor.
 *
 * Endpoint: GET https://api.anthropic.com/v1/usage
 * Auth:     x-api-key: {admin_api_key}  +  anthropic-version: 2023-06-01
 *
 * NUNCA imprime la API key. NUNCA retorna secretos.
 */

import { sanitizeQuotaSyncResponse, getResponseShape, sanitizeEndpointUrl } from '@/server/services/quota-sync-sanitizer';
import type { QuotaSyncObservability } from '@/server/services/tavily-quota-sync';
import { getVaultSecretByRawName } from '@/server/services/ai-connection';

const ANTHROPIC_USAGE_ENDPOINT = 'https://api.anthropic.com/v1/usage';
const REQUEST_TIMEOUT_MS = 15_000;

/** Vault aliases para la Admin API key de Anthropic (distinta de la inference key) */
const ADMIN_KEY_VAULT_ALIASES = [
  'sellup_anthropic_admin',
  'sellup_ai_anthropic_admin',
];

/** Env var para la Admin API key (no-prod fallback) */
const ADMIN_KEY_ENV_VAR = 'ANTHROPIC_ADMIN_API_KEY';

/** Mensaje fijo para degradación controlada cuando no hay Admin key */
export const ANTHROPIC_NO_ADMIN_KEY_MSG =
  'Costo Anthropic no disponible por API con la credencial actual — configura el presupuesto mensual USD de forma manual';

// ── Tipos internos ─────────────────────────────────────────────────────────────

/** Datos normalizados extraídos de la respuesta Anthropic */
export interface AnthropicCostData {
  /** Costo acumulado del mes actual en USD */
  usdCostMtd: number;
  /** Forma del campo que aportó el dato (diagnóstico) */
  responseShape: string;
}

export type AnthropicQuotaSyncResult =
  | { ok: true; data: AnthropicCostData; obs: QuotaSyncObservability }
  | { ok: false; error: string; obs?: QuotaSyncObservability };

// ── Resolución de Admin key ────────────────────────────────────────────────────

/**
 * Resuelve la Admin API key de Anthropic.
 * Prueba Vault aliases y luego env var (solo en no-producción).
 * Retorna null si no hay Admin key disponible.
 * NUNCA retorna la key al cliente. Solo para uso server-side.
 */
export async function resolveAnthropicAdminKey(): Promise<string | null> {
  for (const alias of ADMIN_KEY_VAULT_ALIASES) {
    const result = await getVaultSecretByRawName(alias);
    if (result.success && result.apiKey) return result.apiKey;
  }

  if (process.env.NODE_ENV !== 'production') {
    const val = process.env[ADMIN_KEY_ENV_VAR];
    if (val) return val;
  }

  return null;
}

/**
 * Verifica si existe Admin key sin retornarla.
 * Safe: solo retorna boolean.
 */
export async function hasAnthropicAdminKey(): Promise<boolean> {
  const key = await resolveAnthropicAdminKey();
  return key !== null;
}

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

/**
 * Extrae el costo USD de un único objeto de uso.
 * Acepta múltiples nombres de campo posibles de la API de Anthropic.
 */
function extractCostFromItem(item: AnyRecord): number | null {
  return (
    coerceNumber(item['total_cost']) ??
    coerceNumber(item['cost_usd']) ??
    coerceNumber(item['total_cost_usd']) ??
    coerceNumber(item['amount_usd']) ??
    coerceNumber(item['cost']) ??
    null
  );
}

/**
 * Parsea la respuesta cruda de la API de uso de Anthropic.
 *
 * Formatos conocidos:
 * 1. { data: [ { total_cost, model, ... } ] } — array de buckets por modelo/período
 * 2. { usage: { total_cost_usd, ... } } — objeto de resumen directo
 * 3. { total_cost_usd: number } — campo en raíz
 * 4. { costs: [ { amount_usd, ... } ] } — array alternativo
 *
 * Para arrays: suma todos los costos del período (el caller ya filtra MTD si filtra por fechas).
 * NUNCA trata tokens como créditos.
 */
export function parseAnthropicUsageResponse(raw: unknown): AnthropicCostData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;

  // Formato 1: { data: [ { total_cost, ... } ] }
  if (Array.isArray(obj['data']) && obj['data'].length > 0) {
    const items = obj['data'] as unknown[];
    let sum = 0;
    for (const item of items) {
      if (item && typeof item === 'object') {
        const cost = extractCostFromItem(item as AnyRecord);
        if (cost !== null) sum += cost;
      }
    }
    return { usdCostMtd: sum, responseShape: 'data_array' };
  }

  // Formato 2: { costs: [ { amount_usd, ... } ] }
  if (Array.isArray(obj['costs']) && obj['costs'].length > 0) {
    const items = obj['costs'] as unknown[];
    let sum = 0;
    for (const item of items) {
      if (item && typeof item === 'object') {
        const cost = extractCostFromItem(item as AnyRecord);
        if (cost !== null) sum += cost;
      }
    }
    return { usdCostMtd: sum, responseShape: 'costs_array' };
  }

  // Formato 3: { usage: { total_cost_usd, ... } }
  if (obj['usage'] && typeof obj['usage'] === 'object') {
    const usage = obj['usage'] as AnyRecord;
    const cost = extractCostFromItem(usage);
    if (cost !== null) {
      return { usdCostMtd: cost, responseShape: 'usage_object' };
    }
  }

  // Formato 4: campos en raíz
  const rootCost = extractCostFromItem(obj);
  if (rootCost !== null) {
    return { usdCostMtd: rootCost, responseShape: 'root_fields' };
  }

  return null;
}

// ── Fetch principal ────────────────────────────────────────────────────────────

/**
 * Obtiene el costo acumulado MTD desde la API de administración de Anthropic.
 *
 * Degradación controlada si no hay Admin key o el endpoint responde 401/403:
 *   { ok: false, error: ANTHROPIC_NO_ADMIN_KEY_MSG }
 *
 * Seguro: nunca expone la API key en errores ni logs.
 */
export async function fetchAnthropicCost(): Promise<AnthropicQuotaSyncResult> {
  // ── Paso 1: resolver Admin key ────────────────────────────────────────────────
  let adminKey: string | null;
  try {
    adminKey = await resolveAnthropicAdminKey();
  } catch {
    return { ok: false, error: ANTHROPIC_NO_ADMIN_KEY_MSG };
  }

  if (!adminKey) {
    return { ok: false, error: ANTHROPIC_NO_ADMIN_KEY_MSG };
  }

  // ── Paso 2: consultar el endpoint de uso ──────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const endpoint = sanitizeEndpointUrl(ANTHROPIC_USAGE_ENDPOINT);

  // Filtrar por el mes actual (MTD)
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const url = new URL(ANTHROPIC_USAGE_ENDPOINT);
  url.searchParams.set('start_time', startOfMonth);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': adminKey,
        'anthropic-version': '2023-06-01',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const httpStatus = response.status;

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        ok: false,
        error: ANTHROPIC_NO_ADMIN_KEY_MSG,
        obs: { httpStatus, endpoint, responseShape: null, rawResponseSanitized: null },
      };
    }

    if (httpStatus === 429) {
      return {
        ok: false,
        error: 'Anthropic respondió 429 — límite de rate alcanzado',
        obs: { httpStatus, endpoint, responseShape: null, rawResponseSanitized: null },
      };
    }

    if (!response.ok) {
      const rawError = await response.json().catch(() => null);
      return {
        ok: false,
        error: `Anthropic respondió ${httpStatus}`,
        obs: {
          httpStatus,
          endpoint,
          responseShape: getResponseShape(rawError),
          rawResponseSanitized: sanitizeQuotaSyncResponse(rawError),
        },
      };
    }

    const raw = await response.json().catch(() => null);
    const parsed = parseAnthropicUsageResponse(raw);

    const obs: QuotaSyncObservability = {
      httpStatus,
      endpoint,
      responseShape: getResponseShape(raw),
      rawResponseSanitized: sanitizeQuotaSyncResponse(raw),
    };

    if (!parsed) {
      return { ok: false, error: 'Respuesta Anthropic sin campos de costo reconocibles', obs };
    }

    return { ok: true, data: parsed, obs };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout al conectar con Anthropic' };
    }
    return { ok: false, error: 'Error de conexión con Anthropic' };
  }
}
