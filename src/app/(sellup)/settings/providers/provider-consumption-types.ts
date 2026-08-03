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
  /** Known-credit subtotal only — see unknownCreditOperations before treating this as a complete total. */
  totalCredits: number;
  /** Operations whose credit consumption is indeterminate (NULL credits / billing_state unknown). */
  unknownCreditOperations: number;
  /** Convenience mirror of unknownCreditOperations > 0. */
  hasUnknownCredits: boolean;
  totalCostUsd: number;
  /** True when at least one aggregated row has estimated_cost_usd = NULL (unknown cost). */
  hasUnknownCost: boolean;
  creditsPercentage: number;
}

/** One row of the "Consumo por usuario" breakdown (Q3F-9). */
export interface ProviderUserConsumptionBreakdownRow {
  userId: string | null;
  fullName: string | null;
  email: string | null;
  totalCalls: number;
  /** Known-credit subtotal only — see unknownCreditOperations before treating this as a complete total. */
  totalCredits: number;
  /** Operations whose credit consumption is indeterminate. */
  unknownCreditOperations: number;
  /** Convenience mirror of unknownCreditOperations > 0. */
  hasUnknownCredits: boolean;
  totalCostUsd: number;
  hasUnknownCost: boolean;
  lastActivityAt: string | null;
}

export interface ProviderConsumptionSnapshot {
  /** Known-credit subtotal only — see unknownCreditOperations before treating this as a complete total. */
  totalCredits: number | null;
  /** Operations whose credit consumption is indeterminate. */
  unknownCreditOperations: number;
  /** Convenience mirror of unknownCreditOperations > 0. */
  hasUnknownCredits: boolean;
  totalCostUsd: number;
  /** True when at least one aggregated row has estimated_cost_usd = NULL (unknown cost). */
  hasUnknownCost: boolean;
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  recentLogs: ProviderConsumptionLogEntry[];
  operationBreakdown: ProviderOperationBreakdownRow[];
  userConsumption: ProviderUserConsumptionBreakdownRow[];
  filterOptions: FilterOptions | null;
}

export type ConsumptionErrorStage =
  | 'provider_stats'
  | 'operation_stats'
  | 'recent_logs'
  | 'user_consumption'
  | 'filter_options'
  | 'mapping';

export type ConsumptionLoadResult =
  | { ok: true; snapshot: ProviderConsumptionSnapshot }
  | { ok: false; errorStage: ConsumptionErrorStage; errorCode: string | null };
