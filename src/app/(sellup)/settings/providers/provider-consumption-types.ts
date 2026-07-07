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

export interface ProviderConsumptionSnapshot {
  totalCredits: number | null;
  totalCostUsd: number;
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  recentLogs: ProviderConsumptionLogEntry[];
  filterOptions: FilterOptions | null;
}

export type ConsumptionErrorStage =
  | 'provider_stats'
  | 'recent_logs'
  | 'filter_options'
  | 'mapping';

export type ConsumptionLoadResult =
  | { ok: true; snapshot: ProviderConsumptionSnapshot }
  | { ok: false; errorStage: ConsumptionErrorStage; errorCode: string | null };
