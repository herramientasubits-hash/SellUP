/**
 * Piezas de tabla portadas de Thema (`RowActionsMenu`, `TableConfigButton`,
 * `useTableConfig`, controles de cabecera) — contrato RUNTIME, sin el motor
 * de `DataTable`.
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

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

let RowActionsMenu: (typeof import('../row-actions-menu'))['RowActionsMenu'];
let TableConfigButton: (typeof import('../table-config-button'))['TableConfigButton'];
let useTableConfig: (typeof import('../use-table-config'))['useTableConfig'];
let reconcileOrder: (typeof import('../use-table-config'))['reconcileOrder'];
let SelectionHeaderMenu: (typeof import('../table-header-controls'))['SelectionHeaderMenu'];
let SortOnlyHeader: (typeof import('../table-header-controls'))['SortOnlyHeader'];
type TableColumnSpec = import('../use-table-config').TableColumnSpec;
type TableConfig = import('../use-table-config').TableConfig;

const SPECS: TableColumnSpec[] = [
  { id: 'select', label: 'Selección', fixed: true },
  { id: 'name', label: 'Empresa', hideable: false },
  { id: 'country', label: 'País' },
  { id: 'notes', label: 'Notas', hiddenByDefault: true },
];

let latest: TableConfig;
function ConfigHarness({ tableId, specs = SPECS }: { tableId?: string; specs?: TableColumnSpec[] }) {
  const config = useTableConfig(tableId, specs);
  // En un efecto: reasignar algo de fuera durante el render no es puro.
  React.useEffect(() => {
    latest = config;
  });
  return (
    <div>
      <p data-testid="order">{config.columns.map((column) => column.id).join(',')}</p>
      <TableConfigButton config={config} noun="empresas" />
    </div>
  );
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ RowActionsMenu } = await import('../row-actions-menu'));
  ({ TableConfigButton } = await import('../table-config-button'));
  ({ useTableConfig, reconcileOrder } = await import('../use-table-config'));
  ({ SelectionHeaderMenu, SortOnlyHeader } = await import('../table-header-controls'));
});

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('reconcileOrder — el orden guardado frente a las columnas de hoy', () => {
  it('sin nada guardado devuelve el orden declarado', () => {
    assert.deepEqual(reconcileOrder([], ['a', 'b', 'c']), ['a', 'b', 'c']);
  });

  it('respeta el orden guardado, mete una columna nueva en su sitio natural y descarta las que ya no existen', () => {
    // «b» es nueva: entra delante de la primera columna declarada después que ella.
    assert.deepEqual(reconcileOrder(['c', 'a', 'vieja'], ['a', 'b', 'c']), ['b', 'c', 'a']);
    assert.deepEqual(reconcileOrder(['b', 'a'], ['a', 'b', 'c']), ['b', 'a', 'c']);
  });

  it('ignora ids repetidos', () => {
    assert.deepEqual(reconcileOrder(['b', 'b', 'a'], ['a', 'b']), ['b', 'a']);
  });
});

describe('useTableConfig', () => {
  it('de fábrica: columnas visibles en el orden declarado, scroll infinito, sin marcar como modificada', () => {
    render(<ConfigHarness tableId="t1" />);
    assert.equal(screen.getByTestId('order').textContent, 'name,country');
    assert.equal(latest.mode, 'lazy');
    assert.equal(latest.rowControl, 'checkbox');
    assert.equal(latest.isDirty, false);
    assert.deepEqual(latest.fixedColumns.map((column) => column.id), ['select']);
  });

  it('«Dónde van las acciones» ya no es de la tabla: un valor viejo guardado se ignora sin romper', async () => {
    // Antes se guardaba por tabla; ahora es una preferencia global de la persona.
    window.localStorage.setItem('sellup:table:t1', JSON.stringify({ mode: 'paged', actions: 'inline' }));
    render(<ConfigHarness tableId="t1" />);
    assert.equal(latest.mode, 'paged', 'el resto de lo guardado se respeta');
    assert.equal('actions' in latest, false);
    assert.equal('setActions' in latest, false);

    fireEvent.click(screen.getByRole('button', { name: /Configurar la tabla/ }));
    await screen.findByText('Configurar tabla');
    assert.equal(screen.queryByText('Dónde van las acciones'), null);
    assert.equal(screen.queryByRole('button', { name: /En el layout|En la barra flotante/ }), null);
  });

  it('una columna con hideable: false no se oculta', () => {
    render(<ConfigHarness tableId="t1" />);
    React.act(() => latest.toggleVisibility('name'));
    assert.equal(latest.hidden.has('name'), false);
  });

  it('fijar una columna oculta la devuelve a la vista; ocultar una fijada la suelta', () => {
    render(<ConfigHarness tableId="t1" />);
    React.act(() => latest.togglePin('notes'));
    assert.equal(latest.hidden.has('notes'), false);
    assert.deepEqual(latest.pinnedOrder, ['notes']);

    React.act(() => latest.toggleVisibility('notes'));
    assert.equal(latest.hidden.has('notes'), true);
    assert.deepEqual(latest.pinnedOrder, []);
  });

  it('lo guardado ilegible o con valores desconocidos no rompe la tabla', () => {
    window.localStorage.setItem('sellup:table:t1', '{no es json');
    render(<ConfigHarness tableId="t1" />);
    assert.equal(screen.getByTestId('order').textContent, 'name,country');
    cleanup();

    window.localStorage.setItem(
      'sellup:table:t1',
      JSON.stringify({ mode: 'raro', hidden: ['name', 'inexistente', 7], order: ['country', 'name', 'notes'] }),
    );
    render(<ConfigHarness tableId="t1" />);
    assert.equal(
      screen.getByTestId('order').textContent,
      'country,name,notes',
      'respeta el orden guardado; «name» no se puede ocultar y lo guardado manda sobre lo oculto de fábrica',
    );
    assert.equal(latest.mode, 'lazy');
  });

  it('una columna nueva que arranca oculta no le aparece a quien ya tenía la tabla configurada', () => {
    // Guardado antes de que existiera «notes»: no está en su orden.
    window.localStorage.setItem('sellup:table:t1', JSON.stringify({ hidden: [], order: ['country', 'name'] }));
    render(<ConfigHarness tableId="t1" />);
    assert.equal(screen.getByTestId('order').textContent, 'country,name');
    assert.equal(latest.hidden.has('notes'), true);

    // Y en cuanto la persona la pide, queda pedida.
    React.act(() => latest.toggleVisibility('notes'));
    assert.equal(latest.hidden.has('notes'), false);
    assert.equal(screen.getByTestId('order').textContent, 'country,name,notes');
  });
});

describe('TableConfigButton', () => {
  it('agrupa bajo su objeto las columnas que declaran grupo; las demás van arriba', async () => {
    const specs: TableColumnSpec[] = [
      { id: 'name', label: 'Nombre', hideable: false },
      { id: 'email', label: 'Correo', group: 'Contacto', hiddenByDefault: true },
      { id: 'domain', label: 'Dominio de la empresa', group: 'Empresa', hiddenByDefault: true },
      { id: 'phone', label: 'Teléfono', group: 'Contacto', hiddenByDefault: true },
    ];
    render(<ConfigHarness tableId="grouped" specs={specs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configurar la tabla' }));
    await screen.findByText('Configurar tabla');

    const contacto = screen.getByText('Contacto').closest('li');
    const empresa = screen.getByText('Empresa').closest('li');
    assert.ok(contacto && empresa);
    const labelsIn = (el: Element) =>
      Array.from(el.querySelectorAll('li[data-column]')).map((li) => li.getAttribute('data-column'));
    assert.deepEqual(labelsIn(contacto), ['email', 'phone']);
    assert.deepEqual(labelsIn(empresa), ['domain']);
    assert.equal(screen.getByTestId('order').textContent, 'name', 'las agrupadas arrancan ocultas');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar la columna Correo' }));
    assert.equal(screen.getByTestId('order').textContent, 'name,email');
  });

  it('lista las columnas fijas con candado y arrastrar una fila del panel cambia el orden', async () => {
    render(<ConfigHarness tableId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Configurar la tabla' }));
    await screen.findByText('Configurar tabla');

    assert.ok(screen.getByText('Fija'), 'la columna de selección aparece como fija');

    // En jsdom las cajas miden cero: soltar cae «después» del blanco.
    const handle = screen.getByRole('button', { name: 'Mover Empresa' });
    const target = document.querySelector('li[data-column="country"]');
    assert.ok(target);
    fireEvent.dragStart(handle);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    assert.equal(screen.getByTestId('order').textContent, 'country,name');
    assert.ok(screen.getByRole('button', { name: 'Configurar la tabla (modificada)' }));
  });
});

describe('RowActionsMenu', () => {
  it('sin acciones no pinta nada', () => {
    const { container } = render(<RowActionsMenu actions={[]} />);
    assert.equal(container.innerHTML, '');
  });

  it('nombra la fila, ejecuta la acción y deja apagada la bloqueada con su motivo', async () => {
    const calls: string[] = [];
    render(
      <RowActionsMenu
        rowLabel="Acme SA"
        actions={[
          { id: 'edit', label: 'Editar', onSelect: () => calls.push('edit') },
          { id: 'archive', label: 'Archivar', tone: 'danger', blockedReason: 'Solo un administrador', onSelect: () => calls.push('archive') },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Acme SA' }));
    const blocked = await screen.findByRole('menuitem', { name: 'Archivar' });
    assert.equal(blocked.getAttribute('title'), 'Solo un administrador');
    assert.equal(blocked.getAttribute('aria-disabled') === 'true' || blocked.hasAttribute('data-disabled'), true);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }));
    assert.deepEqual(calls, ['edit']);
  });
});

describe('controles de cabecera', () => {
  it('SelectionHeaderMenu sin páginas es una casilla: marca todo y, marcada, lo suelta', () => {
    const calls: string[] = [];
    const props = {
      paged: false,
      pageCount: 3,
      matchCount: 3,
      showSelectPage: true,
      showSelectAll: true,
      showDeselectPage: false,
      showDeselectAll: true,
      onSelectPage: () => calls.push('page'),
      onSelectAll: () => calls.push('all'),
      onDeselectPage: () => calls.push('unpage'),
      onDeselectAll: () => calls.push('none'),
    };
    const { rerender } = render(<SelectionHeaderMenu {...props} state="indeterminate" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos (3)' }));
    assert.deepEqual(calls, ['all'], '«algunas» cuenta como «no todas»');

    rerender(<SelectionHeaderMenu {...props} state />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos (3)' }));
    assert.deepEqual(calls, ['all', 'none']);
  });

  it('SortOnlyHeader no ofrece embudo y marca el sentido del orden', () => {
    let clicks = 0;
    render(<SortOnlyHeader label="Creación" sort="desc" onSort={() => (clicks += 1)} />);
    const button = screen.getByRole('button', { name: 'Creación' });
    assert.equal(button.getAttribute('data-sort'), 'desc');
    assert.equal(screen.queryByRole('button', { name: /Filtrar por/ }), null);
    fireEvent.click(button);
    assert.equal(clicks, 1);
  });
});
