/**
 * Q3F-5BB.3 — Lusha preview panel RUNTIME contract (real render).
 *
 * Renders the ACTUAL `LushaPreviewPanel` and asserts the read-only safety
 * contract of the UI:
 *   - The read-only + cost notices render.
 *   - NO auto-run: the preview action is NOT invoked on mount; it fires exactly
 *     once, and only after the explicit "Previsualizar en Lusha" click.
 *   - searchText lives inside the collapsed "Criterio avanzado" section
 *     (not part of the default surface).
 * The server action is mocked so there is NO network, NO DB, NO credit spend;
 * a spy is injected via the `runPreview` prop to observe invocation.
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

// Boundary mock: replace the server action module entirely so its server-only
// imports (supabase/server, next/navigation) never load in the test process.
mock.module('@/modules/prospect-batches/lusha-preview-actions', {
  namedExports: {
    previewLushaCompaniesAction: async () => EMPTY_OK,
  },
});

const EMPTY_OK: PreviewLushaCompaniesActionResult = {
  ok: true,
  status: 'empty',
  results: [],
  billing: { creditsCharged: null, resultsReturned: 0, expectedMaxCredits: 1 },
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

const mockRun = mock.fn<() => Promise<PreviewLushaCompaniesActionResult>>(async () => EMPTY_OK);

let LushaPreviewPanel: (typeof import('../lusha-preview-drawer'))['LushaPreviewPanel'];
let LUSHA_PREVIEW_READONLY_NOTICE: string;
let LUSHA_PREVIEW_COST_NOTICE: string;

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  const mod = await import('../lusha-preview-drawer');
  LushaPreviewPanel = mod.LushaPreviewPanel;
  LUSHA_PREVIEW_READONLY_NOTICE = mod.LUSHA_PREVIEW_READONLY_NOTICE;
  LUSHA_PREVIEW_COST_NOTICE = mod.LUSHA_PREVIEW_COST_NOTICE;
});

beforeEach(() => {
  mockRun.mock.resetCalls();
});

afterEach(() => {
  cleanup();
});

describe('LushaPreviewPanel — read-only contract', () => {
  it('28. renderiza los avisos read-only y de costo', () => {
    render(React.createElement(LushaPreviewPanel, { runPreview: mockRun }));
    assert.ok(screen.getByText(LUSHA_PREVIEW_READONLY_NOTICE));
    assert.ok(screen.getByText(LUSHA_PREVIEW_COST_NOTICE));
  });

  it('29. NO auto-run: la acción no corre al montar, y corre exactamente una vez al hacer click', async () => {
    render(React.createElement(LushaPreviewPanel, { runPreview: mockRun }));
    // Sin auto-run tras el montaje.
    assert.equal(mockRun.mock.callCount(), 0);

    const button = screen.getByTestId('lusha-preview-run');
    fireEvent.click(button);

    await waitFor(() => {
      assert.equal(mockRun.mock.callCount(), 1);
    });
  });

  it('30. searchText vive en la sección avanzada (colapsada por defecto)', () => {
    render(React.createElement(LushaPreviewPanel, { runPreview: mockRun }));
    // El disparador de la sección avanzada existe.
    assert.ok(screen.getByText('Criterio avanzado (opcional)'));
    // Colapsada: el input de búsqueda libre no está presente hasta expandir.
    assert.equal(screen.queryByPlaceholderText('Ej. telemedicina'), null);
  });
});
