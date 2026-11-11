// ============================================================
// Avisos de SellUp por Slack — envío (dueña 11-11). Nunca lanza: el aviso
// de la campanita ya quedó guardado y Slack es un canal más.
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { sellupLoginUrl } from '@/modules/access/slack-invitation.server';
import { sendSlackDirectMessageByEmail } from '@/server/services/slack-connection';
import {
  buildSlackNotificationMessage,
  slackNotificationsEnabled,
  type SlackNotificationInput,
} from './slack-notification-message';
import type { NotificationKey } from './notification-catalog';
import { recipientsWithNotification } from './notification-settings.server';

export function sellupAppUrl(): string {
  return sellupLoginUrl().replace(/\/login$/, '');
}

/**
 * Manda el aviso por mensaje directo a cada persona (por su id de SellUp), sólo
 * a usuarios activos y, si viene `key`, sólo a quienes tienen ese aviso
 * encendido en Configuración (por persona o por rol).
 */
export async function notifySlackUsers(
  internalUserIds: readonly string[],
  input: SlackNotificationInput,
  options: {
    /** El aviso del catálogo (sin él, se manda a todos: invitaciones, recordatorios a pedido). */
    key?: NotificationKey;
    /** Botones extra (p. ej. decidir una solicitud de créditos). */
    extraButtons?: ReadonlyArray<Record<string, unknown>>;
    /** Bloques ya armados (boletín): reemplazan al mensaje simple. */
    blocks?: ReadonlyArray<Record<string, unknown>>;
  } = {},
): Promise<number> {
  if (!slackNotificationsEnabled(process.env)) return 0;
  const ids = [...new Set(internalUserIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  try {
    const admin = createSupabaseAdminClient();
    const recipients = options.key
      ? await recipientsWithNotification(admin, ids, options.key)
      : ((await admin.from('internal_users').select('id, email').in('id', ids).eq('access_status', 'active')).data ?? []) as Array<{ email: string | null }>;
    const simple = buildSlackNotificationMessage(input, sellupAppUrl(), options.extraButtons);
    const message = options.blocks ? { text: simple.text, blocks: [...options.blocks] } : simple;
    const outcomes = await Promise.all(
      recipients
        .filter((u) => u.email)
        .map((u) => sendSlackDirectMessageByEmail(u.email as string, message).catch(() => 'failed' as const)),
    );
    return outcomes.filter((o) => o === 'sent').length;
  } catch (error) {
    console.error('[slack-notify]', error instanceof Error ? error.message : 'error');
    return 0;
  }
}
