'use server';

// ============================================================
// Actions: Google Drive personal integration
//
// Todas las operaciones sensibles (Vault, tokens, Drive API)
// corren exclusivamente server-side.
// Nunca se exponen tokens al frontend.
// ============================================================

import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  getUserDriveRefreshToken,
  removeUserDriveRefreshToken,
} from '@/server/services/google-drive-connection';
import {
  getGoogleDriveAccessToken,
  testDriveConnection,
} from '@/server/services/google-drive-api';
import type { UserDriveConnection, DriveAuditEventType } from './types';

// -------------------------------------------------------
// Helpers internos
// -------------------------------------------------------

async function getCurrentActiveUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createSupabaseAdminClient();
  const { data: internalUser } = await admin
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  return internalUser?.id ?? null;
}

async function logDriveAudit(
  internalUserId: string,
  eventType: DriveAuditEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await createSupabaseAdminClient()
      .from('user_drive_audit')
      .insert({ internal_user_id: internalUserId, event_type: eventType, metadata: metadata ?? null });
  } catch {
    // Auditoría no bloquea la operación principal
  }
}

// -------------------------------------------------------
// Leer conexión del usuario actual
// -------------------------------------------------------

export async function getUserDriveConnection(): Promise<UserDriveConnection | null> {
  const userId = await getCurrentActiveUserId();
  if (!userId) return null;

  const { data } = await createSupabaseAdminClient()
    .from('user_drive_connections')
    .select('*')
    .eq('internal_user_id', userId)
    .maybeSingle();

  return (data as UserDriveConnection | null) ?? null;
}

// -------------------------------------------------------
// Probar conexión
// -------------------------------------------------------

export async function testUserDriveConnection(): Promise<{
  success: boolean;
  message: string;
}> {
  const userId = await getCurrentActiveUserId();
  if (!userId) return { success: false, message: 'No autorizado.' };

  await logDriveAudit(userId, 'drive_connection_tested');

  const refreshToken = await getUserDriveRefreshToken(userId);
  if (!refreshToken) {
    return { success: false, message: 'No hay credenciales de Drive almacenadas.' };
  }

  const tokenResult = await getGoogleDriveAccessToken(refreshToken);
  if (!tokenResult.success) {
    const now = new Date().toISOString();
    await createSupabaseAdminClient()
      .from('user_drive_connections')
      .update({
        connection_status: 'error',
        last_connection_error: tokenResult.error,
        last_tested_at: now,
        updated_at: now,
      })
      .eq('internal_user_id', userId);

    await logDriveAudit(userId, 'drive_connection_failed', { error: tokenResult.error });
    return { success: false, message: 'No se pudo obtener acceso a Drive. Verifica la conexión.' };
  }

  const testResult = await testDriveConnection(tokenResult.accessToken);

  const now = new Date().toISOString();

  if (!testResult.success) {
    await createSupabaseAdminClient()
      .from('user_drive_connections')
      .update({
        connection_status: 'error',
        last_connection_error: testResult.error,
        last_tested_at: now,
        updated_at: now,
      })
      .eq('internal_user_id', userId);

    await logDriveAudit(userId, 'drive_connection_failed', { error: testResult.error });
    return { success: false, message: 'La conexión a Drive falló. Reconecta tu cuenta.' };
  }

  await createSupabaseAdminClient()
    .from('user_drive_connections')
    .update({
      connection_status: 'connected',
      last_connection_error: null,
      last_tested_at: now,
      updated_at: now,
    })
    .eq('internal_user_id', userId);

  await logDriveAudit(userId, 'drive_connection_succeeded');
  return { success: true, message: 'Conexión a Google Drive verificada correctamente.' };
}

// -------------------------------------------------------
// Desconectar Drive
// -------------------------------------------------------

export async function disconnectUserDrive(): Promise<{
  success: boolean;
  message: string;
}> {
  const userId = await getCurrentActiveUserId();
  if (!userId) return { success: false, message: 'No autorizado.' };

  const result = await removeUserDriveRefreshToken(userId);

  if (!result.success) {
    return {
      success: false,
      message: result.error ?? 'Error al desconectar Drive.',
    };
  }

  await logDriveAudit(userId, 'drive_disconnected');
  return { success: true, message: 'Google Drive desconectado correctamente.' };
}

// getDriveConnectionStats y getAuthorizedDriveClientForUser viven en
// ./drive.server.ts: no son acciones (una acción 'use server' la puede llamar
// cualquier sesión, y la segunda devuelve el token de Google de otra persona).
