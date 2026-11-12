'use server';

// ============================================================
// Configuración › Mis avisos de Slack (dueña 11-11) — cada persona decide sus
// propios avisos y boletines (sólo los que aplican a su rol). Escribe una regla
// «personal» (scope user = yo), la misma que puede poner un administrador.
// ============================================================

import { revalidatePath } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/modules/access/actions';
import { buildBulletinForUser } from '@/modules/bulletin/bulletin-data.server';
import { bulletinPeriodContaining, type BulletinModel } from '@/modules/bulletin/bulletin-model';
import { listBulletinDeliveries, readBulletinDelivery, type BulletinDeliveryRow } from '@/modules/bulletin/bulletin-send.server';
import {
  NOTIFICATION_CATALOG,
  appliesToRole,
  isNotificationEnabled,
  notificationDefinition,
  notificationSource,
  type BulletinFrequency,
  type NotificationDefinition,
} from './notification-catalog';
import { loadNotificationSettingRows } from './notification-settings.server';

const MY_NOTIFICATIONS_PATH = '/settings/my-notifications';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type Result<T = void> = { success: true; data: T } | { success: false; error: string };

export interface MyNotificationItem {
  definition: NotificationDefinition;
  enabled: boolean;
  source: ReturnType<typeof notificationSource>;
}

export interface MyNotificationSettings {
  userId: string;
  name: string;
  roleKey: string | null;
  items: MyNotificationItem[];
  /** La tabla 165 existe (si no, se ven los valores por defecto y no se guarda). */
  ready: boolean;
}

async function me(): Promise<{ id: string; name: string; roleKey: string | null } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await createSupabaseAdminClient()
    .from('internal_users')
    .select('id, full_name, email, access_status, roles(key)')
    .eq('id', user.id)
    .maybeSingle();
  const row = data as unknown as { id: string; full_name: string | null; email: string | null; access_status: string; roles: { key: string } | null } | null;
  if (!row || row.access_status !== 'active') return null;
  return { id: row.id, name: row.full_name ?? row.email ?? 'Tú', roleKey: row.roles?.key ?? null };
}

export async function getMyNotificationSettings(): Promise<Result<MyNotificationSettings>> {
  const user = await me();
  if (!user) return { success: false, error: 'No autorizado' };
  const admin = createSupabaseAdminClient();
  const [rows, probe] = await Promise.all([
    loadNotificationSettingRows(admin),
    admin.from('slack_notification_settings').select('id', { count: 'exact', head: true }),
  ]);
  const who = { userId: user.id, roleKey: user.roleKey };
  return {
    success: true,
    data: {
      userId: user.id,
      name: user.name,
      roleKey: user.roleKey,
      items: NOTIFICATION_CATALOG.filter((d) => appliesToRole(d.key, user.roleKey)).map((definition) => ({
        definition,
        enabled: isNotificationEnabled(definition.key, who, rows),
        source: notificationSource(definition.key, who, rows),
      })),
      ready: !probe.error,
    },
  };
}

/** Enciende, apaga o quita (`null` = vuelve a lo de su rol) uno de MIS avisos. */
export async function setMyNotificationSetting(input: { notificationKey: string; enabled: boolean | null }): Promise<Result> {
  const user = await me();
  if (!user) return { success: false, error: 'No autorizado' };
  const definition = notificationDefinition(input.notificationKey);
  if (!definition || !appliesToRole(definition.key, user.roleKey)) {
    return { success: false, error: 'Ese aviso no aplica a tu rol.' };
  }
  const admin = createSupabaseAdminClient();
  const { error } =
    input.enabled === null
      ? await admin
          .from('slack_notification_settings')
          .delete()
          .eq('scope_type', 'user')
          .eq('scope_id', user.id)
          .eq('notification_key', input.notificationKey)
      : await admin.from('slack_notification_settings').upsert(
          {
            scope_type: 'user',
            scope_id: user.id,
            notification_key: input.notificationKey,
            enabled: input.enabled,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'scope_type,scope_id,notification_key' },
        );
  if (error) return { success: false, error: 'No se pudo guardar. Inténtalo de nuevo en un momento.' };
  revalidatePath(MY_NOTIFICATIONS_PATH);
  return { success: true, data: undefined };
}

/** Mi boletín (no se envía): el de hoy o el del período que contiene `day`. */
export async function previewMyBulletin(input: { frequency: BulletinFrequency; day?: string | null }): Promise<Result<BulletinModel>> {
  const user = await me();
  if (!user) return { success: false, error: 'No autorizado' };
  if (input.day && !DAY_RE.test(input.day)) return { success: false, error: 'Fecha inválida.' };
  const period = input.day ? bulletinPeriodContaining(input.frequency, input.day) : undefined;
  const built = await buildBulletinForUser(createSupabaseAdminClient(), user.id, input.frequency, new Date(), period).catch(() => null);
  return built ? { success: true, data: built.model } : { success: false, error: 'No se pudo armar tu boletín.' };
}

export async function getMyBulletinHistory(): Promise<Result<BulletinDeliveryRow[]>> {
  const user = await me();
  if (!user) return { success: false, error: 'No autorizado' };
  const rows = await listBulletinDeliveries(createSupabaseAdminClient(), 50, user.id);
  // Sólo los automáticos: las pruebas de un admin no son «sus» boletines.
  return { success: true, data: rows.filter((r) => !r.manual) };
}

export async function getMyBulletinDelivery(id: string): Promise<Result<BulletinModel>> {
  const user = await me();
  if (!user) return { success: false, error: 'No autorizado' };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { success: false, error: 'Boletín desconocido.' };
  const model = await readBulletinDelivery(createSupabaseAdminClient(), id, user.id);
  return model ? { success: true, data: model } : { success: false, error: 'No encontramos ese boletín.' };
}
