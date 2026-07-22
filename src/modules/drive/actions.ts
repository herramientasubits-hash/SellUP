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
import type { UserDriveConnection, DriveConnectionStats, DriveAuditEventType } from './types';

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

// -------------------------------------------------------
// Stats para System Status (admin)
// -------------------------------------------------------

export async function getDriveConnectionStats(): Promise<DriveConnectionStats | null> {
  const { data, error } = await createSupabaseAdminClient().rpc('get_drive_connection_stats');
  if (error || !data || !Array.isArray(data) || data.length === 0) return null;

  const row = data[0] as { total_connected: string; total_disconnected: string; total_error: string };
  return {
    total_connected: parseInt(row.total_connected ?? '0', 10),
    total_disconnected: parseInt(row.total_disconnected ?? '0', 10),
    total_error: parseInt(row.total_error ?? '0', 10),
  };
}

// -------------------------------------------------------
// Helpers para módulos futuros
// -------------------------------------------------------

/**
 * Obtiene la conexión Drive del usuario y un access token fresco.
 * Para uso interno en server actions que generan archivos.
 * Nunca exponer al frontend.
 */
export async function getAuthorizedDriveClientForUser(
  internalUserId: string
): Promise<{ success: true; accessToken: string; folderId: string | null } | { success: false; error: string }> {
  const refreshToken = await getUserDriveRefreshToken(internalUserId);
  if (!refreshToken) {
    return { success: false, error: 'No hay credenciales de Drive para este usuario.' };
  }

  const tokenResult = await getGoogleDriveAccessToken(refreshToken);
  if (!tokenResult.success) {
    return { success: false, error: tokenResult.error };
  }

  const { data: conn } = await createSupabaseAdminClient()
    .from('user_drive_connections')
    .select('drive_folder_id')
    .eq('internal_user_id', internalUserId)
    .maybeSingle();

  return {
    success: true,
    accessToken: tokenResult.accessToken,
    folderId: conn?.drive_folder_id ?? null,
  };
}
