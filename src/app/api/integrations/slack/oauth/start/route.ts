/**
 * GET /api/integrations/slack/oauth/start
 *
 * Inicia el flujo OAuth v2 de Slack.
 * - Valida que el usuario sea Administrador activo.
 * - Genera un state aleatorio y lo persiste en una cookie HTTP-only (5 min).
 * - Redirige al browser a la URL de autorización de Slack.
 *
 * NOTA: Slack exige que el redirect_uri use HTTPS en producción.
 * Para pruebas locales utiliza un túnel HTTPS (ngrok, cloudflared, etc.)
 * y configura SLACK_REDIRECT_URI con esa URL.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { getSlackOAuthConfig } from '@/server/services/slack-connection';

// Bot Token Scopes solicitados al instalar la Slack App:
//   channels:manage    → crear el canal oficial de SellUp
//   chat:write         → enviar mensajes como bot
//   app_mentions:read  → leer menciones directas a la app
//   channels:history   → leer historial de canales públicos donde el bot esté agregado
//   im:write           → abrir mensajes directos hacia usuarios
//   im:history         → leer historial de DMs donde el bot participe
const SLACK_SCOPES =
  'channels:manage,chat:write,app_mentions:read,channels:history,im:write,im:history';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

function getAdminSupabase() {
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

export async function GET(): Promise<NextResponse> {
  const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // 1. Resolver credenciales: env vars tienen prioridad, luego DB/Vault
  let clientId = process.env.SLACK_CLIENT_ID ?? '';
  let redirectUri = process.env.SLACK_REDIRECT_URI ?? '';

  console.log('[slack/oauth/start] env SLACK_CLIENT_ID:', clientId ? 'SET' : 'MISSING');
  console.log('[slack/oauth/start] env SLACK_REDIRECT_URI:', redirectUri ? 'SET' : 'MISSING');

  if (!clientId || !redirectUri) {
    console.log('[slack/oauth/start] falling back to DB config...');
    const dbConfig = await getSlackOAuthConfig();
    console.log('[slack/oauth/start] dbConfig:', dbConfig ? JSON.stringify({ clientId: dbConfig.clientId ? 'SET' : 'MISSING', redirectUri: dbConfig.redirectUri ? 'SET' : 'MISSING' }) : 'NULL');
    if (dbConfig) {
      if (!clientId) clientId = dbConfig.clientId;
      if (!redirectUri) redirectUri = dbConfig.redirectUri;
    }
  }

  console.log('[slack/oauth/start] final clientId:', clientId ? 'SET' : 'MISSING');
  console.log('[slack/oauth/start] final redirectUri:', redirectUri ? 'SET' : 'MISSING');

  if (!clientId || !redirectUri) {
    const params = new URLSearchParams({
      error: 'Configura el Client ID y la Redirect URI de tu Slack App antes de conectar.',
    });
    return NextResponse.redirect(new URL(`/settings/integrations/slack?${params}`, APP_BASE_URL));
  }

  // 2. Validar que el usuario sea Administrador activo
  const supabase = await createClient();
  const actorId = await getAdminInternalUserId(supabase);

  if (!actorId) {
    return NextResponse.redirect(new URL('/settings', APP_BASE_URL));
  }

  // 3. Generar state CSRF-safe (16 bytes = 32 hex chars)
  const state = randomBytes(16).toString('hex');

  // 4. Persistir state en DB para validación en el callback (evita problemas de cookies cross-site)
  const adminClient = getAdminSupabase();
  const { data: integration } = await adminClient
    .from('external_integrations')
    .select('id')
    .eq('integration_key', 'slack')
    .single();

  if (integration) {
    const { data: conn } = await adminClient
      .from('external_integration_connections')
      .select('metadata')
      .eq('integration_id', integration.id)
      .single();

    const prevMeta = (conn?.metadata ?? {}) as Record<string, unknown>;
    await adminClient
      .from('external_integration_connections')
      .update({
        metadata: { ...prevMeta, oauth_state: state, oauth_state_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq('integration_id', integration.id);
  }

  // 5. Registrar auditoría de inicio de OAuth
  await adminClient.from('integration_audit').insert({
    integration_key: 'slack',
    event_type: 'oauth_started',
    actor_user_id: actorId,
    metadata: null,
  });

  // 6. Construir URL de autorización de Slack
  const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize');
  slackAuthUrl.searchParams.set('client_id', clientId);
  slackAuthUrl.searchParams.set('scope', SLACK_SCOPES);
  slackAuthUrl.searchParams.set('redirect_uri', redirectUri);
  slackAuthUrl.searchParams.set('state', state);

  return NextResponse.redirect(slackAuthUrl.toString());
}
