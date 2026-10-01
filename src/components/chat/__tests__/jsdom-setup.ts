/**
 * Arranque de jsdom para las pruebas de runtime del chat (node:test no trae DOM).
 * Se importa ANTES que React y Testing Library.
 */
import { JSDOM } from 'jsdom';

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

const target = globalThis as unknown as Record<string, unknown>;
const source = dom.window as unknown as Record<string, unknown>;
for (const prop of Object.getOwnPropertyNames(dom.window)) {
  if (prop in target) continue;
  const descriptor = Object.getOwnPropertyDescriptor(source, prop);
  if (descriptor) Object.defineProperty(target, prop, descriptor);
}

// jsdom no trae ResizeObserver; los primitivos que miden (casillas, menús) lo piden.
if (!('ResizeObserver' in target)) {
  defineGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

export { dom };
