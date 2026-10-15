import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  buildCorporateTreeViews,
  linkTreeRecordsToCandidates,
  type CorporateTreeBatchCandidateRef,
  type CorporateTreeSelf,
  type CorporateTreeAssociationsResponse,
  type CorporateTreeRelationshipRecord,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-associations';

/**
 * Agente 1 · Búsqueda en árbol — las asociaciones de UNA empresa para su ficha
 * (pestaña «Asociaciones»): una de «Por revisar» (`candidateId`) o una cuenta
 * (`accountId`). Sólo lectura con la sesión del vendedor (RLS de la migración 148). Sin la 148 responde `available: false` y la ficha lo dice.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 300;
const NO_STORE = { 'Cache-Control': 'no-store' };
const COLUMNS =
  'batch_id, root_name, root_candidate_id, root_account_id, related_candidate_id, related_name, related_country_code, relation_type, relation_detail, evidence_url, matched_hubspot_company_id, created_at';

const UNAVAILABLE: CorporateTreeAssociationsResponse = { available: false, trees: [] };

/** Cómo encontrar los árboles de una ficha de «Por revisar» o de una cuenta. */
type SelfLookup = { filter: string; self: CorporateTreeSelf; fallbackBatchId: string | null };

async function resolveSelf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ref: { candidateId: string | null; accountId: string | null },
): Promise<SelfLookup | null> {
  if (ref.candidateId) {
    const { data } = await supabase.from('prospect_candidates').select('batch_id').eq('id', ref.candidateId).maybeSingle();
    return {
      filter: `related_candidate_id.eq.${ref.candidateId},root_candidate_id.eq.${ref.candidateId}`,
      self: { candidateIds: new Set([ref.candidateId]) },
      // La empresa pudo entrar después, con el rescate: su asociación está en su lote, sin id.
      fallbackBatchId: (data?.batch_id as string | undefined) ?? null,
    };
  }
  if (!ref.accountId) return null;
  const account = await supabase.from('accounts').select('id, hubspot_company_id').eq('id', ref.accountId).maybeSingle();
  if (account.error || !account.data) return null;
  const converted = await supabase.from('prospect_candidates').select('id').eq('converted_account_id', ref.accountId).limit(MAX_ROWS);
  const candidateIds = new Set((converted.data ?? []).map((r) => r.id as string).filter((id) => UUID.test(id)));
  const hubspotId = String(account.data.hubspot_company_id ?? '').replace(/\D/g, '') || null;
  const parts = [
    `root_account_id.eq.${ref.accountId}`,
    ...(candidateIds.size > 0 ? [`related_candidate_id.in.(${[...candidateIds].join(',')})`, `root_candidate_id.in.(${[...candidateIds].join(',')})`] : []),
    ...(hubspotId ? [`matched_hubspot_company_id.eq.${hubspotId}`] : []),
  ];
  return {
    filter: parts.join(','),
    self: { candidateIds, hubspotCompanyId: hubspotId, accountId: ref.accountId },
    fallbackBatchId: null,
  };
}

export async function GET(request: NextRequest) {
  const candidateId = request.nextUrl.searchParams.get('candidateId') ?? '';
  const accountId = request.nextUrl.searchParams.get('accountId') ?? '';
  if (!UUID.test(candidateId) && !UUID.test(accountId)) {
    return NextResponse.json({ error: 'invalid_candidate' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const lookup = await resolveSelf(supabase, {
    candidateId: UUID.test(candidateId) ? candidateId : null,
    accountId: UUID.test(candidateId) ? null : accountId,
  });
  if (!lookup) return NextResponse.json({ available: true, trees: [] } satisfies CorporateTreeAssociationsResponse, { headers: NO_STORE });

  const own = await supabase.from('agent1_company_relationships').select('batch_id').or(lookup.filter).limit(MAX_ROWS);
  if (own.error) return NextResponse.json(UNAVAILABLE, { headers: NO_STORE });

  let batchIds = [...new Set((own.data ?? []).map((r) => r.batch_id as string))];
  if (batchIds.length === 0 && lookup.fallbackBatchId) batchIds = [lookup.fallbackBatchId];
  if (batchIds.length === 0) {
    return NextResponse.json({ available: true, trees: [] } satisfies CorporateTreeAssociationsResponse, { headers: NO_STORE });
  }

  const all = await supabase
    .from('agent1_company_relationships')
    .select(COLUMNS)
    .in('batch_id', batchIds)
    .limit(MAX_ROWS);
  if (all.error) return NextResponse.json(UNAVAILABLE, { headers: NO_STORE });

  const batchCandidates = await supabase
    .from('prospect_candidates')
    .select('id, batch_id, name, country_code, status')
    .in('batch_id', batchIds)
    .limit(MAX_ROWS);
  const candidateRows = (batchCandidates.data ?? []) as Array<CorporateTreeBatchCandidateRef & { status: string }>;
  const records = linkTreeRecordsToCandidates((all.data ?? []) as CorporateTreeRelationshipRecord[], candidateRows);

  const statusById = new Map<string, string>(candidateRows.map((row) => [row.id, row.status]));
  const missing = [...new Set(records.map((r) => r.related_candidate_id).filter((id): id is string => !!id && !statusById.has(id)))];
  if (missing.length > 0) {
    const { data } = await supabase.from('prospect_candidates').select('id, status').in('id', missing);
    for (const row of data ?? []) statusById.set(row.id as string, row.status as string);
  }

  const response: CorporateTreeAssociationsResponse = {
    available: true,
    trees: buildCorporateTreeViews(records, lookup.self, statusById),
  };
  return NextResponse.json(response, { headers: NO_STORE });
}
