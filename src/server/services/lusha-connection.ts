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

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createHash } from 'crypto';

export const LUSHA_VAULT_SECRET_NAME = 'sellup_prospecting_lusha_api_key';

// ── Credential resolution types ────────────────────────────────────────────────

export type LushaCredentialResolution =
  | {
      ok: true;
      source: 'vault' | 'env_fallback';
      apiKey: string;
      safe: {
        fingerprint: string;
        length: number;
      };
    }
  | {
      ok: false;
      stage:
        | 'env_check'
        | 'admin_client'
        | 'vault_rpc'
        | 'secret_missing'
        | 'secret_empty'
        | 'failed';
      safe: Record<string, unknown>;
    };

// ── Admin client ───────────────────────────────────────────────────────────────

// Uses the shared fail-closed factory (createSupabaseAdminClient), which reads
// env at call time via the env-guard and throws UnsafeSupabaseEnvironmentError
// instead of ever falling back to a hardcoded production project. Credential
// resolution below catches that throw and preserves the LUSHA_API_KEY fallback.

function fp(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 8);
}

// ── Unified credential resolver ────────────────────────────────────────────────

/**
 * Single source of truth for Lusha credential resolution.
 * Reads env vars at call time so Vercel runtime values are always current.
 * `apiKey` is returned only server-side — never send to the browser.
 */
export async function resolveLushaCredential(): Promise<LushaCredentialResolution> {
  const lushaEnvFallback = process.env['LUSHA_API_KEY']?.trim() || null;

  // A. Admin client
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    if (lushaEnvFallback) {
      return {
        ok: true,
        source: 'env_fallback',
        apiKey: lushaEnvFallback,
        safe: { fingerprint: fp(lushaEnvFallback), length: lushaEnvFallback.length },
      };
    }
    return { ok: false, stage: 'env_check', safe: {} };
  }

  // B. Vault RPC
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.rpc as any)('get_vault_secret_decrypted', {
      p_name: LUSHA_VAULT_SECRET_NAME,
    });

    if (!error) {
      const raw = typeof data === 'string' ? data.trim() : null;
      if (raw) {
        return {
          ok: true,
          source: 'vault',
          apiKey: raw,
          safe: { fingerprint: fp(raw), length: raw.length },
        };
      }
      if (data !== null && data !== undefined) {
        // RPC returned a value but it's not a usable string — fall through to env
      } else {
        // secret_missing
        if (lushaEnvFallback) {
          return {
            ok: true,
            source: 'env_fallback',
            apiKey: lushaEnvFallback,
            safe: { fingerprint: fp(lushaEnvFallback), length: lushaEnvFallback.length },
          };
        }
        return { ok: false, stage: 'secret_missing', safe: {} };
      }
    }
  } catch {
    // vault RPC threw — fall through to env fallback
  }

  // C. Env fallback
  if (lushaEnvFallback) {
    return {
      ok: true,
      source: 'env_fallback',
      apiKey: lushaEnvFallback,
      safe: { fingerprint: fp(lushaEnvFallback), length: lushaEnvFallback.length },
    };
  }

  return { ok: false, stage: 'vault_rpc', safe: {} };
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
  const admin = createSupabaseAdminClient();

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
  const admin = createSupabaseAdminClient();

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
  const admin = createSupabaseAdminClient();

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
 * Recupera la API Key descifrada desde Vault o env fallback.
 * USO EXCLUSIVO en backend seguro. NUNCA retornar al frontend. NUNCA loggear el valor.
 * Usa resolveLushaCredential() como única fuente de verdad.
 */
export async function getLushaApiKey(): Promise<string | null> {
  const resolution = await resolveLushaCredential();
  return resolution.ok ? resolution.apiKey : null;
}

// ============================================================
// Prueba de conexión — sin consumir créditos de enriquecimiento
// ============================================================

/**
 * Valida la API Key de Lusha usando el endpoint de estadísticas de cuenta.
 *
 * Endpoint: GET https://api.lusha.com/account/usage
 * Header:   api_key: {api_key}
 * Respuesta exitosa: 200 OK (o 429 rate-limited — key válida, Lusha solo throttlea requests autenticadas)
 *
 * NO consume créditos de enriquecimiento.
 * Rate limit específico: 5 req/minuto.
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
    const response = await fetch('https://api.lusha.com/account/usage', {
      method: 'GET',
      headers: { 'api_key': apiKey.trim() },
    });
    const body = await response.text().catch(() => '');

    // 200 = success, 429 = rate limited (key valid)
    if (response.status === 200 || response.status === 429) {
      return { success: true, message: 'Conexión con Lusha verificada correctamente.' };
    }

    if (response.status === 400 || response.status === 401) {
      return {
        success: false,
        error: 'INVALID_API_KEY',
        message: 'La API Key de Lusha no es válida o tiene un formato incorrecto.',
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'PERMISSION_DENIED',
        message: 'La API Key no tiene permisos para este endpoint de Lusha.',
      };
    }

    return {
      success: false,
      error: 'API_ERROR',
      message: `Lusha ${response.status}: ${body.slice(0, 200)}`,
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
