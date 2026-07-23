/**
 * Q3F-5BB.3E — Final search step RUNTIME contract (real render).
 *
 * Renders the ACTUAL `WizardLushaFinalSearch` — the hidden-Lusha search surface
 * shown at the END of the conversational wizard — and asserts the product
 * decision:
 *   - There are NO source tabs (no "Búsqueda con IA" / "Lusha" tab switch).
 *   - Criteria are locked (already collected conversationally): a read-only recap
 *     is shown, not editable país/sector selectors.
 *   - NO auto-run: Lusha is not called on mount.
 *   - Lusha runs exactly once, only after the explicit "Buscar con IA" click, and
 *     receives the seeded criteria (país CO, sector healthcare).
 *   - Results surface human labels (Colombia, Salud, Hospitals & Clinics) and the
 *     "Fuente usada: Lusha" traceability line — NOT a selectable source.
 *   - The read-only "not saved" footer stays; no persistence CTA.
 * The server action is mocked (no network / DB / credit); a spy is injected via
 * `runLushaPreview` to observe invocation and the seeded input.
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
import type { RunLushaPreview } from '@/components/prospect-batches/lusha-preview-drawer';
import type { WizardLushaInput } from '@/modules/prospect-batches/wizard-lusha-criteria';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// Boundary mock: replace the server action module so its server-only imports
// (supabase/server, next/navigation) never load in the test process.
mock.module('@/modules/prospect-batches/lusha-preview-actions', {
  namedExports: {
    previewLushaCompaniesAction: async () => OK_RESULT,
  },
});

// Result with human labels: Colombia / Salud / Hospitals & Clinics.
const OK_RESULT: PreviewLushaCompaniesActionResult = {
  ok: true,
  status: 'success',
  results: [
    {
      providerCompanyId: 'lusha-1',
      name: 'Clínica Demo',
      domain: 'clinicademo.co',
      country: 'Colombia',
      countryIso2: 'CO',
      industry: 'Hospitals & Clinics',
      employeesExact: 320,
      employeesMin: null,
      employeesMax: null,
      linkedinUrl: null,
      score: 88,
      passesGate: true,
      issues: [],
    },
  ],
  billing: { creditsCharged: 1, resultsReturned: 1, expectedMaxCredits: 1 },
  warnings: [],
  requestSummary: {
    country: 'Colombia',
    countryCode: 'CO',
    sector: 'Salud',
    sectorKey: 'healthcare',
    mainIndustriesIds: [11],
    subIndustryId: null,
    sizeBand: { min: 201, max: 5000 },
    hasSearchText: false,
  },
};

// The seeded criteria the conversational wizard would resolve (país CO, Salud).
const SEEDED_INPUT: WizardLushaInput = {
  countryCode: 'CO',
  sectorKey: 'healthcare',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const mockRun = mock.fn<RunLushaPreview>(async () => OK_RESULT);

let WizardLushaFinalSearch: (typeof import('../chat-wizard/wizard-lusha-final-search'))['WizardLushaFinalSearch'];

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  const mod = await import('../chat-wizard/wizard-lusha-final-search');
  WizardLushaFinalSearch = mod.WizardLushaFinalSearch;
});

beforeEach(() => {
  mockRun.mock.resetCalls();
});

afterEach(() => {
  cleanup();
});

describe('WizardLushaFinalSearch — Lusha as hidden provider at the final step', () => {
  it('renders locked criteria (no editable tabs) and does NOT auto-run Lusha', () => {
    render(
      React.createElement(WizardLushaFinalSearch, { input: SEEDED_INPUT, runLushaPreview: mockRun }),
    );

    // The final search surface is present with an explicit run button…
    assert.ok(screen.getByTestId('wizard-lusha-final-search'));
    assert.ok(screen.getByTestId('lusha-preview-run'));
    // …criteria are locked (recap shown), no editable "Criterios de búsqueda" card.
    assert.ok(screen.getByTestId('lusha-locked-criteria-recap'));
    assert.equal(screen.queryByText('Criterios de búsqueda'), null);
    // …no visible source tabs / selector.
    assert.equal(screen.queryByText('Búsqueda con IA'), null);
    assert.equal(screen.queryByText('Fuente de generación'), null);
    // No auto-run on mount.
    assert.equal(mockRun.mock.callCount(), 0);
  });

  it('runs Lusha exactly once on the explicit search click with the seeded criteria', async () => {
    render(
      React.createElement(WizardLushaFinalSearch, { input: SEEDED_INPUT, runLushaPreview: mockRun }),
    );

    // Still no call before clicking the search button.
    assert.equal(mockRun.mock.callCount(), 0);

    fireEvent.click(screen.getByTestId('lusha-preview-run'));

    await waitFor(() => {
      assert.equal(mockRun.mock.callCount(), 1);
    });

    // The seeded criteria were forwarded to the provider call.
    const call = mockRun.mock.calls[0].arguments[0];
    assert.equal(call.countryCode, 'CO');
    assert.equal(call.sectorKey, 'healthcare');

    // Human labels surfaced in the read-only result (not codes).
    await waitFor(() => {
      assert.ok(screen.getByText('Hospitals & Clinics', { exact: false }));
    });
    assert.ok(screen.getAllByText(/Colombia/).length >= 1);
    assert.ok(screen.getAllByText(/Salud/).length >= 1);

    // Provider shown ONLY as traceability, not as a selector.
    const trace = screen.getByTestId('lusha-preview-provider-traceability');
    assert.match(trace.textContent ?? '', /Fuente usada:/);
    assert.match(trace.textContent ?? '', /Lusha/);

    // Read-only "not saved" footer still shown — no persistence CTA.
    assert.ok(screen.getByTestId('lusha-preview-not-saved'));
  });
});
