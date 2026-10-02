/**
 * PageHeader, PageShell e IconTile (Thema `utility/PageHeader`,
 * `layout/PageShell`, `utility/IconTile`) — contrato RUNTIME: los anchos de
 * página del sistema, la cabecera con la tipografía del sistema y el chip de
 * icono por tono.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let PageHeader: (typeof import('../page-header'))['PageHeader'];
let PageShell: (typeof import('../../layout/page-shell'))['PageShell'];
let PAGE_WIDTH_CLASSES: (typeof import('../../layout/page-shell'))['PAGE_WIDTH_CLASSES'];
let IconTile: (typeof import('../../utility'))['IconTile'];

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ PageHeader } = await import('../page-header'));
  ({ PageShell, PAGE_WIDTH_CLASSES } = await import('../../layout/page-shell'));
  ({ IconTile } = await import('../../utility'));
});

afterEach(() => {
  cleanup();
});

describe('PageHeader', () => {
  it('pinta el título como h1 con la escala del sistema, la descripción y las acciones', () => {
    render(
      h(PageHeader, {
        title: 'Empresas',
        description: 'Tus cuentas de trabajo.',
        actions: h('button', { type: 'button' }, 'Nueva empresa'),
        meta: h('span', null, '42 empresas'),
      }),
    );
    const title = screen.getByRole('heading', { level: 1, name: 'Empresas' });
    assert.equal(title.getAttribute('data-slot'), 'heading');
    assert.ok(screen.getByText('Tus cuentas de trabajo.'));
    assert.ok(screen.getByRole('button', { name: 'Nueva empresa' }));
    assert.ok(screen.getByText('42 empresas'));
  });

  it('backHref pinta el enlace de volver', () => {
    render(h(PageHeader, { title: 'Detalle', backHref: '/accounts' }));
    assert.equal(screen.getByRole('link', { name: 'Volver' }).getAttribute('href'), '/accounts');
  });

  it('sin `width` no acota el ancho; con él, usa el ancho del sistema y se centra', () => {
    const { container, rerender } = render(h(PageHeader, { title: 'A' }));
    const header = () => container.querySelector('header') as HTMLElement;
    assert.equal(header().getAttribute('data-width'), null);
    assert.doesNotMatch(header().className, /max-w-/);

    rerender(h(PageHeader, { title: 'A', width: 'narrow' }));
    assert.equal(header().getAttribute('data-width'), 'narrow');
    assert.match(header().className, /mx-auto/);
    assert.ok(header().className.includes(PAGE_WIDTH_CLASSES.narrow));
  });
});

describe('PageShell — anchos de página', () => {
  it('los cuatro anchos: 720 · 1140 · 1440 (el tope del shell) · sin tope', () => {
    // Tailwind 4: `max-w-N` = N × 0.25rem.
    assert.deepEqual(PAGE_WIDTH_CLASSES, {
      narrow: 'max-w-180',
      normal: 'max-w-285',
      wide: 'max-w-360',
      full: 'max-w-none',
    });
  });

  it('por defecto es `wide` y es una columna que llena el alto', () => {
    const { container } = render(h(PageShell, null, 'contenido'));
    const shell = container.querySelector('[data-slot="page-shell"]') as HTMLElement;
    assert.equal(shell.getAttribute('data-width'), 'wide');
    assert.match(shell.className, /mx-auto/);
    assert.match(shell.className, /flex-1/);
  });

  it('estrecha el contenido cuando se le pide', () => {
    const { container } = render(h(PageShell, { width: 'normal' }, 'contenido'));
    const shell = container.querySelector('[data-slot="page-shell"]') as HTMLElement;
    assert.ok(shell.className.includes('max-w-285'));
  });
});

describe('IconTile', () => {
  it('por defecto es primario, mediano y decorativo', () => {
    const { container } = render(h(IconTile, { icon: h('svg') }));
    const tile = container.querySelector('[data-slot="icon-tile"]') as HTMLElement;
    assert.equal(tile.getAttribute('data-tone'), 'primary');
    assert.equal(tile.getAttribute('aria-hidden'), 'true');
    assert.match(tile.className, /bg-primary\/10 text-primary/);
    assert.match(tile.className, /size-9/);
  });

  it('cada tono tiñe con su token y `circle` lo hace redondo', () => {
    const { container } = render(
      h(IconTile, { icon: h('svg'), tone: 'negative', size: 'sm', shape: 'circle' }),
    );
    const tile = container.querySelector('[data-slot="icon-tile"]') as HTMLElement;
    assert.match(tile.className, /bg-destructive\/10 text-destructive/);
    assert.match(tile.className, /rounded-full/);
    assert.match(tile.className, /size-7/);
  });
});
