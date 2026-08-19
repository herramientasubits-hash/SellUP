/**
 * wizard-lusha-preflight-authority-runtime.test.tsx — UNA sola autoridad de
 * presupuesto por ruta, en el RENDER REAL de la pantalla final del wizard.
 *
 * AGENT1-LUSHA-PRECLICK-UX-CONSISTENCY-FIX-1 § P0.
 *
 * El FAIL visual que la dueña encontró en Producción el 2026-08-19, ANTES de
 * gastar un solo crédito (CO · health_pharma · targetGap 5 · 6 disponibles):
 *
 *     la MISMA pantalla mostraba arriba «El presupuesto disponible no alcanza
 *     para esta corrida. Disponibles: 6 créditos. Requeridos: 20 créditos.» y
 *     abajo el panel de Lusha con «Presupuesto disponible: 6 / Máximo que puede
 *     consumir esta búsqueda: 6» y «Buscar con IA» habilitado.
 *
 * Las dos cifras venían de preflights distintos: el GENÉRICO —que compara contra
 * el techo de Tavily/Apollo, proveedores que una corrida de Lusha no va a usar— y
 * el plan-aware de Lusha, que es el único que sabe cuántas ramas ejecuta la macro
 * industria. Dos autoridades visuales incompatibles sobre el mismo gasto: la de
 * arriba anunciaba un bloqueo inexistente para esa ruta.
 *
 * Estas pruebas fallan contra ese comportamiento y pasan con el preflight
 * genérico hecho consciente de la ruta.
 *
 * Propiedades que NO se relajan aquí:
 *   · La ruta Lusha conserva SU bloqueo previo (§ B).
 *   · Apollo/Tavily conservan el suyo intacto (§ C).
 *   · Sin instantánea no se bloquea a nadie: la reserva atómica del servidor
 *     sigue siendo la autoridad económica real (§ D).
 *
 * Sin red, sin proveedor, sin base, sin créditos. ENABLE_LUSHA_PREVIEW no se lee:
 * la ruta se honra pasando la prop del gate.
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
import type {
  ProspectWizardState,
  ProspectWizardAction,
} from '@/modules/prospect-batches/chat-wizard';
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

// Ninguna server action real se carga: si el render alcanzara una, el mock lo
// hace evidente sin tocar al proveedor.
mock.module('@/modules/prospect-batches/lusha-preview-actions', {
  namedExports: {
    previewLushaCompaniesAction: async () => {
      throw new Error('la server action real no debe invocarse en esta suite');
    },
  },
});
mock.module('@/modules/prospect-batches/lusha-pending-review-actions', {
  namedExports: {
    generateLushaPendingReviewBatchAction: async () => {
      throw new Error('la server action real no debe invocarse en esta suite');
    },
  },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({
      push: () => {},
      replace: () => {},
      refresh: () => {},
      back: () => {},
      forward: () => {},
      prefetch: () => {},
    }),
    usePathname: () => '/accounts',
    useSearchParams: () => new URLSearchParams(),
    redirect: () => {},
    notFound: () => {},
  },
});

let WizardConversationSummary: (typeof import('../wizard-conversation-summary'))['WizardConversationSummary'];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INDUSTRY_ID = 'e9338391-f2d1-5c84-90da-49a5508e4d3f';

const CATALOG: ActiveIndustryCatalog = {
  version: MACRO_INDUSTRY_CATALOG_VERSION,
  industries: [
    { id: INDUSTRY_ID, name: 'Salud y Farmacéuticos', slug: 'health_pharma', description: null },
  ],
  subindustries: [],
} as unknown as ActiveIndustryCatalog;

/** La corrida que la dueña tenía en pantalla: CO · health_pharma (3 ramas). */
const LUSHA_DECISION: WizardLushaCriteriaDecision = {
  provider: 'lusha',
  reason: 'test',
  input: {
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    subIndustryId: null,
    sizeBandKey: '201-5000',
    searchText: null,
  },
} as unknown as WizardLushaCriteriaDecision;

/** Ruta NO-Lusha: el wizard resolvió el discovery propio de Agente 1. */
const NO_LUSHA: WizardLushaCriteriaDecision = {
  provider: 'default_ai',
  reason: 'test',
  input: null,
} as unknown as WizardLushaCriteriaDecision;

const ADMIN_CAPABILITY: WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: true,
  allowedProviders: ['tavily', 'apollo_organizations'],
};

/**
 * La instantánea REAL del período en el momento del FAIL: 295/289/0 ⇒ 6
 * disponibles, techo de Lusha para health_pharma = 6 (3 ramas × 2), y los techos
 * de Apollo/Tavily muy por encima — que es justo lo que producía el aviso
 * genérico «Requeridos: 20» sobre una corrida que jamás iba a llamar a Tavily.
 */
const PROD_SNAPSHOT: WizardBudgetPreflight = {
  availableCredits: 6,
  requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
  lushaRequiredCredits: 2,
  lushaRequiredCreditsByMacroIndustry: { technology: 2, consumer_goods: 4, health_pharma: 6 },
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
    requestedCount: 5,
    warnings: [],
    blockingIssues: [],
    executionError: null,
    executionStatus: null,
    restartConfirmationRequired: false,
    ...overrides,
  } as unknown as ProspectWizardState;
}

type RenderOptions = {
  lushaPreviewEnabled?: boolean;
  lushaCriteria?: WizardLushaCriteriaDecision;
  budgetPreflight?: WizardBudgetPreflight | null;
  defaultDiscoveryProvider?: WizardRunSelectableProvider | null;
  state?: ProspectWizardState;
};

function renderSummary(options: RenderOptions = {}) {
  const {
    lushaPreviewEnabled = true,
    lushaCriteria = LUSHA_DECISION,
    budgetPreflight = PROD_SNAPSHOT,
    defaultDiscoveryProvider = 'tavily',
    state = validatedState(),
  } = options;
  return render(
    <WizardConversationSummary
      state={state}
      catalog={CATALOG}
      dispatch={(() => {}) as React.Dispatch<ProspectWizardAction>}
      onClose={() => {}}
      executionEnabled
      onExecute={() => {}}
      onEditSearch={() => {}}
      lushaPreviewEnabled={lushaPreviewEnabled}
      lushaCriteria={lushaCriteria}
      providerOverrideCapability={ADMIN_CAPABILITY}
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

// ═══════════════════════════════════════════════════════════════════════════════
describe('§ A — el estado exacto del FAIL: Lusha health_pharma, 6 disponibles / 6 requeridos', () => {
  it('🔴 el aviso GENÉRICO no se renderiza en la ruta de Lusha', () => {
    renderSummary();
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice'), null);
  });

  it('🔴 no aparece por ningún lado el «Requeridos: 20 créditos» de otro proveedor', () => {
    const { container } = renderSummary();
    const text = container.textContent ?? '';
    assert.doesNotMatch(text, /Requeridos: 20 créditos/);
    assert.doesNotMatch(text, /Requeridos: 25 créditos/);
    assert.doesNotMatch(text, /no alcanza para esta corrida/i);
  });

  it('el panel plan-aware de Lusha SÍ se renderiza, con 6 y 6', () => {
    renderSummary();
    assert.ok(screen.getByTestId('lusha-budget-preflight'));
    assert.equal(screen.getByTestId('lusha-budget-available').textContent, '6');
    assert.equal(screen.getByTestId('lusha-budget-required').textContent, '6');
  });

  it('«Buscar con IA» sigue habilitado: 6 ≥ 6 cabe exacto', () => {
    renderSummary();
    const cta = screen.getByTestId('lusha-preview-run') as HTMLButtonElement;
    assert.equal(cta.disabled, false);
    assert.match(cta.textContent ?? '', /Buscar con IA/);
  });
});

describe('§ B — la ruta Lusha conserva SU bloqueo: 5 disponibles / 6 requeridos', () => {
  const insufficient: WizardBudgetPreflight = { ...PROD_SNAPSHOT, availableCredits: 5 };

  it('el aviso genérico sigue sin renderizarse', () => {
    renderSummary({ budgetPreflight: insufficient });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice'), null);
  });

  it('hay UN solo bloqueo, el de Lusha, con las cifras del plan (5 vs 6)', () => {
    renderSummary({ budgetPreflight: insufficient });
    const notice = screen.getByTestId('lusha-budget-preflight-notice');
    assert.match(notice.textContent ?? '', /no alcanza para esta corrida/i);
    assert.match(notice.textContent ?? '', /Disponibles: 5 créditos/);
    assert.match(notice.textContent ?? '', /Requeridos: 6 créditos/);
    // Un único texto de bloqueo en toda la pantalla.
    assert.equal(screen.getAllByText(/no alcanza para esta corrida/i).length, 1);
  });

  it('«Buscar con IA» queda deshabilitado', () => {
    renderSummary({ budgetPreflight: insufficient });
    assert.equal((screen.getByTestId('lusha-preview-run') as HTMLButtonElement).disabled, true);
  });
});

describe('§ C — la ruta NO-Lusha conserva su preflight genérico intacto', () => {
  it('con 6 disponibles y Tavily (20) el aviso genérico sigue apareciendo', () => {
    renderSummary({ lushaCriteria: NO_LUSHA, lushaPreviewEnabled: false });
    const notice = screen.getByTestId('wizard-budget-preflight-notice');
    assert.match(notice.textContent ?? '', /Disponibles: 6 créditos/);
    assert.match(notice.textContent ?? '', /Requeridos: 20 créditos/);
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });

  it('el flag encendido no basta: sin ruta Lusha honrada manda el genérico', () => {
    // `lushaPreviewEnabled` sin decisión de Lusha NO es la ruta de Lusha.
    renderSummary({ lushaCriteria: NO_LUSHA, lushaPreviewEnabled: true });
    assert.ok(screen.getByTestId('wizard-budget-preflight-notice'));
    assert.equal(screen.queryByTestId('lusha-budget-preflight'), null);
  });

  it('con presupuesto suficiente la ruta NO-Lusha conserva su CTA', () => {
    renderSummary({
      lushaCriteria: NO_LUSHA,
      lushaPreviewEnabled: false,
      budgetPreflight: { ...PROD_SNAPSHOT, availableCredits: 40 },
    });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice'), null);
    assert.ok(screen.getByText('Generar prospectos'));
  });
});

describe('§ D — sin instantánea nadie se bloquea: la reserva del servidor decide', () => {
  it('Lusha con `budgetPreflight` null: sin avisos, sin cifras, CTA habilitado', () => {
    renderSummary({ budgetPreflight: null });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice'), null);
    assert.equal(screen.queryByTestId('lusha-budget-preflight-notice'), null);
    assert.equal(screen.queryByTestId('lusha-budget-preflight'), null);
    assert.equal((screen.getByTestId('lusha-preview-run') as HTMLButtonElement).disabled, false);
  });

  it('sin techo resoluble para la macro tampoco se bloquea client-side', () => {
    renderSummary({
      budgetPreflight: {
        availableCredits: 0,
        requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
        lushaRequiredCredits: null,
        lushaRequiredCreditsByMacroIndustry: null,
      },
    });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice'), null);
    assert.equal(screen.queryByTestId('lusha-budget-preflight-notice'), null);
    assert.equal((screen.getByTestId('lusha-preview-run') as HTMLButtonElement).disabled, false);
  });
});

describe('§ E — el aviso de costo dejó de prometer una forma de búsqueda estática', () => {
  it('no promete 2 páginas, 10 por página ni 20 empresas', () => {
    renderSummary();
    const notice = screen.getByTestId('lusha-preview-cost-notice').textContent ?? '';
    assert.doesNotMatch(notice, /hasta 2\b/i);
    assert.doesNotMatch(notice, /2 páginas/i);
    assert.doesNotMatch(notice, /10 resultados por página/i);
    assert.doesNotMatch(notice, /hasta 20 empresas/i);
  });

  it('no contiene NINGUNA cifra estática de ramas, páginas o filas', () => {
    renderSummary();
    const notice = screen.getByTestId('lusha-preview-cost-notice').textContent ?? '';
    assert.equal(
      /\d/.test(notice),
      false,
      `el aviso no puede llevar cifras propias: «${notice}»`,
    );
  });

  it('apunta al plan de la macro y al techo autorizado, que vive en el panel', () => {
    renderSummary();
    const notice = screen.getByTestId('lusha-preview-cost-notice').textContent ?? '';
    assert.match(notice, /plan configurado para la macroindustria/i);
    assert.match(notice, /máximo de créditos autorizado/i);
    assert.match(notice, /consumo real puede ser menor/i);
    // La única cifra cuantitativa de la pantalla es la del preflight plan-aware.
    assert.equal(screen.getByTestId('lusha-budget-required').textContent, '6');
  });

  it('sin instantánea no promete un techo que no puede enseñar', () => {
    renderSummary({ budgetPreflight: null });
    const notice = screen.getByTestId('lusha-preview-cost-notice').textContent ?? '';
    assert.doesNotMatch(notice, /máximo de créditos autorizado/i);
  });
});

describe('§ F — RATCHET: una búsqueda Lusha nunca renderiza los dos avisos a la vez', () => {
  const budgets: Array<[string, WizardBudgetPreflight]> = [
    ['agotado', { ...PROD_SNAPSHOT, availableCredits: 0 }],
    ['insuficiente para Lusha', { ...PROD_SNAPSHOT, availableCredits: 5 }],
    ['justo (6/6)', PROD_SNAPSHOT],
    ['de sobra', { ...PROD_SNAPSHOT, availableCredits: 500 }],
  ];

  for (const [label, budgetPreflight] of budgets) {
    it(`presupuesto ${label}: como máximo UN aviso de presupuesto`, () => {
      renderSummary({ budgetPreflight });
      const generic = screen.queryByTestId('wizard-budget-preflight-notice');
      const lusha = screen.queryByTestId('lusha-budget-preflight-notice');
      assert.equal(generic, null, 'el genérico no pertenece a la ruta Lusha');
      assert.equal(
        generic !== null && lusha !== null,
        false,
        'dos autoridades de presupuesto en la misma pantalla',
      );
    });
  }

  it('también con un BUDGET_EXCEEDED reactivo en pantalla', () => {
    // El error reactivo llega del ejecutor de Agente 1; aunque quede en el estado,
    // la ruta Lusha no puede acabar mostrando además el aviso genérico.
    renderSummary({
      state: validatedState({
        executionError: {
          code: 'BUDGET_EXCEEDED',
          message:
            'El presupuesto disponible no alcanza para esta corrida. Disponibles: 6 créditos. Requeridos: 20 créditos.',
          retryable: false,
        },
      } as unknown as Partial<ProspectWizardState>),
    });
    assert.equal(screen.queryByTestId('wizard-budget-preflight-notice'), null);
  });
});
