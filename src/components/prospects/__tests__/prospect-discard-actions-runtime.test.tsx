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

// ── Q3F-5BB.11K-FIX helpers: the discard motive is now mandatory ─────────────
const OUT_OF_SEGMENT_LABEL = 'Fuera del segmento objetivo';
const OTHER_LABEL = 'Otro motivo';

const confirmDiscardButton = () =>
  screen.getByRole('button', { name: /Confirmar descarte/ }) as HTMLButtonElement;

/** Selects a predefined motive inside the open inline discard panel. */
function pickReason(label: string): void {
  fireEvent.click(buttonByText(label)!);
}

/** Types free-text notes / a custom motive inside the open inline panel. */
function typeReasonNotes(text: string): void {
  const textarea = screen.getByLabelText(
    /Motivo personalizado|Notas adicionales \(opcional\)/,
  ) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
}

/** Opens the panel and arms a valid predefined motive — the common happy path. */
function openDiscardWithReason(): void {
  fireEvent.click(buttonByText('Descartar')!);
  pickReason(OUT_OF_SEGMENT_LABEL);
}

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

  it('Confirmar descarte calls the discard wrapper exactly once with the id + source + reason', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    openDiscardWithReason();
    fireEvent.click(confirmDiscardButton());

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    const [id, opts] = mockDiscard.mock.calls[0].arguments;
    assert.equal(id, 'cand-1');
    assert.deepEqual(opts, { source: 'prospectos_drawer', reason: OUT_OF_SEGMENT_LABEL });
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
    // Never approves as a side effect of discarding.
    assert.equal(mockApprove.mock.callCount(), 0);
  });

  it('on ok, closes the confirmation and refreshes (success path)', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    openDiscardWithReason();
    fireEvent.click(confirmDiscardButton());

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
    // Panel closes back to the default action row on success.
    await waitFor(() => assert.equal(screen.queryByText('¿Descartar prospecto?'), null));
    assert.ok(buttonByText('Descartar'));
  });

  it('on failure, keeps the confirmation open and does NOT refresh (error path)', async () => {
    mockDiscard.mock.mockImplementationOnce(async () => ({ ok: false, reason: 'discard_failed' }));
    render(<ProspectReviewActions candidate={candidate({})} />);
    openDiscardWithReason();
    fireEvent.click(confirmDiscardButton());

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    // No navigation refresh on failure; the confirmation stays open for retry.
    assert.equal(mockRefresh.mock.callCount(), 0);
    assert.ok(screen.getByText('¿Descartar prospecto?'));
  });
});

// ── Q3F-5BB.11K-FIX — mandatory traceable motive ─────────────────────────────

describe('ProspectReviewActions — discard requires a traceable motive', () => {
  it('opening the panel shows the motive instruction, the catalog and the notes field', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);

    assert.ok(screen.getByText('Selecciona el motivo para conservar trazabilidad del descarte.'));
    assert.ok(buttonByText(OUT_OF_SEGMENT_LABEL), 'predefined reasons must be offered');
    assert.ok(buttonByText(OTHER_LABEL), '"Otro motivo" must be offered');
    assert.ok(screen.getByLabelText(/Notas adicionales \(opcional\)/));
  });

  it('Confirmar descarte is DISABLED until a motive is provided', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    assert.equal(confirmDiscardButton().disabled, true);
    assert.equal(mockDiscard.mock.callCount(), 0);
  });

  it('clicking the disabled confirm never calls the wrapper', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    fireEvent.click(confirmDiscardButton());
    assert.equal(mockDiscard.mock.callCount(), 0);
  });

  it('selecting a predefined motive enables confirm and sends the label', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    pickReason(OUT_OF_SEGMENT_LABEL);
    assert.equal(confirmDiscardButton().disabled, false);

    fireEvent.click(confirmDiscardButton());
    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    assert.equal(mockDiscard.mock.calls[0].arguments[1]?.reason, OUT_OF_SEGMENT_LABEL);
  });

  it('composes "<label>: <notas>" when additional notes are provided', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    pickReason(OUT_OF_SEGMENT_LABEL);
    typeReasonNotes('  no atiende sector salud  ');

    fireEvent.click(confirmDiscardButton());
    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    assert.equal(
      mockDiscard.mock.calls[0].arguments[1]?.reason,
      `${OUT_OF_SEGMENT_LABEL}: no atiende sector salud`,
    );
  });

  it('"Otro motivo" requires free text: confirm stays disabled until it is typed', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    pickReason(OTHER_LABEL);
    // The label switches to the custom-motive copy and confirm is still blocked.
    assert.ok(screen.getByLabelText(/Motivo personalizado/));
    assert.equal(confirmDiscardButton().disabled, true);

    typeReasonNotes('ab'); // below the 3-character minimum
    assert.equal(confirmDiscardButton().disabled, true);

    typeReasonNotes('Entidad sin ánimo de lucro fuera de alcance');
    assert.equal(confirmDiscardButton().disabled, false);

    fireEvent.click(confirmDiscardButton());
    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    assert.equal(
      mockDiscard.mock.calls[0].arguments[1]?.reason,
      'Entidad sin ánimo de lucro fuera de alcance',
    );
  });

  it('always sends a NON-EMPTY reason (never null / undefined / blank)', async () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    openDiscardWithReason();
    fireEvent.click(confirmDiscardButton());

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    const reason = mockDiscard.mock.calls[0].arguments[1]?.reason;
    assert.equal(typeof reason, 'string');
    assert.ok((reason as string).trim().length >= 3);
  });

  it('Cancelar clears the motive: reopening the panel starts blank', () => {
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    pickReason(OUT_OF_SEGMENT_LABEL);
    typeReasonNotes('contexto que no debe persistir');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    assert.equal(mockDiscard.mock.callCount(), 0);

    fireEvent.click(buttonByText('Descartar')!);
    const textarea = screen.getByLabelText(/Notas adicionales \(opcional\)/) as HTMLTextAreaElement;
    assert.equal(textarea.value, '');
    assert.equal(confirmDiscardButton().disabled, true, 'no motive carried over');
  });

  it('a failed discard KEEPS the panel open with the typed motive intact', async () => {
    mockDiscard.mock.mockImplementationOnce(async () => ({ ok: false, reason: 'invalid_reason' }));
    render(<ProspectReviewActions candidate={candidate({})} />);
    fireEvent.click(buttonByText('Descartar')!);
    pickReason(OUT_OF_SEGMENT_LABEL);
    typeReasonNotes('detalle a conservar');
    fireEvent.click(confirmDiscardButton());

    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    assert.equal(mockRefresh.mock.callCount(), 0);
    assert.ok(screen.getByText('¿Descartar prospecto?'));
    const textarea = screen.getByLabelText(/Notas adicionales \(opcional\)/) as HTMLTextAreaElement;
    assert.equal(textarea.value, 'detalle a conservar');
  });

  it('does not double-submit while the discard is in flight', async () => {
    let resolveDiscard: ((r: { ok: true; status: 'discarded' }) => void) | undefined;
    mockDiscard.mock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDiscard = resolve as (r: { ok: true; status: 'discarded' }) => void;
        }),
    );

    render(<ProspectReviewActions candidate={candidate({})} />);
    openDiscardWithReason();
    fireEvent.click(confirmDiscardButton());
    await waitFor(() => assert.equal(mockDiscard.mock.callCount(), 1));
    // In flight: the confirm button is disabled, further clicks are inert.
    await waitFor(() => assert.equal(confirmDiscardButton().disabled, true));
    fireEvent.click(confirmDiscardButton());
    assert.equal(mockDiscard.mock.callCount(), 1);

    resolveDiscard?.({ ok: true, status: 'discarded' });
    await waitFor(() => assert.equal(mockRefresh.mock.callCount(), 1));
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
    // Q3F-5BB.11K-FIX — the armed panel still requires a motive before it can fire.
    assert.equal(confirmDiscardButton().disabled, true);
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
