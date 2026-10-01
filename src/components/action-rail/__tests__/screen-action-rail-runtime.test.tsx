/**
 * ScreenActionRail + ScreenActionRailProvider — contrato RUNTIME. La barra se monta por portal a document.body.
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
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ScreenActionRail: (typeof import('../screen-action-rail'))['ScreenActionRail'];
let ScreenActionRailProvider: (typeof import('../screen-action-rail'))['ScreenActionRailProvider'];
let useReportSelectionCount: (typeof import('../screen-action-rail'))['useReportSelectionCount'];

const h = React.createElement;

/** `createElement` para componentes cuyo `children` es obligatorio en sus props. */
function el<P extends { children?: unknown }>(
  type: React.ComponentType<P>,
  props: Omit<P, 'children'> | null,
  ...children: React.ReactNode[]
): React.ReactElement {
  return React.createElement(type as unknown as React.ComponentType<object>, props, ...children);
}

/** Hace de tabla: informa de su selección con la función del hook. */
function FakeList() {
  const report = useReportSelectionCount();
  return h(
    'div',
    null,
    h('button', { type: 'button', onClick: () => report(2) }, 'Marcar dos'),
    h('button', { type: 'button', onClick: () => report(0) }, 'Desmarcar'),
  );
}

function Screen({ showList = true }: { showList?: boolean }) {
  return el(ScreenActionRailProvider,
    null,
    el(ScreenActionRail, { label: 'Acciones de Cuentas' }, h('button', { type: 'button' }, 'Nueva cuenta')),
    showList ? h(FakeList) : null,
  );
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ScreenActionRail, ScreenActionRailProvider, useReportSelectionCount } = await import(
    '../screen-action-rail'
  ));
});

afterEach(() => {
  cleanup();
});

describe('ScreenActionRail', () => {
  it('monta sus hijos en una barra con role="toolbar"', () => {
    render(el(ScreenActionRail, null, h('button', { type: 'button' }, 'Nueva cuenta')));

    const toolbar = screen.getByRole('toolbar');
    assert.ok(toolbar.contains(screen.getByRole('button', { name: 'Nueva cuenta' })));
  });

  it('usa el nombre accesible por defecto y label lo cambia', () => {
    const { rerender } = render(el(ScreenActionRail, null, h('button', { type: 'button' }, 'x')));
    assert.ok(screen.getByRole('toolbar', { name: 'Acciones de la pantalla' }));

    rerender(el(ScreenActionRail, { label: 'Acciones de Cuentas' }, h('button', { type: 'button' }, 'x')));

    assert.ok(screen.getByRole('toolbar', { name: 'Acciones de Cuentas' }));
  });

  it('flota en document.body, fuera del árbol donde se declara', () => {
    const { container } = render(el(ScreenActionRail, null, h('button', { type: 'button' }, 'x')));

    const toolbar = screen.getByRole('toolbar');
    assert.equal(container.contains(toolbar), false);
    assert.ok(document.body.contains(toolbar));
  });

  it('fuera del provider la barra queda visible', () => {
    render(el(ScreenActionRail, null, h('button', { type: 'button' }, 'x')));

    assert.equal(screen.getByRole('toolbar').classList.contains('hidden'), false);
  });

  it('al desmontarse retira la barra del documento', () => {
    const { unmount } = render(el(ScreenActionRail, null, h('button', { type: 'button' }, 'x')));

    unmount();

    assert.equal(screen.queryByRole('toolbar'), null);
  });
});

describe('ScreenActionRailProvider — la barra se aparta con filas marcadas', () => {
  it('sin filas marcadas la barra está visible', () => {
    render(h(Screen));

    assert.equal(screen.getByRole('toolbar').classList.contains('hidden'), false);
  });

  it('oculta la barra cuando hay filas marcadas, sin desmontarla', () => {
    render(h(Screen));

    fireEvent.click(screen.getByRole('button', { name: 'Marcar dos' }));

    const toolbar = screen.getByRole('toolbar');
    assert.ok(toolbar.classList.contains('hidden'));
    assert.ok(toolbar.contains(screen.getByRole('button', { name: 'Nueva cuenta' })));
  });

  it('la barra reaparece al volver a cero', () => {
    render(h(Screen));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar dos' }));

    fireEvent.click(screen.getByRole('button', { name: 'Desmarcar' }));

    assert.equal(screen.getByRole('toolbar').classList.contains('hidden'), false);
  });

  it('la barra reaparece cuando la lista se desmonta con filas marcadas', () => {
    const { rerender } = render(h(Screen));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar dos' }));
    assert.ok(screen.getByRole('toolbar').classList.contains('hidden'));

    rerender(h(Screen, { showList: false }));

    assert.equal(screen.getByRole('toolbar').classList.contains('hidden'), false);
  });

  it('reserva abajo el hueco de la barra flotante', () => {
    const { container } = render(el(ScreenActionRailProvider, null, h('p', null, 'tabla')));

    assert.ok((container.firstElementChild as HTMLElement).classList.contains('pb-20'));
  });
});

describe('useReportSelectionCount — fuera del provider', () => {
  it('no lanza al montar, al informar ni al desmontar', () => {
    const { unmount } = render(h(FakeList));

    assert.doesNotThrow(() => fireEvent.click(screen.getByRole('button', { name: 'Marcar dos' })));
    assert.doesNotThrow(() => unmount());
  });

  it('devuelve la misma función entre renders', () => {
    const seen: Array<(count: number) => void> = [];
    function Probe() {
      seen.push(useReportSelectionCount());
      return null;
    }
    const { rerender } = render(h(Probe));

    rerender(h(Probe));

    assert.equal(seen.length >= 2, true);
    assert.equal(seen[0], seen[seen.length - 1]);
  });
});
