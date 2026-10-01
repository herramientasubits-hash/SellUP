/**
 * DataTable — la EXPERIENCIA de la tabla de Thema, contrato RUNTIME.
 *
 * Monta la `DataTable` real (motor TanStack) con una tabla mínima y fija lo
 * que la dueña espera ver y poder hacer:
 *
 *   1. Cabecera: la etiqueta ordena al pulsarla (sin orden → asc → desc → sin
 *      orden) y la celda lo anuncia con `aria-sort`.
 *   2. Embudo: visible en las columnas enumerables, ausente en las de texto
 *      libre y en las de solo orden; abre casillas con recuento, cuenta lo
 *      elegido y se limpia.
 *   3. Filtros activos: chips «Columna: valor ×» y «Limpiar todo».
 *   4. Panel «Configurar tabla»: ocultar, fijar, cambiar el modo de filas,
 *      restablecer, y persistencia por `tableId`.
 *   5. Menú de selección en la cabecera (paginado) y casilla simple (scroll
 *      infinito); picar en la fila la marca.
 *   6. Pie: «Mostrando n de N <sustantivo>» / «Página x de y · N <sustantivo>».
 *   7. Acciones «en el layout» y «menú en cada fila».
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
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
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ColumnDef } from '@tanstack/react-table';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

let DataTable: (typeof import('../data-table'))['DataTable'];
let DataTableColumnHeader: (typeof import('../data-table-column-header'))['DataTableColumnHeader'];
type DataTableBulkAction<T> = import('../data-table').DataTableBulkAction<T>;
type DataTableProps = Parameters<typeof DataTable<Company>>[0];

interface Company {
  id: string;
  name: string;
  country: string;
  employees: number;
}

const ROWS: Company[] = [
  { id: '1', name: 'Delta SA', country: 'CO', employees: 40 },
  { id: '2', name: 'Acme SA', country: 'MX', employees: 900 },
  { id: '3', name: 'Cobre SA', country: 'CO', employees: 12 },
  { id: '4', name: 'Bruma SA', country: 'PE', employees: 300 },
  { id: '5', name: 'Eco SA', country: 'CO', employees: 75 },
];

const STORAGE_KEY = 'sellup:table:companies-test';

function buildColumns(): ColumnDef<Company, unknown>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Empresa" />,
      cell: ({ row }) => row.original.name,
      enableHiding: false,
      // Texto libre: se ordena, no se filtra por valores.
      meta: { label: 'Empresa', disableFilter: true },
    },
    {
      id: 'country',
      accessorKey: 'country',
      header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
      cell: ({ row }) => row.original.country,
      meta: {
        label: 'País',
        filterOptions: [
          { value: 'CO', label: 'Colombia' },
          { value: 'MX', label: 'México' },
          { value: 'PE', label: 'Perú' },
        ],
      },
    },
    {
      id: 'employees',
      accessorKey: 'employees',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Empleados" />,
      cell: ({ row }) => String(row.original.employees),
      enableColumnFilter: false,
      meta: { label: 'Empleados', disableFilter: true },
    },
  ];
}

function renderTable(props: Partial<DataTableProps> = {}) {
  return render(
    <DataTable<Company>
      columns={buildColumns()}
      data={ROWS}
      getRowId={(row) => row.id}
      title="Listado de empresas"
      count={ROWS.length}
      noun="empresas"
      nounGender="f"
      {...props}
    />,
  );
}

/** Los nombres de empresa, en el orden en que la tabla pinta las filas. */
function visibleNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr td'))
    .map((cell) => cell.textContent ?? '')
    .filter((text) => / SA$/.test(text));
}

function headerCell(columnId: string): HTMLElement {
  const cell = document.querySelector<HTMLElement>(`th[data-column-id="${columnId}"]`);
  assert.ok(cell, `debe existir la cabecera de ${columnId}`);
  return cell;
}

/** Cuántas filas dice la barra flotante que hay marcadas, o null si no hay barra. */
function bulkBarCount(): number | null {
  const label = screen.queryByText('Seleccionados');
  if (!label) return null;
  return Number(label.previousElementSibling?.textContent);
}

/** Abre el menú de selección de la cabecera, elige una opción y espera a que se cierre. */
async function chooseFromSelectionMenu(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Opciones de selección' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
  await waitFor(() => assert.equal(screen.queryByRole('menu'), null));
}

async function openConfig(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Configurar la tabla/ }));
  await screen.findByText('Configurar tabla');
}

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ DataTable } = await import('../data-table'));
  ({ DataTableColumnHeader } = await import('../data-table-column-header'));
});

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('DataTable — cabecera de columna: ordenar con un clic', () => {
  it('la etiqueta alterna sin orden → ascendente → descendente → sin orden, y la celda lo anuncia', () => {
    renderTable();
    const original = ['Delta SA', 'Acme SA', 'Cobre SA', 'Bruma SA', 'Eco SA'];
    assert.deepEqual(visibleNames(), original);
    assert.equal(headerCell('name').getAttribute('aria-sort'), 'none');

    const sortButton = screen.getByRole('button', { name: 'Empresa' });

    fireEvent.click(sortButton);
    assert.deepEqual(visibleNames(), ['Acme SA', 'Bruma SA', 'Cobre SA', 'Delta SA', 'Eco SA']);
    assert.equal(headerCell('name').getAttribute('aria-sort'), 'ascending');

    fireEvent.click(sortButton);
    assert.deepEqual(visibleNames(), ['Eco SA', 'Delta SA', 'Cobre SA', 'Bruma SA', 'Acme SA']);
    assert.equal(headerCell('name').getAttribute('aria-sort'), 'descending');

    fireEvent.click(sortButton);
    assert.deepEqual(visibleNames(), original);
    assert.equal(headerCell('name').getAttribute('aria-sort'), 'none');
  });

  it('una columna numérica también ordena de menor a mayor en el primer clic', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    assert.deepEqual(visibleNames(), ['Cobre SA', 'Delta SA', 'Eco SA', 'Bruma SA', 'Acme SA']);
  });
});

describe('DataTable — embudo de columna', () => {
  it('está a la vista solo en las columnas enumerables', () => {
    renderTable();
    assert.ok(screen.getByRole('button', { name: 'Filtrar por País' }));
    assert.equal(screen.queryByRole('button', { name: /Filtrar por Empresa/ }), null, 'texto libre: sin embudo');
    assert.equal(screen.queryByRole('button', { name: /Filtrar por Empleados/ }), null, 'numérica: solo orden');
  });

  it('abre casillas con recuento, filtra al marcar, cuenta lo elegido y se limpia', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por País' }));

    const colombia = await screen.findByRole('checkbox', { name: /Colombia/ });
    const optionRow = colombia.closest('label');
    assert.ok(optionRow);
    assert.match(optionRow.textContent ?? '', /Colombia\s*3/, 'cada opción dice cuántas filas tiene');
    assert.equal(screen.queryByText(/Limpiar filtros/), null, 'sin filtros no hay nada que limpiar');

    fireEvent.click(colombia);
    assert.deepEqual(visibleNames(), ['Delta SA', 'Cobre SA', 'Eco SA']);

    const funnel = screen.getByRole('button', { name: /Filtrar por País \(1 elegido\)/ });
    assert.equal(funnel.textContent, '1', 'el embudo muestra cuántos valores hay elegidos');
    assert.match(funnel.className, /bg-primary\/10/);
    assert.match(funnel.className, /text-primary/);

    fireEvent.click(screen.getByRole('checkbox', { name: /México/ }));
    assert.deepEqual(visibleNames(), ['Delta SA', 'Acme SA', 'Cobre SA', 'Eco SA']);

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros (2)' }));
    assert.equal(visibleNames().length, 5);
    assert.ok(screen.getByRole('button', { name: 'Filtrar por País' }), 'el embudo vuelve a su estado neutro');
  });

  it('con más de ocho opciones trae su propio buscador', async () => {
    const options = Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: `Opción ${i}` }));
    const columns = buildColumns();
    columns[1] = { ...columns[1], meta: { label: 'País', filterOptions: options } };
    renderTable({ columns });

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por País' }));
    const search = await screen.findByRole('textbox', { name: 'Buscar en País' });
    fireEvent.change(search, { target: { value: 'opción 7' } });

    assert.equal(screen.getAllByRole('checkbox').length, 1);
    assert.ok(screen.getByRole('checkbox', { name: /Opción 7/ }));
  });
});

describe('DataTable — filtros activos a la vista', () => {
  it('sin filtros la fila de chips no existe', () => {
    renderTable();
    assert.equal(screen.queryByRole('group', { name: 'Filtros activos' }), null);
  });

  it('pinta un chip por valor y por búsqueda, y se quitan uno a uno o todos', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por País' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Colombia/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Perú/ }));

    const chips = screen.getByRole('group', { name: 'Filtros activos' });
    assert.ok(within(chips).getByText('País: Colombia'));
    assert.ok(within(chips).getByText('País: Perú'));
    assert.equal(visibleNames().length, 4);
    assert.equal(
      screen.getByText('Listado de empresas').parentElement?.textContent,
      'Listado de empresas4',
      'el total junto al título es el de lo filtrado',
    );

    fireEvent.click(within(chips).getByRole('button', { name: 'Eliminar País: Perú' }));
    assert.deepEqual(visibleNames(), ['Delta SA', 'Cobre SA', 'Eco SA']);

    fireEvent.click(screen.getByRole('button', { name: 'Buscar en empresas' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en empresas' }), { target: { value: 'cobre' } });
    assert.ok(within(screen.getByRole('group', { name: 'Filtros activos' })).getByText('Búsqueda: cobre'));
    assert.deepEqual(visibleNames(), ['Cobre SA']);

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar todo' }));
    assert.equal(visibleNames().length, 5);
    assert.equal(screen.queryByRole('group', { name: 'Filtros activos' }), null);
  });
});

describe('DataTable — panel «Configurar tabla»', () => {
  it('oculta y vuelve a mostrar una columna; la que no se puede ocultar está bloqueada', async () => {
    renderTable({ tableId: 'companies-test' });
    await openConfig();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar la columna País' }));
    assert.equal(document.querySelector('th[data-column-id="country"]'), null);
    assert.equal(screen.queryByRole('button', { name: 'Filtrar por País' }), null);

    const lockedEye = screen.getByRole('button', { name: 'Ocultar la columna Empresa' });
    assert.equal((lockedEye as HTMLButtonElement).disabled, true, 'Empresa declara enableHiding: false');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todas' }));
    assert.ok(headerCell('country'));
  });

  it('fijar una columna la lleva al principio y la deja quieta a la izquierda', async () => {
    renderTable({ tableId: 'companies-test' });
    await openConfig();

    fireEvent.click(screen.getByRole('button', { name: 'Fijar la columna Empleados' }));

    const order = Array.from(document.querySelectorAll('th[data-column-id]')).map((th) =>
      th.getAttribute('data-column-id'),
    );
    assert.deepEqual(order, ['employees', 'name', 'country']);
    assert.equal(
      screen.getByRole('button', { name: 'Soltar la columna Empleados' }).getAttribute('aria-pressed'),
      'true',
    );
  });

  it('cambia entre scroll infinito y paginación', async () => {
    renderTable({ tableId: 'companies-test', initialPageSize: 2 });
    assert.ok(screen.getByText('Mostrando 2 de 5 empresas'), 'de fábrica: scroll infinito');

    await openConfig();
    fireEvent.click(screen.getByRole('button', { name: /Paginación/ }));

    assert.ok(screen.getByText('Página 1 de 3 · 5 empresas'));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    assert.ok(screen.getByText('Página 2 de 3 · 5 empresas'));
    assert.deepEqual(visibleNames(), ['Cobre SA', 'Bruma SA']);
  });

  it('marca el botón como modificado y «Restablecer» vuelve a fábrica', async () => {
    renderTable({ tableId: 'companies-test' });
    assert.ok(screen.getByRole('button', { name: 'Configurar la tabla' }));
    await openConfig();
    assert.equal(screen.queryByRole('button', { name: 'Restablecer' }), null);

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar la columna Empleados' }));
    assert.ok(screen.getByRole('button', { name: 'Configurar la tabla (modificada)' }));
    assert.ok(document.querySelector('[data-slot="table-config-dirty"]'), 'punto de «modificada»');

    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    assert.ok(headerCell('employees'));
    assert.ok(screen.getByRole('button', { name: 'Configurar la tabla' }));
    assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
  });

  it('recuerda la configuración por tableId y la aplica al volver a montar', async () => {
    renderTable({ tableId: 'companies-test', initialPageSize: 2 });
    await openConfig();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar la columna Empleados' }));
    fireEvent.click(screen.getByRole('button', { name: /Paginación/ }));

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as {
      hidden: string[];
      mode: string;
    };
    assert.deepEqual(stored.hidden, ['employees']);
    assert.equal(stored.mode, 'paged');

    cleanup();
    renderTable({ tableId: 'companies-test', initialPageSize: 2 });
    assert.equal(document.querySelector('th[data-column-id="employees"]'), null);
    assert.ok(screen.getByText('Página 1 de 3 · 5 empresas'));

    cleanup();
    renderTable({ tableId: 'otra-tabla', initialPageSize: 2 });
    assert.ok(headerCell('employees'), 'otra tabla no hereda la configuración');
    assert.ok(screen.getByText('Mostrando 2 de 5 empresas'));
  });

  it('sin tableId funciona igual pero no guarda nada', async () => {
    renderTable();
    await openConfig();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar la columna Empleados' }));
    assert.equal(document.querySelector('th[data-column-id="employees"]'), null);
    assert.equal(window.localStorage.length, 0);
  });

  it('ofrece «Lista» solo si la pantalla sabe dibujar una fila de lista', async () => {
    renderTable();
    await openConfig();
    assert.equal(screen.queryByText('Cómo se ven'), null);
    cleanup();

    renderTable({ renderListItem: (row) => <p data-testid="list-row">{row.name}</p> });
    await openConfig();
    assert.ok(screen.getByText('Cómo se ven'));
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    assert.equal(screen.getAllByTestId('list-row').length, 5);
    assert.equal(document.querySelector('table'), null);
  });

  it('las secciones propias de la pantalla viven dentro del panel', async () => {
    renderTable({ settingsExtraSections: <p>Filtros de alcance</p> });
    assert.equal(screen.queryByText('Filtros de alcance'), null);
    await openConfig();
    assert.ok(screen.getByText('Filtros de alcance'));
  });
});

describe('DataTable — selección', () => {
  it('en scroll infinito la casilla de cabecera marca todo lo cargado y lo suelta', () => {
    renderTable({ enableRowSelection: true, initialPageSize: 2 });
    const header = screen.getByRole('checkbox', { name: 'Seleccionar todos (2)' });

    fireEvent.click(header);
    assert.equal(document.querySelectorAll('tbody tr[data-state="selected"]').length, 2);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos (2)' }));
    assert.equal(document.querySelectorAll('tbody tr[data-state="selected"]').length, 0);
  });

  it('paginado, la cabecera abre el menú «esta página / todos»', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'paged' }));
    renderTable({
      tableId: 'companies-test',
      enableRowSelection: true,
      initialPageSize: 2,
      bulkActions: [{ id: 'noop', label: 'Ver detalle', onClick: () => {} }],
    });

    await chooseFromSelectionMenu('Seleccionar esta página (2)');
    assert.equal(document.querySelectorAll('tbody tr[data-state="selected"]').length, 2);
    assert.equal(bulkBarCount(), 2);

    await chooseFromSelectionMenu('Seleccionar todos (5)');
    assert.equal(bulkBarCount(), 5, 'todas las páginas');

    await chooseFromSelectionMenu('Deseleccionar esta página');
    assert.equal(bulkBarCount(), 3);

    await chooseFromSelectionMenu('Deseleccionar todos');
    assert.equal(bulkBarCount(), null, 'sin selección no hay barra');
  });

  it('picar en la fila la marca cuando la tabla no tiene onRowClick', () => {
    renderTable({ enableRowSelection: true });
    fireEvent.click(screen.getByText('Acme SA'));
    const row = screen.getByText('Acme SA').closest('tr');
    assert.equal(row?.getAttribute('data-state'), 'selected');

    fireEvent.click(screen.getByText('Acme SA'));
    assert.equal(row?.getAttribute('data-state'), null);
  });

  it('con onRowClick, picar en la fila abre el detalle y NO la marca', () => {
    const opened: string[] = [];
    renderTable({ enableRowSelection: true, rowClickable: true, onRowClick: (row) => opened.push(row.id) });
    fireEvent.click(screen.getByText('Acme SA'));
    assert.deepEqual(opened, ['2']);
    assert.equal(screen.getByText('Acme SA').closest('tr')?.getAttribute('data-state'), null);
  });
});

describe('DataTable — pie', () => {
  it('en scroll infinito resume lo cargado y «Cargar más» trae el siguiente tramo', () => {
    renderTable({ initialPageSize: 2 });
    assert.ok(screen.getByText('Mostrando 2 de 5 empresas'));

    fireEvent.click(screen.getByRole('button', { name: 'Cargar más empresas' }));
    assert.ok(screen.getByText('Mostrando 4 de 5 empresas'));

    fireEvent.click(screen.getByRole('button', { name: 'Cargar más empresas' }));
    assert.ok(screen.getByText('Mostrando 5 de 5 empresas'));
    assert.equal(screen.queryByRole('button', { name: 'Cargar más empresas' }), null);
  });

  it('el tramo cargado se corta después de filtrar y ordenar, no antes', () => {
    renderTable({ initialPageSize: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Empresa' }));
    assert.deepEqual(visibleNames(), ['Acme SA', 'Bruma SA'], 'ordena toda la lista, no solo lo cargado');
  });
});

describe('DataTable — dónde van las acciones y cómo se actúa sobre una fila', () => {
  const calls: string[][] = [];
  const bulkActions: DataTableBulkAction<Company>[] = [
    { id: 'export', label: 'Exportar', onClick: (rows) => void calls.push(rows.map((row) => row.id)) },
    { id: 'one', label: 'Ver detalle', disabled: (rows) => rows.length !== 1, onClick: () => {} },
  ];
  const contextMenu = {
    items: (row: Company) => [{ id: 'edit', label: 'Editar', onClick: () => void calls.push([`edit:${row.id}`]) }],
  };

  beforeEach(() => {
    calls.length = 0;
  });

  it('«En el layout»: la cabecera se transforma con la selección y lleva las acciones', async () => {
    const reported: number[] = [];
    renderTable({
      enableRowSelection: true,
      bulkActions,
      onSelectionCountChange: (count) => reported.push(count),
    });

    await openConfig();
    fireEvent.click(screen.getByRole('button', { name: /En el layout/ }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos (5)' }));
    assert.ok(screen.getByText('5 seleccionadas'));
    assert.equal(screen.queryByText('Seleccionados'), null, 'sin barra flotante');
    assert.equal(screen.queryByText('Listado de empresas'), null, 'el título deja paso');
    assert.equal(reported.at(-1), 0, 'la pantalla no cede su barra: no hay barra masiva');
    assert.equal((screen.getByRole('button', { name: 'Ver detalle' }) as HTMLButtonElement).disabled, true);

    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    assert.deepEqual(calls, [['1', '2', '3', '4', '5']]);

    fireEvent.click(screen.getByRole('button', { name: 'Soltar la selección' }));
    assert.ok(screen.getByText('Listado de empresas'));
  });

  it('«En la barra flotante» (de fábrica) avisa a la pantalla de cuántas hay marcadas', () => {
    const reported: number[] = [];
    renderTable({
      enableRowSelection: true,
      bulkActions,
      onSelectionCountChange: (count) => reported.push(count),
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos (5)' }));
    assert.equal(reported.at(-1), 5);
    assert.ok(screen.getByText('Seleccionados'));
  });

  it('«Menú en cada fila»: sin casillas, cada fila lleva sus acciones', async () => {
    renderTable({ enableRowSelection: true, bulkActions, contextMenu, getRowLabel: (row) => row.name });
    await openConfig();
    fireEvent.click(screen.getByRole('button', { name: /Menú en cada fila/ }));

    assert.equal(screen.queryAllByRole('checkbox').length, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Acme SA' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    assert.deepEqual(calls, [['edit:2']]);
  });

  it('el menú contextual se engancha a la propia fila: sin <div> dentro del <tbody>', () => {
    renderTable({ enableRowSelection: true, contextMenu });
    assert.equal(document.querySelector('tbody > div'), null, 'HTML válido: nada entre <tbody> y <tr>');

    // (Abrir el menú con clic derecho no se puede probar aquí: Radix crea sus
    // eventos con la clase `Event` de Node y jsdom los rechaza.)
    const row = screen.getByText('Acme SA').closest('tr');
    assert.ok(row);
    assert.equal(row.parentElement?.tagName, 'TBODY');
    assert.equal(row.getAttribute('data-state'), null, 'sin marcar no hereda el estado del menú');

    // La fila sigue marcándose como seleccionada aunque sea el disparador del menú.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos (5)' }));
    assert.equal(row.getAttribute('data-state'), 'selected');
  });

  it('no ofrece esas dos preguntas donde no aplican', async () => {
    renderTable();
    await openConfig();
    assert.equal(screen.queryByText('Dónde van las acciones'), null);
    assert.equal(screen.queryByText('Cómo se actúa sobre una fila'), null);
  });
});
