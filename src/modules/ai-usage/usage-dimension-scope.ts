// ============================================================
// /ai-usage — las dimensiones nuevas de cada consulta (fase 2) en memoria
//
// La migración 147 escribe agent_key, agent_step, country_code,
// macro_industry_key y search_mode en provider_usage_logs. Mientras no esté
// aplicada (o en filas que aún no las tengan) la página calcula lo MISMO aquí,
// con el espejo TypeScript de la migración: el resultado no depende de si la
// 147 ya corrió.
//
// Puro: sin cliente de Supabase.
// ============================================================

import {
  completeAgentDimensions,
  resolveBatchDimensions,
  type BatchDimensionSource,
} from '@/modules/usage-tracking/usage-dimensions';
import type { UsageLogRow, UsageRunRow } from './usage-aggregators';

/** Filtros de la fase 3: país, industria (macro), paso del agente, forma de búsqueda. */
export interface UsageDimensionFilters {
  countryCode?: string;
  macroIndustryKey?: string;
  agentStep?: string;
  searchMode?: string;
}

/** Columnas de dimensión tal como llegan de la base (ausentes antes de la 147). */
export interface RawLogDimensions {
  batch_id?: string | null;
  agent_key?: string | null;
  agent_step?: string | null;
  country_code?: string | null;
  macro_industry_key?: string | null;
  search_mode?: string | null;
  triggered_by_role_key?: string | null;
  triggered_by_group_id?: string | null;
  /** metadata->>flow */
  log_flow?: string | null;
  /** metadata->>found ('true' / 'false') */
  log_found?: string | null;
}

/** Una consulta con todas sus dimensiones ya resueltas. */
export interface DimensionedLogRow extends UsageLogRow {
  batch_id: string | null;
  agent_key: string | null;
  agent_step: string | null;
  country_code: string | null;
  macro_industry_key: string | null;
  search_mode: string | null;
  triggered_by_role_key: string | null;
  triggered_by_group_id: string | null;
  log_flow: string | null;
  /** true / false si la consulta lo dice (p. ej. rescate_web); null si no. */
  found: boolean | null;
}

export type BatchDimensionRow = BatchDimensionSource & { id: string };

function parseFound(value: string | null | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * Completa cada consulta: lo que la base ya trae gana; lo que falta se calcula
 * con las mismas reglas que el disparador de la 147.
 */
export function enrichLogDimensions(
  logs: readonly (UsageLogRow & RawLogDimensions)[],
  batchesById: ReadonlyMap<string, BatchDimensionRow>,
  runsById: ReadonlyMap<string, UsageRunRow>,
): DimensionedLogRow[] {
  return logs.map((log) => {
    const batchId = log.batch_id ?? null;
    const run = log.agent_run_id ? runsById.get(log.agent_run_id) : undefined;
    const agent = completeAgentDimensions({
      providerKey: log.provider_key,
      operationKey: log.operation_key,
      flow: log.log_flow ?? null,
      agentKey: log.agent_key ?? null,
      agentStep: log.agent_step ?? null,
      runAgentKey: run?.agent_key ?? null,
    });
    const batch = resolveBatchDimensions(batchId ? batchesById.get(batchId) : null);
    return {
      ...log,
      batch_id: batchId,
      agent_key: agent.agentKey,
      agent_step: agent.agentStep,
      country_code: log.country_code ?? batch.countryCode,
      macro_industry_key: log.macro_industry_key ?? batch.macroIndustryKey,
      search_mode: log.search_mode ?? batch.searchMode,
      triggered_by_role_key: log.triggered_by_role_key ?? null,
      triggered_by_group_id: log.triggered_by_group_id ?? null,
      log_flow: log.log_flow ?? null,
      found: parseFound(log.log_found),
    };
  });
}

export function hasDimensionFilters(filters: UsageDimensionFilters): boolean {
  return Boolean(filters.countryCode || filters.macroIndustryKey || filters.agentStep || filters.searchMode);
}

/** ¿La consulta cumple los filtros de país, industria, paso y forma? */
export function matchesDimensionFilters(
  log: Pick<DimensionedLogRow, 'country_code' | 'macro_industry_key' | 'agent_step' | 'search_mode'>,
  filters: UsageDimensionFilters,
): boolean {
  if (filters.countryCode && log.country_code !== filters.countryCode) return false;
  if (filters.macroIndustryKey && log.macro_industry_key !== filters.macroIndustryKey) return false;
  if (filters.agentStep && log.agent_step !== filters.agentStep) return false;
  if (filters.searchMode && log.search_mode !== filters.searchMode) return false;
  return true;
}

/** Ids de lote que hace falta leer para completar las consultas sin dimensiones. */
export function batchIdsNeedingDimensions(logs: readonly (UsageLogRow & RawLogDimensions)[]): string[] {
  const ids = new Set<string>();
  for (const log of logs) {
    if (!log.batch_id) continue;
    if (log.country_code == null || log.macro_industry_key == null || log.search_mode == null) {
      ids.add(log.batch_id);
    }
  }
  return [...ids];
}

/** ¿El lote cumple los filtros de país, industria y forma? (el paso no aplica a un lote) */
export function batchMatchesDimensionFilters(
  batch: BatchDimensionSource,
  filters: UsageDimensionFilters,
): boolean {
  const dims = resolveBatchDimensions(batch);
  if (filters.countryCode && dims.countryCode !== filters.countryCode) return false;
  if (filters.macroIndustryKey && dims.macroIndustryKey !== filters.macroIndustryKey) return false;
  if (filters.searchMode && dims.searchMode !== filters.searchMode) return false;
  return true;
}
