// ============================================================
// Avisos programados por Slack (dueña 11-11). Corren en el proceso diario de
// las 8:15 a. m. de Bogotá (los 2 crons del plan ya están ocupados) y la alerta
// de «proveedor sin créditos», al momento. Sólo LEEN datos y escriben avisos
// (campanita + Slack); nunca tocan presupuesto ni datos comerciales.
//   · Alertas de consumo a administradores: siempre (SELLUP_SLACK_COST_ALERTS=off apaga).
//   · Recordatorio diario de pendientes: según Configuración (lun–vie).
//   · Boletines (diario/semanal/mensual/trimestral): según Configuración › Avisos de Slack.
// Nunca lanza.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { buildCandidateOwnershipOrClause } from '@/modules/assignment/assignment-core';
import { notifySlackUsers, sellupAppUrl } from '@/modules/notifications/slack-notify.server';
import { providerDisplayName } from '@/modules/usage-tracking/provider-failure';
import { createAssistantAdminDataSource } from '../admin-data-source.server';
import { effectiveBatchOwnerClause, usagePeriodStart } from '../query-helpers';
import { isNotificationEnabled, type NotificationKey } from '@/modules/notifications/notification-catalog';
import { loadNotificationSettingRows } from '@/modules/notifications/notification-settings.server';
import { costAlertMessage, costAlertTitle, evaluateCostAlerts, providerBlockedTitle } from './cost-alerts';
import {
  isBogotaWeekday,
  reminderText,
  type PendingSummary,
} from './reminders';

const PENDING_STATUSES = ['needs_review', 'generated', 'normalized'];
const DAY_MS = 86_400_000;

async function activeAdmins(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from('internal_users').select('id, roles(key)').eq('access_status', 'active');
  return ((data ?? []) as unknown as Array<{ id: string; roles: { key: string } | null }>)
    .filter((u) => u.roles?.key === 'admin')
    .map((u) => u.id);
}

/** Aviso (campanita + Slack) a cada persona que todavía no tiene uno con ese título desde `since`. */
async function notifyOnce(
  admin: SupabaseClient,
  recipients: readonly string[],
  input: { type: string; title: string; message: string; actionLabel: string; actionUrl: string },
  since: string,
  key: NotificationKey,
): Promise<number> {
  let sent = 0;
  for (const recipient of recipients) {
    const { count } = await admin
      .from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_internal_user_id', recipient)
      .eq('notification_type', input.type)
      .eq('title', input.title)
      .gte('created_at', since);
    if ((count ?? 0) > 0) continue;
    await admin.from('user_notifications').insert({
      recipient_internal_user_id: recipient,
      notification_type: input.type,
      title: input.title,
      message: input.message,
      action_label: input.actionLabel,
      action_url: input.actionUrl,
      is_read: false,
    });
    sent += await notifySlackUsers([recipient], input, { key });
  }
  return sent;
}

/**
 * Lo que una persona tiene por revisar, por RESPONSABLE efectivo (como
 * `resolveCandidateResponsibleId`): asignado a ella, o sin asignar en una
 * búsqueda de la que es dueña, o sin asignar en una búsqueda sin dueño que ella
 * creó. Una búsqueda que creó pero tiene otro dueño NO cuenta como suya.
 * Alimenta el recordatorio diario y el boletín.
 */
export async function pendingFor(admin: SupabaseClient, userId: string, now: Date = new Date()): Promise<PendingSummary> {
  const { data: batches } = await admin.from('prospect_batches').select('id').or(effectiveBatchOwnerClause([userId])).limit(5000);
  const clause = buildCandidateOwnershipOrClause([userId], (batches ?? []).map((b) => b.id as string));
  if (!clause) return { total: 0, oldestDays: null, olderThan7: 0, sample: [] };
  const { data, count } = await admin
    .from('prospect_candidates')
    .select('name, created_at', { count: 'exact' })
    .in('status', PENDING_STATUSES)
    .or(clause)
    .order('created_at', { ascending: true })
    .limit(200);
  const rows = (data ?? []) as Array<{ name: string; created_at: string }>;
  const ages = rows.map((r) => Math.floor((now.getTime() - Date.parse(r.created_at)) / DAY_MS));
  return {
    total: count ?? rows.length,
    oldestDays: ages.length ? Math.max(...ages) : null,
    olderThan7: ages.filter((a) => a > 7).length,
    sample: rows.slice(0, 3).map((r) => r.name),
  };
}

export async function runCostAlerts(admin: SupabaseClient, now: Date): Promise<number> {
  if (process.env.SELLUP_SLACK_COST_ALERTS?.trim().toLowerCase() === 'off') return 0;
  const budget = await createAssistantAdminDataSource(admin, { appUrl: sellupAppUrl(), now }).budget();
  const alerts = evaluateCostAlerts(budget.proveedores, now);
  if (alerts.length === 0) return 0;
  const admins = await activeAdmins(admin);
  const monthStart = usagePeriodStart('mes', now);
  let sent = 0;
  for (const alert of alerts) {
    sent += await notifyOnce(
      admin,
      admins,
      { type: 'budget_threshold', title: costAlertTitle(alert), message: costAlertMessage(alert), actionLabel: 'Ver proveedores', actionUrl: '/settings/providers' },
      monthStart,
      'cost_alerts',
    );
  }
  return sent;
}

/**
 * Un proveedor dejó de responder por saldo o llave: aviso inmediato a los
 * administradores, una vez al día por proveedor. Lo llama el registro de uso.
 */
export async function alertProviderBlocked(providerKey: string, code: string, detail: string | null): Promise<void> {
  try {
    if (process.env.SELLUP_SLACK_COST_ALERTS?.trim().toLowerCase() === 'off') return;
    const admin = createSupabaseAdminClient();
    const provider = providerDisplayName(providerKey);
    await notifyOnce(
      admin,
      await activeAdmins(admin),
      {
        type: 'provider_blocked',
        title: providerBlockedTitle(provider, code),
        message:
          (code === 'credits_exhausted'
            ? `Las búsquedas que usan ${provider} están fallando por falta de saldo. Hay que recargar en la cuenta del proveedor.`
            : `${provider} rechaza la llave: hay que revisar la conexión en Proveedores y consumo.`) + (detail ? ` Detalle: ${detail.slice(0, 200)}` : ''),
        actionLabel: 'Ver proveedores',
        actionUrl: '/settings/providers',
      },
      usagePeriodStart('hoy', new Date()),
      'provider_blocked',
    );
  } catch (error) {
    console.error('[slack-digests] proveedor bloqueado', error instanceof Error ? error.message : 'error');
  }
}

export async function runDailyReminders(admin: SupabaseClient, now: Date): Promise<number> {
  // Quién lo recibe se decide en Configuración › Avisos de Slack (aviso «daily_reminder»).
  if (!isBogotaWeekday(now)) return 0;
  const { data } = await admin
    .from('internal_users')
    .select('id, full_name, email, roles(key)')
    .eq('access_status', 'active');
  const rows = await loadNotificationSettingRows(admin);
  const people = ((data ?? []) as unknown as Array<{ id: string; full_name: string | null; email: string | null; roles: { key: string } | null }>).filter(
    (u) => isNotificationEnabled('daily_reminder', { userId: u.id, roleKey: u.roles?.key ?? null }, rows),
  );
  let sent = 0;
  for (const person of people) {
    const pending = await pendingFor(admin, person.id, now);
    if (pending.total === 0) continue;
    sent += await notifySlackUsers([person.id], {
      title: 'Tus empresas por revisar',
      message: reminderText({ personName: person.full_name, pending }),
      actionLabel: 'Ver por revisar',
      actionUrl: `/accounts?tab=prospectos&userId=${encodeURIComponent(person.id)}`,
      footer: 'Recordatorio diario de SellUp',
    }, { key: 'daily_reminder' });
  }
  return sent;
}

/** Todo lo diario, en orden. Nunca lanza: cada parte falla sola. */
export async function runSlackDailyDigests(now: Date = new Date()): Promise<Record<string, number | string>> {
  const result: Record<string, number | string> = {};
  let admin: SupabaseClient;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return { error: 'admin_client_unavailable' };
  }
  for (const [key, run] of [
    ['costAlerts', runCostAlerts],
    ['dailyReminders', runDailyReminders],
  ] as const) {
    try {
      result[key] = await run(admin, now);
    } catch (error) {
      result[key] = `error: ${error instanceof Error ? error.message.slice(0, 120) : 'error'}`;
    }
  }
  // Boletines (diario, semanal, mensual, trimestral) a quienes los tienen encendidos.
  try {
    const { runDueBulletins } = await import('@/modules/bulletin/bulletin-send.server');
    const bulletins = await runDueBulletins(admin, now);
    for (const [frequency, sent] of Object.entries(bulletins)) result[`bulletin_${frequency}`] = sent;
  } catch (error) {
    result.bulletins = `error: ${error instanceof Error ? error.message.slice(0, 120) : 'error'}`;
  }
  return result;
}
