/**
 * Confirmaciones del detalle de un lote — contrato RUNTIME.
 *
 * «Deshacer lote», «Recalcular datos» y las dos acciones con Claude preguntan
 * con `ConfirmDialog` (diálogo de alerta, sin X): nada se ejecuta al abrir, y
 * la acción de servidor solo se llama al confirmar.
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

const mockRollback = mock.fn(async (...args: unknown[]) => ({ ok: true, candidatesUpdated: 3, args }));
const mockRehydrate = mock.fn(async (...args: unknown[]) => ({ ok: true, updatedCount: 2, warnings: [], args }));

mock.module('@/modules/prospect-batches/actions', {
  namedExports: {
    rollbackStructuredAgentBatchAction: (...args: unknown[]) => mockRollback(...args),
    rehydrateStructuredBatchCandidatesAction: (...args: unknown[]) => mockRehydrate(...args),
  },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});
mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let RollbackBatchDialog: (typeof import('../rollback-batch-dialog'))['RollbackBatchDialog'];
let RehydrateBatchButton: (typeof import('../rehydrate-batch-button'))['RehydrateBatchButton'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ RollbackBatchDialog } = await import('../rollback-batch-dialog'));
  ({ RehydrateBatchButton } = await import('../rehydrate-batch-button'));
});
beforeEach(() => {
  mockRollback.mock.resetCalls();
  mockRehydrate.mock.resetCalls();
});
afterEach(() => cleanup());

const buttonByText = (text: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;

describe('RollbackBatchDialog', () => {
  it('abrir no deshace nada; confirmar envía el motivo escrito', async () => {
    render(h(RollbackBatchDialog, { batchId: 'batch-1', batchName: 'Lote QA' }));
    assert.equal(screen.queryByRole('alertdialog'), null);

    fireEvent.click(buttonByText('Deshacer lote')!);
    const dialog = await waitFor(() => screen.getByRole('alertdialog'));
    assert.ok(dialog.textContent?.includes('Deshacer este lote de candidatos'));
    assert.equal(mockRollback.mock.callCount(), 0);

    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: ' QA ' } });
    fireEvent.click(buttonByText('Confirmar, deshacer lote')!);

    await waitFor(() => assert.equal(mockRollback.mock.callCount(), 1));
    assert.deepEqual(mockRollback.mock.calls[0].arguments, ['batch-1', 'QA']);
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null));
  });

  it('«Cancelar» cierra sin llamar a la acción', async () => {
    render(h(RollbackBatchDialog, { batchId: 'batch-1', batchName: 'Lote QA' }));

    fireEvent.click(buttonByText('Deshacer lote')!);
    await waitFor(() => screen.getByRole('alertdialog'));
    fireEvent.click(buttonByText('Cancelar')!);

    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null));
    assert.equal(mockRollback.mock.callCount(), 0);
  });
});

describe('RehydrateBatchButton', () => {
  it('pregunta antes de reprocesar y solo llama a la acción al confirmar', async () => {
    render(h(RehydrateBatchButton, { batchId: 'batch-9' }));

    fireEvent.click(buttonByText('Recalcular datos')!);
    const dialog = await waitFor(() => screen.getByRole('alertdialog'));
    assert.ok(dialog.textContent?.includes('¿Reprocesar enrichment de candidatos?'));
    assert.ok(dialog.textContent?.includes('No toca HubSpot ni crea empresas.'));
    assert.equal(mockRehydrate.mock.callCount(), 0);

    fireEvent.click(buttonByText('Reprocesar')!);
    await waitFor(() => assert.equal(mockRehydrate.mock.callCount(), 1));
    assert.deepEqual(mockRehydrate.mock.calls[0].arguments, ['batch-9']);
  });
});
