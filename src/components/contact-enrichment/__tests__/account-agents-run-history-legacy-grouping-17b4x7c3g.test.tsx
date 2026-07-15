/**
 * Tests — Account Agents Run History legacy grouping and collapsed defaults
 * (Hito 17B.4X.7C.3G)
 *
 * Render real de React (jsdom + @testing-library/react) sobre
 * AccountAgentsRunHistory. NO llama proveedores, NO navega, NO muta nada —
 * getContactEnrichmentRunProviderUsage se mockea como boundary read-only y
 * cada fixture usa agentRunId=null, así que el efecto de expansión de
 * AccountRunInlineDetail nunca la invoca de todas formas.
 *
 * Requiere --experimental-test-module-mocks (mock.module) para interceptar
 * `@/modules/contact-enrichment/run-viewer-actions` antes de importar el
 * componente bajo prueba.
 *
 * Secciones:
 *   1 — Runs modernos (Lusha/Apollo) se muestran arriba en la sección principal
 *   2 — Runs legacy se agrupan en "Runs antiguos o reemplazados" con contador
 *   3 — El grupo legacy inicia colapsado
 *   4 — Las cards individuales inician colapsadas ("Ver detalle")
 *   5 — Expandir el grupo legacy muestra las cards sin ejecutar nada
 *   6 — Sin runs legacy, no se muestra el grupo ni el encabezado "Runs recientes"
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que
// contact-candidate-detail-sheet-identity-override-17b4w8a.test.tsx) ──────────

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

if (!dom.window.matchMedia) {
  (dom.window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
    query: string,
  ) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
(globalThis as unknown as { matchMedia: unknown }).matchMedia = dom.window.matchMedia;

for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}

// ── Imports que dependen del entorno DOM ──────────────────────────────────────

import * as React from 'react';
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mock de boundary: solo el read-only provider-usage fetch ─────────────────
// No se llama nunca en estos tests (todas las fixtures usan agentRunId=null),
// pero se mockea igual para no depender de red/Supabase real al importar.

const mockGetProviderUsage = mock.fn<() => Promise<unknown[]>>(async () => []);

mock.module('@/modules/contact-enrichment/run-viewer-actions', {
  namedExports: {
    getContactEnrichmentRunProviderUsage: (...args: unknown[]) =>
      mockGetProviderUsage(...(args as [])),
  },
});

let AccountAgentsRunHistory: (typeof import('../account-agents-run-history'))['AccountAgentsRunHistory'];

// ── Fixtures ───────────────────────────────────────────────────────────────────

function baseRun(overrides: Partial<AccountContactEnrichmentRun> = {}): AccountContactEnrichmentRun {
  return {
    id: '5e6fcc30-8449-4816-b46b-63a190704665',
    accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    status: 'ready_for_review',
    companyName: 'Siteco Soluciones',
    companyDomain: 'sitecosoluciones.com',
    companyCountryCode: 'CO',
    intendedProvider: 'lusha',
    providersUsed: ['lusha'],
    attemptOrder: 1,
    estimatedCostUsd: 0.008,
    realCostUsd: null,
    agentRunId: null,
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-10T12:05:00.000Z',
    candidateCount: 0,
    pendingReviewCount: 0,
    approvedCount: 0,
    totalCreditsUsed: 1,
    providerUsageStatuses: ['success'],
    summaryError: null,
    ...overrides,
  };
}

function lushaRun(id: string, createdAt: string): AccountContactEnrichmentRun {
  return baseRun({ id, createdAt, providersUsed: ['lusha'], intendedProvider: 'lusha', candidateCount: 3 });
}

function apolloRun(id: string, createdAt: string): AccountContactEnrichmentRun {
  return baseRun({ id, createdAt, providersUsed: ['apollo'], intendedProvider: 'apollo', candidateCount: 2 });
}

function legacyRun(id: string, createdAt: string): AccountContactEnrichmentRun {
  return baseRun({
    id,
    createdAt,
    providersUsed: [],
    intendedProvider: null,
    candidateCount: 0,
    totalCreditsUsed: 0,
    estimatedCostUsd: 0,
    status: 'superseded',
  });
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ AccountAgentsRunHistory } = await import('../account-agents-run-history'));
});

beforeEach(() => {
  mockGetProviderUsage.mock.resetCalls();
});

after(() => {
  cleanup();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AccountAgentsRunHistory — legacy grouping (Hito 17B.4X.7C.3G)', () => {
  it('shows modern Lusha/Apollo runs in the main section, and groups legacy runs separately with a count', () => {
    const runs = [
      lushaRun('11111111-1111-1111-1111-111111111111', '2026-07-14T10:00:00.000Z'),
      apolloRun('22222222-2222-2222-2222-222222222222', '2026-07-13T10:00:00.000Z'),
      legacyRun('33333333-3333-3333-3333-333333333333', '2026-07-02T10:00:00.000Z'),
      legacyRun('44444444-4444-4444-4444-444444444444', '2026-07-03T10:00:00.000Z'),
    ];

    render(<AccountAgentsRunHistory runs={runs} />);

    assert.ok(screen.getAllByText('Lusha').length > 0);
    assert.ok(screen.getAllByText('Apollo').length > 0);
    assert.ok(screen.getByText('Runs antiguos o reemplazados'));
    assert.ok(screen.getByText('2 runs'));

    cleanup();
  });

  it('starts with the legacy group collapsed — no legacy run cards visible until expanded', () => {
    const runs = [
      lushaRun('11111111-1111-1111-1111-111111111111', '2026-07-14T10:00:00.000Z'),
      legacyRun('33333333-3333-3333-3333-333333333333', '2026-07-02T10:00:00.000Z'),
    ];

    render(<AccountAgentsRunHistory runs={runs} />);

    // "Ver detalle" from the primary Lusha card is present, but no legacy
    // card content (its "Ver detalle" toggle) should be in the DOM yet —
    // only the collapsed group header is rendered.
    assert.equal(screen.getAllByText('Ver detalle').length, 1);
    assert.ok(screen.getByText('Runs antiguos o reemplazados'));

    cleanup();
  });

  it('expands the legacy group on click, revealing its run cards without navigating or calling a provider', () => {
    const runs = [
      lushaRun('11111111-1111-1111-1111-111111111111', '2026-07-14T10:00:00.000Z'),
      legacyRun('33333333-3333-3333-3333-333333333333', '2026-07-02T10:00:00.000Z'),
    ];

    render(<AccountAgentsRunHistory runs={runs} />);

    const toggle = screen.getByText('Ver').closest('button');
    assert.ok(toggle, 'expected the legacy group toggle button to exist');
    fireEvent.click(toggle as HTMLButtonElement);

    // Now the legacy card's own "Ver detalle" toggle is in the DOM too.
    assert.equal(screen.getAllByText('Ver detalle').length, 2);
    assert.equal(mockGetProviderUsage.mock.callCount(), 0);

    cleanup();
  });

  it('individual run cards start collapsed — no inline detail content rendered before clicking "Ver detalle"', () => {
    const runs = [lushaRun('11111111-1111-1111-1111-111111111111', '2026-07-14T10:00:00.000Z')];

    render(<AccountAgentsRunHistory runs={runs} />);

    assert.equal(screen.queryByText('Cargando detalle…'), null);
    assert.equal(mockGetProviderUsage.mock.callCount(), 0);

    cleanup();
  });

  it('omits the legacy group and the "Runs recientes" label entirely when there are no legacy runs', () => {
    const runs = [
      lushaRun('11111111-1111-1111-1111-111111111111', '2026-07-14T10:00:00.000Z'),
      apolloRun('22222222-2222-2222-2222-222222222222', '2026-07-13T10:00:00.000Z'),
    ];

    render(<AccountAgentsRunHistory runs={runs} />);

    assert.equal(screen.queryByText('Runs antiguos o reemplazados'), null);
    assert.equal(screen.queryByText('Runs recientes'), null);

    cleanup();
  });
});
