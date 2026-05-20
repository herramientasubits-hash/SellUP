/**
 * Lusha Connection Service
 *
 * Gestión segura de credenciales de Lusha usando Supabase Vault.
 * La API Key NUNCA se retorna al frontend ni se registra en logs.
 * prospecting_provider_connections solo guarda vault_secret_id — nunca el secreto.
 *
 * Autenticación oficial: header "api_key: {value}"
 * Base URL: https://api.lusha.com
 * Naming convention del secreto en Vault: sellup_prospecting_lusha_api_key
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

export const LUSHA_VAULT_SECRET_NAME = 'sellup_prospecting_lusha_api_key';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

export interface LushaHealthCheckResult {
  success: boolean;
  error?: string;
  message?: string;
}

// ============================================================
// Gestión de credenciales via Vault
// ============================================================

/**
 * Guarda (o actualiza) la API Key de Lusha en Vault.
 * Retorna el vault_secret_id para almacenar en la tabla de conexión.
 */
export async function storeLushaApiKey(
  apiKey: string
): Promise<{ success: boolean; vaultSecretId?: string; error?: string; message?: string }> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('upsert_vault_secret', {
      p_name: LUSHA_VAULT_SECRET_NAME,
      p_secret: apiKey,
      p_description: 'API Key de Lusha para prospección y enriquecimiento en SellUp',
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

/**
 * Elimina la API Key de Lusha de Vault.
 */
export async function removeLushaApiKey(): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminSupabase();

  try {
    await admin.rpc('delete_vault_secret', { p_name: LUSHA_VAULT_SECRET_NAME });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar de Vault';
    return { success: false, error: msg };
  }
}

/**
 * Verifica si existe API Key almacenada en Vault para Lusha.
 */
export async function hasLushaApiKey(): Promise<boolean> {
  const admin = getAdminSupabase();

  try {
    const { data } = await admin.rpc('has_vault_secret', {
      p_name: LUSHA_VAULT_SECRET_NAME,
    });
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Recupera la API Key descifrada desde Vault.
 * USO EXCLUSIVO en backend seguro para pruebas de conexión y llamadas a la API.
 * NUNCA retornar al frontend. NUNCA loggear el valor.
 */
export async function getLushaApiKey(): Promise<string | null> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: LUSHA_VAULT_SECRET_NAME,
    });

    if (error) return null;
    return data as string | null;
  } catch {
    return null;
  }
}

// ============================================================
// Prueba de conexión — sin consumir créditos de enriquecimiento
// ============================================================

/**
 * Valida la API Key de Lusha usando el endpoint de estadísticas de cuenta.
 *
 * Endpoint: GET https://api.lusha.com/account/usage
 * Header:   api_key: {api_key}
 * Respuesta exitosa: 200 OK con objeto usage { bulkCredits, ... }
 *
 * Este endpoint retorna datos de créditos de la cuenta — NO consume
 * créditos de enriquecimiento. Es el endpoint de menor impacto
 * disponible en la API de Lusha para validar autenticación.
 *
 * Fuente oficial: https://docs.lusha.com/apis/openapi/account-management
 */
export async function testLushaHealth(): Promise<LushaHealthCheckResult> {
  const apiKey = await getLushaApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay API Key almacenada para Lusha.',
    };
  }

  try {
    // GET request: no Content-Type header — Lusha returns 400 if present on bodyless requests
    const response = await fetch('https://api.lusha.com/account/usage', {
      method: 'GET',
      headers: {
        'api_key': apiKey,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          error: 'INVALID_API_KEY',
          message: 'La API Key de Lusha no es válida o no tiene permisos.',
        };
      }

      if (response.status === 403) {
        return {
          success: false,
          error: 'PERMISSION_DENIED',
          message: 'La API Key no tiene permisos para este endpoint de Lusha.',
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: 'RATE_LIMITED',
          message: 'Límite de solicitudes alcanzado. La API Key es válida pero hay rate limiting activo.',
        };
      }

      // Expose Lusha's response body so we can diagnose the exact error
      const errorBody = await response.text().catch(() => '');
      return {
        success: false,
        error: 'API_ERROR',
        message: `Lusha ${response.status}: ${errorBody.slice(0, 300)}`,
      };
    }

    const body = await response.json().catch(() => ({}));

    // Any 200 response confirms authentication is valid
    const hasUsageData =
      body?.usage !== undefined ||
      body?.bulkCredits !== undefined ||
      Object.keys(body).length > 0;

    if (!hasUsageData) {
      return {
        success: false,
        error: 'UNEXPECTED_RESPONSE',
        message: 'Lusha respondió pero sin datos de cuenta reconocibles.',
      };
    }

    return {
      success: true,
      message: 'Conexión con Lusha verificada correctamente.',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error de red desconocido';
    return {
      success: false,
      error: 'CONNECTION_ERROR',
      message: `Error de conexión: ${msg}`,
    };
  }
}
