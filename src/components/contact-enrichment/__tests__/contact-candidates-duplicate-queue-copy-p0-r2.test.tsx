/**
 * Tests — la tabla de candidatos se ANUNCIA como la cola que está mostrando
 * (AGENT2A-P0-R2 · incidente D, duplicates tab).
 *
 * Incidente de QA (2026-08-13): con la pill «Duplicados» seleccionada, la tabla
 * seguía titulándose «Candidatos por revisar» y su estado vacío seguía diciendo
 * «No hay candidatos por revisar.». La pantalla se contradecía a sí misma.
 *
 * La consulta NUNCA fue el problema: los `edge_logs` de Producción del momento
 * exacto de la QA muestran `contact_enrichment_candidates?status=eq.duplicate`
 * devolviendo 200. El panel también distinguía la cola (tarjeta «Duplicados» y
 * pill activa). Lo que no la distinguía era la TABLA: título, descripción y
 * estado vacío estaban hardcodeados dentro de `ContactCandidatesDataTableClient`,
 * que no recibía la cola.
 *
 * Casos cubiertos (§ 13.A del brief):
 *   A. cola `duplicates` ⇒ título «Duplicados»
 *   B. cola `duplicates` vacía ⇒ estado vacío de duplicados, NO el de pendientes
 *   C. cola `duplicates` NO ofrece el CTA de enriquecer (no se arregla gastando)
 *   D. cola `pending` conserva EXACTAMENTE su copy histórico (sin regresión)
 *   E. el ruteo `?tab=duplicates` y los filtros de estado siguen separados
 *
 * Antes del fix, A, B y C fallan.
 *
 * 0 servidor, 0 DB, 0 proveedor, 0 créditos. Datos 100 % ficticios.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

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

// ── Imports dependientes del entorno DOM ─────────────────────────────────────

import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_CANDIDATES_QUEUE_COPY } from '../contact-candidates-queue-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

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

let ContactCandidatesDataTableClient: (typeof import('../contact-candidates-data-table-client'))['ContactCandidatesDataTableClient'];

const PENDING = CONTACT_CANDIDATES_QUEUE_COPY.pending;
const DUPLICATES = CONTACT_CANDIDATES_QUEUE_COPY.duplicates;

function renderQueue(queue: 'pending' | 'duplicates'): void {
  render(
    React.createElement(ContactCandidatesDataTableClient, {
      candidates: [],
      queue,
    }),
  );
}

function textPresent(text: string): boolean {
  // Escapa el texto: el copy lleva puntos y paréntesis.
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return screen.queryAllByText(new RegExp(escaped, 'i')).length > 0;
}

describe('AGENT2A-P0-R2 — la tabla se anuncia como la cola que muestra', () => {
  before(async () => {
    const rtl = await import('@testing-library/react');
    render = rtl.render;
    screen = rtl.screen;
    cleanup = rtl.cleanup;
    ContactCandidatesDataTableClient = (
      await import('../contact-candidates-data-table-client')
    ).ContactCandidatesDataTableClient;
  });

  afterEach(() => {
    cleanup();
  });

  it('A. cola `duplicates` ⇒ la tabla se titula «Duplicados»', () => {
    renderQueue('duplicates');

    assert.equal(DUPLICATES.title, 'Duplicados');
    assert.ok(textPresent(DUPLICATES.title), 'debe mostrar el título de duplicados');
    assert.equal(
      textPresent(PENDING.title),
      false,
      'la tabla NO puede seguir diciendo «Candidatos por revisar» bajo la pill Duplicados',
    );
  });

  it('B. cola `duplicates` vacía ⇒ estado vacío de duplicados, no el de pendientes', () => {
    renderQueue('duplicates');

    assert.ok(textPresent(DUPLICATES.emptyTitle), 'estado vacío propio de duplicados');
    assert.equal(
      textPresent(PENDING.emptyTitle),
      false,
      'no puede decir «No hay candidatos por revisar.» en la cola de duplicados',
    );
  });

  it('C. la cola `duplicates` no ofrece el CTA de enriquecer', () => {
    // Un duplicado no se resuelve buscando más contactos: ofrecer el CTA ahí
    // invita a gastar créditos para algo que el gasto no arregla.
    assert.equal(DUPLICATES.showEnrichmentCta, false);
    assert.equal(PENDING.showEnrichmentCta, true);
  });

  it('D. la cola `pending` conserva su copy histórico exacto', () => {
    // Sin regresión: el hito arregla duplicados, no reescribe la cola histórica.
    assert.equal(PENDING.title, 'Candidatos por revisar');
    assert.equal(
      PENDING.description,
      'Perfiles encontrados por el Agente de contactos que pasaron el filtro de relevancia y esperan revisión humana.',
    );
    assert.equal(PENDING.emptyTitle, 'No hay candidatos por revisar.');

    renderQueue('pending');
    assert.ok(textPresent(PENDING.title));
    assert.equal(textPresent(DUPLICATES.emptyTitle), false);
  });

  it('E. el ruteo y los filtros de estado de las dos colas siguen separados', () => {
    const root = join(process.cwd(), 'src');

    const page = readFileSync(join(root, 'app/(sellup)/contacts/page.tsx'), 'utf8');
    assert.match(
      page,
      /tab === 'duplicates'[\s\S]{0,200}queue="duplicates"/,
      '?tab=duplicates debe enrutar a la cola de duplicados',
    );
    assert.match(
      page,
      /tab === 'candidates'[\s\S]{0,200}queue="pending"/,
      '?tab=candidates debe enrutar a la cola de pendientes',
    );

    const actions = readFileSync(join(root, 'modules/contact-enrichment/actions.ts'), 'utf8');
    // La cola de duplicados lee `duplicate`; la de pendientes lee `pending_review`.
    // Nunca se reutiliza el resultado de una para la otra.
    assert.match(
      actions,
      /getDuplicateContactCandidates[\s\S]{0,600}\.eq\('status',\s*'duplicate'\)/,
    );
    assert.match(
      actions,
      /getPendingContactCandidates\([\s\S]{0,600}\.eq\('status',\s*'pending_review'\)/,
    );
  });
});
