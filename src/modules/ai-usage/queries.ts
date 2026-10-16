import { cache } from 'react';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { flattenOrgGroups } from '@/modules/access/group-tree';
import { isCommercialScopeEnabled } from '@/lib/feature-flags.server';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import {
  AGENT_DIMENSION_LABELS,
  AGENT_STEP_LABELS,
  SEARCH_MODE_LABELS,
  agentKeyFromRunKey,
} from '@/modules/usage-tracking/usage-dimensions';
import type {
  AgentStat,
  ProviderStat,
  AiUsageSummary,
  ProviderUsageLog,
} from '@/modules/usage-tracking/types';
import { resolveUsageCredits } from '@/modules/usage-tracking/credits-display';
import {
  fetchAllPages,
  fetchAllPagesInChunks,
  IN_FILTER_CHUNK_SIZE,
} from '@/lib/supabase/paginated-read';
import { canonicalStatusKey } from './usage-filter-semantics';
import {
  aggregateAgentStats,
  aggregateProviderStats,
  aggregateUsageSummary,
  aggregateUserConsumption,
  consumerIds,
  indexRunsById,
  selectLogsInScope,
  type UsageLogRow,
  type UsagePerson,
  type UsageRunRow,
  type UserConsumptionRow,
} from './usage-aggregators';
import type { DimensionedLogRow, UsageDimensionFilters } from './usage-dimension-scope';
import {
  buildUsageScope,
  fetchAllRuns,
  loadUsageDataset,
  scopedLogsQuery,
  UsageReadError,
  type PageResult,
  type UsageDataset,
} from './usage-dataset';
import { aggregateAgentSteps, type AgentStepRow, type AgentSummaryRow } from './usage-breakdowns';
import {
  canSeeMoney,
  redactAgentStats,
  redactAgentSteps,
  redactProviderStats,
  redactRecentLogs,
  redactSummary,
  redactUserConsumption,
} from './money-visibility';

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
  /** País (ISO de 2 letras) de la consulta o del lote. */
  country?: string;
  /** Macro industria (clave del catálogo v2). */
  industry?: string;
  /** Paso del agente (agent_step). */
  step?: string;
  /** Forma de búsqueda (search_mode). */
  mode?: string;
}

/** Los filtros de dimensión (fase 3) de los filtros de la página. */
export function dimensionFiltersOf(filters: UsageFilters): UsageDimensionFilters {
  return {
    countryCode: filters.country?.trim().toUpperCase() || undefined,
    macroIndustryKey: filters.industry || undefined,
    agentStep: filters.step || undefined,
    searchMode: filters.mode || undefined,
  };
}

// Status considered "active" in internal_users (mirrors AccessStatus).
const ACTIVE_USER_STATUS = 'active';

function emptySummary(): AiUsageSummary {
  return {
    total_executions: 0,
    running_executions: 0,
    failed_executions: 0,
    total_provider_calls: 0,
    error_provider_calls: 0,
    total_estimated_cost_usd: 0,
    has_unknown_cost: false,
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
  // Fase 3 — opcionales: otras superficies (Proveedores) reutilizan este tipo
  // sin estos filtros.
  /** Países (ISO) con al menos una búsqueda. */
  countries?: string[];
  /** Macro industrias del catálogo. */
  industries?: string[];
  /** Pasos de agente conocidos. */
  steps?: string[];
  /** Formas de búsqueda que hoy existen. */
  modes?: string[];
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

export type UserScope = { mode: 'none' } | { mode: 'ids'; ids: string[] };

export type AdminClient = ReturnType<typeof getAdminClient>;

// ============================================================
// AI-usage access (commercial scope)
//   - 'denied' → caller returns null (UI shows the restricted banner).
//   - 'all'    → no base constraint on triggered_by.
//   - 'ids'    → base constraint: triggered_by ∈ ids (the viewer's team/self).
//
// Flag OFF (default): preserves the historical behaviour — admin only.
// Flag ON: admin sees all, líder/manager see their team, vendedor sees self.
// ============================================================

// moneyVisible (decisión de la dueña, 13-10): administración y líderes /
// managers ven USD; vendedores sólo créditos y unidades. Ver money-visibility.ts.
type AiUsageAccess =
  | { mode: 'denied' }
  | { mode: 'all'; moneyVisible: boolean }
  | { mode: 'ids'; ids: string[]; moneyVisible: boolean };

async function resolveAiUsageAccess(): Promise<AiUsageAccess> {
  if (!isCommercialScopeEnabled()) {
    const isAdmin = await isCurrentUserAdmin();
    return isAdmin ? { mode: 'all', moneyVisible: true } : { mode: 'denied' };
  }

  const scope = await resolveCommercialScope();
  if (!scope) return { mode: 'denied' };
  if (scope.canViewAll) return { mode: 'all', moneyVisible: true };
  return {
    mode: 'ids',
    ids: scope.allowedUserIds,
    moneyVisible: canSeeMoney({ viewAll: false, roleKey: scope.currentUserRole }),
  };
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

// Lectura del universo filtrado: usage-dataset.ts.
export { UsageReadError } from './usage-dataset';

export type PreparedAccess =
  | { kind: 'denied' }
  | { kind: 'empty'; moneyVisible: boolean }
  | { kind: 'ready'; admin: AdminClient; userScope: UserScope; moneyVisible: boolean };

/** Acceso + personas del ámbito. 'empty' = los filtros no dejan a nadie. */
export async function prepareAccess(filters: UsageFilters): Promise<PreparedAccess> {
  const access = await resolveAiUsageAccess();
  if (access.mode === 'denied') return { kind: 'denied' };
  const admin = getAdminClient();
  const baseIds = access.mode === 'ids' ? access.ids : null;
  const userScope = await resolveUserScope(admin, filters, baseIds);
  if (userScope.mode === 'ids' && userScope.ids.length === 0) {
    return { kind: 'empty', moneyVisible: access.moneyVisible };
  }
  return { kind: 'ready', admin, userScope, moneyVisible: access.moneyVisible };
}

/**
 * Personas a las que se limitan las cifras (persona ∩ rol ∩ grupo ∩ alcance
 * comercial), para superficies que no leen provider_usage_logs directamente
 * (el panel del Agente 1 filtra prospect_batches.created_by con esto).
 *   - 'denied' → sin acceso
 *   - null     → sin restricción de personas
 *   - string[] → sólo esas personas ([] = nadie)
 */
export async function resolveUsagePeopleScope(
  filters: UsageFilters,
): Promise<'denied' | string[] | null> {
  const prepared = await prepareAccess(filters);
  if (prepared.kind === 'denied') return 'denied';
  if (prepared.kind === 'empty') return [];
  return prepared.userScope.mode === 'ids' ? prepared.userScope.ids : null;
}

function distinctCountries(rows: readonly { country_code: string | null }[]): string[] {
  const codes = new Set<string>();
  for (const row of rows) {
    const code = row.country_code?.trim().toUpperCase();
    if (code && /^[A-Z]{2}$/.test(code)) codes.add(code);
  }
  return [...codes].sort();
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

  type OptionLogRow = { provider_key: string; status: string; triggered_by: string | null };
  type OptionBatchRow = { country_code: string | null };
  const [logsRead, runsRead, usersResult, rolesResult, groupsResult, batchesRead] = await Promise.all([
    // Paginado: con una sola petición sólo se veían los proveedores y estados
    // de las primeras 1.000 consultas.
    fetchAllPages<OptionLogRow>(
      (from, to) =>
        admin
          .from('provider_usage_logs')
          .select('provider_key, status, triggered_by')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PageResult<OptionLogRow>,
    ),
    fetchAllRuns(admin),
    usersQuery,
    admin.from('roles').select('id, key, name'),
    admin.from('organization_groups').select('id, name, parent_group_id'),
    // Países con alguna búsqueda (sólo la columna: es barato).
    fetchAllPages<OptionBatchRow>(
      (from, to) =>
        admin
          .from('prospect_batches')
          .select('country_code')
          .order('id', { ascending: true })
          .range(from, to) as unknown as PageResult<OptionBatchRow>,
    ),
  ]);
  if (logsRead.error) throw new UsageReadError('provider_usage_logs', logsRead.error);
  if (runsRead.error) throw new UsageReadError('agent_runs', runsRead.error);

  const logs = logsRead.rows;
  const runs = runsRead.rows;
  const internalUsers = usersResult.data ?? [];
  const roles = rolesResult.data ?? [];
  const orgGroups = groupsResult.data ?? [];

  const providers = [...new Set(logs.map((l) => l.provider_key))].sort();
  // Un solo vocabulario en el filtro: «Correcto» (success) y «Completado»
  // (completed) son la misma opción; ver usage-filter-semantics.ts.
  const statuses = [
    ...new Set([...logs.map((l) => l.status), ...runs.map((r) => r.status)].map(canonicalStatusKey)),
  ].sort();

  // Mismo vocabulario que la tabla «Por agente» (agent1, agent2a…): el Agente 1
  // actual no crea ejecuciones, así que ofrecer las claves de agent_runs dejaba
  // fuera casi todo su gasto al filtrar.
  const agentMap = new Map<string, string | null>(
    Object.entries(AGENT_DIMENSION_LABELS).map(([key, label]) => [key, label]),
  );
  for (const r of runs) {
    const key = agentKeyFromRunKey(r.agent_key) ?? r.agent_key;
    if (!agentMap.has(key)) agentMap.set(key, r.agent_name ?? null);
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
    countries: distinctCountries(batchesRead.rows),
    industries: [...MACRO_INDUSTRY_KEYS],
    steps: Object.keys(AGENT_STEP_LABELS),
    // Todas las formas que escribe la 149 (competidores, proveedores, árbol…).
    modes: Object.keys(SEARCH_MODE_LABELS),
  };
}

// ============================================================
// Cifras de la página — todas desde el mismo universo filtrado
//
// Dinero: SÓLO provider_usage_logs (ver usage-aggregators.ts). Un fallo de
// lectura lanza UsageReadError; nunca devuelve una lista vacía que parezca
// «sin consumo».
// ============================================================

export async function getProviderStats(
  filters: UsageFilters = {},
): Promise<ProviderStat[] | null> {
  const prepared = await prepareAccess(filters);
  if (prepared.kind === 'denied') return null;
  if (prepared.kind === 'empty') return [];
  const data = await loadUsageDataset(prepared.admin, filters, prepared.userScope, dimensionFiltersOf(filters));
  return aggregateProviderStats(data.logsInScope);
}

export type { UserConsumptionRow } from './usage-aggregators';

async function readPeople(
  admin: AdminClient,
  ids: string[] | null,
  onlyActive: boolean,
): Promise<UsagePerson[]> {
  const build = (chunk: string[] | null) => (from: number, to: number) => {
    let query = admin.from('internal_users').select('id, full_name, email');
    if (onlyActive) query = query.eq('access_status', ACTIVE_USER_STATUS);
    if (chunk) query = query.in('id', chunk);
    return query.order('id', { ascending: true }).range(from, to) as unknown as PageResult<UsagePerson>;
  };
  const read =
    ids === null
      ? await fetchAllPages<UsagePerson>(build(null))
      : await fetchAllPagesInChunks<string, UsagePerson>(ids, IN_FILTER_CHUNK_SIZE, build);
  if (read.error) throw new UsageReadError('internal_users', read.error);
  return read.rows;
}

async function buildUserConsumption(
  admin: AdminClient,
  userScope: UserScope,
  data: UsageDataset,
): Promise<UserConsumptionRow[]> {
  // Plantilla: personas activas del ámbito (también las que están en cero).
  const activeUsers = await readPeople(
    admin,
    userScope.mode === 'ids' ? userScope.ids : null,
    true,
  );
  // Quien consumió sin ser persona activa (p. ej. suspendida) también sale,
  // para que ningún costo real desaparezca.
  const activeIds = new Set(activeUsers.map((u) => u.id));
  const otherIds = consumerIds(data.runsInScope, data.logsInScope).filter((id) => !activeIds.has(id));
  const otherUsers = otherIds.length > 0 ? await readPeople(admin, otherIds, false) : [];
  return aggregateUserConsumption(data.runsInScope, data.logsInScope, activeUsers, otherUsers);
}

// ============================================================
// getAiUsageOverview — todo lo de /ai-usage con UNA lectura
//
// Lee el universo una vez y deriva KPIs, agentes, proveedores y personas de
// las mismas filas, así los totales cuadran entre sí. No lanza: un fallo de
// lectura vuelve como dataQuality.readError para que la página lo diga.
// ============================================================

export interface UsageDataQuality {
  /** Había más filas que el tope de seguridad: las cifras pueden quedarse cortas. */
  truncated: boolean;
  /** Alguna lectura falló: las cifras mostradas no son fiables. */
  readError: boolean;
}

/** Una de las últimas consultas, con las dimensiones de la fase 2. */
export type RecentUsageLog = ProviderUsageLog & {
  agent_key: string | null;
  agent_step: string | null;
  country_code: string | null;
  macro_industry_key: string | null;
  search_mode: string | null;
};

export interface AiUsageOverview {
  summary: AiUsageSummary;
  agentStats: AgentStat[];
  providerStats: ProviderStat[];
  userConsumption: UserConsumptionRow[];
  recentLogs: RecentUsageLog[];
  /** «Por agente»: cada agente y cada uno de sus pasos. */
  agentSteps: { agents: AgentSummaryRow[]; steps: AgentStepRow[] };
  /** false ⇒ quien mira no ve dólares: todos los importes llegan vacíos. */
  moneyVisible: boolean;
  /** false ⇒ la migración 147 aún no está aplicada (dimensiones calculadas en memoria). */
  dimensionsAvailable: boolean;
  dataQuality: UsageDataQuality;
}

function emptyOverview(dataQuality: UsageDataQuality, moneyVisible: boolean): AiUsageOverview {
  return {
    summary: emptySummary(),
    agentStats: [],
    providerStats: [],
    userConsumption: [],
    recentLogs: [],
    agentSteps: { agents: [], steps: [] },
    moneyVisible,
    dimensionsAvailable: true,
    dataQuality,
  };
}

/** Clave estable de unos filtros (para la caché por petición). */
export function usageFiltersKey(filters: UsageFilters): string {
  const entries = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

export type UsageContext =
  | { kind: 'denied' }
  | { kind: 'access_error' }
  | { kind: 'empty'; moneyVisible: boolean }
  | { kind: 'read_error'; moneyVisible: boolean }
  | {
      kind: 'ready';
      admin: AdminClient;
      userScope: UserScope;
      moneyVisible: boolean;
      data: UsageDataset;
    };

/**
 * Acceso + universo filtrado, UNA vez por petición: la página y las pestañas
 * que cargan aparte (Suspense) comparten la misma lectura.
 */
export const loadUsageContext = cache(async (key: string): Promise<UsageContext> => {
  const filters = JSON.parse(key) as UsageFilters;
  let prepared: PreparedAccess;
  try {
    prepared = await prepareAccess(filters);
  } catch (err) {
    console.error('[ai-usage] access check failed:', err);
    return { kind: 'access_error' };
  }
  if (prepared.kind !== 'ready') return prepared;
  try {
    const data = await loadUsageDataset(
      prepared.admin,
      filters,
      prepared.userScope,
      dimensionFiltersOf(filters),
    );
    return { ...prepared, data };
  } catch (err) {
    // El detalle queda en el servidor; la página muestra un aviso genérico.
    console.error('[ai-usage] usage read failed:', err);
    return { kind: 'read_error', moneyVisible: prepared.moneyVisible };
  }
});

/** Las `limit` consultas más nuevas del universo, con todas sus columnas. */
async function readRecentFromDataset(
  admin: AdminClient,
  data: UsageDataset,
  limit: number,
): Promise<RecentUsageLog[]> {
  const newest = data.logsInScope.slice(-limit).reverse();
  const ids = newest.map((l) => l.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const { data: rows, error } = await admin.from('provider_usage_logs').select('*').in('id', ids);
  if (error) throw new UsageReadError('provider_usage_logs', error.message);
  const byId = new Map((rows ?? []).map((r) => [r.id as string, r as ProviderUsageLog]));
  return newest.flatMap((log: DimensionedLogRow) => {
    const row = log.id ? byId.get(log.id) : undefined;
    if (!row) return [];
    return [
      {
        ...row,
        agent_key: log.agent_key,
        agent_step: log.agent_step,
        country_code: log.country_code,
        macro_industry_key: log.macro_industry_key,
        search_mode: log.search_mode,
      },
    ];
  });
}

function applyMoneyRule(overview: AiUsageOverview): AiUsageOverview {
  if (overview.moneyVisible) return overview;
  return {
    ...overview,
    summary: redactSummary(overview.summary),
    agentStats: redactAgentStats(overview.agentStats),
    providerStats: redactProviderStats(overview.providerStats),
    userConsumption: redactUserConsumption(overview.userConsumption),
    recentLogs: redactRecentLogs(overview.recentLogs),
    agentSteps: redactAgentSteps(overview.agentSteps),
  };
}

export async function getAiUsageOverview(
  filters: UsageFilters = {},
  recentLimit = 25,
): Promise<AiUsageOverview | null> {
  const context = await loadUsageContext(usageFiltersKey(filters));
  if (context.kind === 'denied' || context.kind === 'access_error') return null;
  if (context.kind === 'empty') {
    return emptyOverview({ truncated: false, readError: false }, context.moneyVisible);
  }
  if (context.kind === 'read_error') {
    return emptyOverview({ truncated: false, readError: true }, context.moneyVisible);
  }

  const { admin, userScope, data, moneyVisible } = context;
  try {
    const [userConsumption, recentLogs] = await Promise.all([
      buildUserConsumption(admin, userScope, data),
      readRecentFromDataset(admin, data, recentLimit),
    ]);
    return applyMoneyRule({
      summary: aggregateUsageSummary(data.runsInScope, data.logsInScope),
      agentStats: aggregateAgentStats(data.runsInScope, data.logsInScope, data.runsById),
      providerStats: aggregateProviderStats(data.logsInScope),
      userConsumption,
      recentLogs,
      agentSteps: aggregateAgentSteps(data.logsInScope),
      moneyVisible,
      dimensionsAvailable: data.dimensionsAvailable,
      dataQuality: { truncated: data.truncated, readError: false },
    });
  } catch (err) {
    console.error('[ai-usage] overview read failed:', err);
    return emptyOverview({ truncated: false, readError: true }, moneyVisible);
  }
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
  /** Known-credit subtotal only — see unknown_credit_operations before treating this as a complete total. */
  total_credits_used: number;
  /** How many aggregated rows have indeterminate credit consumption. */
  unknown_credit_operations: number;
  /** Convenience mirror of unknown_credit_operations > 0. */
  has_unknown_credits: boolean;
  /** Known-cost subtotal only — see has_unknown_cost before treating this as a complete total. */
  total_estimated_cost_usd: number;
  /** True when at least one aggregated row has estimated_cost_usd = NULL (unknown cost). */
  has_unknown_cost: boolean;
}

interface OperationLogRow {
  operation_key: string | null;
  status: string | null;
  credits_used: number | string | null;
  estimated_cost_usd: number | string | null;
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
      unknown_credit_operations: 0,
      has_unknown_credits: false,
      total_estimated_cost_usd: 0,
      has_unknown_cost: false,
    };

    existing.total_calls++;
    if (row.status === 'success') existing.success_calls++;
    else existing.error_calls++;

    // Known-credit subtotal only — a NULL row is indeterminate consumption,
    // never a hidden 0.
    const credits = resolveUsageCredits(row.credits_used);
    if (credits.state === 'unknown') {
      existing.unknown_credit_operations++;
      existing.has_unknown_credits = true;
    } else {
      existing.total_credits_used += credits.credits;
    }
    // Known-cost subtotal only — a NULL row is unknown cost, never a hidden 0.
    if (row.estimated_cost_usd == null) {
      existing.has_unknown_cost = true;
    } else {
      existing.total_estimated_cost_usd += Number(row.estimated_cost_usd);
    }

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
  const prepared = await prepareAccess(filters);
  if (prepared.kind === 'denied') return null;
  if (prepared.kind === 'empty') return [];

  // Mismo universo que getProviderStats, así el desglose y los KPIs describen
  // exactamente las mismas consultas. Un fallo de lectura lanza (UsageReadError)
  // para que provider-consumption-actions.ts muestre el aviso de error en vez
  // de un falso «Sin consumo por operación» (Q3F-8E).
  const data = await loadUsageDataset(prepared.admin, filters, prepared.userScope, dimensionFiltersOf(filters));
  return aggregateOperationStats(data.logsInScope);
}

// ============================================================
// getRecentProviderLogs — with filters
// ============================================================

async function readRecentProviderLogs(
  admin: AdminClient,
  limit: number,
  filters: UsageFilters,
  userScope: UserScope,
): Promise<ProviderUsageLog[]> {
  const scope = buildUsageScope(filters, userScope);
  // Agente y «estado sólo de ejecución» necesitan el mapa de ejecuciones.
  let runsById = new Map<string, UsageRunRow>();
  if (scope.agentKey || scope.status.logsByRunStatus) {
    const runsRead = await fetchAllRuns(admin);
    if (runsRead.error) throw new UsageReadError('agent_runs', runsRead.error);
    runsById = indexRunsById(runsRead.rows);
  }

  // De la más nueva a la más antigua, página a página, hasta tener `limit`
  // filas del ámbito.
  const read = await fetchAllPages<ProviderUsageLog>(
    (from, to) =>
      scopedLogsQuery(admin, scope, '*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to) as unknown as PageResult<ProviderUsageLog>,
    {
      keep: (row) =>
        selectLogsInScope([row as unknown as UsageLogRow], runsById, scope).length === 1,
      stopAfterKept: limit,
    },
  );
  if (read.error) throw new UsageReadError('provider_usage_logs', read.error);
  return read.rows;
}

export async function getRecentProviderLogs(
  limit = 25,
  filters: UsageFilters = {},
): Promise<ProviderUsageLog[] | null> {
  const prepared = await prepareAccess(filters);
  if (prepared.kind === 'denied') return null;
  if (prepared.kind === 'empty') return [];
  return readRecentProviderLogs(prepared.admin, limit, filters, prepared.userScope);
}

// ============================================================
// getProviderUserConsumption (Q3F-9) — per-user breakdown scoped to a
// single provider. Answers "who consumes THIS provider?" using
// provider_usage_logs as the sole metric source (never agent_runs, never a
// full active-user roster). Distinct from the /ai-usage team table
// (getAiUsageOverview), which covers every provider and includes the full
// active-user roster.
// ============================================================

export type ProviderScopedUsageFilters = UsageFilters & {
  provider: string;
};

export interface ProviderUserConsumptionRow {
  triggered_by: string | null;
  full_name: string | null;
  email: string | null;
  provider_calls: number;
  /** Known-credit subtotal only — see unknown_credit_operations before treating this as a complete total. */
  total_credits_used: number;
  /** How many aggregated rows have indeterminate credit consumption. */
  unknown_credit_operations: number;
  /** Convenience mirror of unknown_credit_operations > 0. */
  has_unknown_credits: boolean;
  /** Known-cost subtotal only — see has_unknown_cost before treating this as a complete total. */
  total_estimated_cost_usd: number;
  /** True when at least one aggregated row has estimated_cost_usd = NULL (unknown cost). */
  has_unknown_cost: boolean;
  last_activity_at: string | null;
}

interface ProviderUserLogRow {
  triggered_by: string | null;
  credits_used: number | string | null;
  estimated_cost_usd: number | string | null;
  created_at: string;
}

/**
 * Pure boundary helper — mirrors resolveOperationLogRowsOrThrow: a truthy
 * error always throws (so the caller's try/catch can classify it instead of
 * a silent, indistinguishable-from-real-empty "Sin consumo por usuario");
 * null/undefined data collapses to [] (a legitimate empty result).
 */
export function resolveProviderUserLogRowsOrThrow(
  data: ProviderUserLogRow[] | null | undefined,
  error: unknown,
): ProviderUserLogRow[] {
  if (error) throw error;
  return data ?? [];
}

// Internal-only Map key for rows with triggered_by === null. Never crosses
// the aggregator's return value — every returned row restores
// triggered_by: null verbatim.
const UNATTRIBUTED_BUCKET_KEY = '__unattributed__';

/**
 * Pure aggregator — groups provider_usage_logs rows by triggered_by.
 * triggered_by === null is preserved as its own single bucket (unattributed
 * consumption); it is never dropped and never merged into a real user's
 * bucket. Zero-credit consumers are preserved (no credits/cost filtering).
 * Dependency-free so it is directly unit-testable.
 */
export function aggregateProviderUserConsumption(
  rows: ProviderUserLogRow[],
): ProviderUserConsumptionRow[] {
  const map = new Map<string, ProviderUserConsumptionRow>();

  for (const row of rows) {
    const key = row.triggered_by ?? UNATTRIBUTED_BUCKET_KEY;
    const existing: ProviderUserConsumptionRow = map.get(key) ?? {
      triggered_by: row.triggered_by,
      full_name: null,
      email: null,
      provider_calls: 0,
      total_credits_used: 0,
      unknown_credit_operations: 0,
      has_unknown_credits: false,
      total_estimated_cost_usd: 0,
      has_unknown_cost: false,
      last_activity_at: null,
    };

    // Known-cost subtotal only. A NULL estimated_cost_usd means unknown cost —
    // it is excluded from the sum (never coerced to 0) and flagged via
    // has_unknown_cost so total_estimated_cost_usd is never mislabeled as a
    // complete total.
    const rowHasUnknownCost = row.estimated_cost_usd == null;
    // Same rule for credits: NULL is indeterminate consumption, not zero.
    const credits = resolveUsageCredits(row.credits_used);
    const updated: ProviderUserConsumptionRow = {
      ...existing,
      provider_calls: existing.provider_calls + 1,
      total_credits_used:
        credits.state === 'known'
          ? existing.total_credits_used + credits.credits
          : existing.total_credits_used,
      unknown_credit_operations:
        credits.state === 'unknown'
          ? existing.unknown_credit_operations + 1
          : existing.unknown_credit_operations,
      has_unknown_credits: existing.has_unknown_credits || credits.state === 'unknown',
      total_estimated_cost_usd: rowHasUnknownCost
        ? existing.total_estimated_cost_usd
        : existing.total_estimated_cost_usd + Number(row.estimated_cost_usd),
      has_unknown_cost: existing.has_unknown_cost || rowHasUnknownCost,
      last_activity_at:
        !existing.last_activity_at || row.created_at > existing.last_activity_at
          ? row.created_at
          : existing.last_activity_at,
    };

    map.set(key, updated);
  }

  return Array.from(map.values());
}

/**
 * Canonical sort (Q3F-9) — total_credits_used DESC, then
 * total_estimated_cost_usd DESC, then provider_calls DESC, then identity ASC
 * (full_name ?? email ?? triggered_by ?? ''). Fully deterministic; no
 * heuristic or IA-based ordering.
 */
export function sortProviderUserConsumptionRows(
  rows: ProviderUserConsumptionRow[],
): ProviderUserConsumptionRow[] {
  return [...rows].sort((a, b) => {
    if (b.total_credits_used !== a.total_credits_used) {
      return b.total_credits_used - a.total_credits_used;
    }
    if (b.total_estimated_cost_usd !== a.total_estimated_cost_usd) {
      return b.total_estimated_cost_usd - a.total_estimated_cost_usd;
    }
    if (b.provider_calls !== a.provider_calls) {
      return b.provider_calls - a.provider_calls;
    }
    const aIdentity = a.full_name ?? a.email ?? a.triggered_by ?? '';
    const bIdentity = b.full_name ?? b.email ?? b.triggered_by ?? '';
    return aIdentity.localeCompare(bIdentity);
  });
}

export async function getProviderUserConsumption(
  filters: ProviderScopedUsageFilters,
): Promise<ProviderUserConsumptionRow[] | null> {
  if (!filters.provider || !filters.provider.trim()) {
    throw new TypeError('getProviderUserConsumption requires filters.provider');
  }

  const prepared = await prepareAccess(filters);
  if (prepared.kind === 'denied') return null;
  if (prepared.kind === 'empty') return [];

  // Mismo universo que getProviderStats / getProviderOperationStats (el filtro
  // de proveedor es obligatorio aquí). Un fallo de lectura lanza para que el
  // llamador lo clasifique en vez de un falso «Sin consumo por usuario».
  const data = await loadUsageDataset(prepared.admin, filters, prepared.userScope, dimensionFiltersOf(filters));
  const aggregated = aggregateProviderUserConsumption(data.logsInScope);

  const uniqueIds = [
    ...new Set(
      aggregated.map((r) => r.triggered_by).filter((id): id is string => id !== null),
    ),
  ];

  let enriched = aggregated;
  if (uniqueIds.length > 0) {
    const users = await readPeople(prepared.admin, uniqueIds, false);
    const userMap = new Map(users.map((u) => [u.id, u]));

    enriched = aggregated.map((row) => {
      if (row.triggered_by === null) return row;
      const u = userMap.get(row.triggered_by);
      if (!u) return row;
      return { ...row, full_name: u.full_name, email: u.email };
    });
  }

  return sortProviderUserConsumptionRows(enriched);
}
