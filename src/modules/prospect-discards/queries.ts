'use server';

// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — read-only, commercial-scope-filtered
// queries for the "Descartadas" tab. Unifies two sources into one list:
//
//   - 'disposition' rows from `prospect_discarded_dispositions` (pipeline
//     auto-rejects that never got a `prospect_candidates` row).
//   - 'candidate' rows from `prospect_candidates` at status='discarded' (the
//     existing human "Descartar" flow in prospect-review) — reused via the
//     EXISTING `getGlobalCandidatesList`, which already applies commercial
//     scope. This module does not reimplement that scoping.
//
// No provider calls, no writes — this file only reads already-persisted data.

import { createClient } from '@/lib/supabase/server';
import {
  requireActiveUser,
  resolveAllowedBatchIds,
  getGlobalCandidatesList,
} from '@/modules/prospect-batches/actions';
import type {
  DiscardDispositionCode,
  DiscardedDispositionRow,
  DiscardedProspectItem,
  DiscardedProspectsListFilters,
  DiscardedProspectsListResult,
  DiscardedProspectItemSource,
} from './types';

function toDispositionRow(raw: Record<string, unknown>): DiscardedDispositionRow {
  return {
    id: raw.id as string,
    batchId: raw.batch_id as string,
    candidateId: (raw.candidate_id as string | null) ?? null,
    providerIdentifier: (raw.provider_identifier as string | null) ?? null,
    sourceKey: raw.source_key as string,
    name: raw.name as string,
    domain: (raw.domain as string | null) ?? null,
    countryCode: (raw.country_code as string | null) ?? null,
    industry: (raw.industry as string | null) ?? null,
    sourcePrimary: (raw.source_primary as string | null) ?? null,
    roundOrigin: (raw.round_origin as string | null) ?? null,
    disposition: raw.disposition as DiscardDispositionCode,
    reasonCode: (raw.reason_code as string | null) ?? null,
    reasonDetail: (raw.reason_detail as string | null) ?? null,
    evidence: (raw.evidence as Record<string, unknown>) ?? {},
    status: raw.status as DiscardedDispositionRow['status'],
    resultingCandidateId: (raw.resulting_candidate_id as string | null) ?? null,
    sentToReviewBy: (raw.sent_to_review_by as string | null) ?? null,
    sentToReviewAt: (raw.sent_to_review_at as string | null) ?? null,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

function dispositionToItem(
  row: DiscardedDispositionRow,
  batchName: string | null,
): DiscardedProspectItem {
  return {
    itemId: `disposition:${row.id}`,
    itemSource: 'disposition',
    sourceId: row.id,
    batchId: row.batchId,
    batchName,
    candidateId: row.candidateId,
    name: row.name,
    domain: row.domain,
    countryCode: row.countryCode,
    industry: row.industry,
    sourcePrimary: row.sourcePrimary,
    roundOrigin: row.roundOrigin,
    disposition: row.disposition,
    reasonCode: row.reasonCode,
    reasonDetail: row.reasonDetail,
    evidence: row.evidence,
    status: row.status,
    resultingCandidateId: row.resultingCandidateId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A manually-discarded `prospect_candidates` row, normalized to the same shape. */
function candidateToItem(candidate: {
  id: string;
  batch_id: string;
  batch: { name: string; source: string; created_at: string } | null;
  name: string;
  domain: string | null;
  country_code: string | null;
  industry: string | null;
  source_primary: string | null;
  review_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}): DiscardedProspectItem {
  return {
    itemId: `candidate:${candidate.id}`,
    itemSource: 'candidate',
    sourceId: candidate.id,
    batchId: candidate.batch_id,
    batchName: candidate.batch?.name ?? null,
    candidateId: candidate.id,
    name: candidate.name,
    domain: candidate.domain,
    countryCode: candidate.country_code,
    industry: candidate.industry,
    sourcePrimary: candidate.source_primary,
    roundOrigin: null,
    disposition: 'manual_discard',
    reasonCode: null,
    reasonDetail: candidate.review_notes,
    evidence: {},
    status: 'discarded',
    resultingCandidateId: null,
    createdAt: candidate.created_at,
    updatedAt: candidate.updated_at,
  };
}

/**
 * Scoped list of discarded items for the "Descartadas" tab. Merges both
 * sources, sorts by most-recent first, and applies limit/offset over the
 * merged set. Commercial scope is enforced by `resolveAllowedBatchIds` (this
 * function) and by `getGlobalCandidatesList` (the candidate source) — never
 * by a client-supplied filter.
 */
export async function getDiscardedProspectsList(
  filters: DiscardedProspectsListFilters = {},
): Promise<DiscardedProspectsListResult> {
  await requireActiveUser();

  const allowedBatchIds = await resolveAllowedBatchIds();
  if (allowedBatchIds !== null && allowedBatchIds.length === 0) {
    return { items: [], total: 0 };
  }

  const supabase = await createClient();

  // ── Source A: pipeline auto-rejects (prospect_discarded_dispositions) ──
  let dispositionQuery = supabase
    .from('prospect_discarded_dispositions')
    .select(
      `*, batch:prospect_batches!prospect_discarded_dispositions_batch_id_fkey(name)`,
    )
    .eq('status', 'discarded');

  if (filters.batchId) {
    if (allowedBatchIds !== null && !allowedBatchIds.includes(filters.batchId)) {
      dispositionQuery = dispositionQuery.eq('batch_id', '00000000-0000-0000-0000-000000000000');
    } else {
      dispositionQuery = dispositionQuery.eq('batch_id', filters.batchId);
    }
  } else if (allowedBatchIds !== null) {
    dispositionQuery = dispositionQuery.in('batch_id', allowedBatchIds);
  }
  if (filters.search) {
    dispositionQuery = dispositionQuery.ilike('name', `%${filters.search.trim()}%`);
  }
  if (filters.country) {
    const clean = filters.country.trim();
    dispositionQuery =
      clean.length === 2
        ? dispositionQuery.eq('country_code', clean.toUpperCase())
        : dispositionQuery.ilike('country_code', `%${clean}%`);
  }
  if (filters.industry) {
    dispositionQuery = dispositionQuery.eq('industry', filters.industry);
  }
  if (filters.disposition) {
    dispositionQuery = dispositionQuery.eq('disposition', filters.disposition);
  }

  const limit = filters.limit ?? 2000;
  dispositionQuery = dispositionQuery.order('created_at', { ascending: false }).limit(limit);

  const { data: dispositionRows, error: dispositionError } = await dispositionQuery;
  if (dispositionError) {
    throw new Error(`Error al consultar disposiciones descartadas: ${dispositionError.message}`);
  }

  const dispositionItems = (dispositionRows ?? []).map((raw) => {
    const batch = raw.batch as { name: string } | null;
    return dispositionToItem(toDispositionRow(raw as Record<string, unknown>), batch?.name ?? null);
  });

  // ── Source B: manual discards already in prospect_candidates ───────────
  // 'manual_discard' filter means "show only Source B"; any other named
  // disposition filter means "show only Source A" (manual discards never
  // carry a pipeline disposition code).
  let candidateItems: DiscardedProspectItem[] = [];
  if (!filters.disposition || filters.disposition === 'manual_discard') {
    const { candidates } = await getGlobalCandidatesList({
      search: filters.search,
      country: filters.country,
      industry: filters.industry,
      batchId: filters.batchId,
      ownerUserIds: filters.ownerUserIds,
      statuses: ['discarded'],
      limit,
      offset: 0,
    });
    candidateItems = candidates.map((c) =>
      candidateToItem(
        c as unknown as Parameters<typeof candidateToItem>[0],
      ),
    );
  }

  const merged = [...dispositionItems, ...candidateItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const offset = filters.offset ?? 0;
  const page = merged.slice(offset, offset + limit);

  return { items: page, total: merged.length };
}

/**
 * Detail lookup for one item, addressed by its composite `itemId`
 * (`disposition:<id>` or `candidate:<id>`). Applies the same scope guard as
 * the list: an item outside the viewer's allowed batches returns null, same
 * contract as `getProspectBatchById`.
 */
export async function getDiscardedProspectDetail(
  itemId: string,
): Promise<DiscardedProspectItem | null> {
  await requireActiveUser();

  const [source, id] = itemId.split(':', 2) as [DiscardedProspectItemSource | undefined, string | undefined];
  if (!id || (source !== 'disposition' && source !== 'candidate')) return null;

  const allowedBatchIds = await resolveAllowedBatchIds();
  if (allowedBatchIds !== null && allowedBatchIds.length === 0) return null;

  const supabase = await createClient();

  if (source === 'disposition') {
    const { data, error } = await supabase
      .from('prospect_discarded_dispositions')
      .select(`*, batch:prospect_batches!prospect_discarded_dispositions_batch_id_fkey(name)`)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    if (allowedBatchIds !== null && !allowedBatchIds.includes(data.batch_id as string)) {
      return null;
    }
    const batch = data.batch as { name: string } | null;
    return dispositionToItem(toDispositionRow(data as Record<string, unknown>), batch?.name ?? null);
  }

  // source === 'candidate'
  const { data, error } = await supabase
    .from('prospect_candidates')
    .select(`*, batch:prospect_batches!prospect_candidates_batch_id_fkey(name, source, created_at)`)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  if (allowedBatchIds !== null && !allowedBatchIds.includes(data.batch_id as string)) {
    return null;
  }
  if (data.status !== 'discarded') return null;
  return candidateToItem(data as unknown as Parameters<typeof candidateToItem>[0]);
}
