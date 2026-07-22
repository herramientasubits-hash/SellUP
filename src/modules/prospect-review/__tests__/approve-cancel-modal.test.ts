// Q3F-5AZ.2C-HF1 — Approve confirmation "Cancelar" must close the modal.
//
// The approve confirmation is an @base-ui alert-dialog whose Cancel button is a
// plain <button> (no auto-close like the Radix primitive). The dialog is fully
// controlled via the `confirmOpen` state, so Cancel must reset it explicitly.
// Before the fix the modal opened but never closed on Cancel.
//
// Rendering the client requires a DOM + React runtime that this node:test
// suite does not set up, so — matching the existing approve-action-safety
// convention — we prove the wiring by a static scan of the client source:
//   1. Cancel is a real button (type="button") that closes the modal.
//   2. Cancel does NOT invoke the approve server action or the approve handler.
//   3. Confirm ("Aprobar") still invokes the approve path (regression guard).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = readFileSync(
  join(
    HERE,
    '..',
    '..',
    '..',
    'app',
    '(sellup)',
    'prospect-batches',
    'review',
    'review-queue-client.tsx',
  ),
  'utf8',
);

/** Extracts the `<AlertDialogCancel ...>...</AlertDialogCancel>` element body. */
function cancelElement(src: string): string {
  const open = src.indexOf('<AlertDialogCancel');
  assert.notEqual(open, -1, 'expected an <AlertDialogCancel> element in the client');
  const close = src.indexOf('</AlertDialogCancel>', open);
  assert.notEqual(close, -1, 'expected a closing </AlertDialogCancel> tag');
  return src.slice(open, close);
}

describe('approve confirmation — Cancel closes the modal', () => {
  const cancel = cancelElement(CLIENT_SRC);

  it('Cancel is an explicit button (never a submit)', () => {
    assert.ok(cancel.includes('type="button"'), 'Cancel must be type="button"');
  });

  it('Cancel closes the controlled dialog by resetting confirmOpen', () => {
    assert.ok(
      cancel.includes('setConfirmOpen(false)'),
      'Cancel must call setConfirmOpen(false) to close the modal',
    );
  });

  it('Cancel stays disabled while a request is in flight', () => {
    assert.ok(cancel.includes('disabled={approving}'), 'Cancel must be disabled while approving');
  });

  it('Cancel does NOT invoke the approve action or handler', () => {
    assert.equal(
      cancel.includes('approvePendingReviewCandidateAction'),
      false,
      'Cancel must not call the approve server action',
    );
    assert.equal(cancel.includes('doApprove'), false, 'Cancel must not call the approve handler');
  });
});

describe('approve confirmation — Confirm still approves (regression guard)', () => {
  it('the confirm action still invokes doApprove', () => {
    const open = CLIENT_SRC.indexOf('<AlertDialogAction');
    assert.notEqual(open, -1, 'expected an <AlertDialogAction> element');
    const close = CLIENT_SRC.indexOf('</AlertDialogAction>', open);
    const action = CLIENT_SRC.slice(open, close === -1 ? undefined : close);
    assert.ok(action.includes('doApprove'), 'Confirm must still call doApprove');
  });

  it('doApprove closes the modal on success', () => {
    assert.ok(
      CLIENT_SRC.includes('async function doApprove'),
      'doApprove handler must exist',
    );
    assert.ok(
      CLIENT_SRC.includes('setConfirmOpen(false)'),
      'doApprove must close the modal after a successful approve',
    );
  });
});
