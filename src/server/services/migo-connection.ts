/**
 * Migo API Connection Service
 *
 * Gestión segura de credenciales de Migo API usando Supabase Vault.
 * La API Key NUNCA se retorna al frontend ni se registra en logs.
 *
 * Vault secret name: sellup_source_pe_migo_api_api_key
 *
 * Test de conexión:
 *   GET https://api.migo.pe/api/v1/ruc/{ruc} con un RUC conocido
 *   para validar que la API Key funciona. No persiste ningún dato.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const MIGO_VAULT_SECRET_NAME = 'sellup_source_pe_migo_api_api_key';

const MIGO_API_BASE = 'https://api.migo.pe';
const TEST_RUC = '20100047218';
const REQUEST_TIMEOUT_MS = 15_000;

function getAdminSupabase() {
  if (!supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

export interface MigoConnectionTestResult {
  success: boolean;
  error?: string;
  message?: string;
  responseTimeMs?: number;
}

export async function storeMigoApiKey(
  apiKey: string
): Promise<{ success: boolean; vaultSecretId?: string; error?: string; message?: string }> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('upsert_vault_secret', {
      p_name: MIGO_VAULT_SECRET_NAME,
      p_secret: apiKey,
      p_description: 'API Key de Migo API para consulta RUC/CIIU Perú en SellUp',
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

export async function removeMigoApiKey(): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminSupabase();

  try {
    await admin.rpc('delete_vault_secret', { p_name: MIGO_VAULT_SECRET_NAME });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar de Vault';
    return { success: false, error: msg };
  }
}

export async function hasMigoApiKey(): Promise<boolean> {
  const admin = getAdminSupabase();

  try {
    const { data } = await admin.rpc('has_vault_secret', {
      p_name: MIGO_VAULT_SECRET_NAME,
    });
    return data === true;
  } catch {
    return false;
  }
}

export async function getMigoApiKey(): Promise<string | null> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: MIGO_VAULT_SECRET_NAME,
    });

    if (!error && data) return data as string;
  } catch {
  }

  if (process.env.NODE_ENV !== 'production') {
    return process.env.MIGO_API_KEY ?? null;
  }

  return null;
}

export function maskMigoApiKey(apiKey: string): string {
  if (apiKey.length < 8) return '****';
  const last4 = apiKey.slice(-4);
  return `****${last4}`;
}

/**
 * Valida la API Key de Migo mediante una consulta mínima real.
 *
 * Endpoint: GET https://api.migo.pe/api/v1/ruc/{ruc}
 * Auth:     Authorization: Bearer {api_key}
 *
 * No persiste ningún dato de la respuesta.
 * Solo valida que la credencial sea válida.
 */
export async function testMigoConnection(): Promise<MigoConnectionTestResult> {
  const apiKey = await getMigoApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay API Key de Migo almacenada.',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const response = await fetch(`${MIGO_API_BASE}/api/v1/ruc/${TEST_RUC}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startMs;

    if (response.status === 200) {
      return {
        success: true,
        message: 'Conexión con Migo API verificada correctamente.',
        responseTimeMs,
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        error: 'INVALID_API_KEY',
        message: 'La API Key de Migo no es válida o ha expirado.',
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'PERMISSION_DENIED',
        message: 'La API Key no tiene permisos para este endpoint de Migo.',
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'RATE_LIMIT',
        message: 'Límite de consultas Migo alcanzado. Verifica tu plan.',
      };
    }

    const body = await response.text().catch(() => '');
    return {
      success: false,
      error: 'API_ERROR',
      message: `Migo API ${response.status}: ${body.slice(0, 300)}`,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';

    return {
      success: false,
      error: isTimeout ? 'TIMEOUT' : 'CONNECTION_ERROR',
      message: isTimeout
        ? 'Timeout al conectar con Migo API (>15s).'
        : `Error de conexión: ${err instanceof Error ? err.message : 'desconocido'}`,
    };
  }
}
