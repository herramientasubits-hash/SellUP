/**
 * wizard-no-new-candidates-breakdown-runtime.test.tsx — el desglose de «cero
 * empresas nuevas», RENDER REAL.
 *
 * AGENT1-APOLLO-SCALE-SECOND-ROUND-FIX-1B · § 3.
 *
 * Hasta este hito el panel mostraba SÓLO un texto de causa: el helper del desglose
 * existía y nadie lo pintaba, así que la corrida live `eae6d47f` se le presentó a la
 * usuaria como «ya sugeridos recientemente» sin una sola cifra que la contradijera.
 * Estas pruebas renderizan el `SuccessPanel` REAL y verifican lo que se ve:
 *
 *   · las empresas ÚNICAS, no los resultados crudos;
 *   · una fila por causa REAL, y ninguna fila para una causa que no ocurrió;
 *   · las repeticiones entre rondas etiquetadas como repeticiones, con su aclaración
 *     de que NO son empresas nuevas;
 *   · el copy específico por causa, que sigue siendo el que manda arriba del todo.
 *
 * `next/navigation` y `sonner` están mockeados: el panel no navega ni emite toasts
 * reales. Cero llamadas a proveedores, cero escrituras.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
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
for (const prop of Object.getOwnPropertyNames(dom.window)) {
  const target = globalThis as unknown as Record<string, unknown>;
  if (prop in target) continue;
  const descriptor = Object.getOwnPropertyDescriptor(
    dom.window as unknown as Record<string, unknown>,
    prop,
  );
  if (descriptor) Object.defineProperty(target, prop, descriptor);
}

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import { mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_NEW_CANDIDATES_BREAKDOWN_LABELS,
  REPEATED_ACROSS_ROUNDS_HINT,
  type NoNewCandidatesBreakdown,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-no-new-candidates-copy';

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
    redirect: () => {},
  },
});
mock.module('sonner', {
  namedExports: {
    toast: Object.assign(() => {}, {
      info: () => {},
      success: () => {},
      error: () => {},
    }),
  },
});

let render: (typeof import('@testing-library/react'))['render'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let SuccessPanel: (typeof import('../wizard-execution-panels'))['SuccessPanel'];

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  cleanup = rtl.cleanup;
  ({ SuccessPanel } = await import('../wizard-execution-panels'));
});

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  cleanup();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * La corrida live `eae6d47f`: 10 resultados crudos, 5 empresas ÚNICAS, 4 duplicadas
 * en HubSpot y 5 repeticiones de la ronda 2 sobre lo que la ronda 1 ya había traído.
 */
function liveRunBreakdown(
  overrides: Partial<NoNewCandidatesBreakdown> = {},
): NoNewCandidatesBreakdown {
  return {
    hubspotDuplicateCount: 4,
    sellupDuplicateCount: 0,
    cooldownCount: 0,
    repeatedAcrossRoundsCount: 5,
    qualityRejectedCount: 1,
    uniqueResultsCount: 5,
    noveltyExhausted: false,
    secondRoundSkippedReason: null,
    ...overrides,
  };
}

function renderNoNewCandidates(breakdown: NoNewCandidatesBreakdown | null) {
  return render(
    <SuccessPanel
      status="no_new_candidates"
      candidateCount={0}
      onClose={() => {}}
      onEditSearch={() => {}}
      twoRoundOutcome={{ roundsExecuted: 2, eligibleCompaniesFound: 0 }}
      targetEligibleCompanies={5}
      noNewCandidatesBreakdown={breakdown}
      persistenceOutcome={null}
    />,
  );
}

function rowCount(key: string): string | null {
  const node = document.querySelector(`[data-testid="wizard-no-new-candidates-count-${key}"]`);
  return node?.textContent ?? null;
}

function hasRow(key: string): boolean {
  return document.querySelector(`[data-testid="wizard-no-new-candidates-row-${key}"]`) !== null;
}

// ─── § 3 · el desglose se pinta ───────────────────────────────────────────────

describe('§ 3 · el desglose sustituye al mensaje genérico como única explicación', () => {
  it('el bloque de desglose está en el árbol', () => {
    renderNoNewCandidates(liveRunBreakdown());
    assert.ok(document.querySelector('[data-testid="wizard-no-new-candidates-breakdown"]'));
  });

  it('muestra las empresas ÚNICAS, no los resultados crudos', () => {
    renderNoNewCandidates(liveRunBreakdown());

    assert.equal(rowCount('uniqueResultsCount'), '5', 'cinco únicas, no diez resultados');
    const rendered = document.body.textContent ?? '';
    assert.ok(rendered.includes(NO_NEW_CANDIDATES_BREAKDOWN_LABELS.uniqueResultsCount));
    assert.ok(
      !rendered.includes('10 empresas'),
      'los resultados crudos no pueden presentarse como empresas',
    );
  });

  it('las repeticiones entre rondas se etiquetan como repeticiones y NO como empresas nuevas', () => {
    renderNoNewCandidates(liveRunBreakdown());

    assert.equal(rowCount('repeatedAcrossRoundsCount'), '5');
    const rendered = document.body.textContent ?? '';
    assert.ok(rendered.includes(NO_NEW_CANDIDATES_BREAKDOWN_LABELS.repeatedAcrossRoundsCount));
    assert.ok(rendered.includes(REPEATED_ACROSS_ROUNDS_HINT), 'la aclaración tiene que verse');
  });

  it('una causa que no ocurrió no aparece: cero filas fantasma', () => {
    renderNoNewCandidates(liveRunBreakdown());

    assert.ok(hasRow('hubspotDuplicateCount'), 'HubSpot sí ocurrió');
    assert.equal(hasRow('sellupDuplicateCount'), false, 'SellUp no ocurrió');
    assert.equal(hasRow('cooldownCount'), false, 'no hubo cooldown');
    const rendered = document.body.textContent ?? '';
    assert.ok(!rendered.includes(NO_NEW_CANDIDATES_BREAKDOWN_LABELS.cooldownCount));
  });

  it('los candidatos creados se muestran siempre, aunque sean cero', () => {
    renderNoNewCandidates(liveRunBreakdown());

    assert.ok(hasRow('candidatesCreatedCount'));
    assert.equal(rowCount('candidatesCreatedCount'), '0');
  });

  it('sin desglose del servidor no se pinta ninguna cifra inventada', () => {
    renderNoNewCandidates(null);

    assert.equal(
      document.querySelector('[data-testid="wizard-no-new-candidates-breakdown"]'),
      null,
    );
  });
});

// ─── § 3 · el copy por causa sigue siendo específico ──────────────────────────

describe('§ 3 · el copy específico por causa se conserva junto al desglose', () => {
  it('sólo duplicados de catálogo ⇒ el texto habla de SellUp/HubSpot, no de cooldown', () => {
    renderNoNewCandidates(
      liveRunBreakdown({ repeatedAcrossRoundsCount: 0, qualityRejectedCount: 0 }),
    );

    const rendered = document.body.textContent ?? '';
    assert.ok(rendered.includes('ya existen en SellUp o HubSpot'));
    assert.ok(
      !rendered.includes('ya habían sido sugeridas recientemente'),
      'un duplicado de catálogo NO es una sugerencia previa',
    );
  });

  it('sólo cooldown ⇒ el texto habla de sugerencias recientes', () => {
    renderNoNewCandidates(
      liveRunBreakdown({
        hubspotDuplicateCount: 0,
        qualityRejectedCount: 0,
        repeatedAcrossRoundsCount: 0,
        cooldownCount: 3,
      }),
    );

    const rendered = document.body.textContent ?? '';
    assert.ok(rendered.includes('ya habían sido sugeridas recientemente'));
    assert.equal(rowCount('cooldownCount'), '3');
  });

  it('una mezcla real de causas se declara como mezcla y remite al desglose', () => {
    renderNoNewCandidates(liveRunBreakdown({ cooldownCount: 2 }));

    const rendered = document.body.textContent ?? '';
    assert.ok(rendered.includes('Revisa el desglose'));
    // Y el desglose al que remite está de verdad ahí, con las tres causas.
    assert.ok(hasRow('hubspotDuplicateCount'));
    assert.ok(hasRow('cooldownCount'));
    assert.ok(hasRow('qualityRejectedCount'));
  });

  it('universo agotado ⇒ el texto pide cambiar criterios y el desglose acompaña', () => {
    renderNoNewCandidates(liveRunBreakdown({ noveltyExhausted: true }));

    const rendered = document.body.textContent ?? '';
    assert.ok(rendered.includes('ya fue explorado recientemente'));
    assert.ok(document.querySelector('[data-testid="wizard-no-new-candidates-breakdown"]'));
  });
});
