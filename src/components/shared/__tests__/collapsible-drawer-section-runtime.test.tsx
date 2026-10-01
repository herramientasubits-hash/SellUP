/**
 * CollapsibleDrawerSection — contrato RUNTIME.
 *
 * Una sección de drawer que se pliega tiene UN título (no un rótulo y una
 * tarjeta que lo repite) y, plegada, adelanta lo que contiene.
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
let CollapsibleDrawerSection: (typeof import('../collapsible-drawer-section'))['CollapsibleDrawerSection'];
let Globe: (typeof import('@/icons'))['Globe'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ CollapsibleDrawerSection } = await import('../collapsible-drawer-section'));
  ({ Globe } = await import('@/icons'));
});

afterEach(() => {
  cleanup();
});

function section(props: Partial<React.ComponentProps<typeof CollapsibleDrawerSection>> = {}) {
  return h(CollapsibleDrawerSection, {
    title: 'Datos comerciales y web',
    icon: Globe,
    children: h('p', null, 'contenido'),
    ...props,
  });
}

describe('CollapsibleDrawerSection', () => {
  it('muestra el título una sola vez, dentro de un encabezado', () => {
    render(section({ defaultOpen: true }));

    assert.equal(screen.getAllByText('Datos comerciales y web').length, 1);
    assert.ok(screen.getByRole('heading', { level: 3, name: /Datos comerciales y web/ }));
  });

  it('plegada de entrada: no monta el contenido y lo dice con aria-expanded', () => {
    render(section());

    const toggle = screen.getByRole('button', { name: /Datos comerciales y web/ });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(screen.queryByText('contenido'), null);
  });

  it('pulsar la cabecera la abre y volver a pulsar la pliega', () => {
    render(section());
    const toggle = screen.getByRole('button', { name: /Datos comerciales y web/ });

    fireEvent.click(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.ok(screen.getByText('contenido'));
    assert.equal(toggle.getAttribute('aria-controls'), screen.getByText('contenido').parentElement?.id);

    fireEvent.click(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(screen.queryByText('contenido'), null);
  });

  it('con defaultOpen arranca abierta', () => {
    render(section({ defaultOpen: true }));

    assert.ok(screen.getByText('contenido'));
  });

  it('plegada enseña el resumen; abierta, la explicación', () => {
    render(section({ summary: 'acme.co · con LinkedIn', hint: 'Lo que la empresa publica.' }));

    assert.ok(screen.getByText('acme.co · con LinkedIn'));
    assert.equal(screen.queryByText('Lo que la empresa publica.'), null);

    fireEvent.click(screen.getByRole('button', { name: /Datos comerciales y web/ }));
    assert.ok(screen.getByText('Lo que la empresa publica.'));
    assert.equal(screen.queryByText('acme.co · con LinkedIn'), null);
  });

  it('sin resumen, la explicación sirve también plegada', () => {
    render(section({ hint: 'Lo que la empresa publica.' }));

    assert.ok(screen.getByText('Lo que la empresa publica.'));
  });

  it('pinta el contador, también cuando es cero', () => {
    render(section({ badge: 0 }));

    assert.ok(screen.getByText('0'));
  });

  it('sin resumen, explicación ni contador no deja una línea vacía', () => {
    const { container } = render(section());

    assert.equal(container.querySelector('[data-slot="collapsible-drawer-section-line"]'), null);
  });
});
