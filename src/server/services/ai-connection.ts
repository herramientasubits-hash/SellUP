/**
 * AI Provider Connection Service
 *
 * Gestión segura de credenciales de proveedores de IA usando Supabase Vault.
 * Las API keys se almacenan CIFRADAS en vault.secrets.
 * Las tablas funcionales (ai_providers) solo guardan vault_secret_id — nunca el secreto.
 *
 * Naming convention de secretos en Vault: sellup_ai_{provider_key}
 * Ejemplo: sellup_ai_openai, sellup_ai_google, sellup_ai_anthropic
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

/** Nombre canónico del secreto en Vault para un proveedor de IA. */
function vaultSecretName(providerKey: string): string {
  return `sellup_ai_${providerKey}`;
}

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  message?: string;
}

// ============================================================
// Gestión de credenciales via Vault
// ============================================================

/**
 * Guarda (o actualiza) la API key de un proveedor en Vault.
 * Retorna el vault_secret_id para almacenar en ai_providers.
 */
export async function storeAiProviderCredential(
  providerKey: string,
  apiKey: string
): Promise<{ success: boolean; vaultSecretId?: string; error?: string; message?: string }> {
  const admin = getAdminSupabase();
  const secretName = vaultSecretName(providerKey);

  try {
    const { data, error } = await admin.rpc('upsert_vault_secret', {
      p_name: secretName,
      p_secret: apiKey,
      p_description: `API key para proveedor de IA: ${providerKey}`,
    });

    if (error) throw error;

    const vaultSecretId = data as string;

    // Guardar referencia en ai_providers (solo el UUID, nunca el secreto)
    await admin
      .from('ai_providers')
      .update({
        vault_secret_id: vaultSecretId,
        credentials_status: 'configured',
        updated_at: new Date().toISOString(),
      })
      .eq('key', providerKey);

    return {
      success: true,
      vaultSecretId,
      message: 'Credencial almacenada de forma segura en Vault',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al almacenar en Vault';
    return { success: false, error: 'VAULT_STORAGE_ERROR', message: msg };
  }
}

/**
 * Elimina la API key de Vault y limpia la referencia en ai_providers.
 */
export async function removeAiProviderCredential(
  providerKey: string
): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminSupabase();
  const secretName = vaultSecretName(providerKey);

  try {
    await admin.rpc('delete_vault_secret', { p_name: secretName });

    await admin
      .from('ai_providers')
      .update({
        vault_secret_id: null,
        credentials_status: 'missing',
        updated_at: new Date().toISOString(),
      })
      .eq('key', providerKey);

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar de Vault';
    return { success: false, error: msg };
  }
}

/**
 * Verifica si existe credencial almacenada en Vault para el proveedor.
 * Usa la convención de nombres nueva: sellup_ai_{providerKey}
 */
export async function hasAiProviderCredential(providerKey: string): Promise<boolean> {
  const admin = getAdminSupabase();
  const secretName = vaultSecretName(providerKey);

  try {
    const { data } = await admin.rpc('has_vault_secret', { p_name: secretName });
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Verifica si existe un secreto en Vault por su nombre exacto.
 * Útil para chequear convenciones alternativas de nombres (legacy, etc.).
 */
export async function hasVaultSecretByRawName(rawName: string): Promise<boolean> {
  const admin = getAdminSupabase();
  try {
    const { data } = await admin.rpc('has_vault_secret', { p_name: rawName });
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Recupera la API key descifrada desde Vault por su nombre exacto.
 * USO EXCLUSIVO en backend seguro.
 * NUNCA retornar al frontend. NUNCA loggear el valor.
 */
export async function getVaultSecretByRawName(
  rawName: string
): Promise<{ success: boolean; apiKey?: string; error?: string }> {
  const admin = getAdminSupabase();
  try {
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', { p_name: rawName });
    if (error) throw error;
    if (!data) return { success: false, error: 'CREDENTIAL_NOT_FOUND' };
    return { success: true, apiKey: data as string };
  } catch {
    return { success: false, error: 'VAULT_READ_ERROR' };
  }
}

/**
 * Recupera la API key descifrada desde Vault.
 * USO EXCLUSIVO en backend seguro para probar conexiones.
 * NUNCA retornar al frontend. NUNCA loggear el valor.
 */
export async function getAiProviderCredential(
  providerKey: string
): Promise<{ success: boolean; apiKey?: string; error?: string }> {
  const admin = getAdminSupabase();
  const secretName = vaultSecretName(providerKey);

  try {
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: secretName,
    });

    if (error) throw error;
    if (!data) return { success: false, error: 'CREDENTIAL_NOT_FOUND' };

    return { success: true, apiKey: data as string };
  } catch {
    return { success: false, error: 'VAULT_READ_ERROR' };
  }
}

// ============================================================
// Pruebas de conexión con cada proveedor
// ============================================================

export async function testGeminiWithKey(apiKey: string): Promise<ConnectionTestResult> {
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=10',
      {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'INVALID_API_KEY', message: 'La API key de Gemini no es válida o está vencida' };
      }
      if (response.status === 403) {
        return { success: false, error: 'PERMISSION_DENIED', message: 'La API key no tiene permisos para acceder a Gemini' };
      }
      const body = await response.text().catch(() => '');
      return { success: false, error: 'API_ERROR', message: `Error de Gemini: ${response.status} — ${body.slice(0, 200)}` };
    }

    const data = await response.json();
    const modelCount: number = data.models?.length ?? 0;
    return { success: true, message: `Conexión exitosa. Modelos disponibles: ${modelCount}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { success: false, error: 'CONNECTION_ERROR', message: `Error de conexión: ${msg}` };
  }
}

export async function testOpenAIConnection(apiKey: string): Promise<ConnectionTestResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'INVALID_API_KEY', message: 'La API key de OpenAI no es válida' };
      }
      return { success: false, error: 'API_ERROR', message: `Error de OpenAI: ${response.status}` };
    }

    const data = await response.json();
    const modelCount: number = (data.data as unknown[])?.length ?? 0;
    return { success: true, message: `Conexión exitosa. Modelos disponibles: ${modelCount}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { success: false, error: 'CONNECTION_ERROR', message: `Error de conexión: ${msg}` };
  }
}

export async function testClaudeConnection(apiKey: string): Promise<ConnectionTestResult> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'INVALID_API_KEY', message: 'La API key de Claude no es válida' };
      }
      return { success: false, error: 'API_ERROR', message: `Error de Claude: ${response.status}` };
    }

    const data = await response.json();
    const modelCount: number = (data.data as unknown[])?.length ?? 0;
    return { success: true, message: `Conexión exitosa. Modelos disponibles: ${modelCount}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { success: false, error: 'CONNECTION_ERROR', message: `Error de conexión: ${msg}` };
  }
}

/** Unused — kept for backward compat with legacy callers during transition */
export async function testGeminiConnection(): Promise<ConnectionTestResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'MISSING_API_KEY', message: 'No se encontró GEMINI_API_KEY en variables de entorno del servidor' };
  }
  return testGeminiWithKey(apiKey);
}
