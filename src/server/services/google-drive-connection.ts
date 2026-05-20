/**
 * Google Drive Connection Service — Vault-backed per-user credentials.
 *
 * Maneja el almacenamiento seguro y recuperación de refresh tokens de Google Drive
 * en Supabase Vault, por usuario. Nunca expone tokens al frontend.
 *
 * Vault secret naming: sellup_user_drive_refresh_token_{internal_user_id}
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  }
  return createAdminClient(SUPABASE_URL, serviceKey);
}

function vaultSecretName(internalUserId: string): string {
  return `sellup_user_drive_refresh_token_${internalUserId}`;
}

/**
 * Guarda o actualiza el refresh token de Drive en Vault para el usuario.
 * Actualiza vault_secret_id en user_drive_connections.
 */
export async function storeUserDriveRefreshToken(
  internalUserId: string,
  refreshToken: string
): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminClient();
  const name = vaultSecretName(internalUserId);

  const { data: vaultId, error: vaultError } = await admin.rpc('upsert_vault_secret', {
    p_name: name,
    p_secret: refreshToken,
    p_description: `Google Drive refresh token for user ${internalUserId}`,
  });

  if (vaultError) {
    return { success: false, error: `Vault error: ${vaultError.message}` };
  }

  const { error: dbError } = await admin
    .from('user_drive_connections')
    .upsert(
      {
        internal_user_id: internalUserId,
        vault_secret_id: vaultId,
        credentials_status: 'stored',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'internal_user_id' }
    );

  if (dbError) {
    return { success: false, error: `DB error: ${dbError.message}` };
  }

  return { success: true };
}

/**
 * Recupera el refresh token de Drive desde Vault (server-side only).
 * Nunca retornar al frontend.
 */
export async function getUserDriveRefreshToken(
  internalUserId: string
): Promise<string | null> {
  const admin = getAdminClient();
  const name = vaultSecretName(internalUserId);

  const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
    p_name: name,
  });

  if (error || !data) return null;
  return data as string;
}

/**
 * Verifica si el usuario tiene un refresh token guardado en Vault.
 */
export async function hasUserDriveRefreshToken(
  internalUserId: string
): Promise<boolean> {
  const admin = getAdminClient();
  const name = vaultSecretName(internalUserId);

  const { data } = await admin.rpc('has_vault_secret', { p_name: name });
  return data === true;
}

/**
 * Elimina el refresh token de Drive desde Vault y limpia la referencia en DB.
 */
export async function removeUserDriveRefreshToken(
  internalUserId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = getAdminClient();
  const name = vaultSecretName(internalUserId);

  const { error: vaultError } = await admin.rpc('delete_vault_secret', {
    p_name: name,
  });

  if (vaultError) {
    return { success: false, error: `Vault error: ${vaultError.message}` };
  }

  const now = new Date().toISOString();
  await admin
    .from('user_drive_connections')
    .update({
      vault_secret_id: null,
      credentials_status: 'missing',
      connection_status: 'disconnected',
      drive_folder_id: null,
      drive_folder_name: null,
      disconnected_at: now,
      last_connection_error: null,
      updated_at: now,
    })
    .eq('internal_user_id', internalUserId);

  return { success: true };
}
