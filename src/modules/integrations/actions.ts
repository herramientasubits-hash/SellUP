'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  storeHubSpotCredential,
  removeHubSpotCredential,
  hasHubSpotCredential,
  testHubSpotConnection,
} from '@/server/services/hubspot-connection';
import {
  storeSlackCredential,
  removeSlackCredential,
  hasSlackCredential,
  testSlackConnection,
  createSlackChannel,
  sendSlackTestMessage,
  storeSlackOAuthConfig,
} from '@/server/services/slack-connection';
import {
  storeSamuApiKey,
  removeSamuApiKey,
  hasSamuApiKey,
  testSamuHealth,
} from '@/server/services/samu-connection';
import {
  storeTavilyApiKey,
  removeTavilyApiKey,
  hasTavilyApiKey,
  testTavilyConnection,
} from '@/server/services/tavily-connection';
import {
  storeGoogleCSECredentials,
  removeGoogleCSECredentials,
  hasGoogleCSECredentials,
  testGoogleCSEConnection,
  getGoogleCSECredentials,
  maskGoogleCSECx,
} from '@/server/services/google-cse-connection';
import type {
  ExternalIntegration,
  ExternalIntegrationConnection,
  IntegrationWithConnection,
  SlackMetadata,
  SamuMetadata,
  TavilyMetadata,
  GoogleCSEMetadata,
} from './types';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminSupabase() {
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

// ============================================================
// Helpers
// ============================================================

async function getAdminInternalUserId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ id: string | null; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: 'No autenticado' };

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) return { id: null, error: 'Usuario no encontrado o inactivo' };

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') return { id: null, error: 'No autorizado' };

  return { id: internalUser.id };
}

async function logAuditEvent(
  integrationKey: string,
  eventType: string,
  actorId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const admin = getAdminSupabase();
  await admin.from('integration_audit').insert({
    integration_key: integrationKey,
    event_type: eventType,
    actor_user_id: actorId,
    metadata: metadata ?? null,
  });
}

// ============================================================
// Lectura de integraciones
// ============================================================

export async function getAllIntegrations(): Promise<IntegrationWithConnection[]> {
  const admin = getAdminSupabase();

  const { data: integrations } = await admin
    .from('external_integrations')
    .select('*')
    .order('name');

  if (!integrations) return [];

  const { data: connections } = await admin
    .from('external_integration_connections')
    .select('*');

  const connectionMap = new Map<string, ExternalIntegrationConnection>();
  (connections ?? []).forEach((c) => connectionMap.set(c.integration_id, c));

  return (integrations as ExternalIntegration[]).map((integration) => ({
    ...integration,
    connection: connectionMap.get(integration.id) ?? null,
  }));
}

export async function getHubSpotIntegration(): Promise<IntegrationWithConnection | null> {
  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('*')
    .eq('integration_key', 'hubspot')
    .single();

  if (!integration) return null;

  const { data: connection } = await admin
    .from('external_integration_connections')
    .select('*')
    .eq('integration_id', integration.id)
    .single();

  const hasCredential = await hasHubSpotCredential();
  const credentialsStatus = hasCredential ? 'stored' : 'missing';

  const enrichedConnection = connection
    ? { ...connection, credentials_status: credentialsStatus }
    : null;

  return {
    ...(integration as ExternalIntegration),
    connection: enrichedConnection,
  };
}

// ============================================================
// Conectar HubSpot (guardar token por primera vez)
// ============================================================

export async function connectHubSpot(token: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!token || token.trim().length < 10) {
    return { success: false, error: 'Token inválido o demasiado corto.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeHubSpotCredential(token.trim());
  if (!storeResult.success) return storeResult;

  await logAuditEvent('hubspot', 'credential_stored', actorId);

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'hubspot')
    .single();

  if (integration) {
    const { data: existing } = await admin
      .from('external_integration_connections')
      .select('id')
      .eq('integration_id', integration.id)
      .single();

    const now = new Date().toISOString();

    if (existing) {
      await admin
        .from('external_integration_connections')
        .update({
          credentials_status: 'stored',
          connection_status: 'not_tested',
          last_connection_error: null,
          connected_at: now,
          connected_by: actorId,
          disconnected_at: null,
          disconnected_by: null,
          metadata: null,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      await admin.from('external_integration_connections').insert({
        integration_id: integration.id,
        auth_type: 'private_app_access_token',
        credentials_status: 'stored',
        connection_status: 'not_tested',
        connected_at: now,
        connected_by: actorId,
      });
    }
  }

  return {
    success: true,
    message: 'Credencial guardada correctamente. Ahora puedes probar la conexión.',
  };
}

// ============================================================
// Actualizar credencial existente
// ============================================================

export async function updateHubSpotCredential(newToken: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!newToken || newToken.trim().length < 10) {
    return { success: false, error: 'Token inválido o demasiado corto.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeHubSpotCredential(newToken.trim());
  if (!storeResult.success) return storeResult;

  await logAuditEvent('hubspot', 'credential_updated', actorId);

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'hubspot')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'stored',
        connection_status: 'not_tested',
        last_tested_at: null,
        last_connection_error: null,
        metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  return {
    success: true,
    message: 'Credencial actualizada. Prueba la conexión para verificar el nuevo token.',
  };
}

// ============================================================
// Probar conexión
// ============================================================

export async function testHubSpotConnectionAction(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'hubspot')
    .single();

  if (!integration) {
    return { success: false, error: 'Integración HubSpot no encontrada.' };
  }

  await logAuditEvent('hubspot', 'connection_tested', actorId);

  const result = await testHubSpotConnection();

  const now = new Date().toISOString();

  if (result.success && result.tokenInfo) {
    const safeMetadata = {
      hub_id: result.tokenInfo.hubId,
      app_id: result.tokenInfo.appId,
      scopes: result.tokenInfo.scopes,
    };

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'connected',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: null,
        metadata: safeMetadata,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('hubspot', 'connection_succeeded', actorId, safeMetadata);
  } else {
    const sanitizedError = result.message
      ? result.message.slice(0, 500)
      : 'Error desconocido';

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'error',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: sanitizedError,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('hubspot', 'connection_failed', actorId, {
      error_code: result.error,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
  };
}

// ============================================================
// Desconectar HubSpot
// ============================================================

export async function disconnectHubSpot(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  await removeHubSpotCredential();

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'hubspot')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'missing',
        connection_status: 'disconnected',
        last_connection_error: null,
        disconnected_at: new Date().toISOString(),
        disconnected_by: actorId,
        metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  await logAuditEvent('hubspot', 'disconnected', actorId);

  return {
    success: true,
    message: 'HubSpot desconectado correctamente.',
  };
}

// ============================================================
// Slack: Leer integración
// ============================================================

export async function getSlackIntegration(): Promise<IntegrationWithConnection | null> {
  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('*')
    .eq('integration_key', 'slack')
    .single();

  if (!integration) return null;

  const { data: connection } = await admin
    .from('external_integration_connections')
    .select('*')
    .eq('integration_id', integration.id)
    .single();

  const hasCredential = await hasSlackCredential();
  const credentialsStatus = hasCredential ? 'stored' : 'missing';

  const enrichedConnection = connection
    ? { ...connection, credentials_status: credentialsStatus }
    : null;

  return {
    ...(integration as ExternalIntegration),
    connection: enrichedConnection,
  };
}

// ============================================================
// Slack: Completar OAuth (llamado desde el callback route handler)
// ============================================================

/**
 * Persiste el bot token recibido del OAuth callback de Slack.
 * Solo debe ser llamado desde el route handler del callback — nunca desde UI directamente.
 */
export async function completeSlackOAuth(
  botToken: string,
  metadata: SlackMetadata,
  actorId: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const storeResult = await storeSlackCredential(botToken);
  if (!storeResult.success) return storeResult;

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'slack')
    .single();

  if (integration) {
    const now = new Date().toISOString();
    const safeMetadata: SlackMetadata = {
      team_id: metadata.team_id,
      team_name: metadata.team_name,
      bot_user_id: metadata.bot_user_id,
      app_id: metadata.app_id,
      scopes: metadata.scopes,
    };

    const { data: existing } = await admin
      .from('external_integration_connections')
      .select('id')
      .eq('integration_id', integration.id)
      .single();

    if (existing) {
      await admin
        .from('external_integration_connections')
        .update({
          auth_type: 'oauth2',
          credentials_status: 'stored',
          connection_status: 'connected',
          last_connection_error: null,
          connected_at: now,
          connected_by: actorId,
          disconnected_at: null,
          disconnected_by: null,
          metadata: safeMetadata,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      await admin.from('external_integration_connections').insert({
        integration_id: integration.id,
        auth_type: 'oauth2',
        credentials_status: 'stored',
        connection_status: 'connected',
        connected_at: now,
        connected_by: actorId,
        metadata: safeMetadata,
      });
    }
  }

  await logAuditEvent('slack', 'oauth_connected', actorId, {
    team_id: metadata.team_id,
    team_name: metadata.team_name,
  });

  return {
    success: true,
    message: 'Slack conectado correctamente.',
  };
}

// ============================================================
// Slack: Probar conexión
// ============================================================

export async function testSlackConnectionAction(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'slack')
    .single();

  if (!integration) {
    return { success: false, error: 'Integración Slack no encontrada.' };
  }

  await logAuditEvent('slack', 'connection_tested', actorId);

  const result = await testSlackConnection();
  const now = new Date().toISOString();

  if (result.success && result.tokenInfo) {
    const { data: existing } = await admin
      .from('external_integration_connections')
      .select('metadata')
      .eq('integration_id', integration.id)
      .single();

    const prevMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const updatedMeta: SlackMetadata = {
      ...(prevMeta as SlackMetadata),
      team_id: result.tokenInfo.teamId,
      team_name: result.tokenInfo.teamName,
      bot_user_id: result.tokenInfo.botUserId,
      app_id: result.tokenInfo.appId,
    };

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'connected',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: null,
        metadata: updatedMeta,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('slack', 'connection_succeeded', actorId, {
      team_id: result.tokenInfo.teamId,
      team_name: result.tokenInfo.teamName,
    });
  } else {
    const sanitizedError = result.message ? result.message.slice(0, 500) : 'Error desconocido';

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'error',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: sanitizedError,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('slack', 'connection_failed', actorId, {
      error_code: result.error,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
  };
}

// ============================================================
// Slack: Crear canal oficial
// ============================================================

export async function createSlackChannelAction(channelName: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
  alreadyExists?: boolean;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  if (!channelName || channelName.trim().length === 0) {
    return { success: false, error: 'El nombre del canal es requerido.' };
  }

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'slack')
    .single();

  if (!integration) {
    return { success: false, error: 'Integración Slack no encontrada.' };
  }

  const result = await createSlackChannel(channelName.trim());

  if (result.success && result.channelId) {
    const { data: existing } = await admin
      .from('external_integration_connections')
      .select('metadata')
      .eq('integration_id', integration.id)
      .single();

    const prevMeta = (existing?.metadata ?? {}) as SlackMetadata;
    const updatedMeta: SlackMetadata = {
      ...prevMeta,
      channel_id: result.channelId,
      channel_name: result.channelName,
    };

    await admin
      .from('external_integration_connections')
      .update({
        metadata: updatedMeta,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('slack', 'channel_created', actorId, {
      channel_id: result.channelId,
      channel_name: result.channelName,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
    alreadyExists: result.alreadyExists,
  };
}

// ============================================================
// Slack: Enviar mensaje de prueba
// ============================================================

export async function sendSlackTestMessageAction(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'slack')
    .single();

  if (!integration) {
    return { success: false, error: 'Integración Slack no encontrada.' };
  }

  const { data: connection } = await admin
    .from('external_integration_connections')
    .select('metadata')
    .eq('integration_id', integration.id)
    .single();

  const meta = (connection?.metadata ?? {}) as SlackMetadata;

  if (!meta.channel_id) {
    return {
      success: false,
      error: 'Crea primero el canal oficial de SellUp antes de enviar el mensaje.',
    };
  }

  const result = await sendSlackTestMessage(meta.channel_id);

  if (result.success) {
    await logAuditEvent('slack', 'test_message_sent', actorId, {
      channel_id: meta.channel_id,
      channel_name: meta.channel_name,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
  };
}

// ============================================================
// Slack: Desconectar
// ============================================================

export async function disconnectSlack(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  await removeSlackCredential();

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'slack')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'missing',
        connection_status: 'disconnected',
        last_connection_error: null,
        disconnected_at: new Date().toISOString(),
        disconnected_by: actorId,
        // Preservar metadata no sensible (team, canal) para referencia histórica
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  await logAuditEvent('slack', 'disconnected', actorId);

  return {
    success: true,
    message: 'Slack desconectado correctamente.',
  };
}

// ============================================================
// Samu IA: Leer integración
// ============================================================

export async function getSamuIntegration(): Promise<IntegrationWithConnection | null> {
  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('*')
    .eq('integration_key', 'samu_ia')
    .single();

  if (!integration) return null;

  const { data: connection } = await admin
    .from('external_integration_connections')
    .select('*')
    .eq('integration_id', integration.id)
    .single();

  const hasCredential = await hasSamuApiKey();
  const credentialsStatus = hasCredential ? 'stored' : 'missing';

  const enrichedConnection = connection
    ? { ...connection, credentials_status: credentialsStatus }
    : null;

  return {
    ...(integration as ExternalIntegration),
    connection: enrichedConnection,
  };
}

// ============================================================
// Samu IA: Conectar (guardar API Key por primera vez)
// ============================================================

export async function connectSamu(apiKey: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!apiKey || apiKey.trim().length < 8) {
    return { success: false, error: 'API Key inválida o demasiado corta.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeSamuApiKey(apiKey.trim());
  if (!storeResult.success) return storeResult;

  await logAuditEvent('samu_ia', 'samu_api_key_stored', actorId);

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'samu_ia')
    .single();

  if (integration) {
    const now = new Date().toISOString();
    const { data: existing } = await admin
      .from('external_integration_connections')
      .select('id')
      .eq('integration_id', integration.id)
      .single();

    if (existing) {
      await admin
        .from('external_integration_connections')
        .update({
          credentials_status: 'stored',
          connection_status: 'not_tested',
          last_connection_error: null,
          connected_at: now,
          connected_by: actorId,
          disconnected_at: null,
          disconnected_by: null,
          metadata: null,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      await admin.from('external_integration_connections').insert({
        integration_id: integration.id,
        auth_type: 'api_key',
        credentials_status: 'stored',
        connection_status: 'not_tested',
        connected_at: now,
        connected_by: actorId,
      });
    }
  }

  return {
    success: true,
    message: 'API Key guardada correctamente. Ahora puedes probar la conexión.',
  };
}

// ============================================================
// Samu IA: Actualizar API Key
// ============================================================

export async function updateSamuApiKey(newApiKey: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!newApiKey || newApiKey.trim().length < 8) {
    return { success: false, error: 'API Key inválida o demasiado corta.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeSamuApiKey(newApiKey.trim());
  if (!storeResult.success) return storeResult;

  await logAuditEvent('samu_ia', 'samu_api_key_updated', actorId);

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'samu_ia')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'stored',
        connection_status: 'not_tested',
        last_tested_at: null,
        last_connection_error: null,
        metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  return {
    success: true,
    message: 'API Key actualizada. Prueba la conexión para verificar la nueva clave.',
  };
}

// ============================================================
// Samu IA: Probar conexión
// ============================================================

export async function testSamuConnectionAction(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'samu_ia')
    .single();

  if (!integration) {
    return { success: false, error: 'Integración Samu IA no encontrada.' };
  }

  await logAuditEvent('samu_ia', 'samu_connection_tested', actorId);

  const result = await testSamuHealth();
  const now = new Date().toISOString();

  if (result.success) {
    const safeMetadata: SamuMetadata = {
      user_count: result.userCount,
    };

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'connected',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: null,
        metadata: safeMetadata,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('samu_ia', 'samu_connection_succeeded', actorId, safeMetadata);
  } else {
    const sanitizedError = result.message ? result.message.slice(0, 500) : 'Error desconocido';

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'error',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: sanitizedError,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('samu_ia', 'samu_connection_failed', actorId, {
      error_code: result.error,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
  };
}

// ============================================================
// Samu IA: Desconectar
// ============================================================

export async function disconnectSamu(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  await removeSamuApiKey();

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'samu_ia')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'missing',
        connection_status: 'disconnected',
        last_connection_error: null,
        disconnected_at: new Date().toISOString(),
        disconnected_by: actorId,
        metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  await logAuditEvent('samu_ia', 'samu_disconnected', actorId);

  return {
    success: true,
    message: 'Samu IA desconectado correctamente.',
  };
}

// ============================================================
// Tavily: Leer integración
// ============================================================

export async function getTavilyIntegration(): Promise<IntegrationWithConnection | null> {
  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('*')
    .eq('integration_key', 'tavily')
    .single();

  if (!integration) return null;

  const { data: connection } = await admin
    .from('external_integration_connections')
    .select('*')
    .eq('integration_id', integration.id)
    .single();

  const hasCredential = await hasTavilyApiKey();
  const credentialsStatus = hasCredential ? 'stored' : 'missing';

  const enrichedConnection = connection
    ? { ...connection, credentials_status: credentialsStatus }
    : null;

  return {
    ...(integration as ExternalIntegration),
    connection: enrichedConnection,
  };
}

// ============================================================
// Tavily: Conectar (guardar API Key por primera vez)
// ============================================================

export async function connectTavily(apiKey: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!apiKey || apiKey.trim().length < 16) {
    return { success: false, error: 'API Key inválida o demasiado corta.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeTavilyApiKey(apiKey.trim());
  if (!storeResult.success) return storeResult;

  await logAuditEvent('tavily', 'tavily_api_key_stored', actorId);

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'tavily')
    .single();

  if (integration) {
    const now = new Date().toISOString();
    const { data: existing } = await admin
      .from('external_integration_connections')
      .select('id')
      .eq('integration_id', integration.id)
      .single();

    if (existing) {
      await admin
        .from('external_integration_connections')
        .update({
          credentials_status: 'stored',
          connection_status: 'not_tested',
          last_connection_error: null,
          connected_at: now,
          connected_by: actorId,
          disconnected_at: null,
          disconnected_by: null,
          metadata: null,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      await admin.from('external_integration_connections').insert({
        integration_id: integration.id,
        auth_type: 'api_key',
        credentials_status: 'stored',
        connection_status: 'not_tested',
        connected_at: now,
        connected_by: actorId,
      });
    }
  }

  return {
    success: true,
    message: 'API Key guardada correctamente. Puedes probar la conexión cuando lo desees.',
  };
}

// ============================================================
// Tavily: Actualizar API Key
// ============================================================

export async function updateTavilyApiKey(newApiKey: string): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  if (!newApiKey || newApiKey.trim().length < 16) {
    return { success: false, error: 'API Key inválida o demasiado corta.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeTavilyApiKey(newApiKey.trim());
  if (!storeResult.success) return storeResult;

  await logAuditEvent('tavily', 'tavily_api_key_updated', actorId);

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'tavily')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'stored',
        connection_status: 'not_tested',
        last_tested_at: null,
        last_connection_error: null,
        metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  return {
    success: true,
    message: 'API Key actualizada. Prueba la conexión para verificar la nueva clave.',
  };
}

// ============================================================
// Tavily: Probar conexión
// ADVERTENCIA: Consume 1 crédito de Tavily por ejecución.
// ============================================================

export async function testTavilyConnectionAction(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'tavily')
    .single();

  if (!integration) {
    return { success: false, error: 'Integración Tavily no encontrada.' };
  }

  await logAuditEvent('tavily', 'tavily_connection_tested', actorId);

  const result = await testTavilyConnection();
  const now = new Date().toISOString();

  if (result.success) {
    const safeMetadata: TavilyMetadata = {
      response_time_ms: result.responseTimeMs,
      results_count: result.resultsCount,
      search_depth: 'basic',
    };

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'connected',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: null,
        metadata: safeMetadata,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('tavily', 'tavily_connection_succeeded', actorId, safeMetadata);
  } else {
    const sanitizedError = result.message ? result.message.slice(0, 500) : 'Error desconocido';

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'error',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: sanitizedError,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('tavily', 'tavily_connection_failed', actorId, {
      error_code: result.error,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
  };
}

// ============================================================
// Tavily: Desconectar
// ============================================================

export async function disconnectTavily(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  await removeTavilyApiKey();

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'tavily')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'missing',
        connection_status: 'disconnected',
        last_connection_error: null,
        disconnected_at: new Date().toISOString(),
        disconnected_by: actorId,
        metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  await logAuditEvent('tavily', 'tavily_disconnected', actorId);

  return {
    success: true,
    message: 'Tavily desconectado correctamente.',
  };
}

// Slack: Configurar OAuth App desde la UI
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Guarda las credenciales de la Slack App (Client ID, Client Secret, Redirect URI)
 * desde el formulario de administración.
 * - client_id y redirect_uri se almacenan en metadata (no sensibles).
 * - client_secret se almacena en Supabase Vault.
 * Después de llamar a este action, el frontend debe redirigir a
 * /api/integrations/slack/oauth/start para iniciar el flujo OAuth.
 */
export async function configureSlackOAuthApp(
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { id: actorId } = await getAdminInternalUserId(supabase);

  if (!actorId) {
    return { success: false, error: 'No autorizado.' };
  }

  if (!clientId.trim() || !clientSecret.trim() || !redirectUri.trim()) {
    return { success: false, error: 'Todos los campos son requeridos.' };
  }

  const result = await storeSlackOAuthConfig(
    clientId.trim(),
    clientSecret.trim(),
    redirectUri.trim()
  );

  if (!result.success) {
    return { success: false, error: result.error ?? 'Error al guardar la configuración.' };
  }

  await logAuditEvent('slack', 'oauth_started', actorId, {
    note: 'OAuth app configured via UI',
  });

  return { success: true };
}

// ============================================================
// Google CSE: Leer integración
// ============================================================

export async function getGoogleCSEIntegration(): Promise<
  (IntegrationWithConnection & { cx_masked?: string }) | null
> {
  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('*')
    .eq('integration_key', 'google_cse')
    .single();

  if (!integration) return null;

  const { data: connection } = await admin
    .from('external_integration_connections')
    .select('*')
    .eq('integration_id', integration.id)
    .single();

  const creds = await getGoogleCSECredentials();
  const hasCredentials = creds !== null;
  const credentialsStatus = hasCredentials ? 'stored' : 'missing';
  const cx_masked = creds?.cx ? maskGoogleCSECx(creds.cx) : undefined;

  const enrichedConnection = connection
    ? { ...connection, credentials_status: credentialsStatus }
    : null;

  return {
    ...(integration as ExternalIntegration),
    connection: enrichedConnection,
    cx_masked,
  };
}

// ============================================================
// Google CSE: Conectar (guardar credenciales por primera vez)
// ============================================================

export async function connectGoogleCSE(
  apiKey: string,
  cx: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { success: false, error: 'API Key inválida o demasiado corta.' };
  }
  if (!cx || cx.trim().length < 5) {
    return { success: false, error: 'Search Engine ID (cx) inválido o demasiado corto.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeGoogleCSECredentials(apiKey.trim(), cx.trim());
  if (!storeResult.success) return storeResult;

  await logAuditEvent('google_cse', 'google_cse_credentials_stored', actorId);

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'google_cse')
    .single();

  if (integration) {
    const now = new Date().toISOString();
    const { data: existing } = await admin
      .from('external_integration_connections')
      .select('id')
      .eq('integration_id', integration.id)
      .single();

    if (existing) {
      await admin
        .from('external_integration_connections')
        .update({
          credentials_status: 'stored',
          connection_status: 'not_tested',
          last_connection_error: null,
          connected_at: now,
          connected_by: actorId,
          disconnected_at: null,
          disconnected_by: null,
          metadata: null,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      await admin.from('external_integration_connections').insert({
        integration_id: integration.id,
        auth_type: 'api_key',
        credentials_status: 'stored',
        connection_status: 'not_tested',
        connected_at: now,
        connected_by: actorId,
      });
    }
  }

  return {
    success: true,
    message: 'Credenciales guardadas correctamente. Ahora puedes probar la conexión.',
  };
}

// ============================================================
// Google CSE: Actualizar credenciales
// ============================================================

export async function updateGoogleCSECredentials(
  apiKey: string,
  cx: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { success: false, error: 'API Key inválida o demasiado corta.' };
  }
  if (!cx || cx.trim().length < 5) {
    return { success: false, error: 'Search Engine ID (cx) inválido o demasiado corto.' };
  }

  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const storeResult = await storeGoogleCSECredentials(apiKey.trim(), cx.trim());
  if (!storeResult.success) return storeResult;

  await logAuditEvent('google_cse', 'google_cse_credentials_updated', actorId);

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'google_cse')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'stored',
        connection_status: 'not_tested',
        last_tested_at: null,
        last_connection_error: null,
        metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  return {
    success: true,
    message: 'Credenciales actualizadas. Prueba la conexión para verificarlas.',
  };
}

// ============================================================
// Google CSE: Probar conexión
// NOTA: Consume 1 query del quota gratuito (100/día).
// ============================================================

export async function testGoogleCSEConnectionAction(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'google_cse')
    .single();

  if (!integration) {
    return { success: false, error: 'Integración Google CSE no encontrada.' };
  }

  await logAuditEvent('google_cse', 'google_cse_connection_tested', actorId);

  const result = await testGoogleCSEConnection();
  const now = new Date().toISOString();

  if (result.success) {
    const safeMetadata: GoogleCSEMetadata = {
      response_time_ms: result.responseTimeMs,
      results_count: result.resultsCount,
    };

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'connected',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: null,
        metadata: safeMetadata,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('google_cse', 'google_cse_connection_succeeded', actorId, safeMetadata);
  } else {
    const sanitizedError = result.message ? result.message.slice(0, 500) : 'Error desconocido';

    await admin
      .from('external_integration_connections')
      .update({
        connection_status: 'error',
        last_tested_at: now,
        last_tested_by: actorId,
        last_connection_error: sanitizedError,
        updated_at: now,
      })
      .eq('integration_id', integration.id);

    await logAuditEvent('google_cse', 'google_cse_connection_failed', actorId, {
      error_code: result.error,
    });
  }

  return {
    success: result.success,
    error: result.error,
    message: result.message,
  };
}

// ============================================================
// Google CSE: Desconectar
// ============================================================

export async function disconnectGoogleCSE(): Promise<{
  success: boolean;
  error?: string;
  message?: string;
}> {
  const supabase = await createClient();
  const { id: actorId, error: authError } = await getAdminInternalUserId(supabase);
  if (!actorId) return { success: false, error: authError };

  await removeGoogleCSECredentials();

  const admin = getAdminSupabase();

  const { data: integration } = await admin
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'google_cse')
    .single();

  if (integration) {
    await admin
      .from('external_integration_connections')
      .update({
        credentials_status: 'missing',
        connection_status: 'disconnected',
        last_connection_error: null,
        disconnected_at: new Date().toISOString(),
        disconnected_by: actorId,
        metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  await logAuditEvent('google_cse', 'google_cse_disconnected', actorId);

  return {
    success: true,
    message: 'Google CSE desconectado correctamente.',
  };
}
