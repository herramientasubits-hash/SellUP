/**
 * PipelineBoard — contrato RUNTIME: un solo estado vacío con su siguiente paso,
 * y el tablero con tarjetas cuando hay cuentas.
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

let PipelineBoard: (typeof import('../pipeline-board'))['PipelineBoard'];
let PIPELINE_STAGES: (typeof import('../pipeline-board'))['PIPELINE_STAGES'];

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ PipelineBoard, PIPELINE_STAGES } = await import('../pipeline-board'));
});

afterEach(() => {
  cleanup();
});

describe('PipelineBoard — sin cuentas', () => {
  it('muestra un único estado vacío, no uno por columna', () => {
    render(h(PipelineBoard, { items: [] }));

    assert.equal(screen.getAllByText('El pipeline aún no muestra cuentas').length, 1);
    assert.equal(screen.queryByText('Sin cuentas todavía'), null);
    assert.equal(screen.queryByText('Sin tarjetas'), null);
  });

  it('dice qué hacer y lleva a los prospectos de Empresas', () => {
    render(h(PipelineBoard, { items: [] }));

    assert.ok(screen.getByText(/revisa y aprueba prospectos en Empresas/));
    const link = screen.getByRole('link', { name: /Ir a prospectos/ });
    assert.equal(link.getAttribute('href'), '/accounts?tab=prospectos');
  });

  it('explica las cuatro etapas, en orden, con su descripción', () => {
    render(h(PipelineBoard, { items: [] }));

    const stages = screen.getByRole('list', { name: 'Etapas del pipeline' });
    const titles = Array.from(stages.querySelectorAll('h2')).map((node) => node.textContent);
    assert.deepEqual(titles, PIPELINE_STAGES.map((stage) => stage.title));
    for (const stage of PIPELINE_STAGES) {
      assert.ok(stage.description, `${stage.title} debe explicar qué significa`);
      assert.ok(screen.getByText(stage.description as string));
    }
  });
});

describe('PipelineBoard — con cuentas', () => {
  const items = [
    { id: 'a1', columnId: 'preparacion', title: 'Acme S.A.S.', description: 'Tecnología · Colombia' },
    { id: 'a2', columnId: 'contacto', title: 'Globex' },
  ];

  it('pinta una tarjeta por cuenta en la columna de su etapa', () => {
    render(h(PipelineBoard, { items }));

    const first = screen.getByRole('region', { name: 'Preparación inicial' });
    assert.ok(first.textContent?.includes('Acme S.A.S.'));
    const last = screen.getByRole('region', { name: 'Preparados para contacto' });
    assert.ok(last.textContent?.includes('Globex'));
  });

  it('ya no muestra el estado vacío ni su botón', () => {
    render(h(PipelineBoard, { items }));

    assert.equal(screen.queryByText('El pipeline aún no muestra cuentas'), null);
    assert.equal(screen.queryByRole('link', { name: /Ir a prospectos/ }), null);
  });

  it('cada columna conserva la descripción de su etapa', () => {
    render(h(PipelineBoard, { items }));

    for (const stage of PIPELINE_STAGES) {
      assert.ok(screen.getByText(stage.description as string));
    }
  });
});
