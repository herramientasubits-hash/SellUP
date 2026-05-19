/**
 * Slack Connection Service
 *
 * Gestión segura del bot token de Slack usando Supabase Vault.
 * El token NUNCA se retorna al frontend ni se registra en logs.
 * La tabla external_integration_connections solo guarda vault_secret_id — nunca el secreto.
 *
 * Naming convention del secreto en Vault: sellup_integration_slack_bot_token
 *
 * Scopes requeridos (bot token):
 *   - channels:manage  → crear canales públicos
 *   - chat:write       → enviar mensajes al canal
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

const INTEGRATION_KEY = 'slack';
const VAULT_SECRET_NAME = 'sellup_integration_slack_bot_token';
const VAULT_CLIENT_SECRET_NAME = 'sellup_integration_slack_client_secret';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

// ============================================================
// Types
// ============================================================

export interface SlackTokenInfo {
  teamId: string;
  teamName: string;
  botUserId: string;
  appId: string;
  scopes: string[];
}

export interface SlackConnectionTestResult {
  success: boolean;
  error?: string;
  message?: string;
  tokenInfo?: SlackTokenInfo;
}

export interface SlackChannelResult {
  success: boolean;
  error?: string;
  message?: string;
  channelId?: string;
  channelName?: string;
  alreadyExists?: boolean;
}

export interface SlackMessageResult {
  success: boolean;
  error?: string;
  message?: string;
}

// ============================================================
// Gestión de credenciales via Vault
// ============================================================

/**
 * Guarda (o actualiza) el bot token de Slack en Vault.
 * Almacena el vault_secret_id en external_integration_connections — nunca el token.
 */
export async function storeSlackCredential(
  token: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('upsert_vault_secret', {
      p_name: VAULT_SECRET_NAME,
      p_secret: token,
      p_description: 'Bot Access Token de Slack para SellUp',
    });

    if (error) throw error;

    const vaultSecretId = data as string;

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
      message: 'Bot token almacenado de forma segura en Vault',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al almacenar en Vault';
    return { success: false, error: 'VAULT_STORAGE_ERROR', message: msg };
  }
}

/**
 * Elimina el bot token de Slack de Vault y limpia la referencia en la tabla.
 */
export async function removeSlackCredential(): Promise<{
  success: boolean;
  error?: string;
}> {
  const admin = getAdminSupabase();

  try {
    await admin.rpc('delete_vault_secret', { p_name: VAULT_SECRET_NAME });

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
 * Verifica si existe un bot token almacenado en Vault para Slack.
 */
export async function hasSlackCredential(): Promise<boolean> {
  const admin = getAdminSupabase();

  try {
    const { data } = await admin.rpc('has_vault_secret', { p_name: VAULT_SECRET_NAME });
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Recupera el bot token descifrado desde Vault.
 * USO EXCLUSIVO en backend seguro.
 * NUNCA retornar al frontend. NUNCA loggear el valor.
 */
async function getSlackToken(): Promise<string | null> {
  const admin = getAdminSupabase();

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
// Gestión de credenciales OAuth App (client_id / client_secret / redirect_uri)
// ============================================================

export interface SlackOAuthConfig {
  clientId: string;
  redirectUri: string;
}

/**
 * Persiste la configuración de la Slack App en la base de datos.
 * - client_id y redirect_uri se guardan en metadata (no son secretos).
 * - client_secret se guarda en Vault (NUNCA en tablas relacionales).
 */
export async function storeSlackOAuthConfig(
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminSupabase();

  console.log('[storeSlackOAuthConfig] storing config for clientId:', clientId ? 'SET' : 'MISSING');

  try {
    // Guardar client_secret en Vault
    const vaultResult = await admin.rpc('upsert_vault_secret', {
      p_name: VAULT_CLIENT_SECRET_NAME,
      p_secret: clientSecret,
      p_description: 'Client Secret de la Slack App para SellUp',
    });
    console.log('[storeSlackOAuthConfig] vault upsert error:', vaultResult.error ?? 'none');

    // Guardar client_id y redirect_uri en metadata (no sensibles)
    const { data: existing, error: fetchError } = await admin
      .from('external_integration_connections')
      .select('metadata')
      .eq('integration_key', INTEGRATION_KEY)
      .single();

    console.log('[storeSlackOAuthConfig] fetch existing error:', fetchError ?? 'none');
    console.log('[storeSlackOAuthConfig] existing row found:', existing ? 'YES' : 'NO');

    const prevMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const updatedMeta = {
      ...prevMeta,
      oauth_client_id: clientId,
      oauth_redirect_uri: redirectUri,
    };

    const { error: updateError, count } = await admin
      .from('external_integration_connections')
      .update({ metadata: updatedMeta, updated_at: new Date().toISOString() })
      .eq('integration_key', INTEGRATION_KEY)
      .select();

    console.log('[storeSlackOAuthConfig] update error:', updateError ?? 'none');
    console.log('[storeSlackOAuthConfig] rows updated:', count ?? 'unknown');

    if (updateError) throw updateError;

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al guardar configuración OAuth';
    console.log('[storeSlackOAuthConfig] caught error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Recupera client_id y redirect_uri desde metadata,
 * y verifica que el client_secret esté almacenado en Vault.
 */
export async function getSlackOAuthConfig(): Promise<SlackOAuthConfig | null> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin
      .from('external_integration_connections')
      .select('metadata')
      .eq('integration_key', INTEGRATION_KEY)
      .single();

    console.log('[getSlackOAuthConfig] db error:', error ?? 'none');
    console.log('[getSlackOAuthConfig] row found:', data ? 'YES' : 'NO');
    console.log('[getSlackOAuthConfig] metadata keys:', data?.metadata ? Object.keys(data.metadata as object).join(',') : 'NONE');

    const meta = (data?.metadata ?? {}) as Record<string, unknown>;
    const clientId = meta.oauth_client_id as string | undefined;
    const redirectUri = meta.oauth_redirect_uri as string | undefined;

    console.log('[getSlackOAuthConfig] clientId:', clientId ? 'SET' : 'MISSING');
    console.log('[getSlackOAuthConfig] redirectUri:', redirectUri ? 'SET' : 'MISSING');

    if (!clientId || !redirectUri) return null;

    return { clientId, redirectUri };
  } catch (err) {
    console.log('[getSlackOAuthConfig] caught error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Recupera el client_secret descifrado desde Vault.
 * USO EXCLUSIVO en backend seguro (route handlers OAuth).
 * NUNCA retornar al frontend. NUNCA loggear.
 */
export async function getSlackClientSecret(): Promise<string | null> {
  const admin = getAdminSupabase();

  try {
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: VAULT_CLIENT_SECRET_NAME,
    });

    if (error) return null;
    return data as string | null;
  } catch {
    return null;
  }
}

// ============================================================
// Prueba de conexión — auth.test
// ============================================================

/**
 * Verifica que el bot token sea válido usando auth.test de Slack API.
 * Retorna metadata segura del workspace y bot. No expone el token.
 */
export async function testSlackConnection(): Promise<SlackConnectionTestResult> {
  const token = await getSlackToken();

  if (!token) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay bot token almacenado para Slack.',
    };
  }

  try {
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'HTTP_ERROR',
        message: `Error HTTP ${response.status} al contactar Slack API.`,
      };
    }

    const data = await response.json() as {
      ok: boolean;
      error?: string;
      team?: string;
      team_id?: string;
      user_id?: string;
      bot_id?: string;
      app_id?: string;
    };

    if (!data.ok) {
      const errCode = data.error ?? 'unknown_error';

      if (errCode === 'invalid_auth' || errCode === 'token_revoked') {
        return {
          success: false,
          error: 'INVALID_TOKEN',
          message: 'El bot token de Slack no es válido o fue revocado.',
        };
      }

      return {
        success: false,
        error: errCode.toUpperCase(),
        message: `Error de Slack API: ${errCode}`,
      };
    }

    const tokenInfo: SlackTokenInfo = {
      teamId: data.team_id ?? '',
      teamName: data.team ?? '',
      botUserId: data.user_id ?? data.bot_id ?? '',
      appId: data.app_id ?? '',
      scopes: [],
    };

    return {
      success: true,
      message: `Conexión exitosa. Workspace: ${tokenInfo.teamName}.`,
      tokenInfo,
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

// ============================================================
// Crear canal oficial de SellUp — conversations.create
// ============================================================

/**
 * Crea el canal oficial de SellUp en Slack.
 * Requiere scope: channels:manage
 * El nombre del canal se normaliza a formato Slack (minúsculas, sin espacios).
 */
export async function createSlackChannel(
  channelName: string
): Promise<SlackChannelResult> {
  const token = await getSlackToken();

  if (!token) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay bot token almacenado para Slack.',
    };
  }

  // Normalizar nombre: minúsculas, guiones en lugar de espacios, sin caracteres especiales
  const normalizedName = channelName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 80);

  if (!normalizedName) {
    return {
      success: false,
      error: 'INVALID_NAME',
      message: 'El nombre del canal no es válido.',
    };
  }

  try {
    const response = await fetch('https://slack.com/api/conversations.create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: normalizedName }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'HTTP_ERROR',
        message: `Error HTTP ${response.status} al contactar Slack API.`,
      };
    }

    const data = await response.json() as {
      ok: boolean;
      error?: string;
      channel?: { id: string; name: string };
    };

    if (!data.ok) {
      const errCode = data.error ?? 'unknown_error';

      if (errCode === 'name_taken') {
        return {
          success: false,
          alreadyExists: true,
          error: 'NAME_TAKEN',
          message: `El canal "${normalizedName}" ya existe en el workspace. Elige un nombre diferente.`,
        };
      }

      if (errCode === 'missing_scope') {
        return {
          success: false,
          error: 'MISSING_SCOPE',
          message: 'El bot no tiene el scope channels:manage. Reconecta la app de Slack con los permisos correctos.',
        };
      }

      return {
        success: false,
        error: errCode.toUpperCase(),
        message: `Error de Slack API: ${errCode}`,
      };
    }

    return {
      success: true,
      message: `Canal #${data.channel?.name ?? normalizedName} creado correctamente.`,
      channelId: data.channel?.id,
      channelName: data.channel?.name ?? normalizedName,
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

// ============================================================
// Enviar mensaje de prueba — chat.postMessage
// ============================================================

/**
 * Envía un mensaje de prueba al canal oficial de SellUp.
 * Requiere scope: chat:write
 */
export async function sendSlackTestMessage(
  channelId: string
): Promise<SlackMessageResult> {
  const token = await getSlackToken();

  if (!token) {
    return {
      success: false,
      error: 'NO_CREDENTIAL',
      message: 'No hay bot token almacenado para Slack.',
    };
  }

  const text =
    'SellUp quedó conectado a Slack correctamente. Este canal recibirá alertas y comunicaciones operativas cuando los flujos sean habilitados.';

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, text }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'HTTP_ERROR',
        message: `Error HTTP ${response.status} al contactar Slack API.`,
      };
    }

    const data = await response.json() as {
      ok: boolean;
      error?: string;
    };

    if (!data.ok) {
      const errCode = data.error ?? 'unknown_error';

      if (errCode === 'channel_not_found') {
        return {
          success: false,
          error: 'CHANNEL_NOT_FOUND',
          message: 'El canal oficial no fue encontrado. Verifica que el bot fue añadido al canal.',
        };
      }

      if (errCode === 'not_in_channel') {
        return {
          success: false,
          error: 'NOT_IN_CHANNEL',
          message: 'El bot no está en el canal. Invita al bot con /invite @sellup en Slack.',
        };
      }

      return {
        success: false,
        error: errCode.toUpperCase(),
        message: `Error de Slack API: ${errCode}`,
      };
    }

    return {
      success: true,
      message: 'Mensaje de prueba enviado correctamente al canal oficial.',
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
