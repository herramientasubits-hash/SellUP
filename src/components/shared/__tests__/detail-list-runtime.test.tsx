/**
 * DetailList / DetailItem — contrato RUNTIME: semántica de `dl` y dato vacío.
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

let DetailList: (typeof import('../detail-list'))['DetailList'];
let DetailItem: (typeof import('../detail-list'))['DetailItem'];

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ DetailList, DetailItem } = await import('../detail-list'));
});

afterEach(() => {
  cleanup();
});

describe('DetailList', () => {
  it('es una lista de definiciones con una etiqueta y un valor por dato', () => {
    const { container } = render(
      h(DetailList, null, h(DetailItem, { label: 'Industria' }, 'Tecnología')),
    );

    assert.ok(container.querySelector('dl'));
    assert.equal(container.querySelector('dt')?.textContent, 'Industria');
    assert.equal(container.querySelector('dd')?.textContent, 'Tecnología');
  });

  it('es de una columna en móvil y de dos cuando hay ancho', () => {
    const { container } = render(h(DetailList, null, h(DetailItem, { label: 'A' }, 'b')));

    const list = container.querySelector('dl') as HTMLElement;
    assert.ok(list.classList.contains('grid-cols-1'));
    assert.ok(list.classList.contains('sm:grid-cols-2'));
  });

  it('con columns={4} llega a cuatro columnas en pantallas anchas', () => {
    const { container } = render(
      <DetailList columns={4}><DetailItem label="A">b</DetailItem></DetailList>,
    );

    assert.ok((container.querySelector('dl') as HTMLElement).classList.contains('lg:grid-cols-4'));
  });

  it('acepta un nombre accesible', () => {
    const { container } = render(
      <DetailList aria-label="Datos clave"><DetailItem label="A">b</DetailItem></DetailList>,
    );

    assert.equal(container.querySelector('dl')?.getAttribute('aria-label'), 'Datos clave');
  });
});

describe('DetailItem — dato vacío', () => {
  for (const [name, value] of [
    ['null', null],
    ['undefined', undefined],
    ['cadena vacía', ''],
    ['false', false],
  ] as const) {
    it(`${name} se lee como «Sin dato»`, () => {
      render(<DetailList><DetailItem label="Industria">{value}</DetailItem></DetailList>);

      assert.ok(screen.getByText('Sin dato'));
    });
  }

  it('usa el texto de vacío que le pasen', () => {
    render(<DetailList><DetailItem label="Responsable" emptyLabel="Sin asignar">{null}</DetailItem></DetailList>);

    assert.ok(screen.getByText('Sin asignar'));
  });

  it('un cero es un dato, no un vacío', () => {
    render(h(DetailList, null, h(DetailItem, { label: 'Contactos' }, 0)));

    assert.equal(screen.queryByText('Sin dato'), null);
    assert.ok(screen.getByText('0'));
  });

  it('pinta el icono como decoración', () => {
    const Icon = (props: { className?: string }) => h('svg', { ...props, 'data-testid': 'icon' });
    render(h(DetailList, null, h(DetailItem, { label: 'Web', icon: Icon }, 'acme.com')));

    assert.equal(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden'), 'true');
  });
});
