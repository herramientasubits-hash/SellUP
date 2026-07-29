/**
 * Q3F-5BB.11K-FIX — OMITTED candidates must be discardable WITH a motive.
 *
 * Q3F-5BB.11K-EXECUTE stalled on two Colombian candidates found by Lusha with no
 * `tax_identifier` (Instituto Nacional de Cancerología, SYNLAB Colombia): they are
 * `record_origin = production` + `status = needs_review`, but
 * `isUsefulReviewCandidate` classifies them as NOT useful, so the batch-detail
 * table renders them informationally WITHOUT row actions — and the Prospectos
 * surface, while it did expose "Descartar", never collected a reason. There was
 * therefore no way to discard them WITH traceability.
 *
 * This file pins the four properties that must hold SIMULTANEOUSLY, for the
 * general shape (not for those two ids):
 *
 *   CO + tax_identifier NULL + source_primary 'lusha'
 *         ↓  isUsefulReviewCandidate      = false   (classification untouched)
 *         ↓  resolveReviewDecisionView    canDiscard = true
 *         ↓                               canApprove = false
 *         ↓  traceable discard available from Prospectos (motive required)
 *
 * Boundary dependencies (server actions, router, toast) are mocked: NO network,
 * NO DB, NO real discard, and the approve/convert wrapper is asserted to stay
 * untouched — this fix grants omitted candidates nothing but a traceable discard.
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
import { isUsefulReviewCandidate } from '@/modules/prospect-batches/types';
import {
  resolveReviewDecisionView,
  type ReviewDecisionCandidate,
} from '../prospect-review-decision-utils';

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
const mockMarkDuplicate = mock.fn(async () => ({ ok: true as const, status: 'duplicate' as const }));
const mockRefresh = mock.fn<() => void>();

mock.module('@/modules/prospect-review/discard-actions', {
  namedExports: {
    discardPendingReviewCandidateAction: (...args: [string, DiscardOptions?]) =>
      mockDiscard(...args),
  },
});
mock.module('@/modules/prospect-review/approve-and-convert-actions', {
  namedExports: {
    approveAndConvertPendingReviewCandidateAction: (...args: unknown[]) =>
      (mockApprove as unknown as (...a: unknown[]) => unknown)(...args),
  },
});
mock.module('@/modules/prospect-review/duplicate-actions', {
  namedExports: {
    markDuplicatePendingReviewCandidateAction: (...args: unknown[]) =>
      (mockMarkDuplicate as unknown as (...a: unknown[]) => unknown)(...args),
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

/** The row shape the omission classifier sees (batch detail / summaries). */
const OMITTED_ROW = {
  name: 'Instituto de referencia sin NIT',
  legal_name: null,
  country_code: 'CO',
  tax_identifier: null,
  duplicate_status: 'unchecked',
  status: 'needs_review',
  review_flags: [],
  legal_status: null,
  source_primary: 'lusha',
};

/** The same candidate as the Prospectos decision view sees it. */
const OMITTED_CANDIDATE: ReviewDecisionCandidate = {
  id: 'cand-omitted-1',
  name: 'Instituto de referencia sin NIT',
  status: 'needs_review',
  recordOrigin: 'production',
  duplicateStatus: 'unchecked',
  matchedHubspotCompanyId: null,
  reviewedAt: null,
};

const OUT_OF_SEGMENT_LABEL = 'Fuera del segmento objetivo';

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ProspectReviewActions } = await import('../prospect-review-actions'));
});

beforeEach(() => {
  mockDiscard.mock.resetCalls();
  mockApprove.mock.resetCalls();
  mockMarkDuplicate.mock.resetCalls();
  mockRefresh.mock.resetCalls();
});
afterEach(() => cleanup());

const buttonByText = (text: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;

describe('omitted candidates — classification is UNCHANGED by the reason fix', () => {
  it('CO + no tax_identifier + lusha is still NOT a useful review candidate', () => {
    assert.equal(isUsefulReviewCandidate(OMITTED_ROW), false);
  });

  it('the same row WITH a NIT stays useful (the CO rule itself is untouched)', () => {
    assert.equal(
      isUsefulReviewCandidate({ ...OMITTED_ROW, tax_identifier: '900123456' }),
      true,
    );
  });

  it('the external_import exemption for a missing CO NIT is untouched', () => {
    assert.equal(
      isUsefulReviewCandidate({ ...OMITTED_ROW, source_primary: 'external_import' }),
      true,
    );
  });

  it('a blank-string NIT is still treated as missing for CO', () => {
    assert.equal(isUsefulReviewCandidate({ ...OMITTED_ROW, tax_identifier: '   ' }), false);
  });
});

describe('omitted candidates — decision view: discardable, NOT approvable', () => {
  it('canDiscard is true while canApprove is false', () => {
    const view = resolveReviewDecisionView(OMITTED_CANDIDATE);
    assert.equal(view.canDiscard, true);
    assert.equal(view.canApprove, false);
  });

  it('stays non-approvable for every duplicate state a NIT-less CO row can carry', () => {
    // Without a tax identifier the duplicate check cannot resolve, so the row
    // sits in a hard-blocking duplicate state — approval is refused there while
    // discard remains available. (Discard never consults the duplicate signal.)
    for (const duplicateStatus of ['unchecked', 'insufficient_data', 'exact_duplicate']) {
      const view = resolveReviewDecisionView({ ...OMITTED_CANDIDATE, duplicateStatus });
      assert.equal(view.canApprove, false, `approve must stay blocked for ${duplicateStatus}`);
      assert.equal(view.canDiscard, true, `discard must stay available for ${duplicateStatus}`);
    }
  });

  it('the decision view does not consult the omission classifier at all', () => {
    // canDiscard/canApprove are a pure function of (status, recordOrigin,
    // duplicateStatus): country_code / tax_identifier / source_primary are not
    // inputs, so this fix cannot have wired omission into the decision policy.
    const withOmissionNoise = {
      ...OMITTED_CANDIDATE,
      countryCode: 'CO',
      taxIdentifier: null,
      sourcePrimary: 'lusha',
    } as unknown as ReviewDecisionCandidate;
    assert.deepEqual(
      resolveReviewDecisionView(withOmissionNoise),
      resolveReviewDecisionView(OMITTED_CANDIDATE),
    );
  });
});

describe('omitted candidates — traceable discard from Prospectos', () => {
  it('renders an ENABLED Descartar and a DISABLED Aprobar', () => {
    render(<ProspectReviewActions candidate={OMITTED_CANDIDATE} />);
    assert.equal(buttonByText('Descartar')!.disabled, false);
    assert.equal(buttonByText('Aprobar')!.disabled, true);
  });

  it('requires a motive, then calls the wrapper once with a NON-EMPTY reason', async () => {
    render(<ProspectReviewActions candidate={OMITTED_CANDIDATE} />);
    fireEvent.click(buttonByText('Descartar')!);

    const confirm = screen.getByRole('button', { name: /Confirmar descarte/ }) as HTMLButtonElement;
    assert.equal(confirm.disabled, true, 'no motive → no discard');

    fireEvent.click(buttonByText(OUT_OF_SEGMENT_LABEL)!);
    assert.equal(confirm.disabled, false);
    fireEvent.click(confirm);

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    const [id, opts] = mockDiscard.mock.calls[0].arguments;
    assert.equal(id, 'cand-omitted-1');
    assert.equal(opts?.source, 'prospectos_drawer');
    assert.equal(typeof opts?.reason, 'string');
    assert.ok((opts!.reason as string).trim().length >= 3, 'reason must be traceable');
  });

  it('refreshes on success so the row leaves needs_review', async () => {
    render(<ProspectReviewActions candidate={OMITTED_CANDIDATE} />);
    fireEvent.click(buttonByText('Descartar')!);
    fireEvent.click(buttonByText(OUT_OF_SEGMENT_LABEL)!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar descarte/ }));

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
  });

  it('grants NO approval / conversion / duplicate side effect', async () => {
    render(<ProspectReviewActions candidate={OMITTED_CANDIDATE} />);
    fireEvent.click(buttonByText('Descartar')!);
    fireEvent.click(buttonByText(OUT_OF_SEGMENT_LABEL)!);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar descarte/ }));

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    assert.equal(mockApprove.mock.callCount(), 0, 'never approves / creates an empresa');
    assert.equal(mockMarkDuplicate.mock.callCount(), 0, 'never marks a duplicate');
  });

  it('a terminal (already discarded) omitted row exposes no action at all', () => {
    render(<ProspectReviewActions candidate={{ ...OMITTED_CANDIDATE, status: 'discarded' }} />);
    assert.equal(buttonByText('Descartar'), undefined);
    assert.equal(buttonByText('Aprobar'), undefined);
  });
});
