// ============================================================
// Avisos de Slack configurables — lectura de las reglas (servidor).
// Si la tabla 165 todavía no existe (migración sin aplicar), valen los valores
// por defecto del catálogo: nada se rompe.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { isNotificationEnabled, type NotificationKey, type NotificationSettingRow } from './notification-catalog';

export async function loadNotificationSettingRows(admin: SupabaseClient): Promise<NotificationSettingRow[]> {
  try {
    const { data, error } = await admin
      .from('slack_notification_settings')
      .select('scope_type, scope_id, notification_key, enabled')
      .limit(5000);
    if (error) return [];
    return (data ?? []) as NotificationSettingRow[];
  } catch {
    return [];
  }
}

/** De estas personas activas, a quiénes les llega este aviso por Slack. */
export async function recipientsWithNotification(
  admin: SupabaseClient,
  userIds: readonly string[],
  key: NotificationKey,
): Promise<Array<{ id: string; email: string; roleKey: string | null }>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const [{ data }, rows] = await Promise.all([
    admin.from('internal_users').select('id, email, roles(key)').in('id', ids).eq('access_status', 'active'),
    loadNotificationSettingRows(admin),
  ]);
  return ((data ?? []) as unknown as Array<{ id: string; email: string | null; roles: { key: string } | null }>)
    .filter((u) => u.email)
    .map((u) => ({ id: u.id, email: u.email as string, roleKey: u.roles?.key ?? null }))
    .filter((u) => isNotificationEnabled(key, { userId: u.id, roleKey: u.roleKey }, rows));
}
