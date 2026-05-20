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
/**
 * Intenta autenticar contra Lusha usando un formato de header dado.
 * Retorna true si la respuesta indica autenticación válida (200 o 429).
 * Retorna el status y body para diagnóstico en caso de fallo.
 */
async function attemptLushaAuth(
  apiKeyValue: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await fetch('https://api.lusha.com/account/usage', {
    method: 'GET',
    headers: { 'api_key': apiKeyValue },
  });
  const body = await response.text().catch(() => '');
  // 200 = success, 429 = rate limited (key is valid — Lusha only throttles authenticated requests)
  const ok = response.status === 200 || response.status === 429;
  return { ok, status: response.status, body: body.slice(0, 300) };
}

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
    const key = apiKey.trim();

    // Attempt 1: raw key (most common format per Lusha docs)
    const attempt1 = await attemptLushaAuth(key);
    if (attempt1.ok) {
      return { success: true, message: 'Conexión con Lusha verificada correctamente.' };
    }

    // Attempt 2: Bearer-prefixed key (some Lusha plans require this format)
    if (attempt1.status === 400) {
      const attempt2 = await attemptLushaAuth(`Bearer ${key}`);
      if (attempt2.ok) {
        return { success: true, message: 'Conexión con Lusha verificada correctamente.' };
      }

      // Both formats failed — report last error body for diagnosis
      const lastBody = attempt2.body || attempt1.body;
      const lastStatus = attempt2.status;

      if (lastStatus === 401) {
        return {
          success: false,
          error: 'INVALID_API_KEY',
          message: 'La API Key de Lusha no es válida.',
        };
      }

      return {
        success: false,
        error: 'API_ERROR',
        message: `Lusha ${lastStatus}: ${lastBody}`,
      };
    }

    if (attempt1.status === 401) {
      return {
        success: false,
        error: 'INVALID_API_KEY',
        message: 'La API Key de Lusha no es válida o no tiene permisos.',
      };
    }

    if (attempt1.status === 403) {
      return {
        success: false,
        error: 'PERMISSION_DENIED',
        message: 'La API Key no tiene permisos para este endpoint de Lusha.',
      };
    }

    return {
      success: false,
      error: 'API_ERROR',
      message: `Lusha ${attempt1.status}: ${attempt1.body}`,
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
