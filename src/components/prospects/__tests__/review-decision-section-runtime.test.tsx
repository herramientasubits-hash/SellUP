/**
 * Q3F-5AZ.2D-1 — "Decisión de revisión" section RUNTIME contract (real render).
 *
 * Renders the ACTUAL `ReviewDecisionSection` (the consolidated approve surface
 * now living inside the official Prospectos drawer) and drives the full inline
 * flow: state gating per candidate status → Aprobar → inline confirmation →
 * Cancelar / Confirmar. Boundary dependencies (server action, router, toast) are
 * mocked so there is NO network, NO DB, and NO real approval — the approve
 * action is asserted to be called at most once and only on explicit confirm.
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
import type { ReviewDecisionCandidate } from '../review-decision-section';

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

let ReviewDecisionSection: (typeof import('../review-decision-section'))['ReviewDecisionSection'];

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
  ({ ReviewDecisionSection } = await import('../review-decision-section'));
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

describe('ReviewDecisionSection — section + gating', () => {
  it('renders the "Decisión de revisión" section header', () => {
    render(<ReviewDecisionSection candidate={candidate({})} />);
    assert.ok(screen.getByText('Decisión de revisión'));
  });

  it('enables Aprobar for needs_review + production + no blocking signals', () => {
    render(<ReviewDecisionSection candidate={candidate({})} />);
    const btn = approveButton();
    assert.ok(btn, 'Aprobar button must be present');
    assert.equal(btn!.disabled, false);
  });

  it('disables Aprobar for status generated', () => {
    render(<ReviewDecisionSection candidate={candidate({ status: 'generated' })} />);
    assert.equal(approveButton()!.disabled, true);
    assert.ok(screen.getByText(/aún debe pasar a revisión/i));
  });

  it('disables Aprobar for status normalized', () => {
    render(<ReviewDecisionSection candidate={candidate({ status: 'normalized' })} />);
    assert.equal(approveButton()!.disabled, true);
  });

  it('disables Aprobar for a needs_review row that is not clean production', () => {
    render(<ReviewDecisionSection candidate={candidate({ recordOrigin: 'sandbox' })} />);
    assert.equal(approveButton()!.disabled, true);
  });

  it('shows the "Aprobado" state (no Aprobar button) for status approved', () => {
    render(
      <ReviewDecisionSection
        candidate={candidate({ status: 'approved', reviewedAt: '2026-07-22T10:00:00Z' })}
      />,
    );
    assert.ok(screen.getByText('Aprobado'));
    assert.equal(approveButton(), undefined);
    assert.ok(screen.getByText(/Aún no ha sido convertido en cuenta/i));
    assert.ok(screen.getByText(/Aprobado el/i));
  });

  it('shows read-only terminal states for discarded / duplicate / converted', () => {
    for (const [status, label] of [
      ['discarded', 'Descartado'],
      ['duplicate', 'Marcado como duplicado'],
      ['converted_to_account', 'Convertido en cuenta'],
    ] as const) {
      cleanup();
      render(<ReviewDecisionSection candidate={candidate({ status })} />);
      assert.ok(screen.getByText(label), `expected "${label}" for status ${status}`);
      assert.equal(approveButton(), undefined, `no Aprobar for ${status}`);
    }
  });

  it('keeps Descartar / Marcar duplicado / Enviar a enriquecimiento / Mantener en revisión disabled', () => {
    render(<ReviewDecisionSection candidate={candidate({})} />);
    for (const label of ['Descartar', 'Marcar duplicado', 'Enviar a enriquecimiento', 'Mantener en revisión']) {
      const btn = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
      assert.ok(btn, `expected disabled action "${label}"`);
      assert.equal(btn!.disabled, true, `"${label}" must stay disabled`);
    }
  });
});

describe('ReviewDecisionSection — inline confirmation flow', () => {
  it('clicking Aprobar opens the inline confirmation (no action yet)', () => {
    render(<ReviewDecisionSection candidate={candidate({})} />);
    fireEvent.click(approveButton()!);
    assert.ok(screen.getByText('¿Confirmas aprobar este prospecto?'));
    assert.ok(screen.getByText(/No se creará cuenta ni se enviará a HubSpot/i));
    assert.equal(mockApprove.mock.callCount(), 0);
  });

  it('Cancelar closes the inline confirmation and calls no action', () => {
    render(<ReviewDecisionSection candidate={candidate({})} />);
    fireEvent.click(approveButton()!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    assert.equal(screen.queryByText('¿Confirmas aprobar este prospecto?'), null);
    assert.equal(mockApprove.mock.callCount(), 0);
    // Aprobar is back.
    assert.ok(approveButton());
  });

  it('Confirmar aprobación calls the approve action exactly once with the candidate id', async () => {
    render(<ReviewDecisionSection candidate={candidate({})} />);
    fireEvent.click(approveButton()!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar aprobación/ }));

    await waitFor(() => assert.equal(mockApprove.mock.callCount(), 1));
    const [id, opts] = mockApprove.mock.calls[0].arguments;
    assert.equal(id, 'cand-1');
    assert.deepEqual(opts, { confirmPossibleDuplicate: false });
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
  });
});

describe('ReviewDecisionSection — strong warnings', () => {
  it('shows a strong warning for a possible_duplicate candidate', () => {
    render(<ReviewDecisionSection candidate={candidate({ duplicateStatus: 'possible_duplicate' })} />);
    assert.ok(screen.getByText(/posible coincidencia\. Revisa antes de aprobar/i));
    // Still approvable (with explicit confirm) — passes confirmPossibleDuplicate.
    assert.equal(approveButton()!.disabled, false);
  });

  it('shows a strong warning for a HubSpot-matched candidate', () => {
    render(
      <ReviewDecisionSection candidate={candidate({ matchedHubspotCompanyId: 'hs-123' })} />,
    );
    assert.ok(screen.getByText(/posible coincidencia\. Revisa antes de aprobar/i));
    assert.ok(screen.getByText(/Coincidencia con una empresa en HubSpot/i));
  });

  it('exact_duplicate hard-blocks approval', () => {
    render(<ReviewDecisionSection candidate={candidate({ duplicateStatus: 'exact_duplicate' })} />);
    assert.equal(approveButton()!.disabled, true);
    assert.ok(screen.getByText(/duplicidad bloquea la aprobación/i));
  });
});
