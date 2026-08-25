/**
 * Apollo Quota Sync Connector
 *
 * Lee el saldo de créditos de Apollo con los dos endpoints que sí lo exponen:
 *
 * Paso 1 — POST /api/v1/usage_stats/credit_usage_stats
 *   Saldos del EQUIPO por tipo de crédito + ciclo de crédito vigente.
 *   Sin body ni rango de fechas. Con GET Apollo responde 404.
 *
 * Paso 2 — GET /api/v1/users/api_profile?include_credit_usage=true
 *   Saldo y tope del USUARIO dueño de la API key. Es el techo que realmente
 *   limita el gasto de SellUp, porque el modelo de créditos de Apollo es
 *   unificado y el admin fija el tope por usuario.
 *
 * Ninguno consume créditos. El contrato completo y los parsers puros viven en
 * apollo-credit-usage-parsers.ts.
 *
 * Degradación controlada:
 *   Si Apollo autentica pero no devuelve saldo legible, el error queda trazable
 *   con la shape de la respuesta en el log de sync. El mensaje NO afirma que
 *   Apollo no exponga cuota por API — sí la expone.
 *
 * NUNCA imprime la API key. NUNCA retorna secretos.
 */

import { getApolloApiKey } from '@/server/services/apollo-connection';
import { sanitizeQuotaSyncResponse, getResponseShape, sanitizeEndpointUrl } from '@/server/services/quota-sync-sanitizer';
import type { QuotaSyncObservability } from '@/server/services/tavily-quota-sync';
import {
  APOLLO_API_PROFILE_ENDPOINT,
  APOLLO_CREDIT_USAGE_STATS_ENDPOINT,
  APOLLO_CREDIT_USAGE_STATS_METHOD,
  APOLLO_QUOTA_UNREADABLE_MSG,
  buildApolloQuotaData,
  parseApolloApiProfileCredits,
  parseApolloCreditUsageStats,
  type ApolloQuotaData,
} from '@/server/services/apollo-credit-usage-parsers';

const REQUEST_TIMEOUT_MS = 15_000;

export type { ApolloQuotaData };
export { APOLLO_QUOTA_UNREADABLE_MSG };

export type ApolloQuotaSyncResult =
  | { ok: true; data: ApolloQuotaData; obs: QuotaSyncObservability }
  | { ok: false; error: string; obs?: QuotaSyncObservability };

// ── Fetch helpers ─────────────────────────────────────────────────────────────

interface RawFetchResult {
  ok: boolean;
  httpStatus: number;
  raw: unknown;
}

async function apolloRequest(
  url: string,
  method: 'GET' | 'POST',
  apiKey: string,
  signal: AbortSignal,
): Promise<RawFetchResult> {
  const response = await fetch(url, {
    method,
    headers: {
      'X-Api-Key': apiKey.trim(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    // credit_usage_stats no requiere parámetros: devuelve el ciclo vigente.
    ...(method === 'POST' ? { body: '{}' } : {}),
    signal,
  });

  const raw = await response.json().catch(() => null);
  return { ok: response.ok, httpStatus: response.status, raw };
}

function buildObs(url: string, result: RawFetchResult): QuotaSyncObservability {
  return {
    httpStatus: result.httpStatus,
    endpoint: sanitizeEndpointUrl(url),
    responseShape: getResponseShape(result.raw),
    rawResponseSanitized: sanitizeQuotaSyncResponse(result.raw),
  };
}

/** Errores de credencial o rate: no tiene sentido seguir intentando. */
function terminalHttpError(httpStatus: number): string | null {
  if (httpStatus === 401) return 'Proveedor respondió 401 — API key inválida o sin permisos';
  if (httpStatus === 403) return 'Proveedor respondió 403 — API key sin permisos para este endpoint';
  if (httpStatus === 429) return 'Proveedor respondió 429 — límite de rate alcanzado';
  return null;
}

// ── Fetch principal ────────────────────────────────────────────────────────────

/**
 * Obtiene el saldo de créditos de Apollo.
 * Seguro: nunca expone la API key en errores ni logs. No consume créditos.
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

  try {
    // ── Paso 1: saldos del equipo + ciclo vigente ─────────────────────────────
    const usageResult = await apolloRequest(
      APOLLO_CREDIT_USAGE_STATS_ENDPOINT,
      APOLLO_CREDIT_USAGE_STATS_METHOD,
      apiKey,
      controller.signal,
    );
    const usageObs = buildObs(APOLLO_CREDIT_USAGE_STATS_ENDPOINT, usageResult);

    const usageTerminal = terminalHttpError(usageResult.httpStatus);
    if (usageTerminal) {
      clearTimeout(timeoutId);
      return { ok: false, error: usageTerminal, obs: usageObs };
    }

    // ── Paso 2: saldo del usuario dueño de la key ─────────────────────────────
    const profileResult = await apolloRequest(
      APOLLO_API_PROFILE_ENDPOINT,
      'GET',
      apiKey,
      controller.signal,
    );
    clearTimeout(timeoutId);
    const profileObs = buildObs(APOLLO_API_PROFILE_ENDPOINT, profileResult);

    const usage = usageResult.ok ? parseApolloCreditUsageStats(usageResult.raw) : null;
    const profile = profileResult.ok ? parseApolloApiProfileCredits(profileResult.raw) : null;
    const data = buildApolloQuotaData(profile, usage);

    if (data) {
      // La observabilidad apunta al endpoint que aportó el saldo reportado.
      return {
        ok: true,
        data,
        obs: data.remainingScope === 'user_cap' ? profileObs : usageObs,
      };
    }

    // ── Sin saldo utilizable ──────────────────────────────────────────────────
    const profileTerminal = terminalHttpError(profileResult.httpStatus);
    if (profileTerminal) {
      return { ok: false, error: profileTerminal, obs: profileObs };
    }
    if (!usageResult.ok) {
      return { ok: false, error: `Proveedor respondió ${usageResult.httpStatus}`, obs: usageObs };
    }
    if (!profileResult.ok) {
      return { ok: false, error: `Proveedor respondió ${profileResult.httpStatus}`, obs: profileObs };
    }

    // Ambos respondieron 200 pero sin saldo legible: degradación controlada.
    return { ok: false, error: APOLLO_QUOTA_UNREADABLE_MSG, obs: profileObs };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Timeout al conectar con Apollo' };
    }
    return { ok: false, error: 'Error de conexión con Apollo' };
  }
}
