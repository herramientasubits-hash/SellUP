// ============================================================
// «Tu trabajo terminó» — envío (campanita + Slack). Lo llama `updateAgentRun`
// al cerrar una corrida. Una sola vez por corrida. Nunca lanza.
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { buildRunFinishedNotification, ranLongEnough, runKindFor } from './run-finished-message';
import { notifySlackUsers } from './slack-notify.server';

const NOTIFICATION_TYPE = 'agent_run_finished';

export async function notifyAgentRunFinished(runId: string, status: 'completed' | 'failed'): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: run } = await admin
      .from('agent_runs')
      .select('id, agent_key, triggered_by, results_generated, error_message, started_at, finished_at')
      .eq('id', runId)
      .maybeSingle();
    const r = run as {
      agent_key: string | null;
      triggered_by: string | null;
      results_generated: number | null;
      error_message: string | null;
      started_at: string | null;
      finished_at: string | null;
    } | null;
    if (!r?.triggered_by || !ranLongEnough(r.started_at, r.finished_at ?? new Date().toISOString())) return;

    // Una sola vez por corrida (cerrarla dos veces no avisa dos veces).
    const { count } = await admin
      .from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('notification_type', NOTIFICATION_TYPE)
      .eq('entity_id', runId);
    if ((count ?? 0) > 0) return;

    const { data: batch } = await admin.from('prospect_batches').select('id, name').eq('agent_run_id', runId).maybeSingle();
    const b = batch as { id: string; name: string | null } | null;
    let pendingReview: number | null = null;
    if (b) {
      const { count: pending } = await admin
        .from('prospect_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', b.id)
        .in('status', ['needs_review', 'generated', 'normalized']);
      pendingReview = pending ?? null;
    }

    const notification = buildRunFinishedNotification({
      kind: runKindFor(r.agent_key),
      status,
      batchName: b?.name ?? null,
      batchId: b?.id ?? null,
      pendingReview,
      resultsGenerated: r.results_generated,
      errorMessage: r.error_message,
    });
    if (!notification) return;

    await admin.from('user_notifications').insert({
      recipient_internal_user_id: r.triggered_by,
      notification_type: NOTIFICATION_TYPE,
      title: notification.title,
      message: notification.message,
      action_label: notification.actionLabel,
      action_url: notification.actionUrl,
      entity_type: 'agent_run',
      entity_id: runId,
      is_read: false,
    });
    await notifySlackUsers([r.triggered_by], notification, { key: 'run_finished' });
  } catch (error) {
    console.error('[run-finished]', error instanceof Error ? error.message : 'error');
  }
}
