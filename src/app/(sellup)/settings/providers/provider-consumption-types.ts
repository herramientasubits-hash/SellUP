import type { FilterOptions, UsageFilters } from '@/modules/ai-usage/queries';

export type { UsageFilters, FilterOptions };

export interface ProviderConsumptionLogEntry {
  id: string;
  operationKey: string;
  creditsUsed: number | null;
  estimatedCostUsd: number | null;
  status: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

/** One row of the "Distribución por operación" breakdown (Q3F-8). */
export interface ProviderOperationBreakdownRow {
  operationKey: string;
  totalCalls: number;
  /** Reserved for future reconciliation use; not rendered in Q3F-8 UI. */
  successCalls: number;
  /** Reserved for future reconciliation use; not rendered in Q3F-8 UI. */
  errorCalls: number;
  totalCredits: number;
  totalCostUsd: number;
  creditsPercentage: number;
}

export interface ProviderConsumptionSnapshot {
  totalCredits: number | null;
  totalCostUsd: number;
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  recentLogs: ProviderConsumptionLogEntry[];
  operationBreakdown: ProviderOperationBreakdownRow[];
  filterOptions: FilterOptions | null;
}

export type ConsumptionErrorStage =
  | 'provider_stats'
  | 'operation_stats'
  | 'recent_logs'
  | 'filter_options'
  | 'mapping';

export type ConsumptionLoadResult =
  | { ok: true; snapshot: ProviderConsumptionSnapshot }
  | { ok: false; errorStage: ConsumptionErrorStage; errorCode: string | null };
