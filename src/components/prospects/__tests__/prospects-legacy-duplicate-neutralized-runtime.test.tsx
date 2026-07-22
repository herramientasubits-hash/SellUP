/**
 * Q3F-5AZ.2G-2 — three-dot row-menu mark-duplicate neutralization RUNTIME contract.
 *
 * Renders the ACTUAL shared `CandidateRowActions` (the three-dot row menu used
 * by both the Prospectos surface and the legacy prospect-batches surface) and
 * proves, with the real component, that:
 *
 *   1. On the Prospectos surface (onMarkDuplicateOverride provided), clicking the
 *      row-menu "Marcar como duplicado" delegates to the safe override — the
 *      drawer opener — and NEVER calls the legacy markCandidateDuplicate directly
 *      (which runs under requireActiveUser, not the Prospectos admin gate) nor
 *      opens the local duplicate dialog.
 *   2. On the legacy surface (no override), clicking "Marcar como duplicado…"
 *      still opens the duplicate dialog and, on confirm, reaches
 *      markCandidateDuplicate — proving this hito does not regress prospect-batches.
 *
 * All boundary server actions are mocked, so there is NO network, NO DB and NO
 * real mark-duplicate in either case.
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
import type { ProspectCandidate } from '@/modules/prospect-batches/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Boundary mocks: server actions, router, toast (no network, no DB) ─────────
const mockMarkDuplicate = mock.fn(async () => ({}) as unknown);
const noop = async () => ({ ok: true });

mock.module('@/modules/prospect-batches/actions', {
  namedExports: {
    approveAndConvertCandidateAction: noop,
    discardCandidate: noop,
    markCandidateDuplicate: (...args: unknown[]) =>
      (mockMarkDuplicate as unknown as (...a: unknown[]) => unknown)(...args),
    markCandidateReadyForApprovalAction: noop,
    markCandidateDuplicateReviewedAction: noop,
    rollbackCandidateAccountConversionAction: noop,
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

let CandidateRowActions: (typeof import('../../prospect-batches/candidate-row-actions'))['CandidateRowActions'];

// Clean, markable, NON-structured candidate: needs_review means the enabled
// "Marcar como duplicado" entry renders (canMarkDuplicate = not converted/duplicate).
function candidate(): ProspectCandidate {
  return {
    id: 'cand-g2',
    batch_id: 'batch-1',
    account_id: null,
    name: 'Acme G2 SA',
    legal_name: null,
    normalized_name: null,
    website: null,
    domain: null,
    country: null,
    country_code: null,
    city: null,
    region: null,
    industry: null,
    company_size: null,
    tax_identifier: null,
    tax_identifier_type: null,
    source_primary: null,
    sources_checked: [],
    duplicate_status: 'no_match',
    matched_account_id: null,
    matched_hubspot_company_id: null,
    confidence_score: null,
    fit_score: null,
    data_completeness_score: null,
    estimated_cost_usd: null,
    status: 'needs_review',
    review_notes: null,
    reviewed_by: null,
    reviewed_at: null,
    converted_account_id: null,
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    record_origin: 'production',
    review_status: null,
    review_flags: null,
    source_trace: null,
    commercial_trace: null,
    commercial_fit_status: null,
    legal_status: null,
  };
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ CandidateRowActions } = await import('../../prospect-batches/candidate-row-actions'));
});

beforeEach(() => {
  mockMarkDuplicate.mock.resetCalls();
});
afterEach(() => cleanup());

function openMenu(): void {
  const trigger =
    (document.querySelector('[data-slot="dropdown-menu-trigger"]') as HTMLElement | null) ??
    screen.getAllByRole('button')[0];
  fireEvent.pointerDown(trigger);
  fireEvent.pointerUp(trigger);
  fireEvent.click(trigger);
}

const findDuplicateMenuItem = (): HTMLElement | undefined =>
  screen.queryAllByRole('menuitem').find((el) => /Marcar como duplicado/.test(el.textContent ?? ''));

describe('Q3F-5AZ.2G-2 — Prospectos three-dot Marcar duplicado (onMarkDuplicateOverride) never marks directly', () => {
  it('clicking Marcar como duplicado calls the safe override and NOT the legacy markCandidateDuplicate, opening no dialog', async () => {
    const onMarkDuplicateOverride = mock.fn();
    render(
      <CandidateRowActions
        candidate={candidate()}
        onMarkDuplicateOverride={onMarkDuplicateOverride}
      />,
    );

    openMenu();
    await waitFor(() =>
      assert.ok(findDuplicateMenuItem(), 'Marcar como duplicado entry must render in the menu'),
    );
    fireEvent.click(findDuplicateMenuItem()!);

    assert.equal(onMarkDuplicateOverride.mock.callCount(), 1, 'override must be invoked exactly once');
    assert.equal(
      mockMarkDuplicate.mock.callCount(),
      0,
      'legacy markCandidateDuplicate must never be called on the Prospectos surface',
    );
    // The local duplicate dialog must NOT open in override mode.
    assert.equal(screen.queryByText('Marcar como duplicado', { selector: 'h2, [role="heading"]' }), null);
  });
});

describe('Q3F-5AZ.2G-2 — legacy prospect-batches surface (no override) still reaches mark-duplicate', () => {
  it('clicking Marcar como duplicado… with no override opens the dialog and, on confirm, calls markCandidateDuplicate (no regression)', async () => {
    render(<CandidateRowActions candidate={candidate()} />);

    openMenu();
    await waitFor(() =>
      assert.ok(findDuplicateMenuItem(), 'Marcar como duplicado entry must render in the menu'),
    );
    fireEvent.click(findDuplicateMenuItem()!);

    // Legacy path opens the duplicate dialog; the mark has NOT happened yet.
    await waitFor(() =>
      assert.ok(
        screen.queryAllByText('Marcar como duplicado').length > 0,
        'the legacy duplicate dialog must open',
      ),
    );
    assert.equal(mockMarkDuplicate.mock.callCount(), 0, 'no mark until the dialog is confirmed');

    // Confirm via the dialog's "Confirmar" button.
    const confirmBtn = screen
      .queryAllByRole('button')
      .find((b) => b.textContent?.trim() === 'Confirmar') as HTMLButtonElement | undefined;
    assert.ok(confirmBtn, 'dialog confirm button must be present');
    fireEvent.click(confirmBtn!);

    await waitFor(() =>
      assert.equal(
        mockMarkDuplicate.mock.callCount(),
        1,
        'legacy surface must still reach markCandidateDuplicate',
      ),
    );
  });
});
