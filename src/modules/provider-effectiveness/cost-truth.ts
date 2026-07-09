// Agente 2A — Provider Effectiveness Read Model (Hito 17B.4X.6C)
//
// Pure operation/run cost-truth classifiers. Apollo and Lusha persist cost
// evidence in genuinely different metadata shapes (Lusha nests under
// metadata.cost.truth_source; Apollo uses flat pricing_source/pricing_basis/
// unit_cost_usd fields) — see §11 of the 17B.4X.6C prompt. No Supabase, no
// pricing lookups, no provider calls.

import type { EffectivenessProviderKey, OperationCostTruth, RunCostTruth } from './types';
import type { ProviderUsageEvidence } from './types';

/**
 * Lusha operation cost truth.
 *
 * Legacy pre-cost-truth rows carry no `metadata.cost` marker at all and
 * persisted a numeric 0 even when credits were spent — that zero must never
 * be read as a valid free cost, so it classifies as ambiguous, not known.
 */
export function classifyLushaOperationCostTruth(
  estimatedCostUsd: number | null,
  truthSource: 'actual' | 'estimated' | 'unknown' | null,
): OperationCostTruth {
  if (estimatedCostUsd == null) return 'unknown';
  if (truthSource === 'unknown') return 'unknown';
  if (truthSource === 'estimated' || truthSource === 'actual') return 'known';
  // No marker present (legacy pre-cost-truth row).
  if (estimatedCostUsd === 0) return 'ambiguous';
  return 'unknown';
}

/**
 * Apollo operation cost truth. Apollo persists pricing evidence as flat
 * fields (pricing_source, pricing_basis, unit_cost_usd) rather than a nested
 * metadata.cost object — do not look for metadata.cost here.
 */
export function classifyApolloOperationCostTruth(
  estimatedCostUsd: number | null,
  creditsUsed: number | null,
  hasPricingEvidence: boolean,
): OperationCostTruth {
  if (estimatedCostUsd == null) return 'unknown';
  if (estimatedCostUsd > 0) {
    return hasPricingEvidence ? 'known' : 'ambiguous';
  }
  const credits = creditsUsed ?? 0;
  if (credits === 0 && hasPricingEvidence) return 'known';
  return 'ambiguous';
}

/** Dispatches to the provider-specific classifier for one usage evidence row. */
export function classifyProviderUsageCostTruth(
  provider: EffectivenessProviderKey,
  usage: ProviderUsageEvidence,
): OperationCostTruth {
  if (provider === 'lusha') {
    return classifyLushaOperationCostTruth(usage.estimatedCostUsd, usage.costMetadata.truthSource);
  }
  return classifyApolloOperationCostTruth(
    usage.estimatedCostUsd,
    usage.creditsUsed,
    usage.costMetadata.hasApolloPricingEvidence,
  );
}

/**
 * Aggregates operation cost truths into one run cost truth.
 *
 * unknown beats ambiguous beats known — a single unknown-cost operation
 * poisons the whole run's cost claim, and a single ambiguous (unproven zero)
 * operation excludes the run from comparable cost KPIs even if every other
 * operation on the run has a clean known cost.
 */
export function deriveRunCostTruth(operationTruths: OperationCostTruth[]): RunCostTruth {
  if (operationTruths.length === 0) return 'unknown';
  if (operationTruths.some((t) => t === 'unknown')) return 'unknown';
  if (operationTruths.some((t) => t === 'ambiguous')) return 'ambiguous';
  return 'known';
}
