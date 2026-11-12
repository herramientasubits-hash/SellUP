'use server';

// ============================================================
// Configuración › Avisos de Slack (dueña 11-11) — acciones (sólo admin).
// Reglas por rol y por persona, vista previa del boletín, envío de prueba e
// historial de boletines enviados.
// ============================================================

import { revalidatePath } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { roleLabelFor } from '@/modules/access/role-labels';
import { buildBulletinForUser } from '@/modules/bulletin/bulletin-data.server';
import { renderBulletinBlocks, type BulletinModel } from '@/modules/bulletin/bulletin-model';
import { listBulletinDeliveries, readBulletinDelivery, type BulletinDeliveryRow } from '@/modules/bulletin/bulletin-send.server';
import { sendSlackDirectMessageByEmail } from '@/server/services/slack-connection';
import {
  NOTIFICATION_CATALOG,
  ROLE_KEYS,
  notificationDefinition,
  type BulletinFrequency,
  type NotificationDefinition,
  type NotificationSettingRow,
} from './notification-catalog';
import { loadNotificationSettingRows } from './notification-settings.server';
import { sellupAppUrl } from './slack-notify.server';

const NOTIFICATION_SETTINGS_PATH = '/settings/notifications';

export interface NotificationSettingsData {
  catalog: NotificationDefinition[];
  roles: Array<{ key: string; label: string }>;
  rows: NotificationSettingRow[];
  users: Array<{ id: string; name: string; email: string | null; roleKey: string | null; roleLabel: string }>;
  /** La tabla 165 existe (si no, se muestran los valores por defecto y no se puede guardar). */
  ready: boolean;
}

type Result<T = void> = { success: true; data: T } | { success: false; error: string };

async function requireAdmin(): Promise<{ id: string } | null> {
  if (!(await isCurrentUserAdmin())) return null;
  const me = await getCurrentUser();
  return me ? { id: me.id } : null;
}

export async function getNotificationSettingsData(): Promise<Result<NotificationSettingsData>> {
  if (!(await requireAdmin())) return { success: false, error: 'No autorizado' };
  const admin = createSupabaseAdminClient();
  const [{ data: users }, rows, probe] = await Promise.all([
    admin.from('internal_users').select('id, full_name, email, roles(key)').eq('access_status', 'active').order('full_name'),
    loadNotificationSettingRows(admin),
    admin.from('slack_notification_settings').select('id', { count: 'exact', head: true }),
  ]);
  return {
    success: true,
    data: {
      catalog: [...NOTIFICATION_CATALOG],
      roles: ROLE_KEYS.map((key) => ({ key, label: roleLabelFor(key) })),
      rows,
      users: ((users ?? []) as unknown as Array<{ id: string; full_name: string | null; email: string | null; roles: { key: string } | null }>).map((u) => ({
        id: u.id,
        name: u.full_name ?? u.email ?? 'Sin nombre',
        email: u.email,
        roleKey: u.roles?.key ?? null,
        roleLabel: roleLabelFor(u.roles?.key),
      })),
      ready: !probe.error,
    },
  };
}

/**
 * Enciende, apaga o quita (`enabled: null` = vuelve a heredar) una regla para
 * un rol o una persona.
 */
export async function setNotificationSetting(input: {
  scopeType: 'role' | 'user';
  scopeId: string;
  notificationKey: string;
  enabled: boolean | null;
}): Promise<Result> {
  const me = await requireAdmin();
  if (!me) return { success: false, error: 'No autorizado' };
  if (!notificationDefinition(input.notificationKey)) return { success: false, error: 'Aviso desconocido.' };
  if (input.scopeType === 'role' && !(ROLE_KEYS as readonly string[]).includes(input.scopeId)) return { success: false, error: 'Rol desconocido.' };
  if (input.scopeType === 'user' && !/^[0-9a-f-]{36}$/i.test(input.scopeId)) return { success: false, error: 'Persona desconocida.' };

  const admin = createSupabaseAdminClient();
  const match = admin
    .from('slack_notification_settings')
    .delete()
    .eq('scope_type', input.scopeType)
    .eq('scope_id', input.scopeId)
    .eq('notification_key', input.notificationKey);
  const { error } =
    input.enabled === null
      ? await match
      : await admin.from('slack_notification_settings').upsert(
          {
            scope_type: input.scopeType,
            scope_id: input.scopeId,
            notification_key: input.notificationKey,
            enabled: input.enabled,
            updated_by: me.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'scope_type,scope_id,notification_key' },
        );
  if (error) return { success: false, error: 'No se pudo guardar. ¿Ya se aplicó la migración 165?' };
  revalidatePath(NOTIFICATION_SETTINGS_PATH);
  return { success: true, data: undefined };
}

/** Vista previa: el boletín que recibiría esta persona hoy (no se envía). */
export async function previewBulletin(input: { userId: string; frequency: BulletinFrequency }): Promise<Result<BulletinModel>> {
  if (!(await requireAdmin())) return { success: false, error: 'No autorizado' };
  const built = await buildBulletinForUser(createSupabaseAdminClient(), input.userId, input.frequency).catch(() => null);
  return built ? { success: true, data: built.model } : { success: false, error: 'No se pudo armar el boletín de esa persona.' };
}

/** Prueba: te manda A TI (por Slack) el boletín que recibiría esa persona. Queda en el historial. */
export async function sendBulletinPreviewToMe(input: { userId: string; frequency: BulletinFrequency }): Promise<Result> {
  const me = await requireAdmin();
  if (!me) return { success: false, error: 'No autorizado' };
  const admin = createSupabaseAdminClient();
  const built = await buildBulletinForUser(admin, input.userId, input.frequency).catch(() => null);
  if (!built) return { success: false, error: 'No se pudo armar el boletín de esa persona.' };
  const { data: user } = await admin.from('internal_users').select('email').eq('id', me.id).maybeSingle();
  const email = (user as { email: string | null } | null)?.email;
  if (!email) return { success: false, error: 'No encontramos tu correo.' };
  const outcome = await sendSlackDirectMessageByEmail(email, renderBulletinBlocks(built.model, sellupAppUrl())).catch(() => 'failed' as const);
  await admin.from('slack_bulletin_deliveries').insert({
    recipient_user_id: me.id,
    frequency: input.frequency,
    period_start: built.model.period.start,
    period_end: built.model.period.end,
    status: outcome === 'sent' ? 'sent' : outcome === 'not_in_slack' ? 'not_in_slack' : 'failed',
    model: { ...built.model, previewOf: built.recipient.name },
    error_message: outcome === 'sent' ? null : outcome,
    triggered_by: me.id,
  });
  revalidatePath(NOTIFICATION_SETTINGS_PATH);
  return outcome === 'sent' ? { success: true, data: undefined } : { success: false, error: 'No llegó por Slack (¿estás en el Slack de UBITS?).' };
}

export async function getBulletinHistory(): Promise<Result<BulletinDeliveryRow[]>> {
  if (!(await requireAdmin())) return { success: false, error: 'No autorizado' };
  return { success: true, data: await listBulletinDeliveries(createSupabaseAdminClient()) };
}

export async function getBulletinDelivery(id: string): Promise<Result<BulletinModel>> {
  if (!(await requireAdmin())) return { success: false, error: 'No autorizado' };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { success: false, error: 'Boletín desconocido.' };
  const model = await readBulletinDelivery(createSupabaseAdminClient(), id);
  return model ? { success: true, data: model } : { success: false, error: 'No encontramos ese boletín.' };
}
