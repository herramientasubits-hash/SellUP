/**
 * Gráficos de /ai-usage — contrato RUNTIME: lo que se pinta (orden, valores,
 * formato) sale de las filas recibidas; sin filas no se pinta gráfico; y el
 * porcentaje de efectividad es la barra del sistema (`Progress`).
 *
 * El anillo (ECharts) no se monta aquí: jsdom no tiene canvas. Se prueba el
 * mapeo de datos que lo alimenta y el ranking que lo sustituye.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/ruta?period=7d',
  pretendToBeVisual: true,
});
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
defineGlobal('window', dom.window);
defineGlobal('document', dom.window.document);
defineGlobal('navigator', dom.window.navigator);
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);
function copyWindowPropsToGlobal(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const source = dom.window as unknown as Record<string, unknown>;
  for (const prop of Object.getOwnPropertyNames(dom.window)) {
    if (prop in target) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, prop);
    if (descriptor) Object.defineProperty(target, prop, descriptor);
  }
}
copyWindowPropsToGlobal();


import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { UserConsumptionRow } from '@/modules/ai-usage/queries';
import type { AgentStat, ProviderStat } from '@/modules/usage-tracking/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let charts: typeof import('../usage-charts');
let data: typeof import('../usage-chart-data');
let meter: typeof import('../effectiveness-meter');

const h = React.createElement;

function agent(overrides: Partial<AgentStat>): AgentStat {
  return {
    agent_key: 'prospect_generation',
    agent_name: null,
    total_executions: 12,
    completed_executions: 9,
    failed_executions: 1,
    total_results_generated: 200,
    total_results_approved: 50,
    total_estimated_cost_usd: 10,
    last_run_at: null,
    ...overrides,
  };
}

function provider(overrides: Partial<ProviderStat>): ProviderStat {
  return {
    provider_key: 'apollo',
    total_calls: 30,
    success_calls: 30,
    error_calls: 0,
    total_credits_used: 30,
    unknown_credit_operations: 0,
    has_unknown_credits: false,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_results_returned: 120,
    total_estimated_cost_usd: 4.5,
    has_unknown_cost: false,
    last_used_at: null,
    ...overrides,
  };
}

function user(overrides: Partial<UserConsumptionRow>): UserConsumptionRow {
  return {
    triggered_by: 'user-1',
    full_name: 'Ana Ruiz',
    email: 'ana@example.test',
    executions: 4,
    provider_calls: 9,
    providers: ['apollo'],
    estimated_cost_usd: 2,
    has_unknown_cost: false,
    last_activity_at: null,
    ...overrides,
  };
}

function rowLabels(root: Element): string[] {
  return Array.from(root.querySelectorAll('li')).map((li) => li.querySelector('span')?.textContent ?? '');
}

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  charts = await import('../usage-charts');
  data = await import('../usage-chart-data');
  meter = await import('../effectiveness-meter');
});

afterEach(() => {
  cleanup();
});

describe('mapeo de datos — agentes', () => {
  it('cada agente es una barra con su costo y sus aprobados', () => {
    const items = data.agentCostItems([
      agent({}),
      agent({ agent_key: 'account_intelligence', total_estimated_cost_usd: 3.2, total_results_approved: 1 }),
    ]);
    assert.deepEqual(items, [
      { id: 'prospect_generation', label: 'Generación de prospectos', value: 10, meta: '50 aprobados' },
      { id: 'account_intelligence', label: 'Inteligencia de cuenta', value: 3.2, meta: '1 aprobado' },
    ]);
  });

  it('las ejecuciones se reparten en completadas, fallidas y otras, sumando los agentes', () => {
    const segments = data.executionOutcomeSegments([
      agent({}),
      agent({ agent_key: 'b', total_executions: 5, completed_executions: 5, failed_executions: 0 }),
    ]);
    assert.deepEqual(
      segments.map((segment) => [segment.id, segment.value]),
      [['completed', 14], ['failed', 1], ['other', 2]],
    );
  });

  it('unos contadores descuadrados no producen un tramo negativo', () => {
    const segments = data.executionOutcomeSegments([
      agent({ total_executions: 3, completed_executions: 4, failed_executions: 1 }),
    ]);
    assert.equal(segments.find((segment) => segment.id === 'other')?.value, 0);
  });
});

describe('mapeo de datos — proveedores', () => {
  const PROVIDERS = [
    provider({ provider_key: 'tavily', total_estimated_cost_usd: 1.1, total_calls: 80, total_results_returned: 1 }),
    provider({}),
    provider({ provider_key: 'hubspot', total_estimated_cost_usd: 0, total_calls: 5 }),
  ];

  it('el reparto del costo deja fuera a quien no costó y va de mayor a menor', () => {
    assert.deepEqual(data.providerCostData(PROVIDERS), [
      { label: 'Apollo', value: 4.5 },
      { label: 'Tavily', value: 1.1 },
    ]);
  });

  it('las consultas incluyen a todos los proveedores, con sus resultados', () => {
    assert.deepEqual(
      data.providerCallItems(PROVIDERS).map((item) => [item.label, item.value, item.meta]),
      [['Tavily', 80, '1 resultado'], ['Apollo', 30, '120 resultados'], ['HubSpot', 5, '120 resultados']],
    );
  });

  it('un proveedor cuyas consultas fallaron todas sale en tono de error', () => {
    const [item] = data.providerCallItems([provider({ total_calls: 4, error_calls: 4, success_calls: 0 })]);
    assert.equal(item.tone, 'negative');
  });

  it('avisa de reparto parcial solo cuando falta alguna tarifa', () => {
    assert.equal(data.hasPartialProviderCost(PROVIDERS), false);
    assert.equal(data.hasPartialProviderCost([provider({ has_unknown_cost: true })]), true);
  });
});

describe('mapeo de datos — equipo', () => {
  const USERS = [
    user({}),
    user({ triggered_by: 'user-2', full_name: null, email: 'leo@example.test', executions: 0, provider_calls: 0, estimated_cost_usd: 0 }),
    user({ triggered_by: 'user-3', full_name: 'Marta Gil', executions: 7, provider_calls: 1, estimated_cost_usd: 5, has_unknown_cost: true }),
  ];

  it('quien no ha usado los agentes no entra en el ranking', () => {
    assert.deepEqual(data.teamExecutionItems(USERS).map((item) => item.label), ['Ana Ruiz', 'Marta Gil']);
    assert.deepEqual(data.teamCostItems(USERS).map((item) => item.label), ['Ana Ruiz', 'Marta Gil']);
  });

  it('un costo con tarifas pendientes se marca como parcial', () => {
    assert.deepEqual(
      data.teamCostItems(USERS).map((item) => [item.value, item.meta]),
      [[2, undefined], [5, 'parcial']],
    );
  });
});

describe('AgentUsageCharts', () => {
  it('sin agentes no pinta nada (la tabla ya explica qué falta)', () => {
    const { container } = render(h(charts.AgentUsageCharts, { agents: [] }));
    assert.equal(container.firstChild, null);
  });

  it('ordena por costo y escribe el costo en dólares', () => {
    render(
      h(charts.AgentUsageCharts, {
        agents: [
          agent({ agent_key: 'account_intelligence', total_estimated_cost_usd: 3.2 }),
          agent({}),
        ],
      }),
    );
    const heading = screen.getByRole('heading', { name: 'Costo por agente' });
    const card = heading.closest('[data-slot="card"]');
    assert.ok(card);
    assert.deepEqual(rowLabels(card), ['Generación de prospectos', 'Inteligencia de cuenta']);
    assert.ok(screen.getByText('$10.00'));
    assert.ok(screen.getByText('$3.20'));
  });

  it('el reparto de ejecuciones lleva su resumen accesible con las cifras recibidas', () => {
    render(h(charts.AgentUsageCharts, { agents: [agent({})] }));
    assert.ok(screen.getByRole('heading', { name: 'Cómo terminaron las ejecuciones' }));
    const bar = screen.getByRole('img');
    assert.match(bar.getAttribute('aria-label') ?? '', /Completadas: 9, Fallidas: 1, Otras: 2/);
  });
});

describe('ProviderUsageCharts', () => {
  it('sin proveedores no pinta nada', () => {
    const { container } = render(h(charts.ProviderUsageCharts, { providers: [] }));
    assert.equal(container.firstChild, null);
  });

  it('con un solo proveedor con costo, el reparto es un ranking y no un anillo', () => {
    render(
      h(charts.ProviderUsageCharts, {
        providers: [provider({}), provider({ provider_key: 'hubspot', total_estimated_cost_usd: 0, total_calls: 5 })],
      }),
    );
    const costCard = screen.getByRole('heading', { name: 'De qué está hecho el costo' }).closest('[data-slot="card"]');
    assert.ok(costCard);
    assert.deepEqual(rowLabels(costCard), ['Apollo']);
    assert.ok(screen.getByText('$4.50'));

    const callsCard = screen.getByRole('heading', { name: 'Consultas por proveedor' }).closest('[data-slot="card"]');
    assert.ok(callsCard);
    assert.deepEqual(rowLabels(callsCard), ['Apollo', 'HubSpot']);
  });

  it('si falta alguna tarifa lo dice junto al reparto', () => {
    render(h(charts.ProviderUsageCharts, { providers: [provider({ has_unknown_cost: true })] }));
    assert.ok(screen.getByText(/Falta la tarifa de alguna consulta/));
  });
});

describe('TeamUsageCharts', () => {
  it('sin nadie con actividad no pinta nada', () => {
    const { container } = render(
      h(charts.TeamUsageCharts, { users: [user({ executions: 0, provider_calls: 0 })] }),
    );
    assert.equal(container.firstChild, null);
  });

  it('ordena a las personas por ejecuciones y por costo, cada ranking por su dato', () => {
    render(
      h(charts.TeamUsageCharts, {
        users: [
          user({}),
          user({ triggered_by: 'user-3', full_name: 'Marta Gil', executions: 7, estimated_cost_usd: 0.5 }),
        ],
      }),
    );
    const usage = screen.getByRole('heading', { name: 'Quién usa más los agentes' }).closest('[data-slot="card"]');
    const cost = screen.getByRole('heading', { name: 'Quién consume más' }).closest('[data-slot="card"]');
    assert.ok(usage && cost);
    assert.deepEqual(rowLabels(usage), ['Marta Gil', 'Ana Ruiz']);
    assert.deepEqual(rowLabels(cost), ['Ana Ruiz', 'Marta Gil']);
  });
});

describe('EffectivenessMeter', () => {
  it('es la barra del sistema, con nombre accesible y la cifra escrita', () => {
    render(h(meter.EffectivenessMeter, { pct: 25, label: 'Efectividad de Apollo' }));
    const bar = screen.getByRole('progressbar', { name: 'Efectividad de Apollo' });
    assert.equal(bar.getAttribute('aria-valuenow'), '25');
    assert.ok(screen.getByText('25.0%'));
  });

  it('un porcentaje por encima de 100 no desborda la barra pero se escribe tal cual', () => {
    render(h(meter.EffectivenessMeter, { pct: 140, label: 'Efectividad' }));
    assert.equal(screen.getByRole('progressbar').getAttribute('aria-valuenow'), '100');
    assert.ok(screen.getByText('140.0%'));
  });

  it('el color sigue los umbrales: bien, regular, mal', () => {
    assert.equal(meter.effectivenessColor(80), 'success');
    assert.equal(meter.effectivenessColor(50), 'primary');
    assert.equal(meter.effectivenessColor(49.9), 'warning');
  });
});
