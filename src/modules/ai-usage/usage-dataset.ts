// ============================================================
// /ai-usage — lectura del universo filtrado (paginada, una sola regla para todo)
//
// Todas las cifras de la página salen de aquí:
//   - agent_runs completo (paginado): conteos, estados y el mapa
//     agent_run_id → agente. Se lee entero porque una consulta del periodo
//     puede pertenecer a una ejecución creada antes del periodo.
//   - provider_usage_logs del ámbito (paginado): TODO el dinero.
// Agente, «estado sólo de ejecución» y las dimensiones de la fase 3 (país,
// industria, paso y forma de búsqueda) se resuelven en memoria, con funciones
// puras (usage-aggregators.ts, usage-dimension-scope.ts).
//
// Migración 147: si sus columnas todavía no existen, la lectura lo detecta,
// vuelve a pedir sin ellas y las calcula en memoria con las mismas reglas
// (dimensionsAvailable = false). Desplegar antes de aplicar la 147 no rompe nada.
// ============================================================

import {
  fetchAllPages,
  fetchAllPagesInChunks,
  IN_FILTER_CHUNK_SIZE,
  type PaginatedReadResult,
} from '@/lib/supabase/paginated-read';
import { resolvePeriodStart, resolveStatusFilter } from './usage-filter-semantics';
import {
  indexRunsById,
  selectLogsInScope,
  selectRunsInScope,
  type UsageLogRow,
  type UsageRunRow,
  type UsageScope,
} from './usage-aggregators';
import {
  batchIdsNeedingDimensions,
  enrichLogDimensions,
  hasDimensionFilters,
  matchesDimensionFilters,
  type BatchDimensionRow,
  type DimensionedLogRow,
  type RawLogDimensions,
  type UsageDimensionFilters,
} from './usage-dimension-scope';
import type { AdminClient, UsageFilters, UserScope } from './queries';
import { agentKeyFromRunKey } from '@/modules/usage-tracking/usage-dimensions';

const RUN_COLUMNS =
  'id, agent_key, agent_name, status, triggered_by, created_at, results_generated, results_approved';

/** Columnas de las consultas que existen desde antes de la 147. */
export const LOG_BASE_COLUMNS =
  'id, agent_run_id, batch_id, provider_key, operation_key, status, triggered_by, triggered_by_role_key, ' +
  'triggered_by_group_id, credits_used, input_tokens, output_tokens, results_returned, estimated_cost_usd, ' +
  'created_at, log_flow:metadata->>flow, log_found:metadata->>found';

/** Columnas que añade la migración 147. */
export const LOG_DIMENSION_COLUMNS = 'agent_key, agent_step, country_code, macro_industry_key, search_mode';

/** País, forma y macro del lote, sin traer la metadata entera. */
const BATCH_DIMENSION_COLUMNS =
  'id, country_code, source, ' +
  'adt:metadata->apollo_discovery_taxonomy->>macro_industry_key, ' +
  'ccs:metadata->claude_company_search->>macro_industry_key, ' +
  'lro:metadata->lusha_run_observability->>macro_industry_key';

/** Un fallo de lectura: nunca se convierte en «no hubo consumo». */
export class UsageReadError extends Error {
  constructor(table: string, detail: string) {
    super(`ai-usage: no se pudo leer ${table}: ${detail}`);
    this.name = 'UsageReadError';
  }
}

export type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export type RawLogRow = UsageLogRow & RawLogDimensions;

/** ¿El error es «esa columna de la 147 no existe todavía»? */
export function isMissingDimensionColumnError(message: string | null): boolean {
  if (!message) return false;
  return (
    /does not exist|could not find|schema cache/i.test(message) &&
    /\b(agent_key|agent_step|country_code|macro_industry_key|search_mode)\b/.test(message)
  );
}

export function buildUsageScope(
  filters: UsageFilters,
  userScope: UserScope,
  dimensions: UsageDimensionFilters = {},
): UsageScope {
  return {
    since: resolvePeriodStart(filters.period),
    providerKey: filters.provider || undefined,
    // Vocabulario de la 147 (agent1, agent2a…); una URL vieja con la clave de
    // agent_runs (prospect_generation…) se traduce igual que el disparador.
    agentKey: agentKeyFromRunKey(filters.agent || null) ?? undefined,
    status: resolveStatusFilter(filters.status),
    userIds: userScope.mode === 'ids' ? userScope.ids : null,
    runsMustHaveLogs: hasDimensionFilters(dimensions),
  };
}

export function fetchAllRuns(admin: AdminClient) {
  return fetchAllPages<UsageRunRow>(
    (from, to) =>
      admin
        .from('agent_runs')
        .select(RUN_COLUMNS)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PageResult<UsageRunRow>,
  );
}

/**
 * Consultas del ámbito, con los filtros que la base de datos puede aplicar
 * (periodo, proveedor, estado del log, personas). El resto se aplica en
 * memoria en selectLogsInScope.
 */
export function scopedLogsQuery(admin: AdminClient, scope: UsageScope, columns: string) {
  let query = admin.from('provider_usage_logs').select(columns);
  if (scope.since) query = query.gte('created_at', scope.since);
  if (scope.providerKey) query = query.eq('provider_key', scope.providerKey);
  if (scope.status.logStatuses) query = query.in('status', scope.status.logStatuses);
  // Una lista de personas muy larga no cabe en la URL: entonces se filtra sólo
  // en memoria (selectLogsInScope), que aplica la misma regla.
  if (scope.userIds && scope.userIds.length <= IN_FILTER_CHUNK_SIZE) {
    query = query.in('triggered_by', scope.userIds);
  }
  return query;
}

async function fetchScopedLogs(
  admin: AdminClient,
  scope: UsageScope,
): Promise<{ read: PaginatedReadResult<RawLogRow>; dimensionsAvailable: boolean }> {
  const read = (columns: string) =>
    fetchAllPages<RawLogRow>(
      (from, to) =>
        scopedLogsQuery(admin, scope, columns)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PageResult<RawLogRow>,
    );
  const withDimensions = await read(`${LOG_BASE_COLUMNS}, ${LOG_DIMENSION_COLUMNS}`);
  if (!isMissingDimensionColumnError(withDimensions.error)) {
    return { read: withDimensions, dimensionsAvailable: true };
  }
  return { read: await read(LOG_BASE_COLUMNS), dimensionsAvailable: false };
}

interface RawBatchDimensionRow {
  id: string;
  country_code: string | null;
  source: string | null;
  adt: string | null;
  ccs: string | null;
  lro: string | null;
}

/** Lotes (sólo país, forma y macro) para completar consultas sin dimensiones. */
export async function readBatchDimensions(
  admin: AdminClient,
  ids: readonly string[],
): Promise<{ byId: Map<string, BatchDimensionRow>; truncated: boolean }> {
  if (ids.length === 0) return { byId: new Map(), truncated: false };
  const read = await fetchAllPagesInChunks<string, RawBatchDimensionRow>(ids, IN_FILTER_CHUNK_SIZE, (chunk) => (from, to) =>
    admin
      .from('prospect_batches')
      .select(BATCH_DIMENSION_COLUMNS)
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to) as unknown as PageResult<RawBatchDimensionRow>,
  );
  if (read.error) throw new UsageReadError('prospect_batches', read.error);
  const byId = new Map<string, BatchDimensionRow>();
  for (const row of read.rows) {
    byId.set(row.id, {
      id: row.id,
      country_code: row.country_code,
      source: row.source,
      metadata: {
        apollo_discovery_taxonomy: { macro_industry_key: row.adt },
        claude_company_search: { macro_industry_key: row.ccs },
        lusha_run_observability: { macro_industry_key: row.lro },
      },
    });
  }
  return { byId, truncated: read.truncated };
}

export interface UsageDataset {
  runsById: Map<string, UsageRunRow>;
  runsInScope: UsageRunRow[];
  logsInScope: DimensionedLogRow[];
  truncated: boolean;
  /** false ⇒ la 147 aún no está aplicada: las dimensiones se calcularon en memoria. */
  dimensionsAvailable: boolean;
}

export async function loadUsageDataset(
  admin: AdminClient,
  filters: UsageFilters,
  userScope: UserScope,
  dimensions: UsageDimensionFilters,
): Promise<UsageDataset> {
  const scope = buildUsageScope(filters, userScope, dimensions);
  const [runsRead, logs] = await Promise.all([fetchAllRuns(admin), fetchScopedLogs(admin, scope)]);
  if (runsRead.error) throw new UsageReadError('agent_runs', runsRead.error);
  if (logs.read.error) throw new UsageReadError('provider_usage_logs', logs.read.error);

  const runsById = indexRunsById(runsRead.rows);
  // El agente se filtra DESPUÉS de completar las dimensiones: una fila sin
  // agent_key escrito lo obtiene aquí con las reglas de la 147.
  const baseLogs = selectLogsInScope(logs.read.rows, runsById, { ...scope, agentKey: undefined });
  const batches = await readBatchDimensions(admin, batchIdsNeedingDimensions(baseLogs));
  const logsInScope = enrichLogDimensions(baseLogs, batches.byId, runsById).filter(
    (log) => matchesDimensionFilters(log, dimensions) && (!scope.agentKey || log.agent_key === scope.agentKey),
  );
  const runsInScope = selectRunsInScope(runsRead.rows, logsInScope, scope);
  return {
    runsById,
    runsInScope,
    logsInScope,
    truncated: runsRead.truncated || logs.read.truncated || batches.truncated,
    dimensionsAvailable: logs.dimensionsAvailable,
  };
}
