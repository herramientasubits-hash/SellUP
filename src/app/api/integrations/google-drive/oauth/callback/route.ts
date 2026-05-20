/**
 * GET /api/integrations/google-drive/oauth/callback
 *
 * Procesa el callback del flujo OAuth 2.0 de Google Drive.
 *
 * Flujo:
 * 1. Valida parámetros code + state.
 * 2. Valida state contra user_drive_audit (ventana 10 min, vinculado al usuario).
 * 3. Verifica que el usuario esté autenticado y activo.
 * 4. Intercambia code por access_token + refresh_token.
 * 5. Valida que exista refresh_token.
 * 6. Guarda refresh_token en Supabase Vault.
 * 7. Crea o reutiliza carpeta raíz "SellUp" en el Drive del usuario.
 * 8. Persiste metadata no sensible en user_drive_connections.
 * 9. Registra auditoría.
 * 10. Redirige a /settings/my-drive?connected=1
 *
 * Nunca loggear ni exponer: code, refresh_token, access_token, client_secret.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { storeUserDriveRefreshToken } from '@/server/services/google-drive-connection';
import { createSellUpDriveFolder } from '@/server/services/google-drive-api';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  }
  return createAdminClient(SUPABASE_URL, serviceKey);
}

function errorRedirect(message: string): NextResponse {
  const url = new URL('/settings/my-drive', APP_BASE_URL);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url.toString());
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const googleError = searchParams.get('error');

  // 1. Cancelación o error de Google
  if (googleError) {
    return errorRedirect(
      googleError === 'access_denied'
        ? 'Autorización cancelada.'
        : `Error de Google: ${googleError}`
    );
  }

  if (!code || !state) {
    return errorRedirect('Parámetros inválidos en el callback.');
  }

  // 2. Validar state contra user_drive_audit (ventana 10 minutos)
  const admin = getAdminClient();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: auditRow } = await admin
    .from('user_drive_audit')
    .select('internal_user_id, created_at')
    .eq('event_type', 'drive_oauth_started')
    .filter('metadata->>oauth_state', 'eq', state)
    .gte('created_at', tenMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!auditRow) {
    return errorRedirect('Validación de estado fallida. Intenta conectar nuevamente.');
  }

  const stateUserId = auditRow.internal_user_id as string;

  // 3. Verificar que el usuario autenticado coincida con el state
  const supabase = await createClient();
  const sessionUserId = await getActiveInternalUserId(supabase);

  if (!sessionUserId || sessionUserId !== stateUserId) {
    await admin.from('user_drive_audit').insert({
      internal_user_id: stateUserId,
      event_type: 'drive_oauth_failed',
      metadata: { error_code: 'user_mismatch' },
    });
    return errorRedirect('Error de autenticación. Intenta nuevamente.');
  }

  const userId = sessionUserId;

  // 4. Resolver credenciales
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_DRIVE_REDIRECT_URI ??
    `${APP_BASE_URL}/api/integrations/google-drive/oauth/callback`;

  if (!clientId || !clientSecret) {
    await admin.from('user_drive_audit').insert({
      internal_user_id: userId,
      event_type: 'drive_oauth_failed',
      metadata: { error_code: 'missing_credentials' },
    });
    return errorRedirect('Configuración de Google Drive incompleta.');
  }

  // 5. Intercambiar code por tokens
  interface GoogleTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  }

  let tokenData: GoogleTokenResponse;

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code,
    });

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      await admin.from('user_drive_audit').insert({
        internal_user_id: userId,
        event_type: 'drive_oauth_failed',
        metadata: { error_code: `http_${res.status}` },
      });
      return errorRedirect(`Error al obtener tokens de Google (${res.status}).`);
    }

    tokenData = await res.json();
  } catch {
    await admin.from('user_drive_audit').insert({
      internal_user_id: userId,
      event_type: 'drive_oauth_failed',
      metadata: { error_code: 'network_error' },
    });
    return errorRedirect('Error de red al contactar Google.');
  }

  if (tokenData.error) {
    await admin.from('user_drive_audit').insert({
      internal_user_id: userId,
      event_type: 'drive_oauth_failed',
      metadata: { error_code: tokenData.error },
    });
    return errorRedirect(`Error de Google: ${tokenData.error}`);
  }

  // 6. Validar que exista refresh_token
  const refreshToken = tokenData.refresh_token;
  const accessToken = tokenData.access_token;

  if (!refreshToken || !accessToken) {
    await admin.from('user_drive_audit').insert({
      internal_user_id: userId,
      event_type: 'drive_oauth_failed',
      metadata: { error_code: 'no_refresh_token' },
    });
    return errorRedirect(
      'Google no retornó un refresh token. Asegúrate de usar prompt=consent.'
    );
  }

  // 7. Guardar refresh_token en Vault (NUNCA el access_token)
  const storeResult = await storeUserDriveRefreshToken(userId, refreshToken);
  if (!storeResult.success) {
    await admin.from('user_drive_audit').insert({
      internal_user_id: userId,
      event_type: 'drive_oauth_failed',
      metadata: { error_code: 'vault_store_failed' },
    });
    return errorRedirect('Error al guardar la conexión de Drive.');
  }

  // 8. Crear o reutilizar carpeta raíz SellUp
  //    Si ya existe un folder_id registrado en DB, reutilizarlo para evitar duplicados.
  const { data: existingConn } = await admin
    .from('user_drive_connections')
    .select('drive_folder_id, drive_folder_name')
    .eq('internal_user_id', userId)
    .maybeSingle();

  let folderId = existingConn?.drive_folder_id as string | null;
  let folderName = existingConn?.drive_folder_name as string | null;
  let folderCreated = false;

  if (!folderId) {
    const folderResult = await createSellUpDriveFolder(accessToken);
    if (folderResult.success) {
      folderId = folderResult.folder.id;
      folderName = folderResult.folder.name;
      folderCreated = true;
    }
    // Si falla la creación de carpeta, no bloqueamos la conexión
  }

  // 9. Persistir metadata en user_drive_connections
  const now = new Date().toISOString();
  await admin
    .from('user_drive_connections')
    .upsert(
      {
        internal_user_id: userId,
        credentials_status: 'stored',
        connection_status: 'connected',
        drive_folder_id: folderId,
        drive_folder_name: folderName,
        connected_at: now,
        last_connection_error: null,
        disconnected_at: null,
        updated_at: now,
      },
      { onConflict: 'internal_user_id' }
    );

  // 10. Auditoría
  await admin.from('user_drive_audit').insert({
    internal_user_id: userId,
    event_type: 'drive_oauth_connected',
    metadata: {
      has_folder: !!folderId,
      folder_id: folderId ?? null,
    },
  });

  if (folderCreated && folderId) {
    await admin.from('user_drive_audit').insert({
      internal_user_id: userId,
      event_type: 'drive_folder_created',
      metadata: { folder_id: folderId, folder_name: folderName },
    });
  }

  return NextResponse.redirect(new URL('/settings/my-drive?connected=1', APP_BASE_URL));
}
