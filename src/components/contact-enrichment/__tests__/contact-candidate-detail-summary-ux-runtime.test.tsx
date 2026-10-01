/**
 * UX-EMPRESAS-CONTACTOS — el resumen del panel de un candidato de contacto.
 *
 * Lo que decide (relevancia, calidad del dato, confianza, duplicidad) se lee
 * arriba del todo, antes de los canales de contacto; antes estaba dos secciones
 * más abajo, tras todo el bloque de teléfonos. No se repite después.
 *
 * Acciones de servidor dobles: sin red, sin proveedor, nada se revela ni se aprueba.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap ──────────────────────────────────────────────────────────

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

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

let getByIdImpl: () => Promise<PendingContactCandidate | null> = async () => null;
const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>(() => getByIdImpl());

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getReviewableContactCandidateById: () => mockGetById(),
    approveContactCandidate: async () => ({ ok: true }),
    discardContactCandidate: async () => ({ ok: true }),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-actions', {
  namedExports: { revealCandidatePhoneAction: async () => ({ ok: true }) },
});
mock.module('@/modules/contact-enrichment/phone-reveal-manual-recovery-actions', {
  namedExports: { recoverCandidatePhoneRevealNowAction: async () => ({ ok: true }) },
});
mock.module('@/modules/contact-enrichment/lusha-phone-fallback-actions', {
  namedExports: { revealCandidatePhoneViaLushaFallbackAction: async () => ({ ok: true }) },
});
mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-actions', {
  namedExports: {
    startPhoneRevealWaterfallAction: async () => ({ ok: true }),
    getPhoneRevealWaterfallAuditAction: async () => null,
  },
});
mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions', {
  namedExports: { startLegacyPhoneRevealWaterfallAction: async () => ({ ok: true }) },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});
mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures (datos 100 % ficticios) ─────────────────────────────────────────

const FAKE_CANDIDATE_ID = 'cand-ficticio-1';
const FAKE_FULL_NAME = 'Contacto De Prueba';

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: FAKE_CANDIDATE_ID,
    full_name: FAKE_FULL_NAME,
    title: 'Cargo de prueba',
    email: 'ficticio@ejemplo.test',
    linkedin_url: null,
    source_contact_id: 'sc-ficticio',
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-ficticio',
    created_at: '2026-08-01T00:00:00.000Z',
    phone_reveal_status: null,
    phone_reveal_last_checked_at: null,
    phone_reveal_requested_at: null,
    phone_reveal_recovery_id_present: false,
    phone_reveal_provider: null,
    company_name: 'Empresa Ficticia SAS',
    company_domain: 'empresa-ficticia.test',
    account_id: 'account-ficticio',
    hubspot_company_id: null,
    ...overrides,
  } as PendingContactCandidate;
}

before(async () => {
  ({ render, screen, within, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  mockGetById.mock.resetCalls();
});
afterEach(() => cleanup());

async function renderSheet(overrides: Partial<PendingContactCandidate> = {}) {
  getByIdImpl = async () => makeCandidate(overrides);
  render(<ContactCandidateDetailSheet candidateId={FAKE_CANDIDATE_ID} open onClose={() => {}} />);
  return screen.findByRole('region', { name: 'Resumen del candidato' });
}

describe('Detalle de candidato de contacto — resumen para decidir', () => {
  it('abre con relevancia, calidad, confianza y duplicidad', async () => {
    const summary = await renderSheet({
      enrichment_metadata: {
        relevance: { status: 'high_relevance', score: 0.9, quality_score: 0.7 },
      } as PendingContactCandidate['enrichment_metadata'],
    });

    assert.ok(within(summary).getByText('Relevancia'));
    assert.equal(within(summary).getByText('Alta').getAttribute('data-slot'), 'badge');
    assert.ok(within(summary).getByText('90%'));
    assert.ok(within(summary).getByText('Calidad del dato'));
    assert.ok(within(summary).getByText('70%'));
    assert.ok(within(summary).getByText('Confianza'));
    assert.ok(within(summary).getByText('80%'));
    assert.ok(within(summary).getByText('Duplicidad'));
  });

  it('va antes que los canales de contacto', async () => {
    const summary = await renderSheet();

    const channels = screen.getByText('Canales de contacto');
    assert.ok(summary.compareDocumentPosition(channels) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('lo que no se calculó lo dice, sin rayas ni «No disponible»', async () => {
    const summary = await renderSheet();

    assert.equal(within(summary).getAllByText('Sin calcular').length, 2);
    assert.equal(within(summary).queryByText('No disponible'), null);
  });

  it('esos datos no se repiten más abajo', async () => {
    await renderSheet({
      enrichment_metadata: {
        relevance: { status: 'high_relevance', score: 0.9, quality_score: 0.7 },
      } as PendingContactCandidate['enrichment_metadata'],
    });

    assert.equal(screen.getAllByText('Relevancia').length, 1);
    assert.equal(screen.queryByText('Evaluación del candidato'), null);
    assert.equal(screen.queryByText('Estado de duplicado'), null);
  });

  it('las señales detectadas tienen su propia sección solo cuando existen', async () => {
    await renderSheet();
    assert.equal(screen.queryByText('Señales detectadas'), null);
    cleanup();

    await renderSheet({
      enrichment_metadata: {
        relevance: { status: 'high_relevance', matched_keywords: ['talento', 'formación'] },
      } as PendingContactCandidate['enrichment_metadata'],
    });
    assert.ok(screen.getByText('Señales detectadas'));
    assert.ok(screen.getByText('talento'));
    assert.ok(screen.getByText('formación'));
  });

  it('el pie conserva «Rechazar» a la izquierda de «Aprobar candidato»', async () => {
    await renderSheet();

    const reject = screen.getByRole('button', { name: /Rechazar/ });
    const approve = screen.getByRole('button', { name: /Aprobar candidato/ });
    assert.ok(reject.compareDocumentPosition(approve) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
