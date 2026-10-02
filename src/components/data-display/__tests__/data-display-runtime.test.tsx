/**
 * data-display (StatusBadge, TableShell, Timeline, ListItem, Kanban) — contrato RUNTIME.
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

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// next/link necesita el contexto del app-router; en jsdom se pinta como un <a>.
mock.module('next/link', {
  defaultExport: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => React.createElement('a', { href, ...rest }, children),
});
let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let StatusBadge: (typeof import('../status-badge'))['StatusBadge'];
let TableShell: (typeof import('../table-shell'))['TableShell'];
let Timeline: (typeof import('../timeline'))['Timeline'];
let TimelineItem: (typeof import('../timeline'))['TimelineItem'];
let ListItem: (typeof import('../list-item'))['ListItem'];
let ListItemGroup: (typeof import('../list-item'))['ListItemGroup'];
let Kanban: (typeof import('../kanban'))['Kanban'];
type StatusType = import('../status-badge').StatusType;
type KanbanItem = import('../kanban').KanbanItem;

const h = React.createElement;

/** `createElement` para componentes cuyo `children` es obligatorio en sus props. */
function el<P extends { children?: unknown }>(
  type: React.ComponentType<P>,
  props: Omit<P, 'children'> | null,
  ...children: React.ReactNode[]
): React.ReactElement {
  return React.createElement(type as unknown as React.ComponentType<object>, props, ...children);
}

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ StatusBadge } = await import('../status-badge'));
  ({ TableShell } = await import('../table-shell'));
  ({ Timeline, TimelineItem } = await import('../timeline'));
  ({ ListItem, ListItemGroup } = await import('../list-item'));
  ({ Kanban } = await import('../kanban'));
});

afterEach(() => {
  cleanup();
});

describe('StatusBadge', () => {
  const DEFAULTS: ReadonlyArray<[StatusType, string, string]> = [
    ['active', 'Activo', 'text-success'],
    ['inactive', 'Inactivo', 'text-muted-foreground'],
    ['pending', 'Pendiente', 'text-warning'],
    ['completed', 'Completado', 'text-success'],
    ['warning', 'Advertencia', 'text-warning'],
    ['error', 'Error', 'text-destructive'],
    ['info', 'Información', 'text-info'],
    ['neutral', 'Neutral', 'text-muted-foreground'],
  ];
  for (const [status, label, toneClass] of DEFAULTS) {
    it(`status="${status}" muestra «${label}» con el tinte ${toneClass}`, () => {
      render(h(StatusBadge, { status }));

      const badge = screen.getByText(label);
      assert.equal(badge.getAttribute('data-status'), status);
      assert.ok(badge.classList.contains(toneClass));
    });
  }

  it('label propio sustituye a la etiqueta por defecto', () => {
    render(h(StatusBadge, { status: 'pending', label: 'En revisión' }));

    assert.ok(screen.getByText('En revisión'));
    assert.equal(screen.queryByText('Pendiente'), null);
  });

  it('un status desconocido cae en el neutro en vez de romper', () => {
    render(h(StatusBadge, { status: 'archived' as unknown as StatusType }));

    assert.ok(screen.getByText('Neutral'));
  });
});

describe('TableShell', () => {
  it('pinta el título como h2 con la descripción y las acciones', () => {
    render(
      el(TableShell,
        {
          title: 'Lotes recientes',
          description: 'Importaciones de las últimas dos semanas.',
          actions: h('button', { type: 'button' }, 'Nuevo lote'),
        },
        h('table', null, h('tbody', null, h('tr', null, h('td', null, 'Lote 1')))),
      ),
    );

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Lotes recientes' }));
    assert.ok(screen.getByText('Importaciones de las últimas dos semanas.'));
    assert.ok(screen.getByRole('button', { name: 'Nuevo lote' }));
    assert.ok(screen.getByText('Lote 1'));
  });

  it('sin título, descripción ni acciones no pinta cabecera', () => {
    const { container } = render(el(TableShell, null, h('p', null, 'cuerpo')));

    assert.equal(container.querySelector('[data-slot="table-shell-header"]'), null);
  });

  it('empty muestra el vacío por defecto y no los hijos', () => {
    render(el(TableShell, { title: 'Lotes', empty: true }, h('p', null, 'Lote 1')));

    assert.ok(screen.getByText('Sin información'));
    assert.equal(screen.queryByText('Lote 1'), null);
  });

  it('el vacío por defecto va sin borde punteado (nunca una caja dentro de otra)', () => {
    const { container } = render(el(TableShell, { empty: true }, h('p', null, 'x')));

    const body = container.querySelector('[data-slot="table-shell-body"]') as HTMLElement;
    assert.equal(body.querySelector('.border-dashed'), null);
  });

  it('emptyState propio sustituye al vacío por defecto', () => {
    render(
      el(TableShell, { empty: true, emptyState: h('p', null, 'Aún no hay lotes') }, h('p', null, 'x')),
    );

    assert.ok(screen.getByText('Aún no hay lotes'));
    assert.equal(screen.queryByText('Sin información'), null);
  });

  it('pinta el pie dentro del marco', () => {
    const { container } = render(el(TableShell, { footer: '3 lotes' }, h('p', null, 'x')));

    const footer = container.querySelector('[data-slot="table-shell-footer"]') as HTMLElement;
    assert.equal(footer.textContent, '3 lotes');
    assert.ok((container.querySelector('[data-slot="table-shell"]') as HTMLElement).contains(footer));
  });

  it('surface="header" descarga el marco y lo refleja en data-surface', () => {
    const { container } = render(el(TableShell, { title: 'Lotes', surface: 'header' }, h('p', null, 'x')));

    const shell = container.querySelector('[data-slot="table-shell"]') as HTMLElement;
    assert.equal(shell.getAttribute('data-surface'), 'header');
    assert.ok(shell.classList.contains('bg-transparent'));
  });
});

describe('Timeline / TimelineItem', () => {
  it('es una lista ordenada que conserva el orden de los eventos', () => {
    render(
      h(
        Timeline,
        null,
        h(TimelineItem, { title: 'Lote aprobado', time: '10:42' }),
        h(TimelineItem, { title: 'Lote creado', time: '09:15' }),
      ),
    );

    const list = screen.getByRole('list');
    assert.equal(list.tagName, 'OL');
    const titles = within(list)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.font-medium')?.textContent);
    assert.deepEqual(titles, ['Lote aprobado', 'Lote creado']);
  });

  it('pinta título, hora y descripción de cada evento', () => {
    render(
      h(
        Timeline,
        null,
        h(TimelineItem, { title: 'Lote aprobado', time: '10:42', description: '12 empresas pasaron a Cuentas.' }),
      ),
    );

    const item = screen.getByRole('listitem');
    assert.ok(within(item).getByText('Lote aprobado'));
    assert.ok(within(item).getByText('10:42'));
    assert.ok(within(item).getByText('12 empresas pasaron a Cuentas.'));
  });

  it('pinta el cuerpo hijo bajo la descripción', () => {
    render(h(Timeline, null, h(TimelineItem, { title: 'Nota' }, h('blockquote', null, 'Llamar el lunes'))));

    assert.ok(screen.getByText('Llamar el lunes'));
  });

  it('refleja el tono en data-tone y oculta el punto a lectores de pantalla', () => {
    render(h(Timeline, null, h(TimelineItem, { title: 'Fallo', tone: 'negative' })));

    const item = screen.getByRole('listitem');
    assert.equal(item.getAttribute('data-tone'), 'negative');
    const dot = item.querySelector('span[aria-hidden="true"]') as HTMLElement;
    assert.ok(dot.classList.contains('text-destructive'));
  });

  it('align="alternate" se refleja en la lista y cambia la rejilla del evento', () => {
    render(h(Timeline, { align: 'alternate' }, h(TimelineItem, { title: 'Evento' })));

    assert.equal(screen.getByRole('list').getAttribute('data-align'), 'alternate');
    assert.ok(screen.getByRole('listitem').classList.contains('grid'));
  });
});

describe('ListItem', () => {
  it('con href la fila es un enlace a ese destino', () => {
    render(h(ListItem, { href: '/accounts/1', title: 'Acme SA', description: 'Tecnología' }));

    const link = screen.getByRole('link', { name: /Acme SA/ });
    assert.equal(link.getAttribute('href'), '/accounts/1');
    assert.ok(within(link).getByText('Tecnología'));
  });

  it('con onClick la fila es un botón que lo llama', () => {
    let clicks = 0;
    render(h(ListItem, { title: 'Acme SA', onClick: () => clicks++ }));

    fireEvent.click(screen.getByRole('button', { name: 'Acme SA' }));

    assert.equal(clicks, 1);
  });

  it('con href y onClick gana el enlace', () => {
    render(h(ListItem, { href: '/accounts/1', title: 'Acme SA', onClick: () => {} }));

    assert.ok(screen.getByRole('link'));
    assert.equal(screen.queryByRole('button'), null);
  });

  it('sin href ni onClick no es interactiva', () => {
    const { container } = render(h(ListItem, { title: 'Acme SA' }));

    assert.equal(screen.queryByRole('link'), null);
    assert.equal(screen.queryByRole('button'), null);
    const row = container.querySelector('[data-slot="list-item"]') as HTMLElement;
    assert.equal(row.hasAttribute('data-interactive'), false);
  });

  it('selected marca la fila y el botón queda con aria-pressed', () => {
    const { container } = render(h(ListItem, { title: 'Acme SA', onClick: () => {}, selected: true }));

    const row = container.querySelector('[data-slot="list-item"]') as HTMLElement;
    assert.equal(row.getAttribute('data-selected'), 'true');
    assert.equal(screen.getByRole('button').getAttribute('aria-pressed'), 'true');
  });

  it('selected en una fila enlace la marca con aria-current', () => {
    render(h(ListItem, { href: '/accounts/1', title: 'Acme SA', selected: true }));

    assert.equal(screen.getByRole('link').getAttribute('aria-current'), 'true');
  });

  it('sin selected la fila no lleva marca', () => {
    const { container } = render(h(ListItem, { title: 'Acme SA', onClick: () => {} }));

    const row = container.querySelector('[data-slot="list-item"]') as HTMLElement;
    assert.equal(row.hasAttribute('data-selected'), false);
    assert.equal(screen.getByRole('button').hasAttribute('aria-pressed'), false);
  });

  it('meta y acciones quedan fuera del área clicable', () => {
    render(
      h(ListItem, {
        href: '/accounts/1',
        title: 'Acme SA',
        meta: 'hace 2 h',
        actions: h('button', { type: 'button' }, 'Archivar'),
      }),
    );

    const link = screen.getByRole('link');
    assert.equal(link.contains(screen.getByText('hace 2 h')), false);
    assert.equal(link.contains(screen.getByRole('button', { name: 'Archivar' })), false);
  });

  it('dentro de ListItemGroup cada fila es un listitem de una lista', () => {
    render(h(ListItemGroup, null, h(ListItem, { title: 'Acme SA' }), h(ListItem, { title: 'Beta SA' })));

    assert.equal(within(screen.getByRole('list')).getAllByRole('listitem').length, 2);
  });

  it('fuera de un grupo la fila no declara role', () => {
    const { container } = render(h(ListItem, { title: 'Acme SA' }));

    assert.equal((container.querySelector('[data-slot="list-item"]') as HTMLElement).hasAttribute('role'), false);
  });
});

describe('Kanban', () => {
  const COLUMNS = [
    { id: 'review', title: 'En revisión' },
    { id: 'approved', title: 'Aprobados' },
    { id: 'sent', title: 'Enviados' },
  ];
  const ITEMS: KanbanItem[] = [
    { id: '1', columnId: 'review', title: 'Acme SAS', description: 'Tecnología · Colombia', meta: 'Hace 2 días' },
    { id: '2', columnId: 'review', title: 'Initech' },
    { id: '3', columnId: 'approved', title: 'Globex' },
  ];
  const column = (name: string) => screen.getByRole('region', { name });
  /** El contador es el Badge que comparte fila con el título de la columna. */
  const counter = (name: string) =>
    within(column(name)).getByRole('heading', { level: 3 }).parentElement?.lastElementChild?.textContent;

  it('pinta una columna por etapa con su contador', () => {
    render(h(Kanban, { columns: COLUMNS, items: ITEMS }));

    assert.equal(counter('En revisión'), '2');
    assert.equal(counter('Aprobados'), '1');
    assert.equal(counter('Enviados'), '0');
  });

  it('pone cada tarjeta en su columna', () => {
    render(h(Kanban, { columns: COLUMNS, items: ITEMS }));

    assert.ok(within(column('En revisión')).getByText('Acme SAS'));
    assert.ok(within(column('En revisión')).getByText('Initech'));
    assert.ok(within(column('Aprobados')).getByText('Globex'));
    assert.equal(within(column('Aprobados')).queryByText('Acme SAS'), null);
  });

  it('pinta descripción y meta de la tarjeta', () => {
    render(h(Kanban, { columns: COLUMNS, items: ITEMS }));

    assert.ok(screen.getByText('Tecnología · Colombia'));
    assert.ok(screen.getByText('Hace 2 días'));
  });

  it('una columna vacía muestra el rótulo por defecto', () => {
    render(h(Kanban, { columns: COLUMNS, items: ITEMS }));

    assert.ok(within(column('Enviados')).getByText('Sin tarjetas'));
    assert.equal(within(column('Aprobados')).queryByText('Sin tarjetas'), null);
  });

  it('emptyColumnLabel sustituye al rótulo de columna vacía', () => {
    render(h(Kanban, { columns: COLUMNS, items: ITEMS, emptyColumnLabel: 'Nada por aquí' }));

    assert.ok(within(column('Enviados')).getByText('Nada por aquí'));
  });

  it('una tarjeta de una columna que no existe no se pinta', () => {
    render(h(Kanban, { columns: COLUMNS, items: [{ id: '9', columnId: 'ghost', title: 'Huérfana' }] }));

    assert.equal(screen.queryByText('Huérfana'), null);
  });

  it('sin onItemClick las tarjetas no son botones', () => {
    render(h(Kanban, { columns: COLUMNS, items: ITEMS }));

    assert.equal(screen.queryByRole('button'), null);
  });

  it('onItemClick vuelve la tarjeta un botón y recibe el registro', () => {
    const clicked: KanbanItem[] = [];
    render(h(Kanban, { columns: COLUMNS, items: ITEMS, onItemClick: (item) => clicked.push(item) }));

    fireEvent.click(screen.getByRole('button', { name: /Globex/ }));

    assert.deepEqual(clicked, [ITEMS[2]]);
  });

  it('con límite el contador es «n/límite» y avisa al superarlo', () => {
    render(h(Kanban, { columns: [{ id: 'review', title: 'En revisión', limit: 1 }], items: ITEMS }));

    assert.equal(counter('En revisión'), '2/1');
    assert.match(screen.getByRole('status').textContent ?? '', /Supera el límite de 1 tarjetas/);
  });

  it('dentro del límite no avisa', () => {
    render(h(Kanban, { columns: [{ id: 'review', title: 'En revisión', limit: 5 }], items: ITEMS }));

    assert.equal(counter('En revisión'), '2/5');
    assert.equal(screen.queryByRole('status'), null);
  });

  it('renderItem sustituye el cuerpo de la tarjeta', () => {
    render(
      h(Kanban, {
        columns: COLUMNS,
        items: ITEMS,
        renderItem: (item) => h('span', null, `#${item.id}`),
      }),
    );

    assert.ok(screen.getByText('#1'));
    assert.equal(screen.queryByText('Acme SAS'), null);
  });
});
