/**
 * wizard-multi-subindustry-surface-runtime.test.tsx — RENDER REAL.
 *
 * AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A.2 / § A.4.
 *
 * Dos comprobaciones que sólo se pueden hacer montando de verdad:
 *
 *   1. El paso de subindustrias ya NO guarda la selección en estado local. Antes
 *      la guardaba, y el árbol del paso activo se desmonta cada vez que el hilo
 *      de mensajes vuelve a "escribir": al remontar, lo elegido y aún no
 *      confirmado se perdía sin aviso. Aquí se remonta el paso a propósito y la
 *      selección tiene que seguir ahí.
 *   2. La pantalla previa al gasto («Generar prospectos») muestra TODAS las
 *      subindustrias y su contador. Antes no mostraba ninguna: la recapitulación
 *      existía sólo dentro del panel de Lusha.
 *
 * Sin red, sin proveedor, sin créditos: los módulos de acciones de servidor están
 * mockeados en el límite.
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
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type {
  ProspectWizardState,
  ProspectWizardAction,
} from '@/modules/prospect-batches/chat-wizard';
import {
  createInitialProspectWizardState,
  prospectWizardReducer,
} from '@/modules/prospect-batches/chat-wizard/wizard-reducer';
import type { WizardLushaCriteriaDecision } from '@/modules/prospect-batches/wizard-lusha-criteria';
import type { MultiSelectOption } from '@/components/forms/multi-select';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
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

let WizardActiveStep: (typeof import('../wizard-active-step'))['WizardActiveStep'];
let WizardConversationSummary: (typeof import('../wizard-conversation-summary'))['WizardConversationSummary'];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INDUSTRY_ID = 'e9338391-f2d1-5c84-90da-49a5508e4d3f';
const TIENDAS = {
  id: '912a4b36-8597-5204-bb8e-814fb0769505',
  name: 'Tiendas por Departamento, Moda y Calzado',
};
const SUPERMERCADOS = {
  id: 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d',
  name: 'Supermercados e Hipermercados',
};

const OPTIONS: MultiSelectOption[] = [
  { value: TIENDAS.id, label: TIENDAS.name },
  { value: SUPERMERCADOS.id, label: SUPERMERCADOS.name },
];

const CATALOG: ActiveIndustryCatalog = {
  version: '1.0.0',
  industries: [{ id: INDUSTRY_ID, name: 'Retail y Consumo', slug: 'retail', description: null }],
  subindustries: [
    { id: TIENDAS.id, name: TIENDAS.name, industryId: INDUSTRY_ID },
    { id: SUPERMERCADOS.id, name: SUPERMERCADOS.name, industryId: INDUSTRY_ID },
  ],
} as unknown as ActiveIndustryCatalog;

const NO_LUSHA: WizardLushaCriteriaDecision = {
  provider: 'default_ai',
  input: null,
} as unknown as WizardLushaCriteriaDecision;

function stateAtSubindustriesStep(): ProspectWizardState {
  let state = createInitialProspectWizardState({
    catalogVersion: '1.0.0',
    defaultRequestedCount: 25,
  });
  state = prospectWizardReducer(state, { type: 'START' });
  state = prospectWizardReducer(state, { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' });
  state = prospectWizardReducer(state, { type: 'SELECT_COUNTRY', countryCode: 'CO' });
  state = prospectWizardReducer(state, { type: 'SELECT_INDUSTRY', industryId: INDUSTRY_ID });
  return state;
}

/**
 * Anfitrión mínimo que reproduce lo que hace el wizard real: mantiene el estado
 * en el reductor y DESMONTA el árbol del paso activo cuando `mounted` es falso —
 * exactamente lo que hace el hilo de mensajes mientras "escribe".
 */
function SubindustriesHost({
  initialState,
  mounted,
}: {
  initialState: ProspectWizardState;
  mounted: boolean;
}) {
  const [state, dispatch] = React.useReducer(prospectWizardReducer, initialState);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  return (
    <div>
      <div data-testid="committed">{state.subindustryIds.join('|')}</div>
      {mounted && (
        <WizardActiveStep
          state={state}
          dispatch={dispatch as React.Dispatch<ProspectWizardAction>}
          industryOptions={[]}
          subindustryOptions={OPTIONS}
          onCountryChange={() => {}}
          stepTitleRef={titleRef}
          criteriaIntention="pending"
          onCriteriaIntentionYes={() => {}}
        />
      )}
    </div>
  );
}

function openSelector(): void {
  fireEvent.click(screen.getByRole('combobox'));
}

function pick(label: string): void {
  fireEvent.click(screen.getByText(label));
}

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  fireEvent = rtl.fireEvent;
  cleanup = rtl.cleanup;

  ({ WizardActiveStep } = await import('../wizard-active-step'));
  ({ WizardConversationSummary } = await import('../wizard-conversation-summary'));
});

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  cleanup();
});

describe('§ A.2 — la multiselección se compromete al estado en cada clic', () => {
  it('dos selecciones sucesivas quedan AMBAS en el estado del wizard', () => {
    render(<SubindustriesHost initialState={stateAtSubindustriesStep()} mounted />);

    openSelector();
    pick(TIENDAS.name);
    pick(SUPERMERCADOS.name);

    assert.equal(
      screen.getByTestId('committed').textContent,
      `${TIENDAS.id}|${SUPERMERCADOS.id}`,
    );
  });

  it('el contador refleja la selección real', () => {
    render(<SubindustriesHost initialState={stateAtSubindustriesStep()} mounted />);

    assert.ok(screen.getByText('0/5 seleccionadas'));
    openSelector();
    pick(TIENDAS.name);
    assert.ok(screen.getByText('1/5 seleccionadas'));
    pick(SUPERMERCADOS.name);
    assert.ok(screen.getByText('2/5 seleccionadas'));
  });

  it('remontar el paso NO pierde lo seleccionado y aún sin confirmar', () => {
    const { rerender } = render(
      <SubindustriesHost initialState={stateAtSubindustriesStep()} mounted />,
    );

    openSelector();
    pick(TIENDAS.name);

    // El hilo de mensajes vuelve a "escribir": el paso activo se desmonta…
    rerender(<SubindustriesHost initialState={stateAtSubindustriesStep()} mounted={false} />);
    assert.equal(screen.queryByRole('combobox'), null);

    // …y vuelve. Con el borrador local esto reiniciaba la selección a cero.
    rerender(<SubindustriesHost initialState={stateAtSubindustriesStep()} mounted />);
    assert.equal(screen.getByTestId('committed').textContent, TIENDAS.id);
    assert.ok(screen.getByText('1/5 seleccionadas'));

    // Y la segunda selección se SUMA a la primera, no la sustituye.
    openSelector();
    pick(SUPERMERCADOS.name);
    assert.equal(
      screen.getByTestId('committed').textContent,
      `${TIENDAS.id}|${SUPERMERCADOS.id}`,
    );
  });

  it('el paso lista explícitamente cada subindustria elegida', () => {
    render(<SubindustriesHost initialState={stateAtSubindustriesStep()} mounted />);

    openSelector();
    pick(TIENDAS.name);
    pick(SUPERMERCADOS.name);

    // Cada nombre aparece en la lista explícita además del control.
    assert.ok(screen.getAllByText(TIENDAS.name).length >= 2);
    assert.ok(screen.getAllByText(SUPERMERCADOS.name).length >= 2);
  });
});

describe('§ A.4 — la pantalla previa al gasto muestra la selección completa', () => {
  function validatedState(subindustryIds: string[]): ProspectWizardState {
    return {
      currentStep: 'validated',
      countryCode: 'CO',
      industryId: INDUSTRY_ID,
      subindustryIds,
      additionalCriteriaRaw: null,
      catalogVersion: '1.0.0',
      requestedCount: 25,
      warnings: [],
      blockingIssues: [],
      executionError: null,
      executionStatus: null,
      restartConfirmationRequired: false,
    } as unknown as ProspectWizardState;
  }

  function renderValidated(subindustryIds: string[]) {
    return render(
      <WizardConversationSummary
        state={validatedState(subindustryIds)}
        catalog={CATALOG}
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

  it('las DOS subindustrias y el contador se ven junto a «Generar prospectos»', () => {
    renderValidated([TIENDAS.id, SUPERMERCADOS.id]);

    assert.ok(screen.getByText('Generar prospectos'));
    assert.ok(screen.getByText(TIENDAS.name));
    assert.ok(screen.getByText(SUPERMERCADOS.name));
    assert.ok(screen.getByText('2 subindustrias seleccionadas'));
  });

  it('una sola selección se declara en singular', () => {
    renderValidated([SUPERMERCADOS.id]);

    assert.ok(screen.getByText(SUPERMERCADOS.name));
    assert.ok(screen.getByText('1 subindustria seleccionada'));
    assert.equal(screen.queryByText(TIENDAS.name), null);
  });

  it('sin subindustrias lo dice explícitamente, no en blanco', () => {
    renderValidated([]);

    assert.ok(screen.getByText('Sin subindustrias seleccionadas'));
    assert.ok(screen.getByText('Toda la industria'));
  });
});
