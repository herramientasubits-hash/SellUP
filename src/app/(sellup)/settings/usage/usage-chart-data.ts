// Los datos de los gráficos de «Configuración → Uso». Funciones puras sobre lo
// que la página ya tiene (el resumen real o los datos de ejemplo): solo deciden
// el nombre, el orden y el tono de cada parte. No se consulta ni se recalcula.

import type { BarListItem } from '@/components/charts/BarList';
import type { DistributionSegment } from '@/components/charts/DistributionBar';
import type { PieChartData } from '@/components/charts/PieChart';
import type { MockAgentStat, MockProviderStat } from '@/modules/usage-tracking/mock-data';
import type { UsageSummary } from '@/modules/usage-tracking/types';

/**
 * Las ejecuciones del resumen en tres tramos. «Demás» es lo que no está ni en
 * curso ni fallido; nunca baja de cero aunque los contadores lleguen descuadrados.
 */
export function agentRunSegments(summary: UsageSummary): DistributionSegment[] {
  const rest = Math.max(
    summary.total_agent_runs - summary.running_agent_runs - summary.failed_agent_runs,
    0,
  );
  return [
    { id: 'rest', label: 'Sin incidencias', value: rest, tone: 'positive', hint: 'completadas, pendientes o canceladas' },
    { id: 'running', label: 'En curso', value: summary.running_agent_runs, tone: 'brand' },
    { id: 'failed', label: 'Fallidas', value: summary.failed_agent_runs, tone: 'negative' },
  ];
}

/** Las consultas a proveedores, entre las que fallaron y las que no. */
export function providerCallSegments(summary: UsageSummary): DistributionSegment[] {
  const withoutError = Math.max(summary.total_provider_calls - summary.error_calls, 0);
  return [
    { id: 'ok', label: 'Sin error', value: withoutError, tone: 'positive' },
    { id: 'error', label: 'Con error', value: summary.error_calls, tone: 'negative' },
  ];
}

/** Datos de ejemplo: costo de cada agente con sus aprobados. */
export function mockAgentCostItems(agents: readonly MockAgentStat[]): BarListItem[] {
  return agents.map((agent) => ({
    id: agent.key,
    label: agent.name,
    value: agent.estimatedCostUsd,
    meta: `${agent.resultsApproved} ${agent.resultsApproved === 1 ? 'aprobado' : 'aprobados'}`,
  }));
}

/** Datos de ejemplo: reparto del costo entre los proveedores que cuestan algo. */
export function mockProviderCostData(providers: readonly MockProviderStat[]): PieChartData[] {
  return providers
    .filter((provider) => provider.estimatedCostUsd > 0)
    .map((provider) => ({ label: provider.name, value: provider.estimatedCostUsd }))
    .sort((a, b) => b.value - a.value);
}
