/**
 * CandidateDetailSummary / describePendingEvaluation — contrato RUNTIME.
 *
 * El resumen que abre el detalle de un prospecto no enseña tarjetas con rayas:
 * sin evaluación dice en qué estado está y qué falta para evaluarlo.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
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

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let CandidateDetailSummary: (typeof import('../candidate-detail-summary'))['CandidateDetailSummary'];
let describePendingEvaluation: (typeof import('../candidate-detail-summary'))['describePendingEvaluation'];

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ CandidateDetailSummary, describePendingEvaluation } = await import('../candidate-detail-summary'));
});

afterEach(() => {
  cleanup();
});

const COMPLETE = {
  hasTaxIdConflict: false,
  hasOfficialWebsite: true,
  hasLinkedin: true,
  hasSector: true,
  hasSize: true,
};

const PENDING = { reason: 'Faltan datos públicos para que la IA pueda evaluar el encaje.', missing: ['Sitio web oficial', 'Tamaño'] };

describe('describePendingEvaluation', () => {
  it('lista solo los datos que faltan', () => {
    const result = describePendingEvaluation({ ...COMPLETE, hasOfficialWebsite: false, hasSize: false });

    assert.deepEqual(result.missing, ['Sitio web oficial', 'Tamaño']);
    assert.match(result.reason, /Faltan datos públicos/);
  });

  it('con todo presente dice que aún no pasó por la evaluación', () => {
    const result = describePendingEvaluation(COMPLETE);

    assert.deepEqual(result.missing, []);
    assert.match(result.reason, /todavía no ha pasado por la evaluación/);
  });

  it('el enriquecimiento en curso manda sobre lo que falta', () => {
    for (const enrichmentStatus of ['enriching', 'processing']) {
      assert.match(
        describePendingEvaluation({ ...COMPLETE, hasLinkedin: false, enrichmentStatus }).reason,
        /Estamos completando la información/,
      );
    }
    assert.match(describePendingEvaluation({ ...COMPLETE, enrichmentStatus: 'pending' }).reason, /en cola/);
  });

  it('un enriquecimiento fallido lo dice', () => {
    assert.match(describePendingEvaluation({ ...COMPLETE, enrichmentStatus: 'failed' }).reason, /No se pudo completar/);
  });

  it('el conflicto de identificador fiscal pausa la evaluación', () => {
    assert.match(describePendingEvaluation({ ...COMPLETE, hasTaxIdConflict: true }).reason, /en pausa/);
    assert.match(
      describePendingEvaluation({ ...COMPLETE, fitStatus: 'tax_identifier_conflict' }).reason,
      /en pausa/,
    );
  });

  it('la evidencia insuficiente lo dice', () => {
    assert.match(
      describePendingEvaluation({ ...COMPLETE, fitStatus: 'insufficient_evidence' }).reason,
      /evidencia pública confiable/,
    );
  });
});

describe('CandidateDetailSummary — sin evaluación', () => {
  it('no pinta tarjetas con rayas: dice por qué no hay evaluación y qué falta', () => {
    const { container } = render(
      h(CandidateDetailSummary, { fitScore: null, completeness: null, pendingEvaluation: PENDING }),
    );

    assert.ok(screen.getByText('Sin evaluación de IA todavía'));
    assert.ok(screen.getByText(PENDING.reason));
    assert.ok(screen.getByText('Falta para evaluar'));
    assert.ok(screen.getByText('Sitio web oficial'));
    assert.ok(screen.getByText('Tamaño'));
    assert.equal(container.textContent?.includes('—'), false, 'ni una raya');
    assert.equal(screen.queryByText('Encaje'), null);
    assert.equal(screen.queryByText('Completitud'), null);
  });

  it('si no falta ningún dato, orienta en vez de dejar el bloque vacío', () => {
    render(
      h(CandidateDetailSummary, {
        fitScore: null,
        completeness: null,
        pendingEvaluation: { reason: 'Aún sin evaluar.', missing: [] },
      }),
    );

    assert.ok(screen.getByText(/puedes revisar los datos oficiales y la validación/));
    assert.equal(screen.queryByText('Falta para evaluar'), null);
  });
});

describe('CandidateDetailSummary — con evaluación', () => {
  it('pinta encaje y completitud', () => {
    render(h(CandidateDetailSummary, { fitScore: 78, completeness: 60, pendingEvaluation: PENDING }));

    assert.ok(screen.getByText('Encaje'));
    assert.ok(screen.getByText('78'));
    assert.ok(screen.getByText('/ 100'));
    assert.ok(screen.getByText('Completitud'));
    assert.ok(screen.getByText('60'));
    assert.equal(screen.queryByText('Sin evaluación de IA todavía'), null);
  });

  it('solo pinta la tarjeta del dato que existe', () => {
    const { container } = render(
      h(CandidateDetailSummary, { fitScore: null, completeness: 40, pendingEvaluation: PENDING }),
    );

    assert.equal(screen.queryByText('Encaje'), null);
    assert.ok(screen.getByText('Completitud'));
    assert.equal(container.textContent?.includes('—'), false);
  });

  it('el estado no se repite aquí: va en la cabecera del panel', () => {
    render(h(CandidateDetailSummary, { fitScore: 78, completeness: 60, pendingEvaluation: PENDING }));

    assert.equal(screen.queryByText('Estado'), null);
  });
});
