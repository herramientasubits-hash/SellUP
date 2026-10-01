/**
 * Tablas de /ai-usage — contrato RUNTIME: títulos en lenguaje de negocio,
 * estados vacíos que dicen qué falta y cifras sin jerga.
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

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

const h = React.createElement;

import type { AgentStat, ProviderStat } from '@/modules/usage-tracking/types';

let tables: typeof import('../usage-tables');

const AGENT: AgentStat = {
  agent_key: 'prospect_generation',
  agent_name: null,
  total_executions: 12,
  completed_executions: 11,
  failed_executions: 1,
  total_results_generated: 200,
  total_results_approved: 50,
  total_estimated_cost_usd: 10,
  last_run_at: null,
};

const PROVIDER: ProviderStat = {
  provider_key: 'apollo',
  total_calls: 30,
  success_calls: 30,
  error_calls: 0,
  total_credits_used: 45,
  unknown_credit_operations: 0,
  has_unknown_credits: false,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_results_returned: 120,
  total_estimated_cost_usd: 4.5,
  has_unknown_cost: false,
  last_used_at: null,
};

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  tables = await import('../usage-tables');
});

afterEach(() => {
  cleanup();
});

describe('AgentUsageSection', () => {
  it('sin agentes explica qué falta para ver datos', () => {
    render(h(tables.AgentUsageSection, { agents: [] }));

    assert.ok(screen.getByRole('heading', { name: 'Qué hizo cada agente' }));
    assert.ok(screen.getByText('Ningún agente ha trabajado todavía'));
    assert.equal(screen.queryByRole('table'), null);
  });

  it('pinta el agente con su nombre legible, su efectividad y su costo por aprobado', () => {
    render(h(tables.AgentUsageSection, { agents: [AGENT] }));

    assert.ok(screen.getByText('Generación de prospectos'));
    assert.ok(screen.getByText('25.0%'));
    assert.ok(screen.getByText('$10.00'));
    assert.ok(screen.getByText('$0.2000'));
  });

  it('la fórmula de la efectividad vive en un botón de ayuda, no en un párrafo fijo', () => {
    render(h(tables.AgentUsageSection, { agents: [AGENT] }));

    assert.ok(screen.getByRole('button', { name: 'Cómo se calcula' }));
    assert.equal(screen.queryByText(/aprobados sobre los generados/), null);
  });
});

describe('ProviderUsageSection', () => {
  it('sin proveedores explica qué falta para ver datos', () => {
    render(h(tables.ProviderUsageSection, { providers: [] }));

    assert.ok(screen.getByText('Aún no se ha consultado a ningún proveedor'));
  });

  it('dice en qué se mide cada proveedor y cuánto consumió', () => {
    render(h(tables.ProviderUsageSection, { providers: [PROVIDER] }));

    assert.ok(screen.getByText('Apollo'));
    assert.ok(screen.getByText('Créditos'));
    assert.ok(screen.getByText('$4.50'));
  });

  it('un proveedor que cobra por tokens se mide en tokens', () => {
    render(
      h(tables.ProviderUsageSection, {
        providers: [{ ...PROVIDER, provider_key: 'anthropic', total_credits_used: 0, total_input_tokens: 10000, total_output_tokens: 5000 }],
      }),
    );

    assert.ok(screen.getByText('Tokens'));
    assert.ok(screen.getByText('15.000'));
  });
});

describe('TeamUsageSection', () => {
  it('null es «sin permiso», no «nadie»', () => {
    render(h(tables.TeamUsageSection, { users: null }));

    assert.ok(screen.getByText('No tienes permiso para ver el consumo por persona'));
  });

  it('una lista vacía invita a cambiar los filtros', () => {
    render(h(tables.TeamUsageSection, { users: [] }));

    assert.ok(screen.getByText('Nadie coincide con estos filtros'));
  });

  it('quien no ha usado los agentes aparece en cero y marcado «Sin uso»', () => {
    render(
      h(tables.TeamUsageSection, {
        users: [
          {
            triggered_by: 'u1',
            full_name: 'Ana Ruiz',
            email: 'ana@ubits.co',
            executions: 0,
            provider_calls: 0,
            providers: [],
            estimated_cost_usd: 0,
            has_unknown_cost: false,
            last_activity_at: null,
          },
        ],
      }),
    );

    assert.ok(screen.getByText('Ana Ruiz'));
    assert.ok(screen.getByText('Sin uso'));
    assert.ok(screen.getByText('$0.00'));
  });
});

describe('RecentActivitySection', () => {
  it('sin consultas explica qué falta para ver datos', () => {
    render(h(tables.RecentActivitySection, { logs: [], limit: 25 }));

    assert.ok(screen.getByText('Todavía no hay consultas'));
    assert.ok(screen.getByText(/Las 25 consultas más recientes/));
  });
});
