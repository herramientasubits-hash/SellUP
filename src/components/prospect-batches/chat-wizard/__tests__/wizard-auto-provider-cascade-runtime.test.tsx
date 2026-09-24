/**
 * wizard-auto-provider-cascade-runtime.test.tsx — el Agente 1 ya no pregunta con
 * qué proveedor buscar. RENDER REAL.
 *
 * AGENT1-AUTO-PROVIDER-CASCADE-1 — decisión de producto del 2026-09-24: Apollo
 * es el principal y Lusha el respaldo automático. Con el modo automático:
 *
 *   · Colombia · Gobierno (Lusha-elegible) ya NO abre el panel aparte de Lusha
 *     («Buscar con IA»): ofrece «Generar prospectos», que va a Apollo y sigue
 *     con Lusha si Apollo no alcanza;
 *   · no existe el selector «Proveedor de esta corrida», aunque la usuaria sea
 *     administradora;
 *   · la pantalla dice cómo va a buscar, y avisa cuando el respaldo no podrá
 *     correr porque no quedan créditos internos.
 *
 * Sin el modo automático, la pantalla es la de siempre.
 *
 * Acciones de servidor mockeadas: 0 llamadas a Apollo, Lusha o Supabase.
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
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';
import type { WizardBudgetPreflight } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';

let render: (typeof import('@testing-library/react'))['render'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

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

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [{ id: 'ind-1', name: 'Gobierno', slug: 'gobierno', description: null } as never],
  subindustries: [],
} as unknown as ActiveIndustryCatalog;

// Colombia · Gobierno: Lusha-elegible, la misma forma que usa la prueba de la
// escotilla Lusha → Apollo.
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

const CAPABILITY_ADMIN: WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: true,
  allowedProviders: ['tavily', 'apollo_organizations'],
};

function validatedState(
  executionError: { code: string; message: string; retryable: boolean } | null = null,
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

function renderValidated(options: {
  autoProviderCascade: boolean;
  capability?: WizardProviderOverrideCapability;
  budgetPreflight?: WizardBudgetPreflight | null;
  defaultDiscoveryProvider?: WizardRunSelectableProvider | null;
  executionError?: { code: string; message: string; retryable: boolean } | null;
  onExecute?: () => void;
}) {
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
      lushaPreviewEnabled
      lushaCriteria={LUSHA_ELIGIBLE}
      providerOverrideCapability={options.capability ?? CAPABILITY_ADMIN}
      apolloRunModeLimits={null}
      requestedProvider={undefined}
      onRequestedProviderChange={() => {}}
      showApolloTwoRoundStages={false}
      twoRoundOutcome={null}
      budgetPreflight={options.budgetPreflight ?? null}
      defaultDiscoveryProvider={options.defaultDiscoveryProvider ?? 'apollo_organizations'}
      autoProviderCascade={options.autoProviderCascade}
    />,
  );
}

const q = (testId: string) => document.querySelector(`[data-testid="${testId}"]`);
const generateButton = () =>
  Array.from(document.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes('Generar prospectos'),
  );

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  fireEvent = rtl.fireEvent;
  cleanup = rtl.cleanup;
  ({ WizardConversationSummary } = await import('../wizard-conversation-summary'));
});
beforeEach(() => {
  document.body.innerHTML = '';
  lushaPendingReviewCallCount = 0;
});
afterEach(() => cleanup());

describe('§ 1 — modo automático: sin elección de proveedor', () => {
  it('🔴 una búsqueda Lusha-elegible ya no abre el panel aparte de Lusha', () => {
    renderValidated({ autoProviderCascade: true });
    assert.equal(q('wizard-lusha-final-search'), null);
  });

  it('🔴 no hay selector de proveedor, ni siquiera para una administradora', () => {
    renderValidated({ autoProviderCascade: true, capability: CAPABILITY_ADMIN });
    assert.equal(q('wizard-run-provider-selector'), null);
  });

  it('ofrece «Generar prospectos» y dice cómo va a buscar', () => {
    renderValidated({ autoProviderCascade: true });
    assert.ok(generateButton(), '«Generar prospectos» debe estar');
    const notice = q('wizard-auto-provider-notice');
    assert.ok(notice, 'el aviso de búsqueda automática debe estar');
    assert.match(notice!.textContent ?? '', /primero con Apollo/);
    assert.match(notice!.textContent ?? '', /Lusha/);
  });

  it('el clic ejecuta la corrida única; no llama a la acción aparte de Lusha', () => {
    let executed = 0;
    renderValidated({ autoProviderCascade: true, onExecute: () => (executed += 1) });
    fireEvent.click(generateButton()!);
    assert.equal(executed, 1);
    assert.equal(lushaPendingReviewCallCount, 0);
  });
});

describe('§ 2 — el aviso del respaldo dice la verdad sobre el presupuesto', () => {
  it('sin créditos internos para Lusha, lo avisa; Apollo sigue ofreciéndose', () => {
    renderValidated({
      autoProviderCascade: true,
      budgetPreflight: {
        availableCredits: 0,
        requiredCreditsByProvider: { tavily: 20 },
        lushaRequiredCredits: 2,
      } as WizardBudgetPreflight,
    });
    assert.ok(q('wizard-auto-provider-lusha-blocked'));
    // Apollo no se financia con el pool interno: no lo bloquea.
    assert.ok(generateButton());
  });

  it('con créditos suficientes no avisa nada de más', () => {
    renderValidated({
      autoProviderCascade: true,
      budgetPreflight: {
        availableCredits: 10,
        requiredCreditsByProvider: { tavily: 20 },
        lushaRequiredCredits: 2,
      } as WizardBudgetPreflight,
    });
    assert.ok(q('wizard-auto-provider-notice'));
    assert.equal(q('wizard-auto-provider-lusha-blocked'), null);
  });

  it('sin instantánea de presupuesto no se afirma que Lusha no pueda correr', () => {
    renderValidated({ autoProviderCascade: true, budgetPreflight: null });
    assert.equal(q('wizard-auto-provider-lusha-blocked'), null);
  });

  it('con el almacenamiento bloqueado no se anuncia una búsqueda que no puede correr', () => {
    renderValidated({
      autoProviderCascade: true,
      executionError: { code: 'PERSISTENCE_NOT_READY', message: 'no', retryable: false },
    });
    assert.equal(q('wizard-auto-provider-notice'), null);
    assert.equal(generateButton(), undefined);
  });
});

describe('§ 3 — sin el modo automático, la pantalla de siempre', () => {
  it('la búsqueda Lusha-elegible sigue abriendo el panel de Lusha y no hay aviso', () => {
    renderValidated({ autoProviderCascade: false });
    assert.ok(q('wizard-lusha-final-search'));
    assert.equal(q('wizard-auto-provider-notice'), null);
  });
});
