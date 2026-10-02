/**
 * BarList y DistributionBar (ports de Thema) — contrato RUNTIME: orden, límite,
 * proporción de la barra, vacío, y resumen accesible.
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
let BarList: (typeof import('../BarList'))['BarList'];
let DistributionBar: (typeof import('../DistributionBar'))['DistributionBar'];

const h = React.createElement;

const ITEMS = [
  { id: 'lusha', label: 'Lusha', value: 10 },
  { id: 'apollo', label: 'Apollo', value: 40, meta: 'US$ 2,00' },
  { id: 'tavily', label: 'Tavily', value: 20 },
];

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ BarList } = await import('../BarList'));
  ({ DistributionBar } = await import('../DistributionBar'));
});

afterEach(() => {
  cleanup();
});

function labels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('li')).map((li) => li.querySelector('span')?.textContent ?? '');
}

describe('BarList', () => {
  it('ordena de mayor a menor por defecto', () => {
    const { container } = render(h(BarList, { items: ITEMS }));
    assert.deepEqual(labels(container), ['Apollo', 'Tavily', 'Lusha']);
  });

  it('sorted={false} respeta el orden recibido y limit recorta', () => {
    const { container } = render(h(BarList, { items: ITEMS, sorted: false, limit: 2 }));
    assert.deepEqual(labels(container), ['Lusha', 'Apollo']);
  });

  it('la barra es proporcional al máximo (scaleX, no width)', () => {
    const { container } = render(h(BarList, { items: ITEMS }));
    const bars = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="bar-list-bar"]'));
    assert.deepEqual(bars.map((bar) => bar.style.transform), ['scaleX(1)', 'scaleX(0.5)', 'scaleX(0.25)']);
    assert.ok(bars.every((bar) => bar.style.width === ''));
  });

  it('escribe el valor con el formateador y el dato secundario', () => {
    render(h(BarList, { items: ITEMS, formatValue: (value: number) => `${value} cr` }));
    assert.ok(screen.getByText('40 cr'));
    assert.ok(screen.getByText('US$ 2,00'));
  });

  it('sin filas dice el vacío', () => {
    render(h(BarList, { items: [], emptyLabel: 'Sin consumo este mes' }));
    assert.ok(screen.getByText('Sin consumo este mes'));
  });

  it('con título se envuelve en su tarjeta con cabecera y cuenta', () => {
    const { container } = render(h(BarList, { title: 'Consumo por proveedor', count: 3, items: ITEMS }));
    assert.ok(container.querySelector('[data-slot="card"]'));
    assert.ok(screen.getByRole('heading', { name: 'Consumo por proveedor' }));
    assert.ok(screen.getByText('3'));
  });

  it('sin título no pinta tarjeta (para ir dentro de otra)', () => {
    const { container } = render(h(BarList, { items: ITEMS }));
    assert.equal(container.querySelector('[data-slot="card"]'), null);
  });

  it('todo en cero no divide por cero', () => {
    const { container } = render(h(BarList, { items: [{ id: 'a', label: 'A', value: 0 }] }));
    assert.equal(container.querySelector<HTMLElement>('[data-slot="bar-list-bar"]')?.style.transform, 'scaleX(0)');
  });
});

describe('DistributionBar', () => {
  const SEGMENTS = [
    { id: 'used', label: 'Usados', value: 60 },
    { id: 'reserved', label: 'Reservados', value: 0 },
    { id: 'free', label: 'Disponibles', value: 40 },
  ];

  it('cada tramo ocupa lo que le toca y los de cero no se pintan', () => {
    const { container } = render(h(DistributionBar, { segments: SEGMENTS }));
    const parts = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="distribution-segment"]'));
    assert.deepEqual(parts.map((part) => part.style.flexGrow), ['60', '40']);
  });

  it('la barra lleva el resumen como texto accesible', () => {
    render(h(DistributionBar, { segments: SEGMENTS, ariaLabel: 'Cupo del mes' }));
    assert.ok(screen.getByRole('img', { name: 'Cupo del mes' }));
  });

  it('sin ariaLabel, el resumen enumera los tramos', () => {
    render(h(DistributionBar, { segments: SEGMENTS }));
    assert.ok(screen.getByRole('img', { name: 'Usados: 60, Reservados: 0, Disponibles: 40' }));
  });

  it('la leyenda escribe valor, unidad y porcentaje', () => {
    const { container } = render(h(DistributionBar, { segments: SEGMENTS, unit: 'créditos' }));
    const legend = container.querySelector('ul')?.textContent ?? '';
    assert.match(legend, /Usados60 créditos · 60%/);
    assert.match(legend, /Disponibles40 créditos · 40%/);
  });

  it('total cero dice el vacío en vez de dividir', () => {
    render(h(DistributionBar, { segments: [{ id: 'a', label: 'A', value: 0 }], emptyLabel: 'Sin cupo asignado' }));
    assert.ok(screen.getByText('Sin cupo asignado'));
    assert.equal(screen.queryByRole('img'), null);
  });
});
