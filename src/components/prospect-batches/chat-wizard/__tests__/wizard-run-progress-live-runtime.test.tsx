/**
 * La espera de la generación cambia de texto EN VIVO (AGENT1-RUN-LIVE-PROGRESS-1).
 *
 * Defecto en Producción (02-10): el texto se quedaba en «Preparando la búsqueda»
 * toda la corrida. La consulta era una server action, y el cliente despacha las
 * server actions de una en una: esperaba detrás de la propia corrida. Ahora es un
 * `fetch` a una ruta, que va en paralelo.
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
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub;
for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}
import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) },
});

let rtl: typeof import('@testing-library/react');
let SubmittingPanel: (typeof import('../wizard-execution-panels'))['SubmittingPanel'];

const REQ = 'b2f1c6c0-6c1e-4d39-9a43-3e1c2f0a9b11';

before(async () => {
  rtl = await import('@testing-library/react');
  ({ SubmittingPanel } = await import('../wizard-execution-panels'));
});

afterEach(() => {
  rtl.cleanup();
  mock.restoreAll();
});

describe('La espera dice la etapa en vivo', () => {
  it('pide la etapa a la ruta (no a una server action) y cambia el titular', async () => {
    const urls: string[] = [];
    let label = 'Preparando la búsqueda';
    mock.method(globalThis, 'fetch', async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ progress: { stage: 'apollo', label } }), { status: 200 });
    });

    label = 'Buscando empresas con Apollo y completando sus datos';
    rtl.render(<SubmittingPanel clientRequestId={REQ} />);

    await rtl.waitFor(() => assert.ok(rtl.screen.getByText(label)));
    assert.ok(urls[0].startsWith('/api/prospect-batches/run-progress?clientRequestId='));
    assert.ok(urls[0].includes(REQ));
  });

  it('sin etapa (o con error) dice «Preparando la búsqueda», nunca una inventada', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));
    rtl.render(<SubmittingPanel clientRequestId={REQ} />);
    assert.ok(rtl.screen.getByText('Preparando la búsqueda'));
  });
});
