// ============================================================
// budgets — admin activity query for budget_check logs (Hito G)
// ============================================================
// Read-only. Pulls provider_usage_logs rows that have a budget_check entry.
// No enforcement, no writes, no side effects.

import { getAdminClient } from './queries';
import { parseBudgetCheck } from './budget-check-parser';
import type { ParsedBudgetCheck } from './budget-check-parser';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetCheckLogEntry {
  id: string;
  providerKey: string;
  operationKey: string | null;
  creditsUsed: number | null;
  estimatedCostUsd: number | null;
  status: string | null;
  createdAt: string;
  budgetCheck: ParsedBudgetCheck | null;
}

export interface ProviderBudgetCheckActivity {
  providerKey: string;
  /** Latest log with a budget_check entry (null = never evaluated) */
  latest: BudgetCheckLogEntry | null;
  /** Up to 10 recent logs with budget_check, newest first */
  recent: BudgetCheckLogEntry[];
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Fetches the most recent provider_usage_logs that have a budget_check entry.
 * Pulls up to 100 rows (last week or so for active providers), groups by
 * provider in memory, and returns up to 10 per provider. Lightweight.
 *
 * The activeProviderKeys list is used to ensure every provider appears in the
 * result even when no evaluations exist yet.
 */
export async function getBudgetCheckActivity(
  activeProviderKeys: string[],
): Promise<Map<string, ProviderBudgetCheckActivity>> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('provider_usage_logs')
    .select('id, provider_key, operation_key, credits_used, estimated_cost_usd, status, created_at, metadata')
    .not('metadata->budget_check', 'is', null)
    .in('provider_key', activeProviderKeys.length > 0 ? activeProviderKeys : ['__none__'])
    .order('created_at', { ascending: false })
    .limit(200);

  const result = new Map<string, ProviderBudgetCheckActivity>();

  // Seed every active provider with an empty entry
  for (const key of activeProviderKeys) {
    result.set(key, { providerKey: key, latest: null, recent: [] });
  }

  if (error || !data) return result;

  for (const row of data) {
    const key = row.provider_key as string;
    const entry = result.get(key);
    if (!entry) continue;
    if (entry.recent.length >= 10) continue;

    const rawCheck = (row.metadata as Record<string, unknown> | null)?.['budget_check'];
    const budgetCheck = parseBudgetCheck(rawCheck);

    const logEntry: BudgetCheckLogEntry = {
      id: row.id as string,
      providerKey: key,
      operationKey: typeof row.operation_key === 'string' ? row.operation_key : null,
      creditsUsed: row.credits_used != null ? Number(row.credits_used) : null,
      estimatedCostUsd: row.estimated_cost_usd != null ? Number(row.estimated_cost_usd) : null,
      status: typeof row.status === 'string' ? row.status : null,
      createdAt: row.created_at as string,
      budgetCheck,
    };

    entry.recent.push(logEntry);
    if (entry.latest === null) {
      entry.latest = logEntry;
    }
  }

  return result;
}
