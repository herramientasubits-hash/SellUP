/**
 * GET /api/integrations/slack/oauth/callback
 *
 * Procesa el callback de Slack OAuth v2.
 * - Valida el parámetro state contra la cookie HTTP-only.
 * - Intercambia el code por un bot token usando oauth.v2.access.
 * - Almacena el bot token en Supabase Vault.
 * - Persiste metadata segura en external_integration_connections.
 * - Registra auditoría.
 * - Redirige a /settings/integrations/slack con resultado.
 *
 * Nunca expone el token, el client_secret ni el code en logs ni en UI.
 *
 * NOTA: No importa desde @/modules/integrations/actions ('use server')
 * porque ese directive rompe la resolución del route handler en Next.js.
 * Toda la lógica se ejecuta directamente aquí usando el admin client.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { storeSlackCredential, getSlackOAuthConfig, getSlackClientSecret } from '@/server/services/slack-connection';
import type { SlackMetadata } from '@/modules/integrations/types';

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const SUCCESS_REDIRECT = `${APP_BASE_URL}/settings/integrations/slack?connected=1`;

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

async function getAdminInternalUserId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = getAdminSupabase();

  const { data: internalUser } = await admin
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) return null;

  const { data: role } = await admin
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') return null;

  return internalUser.id;
}

function errorRedirect(message: string): NextResponse {
  const url = new URL('/settings/integrations/slack', APP_BASE_URL);
  url.searchParams.set('error', message);
  const response = NextResponse.redirect(url.toString());
  response.cookies.delete('slack_oauth_state');
  return response;
}

async function persistSlackOAuth(
  botToken: string,
  metadata: SlackMetadata,
  actorId: string
): Promise<{ success: boolean; error?: string }> {
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

    await admin.from('integration_audit').insert({
      integration_key: 'slack',
      event_type: 'oauth_connected',
      actor_user_id: actorId,
      metadata: { team_id: metadata.team_id, team_name: metadata.team_name },
    });
  }

  return { success: true };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const slackError = searchParams.get('error');

  // 1. Manejar cancelación o error reportado por Slack
  if (slackError) {
    return errorRedirect(
      slackError === 'access_denied'
        ? 'Autorización cancelada por el usuario.'
        : `Error de Slack: ${slackError}`
    );
  }

  // 2. Verificar parámetros requeridos
  if (!code || !state) {
    return errorRedirect('Parámetros inválidos en el callback.');
  }

  // 3. Validar state contra integration_audit
  //    El start route guarda el state en integration_audit (INSERT siempre funciona).
  const admin = getAdminSupabase();

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: auditRow } = await admin
    .from('integration_audit')
    .select('metadata, created_at')
    .eq('integration_key', 'slack')
    .eq('event_type', 'oauth_started')
    .filter('metadata->>oauth_state', 'eq', state)
    .gte('created_at', tenMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const stateAgeMs = auditRow?.created_at
    ? Date.now() - new Date(auditRow.created_at as string).getTime()
    : Infinity;

  console.log('[callback] state param:', state ? state.slice(0, 8) + '...' : 'MISSING');
  console.log('[callback] audit row found:', !!auditRow, '| age ms:', stateAgeMs);

  if (!auditRow) {
    try {
      await admin.from('integration_audit').insert({
        integration_key: 'slack',
        event_type: 'oauth_failed',
        actor_user_id: '00000000-0000-0000-0000-000000000000',
        metadata: { error_code: 'state_not_found', state_prefix: state.slice(0, 8) },
      });
    } catch { /* non-blocking */ }
    return errorRedirect('Validación de estado fallida. Intenta conectar Slack nuevamente.');
  }

  // 4. Verificar que el usuario sea Administrador activo
  const supabase = await createClient();
  const actorId = await getAdminInternalUserId(supabase);
  console.log('[callback] actorId:', actorId ? 'FOUND' : 'NULL');

  if (!actorId) {
    try {
      await getAdminSupabase().from('integration_audit').insert({
        integration_key: 'slack',
        event_type: 'oauth_failed',
        actor_user_id: '00000000-0000-0000-0000-000000000000',
        metadata: { error_code: 'unauthorized', detail: 'actorId null in callback' },
      });
    } catch { /* non-blocking */ }
    return errorRedirect('No autorizado. Solo administradores pueden conectar Slack.');
  }

  // 5. Resolver credenciales: env vars tienen prioridad, luego DB/Vault
  let clientId = process.env.SLACK_CLIENT_ID ?? '';
  let clientSecret = process.env.SLACK_CLIENT_SECRET ?? '';
  let redirectUri = process.env.SLACK_REDIRECT_URI ?? '';

  if (!clientId || !redirectUri) {
    const dbConfig = await getSlackOAuthConfig();
    if (dbConfig) {
      if (!clientId) clientId = dbConfig.clientId;
      if (!redirectUri) redirectUri = dbConfig.redirectUri;
    }
  }

  if (!clientSecret) {
    clientSecret = (await getSlackClientSecret()) ?? '';
  }

  if (!clientId || !clientSecret || !redirectUri) {
    return errorRedirect('Configuración de Slack incompleta. Vuelve a configurar la app.');
  }

  // 6. Intercambiar code por token — oauth.v2.access
  let oauthData: {
    ok: boolean;
    error?: string;
    access_token?: string;
    token_type?: string;
    bot_user_id?: string;
    app_id?: string;
    team?: { id: string; name: string };
    authed_user?: { id: string };
    scope?: string;
  };

  try {
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenResponse.ok) {
      return errorRedirect(`Error HTTP ${tokenResponse.status} al obtener token de Slack.`);
    }

    oauthData = await tokenResponse.json();
  } catch {
    return errorRedirect('Error de red al contactar Slack. Intenta nuevamente.');
  }

  // 7. Verificar respuesta de Slack
  if (!oauthData.ok) {
    const errCode = oauthData.error ?? 'unknown_error';
    await getAdminSupabase().from('integration_audit').insert({
      integration_key: 'slack',
      event_type: 'oauth_failed',
      actor_user_id: actorId,
      metadata: { error_code: errCode },
    });
    return errorRedirect(`Error al obtener token: ${errCode}`);
  }

  // 8. Extraer bot token — NUNCA loggear este valor
  const botToken = oauthData.access_token;
  if (!botToken) {
    return errorRedirect('Slack no retornó un bot token válido.');
  }

  // 9. Construir metadata segura (sin el token)
  const scopes = oauthData.scope ? oauthData.scope.split(',') : [];
  const metadata: SlackMetadata = {
    team_id: oauthData.team?.id,
    team_name: oauthData.team?.name,
    bot_user_id: oauthData.bot_user_id,
    app_id: oauthData.app_id,
    scopes,
  };

  // 10. Persistir en Vault + base de datos (sin depender de 'use server' actions)
  const result = await persistSlackOAuth(botToken, metadata, actorId);

  if (!result.success) {
    return errorRedirect(result.error ?? 'Error al almacenar la conexión de Slack.');
  }

  // 11. Limpiar cookie de state y redirigir al éxito
  const successResponse = NextResponse.redirect(SUCCESS_REDIRECT);
  successResponse.cookies.delete('slack_oauth_state');
  return successResponse;
}
