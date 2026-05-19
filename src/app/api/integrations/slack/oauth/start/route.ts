/**
 * GET /api/integrations/slack/oauth/start
 *
 * Inicia el flujo OAuth v2 de Slack.
 * - Valida que el usuario sea Administrador activo.
 * - Genera un state CSRF-safe y lo persiste en integration_audit (INSERT siempre funciona).
 * - Redirige al browser a la URL de autorización de Slack.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { getSlackOAuthConfig } from '@/server/services/slack-connection';

export const dynamic = 'force-dynamic';

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // 1. Resolver credenciales: env vars tienen prioridad, luego DB/Vault
  let clientId = process.env.SLACK_CLIENT_ID ?? '';
  let redirectUri = process.env.SLACK_REDIRECT_URI ?? '';

  if (!clientId || !redirectUri) {
    const dbConfig = await getSlackOAuthConfig();
    if (dbConfig) {
      if (!clientId) clientId = dbConfig.clientId;
      if (!redirectUri) redirectUri = dbConfig.redirectUri;
    }
  }

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

  // 4. Persistir state en integration_audit — INSERT siempre funciona,
  //    evita el problema intermitente con UPDATE de metadata en connection row.
  const adminClient = getAdminSupabase();
  const { error: auditInsertError } = await adminClient
    .from('integration_audit')
    .insert({
      integration_key: 'slack',
      event_type: 'oauth_started',
      actor_user_id: actorId,
      metadata: {
        oauth_state: state,
        oauth_state_at: new Date().toISOString(),
      },
    });

  if (auditInsertError) {
    console.error('[slack/oauth/start] failed to store state in audit:', auditInsertError.message);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations/slack?error=${encodeURIComponent('Error interno al iniciar OAuth. Intenta nuevamente.')}`,
        APP_BASE_URL
      )
    );
  }

  // 5. Construir URL de autorización de Slack
  const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize');
  slackAuthUrl.searchParams.set('client_id', clientId);
  slackAuthUrl.searchParams.set('scope', SLACK_SCOPES);
  slackAuthUrl.searchParams.set('redirect_uri', redirectUri);
  slackAuthUrl.searchParams.set('state', state);

  return NextResponse.redirect(slackAuthUrl.toString());
}
