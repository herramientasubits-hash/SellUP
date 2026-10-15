/**
 * Agente 1 · Búsqueda en árbol — las asociaciones de UN lote, para su página
 * (sólo lectura con la sesión; RLS de la migración 148). Nunca lanza.
 */

import { createClient } from '@/lib/supabase/server';
import {
  isOwnWebsiteRow,
  ownDomainsWithoutCandidate,
  type CorporateTreeBatchRelationship,
} from './corporate-tree-batch-groups';

const MAX_ROWS = 300;

export async function loadCorporateTreeBatchRelationships(batchId: string): Promise<CorporateTreeBatchRelationship[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('agent1_company_relationships')
      .select('related_candidate_id, related_name, related_country_code, related_domain, root_domain, relation_type, relation_detail, evidence_url, matched_hubspot_company_id')
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
    const withReasons = relationships.map((rel) =>
      rel.related_candidate_id ? rel : { ...rel, discard_reason_code: reasonByName.get(rel.related_name.trim().toLowerCase()) ?? null },
    );
    // Las que tienen web propia y no entraron porque esa web ya está en otra búsqueda o
    // cuenta («una empresa, un vendedor»). Prod 15-10, Citigroup: aparecían como «web del grupo».
    const ownDomains = ownDomainsWithoutCandidate(withReasons);
    if (ownDomains.length === 0) return withReasons;
    const [candidates, accounts] = await Promise.all([
      supabase.from('prospect_candidates').select('domain').in('domain', ownDomains).neq('batch_id', batchId).limit(MAX_ROWS),
      supabase.from('accounts').select('domain').in('domain', ownDomains).is('archived_at', null).limit(MAX_ROWS),
    ]);
    const known = new Set(
      [...(candidates.data ?? []), ...(accounts.data ?? [])].map((r) => String(r.domain ?? '').toLowerCase()).filter(Boolean),
    );
    return withReasons.map((rel) => {
      const own = !rel.related_candidate_id && !!rel.related_domain && ownDomains.includes(rel.related_domain) && isOwnWebsiteRow(rel, withReasons);
      if (!own) return rel;
      return { ...rel, own_website: true, known_in_sellup: known.has((rel.related_domain as string).toLowerCase()) };
    });
  } catch {
    return [];
  }
}
