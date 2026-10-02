/**
 * Collapsible (port de Thema sobre base-ui) — contrato RUNTIME: cerrado por
 * defecto, se abre con el disparador y lo anuncia con aria-expanded.
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
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let mod: typeof import('../collapsible');

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup, fireEvent } = await import('@testing-library/react'));
  mod = await import('../collapsible');
});

afterEach(() => {
  cleanup();
});

function tree(props: Record<string, unknown> = {}) {
  return h(
    mod.Collapsible,
    props,
    h(mod.CollapsibleTrigger, null, 'Detalles técnicos'),
    h(mod.CollapsibleContent, null, h('p', null, 'Contenido plegado')),
  );
}

describe('Collapsible', () => {
  it('arranca cerrado: el contenido no está y el disparador lo dice', () => {
    render(tree());
    const trigger = screen.getByRole('button', { name: 'Detalles técnicos' });
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(screen.queryByText('Contenido plegado'), null);
  });

  it('al pulsar se abre y vuelve a cerrarse', () => {
    render(tree());
    const trigger = screen.getByRole('button', { name: 'Detalles técnicos' });

    fireEvent.click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.ok(screen.getByText('Contenido plegado'));

    fireEvent.click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  });

  it('defaultOpen lo muestra abierto', () => {
    render(tree({ defaultOpen: true }));
    assert.ok(screen.getByText('Contenido plegado'));
  });
});
