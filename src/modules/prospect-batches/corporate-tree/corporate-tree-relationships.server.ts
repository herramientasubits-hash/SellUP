/**
 * Agente 1 · Búsqueda en árbol — las asociaciones de UN lote, para su página
 * (sólo lectura con la sesión; RLS de la migración 148). Nunca lanza.
 */

import { createClient } from '@/lib/supabase/server';
import type { CorporateTreeBatchRelationship } from './corporate-tree-batch-groups';

const MAX_ROWS = 300;

export async function loadCorporateTreeBatchRelationships(batchId: string): Promise<CorporateTreeBatchRelationship[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('agent1_company_relationships')
      .select('related_candidate_id, related_name, related_country_code, related_domain, relation_type, relation_detail, evidence_url')
      .eq('batch_id', batchId)
      .limit(MAX_ROWS);
    if (error) return [];
    return (data ?? []) as CorporateTreeBatchRelationship[];
  } catch {
    return [];
  }
}
