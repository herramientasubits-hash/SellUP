/**
 * HubSpot Connection Service
 *
 * Gestión segura de credenciales de HubSpot usando Supabase Vault.
 * El token NUNCA se retorna al frontend ni se registra en logs.
 * La tabla external_integration_connections solo guarda vault_secret_id — nunca el secreto.
 *
 * Naming convention del secreto en Vault: sellup_integration_hubspot
 *
 * Uses the shared fail-closed factory (createSupabaseAdminClient), which reads
 * resolveSupabaseServiceRoleEnv and throws UnsafeSupabaseEnvironmentError when
 * config is missing or a non-production environment resolves to production.
 * This replaces the previous inline admin client that fell back to a hardcoded
 * production host and threw a generic misconfiguration error. Env is now read
 * at call time by the factory, not once at import time.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const INTEGRATION_KEY = 'hubspot';
const VAULT_SECRET_NAME = 'sellup_integration_hubspot';

export interface HubSpotTokenInfo {
  hubId: number;
  appId: number;
  userId: number;
  scopes: string[];
}

export interface HubSpotScopeReadiness {
  availableScopes: string[];
  canReadCompanies: boolean;
  canWriteCompanies: boolean;
  missingReadScopes: string[];
  missingWriteScopes: string[];
}

export interface HubSpotConnectionTestResult {
  success: boolean;
  error?: string;
  message?: string;
  tokenInfo?: HubSpotTokenInfo;
  hubspotScopes?: HubSpotScopeReadiness;
}

const REQUIRED_READ_SCOPES = ['crm.objects.companies.read'];
const REQUIRED_WRITE_SCOPES = ['crm.objects.companies.write'];

export function computeHubSpotScopeReadiness(scopes: string[]): HubSpotScopeReadiness {
  const missingReadScopes = REQUIRED_READ_SCOPES.filter((s) => !scopes.includes(s));
  const missingWriteScopes = REQUIRED_WRITE_SCOPES.filter((s) => !scopes.includes(s));
  return {
    availableScopes: scopes,
    canReadCompanies: missingReadScopes.length === 0,
    canWriteCompanies: missingWriteScopes.length === 0,
    missingReadScopes,
    missingWriteScopes,
  };
}

// ============================================================
// Gestión de credenciales via Vault
// ============================================================

/**
 * Guarda (o actualiza) el token de HubSpot en Vault.
 * Almacena el vault_secret_id en external_integration_connections — nunca el token.
 */
export async function storeHubSpotCredential(
  token: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const admin = createSupabaseAdminClient();

  try {
    const { data, error } = await admin.rpc('upsert_vault_secret', {
      p_name: VAULT_SECRET_NAME,
      p_secret: token,
      p_description: 'Private App Access Token de HubSpot para SellUp',
    });

    if (error) throw error;

    const vaultSecretId = data as string;

    // Guardar referencia en external_integration_connections (solo el UUID, nunca el token)
    await admin
      .from('external_integration_connections')
      .update({
        vault_secret_id: vaultSecretId,
        credentials_status: 'stored',
        updated_at: new Date().toISOString(),
      })
      .eq('integration_key', INTEGRATION_KEY);

    return {
      success: true,
      message: 'Credencial almacenada de forma segura en Vault',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al almacenar en Vault';
    return { success: false, error: 'VAULT_STORAGE_ERROR', message: msg };
  }
}

/**
 * Elimina el token de HubSpot de Vault y limpia la referencia en la tabla.
 */
export async function removeHubSpotCredential(): Promise<{
  success: boolean;
  error?: string;
}> {
  const admin = createSupabaseAdminClient();

  try {
    const { error: deleteError } = await admin.rpc('delete_vault_secret', {
      p_name: VAULT_SECRET_NAME,
    });
    if (deleteError) throw deleteError;

    await admin
      .from('external_integration_connections')
      .update({
        vault_secret_id: null,
        credentials_status: 'missing',
        connection_status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('integration_key', INTEGRATION_KEY);

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar de Vault';
    return { success: false, error: msg };
  }
}

/**
 * Verifica si existe credencial almacenada en Vault para HubSpot.
 */
export async function hasHubSpotCredential(): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  try {
    const { data } = await admin.rpc('has_vault_secret', { p_name: VAULT_SECRET_NAME });
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Recupera el token descifrado desde Vault.
 * USO EXCLUSIVO en backend seguro para probar conexiones.
 * NUNCA retornar al frontend. NUNCA loggear el valor.
 */
async function getHubSpotToken(): Promise<string | null> {
  const admin = createSupabaseAdminClient();

  try {
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: VAULT_SECRET_NAME,
    });

    if (error) return null;
    return data as string | null;
  } catch {
    return null;
  }
}

// ============================================================
// Prueba de conexión contra HubSpot API
// ============================================================

/**
 * Verifica que el token de HubSpot sea válido usando el endpoint
 * de información de token de Private Apps.
 * No retorna el token al cliente en ningún caso.
 */
export async function testHubSpotConnection(): Promise<HubSpotConnectionTestResult> {
  const token = await getHubSpotToken();

  if (!token) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay credencial almacenada para HubSpot.',
    };
  }

  try {
    const response = await fetch(
      'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tokenKey: token }),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');

      if (response.status === 401) {
        return {
          success: false,
          error: 'INVALID_TOKEN',
          message: 'El token de HubSpot no es válido o está vencido.',
        };
      }

      if (response.status === 403) {
        return {
          success: false,
          error: 'PERMISSION_DENIED',
          message: 'El token no tiene permisos suficientes.',
        };
      }

      return {
        success: false,
        error: 'API_ERROR',
        message: `Error de HubSpot API: ${response.status}. ${body.slice(0, 200)}`,
      };
    }

    const data = await response.json();

    const tokenInfo: HubSpotTokenInfo = {
      hubId: data.hubId ?? data.hub_id ?? 0,
      appId: data.appId ?? data.app_id ?? 0,
      userId: data.userId ?? data.user_id ?? 0,
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
    };

    const scopeCount = tokenInfo.scopes.length;
    const hubspotScopes = computeHubSpotScopeReadiness(tokenInfo.scopes);
    return {
      success: true,
      message: `Conexión exitosa. Hub ID: ${tokenInfo.hubId}. Scopes: ${scopeCount}.`,
      tokenInfo,
      hubspotScopes,
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
