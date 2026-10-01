/**
 * DataTablePage — contrato RUNTIME de sus dos cabeceras.
 *
 * `compact` junta título, descripción y pestañas en una banda para dejarle el
 * alto a la tabla; sin él la pantalla conserva la cabecera de siempre.
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
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let DataTablePage: (typeof import('../data-table-page'))['DataTablePage'];

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ DataTablePage } = await import('../data-table-page'));
});

afterEach(() => {
  cleanup();
});

const TABS = h('nav', { 'aria-label': 'Vistas' }, 'pestañas');
const TABLE = h('div', { 'data-testid': 'table' }, 'tabla');

type PageProps = Omit<React.ComponentProps<typeof import('../data-table-page').DataTablePage>, 'children'>;
function page(props: PageProps): React.ReactElement {
  return h(DataTablePage, { ...props, children: TABLE });
}

describe('DataTablePage — cabecera de siempre', () => {
  it('pinta título, descripción, pestañas, métricas y contenido', () => {
    const { container } = render(
      page({ title: 'Empresas', description: 'Tus cuentas.', tabs: TABS, metrics: h('div', null, 'métricas') }),
    );

    assert.ok(screen.getByRole('heading', { level: 1, name: 'Empresas' }));
    assert.ok(screen.getByText('Tus cuentas.'));
    assert.ok(screen.getByRole('navigation', { name: 'Vistas' }));
    assert.ok(screen.getByText('métricas'));
    assert.ok(screen.getByTestId('table'));
    assert.equal(container.querySelector('[data-slot="page-header-compact"]'), null);
    assert.ok(container.firstElementChild?.className.includes('gap-5'));
  });
});

describe('DataTablePage — compact', () => {
  it('título, descripción y pestañas van en la misma banda', () => {
    const { container } = render(
      page({ compact: true, title: 'Empresas', description: 'Tus cuentas.', tabs: TABS }),
    );

    const band = container.querySelector('[data-slot="page-header-compact"]');
    assert.ok(band, 'la banda compacta existe');
    assert.ok(band.contains(screen.getByRole('heading', { level: 1, name: 'Empresas' })));
    assert.ok(band.contains(screen.getByText('Tus cuentas.')));
    assert.ok(band.contains(screen.getByRole('navigation', { name: 'Vistas' })));
  });

  it('estrecha los huecos entre bloques', () => {
    const { container } = render(page({ compact: true, title: 'Empresas' }));

    const root = container.firstElementChild;
    assert.ok(root?.className.includes('gap-3'));
    assert.equal(root?.className.includes('gap-5'), false);
  });

  it('sigue habiendo un único h1 y el contenido conserva su caja', () => {
    render(page({ compact: true, title: 'Empresas', tabs: TABS }));

    assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1);
    assert.ok(screen.getByTestId('table').parentElement?.className.includes('flex-1'));
  });

  it('las acciones no dejan un hueco vacío en la banda', () => {
    render(
      page({ compact: true, title: 'Empresas', actions: h('button', { type: 'button' }, 'Crear empresa') }),
    );

    const action = screen.getByRole('button', { name: 'Crear empresa' });
    assert.ok(action.parentElement?.className.includes('contents'));
  });

  it('con backHref ofrece volver', () => {
    render(page({ compact: true, title: 'Fuentes', backHref: '/settings' }));

    assert.equal(screen.getByRole('link', { name: 'Volver' }).getAttribute('href'), '/settings');
  });

  it('las métricas siguen teniendo su sitio bajo la banda', () => {
    render(page({ compact: true, title: 'Empresas', metrics: h('div', null, 'métricas') }));

    assert.ok(screen.getByText('métricas'));
  });
});
