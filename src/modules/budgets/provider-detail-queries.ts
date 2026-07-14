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
import {
  resolveUsageLogDisplayContext,
  type ResolvedUserRef,
  type ResolvedAgentRunRef,
  type UsageLogUserDisplay,
  type UsageLogErrorDetail,
} from './provider-usage-log-display';
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
  /** Optional so pre-existing fixtures built before Q3F-13S (e.g. Q3F-11B's makeLog) stay valid. */
  agentRunId?: string | null;
  createdAt: string;
  /** Render-ready — never a raw user UUID (Q3F-13S). Optional for the same reason as agentRunId. */
  userDisplay?: UsageLogUserDisplay;
  /** Render-ready — never a raw agent_run_id (Q3F-13S). Optional for the same reason as agentRunId. */
  agentDisplay?: string;
  /** Persisted error_message/error_code only — null on technically successful rows. Optional for the same reason as agentRunId. */
  errorDetail?: UsageLogErrorDetail | null;
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
      .select(
        'id, operation_key, credits_used, estimated_cost_usd, status, triggered_by, agent_run_id, error_code, error_message, created_at',
      )
      .eq('provider_key', providerKey)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = data as any[];

    // Batch resolution (Q3F-13S) — two follow-up queries total regardless of
    // row count, never one per row. Mirrors getProviderUserConsumption in
    // modules/ai-usage/queries.ts.
    const userIds = [...new Set(rows.map((r) => r.triggered_by as string | null).filter((id): id is string => id != null))];
    const agentRunIds = [...new Set(rows.map((r) => r.agent_run_id as string | null).filter((id): id is string => id != null))];

    const [userMap, agentRunMap] = await Promise.all([
      resolveUserRefs(admin, userIds),
      resolveAgentRunRefs(admin, agentRunIds),
    ]);

    return rows.map((r) => {
      const triggeredBy = (r.triggered_by as string | null) ?? null;
      const agentRunId = (r.agent_run_id as string | null) ?? null;
      const errorMessage = (r.error_message as string | null) ?? null;
      const errorCode = (r.error_code as string | null) ?? null;
      const display = resolveUsageLogDisplayContext({
        triggeredBy,
        resolvedUser: triggeredBy ? userMap.get(triggeredBy) : undefined,
        agentRunId,
        resolvedAgentRun: agentRunId ? agentRunMap.get(agentRunId) : undefined,
        errorMessage,
        errorCode,
      });

      return {
        id: r.id as string,
        operationKey: (r.operation_key as string | null) ?? null,
        creditsUsed: r.credits_used != null ? Number(r.credits_used) : null,
        estimatedCostUsd: r.estimated_cost_usd != null ? Number(r.estimated_cost_usd) : null,
        status: (r.status as string | null) ?? null,
        triggeredBy,
        agentRunId,
        createdAt: r.created_at as string,
        userDisplay: display.user,
        agentDisplay: display.agent,
        errorDetail: display.errorDetail,
      };
    });
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveUserRefs(admin: any, ids: string[]): Promise<Map<string, ResolvedUserRef>> {
  const map = new Map<string, ResolvedUserRef>();
  if (ids.length === 0) return map;
  const { data } = await admin.from('internal_users').select('id, full_name, email').in('id', ids);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const u of (data ?? []) as any[]) {
    map.set(u.id as string, {
      fullName: (u.full_name as string | null) ?? null,
      email: (u.email as string | null) ?? null,
    });
  }
  return map;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveAgentRunRefs(admin: any, ids: string[]): Promise<Map<string, ResolvedAgentRunRef>> {
  const map = new Map<string, ResolvedAgentRunRef>();
  if (ids.length === 0) return map;
  const { data } = await admin.from('agent_runs').select('id, agent_key, agent_name').in('id', ids);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of (data ?? []) as any[]) {
    map.set(a.id as string, {
      agentKey: (a.agent_key as string | null) ?? null,
      agentName: (a.agent_name as string | null) ?? null,
    });
  }
  return map;
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
