/**
 * Arranque de jsdom para las pruebas de runtime de la barra de acciones
 * (node:test no trae DOM). Se importa lo PRIMERO, antes que React.
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

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
target.ResizeObserver = target.ResizeObserver ?? ResizeObserverStub;

for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}

/** Hace que la ventana se comporte como estrecha (móvil) o ancha (escritorio). */
export function setCompactViewport(isCompact: boolean): void {
  (dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: isCompact,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

/** Borra las preferencias guardadas de la barra y avisa a quien las esté leyendo. */
export function resetRailPreferences(): void {
  dom.window.localStorage.clear();
  dom.window.dispatchEvent(new dom.window.Event('sellup-action-rail-change'));
}

export const RAIL_KEYS = {
  autoHide: 'sellup:action-rail:auto-hide',
  orientation: 'sellup:action-rail:orientation',
  position: 'sellup:action-rail:position',
} as const;

/** Los botones de acción: fuera el asa, los ajustes y la ✕ del recuento. */
export function visibleActionLabels(buttons: HTMLElement[]): string[] {
  return buttons
    .map((button) => button.getAttribute('aria-label') ?? '')
    .filter((label) => label && !/Mover barra|Ajustes de la barra|Limpiar selección/i.test(label));
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
