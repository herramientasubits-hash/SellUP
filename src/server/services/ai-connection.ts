/**
 * AI Provider Connection Service
 * 
 * Maneja la verificación segura de conexiones a proveedores de IA.
 * Las API keys se almacenan en Supabase (tabla local alternativa a Vault).
 */

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

async function ensureCredentialsTable(adminClient: any) {
  try {
    await adminClient
      .from('ai_provider_credentials')
      .select('id')
      .limit(1);
  } catch (err: any) {
    if (err.message?.includes('does not exist')) {
      console.log('Creando tabla ai_provider_credentials...');
      await adminClient
        .from('ai_provider_credentials')
        .insert({
          provider_key: '_init',
          encrypted_key: '_init'
        })
        .then(() => adminClient
          .from('ai_provider_credentials')
          .delete()
          .eq('provider_key', '_init'))
        .catch(() => {});
    }
  }
}

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  message?: string;
}

export async function storeAiProviderCredential(
  providerKey: string,
  apiKey: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  console.log('[storeAiProviderCredential] Iniciando...', { providerKey, apiKeyLength: apiKey?.length });
  
  const adminClient = getAdminSupabase();
  console.log('[storeAiProviderCredential] AdminClient creado');

  try {
    console.log('[storeAiProviderCredential] Verificando tabla...');
    await ensureCredentialsTable(adminClient);

    console.log('[storeAiProviderCredential] Buscando credencial existente...');
    const { data: existing, error: selectError } = await adminClient
      .from('ai_provider_credentials')
      .select('id')
      .eq('provider_key', providerKey)
      .single();
    
    console.log('[storeAiProviderCredential] Existing:', existing, 'SelectError:', selectError);

    if (existing) {
      console.log('[storeAiProviderCredential] Actualizando...');
      const { error: updateError } = await adminClient
        .from('ai_provider_credentials')
        .update({ 
          encrypted_key: apiKey,
          updated_at: new Date().toISOString()
        })
        .eq('provider_key', providerKey);

      console.log('[storeAiProviderCredential] UpdateError:', updateError);
      if (updateError) throw updateError;
    } else {
      console.log('[storeAiProviderCredential] Insertando nueva...');
      const { error: insertError } = await adminClient
        .from('ai_provider_credentials')
        .insert({
          provider_key: providerKey,
          encrypted_key: apiKey
        });

      if (insertError) throw insertError;
    }

    console.log('[storeAiProviderCredential] Éxito!');
    return { success: true, message: 'Credencial almacenada de forma segura' };
  } catch (error: unknown) {
    console.error('[storeAiProviderCredential] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error al almacenar la credencial';
    return { 
      success: false, 
      error: 'STORAGE_ERROR', 
      message: errorMessage
    };
  }
}

export async function removeAiProviderCredential(
  providerKey: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const adminClient = getAdminSupabase();

  try {
    const { error: deleteError } = await adminClient
      .from('ai_provider_credentials')
      .delete()
      .eq('provider_key', providerKey);

    if (deleteError) throw deleteError;

    return { success: true, message: 'Credencial eliminada' };
  } catch (error: unknown) {
    console.error('Error removing credential:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error al eliminar la credencial';
    return { 
      success: false, 
      error: 'REMOVAL_ERROR', 
      message: errorMessage
    };
  }
}

export async function getAiProviderCredential(
  providerKey: string
): Promise<{ success: boolean; apiKey?: string; error?: string }> {
  const adminClient = getAdminSupabase();

  try {
    const { data: credential, error } = await adminClient
      .from('ai_provider_credentials')
      .select('encrypted_key')
      .eq('provider_key', providerKey)
      .single();

    if (error || !credential) {
      return { success: false, error: 'CREDENTIAL_NOT_FOUND' };
    }

    return { success: true, apiKey: credential.encrypted_key };
  } catch (error: unknown) {
    console.error('Error getting credential:', error);
    return { success: false, error: 'READ_ERROR' };
  }
}

export async function hasAiProviderCredential(
  providerKey: string
): Promise<boolean> {
  const adminClient = getAdminSupabase();

  try {
    const { data } = await adminClient
      .from('ai_provider_credentials')
      .select('id')
      .eq('provider_key', providerKey)
      .single();

    return !!data;
  } catch {
    return false;
  }
}

export async function testGeminiConnection(): Promise<ConnectionTestResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  
  if (!apiKey) {
    return {
      success: false,
      error: 'MISSING_API_KEY',
      message: 'No se encontró GEMINI_API_KEY en las variables de entorno del servidor'
    };
  }

  return testGeminiWithKey(apiKey);
}

export async function testGeminiWithKey(apiKey: string): Promise<ConnectionTestResult> {
  console.log('[testGeminiWithKey] API key primeras 10 chars:', apiKey.substring(0, 10));
  console.log('[testGeminiWithKey] API key longitud:', apiKey.length);
  
try {
    // Google AI Studio usa x-goog-api-key en lugar de Bearer
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=10',
      {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[testGeminiWithKey] Response status:', response.status);
    console.log('[testGeminiWithKey] Response ok:', response.ok);

    if (!response.ok) {
      let bodyText = '';
      try { bodyText = await response.text(); } catch {}
      console.log('[testGeminiWithKey] Error body:', bodyText);

      if (response.status === 401) {
        return {
          success: false,
          error: 'INVALID_API_KEY',
          message: 'La API key de Gemini no es válida o está vencida'
        };
      }

      if (response.status === 403) {
        return {
          success: false,
          error: 'PERMISSION_DENIED',
          message: 'La API key no tiene permisos para acceder a la API de Gemini'
        };
      }

      return {
        success: false,
        error: 'API_ERROR',
        message: `Error de la API de Gemini: ${response.status} — ${bodyText.slice(0, 200)}`
      };
    }

    const data = await response.json();
    
    if (data.models && data.models.length > 0) {
      return {
        success: true,
        message: `Conexión exitosa. Modelos disponibles: ${data.models.length}`
      };
    }

    return {
      success: false,
      error: 'NO_MODELS',
      message: 'Conexión exitosa pero no se encontraron modelos disponibles'
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    
    return {
      success: false,
      error: 'CONNECTION_ERROR',
      message: `Error de conexión: ${errorMessage}`
    };
  }
}

export async function testOpenAIConnection(apiKey: string): Promise<ConnectionTestResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          error: 'INVALID_API_KEY',
          message: 'La API key de OpenAI no es válida'
        };
      }
      return {
        success: false,
        error: 'API_ERROR',
        message: `Error de OpenAI: ${response.status}`
      };
    }

    const data = await response.json();
    const modelCount = data.data?.length || 0;

    return {
      success: true,
      message: `Conexión exitosa. Modelos disponibles: ${modelCount}`
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return {
      success: false,
      error: 'CONNECTION_ERROR',
      message: `Error de conexión: ${errorMessage}`
    };
  }
}

export async function testClaudeConnection(apiKey: string): Promise<ConnectionTestResult> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          error: 'INVALID_API_KEY',
          message: 'La API key de Claude no es válida'
        };
      }
      return {
        success: false,
        error: 'API_ERROR',
        message: `Error de Claude: ${response.status}`
      };
    }

    const data = await response.json();
    const modelCount = data.data?.length || 0;

    return {
      success: true,
      message: `Conexión exitosa. Modelos disponibles: ${modelCount}`
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return {
      success: false,
      error: 'CONNECTION_ERROR',
      message: `Error de conexión: ${errorMessage}`
    };
  }
}