// ============================================================
// budgets — domain types for budget resolution (Hito B)
// ============================================================

import type { BudgetOnExceed, BudgetPeriodType, BudgetRule } from '@/modules/usage-tracking/types';

export type { BudgetOnExceed, BudgetPeriodType };

// 'none' = no rule applies; extends the DB enum with the resolution outcome
export type BudgetScopeApplied = 'user' | 'group' | 'role' | 'global' | 'none';

export interface PeriodBounds {
  start: Date;
  end: Date;
}

// ─── Core resolution result ───────────────────────────────────────────────────

export interface MatchedRule {
  id: string;
  providerKey: string;
  scopeType: Exclude<BudgetScopeApplied, 'none'>;
  scopeId: string | null;
  limitCredits: number | null;
  limitUsd: number | null;
  periodType: BudgetPeriodType;
  onExceed: BudgetOnExceed;
}

export interface BudgetCheckResult {
  /** Whether the operation is allowed under the active rule (or no rule). */
  allowed: boolean;
  /** Human-readable explanation when not allowed. */
  reason: string | null;
  providerKey: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  /** Which scope level matched. 'none' = no active rule found. */
  scopeApplied: BudgetScopeApplied;
  /** The rule that was matched, or null when scopeApplied is 'none'. */
  matchedRule: MatchedRule | null;
  /** Actual consumption recorded in provider_usage_logs this period. */
  consumedCredits: number;
  consumedUsd: number;
  /** Projected totals including the operation being checked (consumedX + projectedX). */
  projectedCredits: number;
  projectedUsd: number;
  /** Remaining capacity. null when the matched rule has no limit for that unit. */
  remainingCredits: number | null;
  remainingUsd: number | null;
}

// ─── Admin summary ─────────────────────────────────────────────────────────────

// Forward-declared to avoid circular import; actual types live in budget-check-parser/activity.
export interface BudgetCheckLogEntry {
  id: string;
  providerKey: string;
  operationKey: string | null;
  creditsUsed: number | null;
  estimatedCostUsd: number | null;
  status: string | null;
  createdAt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  budgetCheck: any | null;
}

export type QuotaSource = 'manual' | 'api_synced' | 'sync_error';

export interface AdminProviderBudgetRow {
  providerKey: string;
  displayName: string | null;
  activeRules: number;
  /** Null when no rule defines a credit limit. */
  globalLimitCredits: number | null;
  globalLimitUsd: number | null;
  consumedCredits: number;
  consumedUsd: number;
  remainingCredits: number | null;
  remainingUsd: number | null;
  /** Period used for the consumption aggregation. */
  periodType: BudgetPeriodType | null;
  periodStart: string | null;
  periodEnd: string | null;
  onExceed: BudgetOnExceed | null;
  /** Latest log entry with a budget_check (null = never evaluated). Hito G. */
  latestBudgetCheckLog: BudgetCheckLogEntry | null;
  /** Up to 10 recent log entries with budget_check, newest first. Hito G. */
  recentBudgetCheckLogs: BudgetCheckLogEntry[];
  /** Derived from ai_providers / prospecting_provider_connections / external_integration_connections. Hito I. */
  isConnected: boolean;
  /** Derived measurement state: active | connected | prepared | not_measured. Hito I. */
  measurementStatus: import('./provider-measurement').MeasurementStatus;
  /** External contracted monthly credits quota (tool_catalog). Hito J. */
  providerMonthlyCreditsAllowance: number | null;
  /** External contracted monthly USD budget (tool_catalog). Hito J. */
  providerMonthlyUsdAllowance: number | null;
  /** credits_available_provider = allowance - consumed (null if allowance null). Hito J. */
  providerCreditsAvailable: number | null;
  /** usd_available_provider = usd_allowance - consumed_usd (null if allowance null). Hito J. */
  providerUsdAvailable: number | null;
  /** Source of the quota data. null = not configured. Hito L1. */
  quotaSource: QuotaSource | null;
  /** Timestamp of last successful API sync. null if never synced. Hito L1. */
  quotaSyncedAt: string | null;
  /** Error message from last failed sync attempt. Hito L1. */
  quotaSyncError: string | null;
  /** true = admin has locked quota; API syncs must not overwrite. Hito L1. */
  quotaOverrideManual: boolean;
  /** Credits remaining as reported by the provider's API. null if never synced. Hito L2. */
  creditsRemainingExternal: number | null;
  /** USD cost month-to-date as reported by the provider's API. null if not available. Hito L2.3. */
  usdCostMtd: number | null;
}

export interface AdminBudgetSummary {
  providers: AdminProviderBudgetRow[];
  resolvedAt: string;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

export interface UserBudgetContext {
  userId: string;
  roleKey: string | null;
  groupId: string | null;
}

export interface PeriodConsumption {
  credits: number;
  /** Known-cost subtotal only — see hasUnknownCost before treating this as a complete total. */
  usd: number;
  /** True when at least one aggregated row has estimated_cost_usd = NULL (unknown cost). */
  hasUnknownCost: boolean;
}

// Re-export BudgetRule for consumers that import from this module
export type { BudgetRule };
