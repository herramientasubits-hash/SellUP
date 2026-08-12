/**
 * wizard-run-provider-surface-runtime.test.tsx — superficie «Proveedor de esta
 * corrida», RENDER REAL.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 2–5, § 10 · casos 1–8 y 28.
 *
 * Renderiza el `WizardConversationSummary` REAL en el paso `validated` y verifica:
 *
 *   caso 1 — admin + override OFF            → el selector NO está en el árbol
 *   caso 2 — override ON + kill switch OFF   → Apollo deshabilitado + aviso
 *   caso 3 — los tres gates ON               → Apollo seleccionable
 *   caso 4 — usuario no admin                → el selector NO está en el árbol
 *   caso 5 — valor inicial                   → Tavily marcado
 *   caso 7 — elegir Apollo                   → sólo notifica la PETICIÓN
 *   caso 8 — el indicador usa el proveedor RESUELTO por el servidor
 *
 * El módulo de la acción de servidor está mockeado: ninguna prueba llama a Apollo,
 * a Tavily ni a Supabase.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
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
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type {
  ProspectWizardState,
  ProspectWizardAction,
} from '@/modules/prospect-batches/chat-wizard';
import type { WizardLushaCriteriaDecision } from '@/modules/prospect-batches/wizard-lusha-criteria';
import type {
  WizardProviderOverrideCapability,
  WizardRunSelectableProvider,
  ApolloRunModeLimits,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// Boundary mocks: los módulos de acciones de servidor nunca se cargan de verdad,
// así que sus imports server-only no entran y nada puede llamar a un proveedor.
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
let WizardProviderIndicatorRow: (typeof import('../wizard-provider-indicator'))['WizardProviderIndicatorRow'];
let resolveWizardProviderIndicator: (typeof import('@/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator'))['resolveWizardProviderIndicator'];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'ind-1', name: 'Tecnología', slug: 'tecnologia', description: null } as never,
  ],
  subindustries: [],
} as unknown as ActiveIndustryCatalog;

const LIMITS: ApolloRunModeLimits = {
  targetEligibleCompanies: 5,
  maxRounds: 2,
  maxResultsPerRound: 5,
  maxRawResultsPerRun: 10,
  maxEnrichmentsPerRun: 2,
  maxInternalCredits: 12,
};

const NO_LUSHA: WizardLushaCriteriaDecision = {
  provider: 'default_ai',
  input: null,
} as unknown as WizardLushaCriteriaDecision;

function validatedState(): ProspectWizardState {
  return {
    currentStep: 'validated',
    // AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — el modo es parte del estado que
    // `canValidateWizard` exige para llegar a `validated`, y ahora también decide si
    // la búsqueda admite un proveedor externo. El fixture lo omitía.
    searchMode: 'exploratory',
    countryCode: 'CO',
    industryId: 'ind-1',
    subindustryIds: [],
    additionalCriteriaRaw: null,
    catalogVersion: 'v1',
    requestedCount: 25,
    warnings: [],
    blockingIssues: [],
    executionError: null,
    executionStatus: null,
    restartConfirmationRequired: false,
  } as unknown as ProspectWizardState;
}

const CAPABILITY_FULL: WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: true,
  allowedProviders: ['tavily', 'apollo_organizations'],
};
const CAPABILITY_TAVILY_ONLY: WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: true,
  allowedProviders: ['tavily'],
};
const CAPABILITY_NONE: WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: false,
  allowedProviders: [],
};

type RenderOptions = {
  capability: WizardProviderOverrideCapability;
  requestedProvider?: WizardRunSelectableProvider;
  onChange?: (p: WizardRunSelectableProvider) => void;
  limits?: ApolloRunModeLimits | null;
};

function renderValidated(options: RenderOptions) {
  const noopDispatch = (() => {}) as React.Dispatch<ProspectWizardAction>;
  return render(
    <WizardConversationSummary
      state={validatedState()}
      catalog={CATALOG}
      dispatch={noopDispatch}
      onClose={() => {}}
      executionEnabled
      onExecute={() => {}}
      onEditSearch={() => {}}
      lushaPreviewEnabled={false}
      lushaCriteria={NO_LUSHA}
      providerOverrideCapability={options.capability}
      apolloRunModeLimits={options.limits === undefined ? LIMITS : options.limits}
      requestedProvider={options.requestedProvider}
      onRequestedProviderChange={options.onChange ?? (() => {})}
      showApolloTwoRoundStages={false}
      twoRoundOutcome={null}
    />,
  );
}

function providerRadios(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[name="wizard-run-discovery-provider"]',
    ),
  );
}

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  fireEvent = rtl.fireEvent;
  cleanup = rtl.cleanup;

  ({ WizardConversationSummary } = await import('../wizard-conversation-summary'));
  ({ WizardProviderIndicatorRow } = await import('../wizard-provider-indicator'));
  ({ resolveWizardProviderIndicator } = await import(
    '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator'
  ));
});

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  cleanup();
});

describe('§ 2 · caso 1 — admin con el override apagado no ve el selector', () => {
  it('el control no está en el árbol, no está simplemente oculto', () => {
    renderValidated({ capability: CAPABILITY_NONE });

    assert.equal(document.querySelector('[data-testid="wizard-run-provider-selector"]'), null);
    assert.equal(providerRadios().length, 0);
    assert.equal(screen.queryByText('Proveedor de esta corrida'), null);
  });

  it('caso 4 — un no-admin tampoco lo ve, y el botón de generar sigue ahí', () => {
    renderValidated({ capability: CAPABILITY_NONE });

    assert.equal(providerRadios().length, 0);
    // La pantalla no se rompe: la generación normal sigue disponible.
    assert.ok(screen.getByText('Generar prospectos'));
  });
});

describe('§ 4 · caso 2 — override ON con Apollo no disponible', () => {
  beforeEach(() => {
    renderValidated({ capability: CAPABILITY_TAVILY_ONLY });
  });

  it('el selector se muestra', () => {
    assert.ok(document.querySelector('[data-testid="wizard-run-provider-selector"]'));
    assert.ok(screen.getByText('Proveedor de esta corrida'));
  });

  it('Apollo se ofrece DESHABILITADO, no oculto', () => {
    const radios = providerRadios();
    assert.equal(radios.length, 2);
    const apollo = radios.find((r) => r.value === 'apollo_organizations');
    assert.ok(apollo, 'la opción Apollo sigue visible');
    assert.equal(apollo?.disabled, true);
    assert.equal(radios.find((r) => r.value === 'tavily')?.disabled, false);
  });

  it('se explica en términos sanitizados, sin nombrar variables ni valores', () => {
    const notice = document.querySelector('[data-testid="wizard-run-provider-apollo-unavailable"]');
    assert.ok(notice);
    assert.equal(notice?.textContent, 'Apollo no está disponible para esta ejecución.');

    const rendered = document.body.textContent ?? '';
    for (const token of [
      'ENABLE_APOLLO_COMPANY_SEARCH',
      'ENABLE_APOLLO_TWO_ROUND_DISCOVERY',
      'ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE',
      'AGENT1_WIZARD_DISCOVERY_PROVIDER',
      'apollo_organizations',
      'service_role',
    ]) {
      assert.ok(!rendered.includes(token), `la pantalla no debe mostrar "${token}"`);
    }
  });

  it('no anuncia los topes de Apollo cuando Apollo no está seleccionado', () => {
    assert.equal(document.querySelector('[data-testid="wizard-run-provider-apollo-mode"]'), null);
  });
});

describe('§ 2/§ 5 · caso 3 — los tres gates encendidos', () => {
  it('Apollo es seleccionable y no hay aviso de no disponible', () => {
    renderValidated({ capability: CAPABILITY_FULL });

    const apollo = providerRadios().find((r) => r.value === 'apollo_organizations');
    assert.equal(apollo?.disabled, false);
    assert.equal(document.querySelector('[data-testid="wizard-run-provider-apollo-unavailable"]'), null);
  });

  it('§ 5 — al mostrar Apollo seleccionado anuncia los topes reales, con «Hasta 12»', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: 'apollo_organizations' });

    const modeBlock = document.querySelector('[data-testid="wizard-run-provider-apollo-mode"]');
    assert.ok(modeBlock);
    const text = modeBlock?.textContent ?? '';
    assert.ok(text.includes('Apollo intentará encontrar hasta 5 empresas nuevas y válidas'));
    assert.ok(text.includes('máximo de 2 rondas'));
    assert.ok(text.includes('Máximos de esta ejecución:'));
    assert.ok(text.includes('5 resultados por ronda'));
    assert.ok(text.includes('10 resultados raw en total'));
    assert.ok(text.includes('2 enrichments'));
    assert.ok(text.includes('Hasta 12 créditos internos'));
    assert.ok(text.includes('No se garantiza encontrar cinco empresas.'));
    assert.ok(
      text.includes('Los filtros de calidad y duplicados no se reducirán para alcanzar el objetivo.'),
    );
    // Nunca promete el gasto.
    assert.ok(!/se consumirán/i.test(text));
  });

  it('§ 5 — sin topes resueltos no se inventa ninguna cifra', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      limits: null,
    });
    assert.equal(document.querySelector('[data-testid="wizard-run-provider-apollo-mode"]'), null);
  });
});

describe('§ 3 · caso 5 — el valor inicial es Tavily', () => {
  it('sin selección explícita Tavily aparece marcado y Apollo no', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: undefined });

    const radios = providerRadios();
    assert.equal(radios.find((r) => r.value === 'tavily')?.checked, true);
    assert.equal(radios.find((r) => r.value === 'apollo_organizations')?.checked, false);
  });

  it('sin selección explícita no se anuncia el modo Apollo', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: undefined });
    assert.equal(document.querySelector('[data-testid="wizard-run-provider-apollo-mode"]'), null);
  });
});

describe('§ 6 · caso 7 — elegir Apollo sólo notifica la PETICIÓN', () => {
  it('el cambio entrega el proveedor pedido y nada más', () => {
    const calls: unknown[][] = [];
    renderValidated({
      capability: CAPABILITY_FULL,
      onChange: (...args: unknown[]) => {
        calls.push(args);
      },
    });

    const apollo = providerRadios().find((r) => r.value === 'apollo_organizations');
    assert.ok(apollo);
    fireEvent.click(apollo!);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['apollo_organizations']);
  });

  it('una opción deshabilitada no puede notificar nada', () => {
    const calls: unknown[][] = [];
    renderValidated({
      capability: CAPABILITY_TAVILY_ONLY,
      onChange: (...args: unknown[]) => {
        calls.push(args);
      },
    });

    const apollo = providerRadios().find((r) => r.value === 'apollo_organizations');
    fireEvent.click(apollo!);
    assert.equal(calls.length, 0, 'un radio deshabilitado no dispara onChange');
  });
});

describe('§ 10 · caso 8/28 — el indicador usa el proveedor RESUELTO por el servidor', () => {
  it('el proveedor por corrida gana sobre el predeterminado global', () => {
    const indicator = resolveWizardProviderIndicator({
      // El global sigue siendo Tavily…
      serverDiscoveryProvider: 'tavily',
      lushaRoute: 'default_ai',
      skippedProvider: null,
      // …y esta corrida resolvió Apollo.
      runResolvedProvider: 'apollo_organizations',
    });

    render(<WizardProviderIndicatorRow indicator={indicator} />);
    const row = document.querySelector('[data-testid="wizard-provider-indicator"]');
    assert.equal(row?.textContent, 'Proveedor de búsqueda: Apollo');
  });

  it('si el servidor resolvió Tavily, la UI dice Tavily aunque se pidiera Apollo', () => {
    const indicator = resolveWizardProviderIndicator({
      serverDiscoveryProvider: 'tavily',
      lushaRoute: 'default_ai',
      skippedProvider: null,
      runResolvedProvider: 'tavily',
    });

    render(<WizardProviderIndicatorRow indicator={indicator} />);
    const row = document.querySelector('[data-testid="wizard-provider-indicator"]');
    assert.equal(row?.textContent, 'Proveedor de búsqueda: Tavily');
  });

  it('un proveedor omitido por el backend sigue teniendo precedencia', () => {
    const indicator = resolveWizardProviderIndicator({
      serverDiscoveryProvider: 'tavily',
      lushaRoute: 'default_ai',
      skippedProvider: 'apollo_organizations',
      runResolvedProvider: 'apollo_organizations',
    });
    assert.equal(indicator.status, 'unavailable');
    assert.equal(indicator.provider, 'apollo_organizations');
  });

  it('sin resolución por corrida el comportamiento previo se conserva', () => {
    const indicator = resolveWizardProviderIndicator({
      serverDiscoveryProvider: 'apollo_organizations',
      lushaRoute: 'default_ai',
      skippedProvider: null,
      runResolvedProvider: null,
    });
    assert.deepEqual(indicator, { status: 'resolved', provider: 'apollo_organizations' });
  });
});
