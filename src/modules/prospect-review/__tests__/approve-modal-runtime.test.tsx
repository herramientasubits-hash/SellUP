/**
 * Q3F-5AZ.2C-HF3 — Approve confirmation modal RUNTIME contract (real React render).
 *
 * The earlier HF1/HF2 suites (`approve-cancel-modal`, `approve-modal-stacking`)
 * are STATIC source scans: they assert the client *source string* wires Cancel /
 * Escape / backdrop through a single `approveTarget`. That logic was correct all
 * along — yet the modal stayed stuck open in the browser, because the real defect
 * lived in the shared primitive `components/ui/alert-dialog.tsx`: it rendered the
 * dialog content inside Base UI's `Viewport` (a `role="presentation"` positioning
 * container) with NO `Popup`. Base UI observes the `Popup` to complete the close
 * transition and unmount; with none, `open={false}` never tore the overlay down,
 * so Cancel appeared to do nothing.
 *
 * A static scan can never catch that. This suite renders the ACTUAL
 * `ReviewQueueClient` with a real @base-ui AlertDialog and drives the full path:
 * row → drawer → Aprobar → confirmation → Cancelar, asserting the dialog is truly
 * gone from the DOM. It is the regression guard the previous hotfixes lacked.
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
if (!dom.window.matchMedia) {
  (dom.window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
    query: string,
  ) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
(globalThis as unknown as { matchMedia: unknown }).matchMedia = dom.window.matchMedia;
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
import type { PendingReviewCandidate } from '../types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Boundary mocks: server action, router, toast (no network, no DB) ──────────
type ApproveResult =
  | { ok: true; status: 'approved' | 'idempotent_success' }
  | { ok: false; reason: string };

const mockApprove =
  mock.fn<(id: string, opts?: { confirmPossibleDuplicate?: boolean }) => Promise<ApproveResult>>(
    async () => ({ ok: true, status: 'approved' }),
  );
const mockRefresh = mock.fn<() => void>();

mock.module('@/modules/prospect-review/approve-actions', {
  namedExports: {
    approvePendingReviewCandidateAction: (
      ...args: [string, { confirmPossibleDuplicate?: boolean }?]
    ) => mockApprove(...args),
  },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: mockRefresh, push: () => {}, replace: () => {} }),
  },
});
mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let ReviewQueueClient: (typeof import('../../../app/(sellup)/prospect-batches/review/review-queue-client'))['ReviewQueueClient'];

const CANDIDATE: PendingReviewCandidate = {
  id: 'cand-1',
  batchId: 'batch-1',
  name: 'Acme Analytics SA',
  normalizedName: 'acme analytics sa',
  domain: 'acme.example',
  website: 'https://acme.example',
  country: 'Colombia',
  countryCode: 'CO',
  city: 'Bogotá',
  region: null,
  industry: 'Software',
  subindustry: null,
  companySize: null,
  employeeCount: null,
  fitScore: 80,
  confidenceScore: 90,
  dataCompletenessScore: 70,
  duplicateStatus: null,
  matchedHubspotCompanyId: null,
  hubspotMatchStatus: null,
  status: 'needs_review',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  sourcePrimary: 'agent1',
  recordOrigin: 'production',
  classificationSource: 'official',
};

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ReviewQueueClient } = await import(
    '../../../app/(sellup)/prospect-batches/review/review-queue-client'
  ));
});

beforeEach(() => {
  mockApprove.mock.resetCalls();
  mockRefresh.mock.resetCalls();
});
afterEach(() => cleanup());

function renderQueue() {
  return render(
    <ReviewQueueClient
      candidates={[CANDIDATE]}
      batchesById={{
        'batch-1': {
          id: 'batch-1',
          name: 'Lote 1',
          source: 'agent1',
          status: 'active',
          createdAt: '2026-07-20T00:00:00.000Z',
          ownerId: null,
          createdBy: null,
        },
      }}
      totalPending={1}
      nowISO="2026-07-22T00:00:00.000Z"
    />,
  );
}

async function openConfirmation() {
  // Row → drawer.
  fireEvent.click(screen.getAllByText('Acme Analytics SA')[0]);
  // Drawer "Aprobar" button → confirmation dialog.
  const drawerApprove = await waitFor(() =>
    screen.getByRole('button', { name: /Aprobar/ }),
  );
  fireEvent.click(drawerApprove);
  // Confirmation title appears.
  await waitFor(() => assert.ok(screen.queryByText('Aprobar candidato')));
}

describe('approve confirmation — runtime open/close (HF3)', () => {
  it('opens the confirmation and CLOSES it fully on Cancelar (no stuck overlay)', async () => {
    renderQueue();
    await openConfirmation();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() =>
      assert.equal(
        screen.queryByText('Aprobar candidato'),
        null,
        'the confirmation dialog must be gone from the DOM after Cancelar',
      ),
    );
    // No approve was performed by cancelling.
    assert.equal(mockApprove.mock.callCount(), 0);
  });

  it('confirming calls the approve action once with the candidate id', async () => {
    renderQueue();
    await openConfirmation();

    // The dialog's confirm button (drawer is now closed, so only the dialog
    // action carries the exact label "Aprobar").
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));

    await waitFor(() => assert.equal(mockApprove.mock.callCount(), 1));
    const [id, opts] = mockApprove.mock.calls[0].arguments;
    assert.equal(id, 'cand-1');
    assert.deepEqual(opts, { confirmPossibleDuplicate: false });
    // On success the dialog closes.
    await waitFor(() => assert.equal(screen.queryByText('Aprobar candidato'), null));
  });
});
