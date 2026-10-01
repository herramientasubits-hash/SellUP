/**
 * Diálogos del menú de acciones de un candidato — contrato RUNTIME.
 *
 * Los formularios cortos (descartar, marcar duplicado, deshacer conversión) van
 * en `ModalShell`; las confirmaciones (aprobar con posibles duplicados) en
 * `ConfirmDialog`. Son solo presentación: reciben estado y avisan por callbacks.
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
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let CandidateDiscardDialog: (typeof import('../candidate-discard-dialog'))['CandidateDiscardDialog'];
let CandidateMarkDuplicateDialog: (typeof import('../candidate-mark-duplicate-dialog'))['CandidateMarkDuplicateDialog'];
let CandidateRollbackConversionDialog: (typeof import('../candidate-rollback-conversion-dialog'))['CandidateRollbackConversionDialog'];
let PossibleDuplicateApproveDialog: (typeof import('../candidate-approve-dialogs'))['PossibleDuplicateApproveDialog'];

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup, fireEvent } = await import('@testing-library/react'));
  ({ CandidateDiscardDialog } = await import('../candidate-discard-dialog'));
  ({ CandidateMarkDuplicateDialog } = await import('../candidate-mark-duplicate-dialog'));
  ({ CandidateRollbackConversionDialog } = await import('../candidate-rollback-conversion-dialog'));
  ({ PossibleDuplicateApproveDialog } = await import('../candidate-approve-dialogs'));
});
afterEach(() => cleanup());

const buttonByText = (text: string) =>
  screen.getAllByRole('button').find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

describe('CandidateDiscardDialog', () => {
  const baseProps = {
    open: true,
    onOpenChange: () => {},
    candidateName: 'Acme SA',
    loading: false,
    reason: '',
    onReasonChange: () => {},
    onConfirm: () => {},
  };

  it('ofrece los motivos como un grupo de opciones y avisa cuál se eligió', () => {
    const onReasonKeyChange = mock.fn();
    render(h(CandidateDiscardDialog, { ...baseProps, reasonKey: '', onReasonKeyChange }));

    assert.ok(screen.getByRole('radiogroup', { name: 'Motivo de descarte' }));
    fireEvent.click(screen.getByRole('radio', { name: /Fuera del segmento objetivo/ }));
    assert.deepEqual(onReasonKeyChange.mock.calls[0].arguments, ['out_of_segment']);
  });

  it('marca el motivo elegido y deja descartar sin notas', () => {
    render(h(CandidateDiscardDialog, { ...baseProps, reasonKey: 'too_small', onReasonKeyChange: () => {} }));

    assert.equal(screen.getByRole('radio', { name: /Empresa muy pequeña/ }).getAttribute('aria-checked'), 'true');
    assert.ok(screen.getByLabelText(/Notas adicionales \(opcional\)/));
    assert.equal(buttonByText('Descartar').disabled, false);
  });

  it('con «Otro motivo» exige escribir el motivo antes de descartar', () => {
    render(h(CandidateDiscardDialog, { ...baseProps, reasonKey: 'other', onReasonKeyChange: () => {} }));

    assert.ok(screen.getByLabelText(/Motivo personalizado/));
    assert.equal(buttonByText('Descartar').disabled, true);
  });
});

describe('CandidateMarkDuplicateDialog', () => {
  it('lista los tres tipos y confirma con el botón primario', () => {
    const onConfirm = mock.fn();
    const onTypeChange = mock.fn();
    render(
      h(CandidateMarkDuplicateDialog, {
        open: true,
        onOpenChange: () => {},
        candidateName: 'Acme SA',
        loading: false,
        type: 'possible_duplicate',
        onTypeChange,
        note: '',
        onNoteChange: () => {},
        onConfirm,
      }),
    );

    assert.equal(screen.getAllByRole('radio').length, 3);
    fireEvent.click(screen.getByRole('radio', { name: /Empresa relacionada/ }));
    assert.deepEqual(onTypeChange.mock.calls[0].arguments, ['related_company']);
    fireEvent.click(buttonByText('Confirmar'));
    assert.equal(onConfirm.mock.callCount(), 1);
  });
});

describe('CandidateRollbackConversionDialog', () => {
  const props = {
    open: true,
    onOpenChange: () => {},
    loading: false,
    onReasonChange: () => {},
    onConfirm: () => {},
  };

  it('no deja deshacer la conversión sin motivo', () => {
    render(h(CandidateRollbackConversionDialog, { ...props, reason: '   ' }));

    assert.ok(screen.getByRole('alert'), 'el aviso de qué hace el rollback es un Alert');
    assert.equal(buttonByText('Deshacer conversión').disabled, true);
  });

  it('con motivo, habilita la acción', () => {
    render(h(CandidateRollbackConversionDialog, { ...props, reason: 'Conversión de QA' }));

    assert.equal(buttonByText('Deshacer conversión').disabled, false);
  });
});

describe('PossibleDuplicateApproveDialog', () => {
  it('es un diálogo de alerta: muestra las coincidencias y solo aprueba al confirmar', () => {
    const onConfirm = mock.fn();
    render(
      h(PossibleDuplicateApproveDialog, {
        open: true,
        onOpenChange: () => {},
        loading: false,
        onConfirm,
        duplicateCheck: {
          summary: 'Coincide con una cuenta existente.',
          matches: [
            {
              source: 'hubspot',
              confidence: 82,
              matched_name: 'Acme Analytics',
              matched_domain: 'acme.com',
              reason: null,
            },
          ],
        } as unknown as Parameters<typeof PossibleDuplicateApproveDialog>[0]['duplicateCheck'],
      }),
    );

    const dialog = screen.getByRole('alertdialog');
    assert.ok(dialog.textContent?.includes('Posibles duplicados detectados'));
    assert.ok(dialog.textContent?.includes('Acme Analytics'));
    assert.equal(onConfirm.mock.callCount(), 0);
    fireEvent.click(buttonByText('Aprobar de todas formas'));
    assert.equal(onConfirm.mock.callCount(), 1);
  });
});
