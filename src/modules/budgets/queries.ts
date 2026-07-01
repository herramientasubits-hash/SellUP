// ============================================================
// budgets — DB query helpers (read-only, service_role)
// ============================================================
// No 'use server' directive here — these are internal helpers called
// from server-only code (budget-resolution.ts). They never ship to
// the browser bundle.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { BudgetRule } from '@/modules/usage-tracking/types';
import type { OrgGroupLike } from '@/modules/access/group-tree';
import type { UserBudgetContext, PeriodConsumption } from './types';

// ─── Client ───────────────────────────────────────────────────────────────────

export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

type AdminClient = ReturnType<typeof getAdminClient>;

// ─── Rules ────────────────────────────────────────────────────────────────────

/**
 * Returns all active budget_rules for a given provider, ordered by specificity:
 *   user → group → role → global
 * The caller picks the first match for the user's context.
 */
export async function getActiveRulesForProvider(
  admin: AdminClient,
  providerKey: string,
): Promise<BudgetRule[]> {
  const { data, error } = await admin
    .from('budget_rules')
    .select('*')
    .eq('provider_key', providerKey)
    .eq('is_active', true);

  if (error || !data) return [];

  const SCOPE_ORDER: Record<string, number> = { user: 0, group: 1, role: 2, global: 3 };
  return (data as BudgetRule[]).sort(
    (a, b) => (SCOPE_ORDER[a.scope_type] ?? 99) - (SCOPE_ORDER[b.scope_type] ?? 99),
  );
}

/**
 * Returns all active budget_rules for all providers (admin summary use-case).
 * Ordered by provider_key, then by specificity.
 */
export async function getAllActiveRules(admin: AdminClient): Promise<BudgetRule[]> {
  const { data, error } = await admin
    .from('budget_rules')
    .select('*')
    .eq('is_active', true);

  if (error || !data) return [];
  return data as BudgetRule[];
}

// ─── User context ─────────────────────────────────────────────────────────────

/**
 * Resolves the current role_key and group_id for a user from internal_users.
 * Returns nulls when the user doesn't exist or the lookup fails.
 */
export async function getUserBudgetContext(
  admin: AdminClient,
  userId: string,
): Promise<UserBudgetContext> {
  const empty: UserBudgetContext = { userId, roleKey: null, groupId: null };

  try {
    const { data: user, error } = await admin
      .from('internal_users')
      .select('role_id, group_id')
      .eq('id', userId)
      .maybeSingle();

    if (error || !user) return empty;

    const groupId = typeof user.group_id === 'string' ? user.group_id : null;

    if (!user.role_id) return { userId, roleKey: null, groupId };

    const { data: role, error: roleError } = await admin
      .from('roles')
      .select('key')
      .eq('id', user.role_id)
      .maybeSingle();

    const roleKey = !roleError && role && typeof role.key === 'string' ? role.key : null;

    return { userId, roleKey, groupId };
  } catch {
    return empty;
  }
}

// ─── Group hierarchy ─────────────────────────────────────────────────────────

/**
 * Fetches all organization_groups rows (id, name, parent_group_id).
 * Used by budget resolution to build ancestor chains and descendant sets.
 */
export async function getAllOrgGroups(admin: AdminClient): Promise<OrgGroupLike[]> {
  const { data } = await admin
    .from('organization_groups')
    .select('id, name, parent_group_id');
  return (data ?? []) as OrgGroupLike[];
}

/**
 * Pure helper. Returns the ancestor chain of a group ordered closest-first:
 *   [groupId, parentId, grandparentId, ...]
 * Includes groupId itself. Guards against cycles via a visited set.
 */
export function buildGroupAncestorChain(
  groupId: string,
  allGroups: OrgGroupLike[],
): string[] {
  const byId = new Map(allGroups.map((g) => [g.id, g]));
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | null = groupId;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = byId.get(current)?.parent_group_id ?? null;
  }
  return chain;
}

// ─── Consumption ──────────────────────────────────────────────────────────────

/**
 * Aggregates credits_used and estimated_cost_usd from provider_usage_logs
 * for a specific user and provider within a period (periodStart inclusive,
 * periodEnd exclusive).
 */
export async function getConsumptionForUser(
  admin: AdminClient,
  providerKey: string,
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodConsumption> {
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select('credits_used, estimated_cost_usd')
    .eq('provider_key', providerKey)
    .eq('triggered_by', userId)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error || !data) return { credits: 0, usd: 0 };

  const credits = data.reduce((s, r) => s + Number(r.credits_used ?? 0), 0);
  const usd = data.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
  return { credits, usd };
}

/**
 * Aggregates credits_used and estimated_cost_usd for a set of group IDs.
 * Used for the group rule check — the pool covers the matched group and all
 * its descendants. Logs created before triggered_by_group_id was populated
 * (Hito A or earlier) will have null there and will NOT be counted; this is
 * expected and documented: only logs with a group snapshot count toward group
 * budgets. Historical logs without snapshot still count for user and global rules.
 */
export async function getConsumptionForGroups(
  admin: AdminClient,
  providerKey: string,
  groupIds: string[],
  periodStart: string,
  periodEnd: string,
): Promise<PeriodConsumption> {
  if (groupIds.length === 0) return { credits: 0, usd: 0 };

  const { data, error } = await admin
    .from('provider_usage_logs')
    .select('credits_used, estimated_cost_usd')
    .eq('provider_key', providerKey)
    .in('triggered_by_group_id', groupIds)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error || !data) return { credits: 0, usd: 0 };

  const credits = data.reduce((s, r) => s + Number(r.credits_used ?? 0), 0);
  const usd = data.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
  return { credits, usd };
}

/**
 * Aggregates credits_used and estimated_cost_usd for all users with a given role.
 * Used for the role rule check — the pool is shared across the entire role.
 * Logs created before triggered_by_role_key was populated will have null and
 * will NOT be counted; same historical caveat as group logs above.
 */
export async function getConsumptionForRole(
  admin: AdminClient,
  providerKey: string,
  roleKey: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodConsumption> {
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select('credits_used, estimated_cost_usd')
    .eq('provider_key', providerKey)
    .eq('triggered_by_role_key', roleKey)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error || !data) return { credits: 0, usd: 0 };

  const credits = data.reduce((s, r) => s + Number(r.credits_used ?? 0), 0);
  const usd = data.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
  return { credits, usd };
}

/**
 * Aggregates credits_used and estimated_cost_usd for a whole provider
 * (all users) within a period. Used for the global rule check.
 */
export async function getConsumptionGlobal(
  admin: AdminClient,
  providerKey: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodConsumption> {
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select('credits_used, estimated_cost_usd')
    .eq('provider_key', providerKey)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error || !data) return { credits: 0, usd: 0 };

  const credits = data.reduce((s, r) => s + Number(r.credits_used ?? 0), 0);
  const usd = data.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
  return { credits, usd };
}

/**
 * Aggregates consumption per provider for the admin summary.
 * Returns a map keyed by provider_key.
 */
export async function getConsumptionByProvider(
  admin: AdminClient,
  periodStart: string,
  periodEnd: string,
): Promise<Map<string, PeriodConsumption>> {
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select('provider_key, credits_used, estimated_cost_usd')
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  const result = new Map<string, PeriodConsumption>();
  if (error || !data) return result;

  for (const row of data) {
    const key = row.provider_key as string;
    const prev = result.get(key) ?? { credits: 0, usd: 0 };
    result.set(key, {
      credits: prev.credits + Number(row.credits_used ?? 0),
      usd: prev.usd + Number(row.estimated_cost_usd ?? 0),
    });
  }
  return result;
}

/**
 * Returns active tool_catalog entries for display name resolution (name map only).
 */
export async function getToolCatalog(
  admin: AdminClient,
): Promise<Map<string, string>> {
  const { data } = await admin
    .from('tool_catalog')
    .select('provider_key, display_name')
    .eq('is_active', true);

  return new Map(
    (data ?? []).map((r) => [r.provider_key as string, r.display_name as string]),
  );
}

/**
 * Returns all active tool_catalog entries as a list.
 * Includes provider-level monthly allowances added in Hito J.
 * Used by getAdminBudgetSummary() as the canonical provider base.
 */
export async function getActiveCatalogEntries(
  admin: AdminClient,
): Promise<Array<{
  providerKey: string;
  displayName: string;
  monthlyCreditsAllowance: number | null;
  monthlyUsdAllowance: number | null;
  quotaSource: string | null;
  quotaSyncedAt: string | null;
  quotaSyncError: string | null;
  quotaOverrideManual: boolean;
  creditsRemainingExternal: number | null;
}>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('tool_catalog')
    .select('provider_key, display_name, monthly_credits_allowance, monthly_usd_allowance, quota_source, quota_synced_at, quota_sync_error, quota_override_manual, credits_remaining_external')
    .eq('is_active', true)
    .order('provider_key');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    providerKey: r.provider_key as string,
    displayName: r.display_name as string,
    monthlyCreditsAllowance: r.monthly_credits_allowance != null ? Number(r.monthly_credits_allowance) : null,
    monthlyUsdAllowance: r.monthly_usd_allowance != null ? Number(r.monthly_usd_allowance) : null,
    quotaSource: (r.quota_source as string | null) ?? null,
    quotaSyncedAt: (r.quota_synced_at as string | null) ?? null,
    quotaSyncError: (r.quota_sync_error as string | null) ?? null,
    quotaOverrideManual: (r.quota_override_manual as boolean | null) ?? false,
    creditsRemainingExternal: r.credits_remaining_external != null ? Number(r.credits_remaining_external) : null,
  }));
}

// ─── Connection status (Hito I) ───────────────────────────────────────────────

/**
 * Returns a set of provider keys that are currently connected.
 * Sources: ai_providers, prospecting_provider_connections, external_integration_connections.
 * Read-only. Never exposes credentials.
 */
export async function getProviderConnectionStatuses(
  admin: AdminClient,
): Promise<Set<string>> {
  const [aiResult, prospResult, extResult] = await Promise.all([
    // LLM providers: anthropic, openai, gemini
    admin
      .from('ai_providers')
      .select('key, connection_status')
      .eq('connection_status', 'connected'),
    // Prospecting/enrichment providers: apollo, lusha
    admin
      .from('prospecting_provider_connections')
      .select('connection_status, prospecting_providers(provider_key)')
      .eq('connection_status', 'connected'),
    // External integrations: tavily, samu_ia, hubspot
    admin
      .from('external_integration_connections')
      .select('connection_status, external_integrations(integration_key)')
      .eq('connection_status', 'connected'),
  ]);

  const connected = new Set<string>();

  for (const row of aiResult.data ?? []) {
    const key = row.key as string | null;
    if (key) connected.add(key);
  }

  for (const row of prospResult.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const key = (row as any).prospecting_providers?.provider_key as string | undefined;
    if (key) connected.add(key);
  }

  for (const row of extResult.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const key = (row as any).external_integrations?.integration_key as string | undefined;
    if (key) connected.add(key);
  }

  return connected;
}

/**
 * Returns the set of provider keys that have at least one usage log
 * with credits_used > 0 or estimated_cost_usd > 0, indicating SellUp
 * actively tracks consumption for that provider. Read-only.
 */
export async function getProvidersWithTrackedConsumption(
  admin: AdminClient,
): Promise<Set<string>> {
  const { data } = await admin
    .from('provider_usage_logs')
    .select('provider_key')
    .or('credits_used.gt.0,estimated_cost_usd.gt.0')
    .limit(500);

  return new Set((data ?? []).map((r) => r.provider_key as string));
}
