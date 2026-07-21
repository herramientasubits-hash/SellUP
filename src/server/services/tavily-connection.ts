/**
 * Tavily Connection Service
 *
 * Gestión segura de credenciales de Tavily usando Supabase Vault.
 * La API Key NUNCA se retorna al frontend ni se registra en logs.
 *
 * Vault secret name: sellup_tavily_api_key
 *
 * Test de conexión:
 *   Tavily no tiene endpoint de health check sin costo.
 *   El test usa POST /search con 1 resultado → consume 1 crédito Tavily.
 *   La UI debe advertir esto claramente antes de ejecutar el test.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const TAVILY_VAULT_SECRET_NAME = 'sellup_tavily_api_key';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const TEST_QUERY = 'UBITS Colombia educacion corporativa';
const REQUEST_TIMEOUT_MS = 15_000;

export interface TavilyConnectionTestResult {
  success: boolean;
  error?: string;
  message?: string;
  responseTimeMs?: number;
  resultsCount?: number;
}

// ============================================================
// Gestión de credenciales via Vault
// ============================================================

export async function storeTavilyApiKey(
  apiKey: string
): Promise<{ success: boolean; vaultSecretId?: string; error?: string; message?: string }> {
  const admin = createSupabaseAdminClient();

  try {
    const { data, error } = await admin.rpc('upsert_vault_secret', {
      p_name: TAVILY_VAULT_SECRET_NAME,
      p_secret: apiKey,
      p_description: 'API Key de Tavily para búsqueda web del Agente 1 en SellUp',
    });

    if (error) throw error;

    return {
      success: true,
      vaultSecretId: data as string,
      message: 'API Key almacenada de forma segura en Vault',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al almacenar en Vault';
    return { success: false, error: 'VAULT_STORAGE_ERROR', message: msg };
  }
}

export async function removeTavilyApiKey(): Promise<{ success: boolean; error?: string }> {
  const admin = createSupabaseAdminClient();

  try {
    await admin.rpc('delete_vault_secret', { p_name: TAVILY_VAULT_SECRET_NAME });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar de Vault';
    return { success: false, error: msg };
  }
}

export async function hasTavilyApiKey(): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  try {
    const { data } = await admin.rpc('has_vault_secret', {
      p_name: TAVILY_VAULT_SECRET_NAME,
    });
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Recupera la API Key descifrada desde Vault.
 * USO EXCLUSIVO en backend seguro.
 * NUNCA retornar al frontend. NUNCA loggear el valor.
 *
 * Si no hay key en Vault, intenta process.env.TAVILY_API_KEY
 * como fallback de desarrollo local.
 */
export async function getTavilyApiKey(): Promise<string | null> {
  try {
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: TAVILY_VAULT_SECRET_NAME,
    });

    if (!error && data) return data as string;
  } catch {
    // fallthrough to env fallback
  }

  // Fallback: solo en desarrollo local
  if (process.env.NODE_ENV !== 'production') {
    return process.env.TAVILY_API_KEY ?? null;
  }

  return null;
}

/**
 * Genera la representación enmascarada de la API Key para mostrar en UI.
 * Nunca retorna la key real ni partes significativas.
 * Formato: tvly-****XXXX (últimos 4 caracteres).
 */
export function maskTavilyApiKey(apiKey: string): string {
  if (apiKey.length < 8) return '****';
  const last4 = apiKey.slice(-4);
  const prefix = apiKey.startsWith('tvly-') ? 'tvly-' : '';
  return `${prefix}****${last4}`;
}

// ============================================================
// Prueba de conexión
// ============================================================

/**
 * Valida la API Key de Tavily mediante una búsqueda mínima real.
 *
 * ADVERTENCIA: Consume 1 crédito de Tavily.
 * No existe endpoint de health check gratuito en la API de Tavily.
 *
 * Endpoint: POST https://api.tavily.com/search
 * Auth:     Authorization: Bearer {api_key}
 *
 * Criterios:
 *   200 + results → connected
 *   401 / 403    → credencial inválida
 *   otro         → error técnico
 */
export async function testTavilyConnection(): Promise<TavilyConnectionTestResult> {
  const apiKey = await getTavilyApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay API Key de Tavily almacenada.',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: TEST_QUERY,
        max_results: 1,
        search_depth: 'basic',
        include_raw_content: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startMs;

    if (response.status === 200) {
      type TavilyResults = { results?: unknown[] };
      const data = (await response.json().catch(() => ({}))) as TavilyResults;
      const count = Array.isArray(data.results) ? data.results.length : 0;

      return {
        success: true,
        message: 'Conexión con Tavily verificada correctamente.',
        responseTimeMs,
        resultsCount: count,
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        error: 'INVALID_API_KEY',
        message: 'La API Key de Tavily no es válida o ha expirado.',
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'PERMISSION_DENIED',
        message: 'La API Key no tiene permisos para este endpoint de Tavily.',
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'RATE_LIMIT',
        message: 'Límite de créditos Tavily alcanzado. Verifica tu plan.',
      };
    }

    const body = await response.text().catch(() => '');
    return {
      success: false,
      error: 'API_ERROR',
      message: `Tavily ${response.status}: ${body.slice(0, 300)}`,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';

    return {
      success: false,
      error: isTimeout ? 'TIMEOUT' : 'CONNECTION_ERROR',
      message: isTimeout
        ? 'Timeout al conectar con Tavily (>15s).'
        : `Error de conexión: ${err instanceof Error ? err.message : 'desconocido'}`,
    };
  }
}
