/**
 * AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — ruta de Lusha bloqueada, RUNTIME.
 *
 * Renderiza el `WizardConversationSummary` REAL en el paso `validated` con una
 * decisión `blocked_lusha_disabled` y `executionEnabled: true` — exactamente el
 * caso que la QA visual reportó (Colombia + Salud + tres subindustrias, flag de
 * Lusha apagado).
 *
 * Antes de este hito esa combinación mostraba «La generación con estos criterios no
 * está disponible por ahora / Esta búsqueda utiliza un proveedor que todavía no está
 * habilitado» y retiraba el selector de proveedor y «Generar prospectos», dejando la
 * búsqueda sin ninguna forma de ejecutarse aunque Tavily y Apollo estuvieran
 * desplegados, configurados y con presupuesto.
 *
 * Lo que este archivo fija ahora:
 *   - el discovery de Agente 1 SÍ se ofrece: «Generar prospectos» y el selector de
 *     proveedor (con Apollo elegible) se renderizan;
 *   - Lusha NUNCA corre con el flag apagado: su control «Buscar con IA» no existe
 *     en el árbol — la propiedad de seguridad de Q3F-5BB.10C3-FIX-1, intacta;
 *   - no se pinta ningún aviso de indisponibilidad, porque no la hay.
 * Ningún proveedor se llama y ninguna acción de servidor se carga en esta ruta.
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
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type {
  ProspectWizardState,
  ProspectWizardAction,
} from '@/modules/prospect-batches/chat-wizard';
import type { WizardLushaCriteriaDecision } from '@/modules/prospect-batches/wizard-lusha-criteria';
import type { WizardProviderOverrideCapability } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// El panel validado llama useRouter() en su cuerpo, así que next/navigation debe
// estar doblado.
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

/** Catálogo del caso real de QA: Salud + tres subindustrias. */
const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'ind-health', name: 'Salud', slug: 'salud', description: null, sortOrder: 0 },
  ],
  subindustries: [
    {
      id: 'sub-hosp',
      industryId: 'ind-health',
      name: 'Redes Hospitalarias y Clínicas',
      slug: 'redes-hospitalarias-y-clinicas',
      description: null,
      applicableCountries: null,
      sortOrder: 0,
    },
    {
      id: 'sub-lab',
      industryId: 'ind-health',
      name: 'Laboratorios Clínicos y Diagnóstico',
      slug: 'laboratorios-clinicos-y-diagnostico',
      description: null,
      applicableCountries: null,
      sortOrder: 1,
    },
    {
      id: 'sub-eps',
      industryId: 'ind-health',
      name: 'Medicina Prepagada y EPS',
      slug: 'medicina-prepagada-y-eps',
      description: null,
      applicableCountries: null,
      sortOrder: 2,
    },
  ],
};

const BLOCKED_DECISION: WizardLushaCriteriaDecision = {
  provider: 'blocked_lusha_disabled',
  reason: 'lusha_preview_disabled',
  input: null,
};

/** Capacidad de un admin con los tres candados de Apollo encendidos. */
const ADMIN_CAPABILITY: WizardProviderOverrideCapability = {
  canSelectDiscoveryProvider: true,
  allowedProviders: ['tavily', 'apollo_organizations'],
};

let WizardConversationSummary: (typeof import('../wizard-conversation-summary'))['WizardConversationSummary'];
let createInitialProspectWizardState: (typeof import('@/modules/prospect-batches/chat-wizard'))['createInitialProspectWizardState'];

function makeValidatedState(): ProspectWizardState {
  return {
    ...createInitialProspectWizardState({ catalogVersion: 'v1', defaultRequestedCount: 25 }),
    currentStep: 'validated',
    searchMode: 'exploratory',
    countryCode: 'CO',
    industryId: 'ind-health',
    subindustryIds: ['sub-hosp', 'sub-lab', 'sub-eps'],
    additionalCriteriaRaw: null,
  };
}

function renderBlocked(withProviderSurface = false) {
  const noop = () => {};
  const dispatch: React.Dispatch<ProspectWizardAction> = () => {};
  return render(
    React.createElement(WizardConversationSummary, {
      state: makeValidatedState(),
      catalog: CATALOG,
      dispatch,
      onClose: noop,
      executionEnabled: true,
      onExecute: noop,
      onEditSearch: noop,
      // El flag está apagado: llega `lushaPreviewEnabled=false` y una decisión
      // `blocked_lusha_disabled`.
      lushaPreviewEnabled: false,
      lushaCriteria: BLOCKED_DECISION,
      ...(withProviderSurface
        ? {
            providerOverrideCapability: ADMIN_CAPABILITY,
            requestedProvider: undefined,
            onRequestedProviderChange: noop,
          }
        : {}),
    }),
  );
}

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  WizardConversationSummary = (await import('../wizard-conversation-summary')).WizardConversationSummary;
  // Especificador relativo (no el alias `@/`): con module-mocks el loader dinámico
  // no aplica los path aliases de tsconfig.
  createInitialProspectWizardState = (
    await import('../../../../modules/prospect-batches/chat-wizard')
  ).createInitialProspectWizardState;
});

afterEach(() => {
  cleanup();
});

describe('WizardConversationSummary — Lusha apagado NO bloquea el discovery de Agente 1', () => {
  it('renderiza «Generar prospectos»', () => {
    renderBlocked();
    assert.ok(
      screen.getByRole('button', { name: /Generar prospectos/i }),
      'el discovery de Agente 1 debe ofrecerse cuando el proveedor oculto no participa',
    );
  });

  it('no pinta el aviso viejo de «proveedor que todavía no está habilitado»', () => {
    renderBlocked();
    assert.equal(screen.queryByTestId('wizard-lusha-blocked-notice'), null);
    assert.equal(screen.queryByText(/no está disponible por ahora/i), null);
    assert.equal(screen.queryByText(/todavía no está habilitado/i), null);
  });

  it('no pinta ningún aviso de indisponibilidad: no la hay', () => {
    renderBlocked();
    assert.equal(screen.queryByTestId('wizard-discovery-unavailable-notice'), null);
  });

  it('conserva el banner de configuración válida', () => {
    renderBlocked();
    assert.ok(screen.getByText('La configuración es válida.'));
  });

  it('ofrece el selector de proveedor con Apollo elegible para un admin', () => {
    renderBlocked(true);
    assert.ok(screen.getByTestId('wizard-run-provider-selector'));
    const apollo = screen
      .getByTestId('wizard-run-provider-selector')
      .querySelector<HTMLInputElement>('input[value="apollo_organizations"]');
    assert.ok(apollo, 'la opción Apollo debe existir');
    assert.equal(apollo.disabled, false, 'Apollo debe ser elegible');
    // Y no se anuncia como no disponible.
    assert.equal(screen.queryByTestId('wizard-run-provider-apollo-unavailable'), null);
  });

  it('NUNCA renderiza el control de Lusha «Buscar con IA» (STRICT-ALL intacto)', () => {
    renderBlocked(true);
    assert.equal(screen.queryByTestId('lusha-preview-run'), null);
    assert.equal(screen.queryByRole('button', { name: /Buscar con IA/i }), null);
  });

  it('conserva las acciones de recuperación', () => {
    renderBlocked();
    assert.ok(screen.getByRole('button', { name: /Editar búsqueda/i }));
    assert.ok(screen.getByRole('button', { name: /Comenzar de nuevo/i }));
  });
});
