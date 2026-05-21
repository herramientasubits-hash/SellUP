'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { UsageSummary, RecentUsageActivity } from './types';

// ============================================================
// Admin client (service_role for reads across RLS)
// ============================================================

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

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

export async function getUsageSummary(): Promise<UsageSummary> {
  await requireAdmin();
  const admin = getAdminClient();

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

  const total_estimated_cost_usd = providerLogs.reduce(
    (acc, l) => acc + (Number(l.estimated_cost_usd) || 0),
    0
  );

  return {
    total_agent_runs,
    running_agent_runs,
    failed_agent_runs,
    total_provider_calls,
    total_estimated_cost_usd,
    error_calls,
  };
}

// ============================================================
// getRecentUsageActivity
// Returns last N rows from the three main activity tables.
// ============================================================

export async function getRecentUsageActivity(limit = 20): Promise<RecentUsageActivity> {
  await requireAdmin();
  const admin = getAdminClient();

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
