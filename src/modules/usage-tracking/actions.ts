import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import type { UsageSummary, RecentUsageActivity } from './types';

// ============================================================
// Admin client (service_role for reads across RLS)
//
// H5.19A — migrated off the inline service-role client helper to the
// fail-closed createSupabaseAdminClient() factory (src/lib/supabase/admin).
// The old inline helper read the Supabase env vars directly and threw a
// generic Error on missing config; the factory now resolves through the
// env-guard (getSupabaseServiceRoleEnv) and throws
// UnsafeSupabaseEnvironmentError when config is missing or a non-production
// environment resolves to the production Supabase project. This module never
// had a hardcoded production fallback; behavior is otherwise unchanged and
// still read-only.
// ============================================================
// Auth guard — admin only
// ============================================================

async function requireAdmin(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/settings');

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') redirect('/settings');
}

// ============================================================
// getUsageSummary
// Returns aggregated counts and cost totals for the summary cards.
// ============================================================

interface CostRow {
  estimated_cost_usd: number | null;
}

/**
 * Pure aggregator (17B.4X.5H) — sums known provider_usage_logs costs while
 * tracking completeness. A NULL estimated_cost_usd means unknown cost: it is
 * excluded from the sum (never coerced to 0 via `Number(null) || 0`) and
 * flagged via has_unknown_cost so total_estimated_cost_usd is never
 * mislabeled as a complete total. Dependency-free so it is directly
 * unit-testable without mocking the Supabase client.
 */
export function aggregateUsageSummaryCost(
  rows: CostRow[],
): { total_estimated_cost_usd: number; has_unknown_cost: boolean } {
  let total_estimated_cost_usd = 0;
  let has_unknown_cost = false;
  for (const row of rows) {
    if (row.estimated_cost_usd == null) {
      has_unknown_cost = true;
    } else {
      total_estimated_cost_usd += Number(row.estimated_cost_usd);
    }
  }
  return { total_estimated_cost_usd, has_unknown_cost };
}

export async function getUsageSummary(): Promise<UsageSummary> {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const [runsResult, providerResult] = await Promise.all([
    admin
      .from('agent_runs')
      .select('status, estimated_cost_usd'),
    admin
      .from('provider_usage_logs')
      .select('status, estimated_cost_usd'),
  ]);

  const runs = runsResult.data ?? [];
  const providerLogs = providerResult.data ?? [];

  const total_agent_runs = runs.length;
  const running_agent_runs = runs.filter((r) => r.status === 'running').length;
  const failed_agent_runs = runs.filter((r) => r.status === 'failed').length;

  const total_provider_calls = providerLogs.length;
  const error_calls = providerLogs.filter(
    (l) => l.status === 'error' || l.status === 'rate_limited' || l.status === 'quota_exceeded'
  ).length;

  const { total_estimated_cost_usd, has_unknown_cost } = aggregateUsageSummaryCost(providerLogs);

  return {
    total_agent_runs,
    running_agent_runs,
    failed_agent_runs,
    total_provider_calls,
    total_estimated_cost_usd,
    has_unknown_cost,
    error_calls,
  };
}

// ============================================================
// getRecentUsageActivity
// Returns last N rows from the three main activity tables.
// ============================================================

export async function getRecentUsageActivity(limit = 20): Promise<RecentUsageActivity> {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const [runsResult, logsResult, qualityResult] = await Promise.all([
    admin
      .from('agent_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('provider_usage_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('result_quality_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  return {
    agent_runs: (runsResult.data ?? []) as RecentUsageActivity['agent_runs'],
    provider_logs: (logsResult.data ?? []) as RecentUsageActivity['provider_logs'],
    quality_events: (qualityResult.data ?? []) as RecentUsageActivity['quality_events'],
  };
}
