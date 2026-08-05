// ============================================================
// budgets — DB query helpers (read-only, service_role)
// ============================================================
// No 'use server' directive here — these are internal helpers called
// from server-only code (budget-resolution.ts). They never ship to
// the browser bundle.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { BudgetRule } from '@/modules/usage-tracking/types';
import type { OrgGroupLike } from '@/modules/access/group-tree';
import type { UserBudgetContext } from './types';
import {
  WATERFALL_USAGE_CORRELATION_KEY,
  type ReservationSnapshotRow,
  type ReservationSnapshotStatus,
  type UsageConsumptionRow,
} from './effective-consumption-core';

// ─── Client ───────────────────────────────────────────────────────────────────

export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

type AdminClient = ReturnType<typeof getAdminClient>;

/** Table holding the atomic credit reservations of the phone reveal waterfall (mig. 104). */
const PHONE_REVEAL_CREDIT_RESERVATIONS_TABLE = 'phone_reveal_credit_reservations';

/** Terminal runs of the phone reveal waterfall (mig. 102), for group → run resolution. */
const PHONE_REVEAL_WATERFALL_RUNS_TABLE = 'phone_reveal_waterfall_runs';

/**
 * Columns the consumption queries read from provider_usage_logs.
 *
 * `metadata` is read in full and NOT narrowed to a JSON path on purpose. The waterfall
 * correlation key can appear on any row written under a reveal authorization, so
 * filtering by `operation_key` would silently stop excluding a future writer's rows and
 * reintroduce the double count this milestone exists to prevent (AGENT2A-PHONE-REVEAL-4N).
 */
const USAGE_CONSUMPTION_SELECT = 'provider_key, credits_used, estimated_cost_usd, metadata';

/**
 * Maps raw provider_usage_logs rows to the vocabulary of the pure accounting core,
 * pulling the waterfall run id out of `metadata` when the row carries one.
 */
function toUsageConsumptionRows(rows: unknown[]): UsageConsumptionRow[] {
  return rows.map((raw) => {
    const row = raw as {
      provider_key?: unknown;
      credits_used?: unknown;
      estimated_cost_usd?: unknown;
      metadata?: unknown;
    };
    const metadata =
      row.metadata !== null && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : null;
    const correlated = metadata?.[WATERFALL_USAGE_CORRELATION_KEY];

    return {
      providerKey: typeof row.provider_key === 'string' ? row.provider_key : '',
      creditsUsed: row.credits_used == null ? null : Number(row.credits_used),
      estimatedCostUsd:
        row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
      waterfallRunId: typeof correlated === 'string' && correlated.length > 0 ? correlated : null,
    };
  });
}

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
//
// These readers return RAW ROWS, not a summed total. Summing moved into the pure core
// (effective-consumption-core.ts) because the budgetary total is no longer a plain
// aggregation over provider_usage_logs: a waterfall leg whose cost the provider never
// reported is represented by its confirmed reservation instead, and the log has to be
// excluded so the same spend is not counted twice (AGENT2A-PHONE-REVEAL-4N).
//
// THEY THROW on a read failure, and that is a deliberate change of contract. Returning
// "0 consumed" on a failed read is fail-OPEN: it reports a full, untouched pool to the
// credit gate, which is exactly when it must refuse to authorize. Callers that must not
// break on a transient error (the Apollo/Tavily budget alerts) already catch and degrade
// to a non-blocking technical error, and the phone reveal preflight already translates a
// throw into `balance_unavailable` — fail-closed, as its contract promises.

/**
 * provider_usage_logs rows for a specific user and provider within a period
 * (periodStart inclusive, periodEnd exclusive).
 */
export async function getConsumptionForUser(
  admin: AdminClient,
  providerKey: string,
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<UsageConsumptionRow[]> {
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select(USAGE_CONSUMPTION_SELECT)
    .eq('provider_key', providerKey)
    .eq('triggered_by', userId)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error) throw new Error(`usage consumption read failed (user): ${error.message}`);
  return toUsageConsumptionRows(data ?? []);
}

/**
 * provider_usage_logs rows for a set of group IDs. Used for the group rule check — the
 * pool covers the matched group and all its descendants. Logs created before
 * triggered_by_group_id was populated (Hito A or earlier) have null there and will NOT
 * be counted; this is expected and documented: only logs with a group snapshot count
 * toward group budgets. Historical logs without a snapshot still count for user and
 * global rules.
 */
export async function getConsumptionForGroups(
  admin: AdminClient,
  providerKey: string,
  groupIds: string[],
  periodStart: string,
  periodEnd: string,
): Promise<UsageConsumptionRow[]> {
  if (groupIds.length === 0) return [];

  const { data, error } = await admin
    .from('provider_usage_logs')
    .select(USAGE_CONSUMPTION_SELECT)
    .eq('provider_key', providerKey)
    .in('triggered_by_group_id', groupIds)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error) throw new Error(`usage consumption read failed (groups): ${error.message}`);
  return toUsageConsumptionRows(data ?? []);
}

/**
 * provider_usage_logs rows for all users with a given role. Used for the role rule
 * check — the pool is shared across the entire role. Same historical caveat about a
 * missing triggered_by_role_key snapshot as group logs above.
 */
export async function getConsumptionForRole(
  admin: AdminClient,
  providerKey: string,
  roleKey: string,
  periodStart: string,
  periodEnd: string,
): Promise<UsageConsumptionRow[]> {
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select(USAGE_CONSUMPTION_SELECT)
    .eq('provider_key', providerKey)
    .eq('triggered_by_role_key', roleKey)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error) throw new Error(`usage consumption read failed (role): ${error.message}`);
  return toUsageConsumptionRows(data ?? []);
}

/**
 * provider_usage_logs rows for a whole provider (all users) within a period.
 * Used for the global rule check.
 */
export async function getConsumptionGlobal(
  admin: AdminClient,
  providerKey: string,
  periodStart: string,
  periodEnd: string,
): Promise<UsageConsumptionRow[]> {
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select(USAGE_CONSUMPTION_SELECT)
    .eq('provider_key', providerKey)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error) throw new Error(`usage consumption read failed (global): ${error.message}`);
  return toUsageConsumptionRows(data ?? []);
}

/**
 * provider_usage_logs rows for EVERY provider in a period, for the admin summary,
 * which resolves all pools in one pass.
 */
export async function getConsumptionByProvider(
  admin: AdminClient,
  periodStart: string,
  periodEnd: string,
): Promise<UsageConsumptionRow[]> {
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select(USAGE_CONSUMPTION_SELECT)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error) throw new Error(`usage consumption read failed (all providers): ${error.message}`);
  return toUsageConsumptionRows(data ?? []);
}

// ─── Phone reveal credit reservations (AGENT2A-PHONE-REVEAL-4N) ────────────────

/**
 * Reservation rows of ONE pool, in ONE read, with EVERY status included.
 *
 * The single read is the whole point and not an optimization. `reserved` credits occupy
 * availability and `confirmed` credits are consumption, so a row must be seen by exactly
 * one of the two. Split into two queries, a row that settles between them is read
 * `reserved` by the first and `confirmed` by the second — or, in the other order, by
 * NEITHER, which hands its credits back to `available` for the duration of the window.
 * That is the double-availability interval §3 forbids; one snapshot makes it impossible.
 *
 * POOL IDENTITY IS MATCHED AS STORED, never re-resolved. Each row carries the scope and
 * period that were in force when the authorization was granted, and it is matched on
 * exactly those — the same `provider_key / scope_type / scope_id (null-safe) /
 * period_start` tuple `reserve_and_create_phone_reveal_run` locks. A later change to
 * `budget_rules` therefore moves the CURRENT pool without dragging historical operations
 * into it: a reservation confirmed under the old pool stays charged to the old pool.
 *
 * `released` rows are read but contribute nothing (the pure core ignores them). They are
 * fetched anyway so the snapshot is a complete picture of the pool and a row that was
 * released mid-read cannot be mistaken for a missing one.
 *
 * SCOPE IS OPTIONAL. Omitting `scope` reads every scope for the given providers and
 * period, which is what the org-wide admin summary needs: it aggregates usage logs across
 * ALL users against a global rule, so it must also see the reservations of the per-user
 * pools those logs came from. Pinning it to `scope_type = 'global'` there would exclude a
 * user-scoped reservation's usage log while adding nothing back, and the spend would
 * simply disappear from the total.
 */
export async function getPhoneRevealReservationSnapshot(
  admin: AdminClient,
  pool: {
    providerKeys: readonly string[];
    /** Omit to read EVERY scope (aggregate reporting). Present = one exact pool. */
    scope?: { scopeType: string; scopeId: string | null };
    periodStart: string;
    periodEnd: string;
  },
): Promise<ReservationSnapshotRow[]> {
  if (pool.providerKeys.length === 0) return [];

  let query = admin
    .from(PHONE_REVEAL_CREDIT_RESERVATIONS_TABLE)
    .select(
      'provider_key, status, credits_reserved, credits_confirmed, cost_truth, run_id, reservation_group_id',
    )
    .in('provider_key', pool.providerKeys as string[])
    .eq('period_start', pool.periodStart)
    .eq('period_end', pool.periodEnd);

  if (pool.scope) {
    query = query.eq('scope_type', pool.scope.scopeType);
    // scope_id is NULL on a global rule, and `.eq(col, null)` does not match NULL in
    // PostgREST — it has to be an IS NULL filter, mirroring the SQL's
    // `IS NOT DISTINCT FROM`.
    query =
      pool.scope.scopeId === null
        ? query.is('scope_id', null)
        : query.eq('scope_id', pool.scope.scopeId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`phone reveal reservation snapshot read failed: ${error.message}`);
  }

  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      providerKey: typeof row.provider_key === 'string' ? row.provider_key : '',
      status: row.status as ReservationSnapshotStatus,
      creditsReserved: row.credits_reserved == null ? null : Number(row.credits_reserved),
      creditsConfirmed: row.credits_confirmed == null ? null : Number(row.credits_confirmed),
      costTruth: (row.cost_truth as ReservationSnapshotRow['costTruth']) ?? null,
      runId: typeof row.run_id === 'string' ? row.run_id : null,
      reservationGroupId:
        typeof row.reservation_group_id === 'string' ? row.reservation_group_id : null,
    };
  });
}

/**
 * `credit_reservation_group_id` → `phone_reveal_waterfall_runs.id` for the groups in a
 * snapshot. This is the AUTHORITATIVE side of the reservation ↔ run association (it is
 * written inside the run INSERT), so it is what lets a usage log be excluded even when
 * the reservation's own convenience `run_id` was never written back.
 *
 * TOLERANT ON PURPOSE, unlike every other reader here. This map only ever ADDS exclusions;
 * without it, exclusion falls back to `reservations.run_id` and any leg it cannot match
 * simply keeps counting its usage log ON TOP of its confirmed reservation. That direction
 * over-counts, which blocks an operation at worst — the opposite direction would hand back
 * availability that was already spent. So a failure here degrades instead of failing closed,
 * and budget resolution does not become hostage to a feature table it does not own.
 */
export async function getRunIdsByReservationGroup(
  admin: AdminClient,
  reservationGroupIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (reservationGroupIds.length === 0) return result;

  const { data, error } = await admin
    .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
    .select('id, credit_reservation_group_id')
    .in('credit_reservation_group_id', reservationGroupIds as string[]);

  if (error) {
    console.warn(
      '[budgets] waterfall run group resolution unavailable, falling back to reservation.run_id (over-counts, never under-counts):',
      error.message,
    );
    return result;
  }

  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    if (
      typeof row.id === 'string' &&
      typeof row.credit_reservation_group_id === 'string'
    ) {
      result.set(row.credit_reservation_group_id, row.id);
    }
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
  usdCostMtd: number | null;
}>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('tool_catalog')
    .select('provider_key, display_name, monthly_credits_allowance, monthly_usd_allowance, quota_source, quota_synced_at, quota_sync_error, quota_override_manual, credits_remaining_external, usd_cost_mtd')
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
    usdCostMtd: r.usd_cost_mtd != null ? Number(r.usd_cost_mtd) : null,
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
