/**
 * Agente 1 · «Competidores de una empresa» — lee los «no es competidor» de una
 * referencia en lotes anteriores (sólo servidor, cliente de servicio, sólo lectura).
 * Nunca lanza: un fallo de lectura ⇒ sin contraejemplos (la corrida sigue igual).
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { buildNotCompetitorNames } from './competitor-not-competitors';

const SAFE_DOMAIN = /^[a-z0-9.-]+$/;
const BATCH_LOOKUP_LIMIT = 50;
const CANDIDATE_LOOKUP_LIMIT = 200;

export async function loadNotCompetitorNames(reference: { name: string; domain: string | null }): Promise<string[]> {
  try {
    const admin = createSupabaseAdminClient();
    let batches = admin.from('prospect_batches').select('id').eq('metadata->>search_mode', 'competitors');
    batches =
      reference.domain && SAFE_DOMAIN.test(reference.domain)
        ? batches.eq('metadata->competitor_search->reference->>domain', reference.domain)
        : batches.eq('metadata->competitor_search->reference->>name', reference.name);
    const { data: batchRows, error: batchError } = await batches
      .order('created_at', { ascending: false })
      .limit(BATCH_LOOKUP_LIMIT);
    if (batchError || !batchRows || batchRows.length === 0) return [];
    const { data, error } = await admin
      .from('prospect_candidates')
      .select('name, review_notes')
      .in('batch_id', (batchRows as Array<{ id: string }>).map((row) => row.id))
      .eq('status', 'discarded')
      .not('review_notes', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(CANDIDATE_LOOKUP_LIMIT);
    if (error || !data) return [];
    return buildNotCompetitorNames(data as Array<{ name: string | null; review_notes: string | null }>);
  } catch (err) {
    console.error('[competitor-not-competitors] read failed (non-critical):', err instanceof Error ? err.message : err);
    return [];
  }
}
