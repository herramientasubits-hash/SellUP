/**
 * Lusha Quota Sync Connector — Hito L2
 *
 * Consulta el uso de créditos desde la API de Lusha.
 * Endpoint: GET https://api.lusha.com/account/usage
 * Auth:     api_key: {api_key}  (header oficial de Lusha)
 *
 * Parser defensivo: acepta múltiples formatos de respuesta conocidos.
 * Campo mínimo para éxito: credits_remaining (o derivable de total - used).
 *
 * NUNCA imprime la API key. NUNCA retorna secretos.
 */

import { getLushaApiKey } from '@/server/services/lusha-connection';

const LUSHA_USAGE_ENDPOINT = 'https://api.lusha.com/account/usage';
const REQUEST_TIMEOUT_MS = 15_000;

// ── Tipos internos ─────────────────────────────────────────────────────────────

/** Datos normalizados extraídos de la respuesta Lusha */
export interface LushaQuotaData {
  creditsRemaining: number;
  creditsUsed: number | null;
  totalCredits: number | null;
  renewalDate: string | null;
}

export type LushaQuotaSyncResult =
  | { ok: true; data: LushaQuotaData }
  | { ok: false; error: string };

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

function extractFromObject(obj: AnyRecord): LushaQuotaData | null {
  // Field name candidates (Lusha API formats observed)
  const remaining =
    coerceNumber(obj['remaining_credits']) ??
    coerceNumber(obj['remainingCredits']) ??
    coerceNumber(obj['credits_remaining']) ??
    coerceNumber(obj['available_credits']) ??
    null;

  const used =
    coerceNumber(obj['used_credits']) ??
    coerceNumber(obj['usedCredits']) ??
    coerceNumber(obj['credits_used']) ??
    null;

  const total =
    coerceNumber(obj['total_credits']) ??
    coerceNumber(obj['totalCredits']) ??
    coerceNumber(obj['plan_credits']) ??
    coerceNumber(obj['max_credits']) ??
    null;

  // Derive remaining if not directly available
  let creditsRemaining = remaining;
  if (creditsRemaining === null && total !== null && used !== null) {
    creditsRemaining = total - used;
  }
  if (creditsRemaining === null && total !== null && remaining === null) {
    // If only total is available, we can't derive remaining without used
    // Don't use total as remaining — that would be wrong
  }

  if (creditsRemaining === null) return null;

  const renewalDate =
    typeof obj['renewal_date'] === 'string' ? obj['renewal_date'] :
    typeof obj['renewalDate'] === 'string' ? obj['renewalDate'] :
    typeof obj['reset_date'] === 'string' ? obj['reset_date'] :
    typeof obj['billing_cycle_end'] === 'string' ? obj['billing_cycle_end'] :
    typeof obj['next_renewal'] === 'string' ? obj['next_renewal'] :
    null;

  return {
    creditsRemaining,
    creditsUsed: used,
    totalCredits: total,
    renewalDate,
  };
}

/**
 * Parsea la respuesta cruda de la API de Lusha.
 * Prueba múltiples formatos posibles de respuesta.
 * Retorna null si no puede extraer el mínimo requerido.
 */
export function parseLushaUsageResponse(raw: unknown): LushaQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;

  // Formato 1: { data: { ... } }
  if (obj['data'] && typeof obj['data'] === 'object') {
    const result = extractFromObject(obj['data'] as AnyRecord);
    if (result) return result;
  }

  // Formato 2: { credits: { remaining, used, total } }
  if (obj['credits'] && typeof obj['credits'] === 'object') {
    const result = extractFromObject(obj['credits'] as AnyRecord);
    if (result) return result;
  }

  // Formato 3: { account: { ... } }
  if (obj['account'] && typeof obj['account'] === 'object') {
    const result = extractFromObject(obj['account'] as AnyRecord);
    if (result) return result;
  }

  // Formato 4: campos en raíz
  const result = extractFromObject(obj);
  if (result) return result;

  return null;
}

// ── Fetch ──────────────────────────────────────────────────────────────────────

/**
 * Obtiene los datos de cuota desde la API de Lusha.
 * Seguro: nunca expone la API key en errores ni logs.
 */
export async function fetchLushaQuota(): Promise<LushaQuotaSyncResult> {
  const apiKey = await getLushaApiKey();

  if (!apiKey) {
    return { ok: false, error: 'Credencial no configurada' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(LUSHA_USAGE_ENDPOINT, {
      method: 'GET',
      headers: {
        'api_key': apiKey.trim(),
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 400 || response.status === 401) {
      return { ok: false, error: `Proveedor respondió ${response.status}` };
    }

    if (response.status === 403) {
      return { ok: false, error: 'Proveedor respondió 403' };
    }

    if (response.status === 429) {
      return { ok: false, error: 'Proveedor respondió 429' };
    }

    if (!response.ok) {
      return { ok: false, error: `Proveedor respondió ${response.status}` };
    }

    const raw = await response.json().catch(() => null);
    const parsed = parseLushaUsageResponse(raw);

    if (!parsed) {
      return { ok: false, error: 'Respuesta sin campos de cuota reconocibles' };
    }

    return { ok: true, data: parsed };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout al conectar con proveedor' };
    }
    return { ok: false, error: 'Error de conexión con proveedor' };
  }
}
