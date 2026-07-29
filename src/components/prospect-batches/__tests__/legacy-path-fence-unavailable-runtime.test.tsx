/**
 * A1-LEGACY-PATH-FENCE-1 — Capa 4 RUNTIME contract (real render).
 *
 * Renders the ACTUAL `GenerateAIBatchDrawer` for every unavailable state and
 * asserts the fence holds in the DOM, not just in source text:
 *   - The trigger is NOT the billable "Generar con IA" CTA.
 *   - Each state shows its own copy.
 *   - The legacy Apollo form is absent (no país/industria selectors, no submit).
 *   - `generateAIProspectBatch` is NEVER called — the spy stays at zero even
 *     after clicking every button the state renders.
 *   - Retry exists only for a transient catalog failure, and it refreshes the
 *     route instead of running discovery.
 *
 * No network, no database, no provider, no credits.
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
import type { GenerateProspectsUnavailableKind } from '@/components/prospect-batches/generate-ai-batch-experience';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Spend spies ───────────────────────────────────────────────────────────────
// Any call to these is a fence breach, so they are counted rather than stubbed
// silently. The boundary mock also keeps the server-only imports of actions.ts
// (supabase/server, next/cache) out of the test process.
//
// The specifier is RELATIVE, not a `@/` alias: under the ESM loader hooks used on
// CI, `mock.module('@/modules/…')` resolves relative to THIS file
// (`__tests__/@/modules/…`) and throws ERR_MODULE_NOT_FOUND before any test runs.
let generateCalls = 0;
let refreshCalls = 0;

mock.module('../../../modules/prospect-batches/actions', {
  namedExports: {
    generateAIProspectBatch: async () => {
      generateCalls++;
      return { ok: true, batchId: 'should-never-happen', candidatesCreated: 0, estimatedCostUsd: 0 };
    },
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({
      push: () => {},
      replace: () => {},
      refresh: () => {
        refreshCalls++;
      },
      back: () => {},
      forward: () => {},
      prefetch: () => {},
    }),
    usePathname: () => '/accounts',
    useSearchParams: () => new URLSearchParams(),
    redirect: () => {},
  },
});

let GenerateAIBatchDrawer: typeof import('../generate-ai-batch-drawer')['GenerateAIBatchDrawer'];

const COPY: Record<GenerateProspectsUnavailableKind, string> = {
  wizard_disabled: 'La búsqueda de empresas no está disponible temporalmente.',
  catalog_needs_admin:
    'La configuración de industrias no está disponible. Contacta a un administrador.',
  catalog_retryable: 'No pudimos cargar la configuración de búsqueda. Intenta nuevamente.',
};

const KINDS = Object.keys(COPY) as GenerateProspectsUnavailableKind[];

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  fireEvent = rtl.fireEvent;
  cleanup = rtl.cleanup;
  ({ GenerateAIBatchDrawer } = await import('../generate-ai-batch-drawer'));
});

beforeEach(() => {
  generateCalls = 0;
  refreshCalls = 0;
});

afterEach(() => {
  cleanup();
});

/** Renders the drawer in an unavailable state and opens it. */
function openUnavailable(kind: GenerateProspectsUnavailableKind | null) {
  render(
    <GenerateAIBatchDrawer
      experience="unavailable"
      unavailableKind={kind}
      catalog={null}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Búsqueda no disponible/i }));
}

// ── Trigger ───────────────────────────────────────────────────────────────────

describe('Capa 4 — the unavailable trigger is not a billable CTA', () => {
  for (const kind of KINDS) {
    it(`${kind}: trigger reads "Búsqueda no disponible", never "Generar con IA"`, () => {
      render(
        <GenerateAIBatchDrawer experience="unavailable" unavailableKind={kind} catalog={null} />,
      );
      assert.ok(screen.getByRole('button', { name: /Búsqueda no disponible/i }));
      assert.equal(screen.queryByRole('button', { name: /Generar con IA/i }), null);
    });
  }
});

// ── Copy per state ────────────────────────────────────────────────────────────

describe('Capa 4 — each unavailable state shows its own copy', () => {
  for (const kind of KINDS) {
    it(`${kind}: shows the expected message`, () => {
      openUnavailable(kind);
      assert.ok(screen.getByText(COPY[kind]));
    });

    it(`${kind}: shows ONLY its own message`, () => {
      openUnavailable(kind);
      for (const other of KINDS) {
        if (other === kind) continue;
        assert.equal(screen.queryByText(COPY[other]), null);
      }
    });
  }

  it('a null kind falls back to the safest copy (wizard_disabled)', () => {
    openUnavailable(null);
    assert.ok(screen.getByText(COPY.wizard_disabled));
  });
});

// ── No legacy form, no execution ──────────────────────────────────────────────

describe('Capa 4 — the legacy Apollo form is absent and nothing can execute', () => {
  for (const kind of KINDS) {
    it(`${kind}: no legacy form controls are rendered`, () => {
      openUnavailable(kind);
      assert.equal(screen.queryByText(/Selecciona un país/i), null);
      assert.equal(screen.queryByRole('button', { name: /^Generar prospectos$/i }), null);
      assert.equal(screen.queryByRole('button', { name: /Generar empresas/i }), null);
      assert.equal(screen.queryByText(/Configuración avanzada/i), null);
    });

    it(`${kind}: generateAIProspectBatch is never called on render or open`, () => {
      openUnavailable(kind);
      assert.equal(generateCalls, 0);
    });

    it(`${kind}: clicking EVERY rendered button still calls no provider path`, () => {
      openUnavailable(kind);
      for (const button of screen.queryAllByRole('button')) {
        fireEvent.click(button);
      }
      assert.equal(generateCalls, 0, 'no legacy action call from any control');
    });
  }
});

// ── Retry affordance ──────────────────────────────────────────────────────────

describe('Capa 4 — retry exists only for a transient failure', () => {
  it('catalog_retryable: offers "Intentar de nuevo"', () => {
    openUnavailable('catalog_retryable');
    assert.ok(screen.getByRole('button', { name: /Intentar de nuevo/i }));
  });

  it('wizard_disabled: offers NO retry', () => {
    openUnavailable('wizard_disabled');
    assert.equal(screen.queryByRole('button', { name: /Intentar de nuevo/i }), null);
  });

  it('catalog_needs_admin: offers NO retry (a retry cannot help)', () => {
    openUnavailable('catalog_needs_admin');
    assert.equal(screen.queryByRole('button', { name: /Intentar de nuevo/i }), null);
  });

  it('retry refreshes the route and runs no discovery', () => {
    openUnavailable('catalog_retryable');
    fireEvent.click(screen.getByRole('button', { name: /Intentar de nuevo/i }));
    assert.equal(refreshCalls, 1, 'reloads the catalog via the server component');
    assert.equal(generateCalls, 0, 'no batch, no provider, no credits');
  });
});

// ── Default prop is fail-closed ───────────────────────────────────────────────

describe('Capa 4 — a caller that passes no experience gets the safe state', () => {
  it('renders the unavailable trigger, not the legacy CTA', () => {
    render(<GenerateAIBatchDrawer />);
    assert.ok(screen.getByRole('button', { name: /Búsqueda no disponible/i }));
    assert.equal(screen.queryByRole('button', { name: /Generar con IA/i }), null);
    assert.equal(generateCalls, 0);
  });

  it('a catalog-dependent experience handed a null catalog does NOT fall through to legacy', () => {
    render(<GenerateAIBatchDrawer experience="chat_wizard" catalog={null} />);
    assert.ok(screen.getByRole('button', { name: /Búsqueda no disponible/i }));
    assert.equal(screen.queryByRole('button', { name: /Generar con IA/i }), null);
    assert.equal(generateCalls, 0);
  });
});
