// ============================================================
// /ai-usage — quién ve dólares (decisión de la dueña, 13-10)
//
//   - Administración y líderes / managers comerciales: ven USD.
//   - Vendedores (y cualquier rol desconocido): sólo créditos y unidades.
//
// La regla se aplica en el SERVIDOR, sobre el resultado de la consulta: a quien
// no ve dinero no le llega ni un importe (no basta con esconder la columna).
// Puro: sin cliente de Supabase.
// ============================================================

import type { AgentStat, AiUsageSummary, ProviderStat, ProviderUsageLog } from '@/modules/usage-tracking/types';
import { classifyRole } from '@/modules/access/commercial-scope-logic';
import type { UserConsumptionRow } from './usage-aggregators';
import type {
  AgentStepRow,
  AgentSummaryRow,
  CountryToolRow,
  PersonUsageRow,
  RoleGroupRow,
  SearchBatchRow,
} from './usage-breakdowns';

/**
 * ¿Ve dólares quien mira? `viewAll` es el acceso total (administración); si no,
 * decide su rol: líder / manager sí, el resto no.
 */
export function canSeeMoney(input: { viewAll: boolean; roleKey: string | null }): boolean {
  if (input.viewAll) return true;
  const roleClass = classifyRole(input.roleKey, false);
  return roleClass === 'admin' || roleClass === 'team';
}

export function redactSummary(summary: AiUsageSummary): AiUsageSummary {
  return { ...summary, total_estimated_cost_usd: 0, has_unknown_cost: false, avg_cost_per_run: null };
}

export function redactAgentStats(rows: readonly AgentStat[]): AgentStat[] {
  return rows.map((r) => ({ ...r, total_estimated_cost_usd: 0, has_unknown_cost: false }));
}

export function redactProviderStats(rows: readonly ProviderStat[]): ProviderStat[] {
  return rows.map((r) => ({
    ...r,
    total_estimated_cost_usd: 0,
    has_unknown_cost: false,
    unknown_cost_operations: 0,
  }));
}

export function redactUserConsumption(rows: readonly UserConsumptionRow[]): UserConsumptionRow[] {
  return rows.map((r) => ({ ...r, estimated_cost_usd: 0, has_unknown_cost: false }));
}

/**
 * La metadata de un log puede llevar precios: a quien no ve dinero sólo le llega
 * el estado de facturación de los créditos (qué se sabe de su consumo).
 */
export function redactRecentLogs<T extends ProviderUsageLog>(rows: readonly T[]): T[] {
  return rows.map((r) => {
    const correlation = r.metadata?.['run_correlation'];
    const billingState =
      correlation && typeof correlation === 'object'
        ? (correlation as Record<string, unknown>)['billing_state']
        : undefined;
    return {
      ...r,
      estimated_cost_usd: null,
      real_cost_usd: null,
      metadata: billingState === undefined ? {} : { run_correlation: { billing_state: billingState } },
    };
  });
}

export function redactAgentSteps(input: { agents: AgentSummaryRow[]; steps: AgentStepRow[] }) {
  return {
    agents: input.agents.map((r) => ({ ...r, costUsd: null, hasUnknownCost: false })),
    steps: input.steps.map((r) => ({ ...r, costUsd: null, hasUnknownCost: false, costPerResultUsd: null })),
  };
}

export function redactCountryTools(rows: readonly CountryToolRow[]): CountryToolRow[] {
  return rows.map((r) => ({ ...r, costUsd: null, hasUnknownCost: false, costPerApprovedUsd: null }));
}

export function redactRoleGroups<T extends RoleGroupRow | PersonUsageRow>(rows: readonly T[]): T[] {
  return rows.map((r) => ({ ...r, costUsd: null, hasUnknownCost: false, costPerApprovedUsd: null }));
}

export function redactSearchBatches(rows: readonly SearchBatchRow[]): SearchBatchRow[] {
  return rows.map((r) => ({
    ...r,
    costByStep: {},
    totalCostUsd: null,
    hasUnknownCost: false,
    costPerApprovedUsd: null,
  }));
}
