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
      .select('related_candidate_id, related_name, related_country_code, related_domain, relation_type, relation_detail, evidence_url, matched_hubspot_company_id')
      .eq('batch_id', batchId)
      .limit(MAX_ROWS);
    if (error) return [];
    const relationships = (data ?? []) as CorporateTreeBatchRelationship[];
    // Por qué está en «Descartadas» la que no entró (sin web o posible duplicado en HubSpot).
    const { data: discards } = await supabase
      .from('prospect_discarded_dispositions')
      .select('name, reason_code')
      .eq('batch_id', batchId)
      .limit(MAX_ROWS);
    const reasonByName = new Map((discards ?? []).map((d) => [String(d.name).trim().toLowerCase(), (d.reason_code as string | null) ?? null]));
    return relationships.map((rel) =>
      rel.related_candidate_id ? rel : { ...rel, discard_reason_code: reasonByName.get(rel.related_name.trim().toLowerCase()) ?? null },
    );
  } catch {
    return [];
  }
}
