/**
 * Samu IA Connection Service
 *
 * Gestión segura de credenciales de Samu IA usando Supabase Vault.
 * La API Key NUNCA se retorna al frontend ni se registra en logs.
 *
 * Autenticación oficial: header "apiKey: {value}"
 * Base URL: https://api.samu.ai
 * Endpoint de validación: GET /api/users (retorna lista de usuarios de la cuenta)
 * Vault secret name: sellup_samu_api_key
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const SAMU_VAULT_SECRET_NAME = 'sellup_samu_api_key';

function getAdminSupabase() {
  if (!supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

export interface SamuHealthCheckResult {
  success: boolean;
  error?: string;
  message?: string;
  userCount?: number;
}

// ============================================================
// Gestión de credenciales via Vault
// ============================================================

export async function storeSamuApiKey(
  apiKey: string
): Promise<{ success: boolean; vaultSecretId?: string; error?: string; message?: string }> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('upsert_vault_secret', {
      p_name: SAMU_VAULT_SECRET_NAME,
      p_secret: apiKey,
      p_description: 'API Key de Samu IA para análisis de reuniones comerciales en SellUp',
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

export async function removeSamuApiKey(): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminSupabase();

  try {
    await admin.rpc('delete_vault_secret', { p_name: SAMU_VAULT_SECRET_NAME });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar de Vault';
    return { success: false, error: msg };
  }
}

export async function hasSamuApiKey(): Promise<boolean> {
  const admin = getAdminSupabase();

  try {
    const { data } = await admin.rpc('has_vault_secret', {
      p_name: SAMU_VAULT_SECRET_NAME,
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
 */
export async function getSamuApiKey(): Promise<string | null> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: SAMU_VAULT_SECRET_NAME,
    });

    if (error) return null;
    return data as string | null;
  } catch {
    return null;
  }
}

// ============================================================
// Prueba de conexión
// ============================================================

/**
 * Valida la API Key de Samu IA usando GET /api/users.
 *
 * Endpoint: GET https://api.samu.ai/api/users
 * Header:   apiKey: {value}
 *
 * Criterios:
 *   200 + array → connected (retorna userCount)
 *   401 / 403   → credencial inválida o sin permisos
 *   otro        → error técnico
 */
export async function testSamuHealth(): Promise<SamuHealthCheckResult> {
  const apiKey = await getSamuApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay API Key almacenada para Samu IA.',
    };
  }

  try {
    const response = await fetch('https://api.samu.ai/api/users', {
      method: 'GET',
      headers: { apiKey: apiKey.trim() },
    });

    if (response.status === 200) {
      const data = await response.json().catch(() => []);
      const userCount = Array.isArray(data) ? data.length : 0;
      return {
        success: true,
        message: 'Conexión con Samu IA verificada correctamente.',
        userCount,
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        error: 'INVALID_API_KEY',
        message: 'La API Key de Samu IA no es válida.',
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'PERMISSION_DENIED',
        message: 'La API Key no tiene permisos para este endpoint de Samu IA.',
      };
    }

    const body = await response.text().catch(() => '');
    return {
      success: false,
      error: 'API_ERROR',
      message: `Samu IA ${response.status}: ${body.slice(0, 300)}`,
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
