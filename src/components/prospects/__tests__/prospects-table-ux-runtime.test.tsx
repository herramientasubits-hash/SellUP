/**
 * UX-EMPRESAS-CONTACTOS — la tabla «Por revisar» (ProspectsDataTableClient)
 * como se usa, no como se pinta.
 *
 *   1. Los indicadores de cabecera son filtros de un toque: el número de cada
 *      uno es lo que queda al pulsarlo, y volver a pulsarlo lo quita.
 *   2. En la vista de una operación (`sourceId`) no hay indicadores.
 *   3. Cada vacío dice por qué no hay filas y ofrece la salida que toca.
 *   4. Las celdas son de una línea y hablan igual que el resto de tablas: país
 *      con bandera y nombre, vacíos con «—», enlaces externos con nombre.
 *   5. La vista «Lista» existe y conserva el menú de acciones de la fila.
 *
 * Los subcomponentes pesados (panel de detalle, menú de fila) son dobles
 * ligeros: sin red, sin base de datos, sin proveedor; nada se aprueba.
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
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

const pushed: string[] = [];
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: (href: string) => pushed.push(href), replace: () => {} }),
  },
});

let openedDetailFor: string | null = null;
mock.module('@/components/prospect-batches/candidate-detail-sheet', {
  namedExports: {
    CandidateDetailSheet: (props: { candidate: { name: string } | null; open: boolean }) => {
      openedDetailFor = props.open ? (props.candidate?.name ?? null) : null;
      return null;
    },
  },
});

mock.module('@/components/prospect-batches/candidate-row-actions', {
  namedExports: {
    CandidateRowActions: (props: { candidate: { name: string } }) =>
      React.createElement('button', { type: 'button' }, `Acciones para ${props.candidate.name}`),
  },
});

let ProspectsDataTableClient: (typeof import('../prospects-data-table-client'))['ProspectsDataTableClient'];

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

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const CANDIDATES = [
  candidate({ id: 'c1', name: 'Acme Analytics SA', city: 'Bogotá', industry: 'Tecnología' }),
  candidate({
    id: 'c2',
    name: 'Beta Software SAS',
    website: null,
    country_code: 'MX',
    duplicate_status: 'possible_duplicate',
  }),
  candidate({
    id: 'c3',
    name: 'Gamma Retail Ltda',
    website: null,
    country_code: null,
    duplicate_status: 'exact_duplicate' as ProspectCandidateWithReviewer['duplicate_status'],
  }),
  candidate({
    id: 'c4',
    name: 'Delta Importada SA',
    website: null,
    source_primary: 'external_import' as ProspectCandidateWithReviewer['source_primary'],
    created_at: new Date(NOW - DAY).toISOString(),
    fit_score: 78,
    commercial_fit_status: 'high_fit',
  }),
];

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ProspectsDataTableClient } = await import('../prospects-data-table-client'));
});

beforeEach(() => {
  pushed.length = 0;
  openedDetailFor = null;
  window.localStorage.clear();
});
afterEach(() => cleanup());

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((row) => row.querySelector('button[title]')?.textContent ?? '')
    .filter(Boolean);
}

function indicators(): HTMLElement {
  return screen.getByRole('group', { name: 'Indicadores de prospectos' });
}

describe('Por revisar — los indicadores son filtros de un toque', () => {
  it('muestra los tres indicadores con el recuento de las filas cargadas', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    const group = within(indicators());
    assert.match(group.getByRole('button', { name: /Sin bloqueos detectados/ }).textContent ?? '', /3/);
    assert.match(group.getByRole('button', { name: /Posibles duplicados/ }).textContent ?? '', /1/);
    assert.match(group.getByRole('button', { name: /Importados esta semana/ }).textContent ?? '', /1/);
  });

  it('pulsar «Posibles duplicados» deja solo esas filas y lo marca como pulsado', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);
    assert.equal(rowNames().length, 4);

    fireEvent.click(within(indicators()).getByRole('button', { name: /Posibles duplicados/ }));

    assert.deepEqual(rowNames(), ['Beta Software SAS']);
    assert.equal(
      within(indicators()).getByRole('button', { name: /Posibles duplicados/ }).getAttribute('aria-pressed'),
      'true',
    );
    assert.ok(screen.getByText('Por revisar · Posibles duplicados'), 'el título de la tabla dice qué se ve');
  });

  it('volver a pulsarlo devuelve la lista completa', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);
    const button = () => within(indicators()).getByRole('button', { name: /Posibles duplicados/ });

    fireEvent.click(button());
    fireEvent.click(button());

    assert.equal(rowNames().length, 4);
    assert.equal(button().getAttribute('aria-pressed'), 'false');
    assert.ok(screen.getByText('Prospectos por revisar'));
  });

  it('«Sin bloqueos detectados» deja fuera el duplicado exacto', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    fireEvent.click(within(indicators()).getByRole('button', { name: /Sin bloqueos detectados/ }));

    assert.deepEqual(rowNames(), ['Acme Analytics SA', 'Beta Software SAS', 'Delta Importada SA']);
  });

  it('cambiar de indicador suelta lo que estaba marcado', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    assert.equal(document.querySelectorAll('tbody tr[data-state="selected"]').length, 1);

    fireEvent.click(within(indicators()).getByRole('button', { name: /Importados esta semana/ }));

    assert.equal(document.querySelectorAll('tbody tr[data-state="selected"]').length, 0);
  });

  it('en la vista de una operación (sourceId) no hay indicadores', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} sourceId="batch-1" />);

    assert.equal(screen.queryByRole('group', { name: 'Indicadores de prospectos' }), null);
    assert.equal(rowNames().length, 4);
  });

  it('nunca promete que algo está «listo para aprobar»', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    assert.equal(screen.queryByText(/Listos? para aprobar/i), null);
  });
});

describe('Por revisar — cada vacío dice por qué y qué hacer', () => {
  it('sin prospectos ofrece las acciones que le pasa el panel', () => {
    render(
      <ProspectsDataTableClient
        candidates={[]}
        emptyActions={<button type="button">Generar con IA</button>}
      />,
    );

    assert.ok(screen.getByText('No hay prospectos por revisar'));
    assert.ok(screen.getByRole('button', { name: 'Generar con IA' }));
    assert.equal(screen.queryByRole('group', { name: 'Indicadores de prospectos' }), null);
  });

  it('vacío por los filtros del enlace: lo dice y ofrece limpiarlos', () => {
    render(<ProspectsDataTableClient candidates={[]} hasUrlFilters />);

    assert.ok(screen.getByText('Ningún prospecto con estos filtros'));
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    assert.deepEqual(pushed, ['/accounts?tab=prospectos']);
  });

  it('una operación sin prospectos nuevos lo explica y lleva a todos', () => {
    render(<ProspectsDataTableClient candidates={[]} sourceId="batch-1" />);

    assert.ok(screen.getByText('Esta operación no dejó prospectos nuevos'));
    assert.ok(screen.getAllByRole('button', { name: /Ver todos los prospectos/ }).length >= 1);
  });

  it('un indicador sin filas ofrece quitarlo', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES.slice(0, 1)} />);

    fireEvent.click(within(indicators()).getByRole('button', { name: /Posibles duplicados/ }));
    assert.ok(screen.getByText('Nada en «Posibles duplicados»'));

    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro' }));
    assert.deepEqual(rowNames(), ['Acme Analytics SA']);
  });
});

describe('Por revisar — celdas de una línea, con la misma voz que el resto', () => {
  it('el país lleva nombre completo y el que falta es una raya', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    assert.ok(screen.getAllByText('Colombia').length >= 1);
    assert.ok(screen.getByText('México'));
    assert.ok(screen.getByText('Sin país'), 'el vacío se nombra para el lector de pantalla');
  });

  it('los vacíos no usan textos distintos por columna', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    const body = document.querySelector('tbody');
    assert.ok(body);
    for (const legacy of ['Sin evaluación IA', 'Sin verificar']) {
      const visible: Element[] = Array.from(body.querySelectorAll('*')).filter(
        (node: Element) =>
          node.children.length === 0 &&
          node.textContent === legacy &&
          !(node.getAttribute('class') ?? '').includes('sr-only'),
      );
      assert.equal(visible.length, 0, `«${legacy}» no debe verse como dato de una celda`);
    }
  });

  it('el sitio web es un enlace externo con nombre, y no abre el detalle', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    const link = screen.getByRole('link', { name: /Abrir el sitio web de Acme Analytics SA \(acme\.com\)/ });
    assert.equal(link.getAttribute('href'), 'https://acme.com');
    assert.equal(link.getAttribute('target'), '_blank');
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    assert.equal(openedDetailFor, null);
  });

  it('el nombre abre el detalle', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    fireEvent.click(screen.getByRole('button', { name: 'Acme Analytics SA' }));
    assert.equal(openedDetailFor, 'Acme Analytics SA');
  });

  it('el estado es un chip y la puntuación de IA va a su lado', () => {
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    const row = screen.getByRole('button', { name: 'Delta Importada SA' }).closest('tr');
    assert.ok(row);
    const chip = within(row).getByText('Necesita revisión');
    assert.equal(chip.getAttribute('data-slot'), 'badge');
    assert.ok(within(row).getByText('78'));
  });
});

describe('Por revisar — vista «Lista»', () => {
  it('pinta cada prospecto como una fila de lista con su estado y sus acciones', () => {
    window.localStorage.setItem('sellup:table:prospects', JSON.stringify({ view: 'list' }));
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    assert.equal(document.querySelector('table'), null, 'en lista no hay rejilla');
    const items = screen.getAllByRole('listitem');
    assert.equal(items.length, 4);

    const first = within(items[0]);
    assert.ok(first.getByRole('button', { name: 'Acme Analytics SA' }));
    assert.ok(first.getByText(/Bogotá, Colombia · Tecnología · acme\.com/));
    assert.ok(first.getByText('Necesita revisión'));
    assert.ok(first.getByRole('button', { name: 'Acciones para Acme Analytics SA' }));
    assert.ok(first.getByRole('checkbox', { name: 'Seleccionar Acme Analytics SA' }));
  });

  it('el nombre también abre el detalle desde la lista', () => {
    window.localStorage.setItem('sellup:table:prospects', JSON.stringify({ view: 'list' }));
    render(<ProspectsDataTableClient candidates={CANDIDATES} />);

    fireEvent.click(screen.getByRole('button', { name: 'Beta Software SAS' }));
    assert.equal(openedDetailFor, 'Beta Software SAS');
  });
});
