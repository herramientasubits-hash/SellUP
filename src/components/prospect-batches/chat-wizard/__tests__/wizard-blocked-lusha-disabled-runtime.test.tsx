/**
 * Q3F-5BB.10C3-FIX-1 (P0-2, STRICT-ALL) — blocked Lusha-disabled RUNTIME contract.
 *
 * Renders the ACTUAL `WizardConversationSummary` at the `validated` step with a
 * `blocked_lusha_disabled` decision AND `executionEnabled: true` (the incident
 * condition) and proves the fail-closed UI:
 *   - a blocked notice is shown;
 *   - the Apollo-capable "Generar prospectos" button is NEVER rendered;
 *   - the Lusha "Buscar con IA" run control is NEVER rendered;
 *   - the positive "La configuración es válida." banner is suppressed;
 *   - only recovery actions (Editar búsqueda / Comenzar de nuevo) remain.
 * No provider is called and no server action module is even loaded on this path.
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

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// The validated panel calls useRouter() at the top (before the blocked early
// return), so next/navigation must be mocked even on the blocked path.
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

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'tech', name: 'Tecnología', slug: 'tech', description: null, sortOrder: 0 },
  ],
  subindustries: [
    {
      id: 'saas',
      industryId: 'tech',
      name: 'Software Empresarial (SaaS / ERP / CRM)',
      slug: 'saas',
      description: null,
      applicableCountries: null,
      sortOrder: 0,
    },
  ],
};

const BLOCKED_DECISION: WizardLushaCriteriaDecision = {
  provider: 'blocked_lusha_disabled',
  reason: 'lusha_preview_disabled',
  input: null,
};

let WizardConversationSummary: (typeof import('../wizard-conversation-summary'))['WizardConversationSummary'];
let createInitialProspectWizardState: (typeof import('@/modules/prospect-batches/chat-wizard'))['createInitialProspectWizardState'];

function makeValidatedState(): ProspectWizardState {
  return {
    ...createInitialProspectWizardState({ catalogVersion: 'v1', defaultRequestedCount: 25 }),
    currentStep: 'validated',
    countryCode: 'CO',
    industryId: 'tech',
    subindustryIds: ['saas'],
    additionalCriteriaRaw: 'empresas de tecnología',
  };
}

function renderBlocked() {
  const noop = () => {};
  const dispatch: React.Dispatch<ProspectWizardAction> = () => {};
  return render(
    React.createElement(WizardConversationSummary, {
      state: makeValidatedState(),
      catalog: CATALOG,
      dispatch,
      onClose: noop,
      // The incident condition: execution IS enabled — the fix must still block.
      executionEnabled: true,
      onExecute: noop,
      onEditSearch: noop,
      // Flag is off: the panel receives lushaPreviewEnabled=false and a
      // blocked_lusha_disabled decision.
      lushaPreviewEnabled: false,
      lushaCriteria: BLOCKED_DECISION,
    }),
  );
}

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  WizardConversationSummary = (await import('../wizard-conversation-summary')).WizardConversationSummary;
  createInitialProspectWizardState = (
    await import('@/modules/prospect-batches/chat-wizard')
  ).createInitialProspectWizardState;
});

afterEach(() => {
  cleanup();
});

describe('WizardConversationSummary — blocked Lusha-disabled (STRICT-ALL)', () => {
  it('renders the fail-closed blocked notice', () => {
    renderBlocked();
    assert.ok(screen.getByTestId('wizard-lusha-blocked-notice'));
    assert.ok(screen.getByText(/no está disponible por ahora/i));
    assert.ok(screen.getByText(/no se ejecutará ninguna generación/i));
  });

  it('NEVER renders the Apollo-capable "Generar prospectos" button', () => {
    renderBlocked();
    assert.equal(
      screen.queryByRole('button', { name: /Generar prospectos/i }),
      null,
      'the Agent 1 / Apollo generation button must not render for a blocked search',
    );
  });

  it('NEVER renders the Lusha "Buscar con IA" run control', () => {
    renderBlocked();
    assert.equal(screen.queryByTestId('lusha-preview-run'), null);
    assert.equal(screen.queryByRole('button', { name: /Buscar con IA/i }), null);
  });

  it('suppresses the positive "La configuración es válida." banner', () => {
    renderBlocked();
    assert.equal(screen.queryByText('La configuración es válida.'), null);
  });

  it('keeps only recovery actions (Editar búsqueda / Comenzar de nuevo)', () => {
    renderBlocked();
    assert.ok(screen.getByRole('button', { name: /Editar búsqueda/i }));
    assert.ok(screen.getByRole('button', { name: /Comenzar de nuevo/i }));
  });
});
