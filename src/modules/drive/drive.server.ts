// ============================================================
// Google Drive — utilidades SÓLO de servidor (sin 'use server').
//
// No son acciones del servidor: no se pueden llamar desde el navegador.
// getAuthorizedDriveClientForUser devuelve un access token de Google de la
// persona indicada, así que sólo debe usarse desde código de servidor que ya
// haya comprobado quién llama. (El paquete 'server-only' no está instalado en
// este repo; por eso no se importa.)
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getUserDriveRefreshToken } from '@/server/services/google-drive-connection';
import { getGoogleDriveAccessToken } from '@/server/services/google-drive-api';
import type { DriveConnectionStats } from './types';

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
