/**
 * Q3F-5AZ.2G-2 — Prospectos drawer MARK-DUPLICATE flow RUNTIME contract (real render).
 *
 * Renders the ACTUAL `ProspectReviewActions` and drives the full inline
 * mark-duplicate flow: eligibility gating (inside "Más acciones") → open the
 * inline confirmation → Cancelar / Confirmar duplicado, plus the
 * `duplicateAutoConfirm` intent used by the row menu / context menu / selection
 * action bar entry points. Boundary dependencies (server actions, router, toast)
 * are mocked so there is NO network, NO DB and NO real mark — the duplicate
 * wrapper is asserted to be called at most once and only on explicit confirm.
 * Approve and discard are asserted to stay untouched.
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
import type { ReviewDecisionCandidate } from '../prospect-review-decision-utils';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Boundary mocks: server actions, router, toast (no network, no DB) ─────────
type DuplicateOptions = { source?: string };
type DuplicateResult =
  | { ok: true; status: 'duplicate' | 'idempotent_success' }
  | { ok: false; reason: string };

const mockMarkDuplicate = mock.fn<(id: string, opts?: DuplicateOptions) => Promise<DuplicateResult>>(
  async () => ({ ok: true, status: 'duplicate' }),
);
const mockDiscard = mock.fn(async () => ({ ok: true as const, status: 'discarded' as const }));
const mockApprove = mock.fn(async () => ({
  ok: true as const,
  status: 'converted_to_account' as const,
  accountId: 'acc-1',
  hubSpotStatus: 'created' as const,
}));
const mockRefresh = mock.fn<() => void>();

mock.module('@/modules/prospect-review/duplicate-actions', {
  namedExports: {
    markDuplicatePendingReviewCandidateAction: (...args: [string, DuplicateOptions?]) =>
      mockMarkDuplicate(...args),
  },
});
mock.module('@/modules/prospect-review/discard-actions', {
  namedExports: {
    discardPendingReviewCandidateAction: (...args: unknown[]) =>
      (mockDiscard as unknown as (...a: unknown[]) => unknown)(...args),
  },
});
mock.module('@/modules/prospect-review/approve-and-convert-actions', {
  namedExports: {
    approveAndConvertPendingReviewCandidateAction: (...args: unknown[]) =>
      (mockApprove as unknown as (...a: unknown[]) => unknown)(...args),
  },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: mockRefresh, push: () => {}, replace: () => {} }),
  },
});
// Noop toast — module mocks are a shared, last-registration-wins registry across
// the test process, so we do NOT capture toast here. The exact success/error
// COPY is asserted statically in duplicate-action-safety.test.ts; this file
// asserts observable behavior only.
mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let ProspectReviewActions: (typeof import('../prospect-review-actions'))['ProspectReviewActions'];

const BASE: ReviewDecisionCandidate = {
  id: 'cand-1',
  name: 'Acme Analytics SA',
  status: 'needs_review',
  recordOrigin: 'production',
  duplicateStatus: 'no_match',
  matchedHubspotCompanyId: null,
  reviewedAt: null,
};

function candidate(overrides: Partial<ReviewDecisionCandidate>): ReviewDecisionCandidate {
  return { ...BASE, ...overrides };
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ProspectReviewActions } = await import('../prospect-review-actions'));
});

beforeEach(() => {
  mockMarkDuplicate.mock.resetCalls();
  mockDiscard.mock.resetCalls();
  mockApprove.mock.resetCalls();
  mockRefresh.mock.resetCalls();
});
afterEach(() => cleanup());

const buttonByText = (text: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;

const dupMenuItem = () =>
  screen.queryAllByRole('menuitem').find((el) => /Marcar duplicado/.test(el.textContent ?? '')) as
    | HTMLElement
    | undefined;

describe('ProspectReviewActions — mark-duplicate gating (inside Más acciones)', () => {
  it('enables Marcar duplicado for needs_review + production', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Más acciones')!);
    const item = dupMenuItem();
    assert.ok(item, 'Marcar duplicado must be present in the menu');
    assert.equal(
      item!.getAttribute('aria-disabled') === 'true' || item!.hasAttribute('data-disabled'),
      false,
    );
  });

  it('disables Marcar duplicado for a non-production needs_review row', async () => {
    render(<ProspectReviewActions candidate={candidate({ recordOrigin: 'sandbox' })} />);
    fireEvent.click(buttonByText('Más acciones')!);
    const item = dupMenuItem();
    assert.ok(item);
    assert.equal(
      item!.getAttribute('aria-disabled') === 'true' || item!.hasAttribute('data-disabled'),
      true,
    );
  });

  it('renders nothing (no Más acciones) for terminal states', () => {
    for (const status of ['approved', 'discarded', 'duplicate', 'converted_to_account']) {
      cleanup();
      render(<ProspectReviewActions candidate={candidate({ status })} />);
      assert.equal(buttonByText('Más acciones'), undefined, `terminal=${status}`);
    }
  });
});

describe('ProspectReviewActions — mark-duplicate inline confirmation flow', () => {
  it('clicking Marcar duplicado opens the confirmation (no mark yet)', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Más acciones')!);
    fireEvent.click(dupMenuItem()!);
    assert.ok(screen.getByText('¿Marcar prospecto como duplicado?'));
    assert.ok(screen.getByText(/saldrá de la revisión como duplicado/i));
    assert.equal(mockMarkDuplicate.mock.callCount(), 0);
  });

  it('Cancelar closes the confirmation and calls no mark-duplicate action', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Más acciones')!);
    fireEvent.click(dupMenuItem()!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    assert.equal(screen.queryByText('¿Marcar prospecto como duplicado?'), null);
    assert.equal(mockMarkDuplicate.mock.callCount(), 0);
  });

  it('Confirmar duplicado calls the wrapper exactly once with the id + source', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Más acciones')!);
    fireEvent.click(dupMenuItem()!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar duplicado/ }));

    await waitFor(() => assert.equal(mockMarkDuplicate.mock.callCount(), 1));
    const [id, opts] = mockMarkDuplicate.mock.calls[0].arguments;
    assert.equal(id, 'cand-1');
    assert.deepEqual(opts, { source: 'prospectos_drawer' });
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
    // Never approves and never discards as a side effect of marking a duplicate.
    assert.equal(mockApprove.mock.callCount(), 0);
    assert.equal(mockDiscard.mock.callCount(), 0);
  });

  it('on failure, keeps the confirmation open and does NOT refresh (error path)', async () => {
    mockMarkDuplicate.mock.mockImplementationOnce(async () => ({ ok: false, reason: 'duplicate_failed' }));
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Más acciones')!);
    fireEvent.click(dupMenuItem()!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar duplicado/ }));

    await waitFor(() => assert.equal(mockMarkDuplicate.mock.callCount(), 1));
    assert.equal(mockRefresh.mock.callCount(), 0);
    assert.ok(screen.getByText('¿Marcar prospecto como duplicado?'));
  });
});

describe('ProspectReviewActions — duplicateAutoConfirm (row menu / context menu / selection bar intent)', () => {
  it('arms the duplicate confirmation on mount when eligible, consumes the intent once, marks nothing', () => {
    const onConsumed = mock.fn<() => void>();
    render(
      <ProspectReviewActions
        candidate={candidate({})}
        duplicateAutoConfirm
        onDuplicateIntentConsumed={onConsumed}
      />,
    );
    assert.ok(screen.getByText('¿Marcar prospecto como duplicado?'));
    assert.equal(mockMarkDuplicate.mock.callCount(), 0, 'never marks directly');
    assert.equal(onConsumed.mock.callCount(), 1);
  });

  it('does NOT arm the confirmation when ineligible, but still consumes the intent', () => {
    const onConsumed = mock.fn<() => void>();
    render(
      <ProspectReviewActions
        candidate={candidate({ status: 'generated' })}
        duplicateAutoConfirm
        onDuplicateIntentConsumed={onConsumed}
      />,
    );
    assert.equal(screen.queryByText('¿Marcar prospecto como duplicado?'), null);
    assert.equal(onConsumed.mock.callCount(), 1);
  });
});

describe('ProspectReviewActions — approve/discard stay intact alongside mark-duplicate', () => {
  it('Aprobar still uses the approve wrapper (not the duplicate wrapper)', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Aprobar')!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar aprobación/ }));
    await waitFor(() => assert.equal(mockApprove.mock.callCount(), 1));
    assert.equal(mockMarkDuplicate.mock.callCount(), 0, 'approving must never mark a duplicate');
  });

  it('Descartar still uses the discard wrapper (not the duplicate wrapper)', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar descarte/ }));
    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    assert.equal(mockMarkDuplicate.mock.callCount(), 0, 'discarding must never mark a duplicate');
  });
});
