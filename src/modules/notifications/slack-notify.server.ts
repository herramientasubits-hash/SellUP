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

export function sellupAppUrl(): string {
  return sellupLoginUrl().replace(/\/login$/, '');
}

/** Manda el aviso por mensaje directo a cada persona (por su id de SellUp). Sólo a usuarios activos. */
export async function notifySlackUsers(
  internalUserIds: readonly string[],
  input: SlackNotificationInput,
  /** Botones extra (p. ej. decidir una solicitud de créditos). */
  extraButtons?: ReadonlyArray<Record<string, unknown>>,
): Promise<number> {
  if (!slackNotificationsEnabled(process.env)) return 0;
  const ids = [...new Set(internalUserIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from('internal_users').select('id, email').in('id', ids).eq('access_status', 'active');
    const message = buildSlackNotificationMessage(input, sellupAppUrl(), extraButtons);
    const outcomes = await Promise.all(
      ((data ?? []) as Array<{ email: string | null }>)
        .filter((u) => u.email)
        .map((u) => sendSlackDirectMessageByEmail(u.email!, message).catch(() => 'failed' as const)),
    );
    return outcomes.filter((o) => o === 'sent').length;
  } catch (error) {
    console.error('[slack-notify]', error instanceof Error ? error.message : 'error');
    return 0;
  }
}
