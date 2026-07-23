/**
 * Q3F-5BB.3D — Hidden-provider criteria section RUNTIME contract (real render).
 *
 * Renders the ACTUAL `ProspectCriteriaSection` (the in-wizard, Lusha-backed
 * "Empresas por criterios" form) and asserts the product decision:
 *   - There are NO source tabs (no "Búsqueda con IA" / "Lusha" tab switch).
 *   - NO auto-run: Lusha is not called on mount.
 *   - Lusha runs exactly once, only after the explicit "Buscar empresas" click.
 *   - Results surface human labels (Colombia, Salud, Hospitals & Clinics) and the
 *     "Fuente usada: Lusha" traceability line — NOT a selectable source.
 *   - The read-only "not saved" footer stays; no persistence CTA.
 * The server action is mocked (no network / DB / credit); a spy is injected via
 * `runLushaPreview` to observe invocation.
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

const mockRun = mock.fn<() => Promise<PreviewLushaCompaniesActionResult>>(async () => OK_RESULT);

let ProspectCriteriaSection: (typeof import('../generate-wizard-source-section'))['ProspectCriteriaSection'];

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  const mod = await import('../generate-wizard-source-section');
  ProspectCriteriaSection = mod.ProspectCriteriaSection;
});

beforeEach(() => {
  mockRun.mock.resetCalls();
});

afterEach(() => {
  cleanup();
});

describe('ProspectCriteriaSection — Lusha as hidden provider (no tabs)', () => {
  it('renders the criteria form with NO source tabs and does NOT auto-run Lusha', () => {
    render(React.createElement(ProspectCriteriaSection, { runLushaPreview: mockRun }));

    // The criteria section is present…
    assert.ok(screen.getByTestId('prospect-criteria-section'));
    // …with the run button, but no visible source tabs.
    assert.ok(screen.getByTestId('lusha-preview-run'));
    assert.equal(screen.queryByTestId('generation-source-ia'), null);
    assert.equal(screen.queryByTestId('generation-source-lusha'), null);
    assert.equal(screen.queryByText('Búsqueda con IA'), null);
    assert.equal(screen.queryByText('Fuente de generación'), null);
    // No auto-run on mount.
    assert.equal(mockRun.mock.callCount(), 0);
  });

  it('runs Lusha exactly once on the explicit search click and shows human labels + traceability', async () => {
    render(React.createElement(ProspectCriteriaSection, { runLushaPreview: mockRun }));

    // Still no call before clicking the search button.
    assert.equal(mockRun.mock.callCount(), 0);

    fireEvent.click(screen.getByTestId('lusha-preview-run'));

    await waitFor(() => {
      assert.equal(mockRun.mock.callCount(), 1);
    });

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
