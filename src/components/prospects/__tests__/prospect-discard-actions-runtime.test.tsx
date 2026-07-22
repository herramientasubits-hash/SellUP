/**
 * Q3F-5AZ.2G-1 — Prospectos drawer DISCARD flow RUNTIME contract (real render).
 *
 * Renders the ACTUAL `ProspectReviewActions` and drives the full inline discard
 * flow: eligibility gating → Descartar → inline confirmation → Cancelar /
 * Confirmar descarte, plus the `discardAutoConfirm` intent used by the row menu
 * / context menu / selection action bar entry points. Boundary dependencies
 * (server actions, router, toast) are mocked so there is NO network, NO DB and
 * NO real discard — the discard wrapper is asserted to be called at most once
 * and only on explicit confirm. Approve is asserted to stay untouched.
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
type DiscardOptions = { reason?: string; source?: string };
type DiscardResult =
  | { ok: true; status: 'discarded' | 'idempotent_success' }
  | { ok: false; reason: string };

const mockDiscard = mock.fn<(id: string, opts?: DiscardOptions) => Promise<DiscardResult>>(
  async () => ({ ok: true, status: 'discarded' }),
);
const mockApprove = mock.fn(async () => ({
  ok: true as const,
  status: 'converted_to_account' as const,
  accountId: 'acc-1',
  hubSpotStatus: 'created' as const,
}));
const mockRefresh = mock.fn<() => void>();

mock.module('@/modules/prospect-review/discard-actions', {
  namedExports: {
    discardPendingReviewCandidateAction: (...args: [string, DiscardOptions?]) => mockDiscard(...args),
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
// Noop toast — module mocks are a shared, last-registration-wins registry
// across the test process, so we do NOT capture toast here (multiple runtime
// files register 'sonner'). The exact success/error COPY is asserted statically
// in discard-action-safety.test.ts; this file asserts observable behavior only.
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
  mockDiscard.mock.resetCalls();
  mockApprove.mock.resetCalls();
  mockRefresh.mock.resetCalls();
});
afterEach(() => cleanup());

const buttonByText = (text: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;

describe('ProspectReviewActions — discard gating', () => {
  it('enables Descartar for needs_review + production', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    const btn = buttonByText('Descartar');
    assert.ok(btn, 'Descartar must be present');
    assert.equal(btn!.disabled, false);
  });

  it('still enables Descartar for a blocking duplicate (duplicate does not block discard)', () => {
    render(<ProspectReviewActions candidate={candidate({ duplicateStatus: 'exact_duplicate' })} />);
    assert.equal(buttonByText('Descartar')!.disabled, false);
  });

  it('disables Descartar for a non-production needs_review row', () => {
    render(<ProspectReviewActions candidate={candidate({ recordOrigin: 'sandbox' })} />);
    assert.equal(buttonByText('Descartar')!.disabled, true);
  });

  it('disables Descartar for status generated/normalized', () => {
    for (const status of ['generated', 'normalized']) {
      cleanup();
      render(<ProspectReviewActions candidate={candidate({ status })} />);
      assert.equal(buttonByText('Descartar')!.disabled, true, `generated=${status}`);
    }
  });

  it('renders nothing (no Descartar) for terminal states', () => {
    for (const status of ['approved', 'discarded', 'duplicate', 'converted_to_account']) {
      cleanup();
      render(<ProspectReviewActions candidate={candidate({ status })} />);
      assert.equal(buttonByText('Descartar'), undefined, `terminal=${status}`);
    }
  });
});

describe('ProspectReviewActions — discard inline confirmation flow', () => {
  it('clicking Descartar opens the confirmation (no discard yet)', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    assert.ok(screen.getByText('¿Descartar prospecto?'));
    assert.ok(screen.getByText(/saldrá de la revisión y no se creará como empresa en SellUp/i));
    assert.equal(mockDiscard.mock.callCount(), 0);
  });

  it('Cancelar closes the confirmation and calls no discard action', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    assert.equal(screen.queryByText('¿Descartar prospecto?'), null);
    assert.equal(mockDiscard.mock.callCount(), 0);
    assert.ok(buttonByText('Descartar'));
  });

  it('Confirmar descarte calls the discard wrapper exactly once with the id + source', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar descarte/ }));

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    const [id, opts] = mockDiscard.mock.calls[0].arguments;
    assert.equal(id, 'cand-1');
    assert.deepEqual(opts, { source: 'prospectos_drawer' });
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
    // Never approves as a side effect of discarding.
    assert.equal(mockApprove.mock.callCount(), 0);
  });

  it('on ok, closes the confirmation and refreshes (success path)', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar descarte/ }));

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
    // Panel closes back to the default action row on success.
    await waitFor(() => assert.equal(screen.queryByText('¿Descartar prospecto?'), null));
    assert.ok(buttonByText('Descartar'));
  });

  it('on failure, keeps the confirmation open and does NOT refresh (error path)', async () => {
    mockDiscard.mock.mockImplementationOnce(async () => ({ ok: false, reason: 'discard_failed' }));
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar descarte/ }));

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    // No navigation refresh on failure; the confirmation stays open for retry.
    assert.equal(mockRefresh.mock.callCount(), 0);
    assert.ok(screen.getByText('¿Descartar prospecto?'));
  });
});

describe('ProspectReviewActions — discardAutoConfirm (row menu / context menu / selection bar intent)', () => {
  it('arms the discard confirmation on mount when eligible, consumes the intent once, discards nothing', () => {
    const onConsumed = mock.fn<() => void>();
    render(
      <ProspectReviewActions
        candidate={candidate({})}
        discardAutoConfirm
        onDiscardIntentConsumed={onConsumed}
      />,
    );
    assert.ok(screen.getByText('¿Descartar prospecto?'));
    assert.equal(mockDiscard.mock.callCount(), 0, 'never discards directly');
    assert.equal(onConsumed.mock.callCount(), 1);
  });

  it('does NOT arm the confirmation when ineligible, but still consumes the intent', () => {
    const onConsumed = mock.fn<() => void>();
    render(
      <ProspectReviewActions
        candidate={candidate({ status: 'generated' })}
        discardAutoConfirm
        onDiscardIntentConsumed={onConsumed}
      />,
    );
    assert.equal(screen.queryByText('¿Descartar prospecto?'), null);
    assert.equal(buttonByText('Descartar')!.disabled, true);
    assert.equal(onConsumed.mock.callCount(), 1);
  });
});

describe('ProspectReviewActions — approve stays intact alongside discard', () => {
  it('Aprobar is still present, enabled, and uses the approve wrapper (not discard)', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    const aprobar = buttonByText('Aprobar');
    assert.ok(aprobar);
    assert.equal(aprobar!.disabled, false);

    fireEvent.click(aprobar!);
    assert.ok(screen.getByText('¿Aprobar y crear empresa?'));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar aprobación/ }));
    await waitFor(() => assert.equal(mockApprove.mock.callCount(), 1));
    assert.equal(mockDiscard.mock.callCount(), 0, 'approving must never call discard');
  });
});
