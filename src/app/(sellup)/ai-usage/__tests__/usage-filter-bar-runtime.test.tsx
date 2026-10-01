/**
 * UsageFilterBar — contrato RUNTIME: periodo a la vista, el resto tras «Más
 * filtros», etiquetas de lo aplicado y «Limpiar filtros».
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
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

const h = React.createElement;

import type { FilterOptions } from '@/modules/ai-usage/queries';
import type { UsageFilterValues } from '../usage-filters-core';

let UsageFilterBar: (typeof import('../filters-client'))['UsageFilterBar'];

const OPTIONS: FilterOptions = {
  providers: ['apollo', 'tavily'],
  agents: [{ key: 'prospect_generation', name: null }],
  statuses: ['success', 'rate_limited'],
  hasTriggeredBy: true,
  users: [
    { id: 'u1', full_name: 'Ana Ruiz', email: 'ana@ubits.co', role_key: 'seller', group_id: 'g1' },
    { id: 'u2', full_name: 'Luis Gil', email: 'luis@ubits.co', role_key: 'admin', group_id: 'g2' },
  ],
  roles: [
    { key: 'seller', label: 'Vendedor / BD' },
    { key: 'admin', label: 'Administrador' },
  ] as FilterOptions['roles'],
  groups: [
    { id: 'g1', name: 'Colombia', parent_group_id: null, depth: 0 },
    { id: 'g2', name: 'México', parent_group_id: null, depth: 0 },
  ],
  usersScopedToActive: true,
};

const EMPTY: UsageFilterValues = {
  period: '',
  provider: '',
  agent: '',
  status: '',
  role: '',
  groupId: '',
  user: '',
};

function renderBar(values: Partial<UsageFilterValues> = {}) {
  const calls: UsageFilterValues[] = [];
  const view = render(
    h(UsageFilterBar, {
      options: OPTIONS,
      values: { ...EMPTY, ...values },
      onChange: (next: UsageFilterValues) => calls.push(next),
    }),
  );
  return { ...view, calls };
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  UsageFilterBar = (await import('../filters-client')).UsageFilterBar;
});

afterEach(() => {
  cleanup();
});

describe('UsageFilterBar — qué se ve', () => {
  it('de entrada solo enseña el periodo y «Más filtros»', () => {
    renderBar();

    assert.ok(screen.getByRole('combobox', { name: 'Periodo' }));
    assert.ok(screen.getByRole('button', { name: /Más filtros/ }));
    assert.equal(screen.queryByRole('combobox', { name: 'Proveedor' }), null);
    assert.equal(screen.queryByRole('combobox', { name: 'Persona' }), null);
  });

  it('«Más filtros» despliega los otros seis y lo anuncia', () => {
    renderBar();
    const toggle = screen.getByRole('button', { name: /Más filtros/ });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');

    fireEvent.click(toggle);

    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    for (const name of ['Proveedor', 'Agente', 'Estado', 'Rol', 'Grupo', 'Persona']) {
      assert.ok(screen.getByRole('combobox', { name }), `falta el filtro ${name}`);
    }
  });

  it('sin filtros no hay etiquetas ni «Limpiar filtros»', () => {
    renderBar();

    assert.equal(screen.queryByRole('button', { name: /Limpiar filtros/ }), null);
    assert.equal(screen.queryByRole('button', { name: /Remover filtro/ }), null);
  });

  it('cuenta en el botón los filtros secundarios aplicados (el periodo no cuenta)', () => {
    renderBar({ period: '7d', provider: 'apollo', role: 'seller' });

    assert.ok(screen.getByLabelText('2 aplicados'));
  });
});

describe('UsageFilterBar — filtros aplicados', () => {
  it('cada filtro puesto sale como etiqueta con nombre legible, nunca un identificador', () => {
    renderBar({ provider: 'apollo', status: 'rate_limited', user: 'u1' });

    assert.ok(screen.getByText('Apollo'));
    assert.ok(screen.getByText('Demasiadas consultas'));
    assert.ok(screen.getByText('Ana Ruiz (ana@ubits.co)'));
    assert.equal(screen.queryByText('u1'), null);
    assert.equal(screen.queryByText('rate_limited'), null);
  });

  it('un valor que ya no existe se dice con palabras', () => {
    renderBar({ user: 'id-borrado' });

    assert.ok(screen.getByText('Persona no encontrada'));
    assert.equal(screen.queryByText('id-borrado'), null);
  });

  it('quitar una etiqueta quita solo ese filtro', () => {
    const { calls } = renderBar({ period: '7d', provider: 'apollo' });

    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro Proveedor' }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].provider, '');
    assert.equal(calls[0].period, '7d');
  });

  it('el periodo se lee en su control y no se repite como etiqueta', () => {
    renderBar({ period: '7d' });

    assert.equal(screen.getAllByText('Últimos 7 días').length, 1);
    assert.equal(screen.queryByRole('button', { name: 'Remover filtro Periodo' }), null);
  });

  it('«Limpiar filtros» quita las etiquetas y respeta el periodo', () => {
    const { calls } = renderBar({ period: '7d', provider: 'apollo', user: 'u1' });

    fireEvent.click(screen.getByRole('button', { name: /Limpiar filtros/ }));

    assert.deepEqual(calls, [{ ...EMPTY, period: '7d' }]);
  });
});
