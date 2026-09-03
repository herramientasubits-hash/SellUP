/**
 * wizard-lusha-apollo-run-override-runtime.test.tsx — escotilla de escape
 * Lusha → Apollo por corrida, RENDER REAL.
 *
 * A1-LUSHA-APOLLO-RUN-OVERRIDE — caso objetivo: Colombia · Gobierno · Empresas
 * por criterios, normalmente Lusha-elegible, con un admin autorizado pidiendo
 * Apollo para ESTA corrida.
 *
 * Cubre los casos 1, 2, 3, 4, 5, 6, 7 y 10 del hito. Los casos 8 y 9 (payload
 * enviado por el cliente y guard server-side) no se repiten aquí: ya los cubren
 * `wizard-run-provider-payload-static.test.ts` (código fuente de
 * `prospect-chat-wizard.tsx`, NO modificado por este hito) y
 * `wizard-run-provider-authority.test.ts` / `wizard-run-provider-selection.test.ts`
 * (server-side, tampoco modificados) — un test de render nuevo aquí sólo
 * duplicaría esa cobertura sin ejercitar código distinto.
 *
 * El módulo de la acción de servidor está mockeado: ninguna prueba llama a
 * Apollo, a Lusha ni a Supabase.
 *   LIVE_APOLLO_CALLS = 0 · LIVE_LUSHA_CALLS = 0 · PRODUCTION_WRITES = 0
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
import type { WizardBudgetPreflight } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// Boundary mocks: los módulos de acciones de servidor nunca se cargan de verdad,
// así que sus imports server-only no entran y nada puede llamar a un proveedor.
let lushaPendingReviewCallCount = 0;
mock.module('@/modules/prospect-batches/lusha-preview-actions', {
  namedExports: { previewLushaCompaniesAction: async () => ({ ok: false }) },
});
mock.module('@/modules/prospect-batches/lusha-pending-review-actions', {
  namedExports: {
    generateLushaPendingReviewBatchAction: async () => {
      lushaPendingReviewCallCount += 1;
      return { ok: false };
    },
  },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
    redirect: () => {},
  },
});

let WizardConversationSummary: (typeof import('../wizard-conversation-summary'))['WizardConversationSummary'];
let resolveWizardProviderOverrideCapability: (typeof import(
  '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability'
))['resolveWizardProviderOverrideCapability'];
let NO_PROVIDER_OVERRIDE_CAPABILITY: (typeof import(
  '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability'
))['NO_PROVIDER_OVERRIDE_CAPABILITY'];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'ind-1', name: 'Gobierno', slug: 'gobierno', description: null } as never,
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

// Colombia · Gobierno · Empresas por criterios — el caso objetivo del hito.
// Lusha-elegible: `provider: 'lusha'` + `input` no nulo son exactamente lo que
// `resolveWizardLushaCriteria` produce para esa combinación con el preview
// encendido. Este archivo NO ejercita esa función (no se tocó): sólo fija el
// resultado que ya produciría, para probar la capa que sí cambió.
const LUSHA_ELIGIBLE: WizardLushaCriteriaDecision = {
  provider: 'lusha',
  reason: 'criteria_compatible',
  input: {
    countryCode: 'CO',
    macroIndustryKey: 'government',
    subIndustryId: null,
    sizeBandKey: 'default',
    searchText: null,
  },
} as unknown as WizardLushaCriteriaDecision;

const NOT_LUSHA_ELIGIBLE: WizardLushaCriteriaDecision = {
  provider: 'default_ai',
  reason: 'sector_not_mapped',
  input: null,
} as unknown as WizardLushaCriteriaDecision;

type WizardExecutionErrorFixture = { code: string; message: string; retryable: boolean };

// 🔴 HALLAZGO-B — el error se inyecta EXACTAMENTE como lo escribe el reducer:
// `EXECUTION_FAILED` devuelve `currentStep: 'validated'` con
// `executionError: { code, message, retryable }`. Es el estado real en el que la
// pantalla queda tras un intento fallido, no un doble conveniente.
const BUDGET_EXCEEDED_ERROR: WizardExecutionErrorFixture = {
  code: 'BUDGET_EXCEEDED',
  message: 'El presupuesto del período se agotó. Disponibles: 0 créditos · Requeridos: 12 créditos.',
  retryable: false,
};
const PERSISTENCE_NOT_READY_ERROR: WizardExecutionErrorFixture = {
  code: 'PERSISTENCE_NOT_READY',
  message: 'La base de datos no está preparada para guardar los candidatos.',
  retryable: false,
};

function validatedState(
  executionError: WizardExecutionErrorFixture | null = null,
): ProspectWizardState {
  return {
    currentStep: 'validated',
    searchMode: 'exploratory',
    countryCode: 'CO',
    industryId: 'ind-1',
    subindustryIds: [],
    additionalCriteriaRaw: null,
    catalogVersion: 'v1',
    requestedCount: 25,
    warnings: [],
    blockingIssues: [],
    executionError,
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
  lushaCriteria?: WizardLushaCriteriaDecision;
  lushaPreviewEnabled?: boolean;
  onExecute?: () => void;
  /** 🔴 HALLAZGO-B — el fallo REAL del intento anterior, tal cual lo deja el reducer. */
  executionError?: WizardExecutionErrorFixture | null;
  /** Bloqueo de presupuesto PREVIO al primer clic (rama Apollo/Tavily). */
  budgetPreflight?: WizardBudgetPreflight | null;
  defaultDiscoveryProvider?: WizardRunSelectableProvider | null;
};

function renderValidated(options: RenderOptions) {
  const noopDispatch = (() => {}) as React.Dispatch<ProspectWizardAction>;
  return render(
    <WizardConversationSummary
      state={validatedState(options.executionError ?? null)}
      catalog={CATALOG}
      dispatch={noopDispatch}
      onClose={() => {}}
      executionEnabled
      onExecute={options.onExecute ?? (() => {})}
      onEditSearch={() => {}}
      lushaPreviewEnabled={options.lushaPreviewEnabled ?? true}
      lushaCriteria={options.lushaCriteria ?? LUSHA_ELIGIBLE}
      providerOverrideCapability={options.capability}
      apolloRunModeLimits={LIMITS}
      requestedProvider={options.requestedProvider}
      onRequestedProviderChange={options.onChange ?? (() => {})}
      showApolloTwoRoundStages={false}
      twoRoundOutcome={null}
      budgetPreflight={options.budgetPreflight ?? null}
      defaultDiscoveryProvider={options.defaultDiscoveryProvider ?? null}
    />,
  );
}

/**
 * 🔴 HALLAZGO-B — el mismo panel, pero con `requestedProvider` VIVO.
 *
 * El escenario del hallazgo es una transición, no una foto: Apollo elegido →
 * BUDGET_EXCEEDED → volver a «Automático (usa Lusha)». Con la prop congelada el
 * clic no podría cambiar nada y la prueba estaría comprobando su propio doble.
 * Aquí el estado lo lleva el mismo `useState` que lleva `prospect-chat-wizard`.
 */
function StatefulOverridePanel(props: {
  capability: WizardProviderOverrideCapability;
  initialProvider?: WizardRunSelectableProvider;
  executionError?: WizardExecutionErrorFixture | null;
  onExecute?: () => void;
}) {
  const [provider, setProvider] = React.useState<WizardRunSelectableProvider | undefined>(
    props.initialProvider,
  );
  const noopDispatch = (() => {}) as React.Dispatch<ProspectWizardAction>;
  return (
    <WizardConversationSummary
      state={validatedState(props.executionError ?? null)}
      catalog={CATALOG}
      dispatch={noopDispatch}
      onClose={() => {}}
      executionEnabled
      onExecute={props.onExecute ?? (() => {})}
      onEditSearch={() => {}}
      lushaPreviewEnabled
      lushaCriteria={LUSHA_ELIGIBLE}
      providerOverrideCapability={props.capability}
      apolloRunModeLimits={LIMITS}
      requestedProvider={provider}
      onRequestedProviderChange={setProvider}
      showApolloTwoRoundStages={false}
      twoRoundOutcome={null}
      budgetPreflight={null}
      defaultDiscoveryProvider={null}
    />
  );
}

function selectorMounted(): boolean {
  return document.querySelector('[data-testid="wizard-run-provider-selector"]') !== null;
}
function lushaPanelMounted(): boolean {
  return document.querySelector('[data-testid="wizard-lusha-final-search"]') !== null;
}
function clickAutomaticOption(): void {
  const automatic = providerRadios().find((r) => r.value === 'tavily');
  assert.ok(automatic, 'la opción automática debe seguir disponible');
  fireEvent.click(automatic!);
}

function providerRadios(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[name="wizard-run-discovery-provider"]',
    ),
  );
}

function providerLabels(): string[] {
  return Array.from(
    document.querySelectorAll('[data-testid="wizard-run-provider-selector"] label span'),
  ).map((el) => el.textContent ?? '');
}

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  fireEvent = rtl.fireEvent;
  cleanup = rtl.cleanup;

  ({ WizardConversationSummary } = await import('../wizard-conversation-summary'));
  ({ resolveWizardProviderOverrideCapability, NO_PROVIDER_OVERRIDE_CAPABILITY } = await import(
    '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability'
  ));
});

beforeEach(() => {
  document.body.innerHTML = '';
  lushaPendingReviewCallCount = 0;
});
afterEach(() => {
  cleanup();
});

// ── TEST 1 ──────────────────────────────────────────────────────────────────

describe('TEST 1 — CO + Gobierno + admin + Apollo permitido: selector visible aunque Lusha aplique', () => {
  it('el selector se monta dentro de la rama Lusha', () => {
    renderValidated({ capability: CAPABILITY_FULL });

    assert.ok(document.querySelector('[data-testid="wizard-run-provider-selector"]'));
    assert.ok(screen.getByText('Proveedor de esta corrida'));
  });

  it('sin tocar el selector, Lusha sigue siendo la ruta activa detrás de él', () => {
    renderValidated({ capability: CAPABILITY_FULL });

    assert.ok(document.querySelector('[data-testid="wizard-lusha-final-search"]'));
  });
});

// ── TEST 2 ──────────────────────────────────────────────────────────────────

describe('TEST 2 — elegir Apollo: la petición se notifica y, una vez aplicada, retira Lusha', () => {
  it('clic en Apollo notifica exactamente esa petición al padre', () => {
    const calls: WizardRunSelectableProvider[] = [];
    renderValidated({ capability: CAPABILITY_FULL, onChange: (p) => calls.push(p) });

    const apollo = providerRadios().find((r) => r.value === 'apollo_organizations');
    assert.ok(apollo, 'la opción Apollo debe estar disponible con capacidad FULL');
    fireEvent.click(apollo!);

    assert.deepEqual(calls, ['apollo_organizations']);
  });

  it('con requestedProvider=apollo_organizations ya aplicado, WizardLushaFinalSearch NO se monta', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: 'apollo_organizations' });

    assert.equal(document.querySelector('[data-testid="wizard-lusha-final-search"]'), null);
  });

  it('sin Lusha montado, ningún clic pudo haber llamado a su acción de servidor', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: 'apollo_organizations' });

    assert.equal(lushaPendingReviewCallCount, 0);
  });
});

// ── TEST 3 ──────────────────────────────────────────────────────────────────

describe('TEST 3 — con Apollo pedido, aparece el flujo de ejecución de Agente 1', () => {
  it('se muestra "Generar prospectos" en vez del panel de Lusha', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: 'apollo_organizations' });

    assert.ok(screen.getByText('Generar prospectos'));
    assert.equal(document.querySelector('[data-testid="wizard-lusha-final-search"]'), null);
  });

  it('el propio selector queda con Apollo marcado', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: 'apollo_organizations' });

    const apollo = providerRadios().find((r) => r.value === 'apollo_organizations');
    assert.equal(apollo?.checked, true);
  });

  it('el clic en "Generar prospectos" invoca el `onExecute` del flujo Agente 1, no Lusha', () => {
    let executeCalls = 0;
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      onExecute: () => {
        executeCalls += 1;
      },
    });

    fireEvent.click(screen.getByText('Generar prospectos'));
    assert.equal(executeCalls, 1);
    assert.equal(lushaPendingReviewCallCount, 0);
  });
});

// ── TEST 4 ──────────────────────────────────────────────────────────────────

describe('TEST 4 — usuario no admin: Lusha continúa exactamente igual', () => {
  it('el selector no está en el árbol, no está simplemente oculto', () => {
    renderValidated({ capability: CAPABILITY_NONE });

    assert.equal(document.querySelector('[data-testid="wizard-run-provider-selector"]'), null);
    assert.equal(providerRadios().length, 0);
  });

  it('el panel de Lusha se monta sin cambios y "Generar prospectos" no aparece', () => {
    renderValidated({ capability: CAPABILITY_NONE });

    assert.ok(document.querySelector('[data-testid="wizard-lusha-final-search"]'));
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });

  it('un `requestedProvider` que un no-admin nunca pudo fijar no cambia nada (defensa en profundidad)', () => {
    // Ni siquiera con capacidad NONE y un valor forzado en la prop se abre la
    // escotilla: `overridingLushaWithApollo` vuelve a preguntar la capacidad, no
    // confía en el valor crudo de `requestedProvider`.
    renderValidated({ capability: CAPABILITY_NONE, requestedProvider: 'apollo_organizations' });

    assert.ok(document.querySelector('[data-testid="wizard-lusha-final-search"]'));
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });
});

// ── TEST 5 ──────────────────────────────────────────────────────────────────

describe('TEST 5 — Apollo deshabilitado: no se ofrece ninguna escotilla dentro de Lusha', () => {
  it('con Apollo fuera de allowedProviders, el selector no se monta y Lusha sigue siendo la única vía', () => {
    renderValidated({ capability: CAPABILITY_TAVILY_ONLY });

    assert.equal(document.querySelector('[data-testid="wizard-run-provider-selector"]'), null);
    assert.ok(document.querySelector('[data-testid="wizard-lusha-final-search"]'));
  });

  it('fuera de la rama Lusha, la misma capacidad sí muestra Apollo deshabilitado (comportamiento previo intacto)', () => {
    renderValidated({
      capability: CAPABILITY_TAVILY_ONLY,
      lushaCriteria: NOT_LUSHA_ELIGIBLE,
      lushaPreviewEnabled: false,
    });

    const radios = providerRadios();
    assert.equal(radios.length, 2);
    assert.equal(radios.find((r) => r.value === 'apollo_organizations')?.disabled, true);
  });
});

// ── TEST 6 ──────────────────────────────────────────────────────────────────

describe('TEST 6 — ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE=false: comportamiento existente intacto', () => {
  it('la capacidad pura (módulo NO modificado) sigue negando todo con el override apagado', () => {
    // Prueba que este hito no reimplementó la capacidad: se llama a la función
    // real de `wizard-run-provider-capability.ts`, no a un doble.
    const capability = resolveWizardProviderOverrideCapability({
      isAuthenticated: true,
      isAdmin: true,
      runOverrideEnabled: false,
      apolloCompanySearchEnabled: true,
      apolloTwoRoundDiscoveryEnabled: true,
    });
    assert.deepEqual(capability, NO_PROVIDER_OVERRIDE_CAPABILITY);
  });

  it('con esa capacidad, el selector de override no aparece ni dentro de la rama Lusha', () => {
    const capability = resolveWizardProviderOverrideCapability({
      isAuthenticated: true,
      isAdmin: true,
      runOverrideEnabled: false,
      apolloCompanySearchEnabled: true,
      apolloTwoRoundDiscoveryEnabled: true,
    });
    renderValidated({ capability });

    assert.equal(document.querySelector('[data-testid="wizard-run-provider-selector"]'), null);
    assert.ok(document.querySelector('[data-testid="wizard-lusha-final-search"]'));
  });
});

// ── TEST 7 ──────────────────────────────────────────────────────────────────

describe('TEST 7 — en contexto Lusha, la opción sin override no dice "Tavily"', () => {
  it('el radio "sin override" se etiqueta "Automático (usa Lusha)"', () => {
    renderValidated({ capability: CAPABILITY_FULL });

    const labels = providerLabels();
    assert.ok(labels.includes('Automático (usa Lusha)'));
    assert.ok(!labels.includes('Tavily'), 'no debe anunciar un proveedor que no va a ejecutarse');
  });

  it('el value que viaja al elegir esa opción sigue siendo literalmente "tavily"', () => {
    const calls: WizardRunSelectableProvider[] = [];
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      onChange: (p) => calls.push(p),
    });

    const automatic = providerRadios().find((r) => r.value === 'tavily');
    assert.ok(automatic);
    fireEvent.click(automatic!);
    assert.deepEqual(calls, ['tavily']);
  });

  it('fuera de la rama Lusha conserva el label "Tavily" de siempre (sin regresión)', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      lushaCriteria: NOT_LUSHA_ELIGIBLE,
      lushaPreviewEnabled: false,
    });

    assert.ok(providerLabels().includes('Tavily'));
  });
});

// ── TEST 10 ─────────────────────────────────────────────────────────────────

describe('TEST 10 — regresión: sin selección, Lusha sigue siendo la ruta (incluso con capacidad admin)', () => {
  it('con capacidad FULL pero requestedProvider=undefined, Lusha se monta y "Generar prospectos" no aparece', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: undefined });

    assert.ok(document.querySelector('[data-testid="wizard-lusha-final-search"]'));
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });

  it('con capacidad NONE (usuario normal), el resultado es idéntico', () => {
    renderValidated({ capability: CAPABILITY_NONE, requestedProvider: undefined });

    assert.ok(document.querySelector('[data-testid="wizard-lusha-final-search"]'));
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 HALLAZGO-B — el bloqueo que aparece DESPUÉS de elegir Apollo no puede
// retirar el selector.
//
// Escenario del hallazgo, entero: CO · Gobierno (Lusha-elegible) · admin
// autorizado → elige Apollo → Apollo vuelve con BUDGET_EXCEEDED → antes de esta
// corrección `isBudgetBlocked` desmontaba el selector, y como
// `requestedProvider` seguía en `apollo_organizations`, `useLushaFinalSearch`
// seguía en `false`: ni Apollo ni Lusha eran alcanzables y la única salida era
// «Comenzar de nuevo», perdiendo los criterios.
// ═══════════════════════════════════════════════════════════════════════════

// ── B1 ──────────────────────────────────────────────────────────────────────

describe('B1 — Lusha elegible + admin + Apollo seleccionado: el selector está montado', () => {
  it('sin ningún bloqueo, el selector existe con Apollo marcado', () => {
    renderValidated({ capability: CAPABILITY_FULL, requestedProvider: 'apollo_organizations' });

    assert.ok(selectorMounted());
    assert.equal(
      providerRadios().find((r) => r.value === 'apollo_organizations')?.checked,
      true,
    );
  });
});

// ── B2 ──────────────────────────────────────────────────────────────────────

describe('B2 — Apollo seleccionado + BUDGET_EXCEEDED: el selector PERMANECE montado', () => {
  it('el selector sigue en el árbol con el error real del reducer en pantalla', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    // El estado que se está probando es el de verdad: error de presupuesto Y
    // Apollo pedido a la vez. Si cualquiera de los dos faltara, la prueba pasaría
    // sin ejercitar el atrapamiento.
    assert.ok(screen.getByText(BUDGET_EXCEEDED_ERROR.message));
    assert.equal(
      providerRadios().find((r) => r.value === 'apollo_organizations')?.checked,
      true,
    );
    assert.ok(selectorMounted(), 'el control que deshace la elección no puede desaparecer');
  });

  it('«Generar prospectos» SIGUE retirado: el bloqueo no se debilita', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    assert.equal(screen.queryByText('Generar prospectos'), null);
  });

  it('el bloqueo tampoco monta Lusha por su cuenta', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    assert.equal(lushaPanelMounted(), false);
  });
});

// ── B3 ──────────────────────────────────────────────────────────────────────

describe('B3 — tras BUDGET_EXCEEDED, «Automático (usa Lusha)» sigue disponible', () => {
  it('la opción automática existe, habilitada y con el label de Lusha', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    const automatic = providerRadios().find((r) => r.value === 'tavily');
    assert.ok(automatic);
    assert.equal(automatic!.disabled, false);
    assert.ok(providerLabels().includes('Automático (usa Lusha)'));
  });
});

// ── B4 ──────────────────────────────────────────────────────────────────────

describe('B4 — clic en «Automático (usa Lusha)»: la corrida vuelve a la ruta Lusha', () => {
  it('requestedProvider deja de ser Apollo y reaparece la ejecución Lusha', () => {
    render(
      <StatefulOverridePanel
        capability={CAPABILITY_FULL}
        initialProvider="apollo_organizations"
        executionError={BUDGET_EXCEEDED_ERROR}
      />,
    );

    // Punto de partida: el atrapamiento exacto del hallazgo.
    assert.ok(selectorMounted());
    assert.equal(lushaPanelMounted(), false);

    clickAutomaticOption();

    // `useLushaFinalSearch` vuelve a ser true: su única prueba observable es que
    // el panel de Lusha se monta y el de Agente 1 no.
    assert.ok(lushaPanelMounted(), 'la ejecución Lusha debe volver a ofrecerse');
    assert.equal(screen.queryByText('Generar prospectos'), null);
    assert.equal(
      providerRadios().find((r) => r.value === 'tavily')?.checked,
      true,
      'la selección efectiva es la automática, no Apollo',
    );
  });

  it('el cambio lo hizo el clic, no el componente', () => {
    const calls: WizardRunSelectableProvider[] = [];
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
      onChange: (p) => calls.push(p),
    });

    // Montar la pantalla bloqueada no emite NINGUNA petición de proveedor: no hay
    // reset silencioso de `requestedProvider`.
    assert.deepEqual(calls, []);

    clickAutomaticOption();
    assert.deepEqual(calls, ['tavily']);
  });
});

// ── B5 ──────────────────────────────────────────────────────────────────────

describe('B5 — BUDGET_EXCEEDED nunca ejecuta Lusha automáticamente', () => {
  it('con Apollo pedido y el presupuesto agotado no se llama a la acción de Lusha', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    assert.equal(lushaPendingReviewCallCount, 0);
  });

  it('ni siquiera después de volver a Automático: el panel se OFRECE, no se dispara', () => {
    render(
      <StatefulOverridePanel
        capability={CAPABILITY_FULL}
        initialProvider="apollo_organizations"
        executionError={BUDGET_EXCEEDED_ERROR}
      />,
    );
    clickAutomaticOption();

    assert.ok(lushaPanelMounted());
    assert.equal(
      lushaPendingReviewCallCount,
      0,
      'volver a Automático no puede gastar créditos de Lusha por sí solo',
    );
  });
});

// ── B6 ──────────────────────────────────────────────────────────────────────

describe('B6 — bloqueo PREVIO a cualquier selección: comportamiento actual intacto', () => {
  it('rama Lusha sin proveedor elegido y con bloqueo: no se ofrece selector', () => {
    // `requestedProvider === undefined` = el admin no tocó el selector. Aquí el
    // bloqueo no puede ser consecuencia de una elección, así que la regla vieja
    // sigue mandando: si esta pantalla no puede ejecutar, tampoco ofrece elegir.
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: undefined,
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    assert.equal(selectorMounted(), false);
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });

  it('rama Agente 1 con bloqueo de presupuesto PREVIO: ni selector ni botón', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      lushaCriteria: NOT_LUSHA_ELIGIBLE,
      lushaPreviewEnabled: false,
      defaultDiscoveryProvider: 'tavily',
      budgetPreflight: {
        availableCredits: 0,
        requiredCreditsByProvider: { tavily: 20, apollo_organizations: 12 },
      },
    });

    assert.equal(selectorMounted(), false);
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });
});

// ── B7 ──────────────────────────────────────────────────────────────────────

describe('B7 — PERSISTENCE_NOT_READY: el selector sobrevive, la ejecución no', () => {
  it('con Apollo pedido, el selector queda visible y no hay «Generar prospectos»', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      requestedProvider: 'apollo_organizations',
      executionError: PERSISTENCE_NOT_READY_ERROR,
    });

    assert.ok(selectorMounted());
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });

  it('volver a Automático NO abre una vía de ejecución que el bloqueo cerraba', () => {
    // El escritor de Lusha inserta en `prospect_candidates`, la MISMA tabla cuya
    // sonda de persistencia acaba de fallar. Si el panel de Lusha se montara aquí,
    // esta corrección habría creado una ruta de gasto nueva bajo un bloqueo.
    render(
      <StatefulOverridePanel
        capability={CAPABILITY_FULL}
        initialProvider="apollo_organizations"
        executionError={PERSISTENCE_NOT_READY_ERROR}
      />,
    );
    clickAutomaticOption();

    assert.ok(selectorMounted(), 'la usuaria sigue sin quedar atrapada');
    assert.equal(lushaPanelMounted(), false, 'la ruta Lusha respeta el bloqueo de persistencia');
    assert.equal(screen.queryByText('Generar prospectos'), null);
    assert.equal(lushaPendingReviewCallCount, 0);
  });

  it('el banner verde deja de prometer una ejecución que no va a ocurrir', () => {
    render(
      <StatefulOverridePanel
        capability={CAPABILITY_FULL}
        initialProvider="apollo_organizations"
        executionError={PERSISTENCE_NOT_READY_ERROR}
      />,
    );
    clickAutomaticOption();

    assert.ok(
      screen.getByText(
        'Los criterios de la búsqueda son correctos, pero todavía no puede ejecutarse. Revisa el aviso debajo.',
      ),
    );
  });
});

// ── B8 ──────────────────────────────────────────────────────────────────────

describe('B8 — no-admin: el bloqueo no le regala nunca la escotilla hacia Apollo', () => {
  it('capacidad NONE + Apollo forzado + BUDGET_EXCEEDED: sin selector', () => {
    renderValidated({
      capability: CAPABILITY_NONE,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    assert.equal(selectorMounted(), false);
    assert.equal(providerRadios().length, 0);
    // Y como para él nunca hubo override, su ruta sigue siendo Lusha.
    assert.ok(lushaPanelMounted());
  });
});

// ── B9 ──────────────────────────────────────────────────────────────────────

describe('B9 — Apollo deshabilitado por capacidad: tampoco reaparece con el bloqueo', () => {
  it('capacidad sin Apollo + Apollo forzado + BUDGET_EXCEEDED: sin selector', () => {
    renderValidated({
      capability: CAPABILITY_TAVILY_ONLY,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    assert.equal(selectorMounted(), false);
    assert.ok(lushaPanelMounted());
  });
});

// ── B10 ─────────────────────────────────────────────────────────────────────

describe('B10 — override apagado (flag OFF): el bloqueo no abre ninguna puerta', () => {
  it('la capacidad real con runOverrideEnabled=false no monta selector ni con Apollo pedido', () => {
    const capability = resolveWizardProviderOverrideCapability({
      isAuthenticated: true,
      isAdmin: true,
      runOverrideEnabled: false,
      apolloCompanySearchEnabled: true,
      apolloTwoRoundDiscoveryEnabled: true,
    });
    assert.deepEqual(capability, NO_PROVIDER_OVERRIDE_CAPABILITY);

    renderValidated({
      capability,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    assert.equal(selectorMounted(), false);
    assert.ok(lushaPanelMounted());
  });
});

// ── B11 ─────────────────────────────────────────────────────────────────────

describe('B11 — regresión: CO + Gobierno + admin + automático sigue usando Lusha', () => {
  it('sin selección y sin error, la ruta es Lusha y el selector se ofrece intacto', () => {
    renderValidated({ capability: CAPABILITY_FULL });

    assert.ok(lushaPanelMounted());
    assert.ok(selectorMounted());
    assert.equal(screen.queryByText('Generar prospectos'), null);
    assert.ok(
      screen.getByText('Revisa los criterios y ejecuta la búsqueda. Nada se guarda todavía.'),
    );
  });
});

// ── B12 ─────────────────────────────────────────────────────────────────────

describe('B12 — regresión: la rama NO-Lusha conserva su gate literal', () => {
  it('fuera de Lusha, un BUDGET_EXCEEDED sigue retirando selector y botón', () => {
    // La excepción de HALLAZGO-B vive SÓLO en la escotilla de Lusha: en la rama
    // Agente 1 no hay ruta alternativa que rescatar, y ensanchar el gate ahí
    // habría sido un cambio que nadie pidió.
    renderValidated({
      capability: CAPABILITY_FULL,
      lushaCriteria: NOT_LUSHA_ELIGIBLE,
      lushaPreviewEnabled: false,
      requestedProvider: 'apollo_organizations',
      executionError: BUDGET_EXCEEDED_ERROR,
    });

    assert.equal(selectorMounted(), false);
    assert.equal(screen.queryByText('Generar prospectos'), null);
  });

  it('fuera de Lusha y sin bloqueo, todo sigue igual que antes', () => {
    renderValidated({
      capability: CAPABILITY_FULL,
      lushaCriteria: NOT_LUSHA_ELIGIBLE,
      lushaPreviewEnabled: false,
    });

    assert.ok(selectorMounted());
    assert.ok(screen.getByText('Generar prospectos'));
    assert.ok(providerLabels().includes('Tavily'));
  });
});
