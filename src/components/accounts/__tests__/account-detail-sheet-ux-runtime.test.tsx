/**
 * UX-EMPRESAS-CONTACTOS — el panel de detalle de una empresa
 * (AccountDetailSheet) como se lee.
 *
 *   1. Cabecera con nombre y estado; debajo, un resumen de lo esencial
 *      (responsable, ubicación, sitio web, contactos) antes de las pestañas.
 *   2. Lo que está en el resumen no se repite en las secciones.
 *   3. El pie lleva lo secundario a la izquierda y la acción principal a la
 *      derecha.
 *   4. Si la empresa no se puede cargar, lo dice y ofrece reintentar (antes se
 *      quedaba girando para siempre).
 *
 * Acciones de servidor y subpaneles son dobles: sin red ni base de datos.
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

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});
mock.module('sonner', {
  namedExports: { toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} } },
});

const ACCOUNT = {
  id: 'acc-1',
  name: 'Acme',
  legal_name: 'Acme S.A.S.',
  website: 'https://acme.co',
  domain: 'acme.co',
  city: 'Bogotá',
  region: null,
  country: 'Colombia',
  country_code: 'CO',
  industry: 'Tecnología',
  company_size: null,
  tax_identifier: null,
  tax_identifier_type: null,
  source: 'manual',
  pipeline_status: 'ready_for_research',
  created_at: '2026-01-10T15:00:00.000Z',
  hubspot_company_id: null,
  notes: null,
  metadata: {},
  owner: { id: 'u1', full_name: 'Ana Ruiz', email: 'ana@sellup.co' },
};

let accountToReturn: typeof ACCOUNT | null = ACCOUNT;
let loads = 0;
mock.module('@/modules/accounts/actions', {
  namedExports: {
    getAccountById: async () => {
      loads += 1;
      return accountToReturn;
    },
    getAccountAudit: async () => [],
    getActiveUsers: async () => [],
    updateAccount: async () => ({ success: true }),
    archiveAccount: async () => ({ success: true }),
  },
});
mock.module('@/modules/contacts/actions', {
  namedExports: {
    getContactsByAccount: async () => [{ id: 'c1' }, { id: 'c2' }],
    getContactsSummary: async () => ({}),
  },
});
mock.module('@/modules/contact-enrichment/account-run-history-actions', {
  namedExports: { getContactEnrichmentRunsByAccountId: async () => [] },
});
mock.module('@/components/contact-enrichment/account-agents-run-history', {
  namedExports: { AccountAgentsRunHistory: () => null },
});
mock.module('@/components/contact-enrichment/contact-enrichment-drawer', {
  namedExports: { ContactEnrichmentDrawer: () => null },
});
mock.module('@/components/contacts/contacts-tab', {
  namedExports: { ContactsTab: () => null },
});
mock.module('@/components/contacts/contact-detail-sheet', {
  namedExports: { ContactDetailSheet: () => null },
});
mock.module('@/components/accounts/account-edit-drawer', {
  namedExports: { AccountEditDrawer: () => null },
});

let AccountDetailSheet: (typeof import('../account-detail-sheet'))['AccountDetailSheet'];

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ AccountDetailSheet } = await import('../account-detail-sheet'));
});

beforeEach(() => {
  accountToReturn = ACCOUNT;
  loads = 0;
});
afterEach(() => cleanup());

function renderSheet(onRequestEnrich: (company: unknown) => void = () => {}) {
  return render(
    <AccountDetailSheet accountId="acc-1" open onClose={() => {}} onRequestEnrich={onRequestEnrich} />,
  );
}

describe('Detalle de empresa — cabecera y resumen', () => {
  it('la cabecera lleva el nombre y el estado', async () => {
    renderSheet();

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Acme' });
    assert.ok(within(dialog).getByText('Lista para investigar'));
  });

  it('resume lo esencial antes de las pestañas', async () => {
    renderSheet();

    const summary = await screen.findByRole('region', { name: 'Resumen de la empresa' });
    assert.ok(within(summary).getByText('Responsable'));
    assert.ok(within(summary).getByText('Ana Ruiz'));
    assert.ok(within(summary).getByText('Bogotá, Colombia'));
    assert.equal(within(summary).getByRole('link', { name: 'acme.co' }).getAttribute('href'), 'https://acme.co');
    assert.ok(within(summary).getByText('2'));
  });

  it('lo que está en el resumen no se repite en las secciones', async () => {
    renderSheet();
    await screen.findByRole('region', { name: 'Resumen de la empresa' });

    assert.equal(screen.getAllByText('Ubicación').length, 1);
    assert.equal(screen.getAllByText('Sitio web').length, 1);
    assert.equal(screen.queryByText('Estado pipeline'), null, 'el estado ya está en la cabecera');
    assert.equal(screen.queryByText('Owner'), null);
  });

  it('sin notas dice cómo añadirlas', async () => {
    renderSheet();

    assert.ok(await screen.findByText(/Sin notas todavía\. Añádelas con «Editar empresa»/));
  });
});

describe('Detalle de empresa — pie', () => {
  it('lo secundario a la izquierda y «Buscar contactos» a la derecha, como primaria', async () => {
    const requested: unknown[] = [];
    renderSheet((company) => requested.push(company));

    const primary = await screen.findByRole('button', { name: 'Buscar contactos' });
    const more = screen.getByRole('button', { name: 'Más acciones de la empresa' });
    assert.equal(primary.getAttribute('data-variant'), 'default');
    assert.ok(
      more.compareDocumentPosition(primary) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      'el menú va antes que la primaria',
    );

    fireEvent.click(primary);
    assert.equal(requested.length, 1);
  });

  it('una empresa archivada no ofrece buscar contactos', async () => {
    accountToReturn = { ...ACCOUNT, pipeline_status: 'archived' };
    renderSheet();

    await screen.findByRole('region', { name: 'Resumen de la empresa' });
    assert.equal(screen.queryByRole('button', { name: 'Buscar contactos' }), null);
  });
});

describe('Detalle de empresa — si no se puede cargar', () => {
  it('lo dice y permite reintentar, en vez de quedarse cargando', async () => {
    accountToReturn = null;
    renderSheet();

    assert.ok(await screen.findByText('No pudimos cargar esta empresa'));
    assert.equal(loads, 1);

    accountToReturn = ACCOUNT;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await screen.findByRole('region', { name: 'Resumen de la empresa' });
    assert.equal(loads, 2);
    await waitFor(() => assert.equal(screen.queryByText('No pudimos cargar esta empresa'), null));
  });
});
