/**
 * wizard-budget-gate-preflight-runtime.test.tsx — RENDER REAL del bloqueo ANTES
 * del primer clic.
 *
 * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1.
 *
 * El estado que ninguna suite cubría, y que la QA visual de Producción encontró
 * el 2026-08-13 con el presupuesto real 244/239/0 ⇒ 5 disponibles:
 *
 *     wizard configurado + presupuesto insuficiente CONOCIDO + NINGÚN error de
 *     ejecución previo
 *
 * AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 sólo derivaba el bloqueo de
 * `executionError?.code === 'BUDGET_EXCEEDED'`, así que en ese estado la pantalla
 * se ofrecía intacta: sin aviso, con el selector de proveedor y con «Generar
 * prospectos» a un clic. El aviso llegaba como premio por fallar.
 *
 * Estas pruebas fallan contra ese comportamiento y pasan con el bloqueo previo.
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
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type { ProspectWizardState, ProspectWizardAction } from '@/modules/prospect-batches/chat-wizard';
import type { WizardLushaCriteriaDecision } from '@/modules/prospect-batches/wizard-lusha-criteria';
import type { WizardBudgetPreflight } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import type {
  WizardProviderOverrideCapability,
  WizardRunSelectableProvider,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';
import { MACRO_INDUSTRY_CATALOG_VERSION } from '@/modules/macro-industry-catalog/macro-industries';

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

const CATALOG: ActiveIndustryCatalog = {
  version: MACRO_INDUSTRY_CATALOG_VERSION,
  industries: [{ id: INDUSTRY_ID, name: 'Salud y Farmacéuticos', slug: 'salud', description: null }],
  subindustries: [],
} as unknown as ActiveIndustryCatalog;

const NO_LUSHA: WizardLushaCriteriaDecision = {
  provider: 'default_ai',
  input: null,
} as unknown as WizardLushaCriteriaDecision;

/** Capacidad de admin: sin ella el selector de proveedor no se renderiza nunca. */
const ADMIN_CAPABILITY: WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: true,
  allowedProviders: ['tavily', 'apollo_organizations'],
};

/** El presupuesto real de Producción en el momento de la QA. */
const PROD_PREFLIGHT: WizardBudgetPreflight = {
  availableCredits: 5,
  requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
};

function validatedState(overrides: Partial<ProspectWizardState> = {}): ProspectWizardState {
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

type RenderOptions = {
  state?: ProspectWizardState;
  budgetPreflight?: WizardBudgetPreflight | null;
  requestedProvider?: WizardRunSelectableProvider | undefined;
  defaultDiscoveryProvider?: WizardRunSelectableProvider | null;
};

/**
 * Ojo con `requestedProvider`: `undefined` es un VALOR con significado propio
 * («el administrador no tocó el selector»), así que no puede resolverse con un
 * default de desestructuración — ése lo repondría a Apollo y la prueba dejaría
 * de ejercitar el camino del predeterminado del servidor. Se lee por presencia
 * de la clave.
 */
function renderSummary(options: RenderOptions = {}) {
  const {
    state = validatedState(),
    budgetPreflight = PROD_PREFLIGHT,
    defaultDiscoveryProvider = 'tavily',
  } = options;
  const requestedProvider = 'requestedProvider' in options
    ? options.requestedProvider
    : ('apollo_organizations' as WizardRunSelectableProvider);
  return render(
    <WizardConversationSummary
      state={state}
      catalog={CATALOG}
      dispatch={(() => {}) as React.Dispatch<ProspectWizardAction>}
      onClose={() => {}}
      executionEnabled
      onExecute={() => {}}
      onEditSearch={() => {}}
      lushaPreviewEnabled={false}
      lushaCriteria={NO_LUSHA}
      providerOverrideCapability={ADMIN_CAPABILITY}
      requestedProvider={requestedProvider}
      onRequestedProviderChange={() => {}}
      budgetPreflight={budgetPreflight}
      defaultDiscoveryProvider={defaultDiscoveryProvider}
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

describe('§ 1 — available 5 / required 25, SIN intento previo: el bloqueo existe antes del primer clic', () => {
  it('muestra el aviso con el motivo y las DOS cifras', () => {
    renderSummary();
    const notice = screen.getByTestId('wizard-budget-preflight-notice');
    assert.match(notice.textContent ?? '', /El presupuesto disponible no alcanza para esta corrida\./);
    assert.match(notice.textContent ?? '', /Disponibles: 5 créditos\./);
    assert.match(notice.textContent ?? '', /Requeridos: 25 créditos\./);
  });

  it('«Generar prospectos» deja de ofrecerse — no hay CTA que pueda gastar', () => {
    renderSummary();
    assert.equal(screen.queryByText('Generar prospectos') === null, true);
  });

  it('el selector de proveedor deja de ofrecerse (mismo gate que el CTA)', () => {
    renderSummary();
    assert.equal(screen.queryByText('Proveedor de esta corrida') === null, true);
  });

  it('el banner verde deja de prometer una ejecución que no va a ocurrir', () => {
    renderSummary();
    assert.ok(screen.getByText('La configuración es válida.'));
    assert.equal(screen.queryByText(/puede tardar unos segundos/) === null, true);
  });

  it('el aviso es un `alert`: aparece sin que la usuaria haya actuado', () => {
    renderSummary();
    assert.equal(screen.getByTestId('wizard-budget-preflight-notice').getAttribute('role'), 'alert');
  });
});

describe('§ 2 — presupuesto suficiente: la pantalla se comporta como siempre', () => {
  const enough: WizardBudgetPreflight = {
    availableCredits: 25,
    requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
  };

  it('available = required (25/25) no muestra aviso y conserva el CTA', () => {
    renderSummary({ budgetPreflight: enough });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice') === null, true);
    assert.ok(screen.getByText('Generar prospectos'));
  });

  it('available > required conserva el CTA y el selector', () => {
    renderSummary({ budgetPreflight: { ...enough, availableCredits: 120 } });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice') === null, true);
    assert.ok(screen.getByText('Generar prospectos'));
    assert.ok(screen.getByText('Proveedor de esta corrida'));
  });
});

describe('§ 3 — presupuesto agotado: otro texto, mismo bloqueo', () => {
  it('available = 0 dice «se agotó», no «no alcanza»', () => {
    renderSummary({
      budgetPreflight: { ...PROD_PREFLIGHT, availableCredits: 0 },
    });
    const notice = screen.getByTestId('wizard-budget-preflight-notice');
    assert.match(notice.textContent ?? '', /agot/i);
    assert.doesNotMatch(notice.textContent ?? '', /no alcanza para esta corrida/);
    assert.equal(screen.queryByText('Generar prospectos') === null, true);
  });
});

describe('§ 4 — sin instantánea NO se bloquea: la RPC sigue siendo la autoridad', () => {
  it('`null` deja la pantalla exactamente como estaba', () => {
    renderSummary({ budgetPreflight: null });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice') === null, true);
    assert.ok(screen.getByText('Generar prospectos'));
  });

  it('sin proveedor que nombrar tampoco se bloquea', () => {
    renderSummary({ requestedProvider: undefined, defaultDiscoveryProvider: null });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice') === null, true);
    assert.ok(screen.getByText('Generar prospectos'));
  });
});

describe('§ 5 — sin selección explícita se compara contra el predeterminado del servidor', () => {
  it('Tavily predeterminado con 5 disponibles y 20 requeridos también bloquea', () => {
    renderSummary({ requestedProvider: undefined, defaultDiscoveryProvider: 'tavily' });
    const notice = screen.getByTestId('wizard-budget-preflight-notice');
    assert.match(notice.textContent ?? '', /Requeridos: 20 créditos\./);
    assert.equal(screen.queryByText('Generar prospectos') === null, true);
  });
});

describe('§ 6 — el bloqueo REACTIVO de #286 sigue intacto y el aviso no se duplica', () => {
  const reactiveState = validatedState({
    executionError: {
      code: 'BUDGET_EXCEEDED',
      message:
        'El presupuesto disponible no alcanza para esta corrida. Disponibles: 5 créditos. Requeridos: 25 créditos.',
      retryable: false,
    },
  } as unknown as Partial<ProspectWizardState>);

  it('con error de ejecución en pantalla NO se añade un segundo aviso', () => {
    renderSummary({ state: reactiveState });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice') === null, true);
    assert.equal(screen.getAllByText(/no alcanza para esta corrida/).length, 1);
  });

  it('el CTA sigue retirado por el bloqueo reactivo aunque no haya instantánea', () => {
    renderSummary({ state: reactiveState, budgetPreflight: null });
    assert.equal(screen.queryByText('Generar prospectos') === null, true);
  });
});
