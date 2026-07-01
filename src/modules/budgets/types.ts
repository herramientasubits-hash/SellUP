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
  usd: number;
}

// Re-export BudgetRule for consumers that import from this module
export type { BudgetRule };
