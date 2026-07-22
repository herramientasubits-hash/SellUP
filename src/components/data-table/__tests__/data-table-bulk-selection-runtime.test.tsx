/**
 * Q3F-5AZ.2E-1-UX1 — generic DataTable capabilities RUNTIME contract.
 *
 * Renders the ACTUAL `DataTable` + `DataTableBulkActionBar` (not the Prospectos
 * surface) with a minimal fixture table to pin two new, reusable primitives:
 *
 *   1. `DataTableHandle.clearSelection()` (exposed via ref) resets the row
 *      selection, which hides the floating bulk action bar — the mechanism
 *      `ProspectsDataTableClient` uses to avoid showing the selection bar and
 *      the side panel footer at the same time.
 *   2. A `DataTableBulkAction` with `items` renders as a dropdown trigger
 *      ("Más acciones" style) instead of a flat button, with each item
 *      carrying its own independent disabled/disabledLabel state.
 *
 * No Prospectos-specific code is exercised here — see
 * prospects-selection-drawer-conflict-runtime.test.tsx for the product wiring.
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
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

let DataTable: (typeof import('../data-table'))['DataTable'];
type DataTableHandle = import('../data-table').DataTableHandle;
type DataTableBulkAction<T> = import('../data-table').DataTableBulkAction<T>;

interface FixtureRow {
  id: string;
  name: string;
}

const ROWS: FixtureRow[] = [
  { id: '1', name: 'Acme SA' },
  { id: '2', name: 'Beta SA' },
];

const COLUMNS = [
  {
    id: 'name',
    accessorKey: 'name',
    header: () => 'Empresa',
    cell: ({ row }: { row: { original: FixtureRow } }) => row.original.name,
  },
];

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ DataTable } = await import('../data-table'));
});

afterEach(() => cleanup());

function selectAllRows(): void {
  const checkboxes = screen.getAllByRole('checkbox');
  // First checkbox is the header "select all"; clicking it selects every row.
  fireEvent.click(checkboxes[0]);
}

describe('DataTable — clearSelection ref hides the bulk action bar', () => {
  it('selecting a row shows the bar, and ref.clearSelection() hides it again', () => {
    const ref = React.createRef<DataTableHandle>();
    const bulkActions: DataTableBulkAction<FixtureRow>[] = [
      { id: 'noop', label: 'Ver detalle', onClick: () => {} },
    ];

    render(
      <DataTable
        ref={ref}
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        enableRowSelection
        bulkActions={bulkActions}
      />,
    );

    assert.equal(screen.queryByText('Seleccionados'), null, 'bar hidden with no selection');

    selectAllRows();
    assert.ok(screen.getByText('Seleccionados'), 'bar appears once rows are selected');

    assert.ok(ref.current, 'DataTableHandle must be attached to the ref');
    React.act(() => {
      ref.current!.clearSelection();
    });

    assert.equal(
      screen.queryByText('Seleccionados'),
      null,
      'bar must hide once selection is cleared via the ref — this is the mechanism ' +
        'ProspectsDataTableClient uses so opening the side panel never leaves the ' +
        'selection bar visible underneath it',
    );
  });
});

describe('DataTable — bulk action "items" render as a dropdown group', () => {
  it('renders a trigger for the group and disabled sub-items with hints inside the menu', async () => {
    const bulkActions: DataTableBulkAction<FixtureRow>[] = [
      {
        id: 'more-actions',
        label: 'Más acciones',
        items: [
          { id: 'a', label: 'Marcar duplicado', disabled: () => true, disabledLabel: () => 'Disponible en siguiente fase' },
          { id: 'b', label: 'Enviar a enriquecimiento', disabled: () => true, disabledLabel: () => 'Disponible en siguiente fase' },
        ],
      },
    ];

    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        enableRowSelection
        bulkActions={bulkActions}
      />,
    );

    selectAllRows();

    // The group items are not rendered flat in the bar — only the trigger is.
    assert.equal(screen.queryByText('Marcar duplicado'), null);
    const trigger = screen.getByText('Más acciones');
    assert.ok(trigger, '"Más acciones" trigger must render in the bar');

    fireEvent.click(trigger);

    const item = await screen.findByRole('menuitem', { name: /Marcar duplicado/ });
    assert.ok(item, 'sub-item must render inside the dropdown once opened');
    assert.equal(
      item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('data-disabled'),
      true,
      'sub-item must stay disabled',
    );
  });
});
