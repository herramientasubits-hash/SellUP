// ============================================================
// /ai-usage — agregados puros (sin cliente de Supabase)
//
// UNA SOLA FUENTE DE DINERO: todo importe sale de provider_usage_logs.
// agent_runs sólo aporta conteos (ejecuciones, generados, aprobados), estados
// y el mapa agent_run_id → agente.
//
// Por qué: el costo que prospect-generation escribe en
// agent_runs.estimated_cost_usd ES la suma de los logs de esa ejecución. Sumar
// los dos (como hacía «Consumo por persona») cuenta el mismo dinero dos veces.
// Y una ejecución con costo pero sin ningún log NO se suma: su costo no tiene
// respaldo en el registro de consultas, y mezclarlo rompería la igualdad entre
// el KPI, la tabla de proveedores, la de agentes y la de personas.
// ============================================================

import type { AgentStat, AiUsageSummary, ProviderStat } from '@/modules/usage-tracking/types';
import { resolveUsageCredits } from '@/modules/usage-tracking/credits-display';
import type { StatusFilterResolution } from './usage-filter-semantics';

export interface UsageRunRow {
  id: string;
  agent_key: string;
  agent_name: string | null;
  status: string;
  triggered_by: string | null;
  created_at: string;
  results_generated: number | null;
  results_approved: number | null;
  /** Sólo informativo: NUNCA entra en un total de dinero (ver cabecera). */
  estimated_cost_usd?: number | string | null;
}

export interface UsageLogRow {
  id?: string;
  agent_run_id: string | null;
  provider_key: string;
  operation_key: string | null;
  status: string;
  triggered_by: string | null;
  credits_used: number | string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  results_returned: number | null;
  estimated_cost_usd: number | string | null;
  created_at: string;
}

/** Ámbito ya resuelto de los filtros de la página. */
export interface UsageScope {
  /** Límite inferior ISO del periodo; null = sin límite. */
  since: string | null;
  providerKey?: string;
  agentKey?: string;
  status: StatusFilterResolution;
  /** Personas (persona ∩ rol ∩ grupo ∩ alcance comercial); null = sin restricción. */
  userIds: string[] | null;
  /**
   * true ⇒ una ejecución cuenta sólo si alguna de sus consultas está en el
   * ámbito (lo usan los filtros que sólo existen en las consultas: país,
   * industria, paso y forma de búsqueda). El filtro de Proveedor ya lo implica.
   */
  runsMustHaveLogs?: boolean;
}

/** Cubeta de las consultas que no pertenecen a ninguna ejecución de agente. */
export const UNATTRIBUTED_AGENT_KEY = 'sin_agente';

export function indexRunsById(runs: readonly UsageRunRow[]): Map<string, UsageRunRow> {
  return new Map(runs.map((r) => [r.id, r]));
}

function inUserScope(triggeredBy: string | null, userIds: string[] | null): boolean {
  if (userIds === null) return true;
  return triggeredBy !== null && userIds.includes(triggeredBy);
}

/**
 * Consultas dentro del ámbito. Periodo, proveedor, estado y personas también
 * se aplican en la base de datos; repetirlos aquí es inocuo y mantiene la regla
 * en un solo sitio comprobable. Agente y «estado sólo de ejecución» se resuelven
 * aquí, por agent_run_id: provider_usage_logs no tiene agent_key.
 */
export function selectLogsInScope<T extends UsageLogRow>(
  logs: readonly T[],
  runsById: ReadonlyMap<string, UsageRunRow>,
  scope: UsageScope,
): T[] {
  const { since, providerKey, agentKey, status, userIds } = scope;
  return logs.filter((l) => {
    if (since && l.created_at < since) return false;
    if (providerKey && l.provider_key !== providerKey) return false;
    if (status.logStatuses && !status.logStatuses.includes(l.status)) return false;
    if (!inUserScope(l.triggered_by, userIds)) return false;

    const needsRun = Boolean(agentKey) || status.logsByRunStatus;
    if (!needsRun) return true;
    const run = l.agent_run_id ? runsById.get(l.agent_run_id) : undefined;
    if (!run) return false;
    if (agentKey && run.agent_key !== agentKey) return false;
    if (status.logsByRunStatus && status.runStatuses && !status.runStatuses.includes(run.status)) {
      return false;
    }
    return true;
  });
}

/**
 * Ejecuciones dentro del ámbito. Con filtro de Proveedor (o con un filtro que
 * sólo existe en las consultas), una ejecución cuenta sólo si alguna de sus
 * consultas está en el ámbito.
 */
export function selectRunsInScope(
  runs: readonly UsageRunRow[],
  logsInScope: readonly UsageLogRow[],
  scope: UsageScope,
): UsageRunRow[] {
  const { since, providerKey, agentKey, status, userIds } = scope;
  const runsWithProvider = providerKey || scope.runsMustHaveLogs
    ? new Set(logsInScope.map((l) => l.agent_run_id).filter((id): id is string => id !== null))
    : null;
  return runs.filter((r) => {
    if (since && r.created_at < since) return false;
    if (agentKey && r.agent_key !== agentKey) return false;
    if (status.runStatuses && !status.runStatuses.includes(r.status)) return false;
    if (!inUserScope(r.triggered_by, userIds)) return false;
    if (runsWithProvider && !runsWithProvider.has(r.id)) return false;
    return true;
  });
}

const LOG_ERROR_STATUSES = new Set(['error', 'rate_limited', 'quota_exceeded']);

/** Costo conocido de una fila; null = desconocido (nunca 0 fabricado). */
export function knownCost(value: number | string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function aggregateUsageSummary(
  runsInScope: readonly UsageRunRow[],
  logsInScope: readonly UsageLogRow[],
): AiUsageSummary {
  const runIds = new Set(runsInScope.map((r) => r.id));
  let total = 0;
  let attributedToRuns = 0;
  let hasUnknown = false;
  for (const l of logsInScope) {
    const cost = knownCost(l.estimated_cost_usd);
    if (cost === null) {
      hasUnknown = true;
      continue;
    }
    total += cost;
    if (l.agent_run_id && runIds.has(l.agent_run_id)) attributedToRuns += cost;
  }

  return {
    total_executions: runsInScope.length,
    running_executions: runsInScope.filter((r) => r.status === 'running').length,
    failed_executions: runsInScope.filter((r) => r.status === 'failed').length,
    total_provider_calls: logsInScope.length,
    error_provider_calls: logsInScope.filter((l) => LOG_ERROR_STATUSES.has(l.status)).length,
    total_estimated_cost_usd: total,
    has_unknown_cost: hasUnknown,
    distinct_providers: new Set(logsInScope.map((l) => l.provider_key)).size,
    // Costo medio por ejecución: sólo el costo de las consultas de esas
    // ejecuciones. Una consulta suelta (sin agent_run_id) no es de ninguna
    // ejecución y no debe inflar el promedio.
    avg_cost_per_run: runsInScope.length > 0 ? attributedToRuns / runsInScope.length : null,
  };
}

function newAgentStat(agentKey: string, agentName: string | null): AgentStat {
  return {
    agent_key: agentKey,
    agent_name: agentName,
    total_executions: 0,
    completed_executions: 0,
    failed_executions: 0,
    total_results_generated: 0,
    total_results_approved: 0,
    total_estimated_cost_usd: 0,
    has_unknown_cost: false,
    last_run_at: null,
  };
}

/**
 * Por agente: conteos desde las ejecuciones del ámbito; dinero desde las
 * consultas del ámbito, atribuidas por agent_run_id con el mapa de TODAS las
 * ejecuciones (una consulta del periodo puede ser de una ejecución anterior).
 */
export function aggregateAgentStats(
  runsInScope: readonly UsageRunRow[],
  logsInScope: readonly UsageLogRow[],
  allRunsById: ReadonlyMap<string, UsageRunRow>,
): AgentStat[] {
  const map = new Map<string, AgentStat>();
  const get = (key: string, name: string | null) => {
    const existing = map.get(key) ?? newAgentStat(key, name);
    map.set(key, existing);
    return existing;
  };

  for (const r of runsInScope) {
    const stat = get(r.agent_key, r.agent_name ?? null);
    stat.total_executions++;
    if (r.status === 'completed') stat.completed_executions++;
    if (r.status === 'failed') stat.failed_executions++;
    stat.total_results_generated += Number(r.results_generated ?? 0);
    stat.total_results_approved += Number(r.results_approved ?? 0);
    if (!stat.last_run_at || r.created_at > stat.last_run_at) stat.last_run_at = r.created_at;
  }

  for (const l of logsInScope) {
    const run = l.agent_run_id ? allRunsById.get(l.agent_run_id) : undefined;
    const stat = run
      ? get(run.agent_key, run.agent_name ?? null)
      : get(UNATTRIBUTED_AGENT_KEY, null);
    const cost = knownCost(l.estimated_cost_usd);
    if (cost === null) stat.has_unknown_cost = true;
    else stat.total_estimated_cost_usd += cost;
  }

  return Array.from(map.values()).sort(
    (a, b) => b.total_estimated_cost_usd - a.total_estimated_cost_usd,
  );
}

export function aggregateProviderStats(logsInScope: readonly UsageLogRow[]): ProviderStat[] {
  const map = new Map<string, ProviderStat>();

  for (const row of logsInScope) {
    const existing: ProviderStat = map.get(row.provider_key) ?? {
      provider_key: row.provider_key,
      total_calls: 0,
      success_calls: 0,
      error_calls: 0,
      total_credits_used: null,
      unknown_credit_operations: 0,
      has_unknown_credits: false,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_results_returned: 0,
      total_estimated_cost_usd: 0,
      has_unknown_cost: false,
      unknown_cost_operations: 0,
      last_used_at: null,
    };

    existing.total_calls++;
    if (row.status === 'success') existing.success_calls++;
    else existing.error_calls++;

    // Subtotal de créditos conocidos: un NULL es consumo indeterminado y se
    // cuenta como operación pendiente, nunca como cero confirmado.
    const credits = resolveUsageCredits(row.credits_used);
    if (credits.state === 'unknown') {
      existing.unknown_credit_operations++;
      existing.has_unknown_credits = true;
    } else {
      existing.total_credits_used = (existing.total_credits_used ?? 0) + credits.credits;
    }
    existing.total_input_tokens += Number(row.input_tokens ?? 0);
    existing.total_output_tokens += Number(row.output_tokens ?? 0);
    existing.total_results_returned += Number(row.results_returned ?? 0);
    // Subtotal de costo conocido: un NULL es «sin tarifa», nunca un 0 oculto.
    const cost = knownCost(row.estimated_cost_usd);
    if (cost === null) {
      existing.has_unknown_cost = true;
      existing.unknown_cost_operations = (existing.unknown_cost_operations ?? 0) + 1;
    } else {
      existing.total_estimated_cost_usd += cost;
    }

    if (!existing.last_used_at || row.created_at > existing.last_used_at) {
      existing.last_used_at = row.created_at;
    }

    map.set(row.provider_key, existing);
  }

  return Array.from(map.values()).sort(
    (a, b) => b.total_estimated_cost_usd - a.total_estimated_cost_usd,
  );
}

// ============================================================
// Consumo por persona
// ============================================================

export interface UserConsumptionRow {
  triggered_by: string;
  full_name: string | null;
  email: string | null;
  executions: number;
  provider_calls: number;
  /** Distinct provider keys used by this user within the active filters. */
  providers: string[];
  /** Known-cost subtotal only — see has_unknown_cost before treating this as a complete total. */
  estimated_cost_usd: number;
  /** True when at least one aggregated provider log has estimated_cost_usd = NULL (unknown cost). */
  has_unknown_cost: boolean;
  last_activity_at: string | null;
}

export interface UsagePerson {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface UserAgg {
  executions: number;
  provider_calls: number;
  providers: Set<string>;
  cost: number;
  hasUnknownCost: boolean;
  last_at: string | null;
}

function newAgg(): UserAgg {
  return {
    executions: 0,
    provider_calls: 0,
    providers: new Set(),
    cost: 0,
    hasUnknownCost: false,
    last_at: null,
  };
}

/** Ids de quienes tuvieron ejecuciones o consultas en el ámbito. */
export function consumerIds(
  runsInScope: readonly UsageRunRow[],
  logsInScope: readonly UsageLogRow[],
): string[] {
  const ids = new Set<string>();
  for (const r of runsInScope) if (r.triggered_by) ids.add(r.triggered_by);
  for (const l of logsInScope) if (l.triggered_by) ids.add(l.triggered_by);
  return [...ids];
}

/**
 * Una fila por persona activa (también en cero, para ver la adopción) más una
 * por cada id que consumió sin ser persona activa (p. ej. suspendida), para que
 * ningún costo real desaparezca. Sin tope de filas.
 */
export function aggregateUserConsumption(
  runsInScope: readonly UsageRunRow[],
  logsInScope: readonly UsageLogRow[],
  activeUsers: readonly UsagePerson[],
  otherUsers: readonly UsagePerson[] = [],
): UserConsumptionRow[] {
  const byUser = new Map<string, UserAgg>();
  const touch = (uid: string, at: string) => {
    const cur = byUser.get(uid) ?? newAgg();
    if (!cur.last_at || at > cur.last_at) cur.last_at = at;
    byUser.set(uid, cur);
    return cur;
  };

  // Ejecuciones: sólo cuentan. Su estimated_cost_usd NO se suma (ver cabecera).
  for (const r of runsInScope) {
    if (!r.triggered_by) continue;
    touch(r.triggered_by, r.created_at).executions++;
  }
  for (const l of logsInScope) {
    if (!l.triggered_by) continue;
    const cur = touch(l.triggered_by, l.created_at);
    cur.provider_calls++;
    if (l.provider_key) cur.providers.add(l.provider_key);
    const cost = knownCost(l.estimated_cost_usd);
    if (cost === null) cur.hasUnknownCost = true;
    else cur.cost += cost;
  }

  const toRow = (u: UsagePerson, agg: UserAgg | undefined): UserConsumptionRow => ({
    triggered_by: u.id,
    full_name: u.full_name,
    email: u.email,
    executions: agg?.executions ?? 0,
    provider_calls: agg?.provider_calls ?? 0,
    providers: agg ? [...agg.providers] : [],
    estimated_cost_usd: agg?.cost ?? 0,
    has_unknown_cost: agg?.hasUnknownCost ?? false,
    last_activity_at: agg?.last_at ?? null,
  });

  const activeIds = new Set(activeUsers.map((u) => u.id));
  const rows = activeUsers.map((u) => toRow(u, byUser.get(u.id)));

  const otherById = new Map(otherUsers.map((u) => [u.id, u]));
  for (const [id, agg] of byUser) {
    if (activeIds.has(id)) continue;
    const u = otherById.get(id) ?? { id, full_name: null, email: null };
    rows.push(toRow(u, agg));
  }

  // Primero quien consumió (por costo), luego quien no, por nombre.
  return rows.sort((a, b) => {
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
}
