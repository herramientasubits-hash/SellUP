/**
 * Agente 1 · «Competidores» — datos de calidad por referencia y fuente (sólo
 * servidor, con la sesión: cada quien ve sus lotes según RLS). Nunca lanza.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildCompetitorQuality,
  type CompetitorQualityBatch,
  type CompetitorQualityCandidate,
} from '@/modules/prospect-batches/competitor-search/competitor-quality';

const QUALITY_BATCH_LIMIT = 200;
const QUALITY_CANDIDATE_LIMIT = 3000;

export async function loadCompetitorQuality(
  supabase: SupabaseClient,
  since: string,
): Promise<ReturnType<typeof buildCompetitorQuality> | null> {
  try {
    const { data: batches, error } = await supabase
      .from('prospect_batches')
      .select('id, reference_name:metadata->competitor_search->reference->>name')
      .eq('metadata->>search_mode', 'competitors')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(QUALITY_BATCH_LIMIT);
    if (error || !batches || batches.length === 0) return null;
    const rows = batches as CompetitorQualityBatch[];
    const { data: candidates, error: candidatesError } = await supabase
      .from('prospect_candidates')
      .select('batch_id, status, source_primary, review_notes, metadata')
      .in('batch_id', rows.map((b) => b.id))
      .limit(QUALITY_CANDIDATE_LIMIT);
    if (candidatesError || !candidates) return null;
    return buildCompetitorQuality(rows, candidates as CompetitorQualityCandidate[]);
  } catch (err) {
    console.error('[competitor-quality] load failed (non-critical):', err instanceof Error ? err.message : err);
    return null;
  }
}
