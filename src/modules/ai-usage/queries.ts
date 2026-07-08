import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { flattenOrgGroups } from '@/modules/access/group-tree';
import { isCommercialScopeEnabled } from '@/lib/feature-flags.server';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
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
  /** Role key — perfil del usuario (e.g. "admin", "seller"). */
  role?: string;
  /**
   * Organization group id — estructura organizacional real
   * (organization_groups). Incluye descendientes al resolver el scope.
   */
  groupId?: string;
}

// Status considered "active" in internal_users (mirrors AccessStatus).
const ACTIVE_USER_STATUS = 'active';

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

function emptySummary(): AiUsageSummary {
  return {
    total_executions: 0,
    running_executions: 0,
    failed_executions: 0,
    total_provider_calls: 0,
    error_provider_calls: 0,
    total_estimated_cost_usd: 0,
    distinct_providers: 0,
    avg_cost_per_run: null,
  };
}

// ============================================================
// getDistinctFilterOptions
// Returns unique values for all filter dropdowns.
// ============================================================

export interface FilterUser {
  id: string;
  full_name: string | null;
  email: string | null;
  /** Role key so the client can scope users by role. */
  role_key: string | null;
  /** Organization group id so the client can scope users by group. */
  group_id: string | null;
}

/** Rol — perfil del usuario. */
export interface FilterRole {
  /** Role key — stable value persisted in the URL (?role=). */
  key: string;
  /** Human-readable label (roles.name when present, else normalized key). */
  label: string;
}

/** Grupo — nodo de la estructura organizacional real (organization_groups). */
export interface FilterGroup {
  /** Group id — stable value persisted in the URL (?groupId=). */
  id: string;
  name: string;
  /** Parent group id; null for root groups. Used to build the hierarchy. */
  parent_group_id: string | null;
  /** 0 = raíz, 1 = hijo, 2 = nieto (máximo 3 niveles). */
  depth: number;
}

export interface FilterOptions {
  providers: string[];
  agents: { key: string; name: string | null }[];
  statuses: string[];
  hasTriggeredBy: boolean;
  users: FilterUser[];
  /** Roles (perfil) — dimensión "Rol". */
  roles: FilterRole[];
  /** Grupos organizacionales reales — dimensión "Grupo". */
  groups: FilterGroup[];
  /**
   * Whether the Usuario filter was scoped to active users only.
   * False means internal_users had no usable status field and all rows
   * were included.
   */
  usersScopedToActive: boolean;
}

// ============================================================
// Role / group label normalization
// roles.name is preferred when present; this map is the fallback
// for known role keys so the UI stays readable.
// ============================================================

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  administrator: 'Administrador',
  administrador: 'Administrador',
  seller: 'Vendedor / BD',
  bd: 'Vendedor / BD',
  vendedor_bd: 'Vendedor / BD',
  manager: 'Manager comercial',
  leader: 'Líder comercial',
  lider: 'Líder comercial',
};

function roleLabel(key: string, name: string | null): string {
  if (name && name.trim()) return name;
  return ROLE_LABELS[key.toLowerCase()] ?? key;
}

// ============================================================
// User-scope resolution
// Combines the user + group (role) filters into a concrete set
// of triggered_by ids that downstream queries should match.
//   - mode 'none'  → no user/group constraint
//   - mode 'ids'   → match triggered_by IN ids (empty ids → no rows)
// ============================================================

type UserScope = { mode: 'none' } | { mode: 'ids'; ids: string[] };

type AdminClient = ReturnType<typeof getAdminClient>;

// ============================================================
// AI-usage access (commercial scope)
//   - 'denied' → caller returns null (UI shows the restricted banner).
//   - 'all'    → no base constraint on triggered_by.
//   - 'ids'    → base constraint: triggered_by ∈ ids (the viewer's team/self).
//
// Flag OFF (default): preserves the historical behaviour — admin only.
// Flag ON: admin sees all, líder/manager see their team, vendedor sees self.
// ============================================================

type AiUsageAccess =
  | { mode: 'denied' }
  | { mode: 'all' }
  | { mode: 'ids'; ids: string[] };

async function resolveAiUsageAccess(): Promise<AiUsageAccess> {
  if (!isCommercialScopeEnabled()) {
    const isAdmin = await isCurrentUserAdmin();
    return isAdmin ? { mode: 'all' } : { mode: 'denied' };
  }

  const scope = await resolveCommercialScope();
  if (!scope) return { mode: 'denied' };
  if (scope.canViewAll) return { mode: 'all' };
  return { mode: 'ids', ids: scope.allowedUserIds };
}

async function getActiveUserIdsForRoleKey(
  admin: AdminClient,
  roleKey: string,
): Promise<string[]> {
  const { data: role } = await admin
    .from('roles')
    .select('id')
    .eq('key', roleKey)
    .maybeSingle();
  if (!role) return [];

  const { data } = await admin
    .from('internal_users')
    .select('id')
    .eq('role_id', role.id)
    .eq('access_status', ACTIVE_USER_STATUS);
  return (data ?? []).map((u) => u.id as string);
}

// Resolve the selected group plus every descendant (organization_groups is a
// max 3-level tree via parent_group_id). Returns the full set of group ids in
// the selected subtree, so selecting a parent includes its children.
function collectGroupAndDescendants(
  rootId: string,
  groups: { id: string; parent_group_id: string | null }[],
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const g of groups) {
    if (!g.parent_group_id) continue;
    const arr = childrenByParent.get(g.parent_group_id) ?? [];
    arr.push(g.id);
    childrenByParent.set(g.parent_group_id, arr);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    for (const childId of childrenByParent.get(id) ?? []) stack.push(childId);
  }
  return result;
}

async function getActiveUserIdsForGroupScope(
  admin: AdminClient,
  groupId: string,
): Promise<string[]> {
  const { data: groups } = await admin
    .from('organization_groups')
    .select('id, parent_group_id');

  const scopeIds = collectGroupAndDescendants(groupId, groups ?? []);
  if (scopeIds.length === 0) return [];

  const { data } = await admin
    .from('internal_users')
    .select('id')
    .in('group_id', scopeIds)
    .eq('access_status', ACTIVE_USER_STATUS);
  return (data ?? []).map((u) => u.id as string);
}

// Combine the user, role and group filters into one concrete id set.
// Each active filter contributes a candidate id list; the final scope is the
// INTERSECTION of all of them (role ∩ group ∩ user), so the dimensions stack.
async function resolveUserScope(
  admin: AdminClient,
  filters: UsageFilters,
  baseIds: string[] | null = null,
): Promise<UserScope> {
  const constraints: string[][] = [];

  // Commercial-scope base constraint (team/self). Intersected with the
  // explicit filters below, so a non-admin can never widen results by passing
  // ?user=/?role=/?groupId= outside their reach.
  if (baseIds !== null) constraints.push(baseIds);

  if (filters.role) {
    constraints.push(await getActiveUserIdsForRoleKey(admin, filters.role));
  }
  if (filters.groupId) {
    constraints.push(await getActiveUserIdsForGroupScope(admin, filters.groupId));
  }
  if (filters.user) {
    constraints.push([filters.user]);
  }

  if (constraints.length === 0) return { mode: 'none' };

  let ids = constraints[0];
  for (let i = 1; i < constraints.length; i++) {
    const allowed = new Set(constraints[i]);
    ids = ids.filter((id) => allowed.has(id));
  }
  return { mode: 'ids', ids: [...new Set(ids)] };
}

// ============================================================
// Agent-scope resolution (Q3F-8B)
//
// UsageFilters.agent carries an agent_key (e.g. "prospect_generation"), NOT a
// run id. provider_usage_logs has no agent_key column — it only has
// agent_run_id. So filtering provider logs by Agent means resolving the key to
// its agent_runs.id[] first, then constraining agent_run_id ∈ those ids.
//
// The chain: agent_runs.agent_key → agent_runs.id → provider_usage_logs.agent_run_id
// ============================================================

/**
 * Resolve an agent_key to the set of agent_runs.id it produced.
 *
 * Selects only `id` (no unnecessary columns) and touches agent_runs only —
 * provider_usage_logs scoping happens in the caller. Never mixes role / group /
 * user scope; it is orthogonal to resolveUserScope.
 *
 * Return contract:
 *   - key with runs    → [id, id, ...]
 *   - key with no runs → []
 *   - query error      → [] (fail-closed, mirroring getActiveUserIdsForRoleKey:
 *                        an unresolvable scope contributes an empty id set
 *                        rather than silently widening results)
 */
async function resolveAgentRunIds(
  admin: AdminClient,
  agentKey: string,
): Promise<string[]> {
  const { data } = await admin
    .from('agent_runs')
    .select('id')
    .eq('agent_key', agentKey);
  return (data ?? []).map((r) => r.id as string);
}

// The single Agent-scope decision shared by getProviderStats,
// getProviderOperationStats and getRecentProviderLogs. Kept pure (no Supabase
// client) so the three-case boundary is unit-testable directly, matching this
// module's aggregateOperationStats testing approach.
//   - disabled                → no filters.agent → do NOT constrain agent_run_id
//   - enabled, runIds.length>0 → constrain agent_run_id ∈ runIds
//   - enabled, runIds.length=0 → Agent selected but 0 matching runs → EMPTY
//     (the caller must short-circuit; it must NOT fall through to an
//     unconstrained provider_usage_logs query, which would wrongly show all data)
export type AgentRunScope =
  | { enabled: false }
  | { enabled: true; runIds: string[] };

export function createAgentRunScope(
  agentKey: string | undefined,
  resolvedIds: string[] | null,
): AgentRunScope {
  if (!agentKey) return { enabled: false };
  return { enabled: true, runIds: resolvedIds ?? [] };
}

export async function getDistinctFilterOptions(): Promise<FilterOptions | null> {
  const access = await resolveAiUsageAccess();
  if (access.mode === 'denied') return null;

  const admin = getAdminClient();

  // When scoped (team/self), restrict the selectable Usuario/Grupo options to
  // the viewer's reach so the filter UI can never offer an out-of-scope target.
  // null = unrestricted (admin / view-all).
  let allowedUserIds: string[] | null = null;
  let allowedGroupIdSet: Set<string> | null = null;
  if (access.mode === 'ids') {
    allowedUserIds = access.ids;
    const scope = await resolveCommercialScope();
    allowedGroupIdSet = new Set(scope?.allowedGroupIds ?? []);
  }

  let usersQuery = admin
    .from('internal_users')
    .select('id, full_name, email, role_id, group_id, access_status')
    .eq('access_status', ACTIVE_USER_STATUS)
    .order('full_name', { ascending: true });
  if (allowedUserIds !== null) usersQuery = usersQuery.in('id', allowedUserIds);

  const [logsResult, runsResult, usersResult, rolesResult, groupsResult] =
    await Promise.all([
      admin.from('provider_usage_logs').select('provider_key, status, triggered_by'),
      admin.from('agent_runs').select('agent_key, agent_name, triggered_by, status'),
      usersQuery,
      admin.from('roles').select('id, key, name'),
      admin
        .from('organization_groups')
        .select('id, name, parent_group_id'),
    ]);

  const logs = logsResult.data ?? [];
  const runs = runsResult.data ?? [];
  const internalUsers = usersResult.data ?? [];
  const roles = rolesResult.data ?? [];
  const orgGroups = groupsResult.data ?? [];

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

  // Role id → {key, name} for mapping users and building the group filter.
  const roleById = new Map<string, { key: string; name: string | null }>(
    roles.map((r) => [
      r.id as string,
      { key: r.key as string, name: (r.name as string | null) ?? null },
    ]),
  );

  // Filter Usuario: ALL active users from internal_users (zero consumption included).
  const users: FilterUser[] = internalUsers.map((u) => ({
    id: u.id as string,
    full_name: u.full_name as string | null,
    email: u.email as string | null,
    role_key: u.role_id ? roleById.get(u.role_id as string)?.key ?? null : null,
    group_id: (u.group_id as string | null) ?? null,
  }));

  // Roles (perfil): only roles that at least one active user has, sorted by label.
  const usedRoleIds = [
    ...new Set(internalUsers.map((u) => u.role_id as string | null).filter(Boolean) as string[]),
  ];
  const rolesOptions: FilterRole[] = usedRoleIds
    .map((id) => {
      const r = roleById.get(id);
      if (!r) return null;
      return { key: r.key, label: roleLabel(r.key, r.name) };
    })
    .filter((r): r is FilterRole => r !== null)
    .sort((a, b) => a.label.localeCompare(b.label));

  // Groups: real organization_groups in hierarchy order (pre-order tree walk
  // sorted by name per level, same as the "Usuarios y grupos" screen). depth is
  // derived from the tree level so the dropdown nests under the right parent.
  const normalizedGroups = orgGroups
    .map((g) => ({
      id: g.id as string,
      name: g.name as string,
      parent_group_id: (g.parent_group_id as string | null) ?? null,
    }))
    // When scoped, only offer groups inside the viewer's subtree.
    .filter((g) => allowedGroupIdSet === null || allowedGroupIdSet.has(g.id));
  const groups: FilterGroup[] = flattenOrgGroups(normalizedGroups).map(
    ({ group, depth }) => ({ ...group, depth }),
  );

  return {
    providers,
    agents,
    statuses,
    hasTriggeredBy,
    users,
    roles: rolesOptions,
    groups,
    usersScopedToActive: true,
  };
}

// ============================================================
// getAiUsageSummary — with filters
// ============================================================

export async function getAiUsageSummary(
  filters: UsageFilters = {},
): Promise<AiUsageSummary | null> {
  const access = await resolveAiUsageAccess();
  if (access.mode === 'denied') return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);
  const baseIds = access.mode === 'ids' ? access.ids : null;
  const scope = await resolveUserScope(admin, filters, baseIds);

  // A user/group filter that resolves to zero users → empty metrics.
  if (scope.mode === 'ids' && scope.ids.length === 0) {
    return emptySummary();
  }

  let runsQuery = admin.from('agent_runs').select('status, estimated_cost_usd');
  if (since) runsQuery = runsQuery.gte('created_at', since);
  if (filters.agent) runsQuery = runsQuery.eq('agent_key', filters.agent);
  if (filters.status) runsQuery = runsQuery.eq('status', filters.status);
  if (scope.mode === 'ids') runsQuery = runsQuery.in('triggered_by', scope.ids);

  let logsQuery = admin
    .from('provider_usage_logs')
    .select('status, estimated_cost_usd, provider_key');
  if (since) logsQuery = logsQuery.gte('created_at', since);
  if (filters.provider) logsQuery = logsQuery.eq('provider_key', filters.provider);
  if (filters.status) logsQuery = logsQuery.eq('status', filters.status);
  if (scope.mode === 'ids') logsQuery = logsQuery.in('triggered_by', scope.ids);

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
  const access = await resolveAiUsageAccess();
  if (access.mode === 'denied') return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);
  const baseIds = access.mode === 'ids' ? access.ids : null;
  const scope = await resolveUserScope(admin, filters, baseIds);
  if (scope.mode === 'ids' && scope.ids.length === 0) return [];

  let query = admin
    .from('agent_runs')
    .select(
      'agent_key, agent_name, status, results_generated, results_approved, estimated_cost_usd, created_at',
    )
    .order('created_at', { ascending: false });

  if (since) query = query.gte('created_at', since);
  if (filters.agent) query = query.eq('agent_key', filters.agent);
  if (filters.status) query = query.eq('status', filters.status);
  if (scope.mode === 'ids') query = query.in('triggered_by', scope.ids);

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
  const access = await resolveAiUsageAccess();
  if (access.mode === 'denied') return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);
  const baseIds = access.mode === 'ids' ? access.ids : null;
  const scope = await resolveUserScope(admin, filters, baseIds);
  if (scope.mode === 'ids' && scope.ids.length === 0) return [];

  // Agent scope: resolve agent_key → agent_runs.id[] and constrain
  // provider_usage_logs.agent_run_id. An active Agent filter with no matching
  // runs yields an empty universe (never an unconstrained query).
  const agentScope = createAgentRunScope(
    filters.agent,
    filters.agent ? await resolveAgentRunIds(admin, filters.agent) : null,
  );
  if (agentScope.enabled && agentScope.runIds.length === 0) return [];

  let query = admin
    .from('provider_usage_logs')
    .select(
      'provider_key, status, credits_used, input_tokens, output_tokens, results_returned, estimated_cost_usd, created_at',
    );

  if (since) query = query.gte('created_at', since);
  if (filters.provider) query = query.eq('provider_key', filters.provider);
  if (filters.status) query = query.eq('status', filters.status);
  if (scope.mode === 'ids') query = query.in('triggered_by', scope.ids);
  if (agentScope.enabled) query = query.in('agent_run_id', agentScope.runIds);

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
// getProviderOperationStats — breakdown by operation_key
// Answers "which operations are consuming this provider's credits in the
// selected scope?". Uses the exact same UsageFilters scope semantics as
// getProviderStats (period/provider/status/user-scope/agent) so the breakdown
// and the Q3F-7 KPIs describe the same filtered universe.
// ============================================================

export interface OperationStat {
  operation_key: string;
  total_calls: number;
  success_calls: number;
  error_calls: number;
  total_credits_used: number;
  total_estimated_cost_usd: number;
}

interface OperationLogRow {
  operation_key: string | null;
  status: string | null;
  credits_used: number | null;
  estimated_cost_usd: number | null;
}

/**
 * Pure aggregator — groups provider_usage_logs rows by operation_key.
 * Mirrors getProviderStats' success/error classification exactly:
 * success_calls = status === 'success'; error_calls = every other status
 * (no new error taxonomy invented here).
 *
 * Kept dependency-free (no Supabase client) so it is directly unit
 * testable without mocking the admin client.
 */
export function aggregateOperationStats(rows: OperationLogRow[]): OperationStat[] {
  const map = new Map<string, OperationStat>();

  for (const row of rows) {
    const key = row.operation_key ?? '';
    const existing: OperationStat = map.get(key) ?? {
      operation_key: key,
      total_calls: 0,
      success_calls: 0,
      error_calls: 0,
      total_credits_used: 0,
      total_estimated_cost_usd: 0,
    };

    existing.total_calls++;
    if (row.status === 'success') existing.success_calls++;
    else existing.error_calls++;

    existing.total_credits_used += Number(row.credits_used ?? 0);
    existing.total_estimated_cost_usd += Number(row.estimated_cost_usd ?? 0);

    map.set(key, existing);
  }

  // Same priority getProviderStats uses for cost (credits first here, since
  // this view is about credit consumption), then call volume, then a stable
  // alphabetical tie-break so ordering is deterministic across runs.
  return Array.from(map.values()).sort((a, b) => {
    if (b.total_credits_used !== a.total_credits_used) {
      return b.total_credits_used - a.total_credits_used;
    }
    if (b.total_calls !== a.total_calls) return b.total_calls - a.total_calls;
    return a.operation_key.localeCompare(b.operation_key);
  });
}

/**
 * Pure boundary helper (Q3F-8E) — decides whether a provider_usage_logs
 * result for the operation-stats query is a legitimate empty result or a
 * failed query that must propagate as a thrown exception.
 *
 * `null | undefined` data with no error is treated the same as `[]` (a
 * genuinely empty successful result); a truthy `error` always throws,
 * regardless of what `data` contains, so getProviderOperationStats' Supabase
 * failures reach provider-consumption-actions.ts's `operation_stats`
 * try/catch instead of silently becoming `[]` (indistinguishable from "Sin
 * consumo por operación"). Kept dependency-free so it is unit-testable
 * without mocking the Supabase client.
 */
export function resolveOperationLogRowsOrThrow(
  data: OperationLogRow[] | null | undefined,
  error: unknown,
): OperationLogRow[] {
  if (error) throw error;
  return data ?? [];
}

export async function getProviderOperationStats(
  filters: UsageFilters = {},
): Promise<OperationStat[] | null> {
  const access = await resolveAiUsageAccess();
  if (access.mode === 'denied') return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);
  const baseIds = access.mode === 'ids' ? access.ids : null;
  const scope = await resolveUserScope(admin, filters, baseIds);
  if (scope.mode === 'ids' && scope.ids.length === 0) return [];

  // Same Agent scope as getProviderStats: resolve agent_key → agent_runs.id[]
  // and constrain provider_usage_logs.agent_run_id, so the breakdown and the
  // Q3F-7 KPIs describe the identical filtered universe.
  const agentScope = createAgentRunScope(
    filters.agent,
    filters.agent ? await resolveAgentRunIds(admin, filters.agent) : null,
  );
  if (agentScope.enabled && agentScope.runIds.length === 0) return [];

  let query = admin
    .from('provider_usage_logs')
    .select('operation_key, status, credits_used, estimated_cost_usd, created_at');

  if (since) query = query.gte('created_at', since);
  if (filters.provider) query = query.eq('provider_key', filters.provider);
  if (filters.status) query = query.eq('status', filters.status);
  if (scope.mode === 'ids') query = query.in('triggered_by', scope.ids);
  if (agentScope.enabled) query = query.in('agent_run_id', agentScope.runIds);

  const { data, error } = await query;
  // Unlike getProviderStats/getRecentProviderLogs, a Supabase query error here
  // must NOT collapse into a valid-looking empty result: it needs to surface
  // as a thrown exception so provider-consumption-actions.ts's `operation_stats`
  // try/catch can classify it and the UI can show the contained-error banner
  // instead of a false "Sin consumo por operación" empty state (Q3F-8E).
  const rows = resolveOperationLogRowsOrThrow(data as OperationLogRow[] | null, error);

  return aggregateOperationStats(rows);
}

// ============================================================
// getRecentProviderLogs — with filters
// ============================================================

export async function getRecentProviderLogs(
  limit = 25,
  filters: UsageFilters = {},
): Promise<ProviderUsageLog[] | null> {
  const access = await resolveAiUsageAccess();
  if (access.mode === 'denied') return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);
  const baseIds = access.mode === 'ids' ? access.ids : null;
  const scope = await resolveUserScope(admin, filters, baseIds);
  if (scope.mode === 'ids' && scope.ids.length === 0) return [];

  // Same Agent scope as getProviderStats / getProviderOperationStats: recent
  // logs include only rows whose agent_run_id belongs to runs of the selected
  // agent_key. An active Agent filter with no matching runs yields no logs.
  const agentScope = createAgentRunScope(
    filters.agent,
    filters.agent ? await resolveAgentRunIds(admin, filters.agent) : null,
  );
  if (agentScope.enabled && agentScope.runIds.length === 0) return [];

  let query = admin
    .from('provider_usage_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (since) query = query.gte('created_at', since);
  if (filters.provider) query = query.eq('provider_key', filters.provider);
  if (filters.status) query = query.eq('status', filters.status);
  if (scope.mode === 'ids') query = query.in('triggered_by', scope.ids);
  if (agentScope.enabled) query = query.in('agent_run_id', agentScope.runIds);

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
  /** Distinct provider keys used by this user within the active filters. */
  providers: string[];
  estimated_cost_usd: number;
  last_activity_at: string | null;
}

// Max rows rendered in the "Consumo por usuario" table. Consumers are
// surfaced first, so a long roster of zero-consumption users never hides
// real activity.
const USER_CONSUMPTION_LIMIT = 100;

interface UserAgg {
  executions: number;
  provider_calls: number;
  providers: Set<string>;
  cost: number;
  last_at: string | null;
}

function newAgg(): UserAgg {
  return { executions: 0, provider_calls: 0, providers: new Set(), cost: 0, last_at: null };
}

export async function getUserConsumption(
  filters: UsageFilters = {},
): Promise<UserConsumptionRow[] | null> {
  const access = await resolveAiUsageAccess();
  if (access.mode === 'denied') return null;

  const admin = getAdminClient();
  const since = periodStart(filters.period);
  const baseIds = access.mode === 'ids' ? access.ids : null;
  const scope = await resolveUserScope(admin, filters, baseIds);
  if (scope.mode === 'ids' && scope.ids.length === 0) return [];

  // Display roster: active users, scoped to the selected user/group.
  let usersQuery = admin
    .from('internal_users')
    .select('id, full_name, email')
    .eq('access_status', ACTIVE_USER_STATUS);
  if (scope.mode === 'ids') usersQuery = usersQuery.in('id', scope.ids);

  let runsQuery = admin
    .from('agent_runs')
    .select('triggered_by, estimated_cost_usd, created_at');
  if (since) runsQuery = runsQuery.gte('created_at', since);
  if (filters.agent) runsQuery = runsQuery.eq('agent_key', filters.agent);
  if (scope.mode === 'ids') runsQuery = runsQuery.in('triggered_by', scope.ids);

  let logsQuery = admin
    .from('provider_usage_logs')
    .select('triggered_by, provider_key, estimated_cost_usd, created_at');
  if (since) logsQuery = logsQuery.gte('created_at', since);
  if (filters.provider) logsQuery = logsQuery.eq('provider_key', filters.provider);
  if (scope.mode === 'ids') logsQuery = logsQuery.in('triggered_by', scope.ids);

  const [usersResult, runsResult, logsResult] = await Promise.all([
    usersQuery,
    runsQuery,
    logsQuery,
  ]);

  const activeUsers = (usersResult.data ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
  }[];
  const runs = (runsResult.data ?? []).filter((r) => r.triggered_by != null);
  const logs = (logsResult.data ?? []).filter((l) => l.triggered_by != null);

  // Aggregate consumption by user id.
  const byUser = new Map<string, UserAgg>();
  for (const r of runs) {
    const uid = r.triggered_by as string;
    const cur = byUser.get(uid) ?? newAgg();
    cur.executions++;
    cur.cost += Number(r.estimated_cost_usd ?? 0);
    if (!cur.last_at || (r.created_at as string) > cur.last_at) cur.last_at = r.created_at as string;
    byUser.set(uid, cur);
  }
  for (const l of logs) {
    const uid = l.triggered_by as string;
    const cur = byUser.get(uid) ?? newAgg();
    cur.provider_calls++;
    if (l.provider_key) cur.providers.add(l.provider_key as string);
    cur.cost += Number(l.estimated_cost_usd ?? 0);
    if (!cur.last_at || (l.created_at as string) > cur.last_at) cur.last_at = l.created_at as string;
    byUser.set(uid, cur);
  }

  // One row per active user (zero consumption included for adoption visibility).
  const activeIds = new Set(activeUsers.map((u) => u.id));
  const rows: UserConsumptionRow[] = activeUsers.map((u) => {
    const agg = byUser.get(u.id);
    return {
      triggered_by: u.id,
      full_name: u.full_name,
      email: u.email,
      executions: agg?.executions ?? 0,
      provider_calls: agg?.provider_calls ?? 0,
      providers: agg ? [...agg.providers] : [],
      estimated_cost_usd: agg?.cost ?? 0,
      last_activity_at: agg?.last_at ?? null,
    };
  });

  // Preserve consumption from ids that are not active users (e.g. suspended)
  // so real cost is never silently dropped.
  const orphanIds = [...byUser.keys()].filter((id) => !activeIds.has(id));
  if (orphanIds.length > 0) {
    const { data: orphanUsers } = await admin
      .from('internal_users')
      .select('id, full_name, email')
      .in('id', orphanIds);
    const orphanMap = new Map(
      (orphanUsers ?? []).map((u) => [
        u.id as string,
        u as { id: string; full_name: string | null; email: string | null },
      ]),
    );
    for (const id of orphanIds) {
      const agg = byUser.get(id)!;
      const u = orphanMap.get(id);
      rows.push({
        triggered_by: id,
        full_name: u?.full_name ?? null,
        email: u?.email ?? null,
        executions: agg.executions,
        provider_calls: agg.provider_calls,
        providers: [...agg.providers],
        estimated_cost_usd: agg.cost,
        last_activity_at: agg.last_at,
      });
    }
  }

  // Consumers first (by cost desc), then zero-consumption users by name.
  rows.sort((a, b) => {
    const aActive = a.executions + a.provider_calls > 0 ? 1 : 0;
    const bActive = b.executions + b.provider_calls > 0 ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (b.estimated_cost_usd !== a.estimated_cost_usd) {
      return b.estimated_cost_usd - a.estimated_cost_usd;
    }
    const an = a.full_name ?? a.email ?? a.triggered_by;
    const bn = b.full_name ?? b.email ?? b.triggered_by;
    return an.localeCompare(bn);
  });

  return rows.slice(0, USER_CONSUMPTION_LIMIT);
}
