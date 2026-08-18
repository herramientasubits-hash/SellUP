/**
 * lusha-budget-gate-runtime.test.tsx — RENDER REAL de la protección económica en
 * la pantalla de Lusha.
 *
 * AGENT1-LUSHA-BUDGET-GATE-1 § 6/§ 13.
 *
 * El estado que ninguna suite cubría: la pantalla final de Lusha ofrecía «Buscar
 * con IA» habilitado con CUALQUIER presupuesto —incluido el real de agosto,
 * 289/289/0 ⇒ 0 disponibles— porque esa ruta nunca miró el período. Apollo ya
 * retiraba su botón en ese estado desde
 * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1; Lusha no.
 *
 * Estas pruebas fallan contra ese comportamiento y pasan con la puerta puesta.
 *
 * Sin red, sin proveedor, sin base, sin créditos.
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
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { WizardBudgetPreflight } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import type { WizardLushaInput } from '@/modules/prospect-batches/wizard-lusha-criteria';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// La server action REAL nunca se importa: si el render la alcanzara, este mock
// hace evidente que se alcanzó (y sigue sin tocar a Lusha).
mock.module('@/modules/prospect-batches/lusha-pending-review-actions', {
  namedExports: {
    generateLushaPendingReviewBatchAction: async () => {
      throw new Error('la server action real no debe invocarse en esta suite');
    },
  },
});

let WizardLushaFinalSearch: (typeof import('../wizard-lusha-final-search'))['WizardLushaFinalSearch'];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INPUT: WizardLushaInput = {
  countryCode: 'CO',
  sectorKey: 'salud',
  searchText: null,
} as unknown as WizardLushaInput;

/** El presupuesto REAL de Producción en agosto: 289/289/0 ⇒ 0 disponibles. */
const EXHAUSTED: WizardBudgetPreflight = {
  availableCredits: 0,
  requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
  lushaRequiredCredits: 2,
};

/** Saldo positivo pero por debajo del techo de Lusha. */
const INSUFFICIENT: WizardBudgetPreflight = {
  availableCredits: 1,
  requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
  lushaRequiredCredits: 2,
};

/**
 * Presupuesto que NO alcanza para Apollo (25) pero SÍ para Lusha (2).
 *
 * Es el caso que distingue «se reutiliza el presupuesto global» de «se copió el
 * número de Apollo»: con 5 disponibles, Lusha debe poder ejecutarse.
 */
const ENOUGH_FOR_LUSHA_ONLY: WizardBudgetPreflight = {
  availableCredits: 5,
  requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
  lushaRequiredCredits: 2,
};

type RenderOptions = {
  budgetPreflight?: WizardBudgetPreflight | null;
  runPersist?: (input: WizardLushaInput & { clientRequestId: string }) => Promise<never>;
};

let calls: Array<WizardLushaInput & { clientRequestId: string }>;

function renderPanel(options: RenderOptions = {}) {
  const runPersist =
    options.runPersist ??
    (async (input: WizardLushaInput & { clientRequestId: string }) => {
      calls.push(input);
      // Nunca resuelve a un resultado real: esta suite sólo mide si se LLAMÓ.
      return undefined as never;
    });
  return render(
    <WizardLushaFinalSearch
      input={INPUT}
      budgetPreflight={options.budgetPreflight ?? null}
      runPersist={runPersist as never}
      newClientRequestId={() => '11111111-2222-4333-8444-555555555555'}
    />,
  );
}

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  cleanup = rtl.cleanup;
  ({ WizardLushaFinalSearch } = await import('../wizard-lusha-final-search'));
});

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('§6 — presupuesto agotado retira la oferta ANTES del primer clic', () => {
  it('con 0 disponibles el botón «Buscar con IA» está deshabilitado', () => {
    renderPanel({ budgetPreflight: EXHAUSTED });
    const button = screen.getByTestId('lusha-preview-run') as HTMLButtonElement;
    assert.equal(button.disabled, true);
  });

  it('un clic con presupuesto agotado NO llama a la ruta de persistencia', () => {
    renderPanel({ budgetPreflight: EXHAUSTED });
    const button = screen.getByTestId('lusha-preview-run');
    button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(calls.length, 0);
  });

  it('el aviso explica que se AGOTÓ y con qué cifras', () => {
    renderPanel({ budgetPreflight: EXHAUSTED });
    const notice = screen.getByTestId('lusha-budget-preflight-notice');
    assert.match(notice.textContent ?? '', /agot/i);
    assert.match(notice.textContent ?? '', /Disponibles: 0 créditos/);
    assert.match(notice.textContent ?? '', /Requeridos: 2 créditos/);
  });

  it('el aviso es `role="alert"`: aparece sin que la usuaria haya actuado', () => {
    renderPanel({ budgetPreflight: EXHAUSTED });
    assert.equal(
      screen.getByTestId('lusha-budget-preflight-notice').getAttribute('role'),
      'alert',
    );
  });
});

describe('§6 — saldo positivo insuficiente NO se confunde con agotado', () => {
  it('con 1 disponible y 2 requeridos dice «no alcanza para esta corrida»', () => {
    renderPanel({ budgetPreflight: INSUFFICIENT });
    const notice = screen.getByTestId('lusha-budget-preflight-notice');
    assert.match(notice.textContent ?? '', /no alcanza para esta corrida/i);
    assert.equal(/se agotó/i.test(notice.textContent ?? ''), false);
  });

  it('el botón sigue deshabilitado', () => {
    renderPanel({ budgetPreflight: INSUFFICIENT });
    assert.equal((screen.getByTestId('lusha-preview-run') as HTMLButtonElement).disabled, true);
  });
});

describe('§3/§4 — se reutiliza el presupuesto global, no el número de Apollo', () => {
  it('con 5 disponibles Lusha SÍ puede ejecutarse (a Apollo no le alcanzaría)', () => {
    renderPanel({ budgetPreflight: ENOUGH_FOR_LUSHA_ONLY });
    assert.equal((screen.getByTestId('lusha-preview-run') as HTMLButtonElement).disabled, false);
    assert.equal(screen.queryByTestId('lusha-budget-preflight-notice'), null);
  });

  it('el clic con presupuesto suficiente sí ejecuta, y lleva un clientRequestId', () => {
    renderPanel({ budgetPreflight: ENOUGH_FOR_LUSHA_ONLY });
    screen
      .getByTestId('lusha-preview-run')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.clientRequestId, '11111111-2222-4333-8444-555555555555');
    assert.equal(calls[0]?.countryCode, 'CO');
  });

  it('muestra las dos cifras del período global', () => {
    renderPanel({ budgetPreflight: ENOUGH_FOR_LUSHA_ONLY });
    assert.equal(screen.getByTestId('lusha-budget-available').textContent, '5');
    assert.equal(screen.getByTestId('lusha-budget-required').textContent, '2');
  });
});

describe('§6 — sin instantánea la pantalla queda como estaba', () => {
  it('preflight null → sin aviso, sin cifras y con el botón habilitado', () => {
    renderPanel({ budgetPreflight: null });
    assert.equal(screen.queryByTestId('lusha-budget-preflight-notice'), null);
    assert.equal(screen.queryByTestId('lusha-budget-preflight'), null);
    assert.equal((screen.getByTestId('lusha-preview-run') as HTMLButtonElement).disabled, false);
  });

  it('un fallo de lectura no puede bloquear: el clic sigue llegando al servidor', () => {
    renderPanel({ budgetPreflight: null });
    screen
      .getByTestId('lusha-preview-run')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(calls.length, 1);
  });

  it('techo de Lusha no resoluble → no bloquea y no enseña media instantánea', () => {
    renderPanel({
      budgetPreflight: {
        availableCredits: 0,
        requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
        lushaRequiredCredits: null,
      },
    });
    assert.equal(screen.queryByTestId('lusha-budget-preflight-notice'), null);
    assert.equal(screen.queryByTestId('lusha-budget-preflight'), null);
    assert.equal((screen.getByTestId('lusha-preview-run') as HTMLButtonElement).disabled, false);
  });
});

describe('§ safety — la pantalla sigue sin prometer un costo fijo', () => {
  it('el aviso de costo no contractual sigue presente', () => {
    renderPanel({ budgetPreflight: ENOUGH_FOR_LUSHA_ONLY });
    const notice = screen.getByTestId('lusha-preview-cost-notice');
    assert.match(notice.textContent ?? '', /costo real se muestra al finalizar/i);
  });

  it('no hay auto-run: sin clic no se llama a nada', () => {
    renderPanel({ budgetPreflight: ENOUGH_FOR_LUSHA_ONLY });
    assert.equal(calls.length, 0);
  });
});
