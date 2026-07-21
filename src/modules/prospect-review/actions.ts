// Q3F-5AZ.2A — Pending Review Queue read-only entry point.
//
// UI-consumption wrapper for the /prospect-batches/review surface. The queue
// reads via the admin (service-role) client, which bypasses RLS, so this
// wrapper HARD-GATES on admin BEFORE touching data — a non-admin never reaches
// the query layer. It never throws: any read failure resolves to a safe
// 'error' status so the page renders a friendly state instead of breaking.
//
// READ-ONLY milestone: this module exposes NO approve/discard/convert/enrich
// action. Those are deferred to a later hito. No writes, no provider calls.

import { isCurrentUserAdmin } from '@/modules/access/actions';
import { fetchPendingReviewEvidence } from './queries';
import {
  buildSummary,
  buildFilterOptions,
  applyFilters,
} from './aggregators';
import type { PendingReviewFilters, PendingReviewResult } from './types';

export type PendingReviewQueueResult =
  | { status: 'ok'; data: PendingReviewResult }
  | { status: 'restricted' }
  | { status: 'error' };

/**
 * Loads the clean-pending review queue for the given filters. KPIs and filter
 * options are computed over the FULL pending set (so the header count stays
 * stable regardless of active filters); only the candidate list is filtered.
 */
export async function getPendingReviewQueue(
  filters: PendingReviewFilters = {},
): Promise<PendingReviewQueueResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return { status: 'restricted' };

  try {
    const evidence = await fetchPendingReviewEvidence();
    const now = new Date();

    const batchesById: Record<string, (typeof evidence.batches)[number]> = {};
    for (const b of evidence.batches) batchesById[b.id] = b;

    const summary = buildSummary(evidence.candidates, now);
    const options = buildFilterOptions(evidence.candidates, batchesById);
    const candidates = applyFilters(evidence.candidates, filters);

    return {
      status: 'ok',
      data: { summary, options, candidates, batchesById, appliedFilters: filters },
    };
  } catch (err) {
    // Detailed context stays server-side; the UI gets a generic, safe state.
    console.error('[prospect-review] queue read failed:', err);
    return { status: 'error' };
  }
}
