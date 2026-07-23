/**
 * Q3F-5BB.3C — Generation source section RUNTIME contract (real render).
 *
 * Renders the ACTUAL `GenerationSourceSection` (the in-wizard Lusha source) and
 * asserts:
 *   - Default source is IA: the IA body renders; the Lusha panel does not.
 *   - Switching to the Lusha tab reveals the read-only Lusha panel but does NOT
 *     auto-run Lusha (spy uncalled on switch).
 *   - Lusha runs exactly once, only after the explicit "Previsualizar en Lusha"
 *     click inside the panel.
 *   - Human labels render in results: Colombia, Salud, Hospitals & Clinics.
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
// never load in the test process.
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

let GenerationSourceSection: (typeof import('../generate-wizard-source-section'))['GenerationSourceSection'];
let LUSHA_READONLY_NOTICE: string;

// Small stateful harness so the controlled source tab actually switches.
function Harness() {
  const [source, setSource] = React.useState<'ia' | 'lusha'>('ia');
  return React.createElement(GenerationSourceSection, {
    source,
    onSourceChange: setSource,
    iaContent: React.createElement('div', { 'data-testid': 'ia-body' }, 'Cuerpo IA'),
    runLushaPreview: mockRun,
  });
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  const mod = await import('../generate-wizard-source-section');
  GenerationSourceSection = mod.GenerationSourceSection;
  const panelMod = await import('../lusha-preview-drawer');
  LUSHA_READONLY_NOTICE = panelMod.LUSHA_PREVIEW_READONLY_NOTICE;
});

beforeEach(() => {
  mockRun.mock.resetCalls();
});

afterEach(() => {
  cleanup();
});

describe('GenerationSourceSection — in-wizard Lusha source', () => {
  it('defaults to the IA source: IA body shows, Lusha panel hidden, no Lusha call', () => {
    render(React.createElement(Harness));
    assert.ok(screen.getByTestId('ia-body'));
    assert.equal(screen.queryByTestId('generation-source-lusha-panel'), null);
    assert.equal(mockRun.mock.callCount(), 0);
  });

  it('switching to the Lusha tab reveals the panel but does NOT auto-run Lusha', async () => {
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('generation-source-lusha'));

    await waitFor(() => {
      assert.ok(screen.getByTestId('generation-source-lusha-panel'));
    });
    // IA body is replaced by the Lusha panel.
    assert.equal(screen.queryByTestId('ia-body'), null);
    // Read-only notice present.
    assert.ok(screen.getByText(LUSHA_READONLY_NOTICE));
    // No auto-run on switch.
    assert.equal(mockRun.mock.callCount(), 0);
  });

  it('runs Lusha exactly once on the explicit preview click and shows human labels', async () => {
    render(React.createElement(Harness));
    fireEvent.click(screen.getByTestId('generation-source-lusha'));
    await waitFor(() => screen.getByTestId('lusha-preview-run'));

    // Still no call before clicking the preview button.
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
    // Read-only "not saved" footer still shown — no persistence CTA.
    assert.ok(screen.getByTestId('lusha-preview-not-saved'));
  });
});
