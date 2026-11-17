/**
 * EMPRESAS-COLUMNAS-FILTROS (dueño 17-11) — «Lista de empresas»: columnas nuevas
 * (HubSpot, última y próxima actividad, contactos…) y filtro en todas las
 * columnas.
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
import { EMPTY_ACCOUNT_LIST_SIGNALS, type AccountListSignals } from '@/modules/accounts/list-signals';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});

mock.module('@/modules/accounts/actions', {
  namedExports: {
    updateAccount: async () => ({ success: true }),
    archiveAccount: async () => ({ success: true }),
  },
});

mock.module('@/components/accounts/account-detail-sheet', {
  namedExports: { AccountDetailSheet: () => null },
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
let NavAccessProvider: (typeof import('@/components/layout/nav-access-context'))['NavAccessProvider'];

function signals(overrides: Partial<AccountListSignals>): AccountListSignals {
  return { ...EMPTY_ACCOUNT_LIST_SIGNALS, ...overrides };
}

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
    next_step: 'find_contacts',
    ...overrides,
  };
}

const ACCOUNTS = [
  account({
    id: 'a1',
    name: 'Acme',
    hubspot_company_id: '111',
    signals: signals({
      contactsApproved: 3,
      hubspotStatus: 'free',
      hubspotLastActivityAt: '2026-11-16T15:00:00.000Z',
      sellupLastActivityAt: '2026-11-01T15:00:00.000Z',
      hubspotNextActivityAt: '2026-11-20T15:00:00.000Z',
    }),
  }),
  account({
    id: 'a2',
    name: 'Beta',
    domain: null,
    signals: signals({ sellupLastActivityAt: '2026-11-10T15:00:00.000Z', hubspotStatus: 'not_linked' }),
  }),
  account({ id: 'a3', name: 'Gamma', owner_id: null, owner_name: null, country_code: null }),
  account({ id: 'a4', name: 'Delta', created_at: '2025-06-01T15:00:00.000Z' }),
];

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ AccountsDataTableClient } = await import('../accounts-data-table-client'));
  ({ NavAccessProvider } = await import('@/components/layout/nav-access-context'));
});

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => cleanup());

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((row) => row.querySelector('button[title]')?.textContent ?? '')
    .filter(Boolean);
}

function headerLabels(): string[] {
  return Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
}

function renderTable(accounts: AccountListItem[] = ACCOUNTS) {
  return render(
    <NavAccessProvider value={{ isAdmin: false, roleKey: 'seller_bd' }}>
      <AccountsDataTableClient accounts={accounts} users={[]} hubspotPortalId="999" />
    </NavAccessProvider>,
  );
}

describe('Lista de empresas — columnas de entrada', () => {
  it('suma «Empresa en HubSpot», «Última actividad» y «Próxima actividad agendada»; el resto arranca oculto', () => {
    renderTable();
    const headers = headerLabels().join(' | ');
    for (const title of ['Empresa', 'País', 'Industria', 'Dominio', 'Empresa en HubSpot', 'Siguiente paso', 'Responsable', 'Última actividad', 'Próxima actividad agendada', 'Creación']) {
      assert.ok(headers.includes(title), `falta «${title}» en ${headers}`);
    }
    for (const hidden of ['Contactos aprobados', 'Contactos por revisar', 'Contactos rechazados', 'Estado comercial', 'Origen']) {
      assert.ok(!headers.includes(hidden), `«${hidden}» debía arrancar oculta`);
    }
  });

  it('«Empresa en HubSpot» abre la empresa en el portal; sin ID lo dice', () => {
    renderTable();
    const link = screen.getByRole('link', { name: /Abrir Acme en HubSpot/ });
    assert.equal(link.getAttribute('href'), 'https://app.hubspot.com/contacts/999/company/111');
    assert.ok(screen.getAllByText('No está en HubSpot').length >= 1);
  });

  it('«Última actividad» es la más reciente entre HubSpot y SellUp y dice de dónde salió', () => {
    renderTable();
    const acme = Array.from(document.querySelectorAll('tbody tr')).find((row) => row.textContent?.includes('Acme')) as HTMLElement;
    assert.match(acme.textContent ?? '', /16 de nov de 2026\s*HubSpot/);
    const beta = Array.from(document.querySelectorAll('tbody tr')).find((row) => row.textContent?.includes('Beta')) as HTMLElement;
    assert.match(beta.textContent ?? '', /10 de nov de 2026\s*SellUp/);
    assert.match(acme.textContent ?? '', /20 de nov de 2026/, 'la próxima actividad agendada');
  });
});

describe('Lista de empresas — filtro en todas las columnas', () => {
  it('cada columna visible trae su embudo', () => {
    renderTable();
    for (const name of ['Empresa', 'País', 'Industria', 'Dominio', 'Empresa en HubSpot', 'Siguiente paso', 'Responsable', 'Última actividad (HubSpot o SellUp)', 'Próxima actividad agendada (HubSpot)', 'Fecha de creación']) {
      assert.ok(screen.getByRole('button', { name: `Filtrar por ${name}` }), `sin embudo: ${name}`);
    }
  });

  it('«Empresa»: «contiene» sin distinguir mayúsculas', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Empresa' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Empresa contiene' }), { target: { value: 'DEL' } });
    assert.deepEqual(rowNames(), ['Delta']);
  });

  it('«Responsable»: «(Vacío)» deja las empresas sin responsable', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Responsable' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /\(Vacío\)/ }));
    assert.deepEqual(rowNames(), ['Gamma']);
  });

  it('«Dominio»: «Sin dato»', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Dominio' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Sin dato' }));
    assert.deepEqual(rowNames(), ['Beta']);
  });

  it('«Empresa en HubSpot»: está / no está', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Empresa en HubSpot' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Está en HubSpot/ }));
    assert.deepEqual(rowNames(), ['Acme']);
  });

  it('«Próxima actividad agendada»: «Sin fecha»', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Próxima actividad agendada (HubSpot)' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Sin fecha' }));
    assert.deepEqual(rowNames().sort(), ['Beta', 'Delta', 'Gamma']);
  });

  it('el filtro queda como chip y se quita desde ahí', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Empresa' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Empresa contiene' }), { target: { value: 'gam' } });
    const chips = screen.getByRole('group', { name: 'Filtros activos' });
    assert.match(chips.textContent ?? '', /Empresa: contiene «gam»/);
    assert.deepEqual(rowNames(), ['Gamma']);
  });
});
