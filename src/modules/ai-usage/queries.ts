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
// Filter types
// ============================================================

export interface UsageFilters {
  period?: '7d' | '30d' | 'current_month' | 'all';
  provider?: string;
  agent?: string;
  status?: string;
  user?: string;
}

function periodStart(period: UsageFilters['period']): string | null {
  const now = new Date();
  if (period === '7d') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (period === '30d') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (period === 'current_month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  return null;
}

// ============================================================
// getDistinctFilterOptions
// Returns unique values for all filter dropdowns.
// ============================================================

export interface FilterOptions {
  providers: string[];
  agents: { key: string; name: string | null }[];
  statuses: string[];
  hasTriggeredBy: boolean;
  users: { id: string; full_name: string | null; email: string | null }[];
}

export async function getDistinctFilterOptions(): Promise<FilterOptions | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();

  const [logsResult, runsResult] = await Promise.all([
    admin
      .from('provider_usage_logs')
      .select('provider_key, status, triggered_by'),
    admin
      .from('agent_runs')
      .select('agent_key, agent_name, triggered_by, status'),
  ]);

  const logs = logsResult.data ?? [];
  const runs = runsResult.data ?? [];

  const providers = [...new Set(logs.map((l) => l.provider_key))].sort();
  const statuses = [
    ...new Set([
      ...logs.map((l) => l.status),
      ...runs.map((r) => r.status as string),
    ]),
  ].sort();

  const agentMap = new Map<string, string | null>();
  for (const r of runs) {
    if (!agentMap.has(r.agent_key)) agentMap.set(r.agent_key, r.agent_name ?? null);
  }
  const agents = [...agentMap.entries()].map(([key, name]) => ({ key, name })).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  const hasTriggeredBy =
    runs.some((r) => r.triggered_by != null) ||
    logs.some((l) => l.triggered_by != null);

  const userIds = [
    ...new Set([
      ...runs.filter((r) => r.triggered_by != null).map((r) => r.triggered_by as string),
      ...logs.filter((l) => l.triggered_by != null).map((l) => l.triggered_by as string),
    ]),
  ];

  let users: { id: string; full_name: string | null; email: string | null }[] = [];
  if (userIds.length > 0) {
    const { data: usersData } = await admin
      .from('internal_users')
      .select('id, full_name, email')
      .in('id', userIds);
    users = (usersData ?? []).map((u) => ({
      id: u.id as string,
      full_name: u.full_name as string | null,
      email: u.email as string | null,
    }));
  }

  return { providers, agents, statuses, hasTriggeredBy, users };
}

// ============================================================
// getAiUsageSummary — with filters
// ============================================================

export async function getAiUsageSummary(
  filters: UsageFilters = {},
): Promise<AiUsageSummary | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);

  let runsQuery = admin.from('agent_runs').select('status, estimated_cost_usd');
  if (since) runsQuery = runsQuery.gte('created_at', since);
  if (filters.agent) runsQuery = runsQuery.eq('agent_key', filters.agent);
  if (filters.status) runsQuery = runsQuery.eq('status', filters.status);
  if (filters.user) runsQuery = runsQuery.eq('triggered_by', filters.user);

  let logsQuery = admin
    .from('provider_usage_logs')
    .select('status, estimated_cost_usd, provider_key');
  if (since) logsQuery = logsQuery.gte('created_at', since);
  if (filters.provider) logsQuery = logsQuery.eq('provider_key', filters.provider);
  if (filters.status) logsQuery = logsQuery.eq('status', filters.status);
  if (filters.user) logsQuery = logsQuery.eq('triggered_by', filters.user);

  const [runsResult, logsResult] = await Promise.all([runsQuery, logsQuery]);

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
// getAgentStats — with filters
// ============================================================

export async function getAgentStats(
  filters: UsageFilters = {},
): Promise<AgentStat[] | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);

  let query = admin
    .from('agent_runs')
    .select(
      'agent_key, agent_name, status, results_generated, results_approved, estimated_cost_usd, created_at',
    )
    .order('created_at', { ascending: false });

  if (since) query = query.gte('created_at', since);
  if (filters.agent) query = query.eq('agent_key', filters.agent);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.user) query = query.eq('triggered_by', filters.user);

  const { data, error } = await query;
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
// getProviderStats — with filters
// ============================================================

export async function getProviderStats(
  filters: UsageFilters = {},
): Promise<ProviderStat[] | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);

  let query = admin
    .from('provider_usage_logs')
    .select(
      'provider_key, status, credits_used, input_tokens, output_tokens, results_returned, estimated_cost_usd, created_at',
    );

  if (since) query = query.gte('created_at', since);
  if (filters.provider) query = query.eq('provider_key', filters.provider);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.user) query = query.eq('triggered_by', filters.user);

  const { data, error } = await query;
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
// getRecentProviderLogs — with filters
// ============================================================

export async function getRecentProviderLogs(
  limit = 25,
  filters: UsageFilters = {},
): Promise<ProviderUsageLog[] | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);

  let query = admin
    .from('provider_usage_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (since) query = query.gte('created_at', since);
  if (filters.provider) query = query.eq('provider_key', filters.provider);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.user) query = query.eq('triggered_by', filters.user);

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as ProviderUsageLog[];
}

// ============================================================
// getUserConsumption
// Returns per-user aggregate if triggered_by is populated.
// ============================================================

export interface UserConsumptionRow {
  triggered_by: string;
  full_name: string | null;
  email: string | null;
  executions: number;
  provider_calls: number;
  estimated_cost_usd: number;
  last_activity_at: string | null;
}

export async function getUserConsumption(
  filters: UsageFilters = {},
): Promise<UserConsumptionRow[] | null> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);

  let runsQuery = admin
    .from('agent_runs')
    .select('triggered_by, estimated_cost_usd, created_at');
  if (since) runsQuery = runsQuery.gte('created_at', since);
  if (filters.agent) runsQuery = runsQuery.eq('agent_key', filters.agent);
  if (filters.user) runsQuery = runsQuery.eq('triggered_by', filters.user);

  let logsQuery = admin
    .from('provider_usage_logs')
    .select('triggered_by, estimated_cost_usd, created_at');
  if (since) logsQuery = logsQuery.gte('created_at', since);
  if (filters.provider) logsQuery = logsQuery.eq('provider_key', filters.provider);
  if (filters.user) logsQuery = logsQuery.eq('triggered_by', filters.user);

  const [runsResult, logsResult] = await Promise.all([runsQuery, logsQuery]);

  const runs = (runsResult.data ?? []).filter((r) => r.triggered_by != null);
  const logs = (logsResult.data ?? []).filter((l) => l.triggered_by != null);

  if (runs.length === 0 && logs.length === 0) return [];

  // Aggregate by user id
  const byUser = new Map<
    string,
    { executions: number; provider_calls: number; cost: number; last_at: string | null }
  >();

  for (const r of runs) {
    const uid = r.triggered_by!;
    const cur = byUser.get(uid) ?? { executions: 0, provider_calls: 0, cost: 0, last_at: null };
    cur.executions++;
    cur.cost += Number(r.estimated_cost_usd ?? 0);
    if (!cur.last_at || r.created_at > cur.last_at) cur.last_at = r.created_at;
    byUser.set(uid, cur);
  }
  for (const l of logs) {
    const uid = l.triggered_by!;
    const cur = byUser.get(uid) ?? { executions: 0, provider_calls: 0, cost: 0, last_at: null };
    cur.provider_calls++;
    cur.cost += Number(l.estimated_cost_usd ?? 0);
    if (!cur.last_at || l.created_at > cur.last_at) cur.last_at = l.created_at;
    byUser.set(uid, cur);
  }

  if (byUser.size === 0) return [];

  // Fetch user info from internal_users
  const userIds = [...byUser.keys()];
  const { data: usersData } = await admin
    .from('internal_users')
    .select('id, full_name, email')
    .in('id', userIds);

  const usersMap = new Map(
    (usersData ?? []).map((u) => [u.id as string, u as { id: string; full_name: string | null; email: string | null }]),
  );

  return [...byUser.entries()]
    .map(([uid, agg]) => {
      const u = usersMap.get(uid);
      return {
        triggered_by: uid,
        full_name: u?.full_name ?? null,
        email: u?.email ?? null,
        executions: agg.executions,
        provider_calls: agg.provider_calls,
        estimated_cost_usd: agg.cost,
        last_activity_at: agg.last_at,
      };
    })
    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd);
}
