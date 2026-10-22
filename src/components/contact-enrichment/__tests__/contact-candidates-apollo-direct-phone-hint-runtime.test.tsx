/**
 * APOLLO-DIRECT-PHONE-HINT-1 — la columna «Teléfono» de la tabla de candidatos
 * muestra la pista gratuita de Apollo cuando no hay número, y nada más.
 *
 * El panel de detalle es un doble: sin red, sin proveedor, sin revelar nada.
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
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});
mock.module('@/components/contact-enrichment/contact-candidate-detail-sheet', {
  namedExports: { ContactCandidateDetailSheet: () => null },
});
mock.module('@/components/contact-enrichment/contacts-enrichment-cta', {
  namedExports: { ContactsEnrichmentCTA: () => null },
});

let ContactCandidatesDataTableClient: (typeof import('../contact-candidates-data-table-client'))['ContactCandidatesDataTableClient'];

function candidate(overrides: Partial<PendingContactCandidate>): PendingContactCandidate {
  return {
    id: 'k',
    full_name: 'Luz Valderrama M',
    title: 'Analista de Cultura y Atracción de Talento',
    email: null,
    linkedin_url: 'linkedin.com/in/luz',
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'no_match',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: null,
    created_at: '2026-10-21T18:13:24.000Z',
    phone_reveal_status: null,
    company_name: 'Laboratorio Instituto Sanitas',
    company_domain: 'sanitas.cl',
    account_id: 'acc-1',
    ...overrides,
  } as unknown as PendingContactCandidate;
}

before(async () => {
  ({ render, screen, within, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidatesDataTableClient } = await import('../contact-candidates-data-table-client'));
});

beforeEach(() => {
  window.localStorage.clear();
  // Todas las columnas visibles: «Teléfono» sale oculta de fábrica.
  window.localStorage.setItem('sellup:table:contact-candidates', JSON.stringify({ hidden: [] }));
});
afterEach(() => cleanup());

function rowOf(name: string): HTMLElement {
  const row = screen.getByRole('button', { name }).closest('tr');
  assert.ok(row);
  return row as HTMLElement;
}

describe('Columna «Teléfono» — pista gratuita de Apollo', () => {
  it('sin número y con has_direct_phone=yes ⇒ «Apollo tiene teléfono», con aviso de que revelar cobra', () => {
    render(
      <ContactCandidatesDataTableClient
        candidates={[candidate({ id: 'k1', enrichment_metadata: { apollo_direct_phone_hint: 'yes' } })]}
      />,
    );
    const badge = within(rowOf('Luz Valderrama M')).getByText('Apollo tiene teléfono');
    assert.match(badge.getAttribute('title') ?? '', /revelar el número sí gasta créditos/);
  });

  it('maybe ⇒ «Apollo quizá tiene teléfono»', () => {
    render(
      <ContactCandidatesDataTableClient
        candidates={[candidate({ id: 'k2', enrichment_metadata: { apollo_direct_phone_hint: 'maybe' } })]}
      />,
    );
    assert.ok(within(rowOf('Luz Valderrama M')).getByText('Apollo quizá tiene teléfono'));
  });

  it('sin pista ⇒ sigue «Sin teléfono»', () => {
    render(<ContactCandidatesDataTableClient candidates={[candidate({ id: 'k3' })]} />);
    const row = rowOf('Luz Valderrama M');
    assert.equal(within(row).queryByText(/Apollo .*tiene teléfono/), null);
  });

  it('con número revelado ⇒ se muestra el número, no la pista', () => {
    render(
      <ContactCandidatesDataTableClient
        candidates={[
          candidate({ id: 'k4', phone: '+56 9 1234 5678', enrichment_metadata: { apollo_direct_phone_hint: 'yes' } }),
        ]}
      />,
    );
    const row = rowOf('Luz Valderrama M');
    assert.ok(within(row).getByText('+56 9 1234 5678'));
    assert.equal(within(row).queryByText('Apollo tiene teléfono'), null);
  });
});

describe('Columna «Revelar teléfono» — no contradice al número que ya está', () => {
  it('reveal viejo `no_phone_found` pero el candidato ya tiene número ⇒ «Ya tiene teléfono», nunca «Sin teléfono»', () => {
    render(
      <ContactCandidatesDataTableClient
        candidates={[
          candidate({
            id: 'k5',
            phone: '+56 9 8765 4321',
            phone_reveal_status: 'no_phone_found' as PendingContactCandidate['phone_reveal_status'],
          }),
        ]}
      />,
    );
    const row = rowOf('Luz Valderrama M');
    assert.ok(within(row).getByText('Ya tiene teléfono'));
    assert.equal(within(row).queryByText('Sin teléfono'), null);
  });

  it('`no_phone_found` sin número ⇒ sigue «Sin teléfono»', () => {
    render(
      <ContactCandidatesDataTableClient
        candidates={[
          candidate({
            id: 'k6',
            phone_reveal_status: 'no_phone_found' as PendingContactCandidate['phone_reveal_status'],
          }),
        ]}
      />,
    );
    const row = rowOf('Luz Valderrama M');
    // Las dos columnas dicen «Sin teléfono»: la del número y la del reveal.
    assert.equal(within(row).getAllByText('Sin teléfono').length >= 1, true);
    assert.equal(within(row).queryByText('Ya tiene teléfono'), null);
  });
});
