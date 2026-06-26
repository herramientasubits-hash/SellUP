'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import type {
  AgentStat,
  ProviderStat,
  AiUsageSummary,
  ProviderUsageLog,
} from '@/modules/usage-tracking/types';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ============================================================
// getAiUsageSummary
// Aggregated totals for the summary card row.
// Returns null if caller is not admin.
// ============================================================

export async function getAiUsageSummary(): Promise<AiUsageSummary | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();

  const [runsResult, logsResult] = await Promise.all([
    admin.from('agent_runs').select('status, estimated_cost_usd'),
    admin.from('provider_usage_logs').select('status, estimated_cost_usd, provider_key'),
  ]);

  const runs = runsResult.data ?? [];
  const logs = logsResult.data ?? [];

  const total_executions = runs.length;
  const running_executions = runs.filter((r) => r.status === 'running').length;
  const failed_executions = runs.filter((r) => r.status === 'failed').length;
  const total_provider_calls = logs.length;
  const error_provider_calls = logs.filter(
    (l) => l.status === 'error' || l.status === 'rate_limited' || l.status === 'quota_exceeded',
  ).length;
  const total_estimated_cost_usd = logs.reduce(
    (s, l) => s + Number(l.estimated_cost_usd ?? 0),
    0,
  );
  const distinct_providers = new Set(logs.map((l) => l.provider_key)).size;
  const avg_cost_per_run =
    total_executions > 0 ? total_estimated_cost_usd / total_executions : null;

  return {
    total_executions,
    running_executions,
    failed_executions,
    total_provider_calls,
    error_provider_calls,
    total_estimated_cost_usd,
    distinct_providers,
    avg_cost_per_run,
  };
}

// ============================================================
// getAgentStats
// One row per agent_key, aggregated from agent_runs.
// Returns null if not admin, empty array if no runs.
// ============================================================

export async function getAgentStats(): Promise<AgentStat[] | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();

  const { data, error } = await admin
    .from('agent_runs')
    .select(
      'agent_key, agent_name, status, results_generated, results_approved, estimated_cost_usd, created_at',
    )
    .order('created_at', { ascending: false });

  if (error) return [];

  const map = new Map<string, AgentStat>();

  for (const row of data ?? []) {
    const existing: AgentStat = map.get(row.agent_key) ?? {
      agent_key: row.agent_key,
      agent_name: (row.agent_name as string | null) ?? null,
      total_executions: 0,
      completed_executions: 0,
      failed_executions: 0,
      total_results_generated: 0,
      total_results_approved: 0,
      total_estimated_cost_usd: 0,
      last_run_at: null,
    };

    existing.total_executions++;
    if (row.status === 'completed') existing.completed_executions++;
    if (row.status === 'failed') existing.failed_executions++;
    existing.total_results_generated += Number(row.results_generated ?? 0);
    existing.total_results_approved += Number(row.results_approved ?? 0);
    existing.total_estimated_cost_usd += Number(row.estimated_cost_usd ?? 0);

    if (!existing.last_run_at || (row.created_at as string) > existing.last_run_at) {
      existing.last_run_at = row.created_at as string;
    }

    map.set(row.agent_key, existing);
  }

  return Array.from(map.values()).sort(
    (a, b) => b.total_estimated_cost_usd - a.total_estimated_cost_usd,
  );
}

// ============================================================
// getProviderStats
// One row per provider_key, aggregated from provider_usage_logs.
// Tavily: credits_used is set, tokens = 0 (credit-based provider).
// Returns null if not admin, empty array if no logs.
// ============================================================

export async function getProviderStats(): Promise<ProviderStat[] | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();

  const { data, error } = await admin
    .from('provider_usage_logs')
    .select(
      'provider_key, status, credits_used, input_tokens, output_tokens, results_returned, estimated_cost_usd, created_at',
    );

  if (error) return [];

  const map = new Map<string, ProviderStat>();

  for (const row of data ?? []) {
    const existing: ProviderStat = map.get(row.provider_key) ?? {
      provider_key: row.provider_key,
      total_calls: 0,
      success_calls: 0,
      error_calls: 0,
      total_credits_used: null,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_results_returned: 0,
      total_estimated_cost_usd: 0,
      last_used_at: null,
    };

    existing.total_calls++;
    if (row.status === 'success') existing.success_calls++;
    else existing.error_calls++;

    if (row.credits_used != null) {
      existing.total_credits_used =
        (existing.total_credits_used ?? 0) + Number(row.credits_used);
    }
    existing.total_input_tokens += Number(row.input_tokens ?? 0);
    existing.total_output_tokens += Number(row.output_tokens ?? 0);
    existing.total_results_returned += Number(row.results_returned ?? 0);
    existing.total_estimated_cost_usd += Number(row.estimated_cost_usd ?? 0);

    if (!existing.last_used_at || (row.created_at as string) > existing.last_used_at) {
      existing.last_used_at = row.created_at as string;
    }

    map.set(row.provider_key, existing);
  }

  return Array.from(map.values()).sort(
    (a, b) => b.total_estimated_cost_usd - a.total_estimated_cost_usd,
  );
}

// ============================================================
// getRecentProviderLogs
// Last N rows from provider_usage_logs, for the executions table.
// Returns null if not admin, empty array if no logs.
// ============================================================

export async function getRecentProviderLogs(limit = 25): Promise<ProviderUsageLog[] | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();

  const { data, error } = await admin
    .from('provider_usage_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as ProviderUsageLog[];
}
