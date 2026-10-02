// Los datos de los gráficos de /ai-usage. Funciones puras: toman las filas que
// la página ya cargó y las ordenan para `BarList`, `DistributionBar` y
// `DonutChart`. Aquí no se consulta nada ni se recalcula un costo: solo se
// decide qué fila va a qué barra.

import type { BarListItem } from '@/components/charts/BarList';
import type { DistributionSegment } from '@/components/charts/DistributionBar';
import type { PieChartData } from '@/components/charts/PieChart';
import type { UserConsumptionRow } from '@/modules/ai-usage/queries';
import type { AgentStat, ProviderStat } from '@/modules/usage-tracking/types';
import { agentLabel, formatCount, providerLabel } from './usage-labels';

/** Un anillo se lee bien entre dos y ocho partes; fuera de ahí, mejor un ranking. */
export const DONUT_MIN_PARTS = 2;
export const DONUT_MAX_PARTS = 8;

/** Cuántas personas caben en un ranking antes de que deje de leerse. */
export const TEAM_RANKING_LIMIT = 8;

const COST_PRECISION = 10_000;

/** Quita el ruido de coma flotante sin perder los importes diminutos. */
function roundCost(usd: number): number {
  return Math.round(usd * COST_PRECISION) / COST_PRECISION;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

function personName(user: UserConsumptionRow): string {
  return user.full_name ?? user.email ?? user.triggered_by.slice(0, 8);
}

// ─── Resumen ──────────────────────────────────────────────────────────────────

/** Costo estimado de cada agente, con sus aprobados al lado. */
export function agentCostItems(agents: readonly AgentStat[]): BarListItem[] {
  return agents.map((agent) => ({
    id: agent.agent_key,
    label: agentLabel(agent.agent_key, agent.agent_name),
    value: roundCost(agent.total_estimated_cost_usd),
    meta: plural(agent.total_results_approved, 'aprobado', 'aprobados'),
  }));
}

/**
 * Cómo terminaron las ejecuciones de los agentes listados. «Otras» es lo que
 * no está ni completado ni fallido (en curso, pendientes, canceladas): nunca
 * baja de cero aunque los contadores lleguen descuadrados.
 */
export function executionOutcomeSegments(agents: readonly AgentStat[]): DistributionSegment[] {
  const completed = agents.reduce((sum, agent) => sum + agent.completed_executions, 0);
  const failed = agents.reduce((sum, agent) => sum + agent.failed_executions, 0);
  const total = agents.reduce((sum, agent) => sum + agent.total_executions, 0);
  const other = Math.max(total - completed - failed, 0);

  return [
    { id: 'completed', label: 'Completadas', value: completed, tone: 'positive' },
    { id: 'failed', label: 'Fallidas', value: failed, tone: 'negative' },
    { id: 'other', label: 'Otras', value: other, tone: 'neutral', hint: 'en curso, pendientes o canceladas' },
  ];
}

// ─── Proveedores ──────────────────────────────────────────────────────────────

/** Las partes del costo: solo proveedores con costo conocido mayor que cero, de mayor a menor. */
export function providerCostData(providers: readonly ProviderStat[]): PieChartData[] {
  return providers
    .filter((provider) => provider.total_estimated_cost_usd > 0)
    .map((provider) => ({
      label: providerLabel(provider.provider_key),
      value: roundCost(provider.total_estimated_cost_usd),
    }))
    .sort((a, b) => b.value - a.value);
}

/** El mismo reparto como ranking, para cuando un anillo no se leería. */
export function providerCostItems(providers: readonly ProviderStat[]): BarListItem[] {
  return providers
    .filter((provider) => provider.total_estimated_cost_usd > 0)
    .map((provider) => ({
      id: provider.provider_key,
      label: providerLabel(provider.provider_key),
      value: roundCost(provider.total_estimated_cost_usd),
    }));
}

/** ¿Hay alguna consulta sin tarifa? Entonces el reparto del costo es parcial. */
export function hasPartialProviderCost(providers: readonly ProviderStat[]): boolean {
  return providers.some((provider) => provider.has_unknown_cost);
}

/** Consultas hechas a cada proveedor, con los resultados que devolvió. */
export function providerCallItems(providers: readonly ProviderStat[]): BarListItem[] {
  return providers.map((provider) => ({
    id: provider.provider_key,
    label: providerLabel(provider.provider_key),
    value: provider.total_calls,
    meta: plural(provider.total_results_returned, 'resultado', 'resultados'),
    tone: provider.error_calls > 0 && provider.error_calls === provider.total_calls ? 'negative' : undefined,
  }));
}

// ─── Equipo ───────────────────────────────────────────────────────────────────

function activeUsers(users: readonly UserConsumptionRow[]): UserConsumptionRow[] {
  return users.filter((user) => user.executions + user.provider_calls > 0);
}

/** Quién gasta más. Quien no ha usado los agentes no entra en el ranking. */
export function teamCostItems(users: readonly UserConsumptionRow[]): BarListItem[] {
  return activeUsers(users).map((user) => ({
    id: user.triggered_by,
    label: personName(user),
    value: roundCost(user.estimated_cost_usd),
    meta: user.has_unknown_cost ? 'parcial' : undefined,
  }));
}

/** Quién usa más los agentes, con las consultas que provocó. */
export function teamExecutionItems(users: readonly UserConsumptionRow[]): BarListItem[] {
  return activeUsers(users).map((user) => ({
    id: user.triggered_by,
    label: personName(user),
    value: user.executions,
    meta: plural(user.provider_calls, 'consulta', 'consultas'),
  }));
}
