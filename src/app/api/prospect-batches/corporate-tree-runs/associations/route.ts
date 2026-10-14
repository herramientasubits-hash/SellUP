import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  buildCorporateTreeViews,
  type CorporateTreeAssociationsResponse,
  type CorporateTreeRelationshipRecord,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-associations';

/**
 * Agente 1 · Búsqueda en árbol — las asociaciones de UNA empresa para su ficha
 * (pestaña «Asociaciones»). Sólo lectura con la sesión del vendedor (RLS de la
 * migración 148). Sin la 148 responde `available: false` y la ficha lo dice.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 300;
const NO_STORE = { 'Cache-Control': 'no-store' };
const COLUMNS =
  'batch_id, root_name, root_candidate_id, related_candidate_id, related_name, related_country_code, relation_type, relation_detail, evidence_url, matched_hubspot_company_id, created_at';

const UNAVAILABLE: CorporateTreeAssociationsResponse = { available: false, trees: [] };

export async function GET(request: NextRequest) {
  const candidateId = request.nextUrl.searchParams.get('candidateId') ?? '';
  if (!UUID.test(candidateId)) return NextResponse.json({ error: 'invalid_candidate' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const own = await supabase
    .from('agent1_company_relationships')
    .select('batch_id')
    .or(`related_candidate_id.eq.${candidateId},root_candidate_id.eq.${candidateId}`)
    .limit(MAX_ROWS);
  if (own.error) return NextResponse.json(UNAVAILABLE, { headers: NO_STORE });

  const batchIds = [...new Set((own.data ?? []).map((r) => r.batch_id as string))];
  if (batchIds.length === 0) {
    return NextResponse.json({ available: true, trees: [] } satisfies CorporateTreeAssociationsResponse, { headers: NO_STORE });
  }

  const all = await supabase
    .from('agent1_company_relationships')
    .select(COLUMNS)
    .in('batch_id', batchIds)
    .limit(MAX_ROWS);
  if (all.error) return NextResponse.json(UNAVAILABLE, { headers: NO_STORE });
  const records = (all.data ?? []) as CorporateTreeRelationshipRecord[];

  const relatedIds = [...new Set(records.map((r) => r.related_candidate_id).filter((id): id is string => !!id))];
  const statusById = new Map<string, string>();
  if (relatedIds.length > 0) {
    const { data } = await supabase.from('prospect_candidates').select('id, status').in('id', relatedIds);
    for (const row of data ?? []) statusById.set(row.id as string, row.status as string);
  }

  const response: CorporateTreeAssociationsResponse = {
    available: true,
    trees: buildCorporateTreeViews(records, candidateId, statusById),
  };
  return NextResponse.json(response, { headers: NO_STORE });
}
