/**
 * ListPageSkeleton — contrato RUNTIME.
 *
 * El estado de carga de una pantalla de lista tiene la forma de lo que llega:
 * cabecera real, franja de indicadores y una tabla fantasma.
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
let ListPageSkeleton: (typeof import('../list-page-skeleton'))['ListPageSkeleton'];

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ ListPageSkeleton } = await import('../list-page-skeleton'));
});

afterEach(() => {
  cleanup();
});

describe('ListPageSkeleton', () => {
  it('conserva el título y las pestañas reales mientras carga', () => {
    render(
      h(ListPageSkeleton, {
        title: 'Empresas',
        description: 'Tus cuentas.',
        noun: 'empresas',
        tabs: h('nav', { 'aria-label': 'Vistas' }, 'pestañas'),
      }),
    );

    assert.ok(screen.getByRole('heading', { level: 1, name: 'Empresas' }));
    assert.ok(screen.getByRole('navigation', { name: 'Vistas' }));
  });

  it('anuncia qué se está cargando', () => {
    render(h(ListPageSkeleton, { title: 'Empresas', noun: 'empresas' }));

    const status = screen.getByRole('status', { name: 'Cargando empresas' });
    assert.equal(status.getAttribute('aria-busy'), 'true');
  });

  it('pinta tantas filas fantasma como se le pidan (ocho por defecto)', () => {
    const { container, rerender } = render(h(ListPageSkeleton, { title: 'Empresas', noun: 'empresas' }));
    assert.equal(container.querySelectorAll('[data-slot="skeleton-row"]').length, 8);

    rerender(h(ListPageSkeleton, { title: 'Empresas', noun: 'empresas', rows: 3 }));
    assert.equal(container.querySelectorAll('[data-slot="skeleton-row"]').length, 3);
  });

  it('reserva el hueco de la barra flotante, salvo que se le diga que no la hay', () => {
    const { container, rerender } = render(h(ListPageSkeleton, { title: 'Empresas', noun: 'empresas' }));
    assert.ok(container.firstElementChild?.className.includes('pb-20'));

    rerender(h(ListPageSkeleton, { title: 'Empresas', noun: 'empresas', reserveActionRail: false }));
    assert.equal(container.firstElementChild?.className.includes('pb-20'), false);
  });

  it('no usa una tabla de verdad: no hay datos que leer', () => {
    const { container } = render(h(ListPageSkeleton, { title: 'Empresas', noun: 'empresas' }));

    assert.equal(container.querySelector('table'), null);
  });
});
