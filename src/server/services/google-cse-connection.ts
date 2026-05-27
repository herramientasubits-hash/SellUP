/**
 * Google CSE Connection Service
 *
 * Gestión segura de credenciales de Google Custom Search Engine
 * usando Supabase Vault. Las credenciales NUNCA se retornan al
 * frontend ni se registran en logs.
 *
 * Vault secret names:
 *   sellup_google_cse_api_key — Google Cloud API Key (Restricted)
 *   sellup_google_cse_cx      — Programmable Search Engine ID (cx)
 *
 * Las credenciales se almacenan como dos secrets independientes
 * para facilitar rotación individual de cada una.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

export const GOOGLE_CSE_API_KEY_VAULT_NAME = 'sellup_google_cse_api_key';
export const GOOGLE_CSE_CX_VAULT_NAME = 'sellup_google_cse_cx';

const INTEGRATION_KEY = 'google_cse';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

export interface GoogleCSECredentials {
  apiKey: string;
  cx: string;
}

export interface GoogleCSEConnectionTestResult {
  success: boolean;
  error?: string;
  message?: string;
  resultsCount?: number;
  responseTimeMs?: number;
}

// ============================================================
// Gestión de credenciales via Vault
// ============================================================

/**
 * Guarda (o actualiza) ambas credenciales de Google CSE en Vault.
 * Almacena el vault_secret_id de la api_key en
 * external_integration_connections — nunca el valor.
 */
export async function storeGoogleCSECredentials(
  apiKey: string,
  cx: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const admin = getAdminSupabase();

  try {
    const { error: keyError } = await admin.rpc('upsert_vault_secret', {
      p_name: GOOGLE_CSE_API_KEY_VAULT_NAME,
      p_secret: apiKey,
      p_description: 'API Key de Google Custom Search para SellUp',
    });
    if (keyError) throw keyError;

    const { error: cxError } = await admin.rpc('upsert_vault_secret', {
      p_name: GOOGLE_CSE_CX_VAULT_NAME,
      p_secret: cx,
      p_description: 'Search Engine ID (cx) de Google CSE para SellUp',
    });
    if (cxError) throw cxError;

    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'stored',
        updated_at: new Date().toISOString(),
      })
      .eq('integration_key' as never, INTEGRATION_KEY);

    return {
      success: true,
      message: 'Credenciales almacenadas de forma segura en Vault',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al almacenar en Vault';
    return { success: false, error: 'VAULT_STORAGE_ERROR', message: msg };
  }
}

/**
 * Elimina ambas credenciales de Google CSE de Vault.
 */
export async function removeGoogleCSECredentials(): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminSupabase();

  try {
    await admin.rpc('delete_vault_secret', { p_name: GOOGLE_CSE_API_KEY_VAULT_NAME });
    await admin.rpc('delete_vault_secret', { p_name: GOOGLE_CSE_CX_VAULT_NAME });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar de Vault';
    return { success: false, error: msg };
  }
}

/**
 * Verifica si ambas credenciales están almacenadas en Vault.
 */
export async function hasGoogleCSECredentials(): Promise<boolean> {
  const admin = getAdminSupabase();

  try {
    const [{ data: hasKey }, { data: hasCx }] = await Promise.all([
      admin.rpc('has_vault_secret', { p_name: GOOGLE_CSE_API_KEY_VAULT_NAME }),
      admin.rpc('has_vault_secret', { p_name: GOOGLE_CSE_CX_VAULT_NAME }),
    ]);
    return hasKey === true && hasCx === true;
  } catch {
    return false;
  }
}

/**
 * Recupera ambas credenciales descifradas desde Vault.
 * USO EXCLUSIVO en backend seguro.
 * NUNCA retornar al frontend. NUNCA loggear los valores.
 *
 * Si no hay credenciales en Vault, intenta process.env como
 * fallback de desarrollo local únicamente.
 */
export async function getGoogleCSECredentials(): Promise<GoogleCSECredentials | null> {
  const admin = getAdminSupabase();

  try {
    const [{ data: apiKey }, { data: cx }] = await Promise.all([
      admin.rpc('get_vault_secret_decrypted', { p_name: GOOGLE_CSE_API_KEY_VAULT_NAME }),
      admin.rpc('get_vault_secret_decrypted', { p_name: GOOGLE_CSE_CX_VAULT_NAME }),
    ]);

    if (apiKey && cx) return { apiKey: apiKey as string, cx: cx as string };
  } catch {
    // fallthrough to env fallback
  }

  // Fallback: solo en desarrollo local
  if (process.env.NODE_ENV !== 'production') {
    const envKey = process.env.GOOGLE_CSE_API_KEY;
    const envCx = process.env.GOOGLE_CSE_CX;
    if (envKey && envCx) return { apiKey: envKey, cx: envCx };
  }

  return null;
}

/**
 * Genera la representación enmascarada del cx para mostrar en UI.
 * Nunca retorna el valor real completo.
 */
export function maskGoogleCSECx(cx: string): string {
  if (cx.length < 6) return '****';
  return `${cx.slice(0, 3)}****${cx.slice(-3)}`;
}

// ============================================================
// Prueba de conexión (sin costo — verifica credenciales)
// ============================================================

/**
 * Valida las credenciales de Google CSE mediante una búsqueda mínima.
 *
 * Endpoint: GET https://www.googleapis.com/customsearch/v1
 * Costo:    1 query del quota gratuito (100/día).
 *
 * Criterios:
 *   200 + items  → connected
 *   400          → parámetros inválidos (cx mal formado)
 *   403          → API key inválida o sin permisos
 *   429          → quota agotado
 *   otro         → error técnico
 */
export async function testGoogleCSEConnection(): Promise<GoogleCSEConnectionTestResult> {
  const creds = await getGoogleCSECredentials();

  if (!creds) {
    return {
      success: false,
      error: 'NO_CREDENTIALS',
      message: 'No hay credenciales de Google CSE almacenadas.',
    };
  }

  const TEST_QUERY = 'UBITS Colombia educacion corporativa';
  const ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
  const REQUEST_TIMEOUT_MS = 15_000;

  const url = new URL(ENDPOINT);
  url.searchParams.set('key', creds.apiKey);
  url.searchParams.set('cx', creds.cx);
  url.searchParams.set('q', TEST_QUERY);
  url.searchParams.set('num', '1');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startMs;

    if (response.status === 200) {
      type CseResponse = { items?: unknown[] };
      const data = (await response.json().catch(() => ({}))) as CseResponse;
      const count = Array.isArray(data.items) ? data.items.length : 0;

      return {
        success: true,
        message: 'Conexión con Google CSE verificada correctamente.',
        resultsCount: count,
        responseTimeMs,
      };
    }

    if (response.status === 403) {
      type GoogleErrorBody = { error?: { message?: string; status?: string } };
      let errorBody: GoogleErrorBody = {};
      try { errorBody = (await response.json()) as GoogleErrorBody; } catch { /* noop */ }

      const googleStatus = errorBody?.error?.status ?? '';
      const googleMessage = errorBody?.error?.message ?? '';

      if (
        googleStatus === 'PERMISSION_DENIED' &&
        googleMessage.includes('Custom Search JSON API')
      ) {
        return {
          success: false,
          error: 'GOOGLE_CSE_PROJECT_NO_ACCESS',
          message:
            'Google Custom Search JSON API no está disponible para este proyecto de Google Cloud. ' +
            'Este proveedor está temporalmente deshabilitado en SellUp.',
        };
      }

      return {
        success: false,
        error: 'INVALID_API_KEY',
        message: 'La API Key de Google CSE no es válida o no tiene permisos para Custom Search API.',
      };
    }

    if (response.status === 400) {
      return {
        success: false,
        error: 'INVALID_CX',
        message: 'El Search Engine ID (cx) no es válido. Verifica el valor en Google Cloud Console.',
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'QUOTA_EXCEEDED',
        message: 'Quota diario de Google CSE agotado (100 queries/día en plan gratuito).',
      };
    }

    const body = await response.text().catch(() => '');
    return {
      success: false,
      error: 'API_ERROR',
      message: `Google CSE ${response.status}: ${body.slice(0, 300)}`,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';

    return {
      success: false,
      error: isTimeout ? 'TIMEOUT' : 'CONNECTION_ERROR',
      message: isTimeout
        ? 'Timeout al conectar con Google CSE (>15s).'
        : `Error de conexión: ${err instanceof Error ? err.message : 'desconocido'}`,
    };
  }
}
