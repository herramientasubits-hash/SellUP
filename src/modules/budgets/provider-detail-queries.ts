// ============================================================
// budgets — provider detail query helper (Hito Q3A)
// ============================================================
// Read-only. No writes. No schema changes.
//
// Tradeoff (Q3A): reuses getAdminBudgetSummary() which fetches all
// providers. Filter for the single requested one. Accepted for Q3A
// because it avoids duplicating the complex assembly logic. For Q3B+,
// replace with a targeted single-provider query if performance matters.
// ============================================================

import { getAdminBudgetSummary } from './budget-resolution';
import { getAdminClient } from './queries';
import { getBudgetRulesForProvider, getBudgetRuleFormOptions } from './rule-queries';
import type { AdminProviderBudgetRow } from './types';
import type { BudgetRuleRow, BudgetRuleFormOptions } from './rule-queries';

// ─── Recent usage log row ─────────────────────────────────────────────────────

export interface ProviderUsageLogRow {
  id: string;
  operationKey: string | null;
  creditsUsed: number | null;
  estimatedCostUsd: number | null;
  status: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

// ─── Recent sync log row ──────────────────────────────────────────────────────

export interface ProviderSyncLogRow {
  id: string;
  providerKey: string;
  syncStatus: string | null;
  source: string | null;
  httpStatus: number | null;
  creditsRemainingExternal: number | null;
  usdCostMtd: number | null;
  errorMessage: string | null;
  syncedAt: string;
}

// ─── Provider detail result ───────────────────────────────────────────────────

export type { BudgetRuleRow, BudgetRuleFormOptions };

export interface ProviderDetailResult {
  row: AdminProviderBudgetRow;
  allRulesForProvider: BudgetRuleRow[];
  formOptions: BudgetRuleFormOptions;
  recentUsageLogs: ProviderUsageLogRow[];
  recentSyncLogs: ProviderSyncLogRow[];
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Returns full detail for a single provider by key.
 * Returns null if the provider is not found in the active tool_catalog.
 *
 * Read-only. Never mutates DB state.
 */
export async function getProviderDetail(
  providerKey: string,
): Promise<ProviderDetailResult | null> {
  const normalizedKey = providerKey.toLowerCase();

  const [summary, allRules, options, usageResult, syncResult] = await Promise.all([
    getAdminBudgetSummary(),
    getBudgetRulesForProvider(normalizedKey),
    getBudgetRuleFormOptions(),
    getRecentUsageLogs(normalizedKey, 20),
    getRecentSyncLogs(normalizedKey, 10),
  ]);

  const row = summary.providers.find((p) => p.providerKey === normalizedKey);
  if (!row) return null;

  return {
    row,
    allRulesForProvider: allRules,
    formOptions: options,
    recentUsageLogs: usageResult,
    recentSyncLogs: syncResult,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getRecentUsageLogs(
  providerKey: string,
  limit: number,
): Promise<ProviderUsageLogRow[]> {
  try {
    const admin = getAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from('provider_usage_logs')
      .select('id, operation_key, credits_used, estimated_cost_usd, status, triggered_by, created_at')
      .eq('provider_key', providerKey)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r) => ({
      id: r.id as string,
      operationKey: (r.operation_key as string | null) ?? null,
      creditsUsed: r.credits_used != null ? Number(r.credits_used) : null,
      estimatedCostUsd: r.estimated_cost_usd != null ? Number(r.estimated_cost_usd) : null,
      status: (r.status as string | null) ?? null,
      triggeredBy: (r.triggered_by as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  } catch {
    return [];
  }
}

async function getRecentSyncLogs(
  providerKey: string,
  limit: number,
): Promise<ProviderSyncLogRow[]> {
  try {
    const admin = getAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from('tool_quota_sync_logs')
      .select('id, provider_key, sync_status, source, http_status, credits_remaining_external, usd_cost_mtd, error_message, synced_at')
      .eq('provider_key', providerKey)
      .order('synced_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r) => ({
      id: r.id as string,
      providerKey: r.provider_key as string,
      syncStatus: (r.sync_status as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      httpStatus: r.http_status != null ? Number(r.http_status) : null,
      creditsRemainingExternal: r.credits_remaining_external != null ? Number(r.credits_remaining_external) : null,
      usdCostMtd: r.usd_cost_mtd != null ? Number(r.usd_cost_mtd) : null,
      errorMessage: (r.error_message as string | null) ?? null,
      syncedAt: r.synced_at as string,
    }));
  } catch {
    return [];
  }
}
