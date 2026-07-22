// Q3F-5AZ.2C-HF2 — Approve confirmation must never stack / leave a residual layer.
//
// Bug after HF1: Cancel appeared to close the confirmation, but "another modal"
// remained underneath. Root cause: the confirmation (an @base-ui AlertDialog)
// was opened *on top of* the still-open read-only DrawerShell, and the state was
// split across `confirmOpen` (the dialog) and `selectedId` (the drawer). Cancel
// cleared only `confirmOpen`, so the drawer overlay stayed mounted below — read
// by users as a stacked / residual modal.
//
// The structural fix:
//   - Single source of truth for the confirmation: `approveTarget`.
//   - Exactly ONE <AlertDialog>, rendered once outside every map/batch/drawer.
//   - Opening the confirmation closes the drawer (`setSelectedId(null)`), so only
//     one overlay is ever visible.
//   - Opening is guarded against double-click (`if (approving) return`).
//   - Cancel, Escape and backdrop dismiss all route through `closeApproveDialog`,
//     which clears the target.
//   - The legacy `confirmOpen` state is fully removed.
//
// This suite has no DOM/React runtime (matching the approve-action-safety and
// approve-cancel-modal convention), so the guarantees are proven by a static
// scan of the client source.

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

// Matches the AlertDialog ROOT element only: `<AlertDialog` followed by
// whitespace or `>` — so it never matches <AlertDialogContent>, <AlertDialogAction>,
// etc. The root is authored multi-line (`<AlertDialog\n  open=...`), so we cannot
// rely on a trailing-space literal.
const ALERT_DIALOG_ROOT = /<AlertDialog[\s>]/g;

/** First source index of the AlertDialog root element, or -1. */
function alertDialogRootIndex(src: string): number {
  const m = new RegExp(ALERT_DIALOG_ROOT).exec(src);
  return m ? m.index : -1;
}

/** Slices a named function body: `function name(...) { ... }` (balanced braces). */
function functionBody(src: string, name: string): string {
  const sig = src.indexOf(`function ${name}(`);
  assert.notEqual(sig, -1, `expected a function named ${name}`);
  const braceStart = src.indexOf('{', sig);
  assert.notEqual(braceStart, -1, `expected a body for ${name}`);
  let depth = 0;
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unbalanced braces while scanning ${name}`);
}

describe('approve confirmation — exactly one dialog, never stacked (HF2)', () => {
  it('renders exactly one <AlertDialog root', () => {
    const roots = CLIENT_SRC.match(ALERT_DIALOG_ROOT) ?? [];
    assert.equal(
      roots.length,
      1,
      'there must be exactly one approve AlertDialog root — no per-row/per-batch instances',
    );
  });

  it('the AlertDialog is rendered outside every map (not per row/batch)', () => {
    // The single dialog must appear AFTER the last list `.map(` in the render,
    // i.e. it is a top-level sibling, never nested inside an array render.
    const dialogAt = alertDialogRootIndex(CLIENT_SRC);
    assert.notEqual(dialogAt, -1, 'expected an AlertDialog root element');
    const lastMapAt = CLIENT_SRC.lastIndexOf('.map(');
    assert.ok(
      dialogAt > lastMapAt,
      'the AlertDialog must be rendered after/outside the list maps, not inside them',
    );
  });

  it('the dialog is driven by a single source of truth (approveTarget)', () => {
    assert.ok(
      CLIENT_SRC.includes('open={approveDialogOpen}'),
      'the dialog open prop must be derived from approveTarget (approveDialogOpen)',
    );
    assert.ok(
      CLIENT_SRC.includes('const approveDialogOpen = approveTarget != null'),
      'approveDialogOpen must derive purely from approveTarget',
    );
  });

  it('the legacy split state (confirmOpen) is fully removed from code', () => {
    // The `confirmOpen` setter and its useState declaration are what created the
    // second, desyncable overlay. They must be gone. (A backtick-quoted mention
    // survives in an explanatory comment; we assert on the code identifiers.)
    assert.equal(
      CLIENT_SRC.includes('setConfirmOpen'),
      false,
      'setConfirmOpen must be gone — the split state is what allowed the stack',
    );
    assert.equal(
      /useState[^\n]*\bconfirmOpen\b/.test(CLIENT_SRC),
      false,
      'there must be no confirmOpen state declaration',
    );
  });
});

describe('approve confirmation — open/close leave a single clean overlay (HF2)', () => {
  const open = functionBody(CLIENT_SRC, 'openApproveDialog');
  const close = functionBody(CLIENT_SRC, 'closeApproveDialog');

  it('opening the confirmation closes the drawer so only one overlay shows', () => {
    assert.ok(
      open.includes('setSelectedId(null)'),
      'openApproveDialog must close the read-only drawer to avoid a stacked overlay',
    );
    assert.ok(
      open.includes('setApproveTarget('),
      'openApproveDialog must set the approve target',
    );
  });

  it('opening is guarded against double-click / double-open', () => {
    assert.ok(
      open.includes('if (approving) return'),
      'openApproveDialog must no-op while a request is in flight',
    );
  });

  it('closing clears the target (no residual layer)', () => {
    assert.ok(
      close.includes('setApproveTarget(null)'),
      'closeApproveDialog must clear the target so the single overlay is fully removed',
    );
  });

  it('Escape / backdrop dismiss route through closeApproveDialog', () => {
    // onOpenChange must funnel every "closing" event to the same cleanup path.
    assert.ok(
      /onOpenChange=\{\(open\) => \{\s*if \(!open\) closeApproveDialog\(\);/.test(CLIENT_SRC),
      'onOpenChange(false) must call closeApproveDialog, matching the Cancel button',
    );
  });
});
