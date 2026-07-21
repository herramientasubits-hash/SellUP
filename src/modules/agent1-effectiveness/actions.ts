// Q3F-5AX.2 — Agent 1 Effectiveness Read Model (Phase 1).
//
// Single read-only entry point: fetch batch-scoped evidence → aggregate → return
// the summary. No UI, no routing, no provider calls, no writes. Mirrors the
// provider-effectiveness read-model entry-point shape.

import { isCurrentUserAdmin } from '@/modules/access/actions';
import { aggregateAgent1Effectiveness } from './aggregators';
import { fetchAgent1EffectivenessEvidence } from './queries';
import type { Agent1EffectivenessFilters, Agent1EffectivenessSummary } from './types';

export async function getAgent1EffectivenessSummary(
  filters: Agent1EffectivenessFilters = {},
): Promise<Agent1EffectivenessSummary> {
  const evidence = await fetchAgent1EffectivenessEvidence(filters);
  return aggregateAgent1Effectiveness(evidence, filters);
}

/**
 * Q3F-5AX.4 — UI-consumption wrapper for the /ai-usage surface.
 *
 * The read model reads via the admin (service-role) client, which bypasses RLS,
 * so this wrapper hard-gates on admin BEFORE touching data — a non-admin never
 * reaches the query layer. It also never throws: any read failure resolves to a
 * safe 'error' status so the page can render a friendly state instead of
 * breaking the whole route. No writes, no provider calls, no change to the
 * read-model semantics.
 */
export type Agent1EffectivenessPanelResult =
  | { status: 'ok'; summary: Agent1EffectivenessSummary }
  | { status: 'restricted' }
  | { status: 'error' };

export async function getAgent1EffectivenessPanel(
  filters: Agent1EffectivenessFilters = {},
): Promise<Agent1EffectivenessPanelResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return { status: 'restricted' };

  try {
    const summary = await getAgent1EffectivenessSummary(filters);
    return { status: 'ok', summary };
  } catch (err) {
    // Detailed context stays server-side; the UI gets a generic, safe state.
    console.error('[agent1-effectiveness] panel read failed:', err);
    return { status: 'error' };
  }
}
