'use server';

import {
  getProviderStats,
  getProviderOperationStats,
  getRecentProviderLogs,
  getProviderUserConsumption,
  getDistinctFilterOptions,
  type UsageFilters,
  type ProviderScopedUsageFilters,
} from '@/modules/ai-usage/queries';
import type {
  ProviderConsumptionLogEntry,
  ProviderConsumptionSnapshot,
  ProviderOperationBreakdownRow,
  ProviderUserConsumptionBreakdownRow,
  ConsumptionLoadResult,
} from './provider-consumption-types';
import { toOperationBreakdownRow, toSnapshotCostFields } from './provider-consumption-mappers';

function classifyConsumptionError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown_server_error';
  const name = error.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout_or_transport';
  if (name === 'AuthError' || name === 'PostgrestError') {
    const msg = error.message ?? '';
    if (msg.includes('JWT') || msg.includes('auth') || msg.includes('permission')) {
      return 'auth_scope_error';
    }
    return 'supabase_query_error';
  }
  if (name === 'SyntaxError' || name === 'TypeError') return 'serialization_error';
  return 'unknown_server_error';
}

export async function loadProviderConsumptionForWorkspace(
  providerKey: string,
  filters: UsageFilters,
): Promise<ConsumptionLoadResult> {
  const providerFilters: ProviderScopedUsageFilters = { ...filters, provider: providerKey };

  let statsResult: Awaited<ReturnType<typeof getProviderStats>>;
  try {
    statsResult = await getProviderStats(providerFilters);
  } catch (error) {
    return { ok: false, errorStage: 'provider_stats', errorCode: classifyConsumptionError(error) };
  }

  let operationStatsResult: Awaited<ReturnType<typeof getProviderOperationStats>>;
  try {
    operationStatsResult = await getProviderOperationStats(providerFilters);
  } catch (error) {
    return { ok: false, errorStage: 'operation_stats', errorCode: classifyConsumptionError(error) };
  }

  let logsResult: Awaited<ReturnType<typeof getRecentProviderLogs>>;
  try {
    logsResult = await getRecentProviderLogs(25, providerFilters);
  } catch (error) {
    return { ok: false, errorStage: 'recent_logs', errorCode: classifyConsumptionError(error) };
  }

  let userConsumptionResult: Awaited<ReturnType<typeof getProviderUserConsumption>>;
  try {
    userConsumptionResult = await getProviderUserConsumption(providerFilters);
  } catch (error) {
    return { ok: false, errorStage: 'user_consumption', errorCode: classifyConsumptionError(error) };
  }

  let optionsResult: Awaited<ReturnType<typeof getDistinctFilterOptions>>;
  try {
    optionsResult = await getDistinctFilterOptions();
  } catch (error) {
    return { ok: false, errorStage: 'filter_options', errorCode: classifyConsumptionError(error) };
  }

  try {
    const stat = (statsResult ?? []).find((s) => s.provider_key === providerKey);
    const providerTotalCredits = stat?.total_credits_used ?? 0;

    const operationBreakdown: ProviderOperationBreakdownRow[] = (operationStatsResult ?? []).map(
      (op) => toOperationBreakdownRow(op, providerTotalCredits),
    );

    const recentLogs: ProviderConsumptionLogEntry[] = (logsResult ?? []).map((l) => ({
      id: l.id,
      operationKey: l.operation_key,
      creditsUsed: l.credits_used,
      estimatedCostUsd: l.estimated_cost_usd,
      status: l.status,
      triggeredBy: l.triggered_by,
      createdAt: l.created_at,
    }));

    const userConsumption: ProviderUserConsumptionBreakdownRow[] = (userConsumptionResult ?? []).map(
      (row) => ({
        userId: row.triggered_by,
        fullName: row.full_name,
        email: row.email,
        totalCalls: row.provider_calls,
        totalCredits: row.total_credits_used,
        totalCostUsd: row.total_estimated_cost_usd,
        hasUnknownCost: row.has_unknown_cost,
        lastActivityAt: row.last_activity_at,
      }),
    );

    const filterOptions = optionsResult
      ? {
          providers: [...optionsResult.providers],
          agents: optionsResult.agents.map((a) => ({ key: a.key, name: a.name })),
          statuses: [...optionsResult.statuses],
          hasTriggeredBy: optionsResult.hasTriggeredBy,
          users: optionsResult.users.map((u) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            role_key: u.role_key,
            group_id: u.group_id,
          })),
          roles: optionsResult.roles.map((r) => ({ key: r.key, label: r.label })),
          groups: optionsResult.groups.map((g) => ({
            id: g.id,
            name: g.name,
            parent_group_id: g.parent_group_id,
            depth: g.depth,
          })),
          usersScopedToActive: optionsResult.usersScopedToActive,
        }
      : null;

    const snapshot: ProviderConsumptionSnapshot = {
      totalCredits: stat?.total_credits_used ?? null,
      ...toSnapshotCostFields(stat),
      totalCalls: stat?.total_calls ?? 0,
      successCalls: stat?.success_calls ?? 0,
      errorCalls: stat?.error_calls ?? 0,
      recentLogs,
      operationBreakdown,
      userConsumption,
      filterOptions,
    };
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, errorStage: 'mapping', errorCode: classifyConsumptionError(error) };
  }
}
