/**
 * @/icons — contrato RUNTIME: cada icono exportado dibuja un <svg> con la firma de siempre.
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
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let icons: Record<string, unknown>;

type IconComponent = React.ComponentType<{
  className?: string;
  size?: number;
  strokeWidth?: number;
  'aria-hidden'?: boolean;
}>;

const h = React.createElement;

/** Un componente: función o el objeto de `forwardRef`. Deja fuera constantes. */
function isComponent(value: unknown): value is IconComponent {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value);
}

function iconEntries(): Array<[string, IconComponent]> {
  return Object.entries(icons).filter(
    (entry): entry is [string, IconComponent] => /^[A-Z]/.test(entry[0]) && isComponent(entry[1]),
  );
}

before(async () => {
  ({ render, cleanup } = await import('@testing-library/react'));
  icons = (await import('../index')) as unknown as Record<string, unknown>;
});

afterEach(() => {
  cleanup();
});

describe('@/icons', () => {
  it('exporta un catálogo de iconos, no un módulo vacío', () => {
    assert.ok(iconEntries().length >= 100, `sólo ${iconEntries().length} iconos exportados`);
  });

  it('cada icono exportado renderiza un <svg>', () => {
    const broken: string[] = [];

    for (const [name, Icon] of iconEntries()) {
      try {
        const { container, unmount } = render(h(Icon));
        if (!container.querySelector('svg')) broken.push(`${name}: no dibuja <svg>`);
        unmount();
      } catch (error) {
        broken.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    assert.deepEqual(broken, []);
  });

  it('cada icono respeta className', () => {
    const ignored: string[] = [];

    for (const [name, Icon] of iconEntries()) {
      const { container, unmount } = render(h(Icon, { className: 'size-4 text-primary' }));
      const svg = container.querySelector('svg');
      if (!svg?.classList.contains('size-4') || !svg.classList.contains('text-primary')) ignored.push(name);
      unmount();
    }

    assert.deepEqual(ignored, []);
  });

  it('cada icono tiene displayName, para que se lea en React DevTools', () => {
    const anonymous = iconEntries()
      .filter(([, Icon]) => !Icon.displayName)
      .map(([name]) => name);

    assert.deepEqual(anonymous, []);
  });

  it('Loader2 existe y dibuja un <svg>', () => {
    assert.ok(isComponent(icons.Loader2), 'Loader2 debe seguir exportado');

    const { container } = render(h(icons.Loader2 as IconComponent, { className: 'animate-spin' }));

    assert.ok(container.querySelector('svg')?.classList.contains('animate-spin'));
  });

  it('respeta size y pasa atributos como aria-hidden al <svg>', () => {
    const Search = icons.Search as IconComponent;

    const { container } = render(h(Search, { size: 32, 'aria-hidden': true }));

    const svg = container.querySelector('svg') as SVGElement;
    assert.equal(svg.getAttribute('width'), '32');
    assert.equal(svg.getAttribute('height'), '32');
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
  });

  it('el trazo por defecto es ICON_STROKE_WIDTH y strokeWidth lo cambia', () => {
    const Search = icons.Search as IconComponent;
    const strokes = (container: HTMLElement) =>
      new Set(
        Array.from(container.querySelectorAll('svg [stroke-width]')).map((node) =>
          node.getAttribute('stroke-width'),
        ),
      );

    const byDefault = render(h(Search));
    assert.deepEqual([...strokes(byDefault.container)], [String(icons.ICON_STROKE_WIDTH)]);
    byDefault.unmount();

    const custom = render(h(Search, { strokeWidth: 2.5 }));
    assert.deepEqual([...strokes(custom.container)], ['2.5']);
  });
});
