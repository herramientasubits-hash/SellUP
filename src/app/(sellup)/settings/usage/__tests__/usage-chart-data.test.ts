/**
 * Gráficos de «Configuración → Uso» — mapeo de datos: los tramos salen del
 * resumen recibido, nunca bajan de cero, y los datos de ejemplo se reparten
 * solo entre los proveedores que cuestan algo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { MockAgentStat, MockProviderStat } from '@/modules/usage-tracking/mock-data';
import type { UsageSummary } from '@/modules/usage-tracking/types';
import {
  agentRunSegments,
  mockAgentCostItems,
  mockProviderCostData,
  providerCallSegments,
} from '../usage-chart-data';

const SUMMARY: UsageSummary = {
  total_agent_runs: 20,
  running_agent_runs: 2,
  failed_agent_runs: 3,
  total_provider_calls: 50,
  total_estimated_cost_usd: 12,
  has_unknown_cost: false,
  error_calls: 4,
};

describe('agentRunSegments', () => {
  it('reparte las ejecuciones entre sin incidencias, en curso y fallidas', () => {
    assert.deepEqual(
      agentRunSegments(SUMMARY).map((segment) => [segment.label, segment.value, segment.tone]),
      [['Sin incidencias', 15, 'positive'], ['En curso', 2, 'brand'], ['Fallidas', 3, 'negative']],
    );
  });

  it('unos contadores descuadrados no producen un tramo negativo', () => {
    const segments = agentRunSegments({ ...SUMMARY, total_agent_runs: 4 });
    assert.equal(segments[0].value, 0);
  });
});

describe('providerCallSegments', () => {
  it('separa las consultas con error del resto', () => {
    assert.deepEqual(
      providerCallSegments(SUMMARY).map((segment) => [segment.label, segment.value]),
      [['Sin error', 46], ['Con error', 4]],
    );
  });

  it('sin consultas, los dos tramos quedan en cero (el gráfico dice el vacío)', () => {
    const segments = providerCallSegments({ ...SUMMARY, total_provider_calls: 0, error_calls: 0 });
    assert.deepEqual(segments.map((segment) => segment.value), [0, 0]);
  });
});

describe('datos de ejemplo', () => {
  const agentStat = (overrides: Partial<MockAgentStat>): MockAgentStat => ({
    key: 'a',
    name: 'Agente 1',
    executions: 3,
    estimatedCostUsd: 9.5,
    resultsGenerated: 10,
    resultsApproved: 1,
    effectivenessRate: 10,
    avgCostPerApproved: 9.5,
    status: 'active',
    ...overrides,
  });
  const providerStat = (overrides: Partial<MockProviderStat>): MockProviderStat => ({
    key: 'p',
    name: 'Apollo',
    operation: 'Búsqueda',
    calls: 3,
    estimatedCostUsd: 7.18,
    resultsReturned: 10,
    usefulResults: 5,
    effectivenessRate: 50,
    avgCostPerUsefulResult: 1.4,
    ...overrides,
  });

  it('cada agente es una barra con su costo y sus aprobados', () => {
    assert.deepEqual(mockAgentCostItems([agentStat({}), agentStat({ key: 'b', name: 'Agente 2', resultsApproved: 4 })]), [
      { id: 'a', label: 'Agente 1', value: 9.5, meta: '1 aprobado' },
      { id: 'b', label: 'Agente 2', value: 9.5, meta: '4 aprobados' },
    ]);
  });

  it('el reparto del costo deja fuera a los proveedores gratuitos y va de mayor a menor', () => {
    assert.deepEqual(
      mockProviderCostData([
        providerStat({ name: 'Lusha', estimatedCostUsd: 1.38 }),
        providerStat({ name: 'HubSpot', estimatedCostUsd: 0 }),
        providerStat({}),
      ]),
      [{ label: 'Apollo', value: 7.18 }, { label: 'Lusha', value: 1.38 }],
    );
  });
});
