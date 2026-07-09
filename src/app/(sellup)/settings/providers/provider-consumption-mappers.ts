// Pure mappers for provider-consumption-actions.ts. Kept in a plain module
// (no 'use server') because a 'use server' file may only export async
// functions — these need to stay synchronous to be directly unit-testable
// without mocking Supabase (17B.4X.5H).

import type { OperationStat } from '@/modules/ai-usage/queries';
import type { ProviderStat } from '@/modules/usage-tracking/types';
import type { ProviderConsumptionSnapshot, ProviderOperationBreakdownRow } from './provider-consumption-types';

/**
 * Carries has_unknown_cost from the ai-usage OperationStat producer into the
 * presentation DTO so the sidepanel never silently renders an incomplete
 * cost subtotal as complete.
 */
export function toOperationBreakdownRow(
  op: OperationStat,
  providerTotalCredits: number,
): ProviderOperationBreakdownRow {
  const rawPercentage =
    providerTotalCredits > 0 ? (op.total_credits_used / providerTotalCredits) * 100 : 0;
  return {
    operationKey: op.operation_key,
    totalCalls: op.total_calls,
    successCalls: op.success_calls,
    errorCalls: op.error_calls,
    totalCredits: op.total_credits_used,
    totalCostUsd: op.total_estimated_cost_usd,
    hasUnknownCost: op.has_unknown_cost,
    creditsPercentage: Number.isFinite(rawPercentage) ? rawPercentage : 0,
  };
}

/** Carries has_unknown_cost from the ai-usage ProviderStat producer into the snapshot DTO's top-level cost fields. */
export function toSnapshotCostFields(
  stat: ProviderStat | undefined,
): Pick<ProviderConsumptionSnapshot, 'totalCostUsd' | 'hasUnknownCost'> {
  return {
    totalCostUsd: stat?.total_estimated_cost_usd ?? 0,
    hasUnknownCost: stat?.has_unknown_cost ?? false,
  };
}
