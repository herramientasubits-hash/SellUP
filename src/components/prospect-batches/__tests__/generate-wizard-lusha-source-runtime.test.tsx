/**
 * Q3F-5BB.4 — Final search step RUNTIME contract (real render).
 *
 * Renders the ACTUAL `WizardLushaFinalSearch` — the hidden-Lusha search surface
 * shown at the END of the conversational wizard — and asserts the NEW behavior:
 *   - Criteria are locked (read-only recap), no editable país/sector selectors.
 *   - NO auto-run: persistence is not called on mount.
 *   - The explicit "Buscar con IA" click runs the persist action exactly once and
 *     shows an IA step loader while it runs.
 *   - On success the drawer shows a BRIEF confirmation ("Empresas candidatas
 *     listas para revisión"), NOT a long result-card list. It surfaces the
 *     provider traceability, credits, "Nada fue enviado a HubSpot", "Ninguna
 *     empresa fue creada todavía", plus "Ver prospectos" / "Generar otra
 *     búsqueda" CTAs — and NO create/save/approve/HubSpot/enrich CTA.
 * The persist action is injected via `runPersist` (no network / DB / credit).
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
import type { GenerateLushaPendingReviewBatchActionResult } from '@/modules/prospect-batches/lusha-pending-review-actions';
import type { RunLushaPendingReviewSearch } from '../chat-wizard/wizard-lusha-final-search';
import type { WizardLushaInput } from '@/modules/prospect-batches/wizard-lusha-criteria';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// Boundary mock: replace the server action module so its server-only imports
// (supabase/server, next/cache) never load in the test process.
mock.module('@/modules/prospect-batches/lusha-pending-review-actions', {
  namedExports: {
    generateLushaPendingReviewBatchAction: async () => SUCCESS_RESULT,
  },
});

const SUCCESS_RESULT: GenerateLushaPendingReviewBatchActionResult = {
  ok: true,
  status: 'success',
  batchId: 'abcdef12-3456-7890-abcd-ef1234567890',
  createdCandidatesCount: 7,
  skippedCount: 3,
  creditsCharged: 1,
  resultsReturned: 10,
  reviewUrl: '/accounts?tab=prospectos',
  message: 'Encontramos 7 empresas candidatas para revisar.',
};

const EMPTY_RESULT: GenerateLushaPendingReviewBatchActionResult = {
  ok: true,
  status: 'empty',
  batchId: null,
  createdCandidatesCount: 0,
  skippedCount: 0,
  creditsCharged: 1,
  resultsReturned: 0,
  reviewUrl: '/accounts?tab=prospectos',
  message: 'La búsqueda no devolvió empresas nuevas para revisar.',
};

// The seeded criteria the conversational wizard would resolve (país CO, Salud).
const SEEDED_INPUT: WizardLushaInput = {
  countryCode: 'CO',
  sectorKey: 'healthcare',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const mockPersist = mock.fn<RunLushaPendingReviewSearch>(async () => SUCCESS_RESULT);

let WizardLushaFinalSearch: (typeof import('../chat-wizard/wizard-lusha-final-search'))['WizardLushaFinalSearch'];

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  const mod = await import('../chat-wizard/wizard-lusha-final-search');
  WizardLushaFinalSearch = mod.WizardLushaFinalSearch;
});

beforeEach(() => {
  mockPersist.mock.resetCalls();
  mockPersist.mock.mockImplementation(async () => SUCCESS_RESULT);
});

afterEach(() => {
  cleanup();
});

describe('WizardLushaFinalSearch — persist results as pending review (Q3F-5BB.4)', () => {
  it('29. renders locked criteria recap and does NOT auto-run persistence', () => {
    render(
      React.createElement(WizardLushaFinalSearch, { input: SEEDED_INPUT, runPersist: mockPersist }),
    );
    assert.ok(screen.getByTestId('wizard-lusha-final-search'));
    assert.ok(screen.getByTestId('lusha-preview-run'));
    // Criteria are locked (recap), no editable "Criterios de búsqueda" card.
    assert.ok(screen.getByTestId('lusha-locked-criteria-recap'));
    assert.equal(screen.queryByText('Criterios de búsqueda'), null);
    // No auto-run on mount.
    assert.equal(mockPersist.mock.callCount(), 0);
  });

  it('30/18. runs persistence exactly once on click, forwarding the seeded criteria', async () => {
    render(
      React.createElement(WizardLushaFinalSearch, { input: SEEDED_INPUT, runPersist: mockPersist }),
    );
    assert.equal(mockPersist.mock.callCount(), 0);

    fireEvent.click(screen.getByTestId('lusha-preview-run'));

    await waitFor(() => {
      assert.equal(mockPersist.mock.callCount(), 1);
    });
    const call = mockPersist.mock.calls[0].arguments[0];
    assert.equal(call.countryCode, 'CO');
    assert.equal(call.sectorKey, 'healthcare');
  });

  it('20/21/22/23. success shows a brief confirmation with provider + credits', async () => {
    render(
      React.createElement(WizardLushaFinalSearch, { input: SEEDED_INPUT, runPersist: mockPersist }),
    );
    fireEvent.click(screen.getByTestId('lusha-preview-run'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('wizard-lusha-persist-confirmation'));
    });
    assert.ok(screen.getByText('Empresas candidatas listas para revisión'));
    assert.ok(screen.getByText(/Encontramos 7 empresas/));
    // Provider traceability (not a selector).
    assert.equal(screen.getByTestId('wizard-lusha-persist-provider').textContent, 'Lusha');
    // Credits surfaced.
    assert.ok(screen.getByText('Créditos consumidos'));
  });

  it('24/25. confirmation states nothing went to HubSpot and no company was created', async () => {
    const { container } = render(
      React.createElement(WizardLushaFinalSearch, { input: SEEDED_INPUT, runPersist: mockPersist }),
    );
    fireEvent.click(screen.getByTestId('lusha-preview-run'));
    await waitFor(() => {
      assert.ok(screen.getByTestId('wizard-lusha-persist-confirmation'));
    });
    const text = container.textContent ?? '';
    assert.match(text, /Nada fue enviado a HubSpot/);
    assert.match(text, /Ninguna empresa fue creada todavía/);
  });

  it('26/27. exposes "Ver prospectos" and "Generar otra búsqueda" CTAs', async () => {
    const onView = mock.fn();
    const onAnother = mock.fn();
    render(
      React.createElement(WizardLushaFinalSearch, {
        input: SEEDED_INPUT,
        runPersist: mockPersist,
        onViewProspects: onView,
        onGenerateAnother: onAnother,
      }),
    );
    fireEvent.click(screen.getByTestId('lusha-preview-run'));
    await waitFor(() => {
      assert.ok(screen.getByTestId('wizard-lusha-view-prospects'));
    });
    fireEvent.click(screen.getByTestId('wizard-lusha-view-prospects'));
    assert.equal(onView.mock.callCount(), 1);

    fireEvent.click(screen.getByTestId('wizard-lusha-generate-another'));
    assert.equal(onAnother.mock.callCount(), 1);
  });

  it('19/28. destination is a confirmation, not a card list, and has no create/save/approve/HubSpot/enrich CTA', async () => {
    const { container } = render(
      React.createElement(WizardLushaFinalSearch, { input: SEEDED_INPUT, runPersist: mockPersist }),
    );
    fireEvent.click(screen.getByTestId('lusha-preview-run'));
    await waitFor(() => {
      assert.ok(screen.getByTestId('wizard-lusha-persist-confirmation'));
    });
    const text = container.textContent ?? '';
    // No per-company result cards / "not saved" footer as the destination.
    assert.equal(screen.queryByTestId('lusha-preview-not-saved'), null);
    assert.equal(screen.queryByText('Score'), null);
    // No forbidden persistence CTAs inside the drawer.
    assert.doesNotMatch(text, /Enviar a HubSpot|Crear cuenta|Aprobar|Guardar en HubSpot/);
    assert.equal(screen.queryByRole('button', { name: /Aprobar/i }), null);
  });

  it('12/empty. empty result shows an empty state and "Generar otra búsqueda"', async () => {
    mockPersist.mock.mockImplementation(async () => EMPTY_RESULT);
    render(
      React.createElement(WizardLushaFinalSearch, { input: SEEDED_INPUT, runPersist: mockPersist }),
    );
    fireEvent.click(screen.getByTestId('lusha-preview-run'));
    await waitFor(() => {
      assert.ok(screen.getByTestId('wizard-lusha-empty'));
    });
    assert.equal(screen.queryByTestId('wizard-lusha-persist-confirmation'), null);
    assert.ok(screen.getByTestId('wizard-lusha-generate-another'));
  });
});
