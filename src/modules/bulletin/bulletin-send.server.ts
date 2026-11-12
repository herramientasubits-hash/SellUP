// ============================================================
// Boletín — envío por Slack e historial (servidor).
// Cada mañana (cron 8:15 de Bogotá) se envían los boletines que tocan a quienes
// los tienen encendidos en Configuración. Cada envío queda en el historial con
// su modelo (tabla 165), así se puede volver a ver igual.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sellupAppUrl } from '@/modules/notifications/slack-notify.server';
import { sendSlackDirectMessageByEmail } from '@/server/services/slack-connection';
import { loadNotificationSettingRows } from '@/modules/notifications/notification-settings.server';
import {
  BULLETIN_KEY_BY_FREQUENCY,
  isNotificationEnabled,
  type BulletinFrequency,
} from '@/modules/notifications/notification-catalog';
import { slackNotificationsEnabled } from '@/modules/notifications/slack-notification-message';
import { buildBulletinForUser } from './bulletin-data.server';
import { isBulletinDue, renderBulletinBlocks, type BulletinModel } from './bulletin-model';

export const BULLETIN_FREQUENCIES: readonly BulletinFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly'];

export type BulletinSendStatus = 'sent' | 'failed' | 'not_in_slack' | 'already_sent' | 'no_data';

export interface BulletinSendResult {
  status: BulletinSendStatus;
  model: BulletinModel | null;
}

/**
 * Arma y manda el boletín de una persona. `triggeredBy` = envío manual desde la
 * vista previa (no cuenta como el automático del período). Nunca lanza.
 */
export async function sendBulletin(
  admin: SupabaseClient,
  recipientId: string,
  frequency: BulletinFrequency,
  options: { now?: Date; triggeredBy?: string | null } = {},
): Promise<BulletinSendResult> {
  try {
    const built = await buildBulletinForUser(admin, recipientId, frequency, options.now ?? new Date());
    if (!built) return { status: 'no_data', model: null };
    const { model } = built;

    if (!options.triggeredBy) {
      const { count } = await admin
        .from('slack_bulletin_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', recipientId)
        .eq('frequency', frequency)
        .eq('period_start', model.period.start)
        .is('triggered_by', null);
      if ((count ?? 0) > 0) return { status: 'already_sent', model };
    }

    const { data: user } = await admin.from('internal_users').select('email').eq('id', recipientId).maybeSingle();
    const email = (user as { email: string | null } | null)?.email ?? null;
    const message = renderBulletinBlocks(model, sellupAppUrl());
    const outcome = !slackNotificationsEnabled(process.env)
      ? 'failed'
      : email
        ? await sendSlackDirectMessageByEmail(email, message).catch(() => 'failed' as const)
        : 'not_in_slack';
    const status: BulletinSendStatus = outcome === 'sent' ? 'sent' : outcome === 'not_in_slack' ? 'not_in_slack' : 'failed';

    await admin.from('slack_bulletin_deliveries').insert({
      recipient_user_id: recipientId,
      frequency,
      period_start: model.period.start,
      period_end: model.period.end,
      status,
      model,
      error_message: status === 'sent' ? null : outcome,
      triggered_by: options.triggeredBy ?? null,
    });
    return { status, model };
  } catch (error) {
    console.error('[bulletin] envío', error instanceof Error ? error.message : 'error');
    return { status: 'failed', model: null };
  }
}

/** Los boletines que tocan hoy, a quienes los tienen encendidos. Nunca lanza. */
export async function runDueBulletins(admin: SupabaseClient, now: Date = new Date()): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const due = BULLETIN_FREQUENCIES.filter((f) => isBulletinDue(f, now));
  if (due.length === 0) return result;
  const [{ data: users }, rows] = await Promise.all([
    admin.from('internal_users').select('id, roles(key)').eq('access_status', 'active'),
    loadNotificationSettingRows(admin),
  ]);
  const people = (users ?? []) as unknown as Array<{ id: string; roles: { key: string } | null }>;
  for (const frequency of due) {
    const key = BULLETIN_KEY_BY_FREQUENCY[frequency];
    let sent = 0;
    for (const person of people) {
      if (!isNotificationEnabled(key, { userId: person.id, roleKey: person.roles?.key ?? null }, rows)) continue;
      const outcome = await sendBulletin(admin, person.id, frequency, { now });
      if (outcome.status === 'sent') sent += 1;
    }
    result[frequency] = sent;
  }
  return result;
}

export interface BulletinDeliveryRow {
  id: string;
  recipientId: string;
  recipientName: string;
  frequency: BulletinFrequency;
  periodStart: string;
  periodEnd: string;
  status: string;
  manual: boolean;
  createdAt: string;
}

/** Historial: los últimos envíos (sin el modelo, que se pide al abrir uno). */
export async function listBulletinDeliveries(admin: SupabaseClient, limit = 100): Promise<BulletinDeliveryRow[]> {
  const { data, error } = await admin
    .from('slack_bulletin_deliveries')
    .select('id, recipient_user_id, frequency, period_start, period_end, status, triggered_by, created_at, recipient:internal_users!slack_bulletin_deliveries_recipient_user_id_fkey(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as unknown as Array<{
    id: string;
    recipient_user_id: string;
    frequency: BulletinFrequency;
    period_start: string;
    period_end: string;
    status: string;
    triggered_by: string | null;
    created_at: string;
    recipient: { full_name: string | null; email: string | null } | null;
  }>).map((r) => ({
    id: r.id,
    recipientId: r.recipient_user_id,
    recipientName: r.recipient?.full_name ?? r.recipient?.email ?? 'Sin nombre',
    frequency: r.frequency,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    manual: r.triggered_by !== null,
    createdAt: r.created_at,
  }));
}

export async function readBulletinDelivery(admin: SupabaseClient, id: string): Promise<BulletinModel | null> {
  const { data } = await admin.from('slack_bulletin_deliveries').select('model').eq('id', id).maybeSingle();
  const model = (data as { model: BulletinModel } | null)?.model ?? null;
  return model && typeof model === 'object' && 'pulse' in model ? model : null;
}
