import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const MIGO_VAULT_SECRET_NAME = 'sellup_source_pe_migo_api_api_key';

const MIGO_API_BASE = 'https://api.migo.pe';
const MIGO_API_PATH = '/api/v1/ruc';
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
  httpStatus?: number;
  responseTimeMs?: number;
  maskedKey?: string;
  checkedAt?: string;
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
  try {
    const admin = getAdminSupabase();

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

export async function testMigoConnection(): Promise<MigoConnectionTestResult> {
  const apiKey = await getMigoApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay API Key de Migo almacenada.',
    };
  }

  const maskedKey = maskMigoApiKey(apiKey);
  const checkedAt = new Date().toISOString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startMs = Date.now();

  try {
    const response = await fetch(`${MIGO_API_BASE}${MIGO_API_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        token: apiKey,
        ruc: TEST_RUC,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startMs;
    const httpStatus = response.status;

    if (response.status === 200) {
      const body = await response.json().catch(() => ({}));
      if (body?.success === false) {
        return {
          success: false,
          error: 'API_ERROR',
          message: 'La API de Migo respondió pero rechazó la consulta.',
          httpStatus,
          responseTimeMs,
          maskedKey,
          checkedAt,
        };
      }
      return {
        success: true,
        message: 'Conexión con Migo validada correctamente.',
        httpStatus,
        responseTimeMs,
        maskedKey,
        checkedAt,
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        error: 'INVALID_API_KEY',
        message: 'La API key de Migo no fue autorizada.',
        httpStatus,
        responseTimeMs,
        maskedKey,
        checkedAt,
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'INVALID_API_KEY',
        message: 'La API key de Migo no fue autorizada.',
        httpStatus,
        responseTimeMs,
        maskedKey,
        checkedAt,
      };
    }

    if (response.status === 404) {
      return {
        success: false,
        error: 'ENDPOINT_NOT_FOUND',
        message: 'No se encontró el endpoint de Migo configurado. Revisa la URL base o path de API.',
        httpStatus,
        responseTimeMs,
        maskedKey,
        checkedAt,
      };
    }

    if (response.status === 405) {
      return {
        success: false,
        error: 'ENDPOINT_NOT_FOUND',
        message: 'No se encontró el endpoint de Migo configurado. Revisa la URL base o path de API.',
        httpStatus,
        responseTimeMs,
        maskedKey,
        checkedAt,
      };
    }

    if (response.status === 422) {
      return {
        success: false,
        error: 'API_ERROR',
        message: 'La solicitud a Migo fue rechazada por datos inválidos.',
        httpStatus,
        responseTimeMs,
        maskedKey,
        checkedAt,
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'RATE_LIMIT',
        message: 'Límite de consultas Migo alcanzado. Revisa tu plan.',
        httpStatus,
        responseTimeMs,
        maskedKey,
        checkedAt,
      };
    }

    if (response.status >= 500) {
      return {
        success: false,
        error: 'API_ERROR',
        message: `Migo API respondió con error de servidor (HTTP ${response.status}).`,
        httpStatus,
        responseTimeMs,
        maskedKey,
        checkedAt,
      };
    }

    return {
      success: false,
      error: 'API_ERROR',
      message: `Migo API respondió con código inesperado (HTTP ${response.status}).`,
      httpStatus,
      responseTimeMs,
      maskedKey,
      checkedAt,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const checkedAt = new Date().toISOString();

    return {
      success: false,
      error: isTimeout ? 'TIMEOUT' : 'CONNECTION_ERROR',
      message: isTimeout
        ? 'Tiempo de espera agotado al conectar con Migo API.'
        : `Error de conexión con Migo API: ${err instanceof Error ? err.message : 'desconocido'}`,
      responseTimeMs: Date.now() - startMs,
      maskedKey,
      checkedAt,
    };
  }
}
