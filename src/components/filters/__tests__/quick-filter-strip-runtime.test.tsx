/**
 * QuickFilterStrip / useQuickFilter — contrato RUNTIME.
 *
 * Los indicadores de una lista son botones que la filtran: el número del botón
 * es lo que queda al pulsarlo, y volver a pulsarlo lo quita.
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
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let QuickFilterStrip: (typeof import('../quick-filter-strip'))['QuickFilterStrip'];
let QuickFilterChips: (typeof import('../quick-filter-strip'))['QuickFilterChips'];
let useWideViewport: (typeof import('../quick-filter-strip'))['useWideViewport'];
let useQuickFilter: (typeof import('../quick-filter-strip'))['useQuickFilter'];
let Building2: (typeof import('@/icons'))['Building2'];
let Mail: (typeof import('@/icons'))['Mail'];

const h = React.createElement;

interface Row {
  id: string;
  email: string | null;
  primary: boolean;
}

const ROWS: Row[] = [
  { id: 'a', email: 'a@acme.co', primary: true },
  { id: 'b', email: null, primary: false },
  { id: 'c', email: 'c@acme.co', primary: false },
];

function Harness({ rows = ROWS }: { rows?: Row[] }) {
  const definitions = React.useMemo(
    () => [
      { id: 'email', label: 'Con email', icon: Mail, predicate: (row: Row) => row.email !== null },
      { id: 'primary', label: 'Primarios', icon: Mail, predicate: (row: Row) => row.primary },
      { id: 'none', label: 'Sin nadie', icon: Mail, predicate: () => false },
    ],
    [],
  );
  const quick = useQuickFilter(rows, definitions);
  return h(
    'div',
    null,
    h(QuickFilterStrip, {
      label: 'Indicadores de contactos',
      icon: Building2,
      total: quick.total,
      noun: ['contacto', 'contactos'] as const,
      options: quick.options,
      value: quick.activeId,
      onToggle: quick.toggle,
    }),
    h('ul', { 'data-testid': 'rows' }, quick.rows.map((row) => h('li', { key: row.id }, row.id))),
    h('p', { 'data-testid': 'active-label' }, quick.activeLabel ?? 'ninguno'),
    h('button', { type: 'button', onClick: quick.clear }, 'limpiar'),
  );
}

function visibleIds(): string[] {
  return Array.from(screen.getByTestId('rows').querySelectorAll('li'), (li) => li.textContent ?? '');
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ QuickFilterStrip, QuickFilterChips, useQuickFilter, useWideViewport } = await import('../quick-filter-strip'));
  ({ Building2, Mail } = await import('@/icons'));
});

afterEach(() => {
  cleanup();
});

describe('QuickFilterStrip', () => {
  it('es un grupo con nombre y dice cuántos registros hay', () => {
    render(h(Harness));

    assert.ok(screen.getByRole('group', { name: 'Indicadores de contactos' }));
    assert.ok(screen.getByText('3 contactos'));
    assert.ok(screen.getByText('Pulsa un indicador para filtrar la lista.'));
  });

  it('usa el singular con un solo registro', () => {
    render(h(Harness, { rows: ROWS.slice(0, 1) }));

    assert.ok(screen.getByText('1 contacto'));
  });

  it('cada indicador es un botón sin pulsar con su recuento', () => {
    render(h(Harness));

    const email = screen.getByRole('button', { name: /Con email/ });
    assert.equal(email.getAttribute('aria-pressed'), 'false');
    assert.match(email.textContent ?? '', /Con email\s*2/);
    assert.match(screen.getByRole('button', { name: /Primarios/ }).textContent ?? '', /1/);
    assert.match(screen.getByRole('button', { name: /Sin nadie/ }).textContent ?? '', /0/);
  });

  it('pulsar un indicador deja solo sus filas y lo marca como pulsado', () => {
    render(h(Harness));

    fireEvent.click(screen.getByRole('button', { name: /Con email/ }));

    assert.deepEqual(visibleIds(), ['a', 'c']);
    assert.equal(screen.getByRole('button', { name: /Con email/ }).getAttribute('aria-pressed'), 'true');
    assert.equal(screen.getByTestId('active-label').textContent, 'Con email');
    assert.ok(screen.getByText('2 de 3 contactos'));
    assert.ok(screen.getByText('Filtro: Con email. Vuelve a pulsarlo para ver todo.'));
  });

  it('volver a pulsarlo quita el filtro', () => {
    render(h(Harness));

    fireEvent.click(screen.getByRole('button', { name: /Con email/ }));
    fireEvent.click(screen.getByRole('button', { name: /Con email/ }));

    assert.deepEqual(visibleIds(), ['a', 'b', 'c']);
    assert.equal(screen.getByRole('button', { name: /Con email/ }).getAttribute('aria-pressed'), 'false');
    assert.equal(screen.getByTestId('active-label').textContent, 'ninguno');
  });

  it('solo hay un indicador pulsado a la vez', () => {
    render(h(Harness));

    fireEvent.click(screen.getByRole('button', { name: /Con email/ }));
    fireEvent.click(screen.getByRole('button', { name: /Primarios/ }));

    assert.deepEqual(visibleIds(), ['a']);
    assert.equal(screen.getByRole('button', { name: /Con email/ }).getAttribute('aria-pressed'), 'false');
    assert.equal(screen.getByRole('button', { name: /Primarios/ }).getAttribute('aria-pressed'), 'true');
  });

  it('los recuentos no cambian al filtrar: se calculan sobre la lista entera', () => {
    render(h(Harness));

    fireEvent.click(screen.getByRole('button', { name: /Primarios/ }));

    assert.match(screen.getByRole('button', { name: /Con email/ }).textContent ?? '', /Con email\s*2/);
  });

  it('un indicador sin filas deja la lista vacía, y clear() la devuelve entera', () => {
    render(h(Harness));

    fireEvent.click(screen.getByRole('button', { name: /Sin nadie/ }));
    assert.deepEqual(visibleIds(), []);
    assert.ok(screen.getByText('0 de 3 contactos'));

    fireEvent.click(screen.getByRole('button', { name: 'limpiar' }));
    assert.deepEqual(visibleIds(), ['a', 'b', 'c']);
  });
});

describe('QuickFilterChips — los indicadores dentro de la barra de la tabla', () => {
  function ChipsHarness() {
    const definitions = React.useMemo(
      () => [
        { id: 'email', label: 'Con email', icon: Mail, predicate: (row: Row) => row.email !== null },
        { id: 'primary', label: 'Primarios', icon: Mail, predicate: (row: Row) => row.primary },
      ],
      [],
    );
    const quick = useQuickFilter(ROWS, definitions);
    return h(
      'div',
      null,
      h(QuickFilterChips, {
        label: 'Indicadores de contactos',
        options: quick.options,
        value: quick.activeId,
        onToggle: quick.toggle,
      }),
      h('ul', { 'data-testid': 'rows' }, quick.rows.map((row) => h('li', { key: row.id }, row.id))),
    );
  }

  it('es un grupo con nombre, sin franja ni textos de ayuda', () => {
    render(h(ChipsHarness));

    const group = screen.getByRole('group', { name: 'Indicadores de contactos' });
    assert.equal(group.querySelectorAll('button').length, 2);
    assert.equal(screen.queryByText('Pulsa un indicador para filtrar la lista.'), null);
  });

  it('filtra y se quita igual que la franja', () => {
    render(h(ChipsHarness));

    fireEvent.click(screen.getByRole('button', { name: /Primarios/ }));
    assert.deepEqual(visibleIds(), ['a']);
    assert.equal(screen.getByRole('button', { name: /Primarios/ }).getAttribute('aria-pressed'), 'true');

    fireEvent.click(screen.getByRole('button', { name: /Primarios/ }));
    assert.deepEqual(visibleIds(), ['a', 'b', 'c']);
  });
});

describe('useWideViewport', () => {
  function Probe() {
    return h('p', { 'data-testid': 'wide' }, String(useWideViewport()));
  }

  it('sin matchMedia asume escritorio', () => {
    render(h(Probe));

    assert.equal(screen.getByTestId('wide').textContent, 'true');
  });

  it('con matchMedia obedece a la consulta', () => {
    const win = window as unknown as { matchMedia?: unknown };
    win.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    try {
      render(h(Probe));
      assert.equal(screen.getByTestId('wide').textContent, 'false');
    } finally {
      delete win.matchMedia;
    }
  });
});

describe('QuickFilterEmptyState', () => {
  it('dice qué indicador dejó la lista vacía y permite quitarlo', async () => {
    const { QuickFilterEmptyState } = await import('../quick-filter-strip');
    let cleared = 0;
    render(
      h(QuickFilterEmptyState, {
        filterLabel: 'Con email',
        noun: 'contactos',
        onClear: () => {
          cleared += 1;
        },
      }),
    );

    assert.ok(screen.getByText('Nada en «Con email»'));
    assert.ok(screen.getByText(/no hay contactos que cumplan este indicador/));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro' }));
    assert.equal(cleared, 1);
  });
});
