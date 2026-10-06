/**
 * AGENT2A-CANDIDATE-COMPANY-REASSIGN-1 — «Reasignar empresa» desde Trazabilidad.
 *
 * Caso real: un candidato (p. ej. juvenal.lavin@pizzapizza.cl) sin cuenta SellUp ni empresa
 * HubSpot no se podía aprobar. La ficha avisa, ofrece «Reasignar empresa», busca igual que el
 * AGENTE IA (nombre, dominio o HubSpot ID en SellUp y HubSpot) y confirma por id.
 *
 * Acciones de servidor dobles: sin red, sin proveedor, nada se aprueba.
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
import type { CompanyCandidate, PendingContactCandidate } from '@/modules/contact-enrichment/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

let currentCandidate: PendingContactCandidate | null = null;
const mockGetById = mock.fn(async () => currentCandidate);
const mockResolve = mock.fn<(input: unknown) => Promise<unknown>>(async () => ({
  success: true,
  data: {
    resolved: true,
    singleMatch: false,
    skippedHubSpot: false,
    candidates: [
      {
        source: 'sellup',
        sellupAccountId: 'acc-pizza',
        name: 'Pizza Pizza Chile',
        domain: 'pizzapizza.cl',
        country: 'Chile',
        matchConfidence: 0.9,
      },
      {
        source: 'hubspot',
        hubspotCompanyId: '987654321',
        name: 'Pizza Pizza',
        domain: 'pizzapizza.cl',
        matchConfidence: 0.8,
      },
      { source: 'manual', name: 'pizzapizza.cl', matchConfidence: 0.5 },
    ] as CompanyCandidate[],
  },
}));
const mockReassign = mock.fn<(id: string, selection: unknown) => Promise<unknown>>(async () => ({
  ok: true,
  message: 'Empresa reasignada a Pizza Pizza Chile. Ya puedes aprobar el candidato.',
}));

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getReviewableContactCandidateById: () => mockGetById(),
    approveContactCandidate: async () => ({ ok: true }),
    discardContactCandidate: async () => ({ ok: true }),
    resolveContactEnrichmentCompanyAction: (input: unknown) => mockResolve(input),
  },
});
mock.module('@/modules/contact-enrichment/candidate-company-reassignment-actions', {
  namedExports: {
    reassignContactCandidateCompanyAction: (id: string, selection: unknown) =>
      mockReassign(id, selection),
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

function makeCandidate(overrides: Partial<PendingContactCandidate> = {}): PendingContactCandidate {
  return {
    id: 'cand-pizza',
    full_name: 'Contacto De Prueba',
    title: 'Gerente',
    email: 'contacto.prueba@pizzapizza.cl',
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
    company_name: 'Pizza Pizza',
    company_domain: null,
    account_id: null,
    hubspot_company_id: null,
    ...overrides,
  } as PendingContactCandidate;
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  mockGetById.mock.resetCalls();
  mockResolve.mock.resetCalls();
  mockReassign.mock.resetCalls();
});
afterEach(() => cleanup());

async function renderSheet(candidate: PendingContactCandidate) {
  currentCandidate = candidate;
  render(<ContactCandidateDetailSheet candidateId={candidate.id} open onClose={() => {}} />);
  await screen.findByText('Trazabilidad');
}

describe('Reasignar empresa — ficha del candidato', () => {
  it('sin empresa: avisa por qué no se puede aprobar y ofrece «Reasignar empresa»', async () => {
    await renderSheet(makeCandidate());
    assert.ok(screen.getByText('Sin empresa asociada'));
    assert.ok(screen.getByRole('button', { name: 'Reasignar empresa' }));
  });

  it('con empresa: no muestra el aviso pero sí permite reasignar', async () => {
    await renderSheet(makeCandidate({ account_id: 'acc-1', company_domain: 'pizzapizza.cl' }));
    assert.equal(screen.queryByText('Sin empresa asociada'), null);
    assert.ok(screen.getByRole('button', { name: 'Reasignar empresa' }));
  });

  it('busca en SellUp/HubSpot, oculta «manual» y reasigna la empresa elegida por id', async () => {
    await renderSheet(makeCandidate());
    fireEvent.click(screen.getByRole('button', { name: 'Reasignar empresa' }));

    const input = (await screen.findByPlaceholderText(
      'Escribe el nombre, dominio o HubSpot ID…',
    )) as HTMLInputElement;
    assert.equal(input.value, 'pizzapizza.cl', 'sugiere el dominio del correo');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText('Pizza Pizza Chile');
    assert.deepEqual(mockResolve.mock.calls[0].arguments[0], { companyDomain: 'pizzapizza.cl' });
    const radios = screen.getAllByRole('radio');
    assert.equal(radios.length, 2, 'la opción «manual» no se ofrece');
    assert.match(radios[1].textContent ?? '', /HubSpot/);

    fireEvent.click(screen.getByRole('radio', { name: /Pizza Pizza Chile/ }));
    const confirm = screen
      .getAllByRole('button', { name: 'Reasignar empresa' })
      .find((b) => b.closest('[role="dialog"]'));
    assert.ok(confirm);
    const reloadsBefore = mockGetById.mock.callCount();
    fireEvent.click(confirm);

    await waitFor(() => assert.equal(mockReassign.mock.callCount(), 1));
    assert.deepEqual(mockReassign.mock.calls[0].arguments, [
      'cand-pizza',
      { source: 'sellup', sellupAccountId: 'acc-pizza' },
    ]);
    await waitFor(() => assert.ok(mockGetById.mock.callCount() > reloadsBefore, 'relee el candidato'));
  });

  it('un candidato ya marcado como duplicado no ofrece reasignar', async () => {
    await renderSheet(makeCandidate({ status: 'duplicate' as PendingContactCandidate['status'] }));
    assert.equal(screen.queryByRole('button', { name: 'Reasignar empresa' }), null);
  });
});
