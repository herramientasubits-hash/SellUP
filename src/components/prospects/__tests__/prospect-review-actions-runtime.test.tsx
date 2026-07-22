/**
 * Q3F-5AZ.2D-1-UX1 — Prospectos drawer action zone RUNTIME contract (real render).
 *
 * Renders the ACTUAL `ProspectReviewActions` (the action zone relocated out of
 * the Validación tab content and into the drawer's sticky footer) and drives
 * the full inline flow: state gating per candidate status → Aprobar → inline
 * confirmation → Cancelar / Confirmar, plus the `autoConfirm` intent used by
 * row menu / context menu / selection action bar entry points. Boundary
 * dependencies (server action, router, toast) are mocked so there is NO
 * network, NO DB, and NO real approval — the approve action is asserted to be
 * called at most once and only on explicit confirm.
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
  mockApprove.mock.resetCalls();
  mockRefresh.mock.resetCalls();
});
afterEach(() => cleanup());

const approveButton = () =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === 'Aprobar') as
    | HTMLButtonElement
    | undefined;

describe('ProspectReviewActions — gating', () => {
  it('enables Aprobar for needs_review + production + no blocking signals', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    const btn = approveButton();
    assert.ok(btn, 'Aprobar button must be present');
    assert.equal(btn!.disabled, false);
  });

  it('disables Aprobar for status generated', () => {
    render(<ProspectReviewActions candidate={candidate({ status: 'generated' })} />);
    assert.equal(approveButton()!.disabled, true);
  });

  it('disables Aprobar for a needs_review row that is not clean production', () => {
    render(<ProspectReviewActions candidate={candidate({ recordOrigin: 'sandbox' })} />);
    assert.equal(approveButton()!.disabled, true);
  });

  it('exact_duplicate hard-blocks approval', () => {
    render(<ProspectReviewActions candidate={candidate({ duplicateStatus: 'exact_duplicate' })} />);
    assert.equal(approveButton()!.disabled, true);
  });

  it('renders nothing for terminal states (approved / discarded / duplicate / converted)', () => {
    for (const status of ['approved', 'discarded', 'duplicate', 'converted_to_account']) {
      cleanup();
      const { container } = render(<ProspectReviewActions candidate={candidate({ status })} />);
      assert.equal(container.textContent, '', `expected no output for status ${status}`);
      assert.equal(approveButton(), undefined);
    }
  });

  it('keeps Descartar / Marcar duplicado / Enviar a enriquecimiento / Mantener en revisión disabled', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    for (const label of ['Descartar', 'Marcar duplicado', 'Enviar a enriquecimiento', 'Mantener en revisión']) {
      const btn = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
      assert.ok(btn, `expected disabled action "${label}"`);
      assert.equal(btn!.disabled, true, `"${label}" must stay disabled`);
    }
  });
});

describe('ProspectReviewActions — inline confirmation flow', () => {
  it('clicking Aprobar opens the inline confirmation (no action yet)', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(approveButton()!);
    assert.ok(screen.getByText('¿Confirmas aprobar este prospecto?'));
    assert.ok(screen.getByText(/No se creará cuenta ni se enviará a HubSpot/i));
    assert.equal(mockApprove.mock.callCount(), 0);
  });

  it('Cancelar closes the inline confirmation and calls no action', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(approveButton()!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    assert.equal(screen.queryByText('¿Confirmas aprobar este prospecto?'), null);
    assert.equal(mockApprove.mock.callCount(), 0);
    assert.ok(approveButton());
  });

  it('Confirmar aprobación calls the approve action exactly once with the candidate id', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(approveButton()!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar aprobación/ }));

    await waitFor(() => assert.equal(mockApprove.mock.callCount(), 1));
    const [id, opts] = mockApprove.mock.calls[0].arguments;
    assert.equal(id, 'cand-1');
    assert.deepEqual(opts, { confirmPossibleDuplicate: false });
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
  });
});

describe('ProspectReviewActions — autoConfirm (row menu / context menu / selection bar intent)', () => {
  it('arms the inline confirmation on mount when eligible, and consumes the intent once', () => {
    const onConsumed = mock.fn<() => void>();
    render(
      <ProspectReviewActions candidate={candidate({})} autoConfirm onApproveIntentConsumed={onConsumed} />,
    );
    assert.ok(screen.getByText('¿Confirmas aprobar este prospecto?'));
    assert.equal(mockApprove.mock.callCount(), 0, 'never approves directly');
    assert.equal(onConsumed.mock.callCount(), 1);
  });

  it('does NOT arm the confirmation when the candidate is not eligible, but still consumes the intent', () => {
    const onConsumed = mock.fn<() => void>();
    render(
      <ProspectReviewActions
        candidate={candidate({ status: 'generated' })}
        autoConfirm
        onApproveIntentConsumed={onConsumed}
      />,
    );
    assert.equal(screen.queryByText('¿Confirmas aprobar este prospecto?'), null);
    assert.equal(approveButton()!.disabled, true);
    assert.equal(onConsumed.mock.callCount(), 1);
  });

  it('does not arm the confirmation when autoConfirm is false', () => {
    render(<ProspectReviewActions candidate={candidate({})} autoConfirm={false} />);
    assert.equal(screen.queryByText('¿Confirmas aprobar este prospecto?'), null);
  });
});

describe('ProspectReviewActions — strong warnings', () => {
  it('still allows Aprobar for a possible_duplicate candidate (warning lives in the status info card)', () => {
    render(<ProspectReviewActions candidate={candidate({ duplicateStatus: 'possible_duplicate' })} />);
    assert.equal(approveButton()!.disabled, false);
  });

  it('repeats the strong warning inside the inline confirmation for a possible_duplicate candidate', () => {
    render(<ProspectReviewActions candidate={candidate({ duplicateStatus: 'possible_duplicate' })} />);
    fireEvent.click(approveButton()!);
    assert.ok(screen.getByText(/posible coincidencia\. Revisa antes de aprobar/i));
  });
});
