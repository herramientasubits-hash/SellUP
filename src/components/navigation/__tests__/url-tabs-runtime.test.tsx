/**
 * UrlTabs — contrato RUNTIME: qué pestaña abre, cómo cambia y qué escribe en la URL.
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
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];


let UrlTabs: (typeof import('../url-tabs'))['UrlTabs'];
let TabsContent: (typeof import('@/components/ui/tabs'))['TabsContent'];

const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'equipo', label: 'Equipo', count: 4 },
  { id: 'detalle', label: 'Detalle', count: 0 },
];

function tabsElement(initialTab?: string): React.ReactElement {
  return (
    <UrlTabs tabs={TABS} initialTab={initialTab} ariaLabel="Secciones">
      <TabsContent value="resumen">Contenido del resumen</TabsContent>
      <TabsContent value="equipo">Contenido del equipo</TabsContent>
      <TabsContent value="detalle">Contenido del detalle</TabsContent>
    </UrlTabs>
  );
}

function renderTabs(initialTab?: string) {
  return render(tabsElement(initialTab));
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  UrlTabs = (await import('../url-tabs')).UrlTabs;
  TabsContent = (await import('@/components/ui/tabs')).TabsContent;
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/ruta?period=7d');
});

describe('UrlTabs — pestaña inicial', () => {
  it('sin pestaña en la URL abre la primera', () => {
    renderTabs();

    assert.ok(screen.getByText('Contenido del resumen'));
    assert.equal(screen.queryByText('Contenido del equipo'), null);
  });

  it('abre la pestaña que viene en la URL', () => {
    renderTabs('equipo');

    assert.ok(screen.getByText('Contenido del equipo'));
    assert.equal(screen.queryByText('Contenido del resumen'), null);
  });

  it('una pestaña desconocida cae en la primera, no en una pantalla vacía', () => {
    renderTabs('no-existe');

    assert.ok(screen.getByText('Contenido del resumen'));
  });

  it('pinta el contador solo cuando es mayor que cero', () => {
    renderTabs();

    assert.ok(screen.getByRole('tab', { name: /Equipo\s*4/ }));
    assert.equal(screen.getByRole('tab', { name: /Detalle/ }).textContent, 'Detalle');
  });

  it('anuncia el grupo de pestañas con su nombre', () => {
    renderTabs();

    assert.ok(screen.getByRole('tablist', { name: 'Secciones' }));
  });
});

describe('UrlTabs — cambio de pestaña', () => {
  it('al pulsar otra pestaña muestra su contenido y la guarda en la URL', () => {
    renderTabs();

    fireEvent.click(screen.getByRole('tab', { name: /Equipo/ }));

    assert.ok(screen.getByText('Contenido del equipo'));
    assert.equal(new URLSearchParams(window.location.search).get('tab'), 'equipo');
  });

  it('conserva el resto de parámetros de la URL (los filtros)', () => {
    renderTabs();

    fireEvent.click(screen.getByRole('tab', { name: /Equipo/ }));

    assert.equal(new URLSearchParams(window.location.search).get('period'), '7d');
  });

  it('volver a la primera pestaña quita el parámetro de la URL', () => {
    renderTabs('equipo');

    fireEvent.click(screen.getByRole('tab', { name: /Resumen/ }));

    assert.equal(new URLSearchParams(window.location.search).has('tab'), false);
    assert.ok(screen.getByText('Contenido del resumen'));
  });

  it('adopta la pestaña cuando la página la cambia desde fuera', () => {
    const view = renderTabs();

    view.rerender(tabsElement('detalle'));

    assert.ok(screen.getByText('Contenido del detalle'));
  });
});
