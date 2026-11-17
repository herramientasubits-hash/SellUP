/**
 * EMPRESAS-COLUMNAS-FILTROS (dueño 17-11) — «Búsquedas»: todas las columnas
 * ordenan y filtran (antes las cabeceras eran texto plano).
 *
 * Acciones de servidor y drawers son dobles: sin red ni base de datos.
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
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchRow } from '@/modules/prospect-batches/searches/search-rows';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});
mock.module('@/components/contact-enrichment/batch-bulk-enrichment-button', {
  namedExports: {
    BATCH_ENRICH_LABEL: 'Buscar contactos de las aprobadas',
    useBatchBulkEnrichment: () => ({ start: async () => {}, loading: false, dialog: null }),
  },
});
mock.module('@/components/prospect-batches/bulk-search/bulk-search-assign-drawer', {
  namedExports: { BulkSearchAssignDrawer: () => null },
});
mock.module('@/modules/prospect-batches/searches/search-assign-actions', {
  namedExports: { getSearchPendingCandidatesAction: async () => ({ ok: true, candidates: [] }) },
});

let SearchesTableClient: (typeof import('../searches-table-client'))['SearchesTableClient'];

function search(overrides: Partial<SearchRow>): SearchRow {
  return {
    id: 's',
    name: 'Búsqueda',
    statusLabel: 'Terminada',
    statusTone: 'neutral',
    formLabel: 'Empresas por criterios',
    country: 'CO',
    industry: null,
    found: 12,
    needsReview: 0,
    approved: 3,
    converted: 3,
    createdAt: '2026-11-10T15:00:00.000Z',
    createdBy: 'Ana Ruiz',
    visibility: 'full',
    bulkSearch: null,
    ...overrides,
  } as SearchRow;
}

const SEARCHES = [
  search({ id: 's1', name: 'Retail Colombia', needsReview: 4 }),
  search({ id: 's2', name: 'Bancos México', formLabel: 'Archivo importado', found: 60, createdAt: '2026-06-01T15:00:00.000Z' }),
  search({ id: 's3', name: 'Árbol Grupo Éxito', formLabel: 'Árbol de una empresa', found: 0, approved: 0 }),
];

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ SearchesTableClient } = await import('../searches-table-client'));
});
afterEach(() => cleanup());

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((row) => row.querySelector('a')?.textContent ?? '')
    .filter(Boolean);
}

describe('Búsquedas — filtro en todas las columnas', () => {
  it('cada columna trae su embudo', () => {
    render(<SearchesTableClient searches={SEARCHES} />);
    for (const name of ['Búsqueda', 'Forma', 'Estado', 'Encontradas', 'Por revisar', 'Aprobadas', 'Fecha de la búsqueda']) {
      assert.ok(screen.getByRole('button', { name: `Filtrar por ${name}` }), `sin embudo: ${name}`);
    }
  });

  it('«Por revisar» en tramos: «Ninguna» deja las que no esperan decisión', async () => {
    render(<SearchesTableClient searches={SEARCHES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Por revisar' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ninguna/ }));
    assert.deepEqual(rowNames(), ['Bancos México', 'Árbol Grupo Éxito']);
  });

  it('«Búsqueda» por texto, sin tildes', async () => {
    render(<SearchesTableClient searches={SEARCHES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Búsqueda' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Búsqueda contiene' }), { target: { value: 'arbol' } });
    assert.deepEqual(rowNames(), ['Árbol Grupo Éxito']);
  });

  it('«Forma» por sus valores', async () => {
    render(<SearchesTableClient searches={SEARCHES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Forma' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Archivo importado/ }));
    assert.deepEqual(rowNames(), ['Bancos México']);
  });
});
