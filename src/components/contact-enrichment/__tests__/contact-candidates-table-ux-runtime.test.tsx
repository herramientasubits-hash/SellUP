/**
 * UX-EMPRESAS-CONTACTOS — la tabla de candidatos de contacto
 * (ContactCandidatesDataTableClient) como se usa: indicadores que filtran,
 * estado que corresponde a la cola, celdas de una línea y vista «Lista».
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
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});

let detailOpenFor: string | null = null;
mock.module('@/components/contact-enrichment/contact-candidate-detail-sheet', {
  namedExports: {
    ContactCandidateDetailSheet: (props: { candidateId: string | null; open: boolean }) => {
      detailOpenFor = props.open ? props.candidateId : null;
      return null;
    },
  },
});
mock.module('@/components/contact-enrichment/contacts-enrichment-cta', {
  namedExports: {
    ContactsEnrichmentCTA: () => React.createElement('button', { type: 'button' }, 'Buscar contactos con IA'),
  },
});

let ContactCandidatesDataTableClient: (typeof import('../contact-candidates-data-table-client'))['ContactCandidatesDataTableClient'];

function candidate(overrides: Partial<PendingContactCandidate>): PendingContactCandidate {
  return {
    id: 'k',
    full_name: 'Ana Ruiz',
    title: 'Directora de Talento',
    email: 'ana@acme.co',
    linkedin_url: 'linkedin.com/in/ana',
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'no_match',
    confidence: 0.8,
    enrichment_metadata: { relevance: { status: 'high_relevance', score: 0.9, quality_score: 0.7 } },
    enrichment_run_id: null,
    created_at: '2026-01-10T15:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Acme',
    company_domain: 'acme.co',
    account_id: 'acc-1',
    ...overrides,
  } as unknown as PendingContactCandidate;
}

const CANDIDATES = [
  candidate({ id: 'k1', full_name: 'Ana Ruiz' }),
  candidate({
    id: 'k2',
    full_name: 'Beto Gil',
    email: null,
    title: null,
    enrichment_metadata: { relevance: { status: 'low_relevance' } } as PendingContactCandidate['enrichment_metadata'],
  }),
  candidate({
    id: 'k3',
    full_name: 'Carla Paz',
    linkedin_url: null,
    enrichment_metadata: {} as PendingContactCandidate['enrichment_metadata'],
  }),
];

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidatesDataTableClient } = await import('../contact-candidates-data-table-client'));
});

beforeEach(() => {
  detailOpenFor = null;
  window.localStorage.clear();
});
afterEach(() => cleanup());

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((row) => row.querySelector('button[title]')?.textContent ?? '')
    .filter(Boolean);
}

function indicators(): HTMLElement {
  return screen.getByRole('group', { name: 'Indicadores de candidatos' });
}

describe('Candidatos de contacto — los indicadores son filtros de un toque', () => {
  it('alta relevancia, con email y con LinkedIn, con su recuento', () => {
    render(<ContactCandidatesDataTableClient candidates={CANDIDATES} />);

    const group = within(indicators());
    assert.match(group.getByRole('button', { name: /Alta relevancia/ }).textContent ?? '', /1/);
    assert.match(group.getByRole('button', { name: /Con email/ }).textContent ?? '', /2/);
    assert.match(group.getByRole('button', { name: /Con LinkedIn/ }).textContent ?? '', /2/);
  });

  it('pulsar «Con email» deja solo los que tienen correo; otra vez, todos', () => {
    render(<ContactCandidatesDataTableClient candidates={CANDIDATES} />);
    const button = () => within(indicators()).getByRole('button', { name: /Con email/ });

    fireEvent.click(button());
    assert.deepEqual(rowNames(), ['Ana Ruiz', 'Carla Paz']);
    assert.equal(button().getAttribute('aria-pressed'), 'true');

    fireEvent.click(button());
    assert.equal(rowNames().length, 3);
  });

  it('sin candidatos no hay indicadores y el vacío ofrece buscar', () => {
    render(<ContactCandidatesDataTableClient candidates={[]} />);

    assert.equal(screen.queryByRole('group', { name: 'Indicadores de candidatos' }), null);
    assert.ok(screen.getByRole('button', { name: 'Buscar contactos con IA' }));
  });
});

describe('Candidatos de contacto — el estado corresponde a la cola', () => {
  it('en la cola de pendientes dice «Por revisar»', () => {
    render(<ContactCandidatesDataTableClient candidates={CANDIDATES} queue="pending" />);

    const row = screen.getByRole('button', { name: 'Ana Ruiz' }).closest('tr');
    assert.ok(row);
    assert.ok(within(row).getByText('Por revisar'));
  });

  it('en la cola de duplicados dice «Duplicado», no «Por revisar»', () => {
    const duplicates = CANDIDATES.map((item) =>
      candidate({ ...item, status: 'duplicate' as PendingContactCandidate['status'] }),
    );
    render(<ContactCandidatesDataTableClient candidates={duplicates} queue="duplicates" />);

    const row = screen.getByRole('button', { name: 'Ana Ruiz' }).closest('tr');
    assert.ok(row);
    assert.ok(within(row).getByText('Duplicado'));
    assert.equal(within(row).queryByText('Por revisar'), null);
  });
});

describe('Candidatos de contacto — celdas de una línea', () => {
  it('el correo y LinkedIn van como enlaces con nombre junto al nombre', () => {
    render(<ContactCandidatesDataTableClient candidates={CANDIDATES} />);

    const mail = screen.getByRole('link', { name: 'Escribir a Ana Ruiz (ana@acme.co)' });
    assert.equal(mail.getAttribute('href'), 'mailto:ana@acme.co');
    const linkedin = screen.getByRole('link', { name: /Abrir el LinkedIn de Ana Ruiz/ });
    assert.equal(linkedin.getAttribute('href'), 'https://linkedin.com/in/ana');
  });

  it('los enlaces no abren el detalle; el nombre sí', () => {
    render(<ContactCandidatesDataTableClient candidates={CANDIDATES} />);

    const mail = screen.getByRole('link', { name: 'Escribir a Ana Ruiz (ana@acme.co)' });
    mail.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(mail);
    assert.equal(detailOpenFor, null);

    fireEvent.click(screen.getByRole('button', { name: 'Ana Ruiz' }));
    assert.equal(detailOpenFor, 'k1');
  });

  it('lo que falta es una raya con nombre, no un texto por columna', () => {
    render(<ContactCandidatesDataTableClient candidates={CANDIDATES} />);

    assert.ok(screen.getByText('Sin cargo'));
    assert.ok(screen.getByText('Sin relevancia calculada'));
    assert.ok((screen.getByText('Sin cargo').getAttribute('class') ?? '').includes('sr-only'));
  });

  it('la fuente va en texto: la fila no lleva chips de procedencia', () => {
    render(<ContactCandidatesDataTableClient candidates={CANDIDATES} />);

    const row = screen.getByRole('button', { name: 'Ana Ruiz' }).closest('tr');
    assert.ok(row);
    assert.ok(within(row).getByText('Apollo'));
    assert.equal(row.querySelectorAll('[data-slot="badge"]').length, 0);
  });
});

describe('Candidatos de contacto — vista «Lista»', () => {
  it('pinta cada candidato como fila de lista con lo que importa para decidir', () => {
    window.localStorage.setItem('sellup:table:contact-candidates', JSON.stringify({ view: 'list' }));
    render(<ContactCandidatesDataTableClient candidates={CANDIDATES} />);

    assert.equal(document.querySelector('table'), null);
    const items = screen.getAllByRole('listitem');
    assert.equal(items.length, 3);
    const first = within(items[0]);
    assert.ok(first.getByRole('button', { name: 'Ana Ruiz' }));
    assert.ok(first.getByText('Directora de Talento · Acme · ana@acme.co'));
    assert.ok(first.getByText('Relevancia alta'));
  });
});
