/**
 * DrawerSection — contrato RUNTIME.
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
let DrawerSection: (typeof import('../drawer-section'))['DrawerSection'];
let Users: (typeof import('@/icons'))['Users'];

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ DrawerSection } = await import('../drawer-section'));
  ({ Users } = await import('@/icons'));
});

afterEach(() => {
  cleanup();
});

describe('DrawerSection', () => {
  it('pinta el título como h3', () => {
    render(h(DrawerSection, { title: 'Contactos', children: 'cuerpo' }));

    assert.ok(screen.getByRole('heading', { level: 3, name: 'Contactos' }));
  });

  it('pinta el contenido que envuelve', () => {
    render(h(DrawerSection, { title: 'Contactos', children: h('p', null, 'Ana Pérez') }));

    assert.ok(screen.getByText('Ana Pérez'));
  });

  it('pinta el hint bajo el título', () => {
    render(h(DrawerSection, { title: 'Contactos', hint: 'Personas de la cuenta', children: 'x' }));

    assert.ok(screen.getByText('Personas de la cuenta'));
  });

  it('pinta el badge junto al título', () => {
    render(h(DrawerSection, { title: 'Contactos', badge: '3 contactos', children: 'x' }));

    const badge = screen.getByText('3 contactos');
    assert.equal(badge.parentElement, screen.getByRole('heading', { level: 3 }).parentElement);
  });

  it('pinta la acción en la cabecera', () => {
    render(
      h(DrawerSection, {
        title: 'Contactos',
        action: h('button', { type: 'button' }, 'Añadir'),
        children: 'x',
      }),
    );

    const action = screen.getByRole('button', { name: 'Añadir' });
    assert.ok(action.closest('header'));
  });

  it('sin icono no pinta chip ni svg en la cabecera', () => {
    const { container } = render(h(DrawerSection, { title: 'Contactos', children: 'x' }));

    const header = container.querySelector('header') as HTMLElement;
    assert.equal(header.querySelector('svg'), null);
    assert.equal(header.querySelector('.rounded-xl'), null);
  });

  it('con icono pinta el chip con el tinte del tono', () => {
    const { container } = render(
      h(DrawerSection, { title: 'Contactos', icon: Users, tone: 'positive', children: 'x' }),
    );

    const chip = container.querySelector('header .rounded-xl') as HTMLElement;
    assert.ok(chip.querySelector('svg'));
    assert.ok(chip.classList.contains('bg-success/10'));
  });
});
