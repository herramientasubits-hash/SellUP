// Q3F-5AX.2 — Agent 1 Effectiveness Read Model (Phase 1).
//
// Single read-only entry point: fetch batch-scoped evidence → aggregate → return
// the summary. No UI, no routing, no provider calls, no writes. Mirrors the
// provider-effectiveness read-model entry-point shape.

import { aggregateAgent1Effectiveness } from './aggregators';
import { fetchAgent1EffectivenessEvidence } from './queries';
import type { Agent1EffectivenessFilters, Agent1EffectivenessSummary } from './types';

export async function getAgent1EffectivenessSummary(
  filters: Agent1EffectivenessFilters = {},
): Promise<Agent1EffectivenessSummary> {
  const evidence = await fetchAgent1EffectivenessEvidence(filters);
  return aggregateAgent1Effectiveness(evidence, filters);
}
