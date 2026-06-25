/**
 * Perú Migo Legal Lookup — Perú.6B
 *
 * Real point-query lookup for Migo Perú API.
 * Resolves credential from Vault, calls the API, normalizes to PeMigoApiLookupResult.
 *
 * GUARDRAILS — this module must NEVER:
 * - Log the API token
 * - Return raw_payload
 * - Use Authorization: Bearer header
 * - Call SUNAT API or Tavily
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Set official_ciiu_available to true
 * - Set sector_source to any value other than 'not_provided_by_migo'
 * - Use NEXT_PUBLIC_MIGO
 *
 * Endpoint: POST https://api.migo.pe/api/v1/ruc
 * Body:     { token: apiKey, ruc }
 * Auth:     No Authorization Bearer — token is in the body
 *
 * See docs/PERU_MVP_ACTIVATION_PLAN.md §Perú.6B
 */

import { getMigoApiKey } from './migo-connection';
import {
  normalizeRuc,
  isValidRuc,
} from '../source-catalog/connectors/sunat-peru/normalizers';
import type {
  PeMigoApiLookupResult,
  PeMigoApiLookupPayload,
} from '../prospect-batches/peru-migo-legal-enrichment';

// ── Constants ──────────────────────────────────────────────────────────────────

const MIGO_API_BASE = 'https://api.migo.pe';
const MIGO_API_PATH = '/api/v1/ruc';
const REQUEST_TIMEOUT_MS = 15_000;

// ── Normalizer ─────────────────────────────────────────────────────────────────

/**
 * Extracts a normalized PeMigoApiLookupPayload from a raw Migo API response body.
 * Does NOT include raw payload, token, or personal data.
 */
function normalizeMigoResponsePayload(
  ruc: string,
  raw: Record<string, unknown>,
): PeMigoApiLookupPayload {
  const legalName =
    typeof raw.nombre_o_razon_social === 'string'
      ? raw.nombre_o_razon_social.trim() || null
      : typeof raw.razon_social === 'string'
        ? raw.razon_social.trim() || null
        : null;

  const taxpayerStatus =
    typeof raw.estado_del_contribuyente === 'string'
      ? raw.estado_del_contribuyente.trim() || null
      : typeof raw.estado === 'string'
        ? raw.estado.trim() || null
        : null;

  const domicileCondition =
    typeof raw.condicion_de_domicilio === 'string'
      ? raw.condicion_de_domicilio.trim() || null
      : typeof raw.condicion === 'string'
        ? raw.condicion.trim() || null
        : null;

  const ubigeo =
    typeof raw.ubigeo === 'string'
      ? raw.ubigeo.trim() || null
      : typeof raw.ubigeo === 'number'
        ? String(raw.ubigeo)
        : null;

  const address =
    typeof raw.direccion === 'string'
      ? raw.direccion.trim() || null
      : null;

  const updatedAtSource =
    typeof raw.actualizado_en === 'string'
      ? raw.actualizado_en.trim() || null
      : typeof raw.fecha_actualizacion === 'string'
        ? raw.fecha_actualizacion.trim() || null
        : null;

  return {
    ruc,
    legal_name: legalName,
    taxpayer_status: taxpayerStatus,
    domicile_condition: domicileCondition,
    ubigeo,
    address,
    updated_at_source: updatedAtSource,
  };
}

// ── Main lookup ────────────────────────────────────────────────────────────────

/**
 * Looks up a single RUC against the Migo Perú API.
 *
 * Behavior:
 * - Returns invalid_ruc_format guard if RUC is not 11 digits.
 * - Resolves API key from Vault (falls back to MIGO_API_KEY env in dev).
 * - Returns api_unavailable if no credential found.
 * - Calls POST https://api.migo.pe/api/v1/ruc with body { token, ruc }.
 * - Returns not_found if API says RUC does not exist.
 * - Returns found with normalized payload on success.
 * - Returns api_unavailable on network/timeout/HTTP errors.
 *
 * Does NOT log the token. Does NOT return raw_payload.
 *
 * @param fetchFn     - Injected for testing. Defaults to global fetch.
 * @param getApiKeyFn - Injected for testing. Defaults to getMigoApiKey from Vault.
 */
export async function lookupPeruMigoByRuc(
  ruc: string,
  fetchFn: typeof fetch = fetch,
  getApiKeyFn: () => Promise<string | null> = getMigoApiKey,
): Promise<PeMigoApiLookupResult> {
  const normalized = normalizeRuc(ruc);

  if (!isValidRuc(normalized)) {
    return {
      status: 'api_unavailable',
      error: 'invalid_ruc_format',
    };
  }

  const apiKey = await getApiKeyFn();

  if (!apiKey) {
    return {
      status: 'api_unavailable',
      error: 'migo_credential_not_configured',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const url = `${MIGO_API_BASE}${MIGO_API_PATH}`;

    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: apiKey, ruc: normalized }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'api_unavailable',
        error: 'migo_auth_failed',
      };
    }

    if (response.status === 429) {
      return {
        status: 'api_unavailable',
        error: 'migo_rate_limited',
      };
    }

    if (response.status >= 500) {
      return {
        status: 'api_unavailable',
        error: `migo_server_error_${response.status}`,
      };
    }

    if (response.status !== 200) {
      return {
        status: 'api_unavailable',
        error: `migo_http_${response.status}`,
      };
    }

    const body = await response.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return {
        status: 'api_unavailable',
        error: 'migo_invalid_response',
      };
    }

    const raw = body as Record<string, unknown>;

    // API returned success=false → RUC not found or rejected
    if (raw.success === false) {
      return { status: 'not_found' };
    }

    const payload = normalizeMigoResponsePayload(normalized, raw);
    const durationMs = Date.now() - startMs;

    void durationMs; // available for callers via their own timing

    return { status: 'found', payload };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';

    return {
      status: 'api_unavailable',
      error: isTimeout ? 'migo_timeout' : 'migo_network_error',
    };
  }
}
