/**
 * Apollo.io Connection Service
 *
 * Gestión segura de credenciales de Apollo.io usando Supabase Vault.
 * La API Key NUNCA se retorna al frontend ni se registra en logs.
 * prospecting_provider_connections solo guarda vault_secret_id — nunca el secreto.
 *
 * Naming convention del secreto en Vault: sellup_prospecting_apollo_api_key
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminSupabase() {
  if (!supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

export const APOLLO_VAULT_SECRET_NAME = 'sellup_prospecting_apollo_api_key';

export interface ApolloHealthCheckResult {
  success: boolean;
  error?: string;
  message?: string;
}

// ============================================================
// Gestión de credenciales via Vault
// ============================================================

/**
 * Guarda (o actualiza) la API Key de Apollo en Vault.
 * Retorna el vault_secret_id para almacenar en la tabla de conexión.
 */
export async function storeApolloApiKey(
  apiKey: string
): Promise<{ success: boolean; vaultSecretId?: string; error?: string; message?: string }> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('upsert_vault_secret', {
      p_name: APOLLO_VAULT_SECRET_NAME,
      p_secret: apiKey,
      p_description: 'API Key de Apollo.io para prospección y enriquecimiento en SellUp',
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
 * Elimina la API Key de Apollo de Vault.
 */
export async function removeApolloApiKey(): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminSupabase();

  try {
    await admin.rpc('delete_vault_secret', { p_name: APOLLO_VAULT_SECRET_NAME });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar de Vault';
    return { success: false, error: msg };
  }
}

/**
 * Verifica si existe API Key almacenada en Vault para Apollo.
 */
export async function hasApolloApiKey(): Promise<boolean> {
  const admin = getAdminSupabase();

  try {
    const { data } = await admin.rpc('has_vault_secret', {
      p_name: APOLLO_VAULT_SECRET_NAME,
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
export async function getApolloApiKey(): Promise<string | null> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: APOLLO_VAULT_SECRET_NAME,
    });

    if (error) return null;
    return data as string | null;
  } catch {
    return null;
  }
}

// ============================================================
// Prueba de conexión — health check sin consumir créditos
// ============================================================

/**
 * Valida la API Key de Apollo usando el endpoint de health check.
 *
 * Endpoint: GET https://api.apollo.io/v1/auth/health
 * Header:   X-Api-Key: {api_key}
 * Respuesta exitosa: 200 OK con { is_logged_in: true }
 *
 * IMPORTANTE: Este endpoint NO consume búsquedas ni créditos del plan.
 * No ejecutar Organization Search ni People Search en esta prueba.
 */
export async function testApolloHealth(): Promise<ApolloHealthCheckResult> {
  const apiKey = await getApolloApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay API Key almacenada para Apollo.io.',
    };
  }

  try {
    const response = await fetch('https://api.apollo.io/v1/auth/health', {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          error: 'INVALID_API_KEY',
          message: 'La API Key de Apollo no es válida o no tiene permisos.',
        };
      }

      if (response.status === 403) {
        return {
          success: false,
          error: 'PERMISSION_DENIED',
          message: 'La API Key no tiene permisos para este endpoint.',
        };
      }

      return {
        success: false,
        error: 'API_ERROR',
        message: `Error de Apollo API: ${response.status}`,
      };
    }

    const body = await response.json().catch(() => ({}));
    const isLoggedIn = body?.is_logged_in === true;

    if (!isLoggedIn) {
      return {
        success: false,
        error: 'AUTH_FAILED',
        message: 'Apollo respondió pero no confirmó la autenticación.',
      };
    }

    return {
      success: true,
      message: 'Conexión con Apollo.io verificada correctamente.',
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
