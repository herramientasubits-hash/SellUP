// Agente 2A — Provider Effectiveness Read Model (Hito 17B.4X.6C)
//
// Single read-only entry point: query evidence → aggregate → return the V1
// read model. No UI, no routing, no provider calls, no writes.

import { aggregateProviderEffectiveness } from './aggregators';
import { fetchContactEnrichmentRunEvidence } from './queries';
import type { ProviderEffectivenessFilters, ProviderEffectivenessReadModel } from './types';

export async function getProviderEffectivenessReadModel(
  filters: ProviderEffectivenessFilters = {},
): Promise<ProviderEffectivenessReadModel> {
  const runs = await fetchContactEnrichmentRunEvidence({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  return aggregateProviderEffectiveness(runs, { provider: filters.provider });
}
