/**
 * Agente 1 · «Competidores de una empresa» — seguimiento de referencias y resumen
 * semanal (sólo servidor, cliente de servicio; migración 156). Nunca busca, nunca
 * gasta, nunca escribe HubSpot. Nunca lanza: un fallo queda en el registro.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  COMPETITOR_WATCH_COUNTED_STATUSES,
  COMPETITOR_WATCH_MAX_PER_RUN,
  COMPETITOR_WATCH_NOTIFICATION_TYPE,
  buildCompetitorWatchKey,
  buildCompetitorWatchNotification,
  isCompetitorWatchDue,
} from '@/modules/prospect-batches/competitor-search/competitor-watch';

const TABLE = 'agent1_competitor_watches';
const SAFE_DOMAIN = /^[a-z0-9.-]+$/;

type WatchRow = {
  id: string;
  internal_user_id: string;
  reference_key: string;
  reference_name: string;
  reference_domain: string | null;
  source_batch_id: string | null;
  last_notified_at: string | null;
  created_at: string;
};

export async function isFollowingCompetitorReference(
  internalUserId: string,
  reference: { name: string; domain: string | null },
): Promise<boolean> {
  try {
    const { count, error } = await createSupabaseAdminClient()
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('internal_user_id', internalUserId)
      .eq('reference_key', buildCompetitorWatchKey(reference));
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function setCompetitorReferenceFollow(input: {
  internalUserId: string;
  reference: { name: string; domain: string | null };
  sourceBatchId: string;
  follow: boolean;
}): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const referenceKey = buildCompetitorWatchKey(input.reference);
    if (!input.follow) {
      const { error } = await admin
        .from(TABLE)
        .delete()
        .eq('internal_user_id', input.internalUserId)
        .eq('reference_key', referenceKey);
      return !error;
    }
    const { error } = await admin.from(TABLE).upsert(
      {
        internal_user_id: input.internalUserId,
        reference_key: referenceKey,
        reference_name: input.reference.name.slice(0, 120),
        reference_domain: input.reference.domain,
        source_batch_id: input.sourceBatchId,
      },
      { onConflict: 'internal_user_id,reference_key' },
    );
    return !error;
  } catch (err) {
    console.error('[competitor-watch] follow failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Competidoras nuevas de la referencia desde `since` (todos los lotes de esa referencia). */
async function countNewCompetitors(admin: SupabaseClient, watch: WatchRow, since: string): Promise<number> {
  let batches = admin.from('prospect_batches').select('id').eq('metadata->>search_mode', 'competitors');
  batches =
    watch.reference_domain && SAFE_DOMAIN.test(watch.reference_domain)
      ? batches.eq('metadata->competitor_search->reference->>domain', watch.reference_domain)
      : batches.eq('metadata->competitor_search->reference->>name', watch.reference_name);
  const { data: batchRows, error } = await batches.limit(50);
  if (error || !batchRows || batchRows.length === 0) return 0;
  const { count } = await admin
    .from('prospect_candidates')
    .select('id', { count: 'exact', head: true })
    .in('batch_id', (batchRows as Array<{ id: string }>).map((row) => row.id))
    .in('status', [...COMPETITOR_WATCH_COUNTED_STATUSES])
    .gte('created_at', since);
  return count ?? 0;
}

export type CompetitorWatchDigestStats = { due: number; notified: number; failed: number };

/** El resumen de los lunes. `null` ⇒ no es lunes (nada que hacer). */
export async function runCompetitorWatchDigest(now: Date = new Date()): Promise<CompetitorWatchDigestStats | null> {
  if (!isCompetitorWatchDue(null, now)) return null;
  const stats: CompetitorWatchDigestStats = { due: 0, notified: 0, failed: 0 };
  try {
    const admin = createSupabaseAdminClient() as unknown as SupabaseClient;
    const { data, error } = await admin
      .from(TABLE)
      .select('id, internal_user_id, reference_key, reference_name, reference_domain, source_batch_id, last_notified_at, created_at')
      .order('last_notified_at', { ascending: true, nullsFirst: true })
      .limit(COMPETITOR_WATCH_MAX_PER_RUN);
    if (error || !data) return stats;
    for (const watch of data as WatchRow[]) {
      if (!isCompetitorWatchDue(watch.last_notified_at, now)) continue;
      stats.due += 1;
      try {
        const since = watch.last_notified_at ?? watch.created_at;
        const newCompetitors = await countNewCompetitors(admin, watch, since);
        const notification = buildCompetitorWatchNotification({
          referenceName: watch.reference_name,
          newCompetitors,
          sourceBatchId: watch.source_batch_id,
        });
        const { error: insertError } = await admin.from('user_notifications').insert({
          recipient_internal_user_id: watch.internal_user_id,
          notification_type: COMPETITOR_WATCH_NOTIFICATION_TYPE,
          title: notification.title,
          message: notification.message,
          action_label: notification.actionLabel,
          action_url: notification.actionUrl,
          entity_type: null,
          entity_id: null,
          is_read: false,
        });
        if (insertError) throw new Error(insertError.message);
        await admin.from(TABLE).update({ last_notified_at: now.toISOString() }).eq('id', watch.id);
        stats.notified += 1;
      } catch (err) {
        stats.failed += 1;
        console.error('[competitor-watch] digest failed for one watch:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[competitor-watch] digest failed:', err instanceof Error ? err.message : err);
  }
  return stats;
}
