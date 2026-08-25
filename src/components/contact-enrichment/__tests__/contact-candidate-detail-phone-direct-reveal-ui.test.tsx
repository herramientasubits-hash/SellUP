/**
 * Tests — acción DIRECTA de revelar teléfono, sin modal
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-4D)
 *
 * Contrato que se verifica, punto por punto:
 *   * no existe modal ni botón «Confirmar y revelar»;
 *   * hay EXACTAMENTE un botón «Revelar teléfono»;
 *   * abrir el drawer no crea corrida ni llama a ningún proveedor;
 *   * un clic normal crea UNA corrida y llama a Apollo UNA vez;
 *   * `no_phone_found` de Apollo continúa a Lusha SIN acción del cliente;
 *   * legacy: Lusha una vez, Apollo cero;
 *   * sin id Lusha: solo Apollo, tope 8, sin mencionar Lusha ni 13;
 *   * saldo insuficiente: copy exacto, sin recargar el candidato (no se escribió nada);
 *   * dos clics concurrentes ⇒ UNA sola corrida;
 *   * un actor SIN permiso de revelar no alcanza Lusha;
 *   * flag OFF conserva el flujo histórico;
 *   * los costos de las dos patas nunca se suman en una sola cifra.
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
    getReviewableContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
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
/**
 * Etiqueta del botón ÚNICO en la modalidad LEGACY
 * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1 § 8). Sigue siendo UN botón —lo
 * que esta suite protege— pero nombra al proveedor que de verdad se va a consultar: en
 * esa modalidad Apollo ya se agotó y NO se vuelve a llamar.
 */
const LEGACY_REVEAL_LABEL = 'Buscar teléfono con Lusha';
const CONFIRM_LABEL = 'Confirmar y revelar';
const LUSHA_BUTTON_LABEL = 'Revelar teléfono con Lusha';

const INSUFFICIENT_CREDITS_COPY =
  'No hay créditos suficientes para realizar esta revelación.';

/** Candidato Lusha sin teléfono: pata Lusha posible ⇒ waterfall completo (13). */
function lushaCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-4d',
    full_name: 'Contacto Directo',
    title: 'Cargo de prueba',
    email: 'directo@ejemplo.test',
    linkedin_url: null,
    source_contact_id: 'v1.token-opaco',
    // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-2 — identidad de supresión EVALUABLE.
    // Desde PR #289 un candidato sin `provider_person_id` Apollo resoluble no puede
    // revelar (el backend bloquea fail-closed) y la UI deshabilita el botón. Esta
    // suite prueba OTRO contrato, así que se le da una identidad sintética evaluable
    // en vez de re-especificar cada caso. La resolución de identidad tiene sus
    // propias suites: phone-reveal-identity-eligibility(.test.ts / -ui.test.tsx).
    apollo_person_id: '0123456789abcdef01234567',
    phone: null,
    source: 'lusha',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-4d',
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

/** Candidato legacy: Apollo YA cerró sin teléfono, con evidencia canónica. */
function legacyCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  // `phone_reveal_completed_at` no viaja en la proyección del drawer (el servidor lo
  // exige contra las columnas canónicas), así que aquí solo se fija lo que la UI ve.
  return lushaCandidate({
    phone_reveal_status: 'no_phone_found',
    phone_reveal_provider: 'apollo',
    ...overrides,
  });
}

function auditView(
  overrides: Partial<PhoneRevealWaterfallAuditView> = {},
): PhoneRevealWaterfallAuditView {
  return {
    status: 'apollo_in_flight',
    runMode: 'full_waterfall',
    isTerminal: false,
    errorCode: null,
    maxCreditsAuthorized: 13,
    apolloAttempted: true,
    apolloOutcome: null,
    apolloCostCredits: null,
    apolloCostSource: null,
    lushaEligible: true,
    lushaAttempted: false,
    lushaSkippedReason: null,
    lushaOutcome: null,
    lushaCostCredits: null,
    lushaCostSource: null,
    finalProvider: null,
    ...overrides,
  };
}

interface RenderProps {
  waterfallEnabled?: boolean;
  waterfallAuthorized?: boolean;
  lushaFallbackEnabled?: boolean;
  lushaFallbackAuthorized?: boolean;
}

async function renderSheet(
  candidate: PendingContactCandidate,
  props: RenderProps = {},
) {
  mockGetById.mock.mockImplementation(async () => candidate);
  render(
    <ContactCandidateDetailSheet
      candidateId={candidate.id}
      open
      onClose={() => {}}
      phoneRevealEnabled
      phoneRevealAuthorized
      lushaPhoneFallbackEnabled={props.lushaFallbackEnabled ?? true}
      lushaPhoneFallbackAuthorized={props.lushaFallbackAuthorized ?? true}
      phoneRevealWaterfallEnabled={props.waterfallEnabled ?? true}
      phoneRevealWaterfallAuthorized={props.waterfallAuthorized ?? true}
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

/**
 * El botón ÚNICO del waterfall, en cualquiera de sus dos etiquetas. Coincidencia
 * EXACTA en las dos, así que un mismo botón no puede contarse dos veces y el botón
 * manual de Lusha del flujo previo (`LUSHA_BUTTON_LABEL`) nunca entra aquí.
 */
function revealButtons() {
  return [
    ...screen.queryAllByRole('button', { name: REVEAL_LABEL }),
    ...screen.queryAllByRole('button', { name: LEGACY_REVEAL_LABEL }),
  ];
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

async function clickReveal() {
  const buttons = revealButtons();
  assert.equal(buttons.length, 1, 'debe haber EXACTAMENTE un botón «Revelar teléfono»');
  await act(async () => {
    fireEvent.click(buttons[0]);
  });
}

/** Total de invocaciones a CUALQUIER superficie que pueda gastar créditos. */
function totalProviderCalls(): number {
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
// 1. No hay modal
// ═══════════════════════════════════════════════════════════════

describe('4D — no hay modal en ninguna modalidad', () => {
  it('nunca aparece «Confirmar y revelar»: ni al abrir, ni al hacer clic', async () => {
    for (const candidate of [lushaCandidate(), apolloCandidate(), legacyCandidate()]) {
      cleanup();
      mockReveal.mock.resetCalls();
      mockLegacyStart.mock.resetCalls();
      await renderSheet(candidate);
      assert.equal(
        screen.queryByRole('button', { name: CONFIRM_LABEL }),
        null,
        `antes del clic (${candidate.source}/${candidate.phone_reveal_status})`,
      );
      await clickReveal();
      assert.equal(
        screen.queryByRole('button', { name: CONFIRM_LABEL }),
        null,
        `después del clic (${candidate.source}/${candidate.phone_reveal_status})`,
      );
    }
  });

  it('tampoco aparece un botón «Cancelar» del waterfall', async () => {
    await renderSheet(lushaCandidate());
    assert.equal(screen.queryByRole('button', { name: 'Cancelar' }), null);
    await clickReveal();
    assert.equal(screen.queryByRole('button', { name: 'Cancelar' }), null);
  });

  it('hay EXACTAMENTE un botón «Revelar teléfono» y ningún segundo botón de Lusha', async () => {
    await renderSheet(lushaCandidate());
    assert.equal(revealButtons().length, 1);
    assert.equal(screen.queryByRole('button', { name: LUSHA_BUTTON_LABEL }), null);
  });

  it('también hay UN solo botón en la modalidad legacy', async () => {
    await renderSheet(legacyCandidate());
    assert.equal(revealButtons().length, 1);
    assert.equal(screen.queryByRole('button', { name: LUSHA_BUTTON_LABEL }), null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Abrir el drawer no tiene efectos
// ═══════════════════════════════════════════════════════════════

describe('4D — abrir el drawer no crea corrida ni llama proveedores', () => {
  it('cero llamadas a cualquier superficie que pueda gastar', async () => {
    for (const candidate of [lushaCandidate(), apolloCandidate(), legacyCandidate()]) {
      cleanup();
      mockReveal.mock.resetCalls();
      mockLushaFallback.mock.resetCalls();
      mockLegacyStart.mock.resetCalls();
      await renderSheet(candidate);
      assert.equal(totalProviderCalls(), 0, `${candidate.source}`);
    }
  });

  it('la lectura de la auditoría es de SOLO LECTURA: no crea nada', async () => {
    mockAudit.mock.mockImplementation(async () => auditView());
    await renderSheet(lushaCandidate({ phone_reveal_status: 'requested' }));
    assert.ok(mockAudit.mock.callCount() >= 1, 'la auditoría se consulta');
    assert.equal(totalProviderCalls(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Un clic = una corrida
// ═══════════════════════════════════════════════════════════════

describe('4D — un clic crea una corrida y llama a Apollo una vez', () => {
  it('waterfall completo: una invocación con expectedMaxCredits=13', async () => {
    await renderSheet(lushaCandidate());
    await clickReveal();
    assert.equal(mockReveal.mock.callCount(), 1);
    const payload = mockReveal.mock.calls[0].arguments[0] as {
      candidateId: string;
      expectedMaxCredits: number;
    };
    assert.equal(payload.expectedMaxCredits, 13);
    assert.equal(payload.candidateId, 'cand-4d');
    // Y el cliente NO llama a Lusha por su cuenta en ningún caso.
    assert.equal(mockLushaFallback.mock.callCount(), 0);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });

  it('el copy de la acción es exactamente el del contrato (13 créditos)', async () => {
    await renderSheet(lushaCandidate());
    assert.ok(
      bodyText().includes(
        'Apollo se intentará primero. Si no encuentra un teléfono, SellUp intentará Lusha automáticamente. Puede consumir hasta 13 créditos.',
      ),
      bodyText(),
    );
  });

  it('dos clics concurrentes (mismo tick) crean UNA sola corrida', async () => {
    await renderSheet(lushaCandidate());
    const button = revealButtons()[0];
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    assert.equal(mockReveal.mock.callCount(), 1, 'el guard síncrono corta el segundo');
  });

  it('mientras la solicitud está en vuelo el estado dice «Solicitando revelación…»', async () => {
    let resolveReveal: ((value: unknown) => void) | null = null;
    mockReveal.mock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReveal = resolve;
        }),
    );
    await renderSheet(lushaCandidate());
    await act(async () => {
      fireEvent.click(revealButtons()[0]);
    });
    assert.ok(bodyText().includes('Solicitando revelación…'), bodyText());
    await act(async () => {
      resolveReveal?.({
        ok: true,
        status: 'requested',
        requestAccepted: true,
        errorCode: null,
      });
      await Promise.resolve();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Apollo sin teléfono ⇒ Lusha automático (server-side)
// ═══════════════════════════════════════════════════════════════

describe('4D — la continuación a Lusha es automática y del servidor', () => {
  it('con la pata Lusha en curso el copy lo dice, sin pedir ninguna acción', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({ status: 'lusha_running', apolloOutcome: 'no_phone_found' }),
    );
    await renderSheet(lushaCandidate({ phone_reveal_status: 'no_phone_found' }));
    assert.ok(
      bodyText().includes('Apollo no encontró un teléfono. SellUp está intentando Lusha.'),
      bodyText(),
    );
    // Nadie tuvo que pulsar nada, y el cliente no invocó a Lusha.
    assert.equal(totalProviderCalls(), 0);
    // Tampoco reaparece un botón para "continuar": no hay segundo clic.
    assert.equal(revealButtons().length, 0);
    assert.equal(screen.queryByRole('button', { name: LUSHA_BUTTON_LABEL }), null);
  });

  it('tras `no_phone_found` de Apollo NO se ofrece un disparo manual de Lusha', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'lusha_pending',
        apolloOutcome: 'no_phone_found',
      }),
    );
    await renderSheet(lushaCandidate({ phone_reveal_status: 'no_phone_found' }));
    assert.equal(screen.queryByRole('button', { name: LUSHA_BUTTON_LABEL }), null);
    assert.equal(totalProviderCalls(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Legacy: Lusha una vez, Apollo cero
// ═══════════════════════════════════════════════════════════════

describe('4D — modalidad legacy', () => {
  it('un clic invoca la acción legacy UNA vez y NUNCA el reveal de Apollo', async () => {
    await renderSheet(legacyCandidate());
    await clickReveal();
    assert.equal(mockLegacyStart.mock.callCount(), 1);
    assert.equal(mockReveal.mock.callCount(), 0, 'cero Apollo');
    assert.equal(mockLushaFallback.mock.callCount(), 0, 'cero fallback manual');
  });

  it('el copy legacy es exactamente el del contrato (5 créditos)', async () => {
    await renderSheet(legacyCandidate());
    assert.ok(
      bodyText().includes(
        'Apollo ya fue intentado. SellUp intentará Lusha automáticamente. Puede consumir hasta 5 créditos.',
      ),
      bodyText(),
    );
    assert.equal(/13/.test(bodyText()), false, bodyText());
  });

  it('dos clics concurrentes en legacy crean UNA sola corrida', async () => {
    await renderSheet(legacyCandidate());
    const button = revealButtons()[0];
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    assert.equal(mockLegacyStart.mock.callCount(), 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Sin id Lusha: Apollo-only
// ═══════════════════════════════════════════════════════════════

describe('4D — candidato sin pata Lusha ejecutable', () => {
  it('copy exacto de 8 créditos, sin nombrar Lusha ni 13', async () => {
    await renderSheet(apolloCandidate());
    const text = bodyText();
    assert.ok(
      text.includes('Consulta individual con Apollo. Puede consumir hasta 8 créditos.'),
      text,
    );
    assert.equal(/Lusha/.test(text), false, text);
    assert.equal(/13/.test(text), false, text);
  });

  it('un clic ejecuta Apollo-only con expectedMaxCredits=8', async () => {
    await renderSheet(apolloCandidate());
    await clickReveal();
    assert.equal(mockReveal.mock.callCount(), 1);
    const payload = mockReveal.mock.calls[0].arguments[0] as {
      expectedMaxCredits: number;
    };
    assert.equal(payload.expectedMaxCredits, 8);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
    assert.equal(mockLushaFallback.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Saldo insuficiente
// ═══════════════════════════════════════════════════════════════

/**
 * El servidor comprueba el saldo ANTES de crear la corrida (probado en el core), así
 * que lo que le toca a la UI es: mostrar el copy exacto, NO recargar el candidato —no
 * se escribió nada— y dejar el botón disponible para más tarde.
 */
describe('4D — saldo insuficiente', () => {
  const INSUFFICIENT = {
    ok: false,
    status: 'insufficient_credits',
    requestAccepted: false,
    errorCode: 'insufficient_credits',
  };

  it('waterfall de 13 bloqueado: copy exacto y sin recarga del candidato', async () => {
    mockReveal.mock.mockImplementation(async () => INSUFFICIENT);
    await renderSheet(lushaCandidate());
    const loadsBefore = mockGetById.mock.callCount();
    await clickReveal();
    assert.ok(bodyText().includes(INSUFFICIENT_CREDITS_COPY), bodyText());
    assert.equal(
      mockGetById.mock.callCount(),
      loadsBefore,
      'sin escrituras no hay nada nuevo que releer',
    );
  });

  it('Apollo-only de 8 bloqueado con el mismo copy', async () => {
    mockReveal.mock.mockImplementation(async () => INSUFFICIENT);
    await renderSheet(apolloCandidate());
    await clickReveal();
    assert.ok(bodyText().includes(INSUFFICIENT_CREDITS_COPY), bodyText());
  });

  it('legacy bloqueado: el copy llega por la acción legacy', async () => {
    mockLegacyStart.mock.mockImplementation(async () => ({
      status: 'insufficient_credits',
      reason: 'insufficient_credits',
      maxCreditsAuthorized: null,
    }));
    await renderSheet(legacyCandidate());
    await clickReveal();
    assert.ok(bodyText().includes(INSUFFICIENT_CREDITS_COPY), bodyText());
  });

  it('el error es VISIBLE en pantalla y el botón queda disponible para reintentar', async () => {
    mockReveal.mock.mockImplementation(async () => INSUFFICIENT);
    await renderSheet(lushaCandidate());
    await clickReveal();
    const destructive = Array.from(document.querySelectorAll('.text-destructive')).map(
      (el) => (el.textContent ?? '').replace(/\s+/g, ' '),
    );
    assert.ok(
      destructive.some((t) => t.includes(INSUFFICIENT_CREDITS_COPY)),
      destructive.join(' | '),
    );
    const button = revealButtons()[0];
    assert.ok(button);
    assert.equal((button as HTMLButtonElement).disabled, false);
  });

  it('NO se presenta como "no se encontró teléfono" ni como error de Apollo', async () => {
    mockReveal.mock.mockImplementation(async () => INSUFFICIENT);
    await renderSheet(lushaCandidate());
    await clickReveal();
    const text = bodyText();
    assert.equal(text.includes('Teléfono no disponible.'), false, text);
    assert.equal(text.includes('Apollo no encontró un teléfono'), false, text);
    assert.equal(text.includes('Revelación solicitada'), false, text);
    // Y ninguna corrida fantasma en pantalla.
    assert.equal(text.includes('Proveedor final'), false, text);
  });

  it('saldo NO verificable: copy distinto que no afirma que falten créditos', async () => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'credit_balance_unavailable',
      requestAccepted: false,
      errorCode: 'credit_balance_unavailable',
    }));
    await renderSheet(lushaCandidate());
    await clickReveal();
    const text = bodyText();
    assert.ok(text.includes('No fue posible verificar el saldo de créditos'), text);
    assert.ok(text.includes('No se ejecutó ningún proveedor'), text);
    assert.ok(text.includes('ni se consumieron créditos'), text);
    assert.equal(text.includes(INSUFFICIENT_CREDITS_COPY), false, text);
  });

  it('presupuesto sin configurar: copy propio, sin afirmar que falten créditos', async () => {
    // AGENT2A-PHONE-WATERFALL-4E. El servidor no encontró regla de crédito para alguno
    // de los proveedores que la autorización podía llamar, así que no hubo
    // disponibilidad que reservar: 0 corridas, 0 proveedores, 0 créditos.
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'budget_not_configured',
      requestAccepted: false,
      errorCode: 'budget_not_configured',
    }));
    await renderSheet(lushaCandidate());
    await clickReveal();
    const text = bodyText();
    assert.ok(
      text.includes('No hay un presupuesto configurado para realizar esta revelación.'),
      text,
    );
    assert.equal(text.includes(INSUFFICIENT_CREDITS_COPY), false, text);
    assert.equal(text.includes('No fue posible verificar el saldo'), false, text);
    // Y no se finge que se buscó teléfono.
    assert.equal(text.includes('Teléfono no disponible.'), false, text);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Rol y flag: lo que 4D NO cambia
// ═══════════════════════════════════════════════════════════════

// AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: el rol que NO alcanza Lusha ya no es
// `commercial_manager` —ese puede revelar, y por tanto usa el waterfall—, sino
// cualquier actor para el que el server component resuelva `false`.
describe('4D — un actor sin permiso de revelar no alcanza Lusha', () => {
  it('rol no autorizado: Apollo-only, tope 8, sin auditoría y sin copy de Lusha', async () => {
    await renderSheet(lushaCandidate(), { waterfallAuthorized: false });
    const text = bodyText();
    assert.ok(text.includes('Consulta individual con Apollo'), text);
    assert.equal(/Lusha: hasta 5 créditos/.test(text), false, text);
    assert.equal(/Máximo total autorizado/.test(text), false, text);
    assert.equal(/13/.test(text), false, text);

    await clickReveal();
    assert.equal(mockReveal.mock.callCount(), 1);
    const payload = mockReveal.mock.calls[0].arguments[0] as {
      expectedMaxCredits: number;
    };
    assert.equal(payload.expectedMaxCredits, 8);
    // Ninguna vía de Lusha desde este rol.
    assert.equal(mockLegacyStart.mock.callCount(), 0);
    assert.equal(mockLushaFallback.mock.callCount(), 0);
    assert.equal(mockAudit.mock.callCount(), 0, 'no se consulta la corrida');
  });

  it('rol no autorizado en un candidato legacy: no se ofrece la ruta legacy', async () => {
    await renderSheet(legacyCandidate(), {
      waterfallAuthorized: false,
      lushaFallbackAuthorized: false,
    });
    assert.equal(revealButtons().length, 0);
    assert.equal(totalProviderCalls(), 0);
  });
});

describe('4D — flag OFF conserva el flujo histórico', () => {
  it('one-click Apollo con el copy anterior (8 créditos y "tardar algunos minutos")', async () => {
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: false,
      waterfallAuthorized: false,
    });
    const text = bodyText();
    assert.ok(
      text.includes(
        'Consulta individual con Apollo. Puede consumir hasta 8 créditos y tardar algunos minutos.',
      ),
      text,
    );
    // Sin desglose ni advertencias del waterfall: es el flujo previo, intacto.
    assert.equal(/Apollo: hasta 8 créditos\./.test(text), false, text);
    assert.equal(/No se garantiza encontrar un teléfono/.test(text), false, text);

    await clickReveal();
    assert.equal(mockReveal.mock.callCount(), 1);
    const payload = mockReveal.mock.calls[0].arguments[0] as {
      expectedMaxCredits: number;
    };
    assert.equal(payload.expectedMaxCredits, 8);
    assert.equal(mockAudit.mock.callCount(), 0, 'sin waterfall no hay corrida que leer');
  });

  it('conserva el botón manual de Lusha tras un no_phone_found de Apollo', async () => {
    await renderSheet(legacyCandidate(), {
      waterfallEnabled: false,
      waterfallAuthorized: false,
    });
    assert.ok(screen.queryByRole('button', { name: LUSHA_BUTTON_LABEL }));
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Estados, auditoría y costos separados
// ═══════════════════════════════════════════════════════════════

describe('4D — estados y auditoría', () => {
  async function renderWithAudit(audit: PhoneRevealWaterfallAuditView) {
    mockAudit.mock.mockImplementation(async () => audit);
    await renderSheet(lushaCandidate({ phone_reveal_status: 'no_phone_found' }));
  }

  it('Apollo en vuelo ⇒ «Apollo está procesando el resultado.»', async () => {
    mockAudit.mock.mockImplementation(async () => auditView());
    await renderSheet(lushaCandidate({ phone_reveal_status: 'requested' }));
    assert.ok(bodyText().includes('Apollo está procesando el resultado.'), bodyText());
  });

  it('terminal con teléfono ⇒ «Teléfono revelado.»', async () => {
    await renderWithAudit(
      auditView({
        status: 'completed_lusha',
        isTerminal: true,
        apolloOutcome: 'no_phone_found',
        lushaAttempted: true,
        lushaOutcome: 'revealed',
        finalProvider: 'lusha',
      }),
    );
    assert.ok(bodyText().includes('Teléfono revelado.'), bodyText());
  });

  it('terminal sin teléfono ⇒ «Teléfono no disponible.»', async () => {
    await renderWithAudit(
      auditView({
        status: 'exhausted',
        isTerminal: true,
        apolloOutcome: 'no_phone_found',
        lushaAttempted: true,
        lushaOutcome: 'no_phone_found',
        finalProvider: 'none',
      }),
    );
    assert.ok(bodyText().includes('Teléfono no disponible.'), bodyText());
  });

  it('error ⇒ mensaje explícito, y el reintento exige una acción nueva', async () => {
    await renderWithAudit(
      auditView({ status: 'error', isTerminal: true, finalProvider: 'none' }),
    );
    const text = bodyText();
    assert.ok(text.includes('No fue posible completar la revelación de teléfono'), text);
    // Nada se reintenta solo: cero llamadas sin intervención humana.
    assert.equal(totalProviderCalls(), 0);
  });

  it('los costos de las dos patas se muestran SEPARADOS y nunca sumados', async () => {
    await renderWithAudit(
      auditView({
        status: 'completed_lusha',
        isTerminal: true,
        apolloAttempted: true,
        apolloOutcome: 'no_phone_found',
        apolloCostCredits: 8,
        apolloCostSource: 'reported',
        lushaAttempted: true,
        lushaOutcome: 'revealed',
        lushaCostCredits: 5,
        lushaCostSource: 'reported',
        finalProvider: 'lusha',
      }),
    );
    const text = bodyText();
    assert.ok(text.includes('8 créditos'), 'costo de Apollo, en su línea');
    assert.ok(text.includes('5 créditos'), 'costo de Lusha, en su línea');
    // 8 + 5 = 13 NUNCA aparece como un costo consumido: 13 es solo el tope
    // autorizado, y así está etiquetado.
    assert.equal(/13 créditos consumidos/.test(text), false, text);
    assert.ok(text.includes('Máximo autorizado'), text);
  });

  it('un costo no reportado se muestra como "no reportado", nunca como 0', async () => {
    await renderWithAudit(
      auditView({
        status: 'error',
        isTerminal: true,
        apolloOutcome: 'error',
        apolloCostCredits: null,
        apolloCostSource: 'unknown',
        finalProvider: 'none',
      }),
    );
    assert.ok(bodyText().includes('costo no reportado'), bodyText());
  });
});
