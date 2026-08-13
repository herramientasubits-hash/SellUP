/**
 * wizard-macro-v2-summary-budget-ux-runtime.test.tsx — RENDER REAL.
 *
 * AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1.
 *
 * Dos comprobaciones que sólo se pueden hacer montando de verdad:
 *
 *   1. Bajo el catálogo v2 (macro industria) el resumen NO debe preguntar por
 *      subindustria de ninguna forma — ni la fila, ni «Toda la industria», ni
 *      «Sin subindustrias seleccionadas» — porque la selección de subindustria
 *      no existe en ese catálogo. v1 legacy conserva el comportamiento exacto
 *      de siempre (regresión cubierta también por
 *      wizard-multi-subindustry-surface-runtime.test.tsx).
 *   2. Con un intento anterior que volvió con `BUDGET_EXCEEDED`, el botón
 *      «Generar prospectos» y el selector de proveedor dejan de ofrecerse — no
 *      basta con un aviso al lado de un botón que igual invita a gastar.
 *
 * Sin red, sin proveedor, sin créditos.
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
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type { ProspectWizardState, ProspectWizardAction } from '@/modules/prospect-batches/chat-wizard';
import type { WizardLushaCriteriaDecision } from '@/modules/prospect-batches/wizard-lusha-criteria';
import {
  MACRO_INDUSTRY_CATALOG_VERSION,
  LEGACY_INDUSTRY_CATALOG_VERSION,
} from '@/modules/macro-industry-catalog/macro-industries';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('@/modules/prospect-batches/lusha-preview-actions', {
  namedExports: { previewLushaCompaniesAction: async () => ({ ok: false }) },
});
mock.module('@/modules/prospect-batches/lusha-pending-review-actions', {
  namedExports: { generateLushaPendingReviewBatchAction: async () => ({ ok: false }) },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
    redirect: () => {},
  },
});

let WizardConversationSummary: (typeof import('../wizard-conversation-summary'))['WizardConversationSummary'];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INDUSTRY_ID = 'e9338391-f2d1-5c84-90da-49a5508e4d3f';
const SUB_ID = '912a4b36-8597-5204-bb8e-814fb0769505';

const CATALOG: ActiveIndustryCatalog = {
  version: MACRO_INDUSTRY_CATALOG_VERSION,
  industries: [{ id: INDUSTRY_ID, name: 'Salud y Farmacéuticos', slug: 'salud', description: null }],
  subindustries: [
    { id: SUB_ID, name: 'Alguna subindustria legacy', industryId: INDUSTRY_ID },
  ],
} as unknown as ActiveIndustryCatalog;

const NO_LUSHA: WizardLushaCriteriaDecision = {
  provider: 'default_ai',
  input: null,
} as unknown as WizardLushaCriteriaDecision;

function baseValidatedState(overrides: Partial<ProspectWizardState> = {}): ProspectWizardState {
  return {
    currentStep: 'validated',
    searchMode: 'exploratory',
    countryCode: 'CO',
    industryId: INDUSTRY_ID,
    subindustryIds: [],
    additionalCriteriaRaw: null,
    catalogVersion: MACRO_INDUSTRY_CATALOG_VERSION,
    requestedCount: 25,
    warnings: [],
    blockingIssues: [],
    executionError: null,
    executionStatus: null,
    restartConfirmationRequired: false,
    ...overrides,
  } as unknown as ProspectWizardState;
}

function renderValidated(state: ProspectWizardState) {
  return render(
    <WizardConversationSummary
      state={state}
      catalog={{ ...CATALOG, version: state.catalogVersion }}
      dispatch={(() => {}) as React.Dispatch<ProspectWizardAction>}
      onClose={() => {}}
      executionEnabled
      onExecute={() => {}}
      onEditSearch={() => {}}
      lushaPreviewEnabled={false}
      lushaCriteria={NO_LUSHA}
    />,
  );
}

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  cleanup = rtl.cleanup;

  ({ WizardConversationSummary } = await import('../wizard-conversation-summary'));
});

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  cleanup();
});

describe('§ 1 — catálogo v2 (macro industria): la selección de subindustria desaparece por completo', () => {
  it('no muestra la fila «Subindustrias»', () => {
    renderValidated(baseValidatedState({ catalogVersion: MACRO_INDUSTRY_CATALOG_VERSION }));
    assert.equal(screen.queryByText('Subindustrias'), null);
  });

  it('no muestra «Toda la industria»', () => {
    renderValidated(baseValidatedState({ catalogVersion: MACRO_INDUSTRY_CATALOG_VERSION }));
    assert.equal(screen.queryByText('Toda la industria'), null);
  });

  it('no muestra «Sin subindustrias seleccionadas»', () => {
    renderValidated(baseValidatedState({ catalogVersion: MACRO_INDUSTRY_CATALOG_VERSION }));
    assert.equal(screen.queryByText('Sin subindustrias seleccionadas'), null);
  });

  it('sigue ofreciendo «Generar prospectos» — el gate es sólo de subindustria', () => {
    renderValidated(baseValidatedState({ catalogVersion: MACRO_INDUSTRY_CATALOG_VERSION }));
    assert.ok(screen.getByText('Generar prospectos'));
  });
});

describe('§ 7 — v1 legacy conserva el comportamiento exacto de siempre', () => {
  it('sí muestra «Toda la industria» sin selección', () => {
    renderValidated(
      baseValidatedState({ catalogVersion: LEGACY_INDUSTRY_CATALOG_VERSION, subindustryIds: [] }),
    );
    assert.ok(screen.getByText('Toda la industria'));
  });

  it('sí muestra la recapitulación cuando hay subindustrias seleccionadas', () => {
    renderValidated(
      baseValidatedState({
        catalogVersion: LEGACY_INDUSTRY_CATALOG_VERSION,
        subindustryIds: [SUB_ID],
      }),
    );
    assert.ok(screen.getByText('1 subindustria seleccionada'));
  });
});

describe('§ 4 — un intento anterior con BUDGET_EXCEEDED retira el CTA', () => {
  function budgetBlockedState(): ProspectWizardState {
    return baseValidatedState({
      executionError: {
        code: 'BUDGET_EXCEEDED',
        message: 'El presupuesto disponible no alcanza para esta corrida. Disponibles: 5 créditos. Requeridos: 25 créditos.',
        retryable: false,
      },
    });
  }

  it('«Generar prospectos» deja de ofrecerse', () => {
    renderValidated(budgetBlockedState());
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });

  it('el aviso de presupuesto sigue visible', () => {
    renderValidated(budgetBlockedState());
    assert.ok(screen.getByText(/no alcanza para esta corrida/));
  });

  it('el banner verde ya no promete una ejecución que no va a ocurrir', () => {
    renderValidated(budgetBlockedState());
    assert.ok(screen.getByText('La configuración es válida.'));
    assert.equal(screen.queryByText(/puede tardar unos segundos/), null);
  });

  it('un intento anterior con PERSISTENCE_NOT_READY sigue retirando el CTA (regresión)', () => {
    renderValidated(
      baseValidatedState({
        executionError: {
          code: 'PERSISTENCE_NOT_READY',
          message: 'La base de datos no está preparada para guardar los candidatos.',
          retryable: false,
        },
      }),
    );
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });
});
