/**
 * UX-EMPRESAS-CONTACTOS — el panel de detalle de un prospecto
 * (CandidateDetailSheet) como se lee.
 *
 *   1. Cada sección tiene UN título (antes: un rótulo plegable y, dentro, una
 *      tarjeta que lo repetía), en frase («Datos oficiales y legales»).
 *   2. Sin evaluación no hay tarjetas con rayas: un resumen dice el estado y qué
 *      falta para evaluar.
 *   3. Una sección plegada adelanta lo que contiene, y arranca abierta la que
 *      trae algo que decidir.
 *   4. El pie: «Aprobar» cierra la fila; sin jerga de proyecto.
 *
 * Las acciones de servidor son dobles: nada se aprueba ni se descarta.
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
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});
mock.module('sonner', {
  namedExports: { toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} } },
});
mock.module('@/modules/prospect-review/approve-and-convert-actions', {
  namedExports: {
    approveAndConvertPendingReviewCandidateAction: async () => ({ ok: false, reason: 'unexpected_error' }),
  },
});
mock.module('@/modules/prospect-review/discard-actions', {
  namedExports: { discardPendingReviewCandidateAction: async () => ({ ok: false, reason: 'unexpected_error' }) },
});
mock.module('@/modules/prospect-review/duplicate-actions', {
  namedExports: {
    markDuplicatePendingReviewCandidateAction: async () => ({ ok: false, reason: 'unexpected_error' }),
  },
});

let CandidateDetailSheet: (typeof import('../candidate-detail-sheet'))['CandidateDetailSheet'];

const BASE: ProspectCandidateWithReviewer = {
  id: 'cand-1',
  batch_id: 'batch-1',
  account_id: null,
  name: 'Acme Analytics SA',
  legal_name: null,
  normalized_name: null,
  website: 'acme.com',
  domain: null,
  country: null,
  country_code: 'CO',
  city: null,
  region: null,
  industry: null,
  company_size: null,
  tax_identifier: null,
  tax_identifier_type: null,
  source_primary: null,
  sources_checked: [],
  duplicate_status: 'no_match',
  matched_account_id: null,
  matched_hubspot_company_id: null,
  confidence_score: null,
  fit_score: null,
  data_completeness_score: null,
  estimated_cost_usd: null,
  status: 'needs_review',
  review_notes: null,
  reviewed_by: null,
  reviewed_at: null,
  converted_account_id: null,
  metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  record_origin: 'production',
  review_status: null,
  review_flags: null,
  source_trace: null,
  commercial_trace: null,
  commercial_fit_status: null,
  legal_status: null,
  reviewer: null,
};

function candidate(overrides: Partial<ProspectCandidateWithReviewer>): ProspectCandidateWithReviewer {
  return { ...BASE, ...overrides };
}

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ CandidateDetailSheet } = await import('../candidate-detail-sheet'));
});

afterEach(() => cleanup());

function renderSheet(overrides: Partial<ProspectCandidateWithReviewer> = {}) {
  return render(<CandidateDetailSheet candidate={candidate(overrides)} open onOpenChange={() => {}} />);
}

function sectionToggle(name: RegExp): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('Detalle de prospecto — un solo título por sección, en frase', () => {
  it('«Datos oficiales y legales» aparece una vez y no en mayúsculas de título', () => {
    renderSheet();

    assert.equal(screen.getAllByText('Datos oficiales y legales').length, 1);
    assert.equal(screen.queryByText('Datos Oficiales y Legales'), null);
  });

  it('ninguna sección plegable repite su nombre dentro', () => {
    renderSheet({ website: 'acme.com' });

    for (const title of ['Datos comerciales y web', 'Tamaño ICP', 'Identificador fiscal']) {
      assert.equal(screen.getAllByRole('heading', { name: new RegExp(`^${title}`) }).length, 1, title);
    }
    for (const legacy of ['Datos Comerciales y Web', 'Identificador Fiscal', 'Evidencia Pública']) {
      assert.equal(screen.queryByText(legacy), null, legacy);
    }
  });
});

describe('Detalle de prospecto — cabecera', () => {
  it('lleva el nombre y el estado', () => {
    renderSheet();

    const dialog = screen.getByRole('dialog');
    assert.ok(within(dialog).getByRole('heading', { name: 'Acme Analytics SA' }));
    assert.ok(within(dialog).getByText('Necesita revisión'));
  });

  it('no mete bloques dentro del párrafo de la descripción (HTML válido)', () => {
    renderSheet();

    for (const paragraph of Array.from(document.querySelectorAll('p'))) {
      assert.equal(paragraph.querySelector('div'), null, 'un <p> no puede contener un <div>');
    }
  });
});

describe('Detalle de prospecto — resumen sin rayas', () => {
  it('sin evaluación dice el estado y qué falta para evaluar', () => {
    renderSheet({ website: null });

    assert.ok(screen.getByText('Sin evaluación de IA todavía'));
    assert.ok(screen.getByText('Falta para evaluar'));
    assert.ok(screen.getByText('Sitio web oficial'));
    assert.equal(screen.queryByText('/ 100'), null, 'no hay tarjeta de encaje vacía');
    assert.equal(screen.queryByText('Completitud'), null);
  });

  it('con evaluación muestra el encaje y no el aviso de «sin evaluación»', () => {
    renderSheet({ fit_score: 82, data_completeness_score: 70 });

    assert.ok(screen.getByText('82'));
    assert.ok(screen.getByText('/ 100'));
    assert.ok(screen.getByText('Completitud'));
    assert.equal(screen.queryByText('Sin evaluación de IA todavía'), null);
  });
});

describe('Detalle de prospecto — las secciones plegadas dicen qué contienen', () => {
  it('«Datos comerciales y web» abre sola cuando hay sitio web, y plegada lo resume', () => {
    renderSheet({ website: 'acme.com' });
    const toggle = sectionToggle(/Datos comerciales y web/);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');

    fireEvent.click(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.match(toggle.textContent ?? '', /acme\.com · sin LinkedIn · sin tamaño/);
  });

  it('sin sitio web ni LinkedIn arranca plegada y lo dice en su resumen', () => {
    renderSheet({ website: null });

    const toggle = sectionToggle(/Datos comerciales y web/);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.match(toggle.textContent ?? '', /sin sitio web oficial · sin LinkedIn · sin tamaño/);
  });

  it('«Identificador fiscal» plegada dice si ya está validado', () => {
    renderSheet({ tax_identifier: '900123456-7', tax_identifier_type: 'NIT' });

    const toggle = sectionToggle(/Identificador fiscal/);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.match(toggle.textContent ?? '', /900123456-7 · validado/);
  });

  it('«Identificador fiscal» abre sola cuando hay una sugerencia que decidir', () => {
    renderSheet({
      metadata: {
        tax_identifier_lookup: {
          status: 'completed',
          best_candidate: {
            tax_identifier: '900123456-7',
            source_name: 'RUES',
            source_url: null,
            legal_name: 'Acme Analytics SA',
            confidence: 'high',
          },
        },
      } as unknown as ProspectCandidateWithReviewer['metadata'],
    });

    assert.equal(sectionToggle(/Identificador fiscal/).getAttribute('aria-expanded'), 'true');
    assert.ok(screen.getByRole('button', { name: /Usar este NIT/ }));
  });

  it('«Datos oficiales y legales» arranca abierta', () => {
    renderSheet();

    assert.equal(sectionToggle(/Datos oficiales y legales/).getAttribute('aria-expanded'), 'true');
    assert.ok(screen.getByText('Razón social'));
  });
});

describe('Detalle de prospecto — pie de acciones', () => {
  it('«Aprobar» cierra la fila, tras «Descartar» y «Más acciones»', () => {
    renderSheet();

    const order = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((text) => text === 'Aprobar' || text === 'Descartar' || text === 'Más acciones');
    assert.deepEqual(order, ['Descartar', 'Más acciones', 'Aprobar']);
  });

  it('no habla de hitos de proyecto', () => {
    renderSheet();

    assert.equal(screen.queryByText(/próximos hitos/i), null);
    assert.ok(screen.getByText(/Puedes aprobar, descartar o marcar como duplicado este prospecto\./));
  });

  it('un prospecto ya convertido no ofrece acciones', () => {
    renderSheet({ status: 'converted_to_account', converted_account_id: 'acc-1' });

    assert.equal(screen.queryByRole('button', { name: 'Aprobar' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Descartar' }), null);
    assert.ok(within(document.body).getByText('Conversión a cuenta'));
  });
});
