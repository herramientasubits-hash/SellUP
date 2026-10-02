/**
 * UX-EMPRESAS-CONTACTOS — la tabla «Empresas» (AccountsDataTableClient) como
 * se usa: indicadores que filtran, vacíos que dicen qué hacer, celdas con la
 * misma voz que el resto de tablas, menú de estado explícito y vista «Lista».
 *
 * Las acciones de servidor y los drawers son dobles: sin red ni base de datos.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test has no DOM environment) ────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
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
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountListItem } from '@/modules/accounts/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});

const statusChanges: Array<{ id: string; status: unknown }> = [];
mock.module('@/modules/accounts/actions', {
  namedExports: {
    updateAccount: async (id: string, patch: { pipeline_status?: unknown }) => {
      statusChanges.push({ id, status: patch.pipeline_status });
      return { success: true };
    },
    archiveAccount: async () => ({ success: true }),
  },
});

let detailOpenFor: string | null = null;
mock.module('@/components/accounts/account-detail-sheet', {
  namedExports: {
    AccountDetailSheet: (props: { accountId: string | null; open: boolean }) => {
      detailOpenFor = props.open ? props.accountId : null;
      return null;
    },
  },
});
mock.module('@/components/accounts/account-edit-drawer', {
  namedExports: { AccountEditDrawer: () => null },
});
mock.module('@/components/contact-enrichment/contact-enrichment-drawer', {
  namedExports: { ContactEnrichmentDrawer: () => null },
});
mock.module('@/components/contact-enrichment/bulk-contact-enrichment-drawer', {
  namedExports: { BulkContactEnrichmentDrawer: () => null },
});

let AccountsDataTableClient: (typeof import('../accounts-data-table-client'))['AccountsDataTableClient'];

function account(overrides: Partial<AccountListItem>): AccountListItem {
  return {
    id: 'a',
    name: 'Acme',
    country: 'Colombia',
    country_code: 'CO',
    industry: 'Tecnología',
    website: null,
    domain: 'acme.co',
    pipeline_status: 'new',
    source: 'manual',
    created_at: '2026-01-10T15:00:00.000Z',
    owner_id: 'u1',
    owner_name: 'Ana Ruiz',
    ...overrides,
  };
}

const ACCOUNTS = [
  account({ id: 'a1', name: 'Acme', pipeline_status: 'new' }),
  account({ id: 'a2', name: 'Beta', pipeline_status: 'ready_for_research', country_code: 'MX', domain: null }),
  account({ id: 'a3', name: 'Gamma', pipeline_status: 'ready_for_outreach', country_code: null, industry: null, owner_name: null, owner_id: null }),
  account({ id: 'a4', name: 'Delta', pipeline_status: 'ready_for_outreach', source: 'agent_1' }),
];

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ AccountsDataTableClient } = await import('../accounts-data-table-client'));
});

beforeEach(() => {
  statusChanges.length = 0;
  detailOpenFor = null;
  window.localStorage.clear();
});
afterEach(() => cleanup());

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((row) => row.querySelector('button[title]')?.textContent ?? '')
    .filter(Boolean);
}

function indicators(): HTMLElement {
  return screen.getByRole('group', { name: 'Indicadores de empresas' });
}

function renderTable(accounts: AccountListItem[] = ACCOUNTS, emptyActions?: React.ReactNode) {
  return render(<AccountsDataTableClient accounts={accounts} users={[]} emptyActions={emptyActions} />);
}

describe('Empresas — los indicadores son filtros de un toque', () => {
  it('cada estado clave es un botón con su recuento', () => {
    renderTable();

    const group = within(indicators());
    assert.match(group.getByRole('button', { name: /Nuevas/ }).textContent ?? '', /1/);
    assert.match(group.getByRole('button', { name: /Listas para investigar/ }).textContent ?? '', /1/);
    assert.match(group.getByRole('button', { name: /Listas para contacto/ }).textContent ?? '', /2/);
  });

  it('pulsar uno deja solo esas empresas; pulsarlo otra vez las devuelve todas', () => {
    renderTable();
    const button = () => within(indicators()).getByRole('button', { name: /Listas para contacto/ });

    fireEvent.click(button());
    assert.deepEqual(rowNames(), ['Gamma', 'Delta']);
    assert.equal(button().getAttribute('aria-pressed'), 'true');
    assert.ok(screen.getByText('Empresas · Listas para contacto'));

    fireEvent.click(button());
    assert.equal(rowNames().length, 4);
    assert.equal(button().getAttribute('aria-pressed'), 'false');
  });

  it('la tabla no repite una descripción bajo su título', () => {
    renderTable();

    assert.ok(screen.getByText('Listado de empresas'));
    assert.equal(screen.queryByText('Empresas, pipeline, fuente y estado.'), null);
  });
});

describe('Empresas — vacíos', () => {
  it('sin empresas ofrece las acciones que le pasa la página y no pinta indicadores', () => {
    renderTable([], <button type="button">Crear empresa</button>);

    assert.ok(screen.getByText('Todavía no hay empresas'));
    assert.ok(screen.getByRole('button', { name: 'Crear empresa' }));
    assert.equal(screen.queryByRole('group', { name: 'Indicadores de empresas' }), null);
  });

  it('un indicador sin filas lo dice y ofrece quitarlo', () => {
    renderTable(ACCOUNTS.slice(1));

    fireEvent.click(within(indicators()).getByRole('button', { name: /Nuevas/ }));
    assert.ok(screen.getByText('Nada en «Nuevas»'));
    assert.equal(screen.queryByText('Todavía no hay empresas'), null, 'no se hace pasar por lista vacía');

    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro' }));
    assert.equal(rowNames().length, 3);
  });
});

describe('Empresas — celdas', () => {
  it('el país lleva nombre completo; lo que falta es una raya con nombre', () => {
    renderTable();

    assert.ok(screen.getAllByText('Colombia').length >= 1);
    assert.ok(screen.getByText('México'));
    for (const label of ['Sin país', 'Sin industria', 'Sin responsable', 'Sin dominio']) {
      assert.ok(screen.getByText(label), label);
    }
  });

  it('el dominio es un enlace externo que no abre el detalle', () => {
    renderTable();

    const link = screen.getAllByRole('link', { name: /Abrir el sitio web de Acme/ })[0];
    assert.equal(link.getAttribute('href'), 'https://acme.co');
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    assert.equal(detailOpenFor, null);
  });

  it('solo el estado va en chip: la fuente es texto', () => {
    renderTable();

    const row = screen.getByRole('button', { name: 'Delta' }).closest('tr');
    assert.ok(row);
    assert.equal(within(row).getByText('Lista para contacto').getAttribute('data-slot'), 'badge');
    assert.equal(row.querySelectorAll('[data-slot="badge"]').length, 1);
  });

  it('el nombre abre el detalle', () => {
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    assert.equal(detailOpenFor, 'a2');
  });
});

describe('Empresas — el menú dice a qué estado pasa', () => {
  it('ofrece una entrada por estado posible, nunca el actual, y aplica el elegido', async () => {
    // «Menú en cada fila» (Configurar tabla): las mismas entradas que el clic derecho.
    window.localStorage.setItem('sellup:table:accounts', JSON.stringify({ rowControl: 'menu' }));
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Acme' }));

    const target = await screen.findByRole('menuitem', { name: 'Marcar como «Lista para contacto»' });
    assert.ok(screen.getByRole('menuitem', { name: 'Marcar como «Lista para investigar»' }));
    assert.equal(screen.queryByRole('menuitem', { name: 'Marcar como «Nueva»' }), null);
    assert.equal(screen.queryByRole('menuitem', { name: 'Cambiar estado' }), null);

    fireEvent.click(target);
    await waitFor(() => assert.deepEqual(statusChanges, [{ id: 'a1', status: 'ready_for_outreach' }]));
  });
});

describe('Empresas — vista «Lista»', () => {
  it('pinta cada empresa como fila de lista con su estado', () => {
    window.localStorage.setItem('sellup:table:accounts', JSON.stringify({ view: 'list' }));
    renderTable();

    assert.equal(document.querySelector('table'), null);
    const items = screen.getAllByRole('listitem');
    assert.equal(items.length, 4);
    const first = within(items[0]);
    assert.ok(first.getByRole('button', { name: 'Acme' }));
    assert.ok(first.getByText('Colombia · Tecnología · acme.co'));
    assert.ok(first.getByText('Nueva'));
    assert.ok(first.getByRole('checkbox', { name: 'Seleccionar Acme' }));
  });
});
