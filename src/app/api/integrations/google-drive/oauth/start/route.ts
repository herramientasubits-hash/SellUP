/**
 * GET /api/integrations/google-drive/oauth/start
 *
 * Inicia el flujo OAuth 2.0 de Google Drive para el usuario activo.
 * - Disponible para CUALQUIER usuario activo (no solo Admin).
 * - Valida que el usuario esté autenticado y tenga access_status = 'active'.
 * - Genera un state CSRF-safe y lo persiste en user_drive_audit.
 * - Redirige al consentimiento de Google con:
 *     access_type=offline (garantiza refresh_token)
 *     prompt=consent (fuerza nuevo refresh_token en reconexión)
 *     scope=drive.file (acceso acotado, solo archivos creados por SellUp)
 *
 * Por qué prompt=consent:
 *   Google solo retorna un refresh_token la primera vez que el usuario otorga acceso,
 *   O cuando se fuerza prompt=consent. Para garantizar que la reconexión siempre
 *   reciba un nuevo refresh token válido, se usa prompt=consent de forma explícita.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  }
  return createAdminClient(SUPABASE_URL, serviceKey);
}

async function getActiveInternalUserId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = getAdminClient();
  const { data: internalUser } = await admin
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  return internalUser?.id ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const redirectUri =
    process.env.GOOGLE_DRIVE_REDIRECT_URI ??
    `${APP_BASE_URL}/api/integrations/google-drive/oauth/callback`;

  if (!clientId) {
    const params = new URLSearchParams({
      error: 'Google Drive no está configurado. Contacta al administrador.',
    });
    return NextResponse.redirect(new URL(`/settings/my-drive?${params}`, APP_BASE_URL));
  }

  // Validar usuario activo
  const supabase = await createClient();
  const userId = await getActiveInternalUserId(supabase);

  if (!userId) {
    return NextResponse.redirect(new URL('/settings', APP_BASE_URL));
  }

  // Generar state CSRF-safe
  const state = randomBytes(16).toString('hex');

  // Persistir state en user_drive_audit
  const admin = getAdminClient();
  const { error: auditError } = await admin.from('user_drive_audit').insert({
    internal_user_id: userId,
    event_type: 'drive_oauth_started',
    metadata: {
      oauth_state: state,
      oauth_state_at: new Date().toISOString(),
    },
  });

  if (auditError) {
    const params = new URLSearchParams({ error: 'Error interno al iniciar la conexión.' });
    return NextResponse.redirect(new URL(`/settings/my-drive?${params}`, APP_BASE_URL));
  }

  // Construir URL de autorización de Google
  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', DRIVE_SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // Garantiza refresh_token en reconexión
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}
