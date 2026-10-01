/**
 * InfoHint — contrato RUNTIME: el botón de información y su nombre accesible.
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

let InfoHint: (typeof import('../info-hint'))['InfoHint'];

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  InfoHint = (await import('../info-hint')).InfoHint;
});

afterEach(() => {
  cleanup();
});

describe('InfoHint', () => {
  it('es un botón con el nombre «Cómo se calcula» por defecto', () => {
    render(h(InfoHint, null, 'Aprobados sobre generados'));

    const button = screen.getByRole('button', { name: 'Cómo se calcula' });
    assert.equal(button.getAttribute('type'), 'button');
  });

  it('sin showLabel no pinta el rótulo: solo el icono', () => {
    render(h(InfoHint, null, 'Explicación'));

    assert.equal(screen.getByRole('button').textContent, '');
  });

  it('con showLabel pinta el rótulo junto al icono', () => {
    render(<InfoHint label="Cómo se mide" showLabel>Explicación</InfoHint>);

    assert.equal(screen.getByRole('button', { name: 'Cómo se mide' }).textContent, 'Cómo se mide');
  });

  it('la explicación no ocupa la pantalla hasta que se abre', () => {
    render(h(InfoHint, null, 'Texto que solo se ve al abrir'));

    assert.equal(screen.queryByText('Texto que solo se ve al abrir'), null);
  });
});
