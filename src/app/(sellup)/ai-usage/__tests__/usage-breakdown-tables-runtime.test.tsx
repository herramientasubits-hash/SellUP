/**
 * Pestañas nuevas de /ai-usage (por agente, país, rol/grupo y búsqueda) —
 * contrato RUNTIME con la DataTable real:
 *   - quien no ve dólares no ve ninguna columna de dinero (y el servidor ya se
 *     los quitó: aquí se comprueba que la tabla tampoco los pide);
 *   - las cifras y nombres se leen en lenguaje de negocio;
 *   - «Ver personas» pone el filtro en la URL y cada búsqueda abre su lote.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/ai-usage',
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
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub;
for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type {
  AgentStepRow,
  AgentSummaryRow,
  CountryToolRow,
  PersonUsageRow,
  RoleGroupRow,
  SearchBatchRow,
} from '@/modules/ai-usage/usage-breakdowns';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let agentSteps: typeof import('../agent-steps-table');
let countryTools: typeof import('../country-tools-table');
let roleGroups: typeof import('../role-group-tables');
let searches: typeof import('../search-batches-table');

const h = React.createElement;

const STEP: AgentStepRow = {
  id: 'agent1:rescate_web',
  agentKey: 'agent1',
  agentStep: 'rescate_web',
  calls: 10,
  errors: 1,
  credits: 0,
  unknownCreditCalls: 0,
  tokens: 12000,
  costUsd: 3,
  hasUnknownCost: false,
  resultMetric: 'webs_found',
  resultCount: 4,
  costPerResultUsd: 0.75,
};
const AGENT: AgentSummaryRow = {
  agentKey: 'agent1',
  calls: 10,
  errors: 1,
  credits: 0,
  costUsd: 3,
  hasUnknownCost: false,
  steps: 1,
};
const COUNTRY: CountryToolRow = {
  id: 'CO:apollo',
  countryCode: 'CO',
  tool: 'apollo',
  reachedReview: 8,
  approved: 3,
  converted: 1,
  withTaxId: 6,
  withWebsite: 7,
  discarded: 12,
  costUsd: 9,
  hasUnknownCost: false,
  costPerApprovedUsd: 3,
};
const ROLE: RoleGroupRow = {
  id: 'commercial_lead',
  people: 2,
  calls: 5,
  credits: 7,
  costUsd: 2,
  hasUnknownCost: false,
  approved: 1,
  costPerApprovedUsd: 2,
};
const PERSON: PersonUsageRow = {
  userId: 'u1',
  name: 'Ana Ruiz',
  email: 'ana@ubits.co',
  roleKey: 'commercial_lead',
  groupId: 'g1',
  calls: 5,
  credits: 7,
  costUsd: 2,
  hasUnknownCost: false,
  approved: 1,
  costPerApprovedUsd: 2,
};
const SEARCH: SearchBatchRow = {
  batchId: 'batch-1',
  createdAt: '2026-10-10T15:00:00Z',
  createdBy: 'u1',
  countryCode: 'CO',
  macroIndustryKey: 'technology',
  searchMode: 'exploratory',
  companiesByTool: { apollo: 3, gratis: 2 },
  reachedReview: 5,
  approved: 2,
  calls: 4,
  credits: 3,
  costByStep: { apollo: 1.5, clasificador: 0.5 },
  totalCostUsd: 2,
  hasUnknownCost: false,
  costPerApprovedUsd: 1,
};

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  agentSteps = await import('../agent-steps-table');
  countryTools = await import('../country-tools-table');
  roleGroups = await import('../role-group-tables');
  searches = await import('../search-batches-table');
});

afterEach(() => {
  cleanup();
  dom.window.localStorage.clear();
});

const has = (text: string | RegExp) => screen.queryAllByText(text).length > 0;

describe('Por agente', () => {
  it('nombra agente y paso, y muestra lo que el paso consiguió', () => {
    render(h(agentSteps.AgentStepsTable, { agents: [AGENT], steps: [STEP], moneyVisible: true }));
    assert.ok(has('Buscar la web de una descartada (Claude)'));
    assert.ok(has('4 webs encontradas'));
    assert.ok(has('Costo por resultado'));
  });

  it('a un vendedor no le pinta ninguna columna de dinero', () => {
    render(h(agentSteps.AgentStepsTable, { agents: [AGENT], steps: [STEP], moneyVisible: false }));
    assert.equal(has('Costo estimado'), false);
    assert.equal(has('Costo por resultado'), false);
    assert.ok(has('12.000 tokens'));
  });
});

describe('Por país', () => {
  it('país con nombre, herramienta y los tres niveles de empresa entregada', () => {
    render(h(countryTools.CountryToolsTable, { rows: [COUNTRY], moneyVisible: true }));
    assert.ok(has('Colombia'));
    assert.ok(has('Apollo'));
    assert.ok(has('Llegaron a revisión'));
    assert.ok(has('Convertidas en cuenta'));
    assert.ok(has('Costo por aprobada'));
  });

  it('sin dinero para un vendedor', () => {
    render(h(countryTools.CountryToolsTable, { rows: [COUNTRY], moneyVisible: false }));
    assert.equal(has('Costo por aprobada'), false);
    assert.equal(has('Costo estimado'), false);
  });
});

describe('Por rol y grupo', () => {
  it('«Ver personas» pone el filtro del rol en la URL y conserva los demás', () => {
    render(
      h(roleGroups.RoleGroupTables, {
        roles: [ROLE],
        groups: [{ ...ROLE, id: 'g1' }],
        people: [PERSON],
        roleLabels: { commercial_lead: 'Líder comercial' },
        groupNames: { g1: 'Colombia' },
        personNames: { u1: 'Ana Ruiz' },
        moneyVisible: true,
        currentQuery: 'period=7d&user=u9',
      }),
    );
    const links = screen.getAllByRole('link', { name: 'Ver personas' }).map((a) => a.getAttribute('href'));
    assert.ok(links.includes('/ai-usage?period=7d&role=commercial_lead&tab=por-rol-grupo'));
    assert.ok(links.includes('/ai-usage?period=7d&groupId=g1&tab=por-rol-grupo'));
    assert.ok(has('Ana Ruiz'));
  });

  it('el enlace se calcula igual fuera de React', () => {
    assert.equal(
      roleGroups.drillHref('country=CO', 'role', 'seller'),
      '/ai-usage?country=CO&role=seller&tab=por-rol-grupo',
    );
  });
});

describe('Por búsqueda', () => {
  it('cada búsqueda abre su lote; empresas por herramienta y costo por paso', () => {
    render(h(searches.SearchBatchesTable, { rows: [SEARCH], personNames: { u1: 'Ana Ruiz' }, moneyVisible: true }));
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/prospect-batches/batch-1');
    assert.ok(link, 'la fecha enlaza al lote');
    assert.ok(has('Buscador gratis 2 · Apollo 3'));
    assert.ok(has('Buscar empresas en Apollo'));
    assert.ok(has('Empresas por industria'));
  });

  it('sin dinero para un vendedor', () => {
    render(h(searches.SearchBatchesTable, { rows: [SEARCH], personNames: {}, moneyVisible: false }));
    assert.equal(has('Costo por paso'), false);
    assert.equal(has('Costo total'), false);
  });
});
