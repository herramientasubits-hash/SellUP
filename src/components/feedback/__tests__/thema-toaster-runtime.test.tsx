/**
 * ThemaToaster — contrato RUNTIME: los avisos salen arriba a la derecha, bajo
 * la cabecera, sobrios y con botón de cerrar.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let act: (typeof import('@testing-library/react'))['act'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ThemaToaster: (typeof import('../thema-toaster'))['ThemaToaster'];
let TOASTER_TOP_OFFSET_PX: number;
let toast: (typeof import('sonner'))['toast'];

const h = React.createElement;

before(async () => {
  (globalThis as unknown as Record<string, unknown>).matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  (window as unknown as Record<string, unknown>).matchMedia ??= (
    globalThis as unknown as Record<string, unknown>
  ).matchMedia;
  ({ render, act, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ThemaToaster, TOASTER_TOP_OFFSET_PX } = await import('../thema-toaster'));
  // La MISMA instancia que usa el componente (tsx lo carga como CommonJS).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ toast } = require('sonner') as typeof import('sonner'));
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  document.documentElement.classList.remove('dark');
});

async function showToast(kind: 'success' | 'error' = 'success'): Promise<HTMLElement> {
  render(h(ThemaToaster));
  act(() => {
    toast[kind]('Lote guardado');
  });
  return waitFor(() => {
    const node = document.querySelector('[data-sonner-toast]');
    assert.ok(node, 'el aviso debe pintarse');
    return node as HTMLElement;
  });
}

describe('ThemaToaster', () => {
  it('apila los avisos arriba a la derecha, bajo la cabecera', async () => {
    await showToast();
    const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement;
    assert.equal(toaster.getAttribute('data-y-position'), 'top');
    assert.equal(toaster.getAttribute('data-x-position'), 'right');
    assert.equal(TOASTER_TOP_OFFSET_PX, 76);
    assert.equal(toaster.style.getPropertyValue('--offset-top'), '76px');
  });

  it('cada aviso trae su botón de cerrar y al pulsarlo se va', async () => {
    const node = await showToast();
    const close = node.querySelector('[data-close-button]') as HTMLButtonElement;
    assert.ok(close, 'el aviso debe tener botón de cerrar');
    act(() => {
      close.click();
    });
    await waitFor(() => {
      const current = document.querySelector('[data-sonner-toast]');
      assert.ok(!current || current.getAttribute('data-removed') === 'true');
    });
  });

  it('es sobrio: sin colores ricos, con el icono del sistema', async () => {
    const node = await showToast('error');
    assert.notEqual(node.getAttribute('data-rich-colors'), 'true');
    assert.ok(node.querySelector('[data-icon] svg'), 'el aviso lleva icono');
  });

  it('sigue el tema de la app leyendo la clase de <html>', async () => {
    document.documentElement.classList.add('dark');
    await showToast();
    await waitFor(() => {
      const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement;
      assert.equal(toaster.getAttribute('data-sonner-theme'), 'dark');
    });
  });
});
