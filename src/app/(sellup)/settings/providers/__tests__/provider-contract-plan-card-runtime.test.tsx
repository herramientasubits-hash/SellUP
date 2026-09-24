/**
 * SETTINGS-PROVIDER-CONTRACT-PLAN-1 — «Plan contratado», RENDER REAL, y la
 * etiqueta de la cuota de Lusha. Sin red, sin Supabase.
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
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderContractPlanView } from '@/modules/budgets/provider-contract-plan';

let render: (typeof import('@testing-library/react'))['render'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let Card: (typeof import('../provider-contract-plan-card'))['ProviderContractPlanCard'];
let monthlyCreditsLabel: (typeof import('../provider-contract-plan-card'))['monthlyCreditsLabel'];
let buildView: (typeof import('@/modules/budgets/provider-contract-plan'))['buildProviderContractPlanView'];

const NOW = new Date('2026-09-24T17:00:00Z');

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  cleanup = rtl.cleanup;
  ({ ProviderContractPlanCard: Card, monthlyCreditsLabel } =
    await import('../provider-contract-plan-card'));
  ({ buildProviderContractPlanView: buildView } =
    await import('@/modules/budgets/provider-contract-plan'));
});
afterEach(() => cleanup());

function plan(overrides: Partial<Parameters<typeof buildView>[0]>): ProviderContractPlanView {
  const view = buildView({
    providerKey: 'apollo',
    activeUnitCostUsd: 0.00867168,
    activeUnitCostEffectiveFrom: '2026-09-24',
    creditsRemaining: 4355,
    creditsRemainingSyncedAt: '2026-09-24T17:18:22Z',
    renewalDate: '2026-10-13',
    now: NOW,
    ...overrides,
  });
  assert.ok(view);
  return view;
}

const text = (testId: string) =>
  document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';

describe('«Plan contratado» — render real', () => {
  it('Apollo: contrato anual, precio, lo que queda y la renovación', () => {
    render(<Card plan={plan({})} />);
    const all = text('provider-contract-plan');
    assert.match(all, /Anual/);
    assert.match(all, /484,335 cr \/ año/);
    assert.match(all, /\$4200\.00 USD \/ año/);
    assert.match(text('provider-contract-plan-price'), /\$0\.00867 USD/);
    assert.match(text('provider-contract-plan-remaining'), /4,355 cr/);
    assert.match(text('provider-contract-plan-renewal'), /en 19 días/);
    assert.equal(
      document.querySelector('[data-testid="provider-contract-plan-price-mismatch"]'),
      null,
    );
  });

  it('🔴 un precio activo distinto del contrato se avisa', () => {
    render(
      <Card
        plan={plan({ providerKey: 'lusha', activeUnitCostUsd: 0.08823529, renewalDate: null })}
      />,
    );
    assert.match(text('provider-contract-plan-price-mismatch'), /\$0\.08824 USD por crédito/);
    assert.match(text('provider-contract-plan-renewal'), /Sin configurar/);
  });

  it('sin sincronizar lo dice, en vez de mostrar 0', () => {
    render(<Card plan={plan({ creditsRemaining: null })} />);
    assert.match(text('provider-contract-plan-remaining'), /Sin sincronizar/);
  });
});

describe('mismo formato numérico que el bloque de cuota', () => {
  it('🔴 créditos con el separador de toLocaleString() y USD con toFixed, como el resto del panel', () => {
    render(
      <Card plan={plan({ providerKey: 'lusha', creditsRemaining: 4988, renewalDate: null })} />,
    );
    const all = text('provider-contract-plan');
    assert.ok(all.includes(`${(61_200).toLocaleString()} cr / año`));
    assert.ok(all.includes(`${(4988).toLocaleString()} cr`));
    assert.ok(all.includes('$4174.57 USD / año'));
  });
});

describe('la cuota de Lusha por API deja de rotularse «mensual»', () => {
  it('🔴 Lusha sincronizada por API ⇒ «Créditos del plan (API)»', () => {
    assert.equal(
      monthlyCreditsLabel({ providerKey: 'lusha', quotaSource: 'api_synced' }),
      'Créditos del plan (API)',
    );
  });
  it('el resto sigue siendo mensual', () => {
    assert.equal(
      monthlyCreditsLabel({ providerKey: 'lusha', quotaSource: 'manual' }),
      'Créditos mensuales',
    );
    assert.equal(
      monthlyCreditsLabel({ providerKey: 'apollo', quotaSource: 'manual' }),
      'Créditos mensuales',
    );
    assert.equal(
      monthlyCreditsLabel({ providerKey: 'tavily', quotaSource: 'api_synced' }),
      'Créditos mensuales',
    );
  });
});
