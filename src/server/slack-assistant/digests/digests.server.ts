// ============================================================
// Avisos programados por Slack (dueña 11-11). Corren en el proceso diario de
// las 8:15 a. m. de Bogotá (los 2 crons del plan ya están ocupados) y la alerta
// de «proveedor sin créditos», al momento. Sólo LEEN datos y escriben avisos
// (campanita + Slack); nunca tocan presupuesto ni datos comerciales.
//   · Alertas de consumo a administradores: siempre (SELLUP_SLACK_COST_ALERTS=off apaga).
//   · Recordatorio diario de pendientes: SELLUP_SLACK_DAILY_REMINDERS=on (lun–vie).
//   · Resumen semanal a líderes: SELLUP_SLACK_WEEKLY_SUMMARY=on (lunes).
// Nunca lanza.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveCommercialScopeForUser } from '@/modules/access/commercial-scope-core.server';
import { displayUserName } from '@/modules/access/user-names';
import { buildCandidateOwnershipOrClause } from '@/modules/assignment/assignment-core';
import { notifySlackUsers, sellupAppUrl } from '@/modules/notifications/slack-notify.server';
import { providerDisplayName } from '@/modules/usage-tracking/provider-failure';
import { createAssistantAdminDataSource } from '../admin-data-source.server';
import { batchScopeClause, usagePeriodStart } from '../query-helpers';
import { costAlertMessage, costAlertTitle, evaluateCostAlerts, providerBlockedTitle } from './cost-alerts';
import {
  digestFlagOn,
  isBogotaMonday,
  isBogotaWeekday,
  reminderText,
  weeklySummaryText,
  type PendingSummary,
  type TeamWeekRow,
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
    sent += await notifySlackUsers([recipient], input);
  }
  return sent;
}

/** Lo que una persona tiene por revisar (responsable efectivo: asignado o dueño de la búsqueda). */
export async function pendingFor(admin: SupabaseClient, userId: string, now: Date = new Date()): Promise<PendingSummary> {
  const { data: batches } = await admin.from('prospect_batches').select('id').or(batchScopeClause([userId])).limit(5000);
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
    );
  } catch (error) {
    console.error('[slack-digests] proveedor bloqueado', error instanceof Error ? error.message : 'error');
  }
}

export async function runDailyReminders(admin: SupabaseClient, now: Date): Promise<number> {
  if (!digestFlagOn(process.env.SELLUP_SLACK_DAILY_REMINDERS) || !isBogotaWeekday(now)) return 0;
  const { data } = await admin
    .from('internal_users')
    .select('id, full_name, email, roles(key)')
    .eq('access_status', 'active');
  const people = ((data ?? []) as unknown as Array<{ id: string; full_name: string | null; email: string | null; roles: { key: string } | null }>).filter(
    (u) => u.roles?.key !== 'admin',
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
    });
  }
  return sent;
}

export async function runWeeklySummary(admin: SupabaseClient, now: Date): Promise<number> {
  if (!digestFlagOn(process.env.SELLUP_SLACK_WEEKLY_SUMMARY) || !isBogotaMonday(now)) return 0;
  const { data } = await admin
    .from('internal_users')
    .select('id, full_name, email, group_id, roles(key)')
    .eq('access_status', 'active');
  const users = (data ?? []) as unknown as Array<{ id: string; full_name: string | null; email: string | null; group_id: string | null; roles: { key: string } | null }>;
  const names = new Map(users.map((u) => [u.id, displayUserName(u) ?? 'Sin nombre']));
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  let sent = 0;
  for (const leader of users.filter((u) => u.roles?.key === 'commercial_lead' || u.roles?.key === 'commercial_manager')) {
    const scope = await resolveCommercialScopeForUser(admin, { id: leader.id, email: leader.email, groupId: leader.group_id, roleKey: leader.roles?.key ?? null });
    const team = scope.canViewAll ? users.map((u) => u.id) : scope.allowedUserIds;
    if (team.length <= 1) continue;
    const rows: TeamWeekRow[] = [];
    for (const memberId of team) {
      const [pending, { count: approved }, { count: discarded }] = await Promise.all([
        pendingFor(admin, memberId, now),
        admin.from('prospect_candidates').select('id', { count: 'exact', head: true }).eq('reviewed_by', memberId).in('status', ['approved', 'converted_to_account']).gte('reviewed_at', weekAgo),
        admin.from('prospect_candidates').select('id', { count: 'exact', head: true }).eq('reviewed_by', memberId).eq('status', 'discarded').gte('reviewed_at', weekAgo),
      ]);
      rows.push({ name: names.get(memberId) ?? 'Sin nombre', approved: approved ?? 0, discarded: discarded ?? 0, pending: pending.total, oldestDays: pending.oldestDays });
    }
    const { data: usage } = await admin
      .from('provider_usage_logs')
      .select('estimated_cost_usd, credits_used')
      .in('triggered_by', team)
      .gte('created_at', weekAgo)
      .limit(20000);
    const usageRows = (usage ?? []) as Array<{ estimated_cost_usd: number | null; credits_used: number | null }>;
    sent += await notifySlackUsers([leader.id], {
      title: 'Resumen semanal de tu equipo',
      message: weeklySummaryText({
        leaderName: leader.full_name,
        rows,
        // Líderes y managers ven dólares (como en Uso de IA).
        usageUsd: usageRows.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0),
        usageCredits: usageRows.reduce((s, r) => s + Number(r.credits_used ?? 0), 0),
      }),
      actionLabel: 'Ver uso del equipo',
      actionUrl: '/ai-usage?tab=equipo',
      footer: 'Resumen de los lunes de SellUp',
    });
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
    ['weeklySummary', runWeeklySummary],
  ] as const) {
    try {
      result[key] = await run(admin, now);
    } catch (error) {
      result[key] = `error: ${error instanceof Error ? error.message.slice(0, 120) : 'error'}`;
    }
  }
  return result;
}
