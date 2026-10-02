/**
 * Q3F-5AZ.2E-1-UX1 — generic DataTable capabilities RUNTIME contract.
 *
 * Renders the ACTUAL `DataTable` (not the Prospectos surface) with a minimal
 * fixture table to pin two reusable primitives. Since the Thema action rail,
 * the selection lives in the single floating rail (`DataListActionRail`): the
 * count is a chip («2 seleccionados») and each bulk action is an icon button
 * named by its label.
 *
 *   1. `DataTableHandle.clearSelection()` (exposed via ref) resets the row
 *      selection, which takes the selection out of the rail — the mechanism
 *      `ProspectsDataTableClient` uses to avoid showing the selection actions
 *      and the side panel footer at the same time.
 *   2. A `DataTableBulkAction` with `items` renders as a menu trigger
 *      ("Más acciones" style) instead of a flat button, with each item
 *      carrying its own independent disabled/disabledLabel state.
 *   3. `disabled` / `disabledLabel` / `confirm` / `scope` keep their meaning
 *      when the bulk actions are translated to rail actions.
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

/** El recuento de la barra («2 seleccionados»), o null si no hay selección en la barra. */
const SELECTION_CHIP = /^\d+ seleccionad[oa]s?$/;

describe('DataTable — clearSelection ref takes the selection out of the rail', () => {
  it('selecting rows shows the count chip, and ref.clearSelection() removes it again', () => {
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

    assert.equal(screen.queryByText(SELECTION_CHIP), null, 'no rail with no selection');

    selectAllRows();
    assert.equal(screen.getByText(SELECTION_CHIP).textContent, '2 seleccionados');
    assert.ok(screen.getByRole('button', { name: 'Ver detalle' }), 'the bulk action is a rail button');

    assert.ok(ref.current, 'DataTableHandle must be attached to the ref');
    React.act(() => {
      ref.current!.clearSelection();
    });

    assert.equal(
      screen.queryByText(SELECTION_CHIP),
      null,
      'the selection must leave the rail once it is cleared via the ref — this is the mechanism ' +
        'ProspectsDataTableClient uses so opening the side panel never leaves the ' +
        'selection actions visible underneath it',
    );
    assert.equal(screen.queryByRole('button', { name: 'Ver detalle' }), null);
  });

  it('the chip\'s ✕ clears the selection too', () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        enableRowSelection
        bulkActions={[{ id: 'noop', label: 'Ver detalle', onClick: () => {} }]}
      />,
    );
    selectAllRows();

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));

    assert.equal(screen.queryByText(SELECTION_CHIP), null);
    assert.equal(
      screen.getAllByRole('checkbox').some((checkbox) => checkbox.getAttribute('aria-checked') === 'true'),
      false,
      'no row stays ticked',
    );
  });
});

describe('DataTable — bulk actions keep their rules in the rail', () => {
  it('runs the action with exactly the selected rows', () => {
    const received: string[][] = [];
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        enableRowSelection
        bulkActions={[{ id: 'export', label: 'Exportar', onClick: (rows) => void received.push(rows.map((row) => row.id)) }]}
      />,
    );

    fireEvent.click(screen.getAllByRole('checkbox')[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));

    assert.deepEqual(received, [['2']]);
  });

  it('a disabled action stays visible, blocked, and never runs', () => {
    let calls = 0;
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        enableRowSelection
        bulkActions={[
          {
            id: 'approve',
            label: 'Aprobar',
            disabled: (rows) => rows.length !== 1,
            disabledLabel: (rows) => (rows.length > 1 ? 'Aprobación masiva pendiente' : undefined),
            onClick: () => void calls++,
          },
        ]}
      />,
    );
    selectAllRows();

    const button = screen.getByRole('button', { name: 'Aprobar' });
    fireEvent.click(button);

    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(calls, 0);
  });

  it('`scope: ["single"]` drops the action from the rail with several rows selected', () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        enableRowSelection
        bulkActions={[
          { id: 'edit', label: 'Editar', scope: ['single'], onClick: () => {} },
          { id: 'archive', label: 'Archivar', countInLabel: true, onClick: () => {} },
        ]}
      />,
    );

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    assert.ok(screen.getByRole('button', { name: 'Editar' }));
    assert.ok(screen.getByRole('button', { name: 'Archivar' }));

    fireEvent.click(screen.getAllByRole('checkbox')[2]);
    assert.equal(screen.queryByRole('button', { name: 'Editar' }), null);
    assert.ok(screen.getByRole('button', { name: 'Archivar (2)' }));
  });

  it('an action with `confirm` asks first and only runs after confirming', async () => {
    const received: number[] = [];
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        enableRowSelection
        bulkActions={[
          {
            id: 'archive',
            label: 'Archivar',
            variant: 'destructive',
            confirm: {
              title: '¿Archivar las empresas?',
              description: (rows) => `Se archivarán ${rows.length}.`,
              confirmLabel: 'Sí, archivar',
            },
            onClick: (rows) => void received.push(rows.length),
          },
        ]}
      />,
    );
    selectAllRows();

    fireEvent.click(screen.getByRole('button', { name: 'Archivar' }));
    assert.deepEqual(received, [], 'nothing runs before confirming');
    assert.ok(await screen.findByText('Se archivarán 2.'));

    fireEvent.click(screen.getByRole('button', { name: 'Sí, archivar' }));
    assert.deepEqual(received, [2]);
  });
});

describe('DataTable — bulk action "items" render as a menu group', () => {
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

    // The group items are not rendered flat in the rail — only the trigger is.
    assert.equal(screen.queryByText('Marcar duplicado'), null);
    const trigger = screen.getByRole('button', { name: 'Más acciones' });
    assert.ok(trigger, '"Más acciones" trigger must render in the rail');

    fireEvent.click(trigger);

    const item = (await screen.findByRole('button', { name: 'Marcar duplicado' })) as HTMLButtonElement;
    assert.ok(item, 'sub-item must render inside the menu once opened');
    assert.equal(item.disabled, true, 'sub-item must stay disabled');
    assert.equal(screen.getAllByText('Disponible en siguiente fase').length, 2, 'each blocked item explains why');
  });
});
