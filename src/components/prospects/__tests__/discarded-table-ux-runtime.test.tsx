/**
 * UX-EMPRESAS-CONTACTOS — la tabla «Descartadas»
 * (DiscardedProspectsDataTableClient) como se usa: indicadores que filtran,
 * vacíos que dicen por qué, celdas con la misma voz que el resto y vista
 * «Lista» que conserva «Enviar a revisión».
 *
 * La acción de servidor es un doble: nada se envía de verdad.
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
import type { DiscardedProspectItem } from '@/modules/prospect-discards/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];

const pushed: string[] = [];
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: (href: string) => pushed.push(href), replace: () => {} }),
  },
});
mock.module('sonner', {
  namedExports: { toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} } },
});

const sentToReview: string[] = [];
mock.module('@/modules/prospect-discards/send-to-review-actions', {
  namedExports: {
    sendDiscardedProspectToReviewAction: async (itemId: string) => {
      sentToReview.push(itemId);
      return { ok: true, status: 'success' };
    },
  },
});
mock.module('@/components/prospects/discarded-prospect-detail-sheet', {
  namedExports: { DiscardedProspectDetailSheet: () => null },
});
mock.module('@/components/shared/scope-filters-client', {
  namedExports: { TeamFilterUrlButton: () => null },
});

let DiscardedProspectsDataTableClient: (typeof import('../discarded-prospects-data-table-client'))['DiscardedProspectsDataTableClient'];

function item(overrides: Partial<DiscardedProspectItem>): DiscardedProspectItem {
  return {
    itemId: 'disposition:1',
    itemSource: 'disposition',
    sourceId: '1',
    batchId: 'b1',
    batchName: 'Lote de prueba',
    candidateId: null,
    name: 'Acme',
    domain: 'acme.co',
    countryCode: 'CO',
    industry: 'Tecnología',
    sourcePrimary: 'apollo',
    roundOrigin: null,
    disposition: 'manual_discard',
    reasonCode: null,
    reasonDetail: null,
    evidence: {},
    status: 'discarded',
    resultingCandidateId: null,
    createdAt: '2026-01-10T15:00:00.000Z',
    updatedAt: '2026-01-10T15:00:00.000Z',
    ...overrides,
  } as DiscardedProspectItem;
}

let ITEMS: DiscardedProspectItem[] = [];

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ DiscardedProspectsDataTableClient } = await import('../discarded-prospects-data-table-client'));
  const { DISCARD_DISPOSITION_LABELS } = await import('@/modules/prospect-discards/types');
  const pipelineDisposition = (Object.keys(DISCARD_DISPOSITION_LABELS) as DiscardedProspectItem['disposition'][]).find(
    (code) => code !== 'manual_discard',
  );
  assert.ok(pipelineDisposition, 'debe existir al menos un motivo de descarte del pipeline');
  ITEMS = [
    item({ itemId: 'disposition:1', name: 'Acme', disposition: 'manual_discard' }),
    item({
      itemId: 'disposition:2',
      name: 'Beta',
      disposition: pipelineDisposition,
      domain: null,
      countryCode: 'MX',
      createdAt: new Date().toISOString(),
    }),
    item({
      itemId: 'disposition:3',
      name: 'Gamma',
      disposition: pipelineDisposition,
      countryCode: null,
      industry: null,
      sendToReviewBlockedReason: 'Otro vendedor ya tiene esta empresa.',
    }),
  ];
});

beforeEach(() => {
  pushed.length = 0;
  sentToReview.length = 0;
  window.localStorage.clear();
});
afterEach(() => cleanup());

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((row) => row.querySelector('button[title]')?.textContent ?? '')
    .filter(Boolean);
}

function indicators(): HTMLElement {
  return screen.getByRole('group', { name: 'Indicadores de empresas descartadas' });
}

describe('Descartadas — los indicadores son filtros de un toque', () => {
  it('nuevas hoy, del pipeline y manuales, con su recuento', () => {
    render(<DiscardedProspectsDataTableClient items={ITEMS} />);

    const group = within(indicators());
    assert.match(group.getByRole('button', { name: /Nuevas hoy/ }).textContent ?? '', /1/);
    assert.match(group.getByRole('button', { name: /Descartadas por el pipeline/ }).textContent ?? '', /2/);
    assert.match(group.getByRole('button', { name: /Descartes manuales/ }).textContent ?? '', /1/);
  });

  it('pulsar «Descartes manuales» deja solo esas; otra vez, todas', () => {
    render(<DiscardedProspectsDataTableClient items={ITEMS} />);
    const button = () => within(indicators()).getByRole('button', { name: /Descartes manuales/ });

    fireEvent.click(button());
    assert.deepEqual(rowNames(), ['Acme']);
    assert.equal(button().getAttribute('aria-pressed'), 'true');
    assert.ok(screen.getByText('Descartadas · Descartes manuales'));

    fireEvent.click(button());
    assert.equal(rowNames().length, 3);
  });
});

describe('Descartadas — vacíos', () => {
  it('sin descartadas lo dice sin ofrecer nada que no toque', () => {
    render(<DiscardedProspectsDataTableClient items={[]} />);

    assert.ok(screen.getByText('No hay empresas descartadas'));
    assert.equal(screen.queryByRole('group', { name: 'Indicadores de empresas descartadas' }), null);
  });

  it('vacío por los filtros del enlace: ofrece limpiarlos', () => {
    render(<DiscardedProspectsDataTableClient items={[]} hasUrlFilters />);

    assert.ok(screen.getByText('Ninguna descartada con estos filtros'));
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    assert.deepEqual(pushed, ['/accounts?tab=prospectos&view=descartadas']);
  });
});

describe('Descartadas — celdas', () => {
  it('el país lleva nombre completo (antes, el código) y lo que falta es una raya', () => {
    render(<DiscardedProspectsDataTableClient items={ITEMS} />);

    assert.ok(screen.getAllByText('Colombia').length >= 1);
    assert.ok(screen.getByText('México'));
    assert.ok(screen.getByText('Sin país'));
    assert.ok(screen.getByText('Sin industria'));
    assert.ok(screen.getByText('Sin dominio'));
  });

  it('sin columna «Estado»: en la lista todas son descartadas y el motivo va en texto', () => {
    render(<DiscardedProspectsDataTableClient items={ITEMS} />);

    assert.equal(screen.queryByRole('columnheader', { name: /Estado/ }), null);
    const row = screen.getByRole('button', { name: 'Acme' }).closest('tr');
    assert.ok(row);
    assert.equal(within(row).queryByText('Descartada'), null);
    assert.equal(row.querySelectorAll('[data-slot="badge"]').length, 0);
  });

  it('una fila bloqueada no se puede enviar a revisión y el botón dice por qué', () => {
    render(<DiscardedProspectsDataTableClient items={ITEMS} />);

    const row = screen.getByRole('button', { name: 'Gamma' }).closest('tr');
    assert.ok(row);
    const send = within(row).getByRole('button', { name: /Enviar a revisión/ }) as HTMLButtonElement;
    assert.equal(send.disabled, true);
    assert.equal(send.getAttribute('title'), 'Otro vendedor ya tiene esta empresa.');
  });
});

describe('Descartadas — vista «Lista»', () => {
  it('conserva «Enviar a revisión» por fila, con los mismos bloqueos', async () => {
    window.localStorage.setItem('sellup:table:prospects-discarded', JSON.stringify({ view: 'list' }));
    render(<DiscardedProspectsDataTableClient items={ITEMS} />);

    assert.equal(document.querySelector('table'), null);
    const items = screen.getAllByRole('listitem');
    assert.equal(items.length, 3);

    const blocked = within(items[2]).getByRole('button', { name: /Enviar a revisión/ }) as HTMLButtonElement;
    assert.equal(blocked.disabled, true);

    fireEvent.click(within(items[0]).getByRole('button', { name: /Enviar a revisión/ }));
    await waitFor(() => assert.deepEqual(sentToReview, ['disposition:1']));
  });
});
