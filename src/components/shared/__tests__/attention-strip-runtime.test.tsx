/**
 * AttentionStrip / AttentionAction — contrato RUNTIME.
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
let AttentionStrip: (typeof import('../attention-strip'))['AttentionStrip'];
let AttentionAction: (typeof import('../attention-strip'))['AttentionAction'];
let AlertTriangle: (typeof import('@/icons'))['AlertTriangle'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ AttentionStrip, AttentionAction } = await import('../attention-strip'));
  ({ AlertTriangle } = await import('@/icons'));
});

afterEach(() => {
  cleanup();
});

describe('AttentionStrip', () => {
  it('es un grupo con el aria-label que recibe', () => {
    render(h(AttentionStrip, { label: 'Avisos de cuentas', icon: AlertTriangle, title: '12 por revisar' }));

    assert.ok(screen.getByRole('group', { name: 'Avisos de cuentas' }));
  });

  it('muestra el título y el detalle', () => {
    render(
      h(AttentionStrip, {
        label: 'Avisos',
        icon: AlertTriangle,
        title: '12 por revisar',
        detail: 'Decide antes del viernes',
      }),
    );

    assert.ok(screen.getByText('12 por revisar'));
    assert.ok(screen.getByText('Decide antes del viernes'));
  });

  it('pinta el icono que recibe', () => {
    render(h(AttentionStrip, { label: 'Avisos', icon: AlertTriangle, title: '12 por revisar' }));

    assert.ok(screen.getByRole('group').querySelector('svg'));
  });

  it('por defecto el filete es de aviso y tone lo cambia', () => {
    const { rerender } = render(h(AttentionStrip, { label: 'Avisos', icon: AlertTriangle, title: 'x' }));
    const rail = () => screen.getByRole('group').querySelector('span[aria-hidden]') as HTMLElement;
    assert.ok(rail().classList.contains('bg-warning'));

    rerender(h(AttentionStrip, { label: 'Avisos', icon: AlertTriangle, title: 'x', tone: 'negative' }));

    assert.ok(rail().classList.contains('bg-destructive'));
  });

  it('monta los botones hijos dentro del grupo', () => {
    render(
      h(
        AttentionStrip,
        { label: 'Avisos', icon: AlertTriangle, title: 'x' },
        h(AttentionAction, { icon: AlertTriangle, label: 'Sin dominio' }),
      ),
    );

    const group = screen.getByRole('group');
    assert.ok(group.contains(screen.getByRole('button', { name: /Sin dominio/ })));
  });
});

describe('AttentionAction', () => {
  it('llama onClick al pulsarlo', () => {
    let clicks = 0;
    render(h(AttentionAction, { icon: AlertTriangle, label: 'Duplicados', onClick: () => clicks++ }));

    fireEvent.click(screen.getByRole('button', { name: /Duplicados/ }));

    assert.equal(clicks, 1);
  });

  it('sin active queda con aria-pressed="false"', () => {
    render(h(AttentionAction, { icon: AlertTriangle, label: 'Duplicados' }));

    assert.equal(screen.getByRole('button').getAttribute('aria-pressed'), 'false');
  });

  it('refleja active en aria-pressed="true"', () => {
    render(h(AttentionAction, { icon: AlertTriangle, label: 'Duplicados', active: true }));

    assert.equal(screen.getByRole('button').getAttribute('aria-pressed'), 'true');
  });

  it('formatea value con separador de miles es-CO', () => {
    render(h(AttentionAction, { icon: AlertTriangle, label: 'Duplicados', value: 12345 }));

    assert.ok(screen.getByText('12.345'));
  });

  it('pinta el cero cuando value es 0', () => {
    render(h(AttentionAction, { icon: AlertTriangle, label: 'Duplicados', value: 0 }));

    assert.ok(screen.getByText('0'));
  });

  it('sin value no pinta cifra', () => {
    render(h(AttentionAction, { icon: AlertTriangle, label: 'Duplicados' }));

    assert.equal(screen.getByRole('button').textContent, 'Duplicados');
  });
});
