/**
 * Spinner decorativo, TimelineItem compacto y EmptyState sin título — contrato RUNTIME.
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
let Spinner: (typeof import('../spinner'))['Spinner'];
let Timeline: (typeof import('@/components/data-display/timeline'))['Timeline'];
let TimelineItem: (typeof import('@/components/data-display/timeline'))['TimelineItem'];
let EmptyState: (typeof import('@/components/ui/empty-state'))['EmptyState'];

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ Spinner } = await import('../spinner'));
  ({ Timeline, TimelineItem } = await import('@/components/data-display/timeline'));
  ({ EmptyState } = await import('@/components/ui/empty-state'));
});

afterEach(() => {
  cleanup();
});

describe('Spinner', () => {
  it('se anuncia como estado con su etiqueta por defecto', () => {
    render(h(Spinner, { label: 'Cargando contactos' }));

    const status = screen.getByRole('status');
    assert.equal(status.textContent, 'Cargando contactos');
  });

  it('en modo decorativo no añade un estado ni texto oculto', () => {
    const { container } = render(h(Spinner, { decorative: true }));

    assert.equal(screen.queryByRole('status'), null);
    const spinner = container.querySelector('[data-slot="spinner"]');
    assert.ok(spinner);
    assert.equal(spinner.getAttribute('aria-hidden'), 'true');
    assert.equal(spinner.querySelector('.sr-only'), null);
  });
});

describe('TimelineItem density', () => {
  it('por defecto deja el aire normal entre eventos y el título en text-sm', () => {
    const { container } = render(h(Timeline, null, h(TimelineItem, { title: 'Lote creado' })));

    const item = container.querySelector('[data-slot="timeline-item"]');
    assert.ok(item);
    assert.equal(item.getAttribute('data-density'), 'default');
    assert.ok(item.classList.contains('pb-6'));
    assert.ok(screen.getByText('Lote creado').classList.contains('text-sm'));
  });

  it('en compacto reduce el aire y el título pasa a text-xs', () => {
    const { container } = render(
      h(Timeline, null, h(TimelineItem, { title: 'Buscando empresas', density: 'compact' })),
    );

    const item = container.querySelector('[data-slot="timeline-item"]');
    assert.ok(item);
    assert.equal(item.getAttribute('data-density'), 'compact');
    assert.ok(item.classList.contains('pb-3'));
    assert.ok(!item.classList.contains('pb-6'));
    assert.ok(screen.getByText('Buscando empresas').classList.contains('text-xs'));
  });
});

describe('EmptyState sin título', () => {
  it('pinta solo la descripción cuando no hay título', () => {
    const { container } = render(h(EmptyState, { description: 'No se pudo cargar el candidato.' }));

    assert.equal(container.querySelector('h3'), null);
    assert.ok(screen.getByText('No se pudo cargar el candidato.'));
  });

  it('sigue pintando el título cuando lo hay', () => {
    render(h(EmptyState, { title: 'No hay prospectos' }));

    assert.equal(screen.getByRole('heading', { level: 3 }).textContent, 'No hay prospectos');
  });
});
