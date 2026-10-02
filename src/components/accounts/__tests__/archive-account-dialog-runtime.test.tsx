/**
 * ArchiveAccountDialog — contrato RUNTIME: la única confirmación de «Archivar
 * empresa» (tabla, página de detalle y panel lateral). Qué acción dispara, con
 * qué empresa, y qué pasa cuando falla.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test has no DOM environment) ────────────────────────
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
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('sonner', {
  namedExports: { toast: { success: () => {}, error: () => {} } },
});

const archiveCalls: string[] = [];
let archiveResult: { success: true } | { success: false; error: string } = { success: true };
mock.module('@/modules/accounts/actions', {
  namedExports: {
    archiveAccount: async (id: string) => {
      archiveCalls.push(id);
      return archiveResult;
    },
  },
});

let ArchiveAccountDialog: (typeof import('../archive-account-dialog'))['ArchiveAccountDialog'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ArchiveAccountDialog } = await import('../archive-account-dialog'));
});

beforeEach(() => {
  archiveCalls.length = 0;
  archiveResult = { success: true };
});

afterEach(() => {
  cleanup();
});

function setup(accountId: string | null = 'acc-1') {
  const events: string[] = [];
  render(
    h(ArchiveAccountDialog, {
      accountId,
      onClose: () => events.push('close'),
      onArchived: () => events.push('archived'),
    }),
  );
  return events;
}

describe('ArchiveAccountDialog', () => {
  it('sin empresa, no hay diálogo', () => {
    setup(null);
    assert.equal(screen.queryByRole('alertdialog'), null);
  });

  it('es una confirmación (alertdialog) con el texto de siempre', () => {
    setup();
    const dialog = screen.getByRole('alertdialog');
    assert.match(dialog.textContent ?? '', /Archivar empresa/);
    assert.match(
      dialog.textContent ?? '',
      /Esta acción retira la empresa del pipeline activo\. Solo un administrador puede realizarla y queda registrada en auditoría\. ¿Confirmas\?/,
    );
  });

  it('Cancelar cierra sin archivar', () => {
    const events = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    assert.deepEqual(archiveCalls, []);
    assert.deepEqual(events, ['close']);
  });

  it('confirmar archiva ESA empresa, cierra y entrega el control', async () => {
    const events = setup('acc-42');
    fireEvent.click(screen.getByRole('button', { name: 'Archivar empresa' }));
    await waitFor(() => assert.deepEqual(events, ['close', 'archived']));
    assert.deepEqual(archiveCalls, ['acc-42']);
  });

  it('si la acción falla, NO da la empresa por archivada y el diálogo sigue abierto', async () => {
    archiveResult = { success: false, error: 'Solo un administrador puede archivar.' };
    const events = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archivar empresa' }));
    await waitFor(() => assert.deepEqual(archiveCalls, ['acc-1']));
    // Deja pasar la resolución de la acción antes de mirar qué NO ocurrió.
    await waitFor(() =>
      assert.equal((screen.getByRole('button', { name: 'Archivar empresa' }) as HTMLButtonElement).disabled, false),
    );
    assert.deepEqual(events, []);
    assert.ok(screen.getByRole('alertdialog'), 'el diálogo sigue abierto para reintentar');
  });
});
