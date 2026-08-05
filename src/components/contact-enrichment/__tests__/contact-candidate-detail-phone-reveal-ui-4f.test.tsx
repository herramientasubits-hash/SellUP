/**
 * Tests — regresión visual del reveal directo, con el flag ENCENDIDO
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4F)
 *
 * Por qué existe este archivo: la suite `test:agent2a:phone-reveal-ui` seguía
 * exigiendo el modal de consentimiento que 4B/4C introdujeron y que 4D eliminó.
 * El guard estático quedó corregido en …-3d4-static.test.ts; aquí se prueba el
 * comportamiento REAL renderizado, que es lo que el guard estático no puede ver.
 *
 * Contrato verificado, con `phoneRevealWaterfallEnabled` = true (flag ON):
 *   1. hay EXACTAMENTE 1 botón «Revelar teléfono»;
 *   2. hay 0 botones «Confirmar y revelar»;
 *   3. hay 0 modales de consentimiento;
 *   4. abrir el drawer crea 0 corridas y llama 0 veces a los proveedores;
 *   5. un clic = UNA sola acción (una corrida, un proveedor, una invocación);
 *   6. dos clics simultáneos (mismo tick) = COMO MÁXIMO una corrida.
 *
 * Las tres modalidades se cubren: waterfall completo (13), Apollo-only (8) y
 * legacy solo-Lusha (5).
 *
 * Render real de React (jsdom + @testing-library/react). NO toca el servidor, NO
 * llama proveedores, NO escribe en DB, NO revela teléfonos y NO consume créditos:
 * los server actions están mockeados.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que las otras suites del drawer) ────────────

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
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  ResizeObserverStub;

if (!dom.window.matchMedia) {
  (dom.window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
    query: string,
  ) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
(globalThis as unknown as { matchMedia: unknown }).matchMedia = dom.window.matchMedia;

for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}

// ── Imports dependientes del entorno DOM ──────────────────────────────────────

import * as React from 'react';
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import type { PhoneRevealWaterfallAuditView } from '@/modules/contact-enrichment/phone-reveal-waterfall-core';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Mocks de boundary ──────────────────────────────────────────────────────

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockReveal = mock.fn<(input: unknown) => Promise<unknown>>();
const mockLushaFallback = mock.fn<(input: unknown) => Promise<unknown>>();
const mockAudit = mock.fn<() => Promise<PhoneRevealWaterfallAuditView | null>>();
const mockLegacyStart = mock.fn<(input: unknown) => Promise<unknown>>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getPendingContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
    approveContactCandidate: async () => ({ ok: true }),
    discardContactCandidate: async () => ({ ok: true }),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-actions', {
  namedExports: {
    revealCandidatePhoneAction: (...args: unknown[]) => mockReveal(...(args as [unknown])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-manual-recovery-actions', {
  namedExports: {
    recoverCandidatePhoneRevealNowAction: async () => ({
      ok: true,
      mode: 'manual_single',
      status: 'still_pending',
    }),
  },
});

mock.module('@/modules/contact-enrichment/lusha-phone-fallback-actions', {
  namedExports: {
    revealCandidatePhoneViaLushaFallbackAction: (...args: unknown[]) =>
      mockLushaFallback(...(args as [unknown])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-actions', {
  namedExports: {
    getPhoneRevealWaterfallAuditAction: (...args: unknown[]) => mockAudit(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions', {
  namedExports: {
    startLegacyPhoneRevealWaterfallAction: (...args: unknown[]) =>
      mockLegacyStart(...(args as [unknown])),
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});

mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures ─────────────────────────────────────────────────────────────────

const REVEAL_LABEL = 'Revelar teléfono';
const CONFIRM_LABEL = 'Confirmar y revelar';

/** Candidato Lusha sin teléfono: pata Lusha posible ⇒ waterfall completo (13). */
function lushaCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-4f',
    full_name: 'Contacto Regresion',
    title: 'Cargo de prueba',
    email: 'regresion@ejemplo.test',
    linkedin_url: null,
    source_contact_id: 'v1.token-opaco',
    phone: null,
    source: 'lusha',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-4f',
    created_at: '2026-08-04T11:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

/** Candidato Apollo: sin id Lusha reutilizable ⇒ Apollo-only (8). */
function apolloCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return lushaCandidate({
    source: 'apollo',
    source_contact_id: '0123456789abcdef01234567',
    ...overrides,
  });
}

/** Candidato legacy: Apollo YA cerró sin teléfono ⇒ ruta solo-Lusha (5). */
function legacyCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return lushaCandidate({
    phone_reveal_status: 'no_phone_found',
    phone_reveal_provider: 'apollo',
    ...overrides,
  });
}

/**
 * Las TRES modalidades del flag ON. Cada invariante se prueba en las tres: una
 * regresión que reintroduzca el modal en una sola de ellas debe romper la suite.
 */
const MODES = [
  { name: 'waterfall completo (13)', candidate: lushaCandidate },
  { name: 'Apollo-only (8)', candidate: apolloCandidate },
  { name: 'legacy solo-Lusha (5)', candidate: legacyCandidate },
] as const;

async function renderSheet(candidate: PendingContactCandidate) {
  mockGetById.mock.mockImplementation(async () => candidate);
  render(
    <ContactCandidateDetailSheet
      candidateId={candidate.id}
      open
      onClose={() => {}}
      phoneRevealEnabled
      phoneRevealAuthorized
      lushaPhoneFallbackEnabled
      lushaPhoneFallbackAuthorized
      phoneRevealWaterfallEnabled
      phoneRevealWaterfallAuthorized
    />,
  );
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function revealButtons() {
  return screen.queryAllByRole('button', { name: REVEAL_LABEL });
}

function confirmButtons() {
  return screen.queryAllByRole('button', { name: CONFIRM_LABEL });
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

/**
 * Total de invocaciones a CUALQUIER superficie capaz de crear una corrida o
 * gastar créditos. Es la métrica de «corridas» observable desde el cliente.
 */
function totalRunStarts(): number {
  return (
    mockReveal.mock.callCount() +
    mockLushaFallback.mock.callCount() +
    mockLegacyStart.mock.callCount()
  );
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, waitFor, cleanup, fireEvent, act } = await import(
    '@testing-library/react'
  ));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  cleanup();
  mockGetById.mock.resetCalls();
  mockReveal.mock.resetCalls();
  mockLushaFallback.mock.resetCalls();
  mockAudit.mock.resetCalls();
  mockLegacyStart.mock.resetCalls();
  mockAudit.mock.mockImplementation(async () => null);
  mockReveal.mock.mockImplementation(async () => ({
    ok: true,
    status: 'requested',
    requestAccepted: true,
    errorCode: null,
  }));
  mockLegacyStart.mock.mockImplementation(async () => ({
    status: 'revealed',
    reason: null,
    maxCreditsAuthorized: 5,
  }));
  mockLushaFallback.mock.mockImplementation(async () => ({
    ok: true,
    status: 'revealed',
    errorCode: null,
  }));
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// 1–3. Un botón, cero «Confirmar y revelar», cero modal
// ═══════════════════════════════════════════════════════════════

describe('4F · flag ON — un botón, sin modal de consentimiento', () => {
  for (const mode of MODES) {
    it(`${mode.name}: exactamente 1 «Revelar teléfono» y 0 «Confirmar y revelar»`, async () => {
      await renderSheet(mode.candidate());
      assert.equal(revealButtons().length, 1);
      assert.equal(confirmButtons().length, 0);
    });

    it(`${mode.name}: el clic NO abre un modal — sigue habiendo 1 botón y 0 confirmación`, async () => {
      await renderSheet(mode.candidate());
      await act(async () => {
        fireEvent.click(revealButtons()[0]);
      });
      assert.equal(confirmButtons().length, 0, 'no puede aparecer «Confirmar y revelar»');
      assert.equal(
        bodyText().includes(CONFIRM_LABEL),
        false,
        'el copy de confirmación no puede aparecer en ningún lugar del DOM',
      );
      assert.equal(
        screen.queryAllByRole('button', { name: 'Cancelar' }).length,
        0,
        'un «Cancelar» delataría un diálogo de confirmación',
      );
    });
  }

  it('el único role="dialog" es el sidepanel; no hay un segundo diálogo de consentimiento', async () => {
    // El SheetContent del drawer TIENE role="dialog": contar diálogos a secas da
    // 1 incluso sin modal. La prueba correcta es que ese diálogo sea el drawer
    // (contiene al candidato) y que no exista ningún OTRO.
    await renderSheet(lushaCandidate());
    const before = screen.queryAllByRole('dialog');
    assert.equal(before.length, 1, 'antes del clic solo existe el sidepanel');

    await act(async () => {
      fireEvent.click(revealButtons()[0]);
    });

    const after = screen.queryAllByRole('dialog');
    assert.equal(after.length, 1, 'el clic no puede añadir un segundo diálogo');
    assert.ok(
      (after[0].textContent ?? '').includes('Contacto Regresion'),
      'el único diálogo debe ser el drawer del candidato, no un modal de consentimiento',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Abrir el drawer no crea corridas
// ═══════════════════════════════════════════════════════════════

describe('4F · flag ON — abrir el drawer no crea corridas', () => {
  for (const mode of MODES) {
    it(`${mode.name}: 0 corridas y 0 llamadas a proveedores solo por abrir`, async () => {
      await renderSheet(mode.candidate());
      assert.equal(totalRunStarts(), 0);
      assert.equal(mockReveal.mock.callCount(), 0);
      assert.equal(mockLushaFallback.mock.callCount(), 0);
      assert.equal(mockLegacyStart.mock.callCount(), 0);
    });
  }

  it('la lectura de la auditoría del waterfall es de SOLO LECTURA', async () => {
    mockAudit.mock.mockImplementation(async () => null);
    await renderSheet(lushaCandidate());
    assert.equal(totalRunStarts(), 0, 'consultar la auditoría no puede crear una corrida');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Un clic = una sola acción
// ═══════════════════════════════════════════════════════════════

describe('4F · flag ON — un clic ejecuta UNA sola acción', () => {
  it('waterfall completo: 1 corrida vía el reveal de Apollo, 0 por las otras vías', async () => {
    await renderSheet(lushaCandidate());
    await act(async () => {
      fireEvent.click(revealButtons()[0]);
    });
    assert.equal(totalRunStarts(), 1);
    assert.equal(mockReveal.mock.callCount(), 1);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
    assert.equal(mockLushaFallback.mock.callCount(), 0);
  });

  it('Apollo-only: 1 corrida, y jamás la ruta legacy', async () => {
    await renderSheet(apolloCandidate());
    await act(async () => {
      fireEvent.click(revealButtons()[0]);
    });
    assert.equal(totalRunStarts(), 1);
    assert.equal(mockReveal.mock.callCount(), 1);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });

  it('legacy: 1 corrida por la acción legacy, y NUNCA el reveal de Apollo', async () => {
    await renderSheet(legacyCandidate());
    await act(async () => {
      fireEvent.click(revealButtons()[0]);
    });
    assert.equal(totalRunStarts(), 1);
    assert.equal(mockLegacyStart.mock.callCount(), 1);
    assert.equal(mockReveal.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Dos clics simultáneos ⇒ como máximo UNA corrida
// ═══════════════════════════════════════════════════════════════

describe('4F · flag ON — dos clics simultáneos crean como máximo una corrida', () => {
  for (const mode of MODES) {
    it(`${mode.name}: dos clics en el MISMO tick ⇒ ≤ 1 corrida`, async () => {
      await renderSheet(mode.candidate());
      const button = revealButtons()[0];
      // Mismo tick: React no ha podido repintar entre ambos, así que `disabled`
      // todavía no protege. El guard real es el ref síncrono de cada handler.
      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      assert.ok(
        totalRunStarts() <= 1,
        `dos clics simultáneos crearon ${totalRunStarts()} corridas`,
      );
      assert.equal(totalRunStarts(), 1, 'y exactamente una debe haber ocurrido');
    });
  }

  it('tres clics simultáneos siguen produciendo una sola corrida', async () => {
    await renderSheet(lushaCandidate());
    const button = revealButtons()[0];
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });
    assert.equal(totalRunStarts(), 1);
  });
});
