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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminSupabase() {
  if (!supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable');
  }
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

// ============================================================
// Anthropic model listing and execution testing
// ============================================================

export interface AnthropicModel {
  id: string;
  display_name: string | null;
  created_at: string | null;
  type: string | null;
}

/**
 * Lists available models for the given Anthropic API key via GET /v1/models.
 * Note: a model appearing here does NOT guarantee it can execute — only that
 * the key has list access. Use testAnthropicModelExecution to confirm execution.
 * NEVER logs the apiKey.
 */
export async function listAnthropicModels(apiKey: string): Promise<{
  ok: boolean;
  models?: AnthropicModel[];
  error?: string;
}> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });

    if (!response.ok) {
      if (response.status === 401) return { ok: false, error: 'INVALID_API_KEY' };
      return { ok: false, error: `API_ERROR_${response.status}` };
    }

    const data = await response.json();
    const models: AnthropicModel[] = ((data.data ?? []) as Record<string, unknown>[]).map((m) => ({
      id: m.id as string,
      display_name: (m.display_name as string) ?? null,
      created_at: (m.created_at as string) ?? null,
      type: (m.type as string) ?? null,
    }));

    return { ok: true, models };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, error: `CONNECTION_ERROR: ${msg}` };
  }
}

export interface AnthropicExecutionTestResult {
  ok: boolean;
  model_id: string;
  latency_ms?: number;
  status?: number;
  error_code?: string;
  error_message?: string;
  request_id?: string;
}

/**
 * Tests real generation execution for a specific Anthropic model via POST /v1/messages.
 * Uses a minimal prompt (max_tokens=16) to confirm the model is actually executable.
 * NEVER logs the apiKey.
 */
export async function testAnthropicModelExecution({
  apiKey,
  modelId,
}: {
  apiKey: string;
  modelId: string;
}): Promise<AnthropicExecutionTestResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply only: ok' }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    const requestId = response.headers.get('request-id') ?? undefined;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let errorCode = `HTTP_${response.status}`;
      let errorMessage = body.slice(0, 200);
      try {
        const parsed = JSON.parse(body) as { error?: { type?: string; message?: string } };
        if (parsed?.error?.type) errorCode = parsed.error.type;
        if (parsed?.error?.message) errorMessage = parsed.error.message;
      } catch {}

      return {
        ok: false,
        model_id: modelId,
        status: response.status,
        error_code: errorCode,
        error_message: errorMessage,
        request_id: requestId,
        latency_ms: latency,
      };
    }

    return { ok: true, model_id: modelId, latency_ms: latency };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      model_id: modelId,
      error_code: 'CONNECTION_ERROR',
      error_message: msg,
    };
  }
}

/**
 * Two-level Claude connection test:
 *   Level 1 — API key valid (GET /v1/models).
 *   Level 2 — Specific model executes (POST /v1/messages).
 *
 * If modelIdToTest is provided, level 2 uses that model.
 * Otherwise, the first model from the list API is tried.
 *
 * Returns:
 *   success=true  → "Conectado. Modelo validado correctamente."
 *   success=false, error=MODEL_NOT_EXECUTABLE → "API key válida, pero el modelo no está disponible."
 *   success=false, error=INVALID_API_KEY → "Credencial inválida."
 */
export async function testClaudeConnection(
  apiKey: string,
  modelIdToTest?: string
): Promise<ConnectionTestResult> {
  // Level 1: validate API key via model list
  const listResult = await listAnthropicModels(apiKey);
  if (!listResult.ok) {
    if (listResult.error === 'INVALID_API_KEY') {
      return { success: false, error: 'INVALID_API_KEY', message: 'La API key de Claude no es válida o está vencida' };
    }
    return { success: false, error: listResult.error ?? 'API_ERROR', message: `Error al conectar con Anthropic: ${listResult.error}` };
  }

  const availableIds = (listResult.models ?? []).map((m) => m.id);

  // Level 2: test real execution
  const candidateIds: string[] = [];
  if (modelIdToTest) {
    candidateIds.push(modelIdToTest);
  }
  // Always append first few available as fallback candidates for the test
  availableIds
    .filter((id) => !candidateIds.includes(id))
    .slice(0, 3)
    .forEach((id) => candidateIds.push(id));

  for (const modelId of candidateIds) {
    const execResult = await testAnthropicModelExecution({ apiKey, modelId });
    if (execResult.ok) {
      const testedLabel = modelIdToTest === modelId ? ` (modelo activo: ${modelId})` : ` (${modelId})`;
      return {
        success: true,
        message: `Conectado. Modelo validado correctamente${testedLabel}. Latencia: ${execResult.latency_ms}ms`,
      };
    }
    // If the tested active model fails, surface that specifically
    if (modelIdToTest && modelId === modelIdToTest) {
      return {
        success: false,
        error: 'MODEL_NOT_EXECUTABLE',
        message: `API key válida (${availableIds.length} modelos en lista), pero el modelo seleccionado "${modelId}" no está disponible. Selecciona otro modelo en Configuración > Proveedores de IA.`,
      };
    }
  }

  return {
    success: false,
    error: 'MODEL_NOT_EXECUTABLE',
    message: `API key válida (${availableIds.length} modelos en lista), pero ningún modelo pudo ejecutarse. Verifica los permisos de tu plan Anthropic o usa "Actualizar modelos disponibles".`,
  };
}

/** Unused — kept for backward compat with legacy callers during transition */
export async function testGeminiConnection(): Promise<ConnectionTestResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'MISSING_API_KEY', message: 'No se encontró GEMINI_API_KEY en variables de entorno del servidor' };
  }
  return testGeminiWithKey(apiKey);
}
