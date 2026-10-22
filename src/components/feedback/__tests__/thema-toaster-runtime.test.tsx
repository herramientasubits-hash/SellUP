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
let syncTruncatedToastTooltips: (typeof import('../thema-toaster'))['syncTruncatedToastTooltips'];
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
  ({ ThemaToaster, TOASTER_TOP_OFFSET_PX, syncTruncatedToastTooltips } = await import('../thema-toaster'));
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

  it('corta título y descripción en dos líneas', async () => {
    render(h(ThemaToaster));
    act(() => {
      toast.success('Lote guardado', { description: 'Con detalle' });
    });
    const node = await waitFor(() => {
      const el = document.querySelector('[data-sonner-toast] [data-description]');
      assert.ok(el, 'la descripción debe pintarse');
      return el as HTMLElement;
    });
    assert.match(node.className, /line-clamp-2/);
    const title = document.querySelector('[data-sonner-toast] [data-title]') as HTMLElement;
    assert.match(title.className, /line-clamp-2/);
  });
});

describe('syncTruncatedToastTooltips', () => {
  function fakeToast(text: string, scrollHeight: number, clientHeight: number): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = `<li data-sonner-toast><div data-title>${text}</div></li>`;
    const el = root.querySelector('[data-title]') as HTMLElement;
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
    syncTruncatedToastTooltips(root);
    return el;
  }

  it('si el texto se corta, el tooltip lleva el mensaje completo', () => {
    const el = fakeToast('Un mensaje muy largo que no cabe', 60, 40);
    assert.equal(el.getAttribute('title'), 'Un mensaje muy largo que no cabe');
  });

  it('si el texto cabe, no hay tooltip', () => {
    const el = fakeToast('Corto', 20, 20);
    assert.equal(el.hasAttribute('title'), false);
  });
});
