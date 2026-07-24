/**
 * Q3F-5BB.3F — Final review UX RUNTIME contract (real render).
 *
 * Renders the ACTUAL `WizardConversationSummary` at the `validated` step with a
 * Lusha-compatible criteria decision and asserts the polished final review:
 *   - Summary shows human labels: País (Colombia), Sector (Tecnología),
 *     Subindustria (the user's selected label), Tamaño, Criterio adicional.
 *   - Provider is shown only as traceability ("Proveedor configurado: Lusha")
 *     and the estimated cost ("Hasta 1 crédito").
 *   - Banned copy is gone: no "Preview read-only", no "proceder a generar".
 *   - Read-only intent stays via the recap note + credit banner (max 2 banners).
 *   - Action hierarchy: exactly one primary "Buscar con IA"; "Editar búsqueda"
 *     secondary; "Comenzar de nuevo" present but de-emphasized; no "Cerrar".
 *   - No source tabs / separate Lusha selector.
 *   - NO auto-run: Lusha fires only on the explicit "Buscar con IA" click.
 * The server action module is mocked (no network / DB / credit).
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
import type { PreviewLushaCompaniesActionResult } from '@/modules/prospect-batches/lusha-preview-actions';
import type { GenerateLushaPendingReviewBatchActionResult } from '@/modules/prospect-batches/lusha-pending-review-actions';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type {
  ProspectWizardState,
  ProspectWizardAction,
} from '@/modules/prospect-batches/chat-wizard';
import type { WizardLushaCriteriaDecision } from '@/modules/prospect-batches/wizard-lusha-criteria';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

const EMPTY_OK: PreviewLushaCompaniesActionResult = {
  ok: true,
  status: 'empty',
  results: [],
  billing: { creditsCharged: null, resultsReturned: 0, expectedMaxCredits: 1 },
  warnings: [],
  requestSummary: {
    country: 'Colombia',
    countryCode: 'CO',
    sector: 'Tecnología',
    sectorKey: 'technology',
    mainIndustriesIds: [7],
    subIndustryId: null,
    sizeBand: { min: 201, max: 5000 },
    hasSearchText: true,
  },
};

const mockRun = mock.fn<() => Promise<PreviewLushaCompaniesActionResult>>(async () => EMPTY_OK);

const PERSIST_OK: GenerateLushaPendingReviewBatchActionResult = {
  ok: true,
  status: 'success',
  batchId: 'abcdef12-0000-0000-0000-000000000000',
  createdCandidatesCount: 4,
  skippedCount: 0,
  creditsCharged: 1,
  resultsReturned: 4,
  reviewUrl: '/accounts?tab=prospectos',
  message: 'Encontramos 4 empresas candidatas para revisar.',
  pagesRequested: 1,
  expectedMaxCredits: 2,
  creditsChargedTotal: 1,
  usefulCandidatesCount: 4,
  excludedExactDuplicatesCount: 0,
  skippedActiveDuplicatesCount: 0,
  possibleDuplicatesCount: 0,
  insertedCandidatesCount: 4,
  topUpTriggered: false,
};

const mockPersist = mock.fn<() => Promise<GenerateLushaPendingReviewBatchActionResult>>(
  async () => PERSIST_OK,
);

// Boundary mocks: replace the server action modules so their server-only imports
// never load. The final-search calls the persist action; observing `mockPersist`
// lets us assert the no-auto-run + single-click contract.
mock.module('@/modules/prospect-batches/lusha-preview-actions', {
  namedExports: {
    previewLushaCompaniesAction: (...args: unknown[]) => mockRun(...(args as [])),
  },
});
mock.module('@/modules/prospect-batches/lusha-pending-review-actions', {
  namedExports: {
    generateLushaPendingReviewBatchAction: (...args: unknown[]) => mockPersist(...(args as [])),
  },
});
// The validated panel uses next/navigation router for the "Ver prospectos" CTA.
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({
      push: () => {},
      replace: () => {},
      refresh: () => {},
      back: () => {},
      forward: () => {},
      prefetch: () => {},
    }),
    usePathname: () => '/accounts',
    useSearchParams: () => new URLSearchParams(),
    redirect: () => {},
    notFound: () => {},
  },
});

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'tech', name: 'Tecnología', slug: 'tech', description: null, sortOrder: 0 },
  ],
  subindustries: [
    {
      id: 'saas',
      industryId: 'tech',
      name: 'Software Empresarial (SaaS / ERP / CRM)',
      slug: 'saas',
      description: null,
      applicableCountries: null,
      sortOrder: 0,
    },
  ],
};

const CRITERIA_TEXT = 'empresas grandes de más de 200 empleados';

const LUSHA_DECISION: WizardLushaCriteriaDecision = {
  provider: 'lusha',
  reason: 'test',
  input: {
    countryCode: 'CO',
    sectorKey: 'technology',
    subIndustryId: null,
    sizeBandKey: '201-5000',
    searchText: CRITERIA_TEXT,
  },
};

let WizardConversationSummary: (typeof import('../wizard-conversation-summary'))['WizardConversationSummary'];
let createInitialProspectWizardState: (typeof import('@/modules/prospect-batches/chat-wizard'))['createInitialProspectWizardState'];

function makeValidatedState(): ProspectWizardState {
  return {
    ...createInitialProspectWizardState({ catalogVersion: 'v1', defaultRequestedCount: 25 }),
    currentStep: 'validated',
    countryCode: 'CO',
    industryId: 'tech',
    subindustryIds: ['saas'],
    additionalCriteriaRaw: CRITERIA_TEXT,
  };
}

function renderFinalReview() {
  const noop = () => {};
  const dispatch: React.Dispatch<ProspectWizardAction> = () => {};
  return render(
    React.createElement(WizardConversationSummary, {
      state: makeValidatedState(),
      catalog: CATALOG,
      dispatch,
      onClose: noop,
      executionEnabled: false,
      onExecute: noop,
      onEditSearch: noop,
      lushaPreviewEnabled: true,
      lushaCriteria: LUSHA_DECISION,
    }),
  );
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  WizardConversationSummary = (await import('../wizard-conversation-summary')).WizardConversationSummary;
  createInitialProspectWizardState = (
    await import('@/modules/prospect-batches/chat-wizard')
  ).createInitialProspectWizardState;
});

beforeEach(() => {
  mockRun.mock.resetCalls();
  mockPersist.mock.resetCalls();
});

afterEach(() => {
  cleanup();
});

describe('WizardConversationSummary — final review UX (Q3F-5BB.3F)', () => {
  it('shows all human summary labels including subindustria, tamaño y proveedor', () => {
    renderFinalReview();

    assert.ok(screen.getByText(/Colombia/), 'país Colombia');
    assert.ok(screen.getByText('Tecnología'), 'sector Tecnología');
    assert.ok(screen.getByText(/Software Empresarial \(SaaS \/ ERP \/ CRM\)/), 'subindustria');
    assert.ok(screen.getByText('Más de 200 empleados'), 'tamaño');
    assert.ok(screen.getByText(new RegExp(CRITERIA_TEXT)), 'criterio adicional');
    assert.ok(screen.getByText(/Proveedor configurado: Lusha/), 'proveedor traceability');
    assert.ok(screen.getByText(/Hasta 1 crédito/), 'costo estimado');
  });

  it('drops the banned read-only / generar copy and keeps read-only intent', () => {
    const { container } = renderFinalReview();
    const text = container.textContent ?? '';
    assert.doesNotMatch(text, /Preview read-only/i);
    assert.doesNotMatch(text, /proceder a generar/i);
    assert.doesNotMatch(text, /Vista previa de solo lectura/i);
    // Read-only intent still communicated (recap note) + search-candidates copy.
    assert.match(text, /no se guarda/i);
    assert.match(text, /empresas candidatas/i);
  });

  it('renders max 2 banners: validation + credit', () => {
    renderFinalReview();
    assert.ok(screen.getByText('La configuración es válida.'));
    assert.ok(screen.getByTestId('lusha-preview-cost-notice'));
    assert.equal(
      screen.getByTestId('lusha-preview-cost-notice').textContent,
      'Esta búsqueda puede consumir hasta 2 créditos si se necesita completar candidatos útiles.',
    );
    // The old permanent read-only Alert banner is suppressed at the final step.
    assert.equal(screen.queryByTestId('lusha-preview-readonly-notice'), null);
  });

  it('has one primary CTA "Buscar con IA"; edit secondary; restart de-emphasized; no Cerrar', () => {
    renderFinalReview();
    const searchButtons = screen.getAllByRole('button', { name: /Buscar con IA/i });
    assert.equal(searchButtons.length, 1, 'exactly one primary CTA');
    assert.ok(screen.getByTestId('lusha-preview-run'));
    assert.ok(screen.getByRole('button', { name: /Editar búsqueda/i }));
    assert.ok(screen.getByRole('button', { name: /Comenzar de nuevo/i }));
    assert.equal(screen.queryByRole('button', { name: /^Cerrar$/i }), null, 'no Cerrar button');
  });

  it('has no source tabs / separate Lusha selector', () => {
    renderFinalReview();
    assert.equal(screen.queryByText('Búsqueda con IA'), null);
    assert.equal(screen.queryByText('Fuente de generación'), null);
    assert.equal(screen.queryByRole('tab'), null);
    assert.equal(screen.queryByRole('button', { name: /^Lusha$/ }), null);
  });

  it('does NOT auto-run; persists exactly once on the explicit click', async () => {
    renderFinalReview();
    assert.equal(mockPersist.mock.callCount(), 0);
    fireEvent.click(screen.getByTestId('lusha-preview-run'));
    await waitFor(() => {
      assert.equal(mockPersist.mock.callCount(), 1);
    });
    // The brief confirmation replaces the recap — not a results-card list.
    await waitFor(() => {
      assert.ok(screen.getByTestId('wizard-lusha-persist-confirmation'));
    });
  });
});
