/**
 * ModulePlaceholder — contrato RUNTIME: una nota discreta, no una tarjeta.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/ruta?period=7d',
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

const h = React.createElement;

let ModulePlaceholder: (typeof import('../module-placeholder'))['ModulePlaceholder'];

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ModulePlaceholder = (await import('../module-placeholder')).ModulePlaceholder;
});

afterEach(() => {
  cleanup();
});

describe('ModulePlaceholder', () => {
  it('es una nota con el nombre del módulo', () => {
    render(h(ModulePlaceholder, { module: 'Tablero', description: 'Pronto podrás mover cuentas.' }));

    assert.ok(screen.getByRole('note', { name: 'Tablero: en construcción' }));
  });

  it('dice «En construcción», el módulo y qué hacer mientras tanto', () => {
    render(h(ModulePlaceholder, { module: 'Tablero', description: 'Pronto podrás mover cuentas.' }));

    assert.ok(screen.getByText('En construcción'));
    assert.ok(screen.getByText('Tablero.'));
    assert.ok(screen.getByText(/Pronto podrás mover cuentas\./));
  });

  it('no es una tarjeta: sin borde, sin fondo y sin lista de capacidades', () => {
    render(h(ModulePlaceholder, { module: 'Tablero', description: 'Texto' }));

    const note = screen.getByRole('note');
    assert.equal(/\bborder\b|rounded-2xl|\bp-8\b/.test(note.className), false);
    assert.equal(screen.queryByText('Capacidades previstas'), null);
    assert.equal(note.querySelector('h3'), null);
  });

  it('pinta el icono que recibe en lugar del punto', () => {
    const Icon = (props: { className?: string }) => h('svg', { ...props, 'data-testid': 'icon' });
    render(h(ModulePlaceholder, { module: 'Tablero', description: 'Texto', icon: Icon }));

    assert.ok(screen.getByTestId('icon'));
  });
});
