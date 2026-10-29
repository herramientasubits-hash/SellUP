/**
 * «Mapa de uso» — contrato RUNTIME del mapa de calor: columnas del grupo elegido +
 * Total, secciones plegables, celdas con su cifra y la fila de costo sólo con dinero.
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
import type { UsageMapInput } from '@/modules/ai-usage/usage-map';
import type { DimensionedLogRow } from '@/modules/ai-usage/usage-dimension-scope';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let heatmap: typeof import('../usage-heatmap');
let usageMap: typeof import('@/modules/ai-usage/usage-map');

const h = React.createElement;

function log(over: Partial<DimensionedLogRow>): DimensionedLogRow {
  return {
    agent_run_id: null, provider_key: 'apollo', operation_key: null, status: 'success', triggered_by: 'ana',
    credits_used: 1, input_tokens: null, output_tokens: null, results_returned: null, estimated_cost_usd: 0.5,
    created_at: '2026-10-27T15:00:00.000Z', batch_id: 'b1', agent_key: 'agent1', agent_step: null,
    country_code: 'CO', macro_industry_key: null, search_mode: null, triggered_by_role_key: null,
    triggered_by_group_id: null, log_flow: null, found: null, ...over,
  };
}

function input(moneyVisible: boolean): UsageMapInput {
  const batches = [{ id: 'b1', created_by: 'ana', country_code: 'CO' }];
  return {
    logs: [log({}), log({ triggered_by: 'beto' })],
    outcomes: [{ batchId: 'b1', countryCode: 'CO', approved: true }],
    searches: batches,
    batchesById: new Map(batches.map((b) => [b.id, b])),
    people: [
      { id: 'ana', roleKey: 'vendedor', groupId: 'g1', managerId: null },
      { id: 'beto', roleKey: 'growth', groupId: 'g1', managerId: null },
    ],
    moneyVisible,
  };
}

const NAMES = { roleLabels: { vendedor: 'Vendedor', growth: 'Growth' }, groupNames: { g1: 'Mid Market' }, personNames: {} };

before(async () => {
  ({ render, screen, cleanup, fireEvent } = await import('@testing-library/react'));
  heatmap = await import('../usage-heatmap');
  usageMap = await import('@/modules/ai-usage/usage-map');
});
afterEach(() => cleanup());

describe('UsageHeatmap', () => {
  it('por rol: una columna por rol, más Total, y las celdas con su cifra', () => {
    render(h(heatmap.UsageHeatmap, { data: usageMap.buildUsageMap(input(true)), names: NAMES }));
    assert.ok(screen.getByRole('columnheader', { name: 'Total' }));
    assert.ok(screen.getByRole('columnheader', { name: 'Vendedor' }));
    assert.ok(screen.getByRole('columnheader', { name: 'Growth' }));
    assert.ok(screen.getByLabelText('Consultas a IA y proveedores · Vendedor: 1'));
    assert.ok(screen.getByText('Costo por aprobada'));
  });

  it('plegar una sección oculta sus métricas', () => {
    render(h(heatmap.UsageHeatmap, { data: usageMap.buildUsageMap(input(true)), names: NAMES }));
    assert.ok(screen.getByText('Empresas aprobadas'));
    fireEvent.click(screen.getByRole('button', { name: /Resultados/ }));
    assert.equal(screen.queryByText('Empresas aprobadas'), null);
  });

  it('sin dinero visible no hay sección de costo', () => {
    render(h(heatmap.UsageHeatmap, { data: usageMap.buildUsageMap(input(false)), names: NAMES }));
    assert.equal(screen.queryByText('Costo por aprobada'), null);
  });
});
