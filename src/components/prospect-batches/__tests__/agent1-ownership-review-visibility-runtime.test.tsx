/**
 * AGENT1-OWNERSHIP-REVIEW-VISIBILITY (opción C) — RUNTIME: la marca se VE.
 *
 * Renderiza la tabla REAL de candidatas (`CandidatesTableClient`) y comprueba
 * que la fila con `review_flags: ['ownership_unverified']` muestra la señal y
 * que la fila sin marca no la muestra. Es la evidencia de interfaz del corte:
 * no basta con escribir la columna si la cola no la enseña.
 *
 * 🔴 Sin `mock.module`: este fichero no necesita sustituir ningún módulo, así
 * que corre igual en Node 20 y en Node 24. Ver
 * `reference_mock_module_alias_breaks_node20`.
 *
 * Sin red, sin base, sin proveedor, 0 créditos.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ──────────────────────────────────
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
for (const prop of Object.getOwnPropertyNames(dom.window)) {
  const target = globalThis as unknown as Record<string, unknown>;
  if (prop in target) continue;
  const descriptor = Object.getOwnPropertyDescriptor(
    dom.window as unknown as Record<string, unknown>,
    prop,
  );
  if (descriptor) Object.defineProperty(target, prop, descriptor);
}
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
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  OWNERSHIP_UNVERIFIED_LABEL,
  OWNERSHIP_UNVERIFIED_REVIEW_FLAG,
} from '@/modules/prospect-batches/ownership-review-flag';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

// La tabla usa `useRouter` (next/navigation) para refrescar tras una acción.
// Se monta el contexto del app router con un doble inerte: este test NO ejercita
// navegación, sólo lo que la cola MUESTRA.
let AppRouterContext: typeof import('next/dist/shared/lib/app-router-context.shared-runtime')['AppRouterContext'];
const routerStub = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
} as unknown as import('next/dist/shared/lib/app-router-context.shared-runtime').AppRouterInstance;

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let CandidatesTableClient: (typeof import('../candidates-table-client'))['CandidatesTableClient'];

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  cleanup = rtl.cleanup;
  ({ CandidatesTableClient } = await import('../candidates-table-client'));
  ({ AppRouterContext } = await import(
    'next/dist/shared/lib/app-router-context.shared-runtime'
  ));
});

/** Monta la tabla dentro del contexto mínimo que sus dependencias exigen. */
function renderTable(candidates: ProspectCandidateWithReviewer[]): void {
  render(
    <AppRouterContext.Provider value={routerStub}>
      <CandidatesTableClient candidates={candidates} />
    </AppRouterContext.Provider>,
  );
}

afterEach(() => cleanup?.());

function candidate(
  overrides: Partial<ProspectCandidateWithReviewer> = {},
): ProspectCandidateWithReviewer {
  return {
    id: `cand-${Math.random().toString(16).slice(2)}`,
    batch_id: 'batch-1',
    name: 'Empresa Acreditada',
    domain: 'acreditada.com',
    website: 'https://acreditada.com',
    country: 'Colombia',
    country_code: 'CO',
    city: null,
    region: null,
    industry: 'Salud',
    subindustry: null,
    company_size: null,
    employee_count: 700,
    status: 'needs_review',
    duplicate_status: 'no_match',
    source_primary: 'lusha',
    record_origin: 'production',
    review_flags: null,
    metadata: {},
    created_at: '2026-09-19T00:00:00.000Z',
    ...overrides,
  } as unknown as ProspectCandidateWithReviewer;
}

describe('opción C · RUNTIME — la cola muestra la relación no verificada', () => {
  it('🔴 la fila marcada enseña la señal; la acreditada no', () => {
    renderTable([
      candidate({
        id: 'cand-marcada',
        name: 'D1 S.A.S',
        domain: 'tiendasd1.com',
        review_flags: [OWNERSHIP_UNVERIFIED_REVIEW_FLAG],
      }),
      candidate({ id: 'cand-limpia', name: 'Cueros Velez SAS' }),
    ]);

    const badges = screen.getAllByTestId('ownership-unverified-badge');
    assert.equal(badges.length, 1, '🔴 exactamente la fila marcada');
    assert.match(badges[0]!.textContent ?? '', /Relación empresa–dominio no verificada/);

    // Las dos empresas SIGUEN en la cola: la marca no esconde ni descarta.
    assert.ok(screen.getByText('D1 S.A.S'));
    assert.ok(screen.getByText('Cueros Velez SAS'));
  });

  it('una fila SIN evaluación (review_flags null) no enseña nada', () => {
    renderTable([candidate({ review_flags: null })]);
    assert.equal(screen.queryAllByTestId('ownership-unverified-badge').length, 0);
  });

  it('🔴 el tooltip explica que NO afirma que el dominio sea incorrecto', () => {
    renderTable([candidate({ review_flags: [OWNERSHIP_UNVERIFIED_REVIEW_FLAG] })]);
    const badge = screen.getByTestId('ownership-unverified-badge');
    const title = badge.getAttribute('title') ?? '';
    assert.match(title, /No significa que el dominio sea incorrecto/);
  });

  it('la etiqueta de la cola es la del contrato, no una copia suelta', () => {
    renderTable([candidate({ review_flags: [OWNERSHIP_UNVERIFIED_REVIEW_FLAG] })]);
    assert.ok(screen.getByText(OWNERSHIP_UNVERIFIED_LABEL));
  });
});
