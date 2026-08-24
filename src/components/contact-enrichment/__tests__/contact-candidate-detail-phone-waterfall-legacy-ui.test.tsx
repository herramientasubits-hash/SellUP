/**
 * Tests — UI de la ruta legacy solo-Lusha en el sidepanel del candidato
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-2)
 *
 * El problema que esta ruta resuelve: con ENABLE_PHONE_REVEAL_WATERFALL encendido, el
 * botón manual separado de Lusha desaparece, y el botón de reveal Apollo no se ofrece
 * sobre un candidato ya `no_phone_found`. Sin compatibilidad legacy, esos candidatos
 * se quedan SIN NINGUNA vía.
 *
 * Contrato de UX verificado:
 *   * UN solo botón ("Revelar teléfono") que EJECUTA en un clic, el mismo del
 *     waterfall (AGENT2A-PHONE-WATERFALL-4D: ya no hay modal);
 *   * copy legacy: Apollo no se reejecuta, máximo 5 créditos, nunca 13;
 *   * NINGÚN botón manual separado de Lusha, ni ninguna superficie de confirmación;
 *   * un actor sin permiso de revelar no obtiene la ruta (ni puede invocarla desde la UI);
 *   * flag OFF ⇒ flujo anterior intacto (botón manual de Lusha, sin acción legacy);
 *   * no se ofrece mientras la corrida está activa, ni una vez que existe cualquier
 *     corrida (la ruta legacy es un puente de una sola vez);
 *   * los costos desconocidos nunca se muestran como 0.
 *
 * Render real de React (jsdom + @testing-library/react). NO toca el servidor, NO
 * llama proveedores, NO escribe en DB y NO revela teléfonos: los server actions están
 * mockeados.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que la suite del waterfall) ────────────────

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

// ── Imports dependientes del entorno DOM ────────────────────────────────────

import * as React from 'react';
import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import type { PhoneRevealWaterfallAuditView } from '@/modules/contact-enrichment/phone-reveal-waterfall-core';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Mocks de boundary ───────────────────────────────────────────────────────

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

// ── Fixtures ────────────────────────────────────────────────────────────────

const REVEAL_LABEL = 'Revelar teléfono';
const LUSHA_BUTTON_LABEL = 'Revelar teléfono con Lusha';

/**
 * Candidato LEGACY: origen Lusha con id propio, sin teléfono, y con el intento Apollo
 * histórico ya cerrado como `no_phone_found` (provider `apollo`).
 */
function legacyCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-legacy',
    full_name: 'Contacto Legacy',
    title: 'Cargo de prueba',
    email: 'legacy@ejemplo.test',
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
    enrichment_run_id: 'run-legacy',
    created_at: '2026-08-03T11:00:00.000Z',
    phone_reveal_status: 'no_phone_found',
    phone_reveal_provider: 'apollo',
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

function auditView(
  overrides: Partial<PhoneRevealWaterfallAuditView> = {},
): PhoneRevealWaterfallAuditView {
  return {
    status: 'lusha_pending',
    runMode: 'legacy_lusha_only',
    isTerminal: false,
    maxCreditsAuthorized: 5,
    apolloAttempted: false,
    apolloOutcome: 'no_phone_found',
    apolloCostCredits: null,
    apolloCostSource: 'unknown',
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

function revealButtons() {
  return screen.queryAllByRole('button', { name: REVEAL_LABEL });
}

function lushaButton() {
  return screen.queryByRole('button', { name: LUSHA_BUTTON_LABEL });
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

/**
 * Un clic en el botón ÚNICO. AGENT2A-PHONE-WATERFALL-4D: esto EJECUTA — no abre un
 * modal — así que las pruebas que antes verificaban el contenido del diálogo ahora
 * verifican lo que se lee debajo del botón ANTES de este clic.
 */
async function clickReveal() {
  const buttons = revealButtons();
  assert.equal(buttons.length, 1, 'debe haber EXACTAMENTE un botón "Revelar teléfono"');
  await act(async () => {
    fireEvent.click(buttons[0]);
  });
}

/** Ya no existe. Se conserva como aserción de ausencia. */
function confirmButton() {
  return screen.queryByRole('button', { name: 'Confirmar y revelar' });
}

// ── Setup/Teardown ──────────────────────────────────────────────────────────

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
  // Sin corrida: es el estado de un candidato legacy antes de autorizar.
  mockAudit.mock.mockImplementation(async () => null);
  mockReveal.mock.mockImplementation(async () => ({
    ok: true,
    status: 'requested',
    requestAccepted: true,
  }));
  mockLushaFallback.mock.mockImplementation(async () => ({
    ok: true,
    status: 'revealed',
    errorCode: null,
  }));
  mockLegacyStart.mock.mockImplementation(async () => ({
    status: 'revealed',
    reason: null,
    maxCreditsAuthorized: 5,
  }));
});

// ── 1. Un botón, sin modal, copy legacy ─────────────────────────────────────

describe('WATERFALL-2/4D UI — un botón, sin modal, copy legacy', () => {
  it('ofrece EXACTAMENTE un botón "Revelar teléfono" y NINGÚN botón separado de Lusha', async () => {
    await renderSheet(legacyCandidate());
    assert.equal(revealButtons().length, 1);
    assert.equal(lushaButton(), null);
  });

  it('el copy legacy y el tope 5 se leen ANTES del clic, sin abrir ningún modal', async () => {
    await renderSheet(legacyCandidate());
    const text = bodyText();
    assert.ok(/Apollo ya fue intentado\./i.test(text), text);
    assert.ok(/SellUp intentará Lusha automáticamente/i.test(text), text);
    assert.ok(/Puede consumir hasta 5 créditos\./i.test(text), text);
    // Y no hay superficie de confirmación en ningún momento.
    assert.equal(confirmButton(), null);
    assert.equal(screen.queryByRole('button', { name: 'Cancelar' }), null);
  });

  it('el copy legacy NO muestra 13 créditos en ninguna parte', async () => {
    await renderSheet(legacyCandidate());
    assert.equal(/13/.test(bodyText()), false, bodyText());
  });

  it('el legacy NO adopta el desglose por proveedor: autoriza UNA sola pata', async () => {
    // El desglose de 4B pertenece al waterfall COMPLETO. El legacy autoriza una sola
    // pata, así que un desglose o un "máximo total autorizado" insinuarían que hay
    // más de una pata en juego.
    await renderSheet(legacyCandidate());
    const text = bodyText();
    assert.equal(/Apollo: hasta 8 créditos/.test(text), false, text);
    assert.equal(/Lusha: hasta 5 créditos\./.test(text), false, text);
    assert.equal(/Máximo total autorizado/.test(text), false, text);
  });

  it('declara las advertencias obligatorias, antes del clic', async () => {
    await renderSheet(legacyCandidate());
    const text = bodyText();
    assert.ok(/No garantiza encontrar un teléfono/i.test(text));
    assert.ok(/No crea un contacto oficial/i.test(text));
    assert.ok(/No se escribirá en HubSpot/i.test(text));
    assert.ok(/individual, no masiva/i.test(text));
  });

  it('UN clic invoca la acción LEGACY con solo el id, y NUNCA el reveal de Apollo', async () => {
    await renderSheet(legacyCandidate());
    await clickReveal();

    assert.equal(mockLegacyStart.mock.callCount(), 1);
    assert.deepEqual(mockLegacyStart.mock.calls[0].arguments[0], {
      candidateId: 'cand-legacy',
    });
    // CERO Apollo y cero fallback manual de Lusha desde esta UI.
    assert.equal(mockReveal.mock.callCount(), 0);
    assert.equal(mockLushaFallback.mock.callCount(), 0);
  });

  it('abrir el drawer NO autoriza nada: sin clic no hay corrida', async () => {
    await renderSheet(legacyCandidate());
    assert.equal(mockLegacyStart.mock.callCount(), 0);
    assert.equal(mockReveal.mock.callCount(), 0);
    assert.equal(mockLushaFallback.mock.callCount(), 0);
  });
});

// ── 2. Elegibilidad visual ──────────────────────────────────────────────────

describe('WATERFALL-2 UI — cuándo NO se ofrece la ruta legacy', () => {
  it('flag OFF ⇒ flujo anterior intacto: botón manual de Lusha y CERO acción legacy', async () => {
    await renderSheet(legacyCandidate(), { waterfallEnabled: false, waterfallAuthorized: false });
    // El botón manual de Lusha vuelve a existir (es el flujo previo al waterfall).
    assert.ok(lushaButton());
    // Y no hay botón "Revelar teléfono" (Apollo ya está agotado), como antes.
    assert.equal(revealButtons().length, 0);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });

  it('actor sin permiso de revelar ⇒ sin ruta legacy y sin botón alguno del waterfall', async () => {
    await renderSheet(legacyCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: false,
      // El fallback manual tampoco está autorizado para ese rol.
      // (Un `commercial_manager` SÍ obtiene la ruta legacy desde
      // AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: ver la suite del core legacy.)
      lushaFallbackAuthorized: false,
    });
    assert.equal(revealButtons().length, 0);
    assert.equal(lushaButton(), null);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });

  it('`no_phone_found` producido por LUSHA ⇒ no se ofrece la ruta legacy', async () => {
    await renderSheet(legacyCandidate({ phone_reveal_provider: 'lusha' }));
    assert.equal(revealButtons().length, 0);
  });

  it('sin proveedor registrado ⇒ no se ofrece (no se asume Apollo)', async () => {
    await renderSheet(legacyCandidate({ phone_reveal_provider: null }));
    assert.equal(revealButtons().length, 0);
  });

  it('Apollo en ERROR ⇒ waterfall NORMAL (reintentar Apollo), NUNCA la ruta legacy', async () => {
    // Un fallo técnico no significa "no hay teléfono": lo que corresponde es
    // reintentar Apollo, no excusarlo. Así que el botón SÍ existe — pero es el del
    // waterfall completo (tope 13), y la acción legacy no se invoca jamás.
    await renderSheet(
      legacyCandidate({ phone_reveal_status: 'error', phone_reveal_provider: 'apollo' }),
    );

    const text = bodyText();
    assert.ok(/Apollo se intentará primero/i.test(text), text);
    // Copy del waterfall COMPLETO ⇒ desglose de las dos patas y total 13
    // (AGENT2A-PHONE-WATERFALL-4B), no el tope legacy de 5.
    assert.ok(/Máximo total autorizado: 13 créditos/i.test(text), text);
    assert.equal(/Apollo ya fue intentado/i.test(text), false);

    await clickReveal();
    // El gasto va por el START de Apollo, no por la ruta legacy.
    assert.equal(mockLegacyStart.mock.callCount(), 0);
    assert.equal(mockReveal.mock.callCount(), 1);
  });

  it('ya tiene teléfono ⇒ no se ofrece', async () => {
    await renderSheet(legacyCandidate({ phone: '+57 300 000 0000' }));
    assert.equal(revealButtons().length, 0);
  });

  it('sin id Lusha propio (candidato Apollo) ⇒ no se ofrece', async () => {
    await renderSheet(
      legacyCandidate({ source: 'apollo', source_contact_id: '0123456789abcdef01234567' }),
    );
    assert.equal(revealButtons().length, 0);
  });

  it('reveal en vuelo ⇒ no se ofrece', async () => {
    await renderSheet(legacyCandidate({ phone_reveal_status: 'pending' }));
    assert.equal(revealButtons().length, 0);
  });

  it('corrida ACTIVA ⇒ no se ofrece (la autorización ya está en curso)', async () => {
    mockAudit.mock.mockImplementation(async () => auditView({ isTerminal: false }));
    await renderSheet(legacyCandidate());
    assert.equal(revealButtons().length, 0);
  });

  it('corrida FULL_WATERFALL terminal ⇒ no se ofrece la ruta legacy', async () => {
    // El candidato pertenece al flujo completo. Su corrida no lo vuelve legacy, y esta
    // ruta no es una vía para saltarse Apollo (AGENT2A-PHONE-WATERFALL-2C).
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'exhausted',
        runMode: 'full_waterfall',
        isTerminal: true,
        finalProvider: 'none',
      }),
    );
    await renderSheet(legacyCandidate());
    assert.equal(revealButtons().length, 0);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });

  it('corrida legacy terminal que YA reveló ⇒ no se ofrece (nada que reautorizar)', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'completed_lusha',
        isTerminal: true,
        lushaAttempted: true,
        lushaOutcome: 'revealed',
        finalProvider: 'lusha',
      }),
    );
    await renderSheet(legacyCandidate());
    assert.equal(revealButtons().length, 0);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });
});

// ── 2b. Reautorización tras una corrida terminal (AGENT2A-PHONE-WATERFALL-2C) ─

/**
 * Corrida legacy TERMINAL que no consiguió teléfono. Es el estado en el que el mismo
 * botón vuelve a estar disponible: nada se reabre ni se reintenta solo — el operador
 * tiene que volver a hacer clic y volver a confirmar.
 */
function terminalLegacyRunWithoutPhone(
  overrides: Partial<PhoneRevealWaterfallAuditView> = {},
): PhoneRevealWaterfallAuditView {
  return auditView({
    status: 'exhausted',
    isTerminal: true,
    lushaAttempted: true,
    lushaOutcome: 'no_phone_found',
    lushaCostCredits: 0,
    lushaCostSource: 'reported',
    finalProvider: 'none',
    ...overrides,
  });
}

describe('WATERFALL-2C UI — reautorización tras una corrida terminal sin teléfono', () => {
  beforeEach(() => {
    mockAudit.mock.mockImplementation(async () => terminalLegacyRunWithoutPhone());
  });

  it('el MISMO botón vuelve a estar habilitado (uno solo, sin botón separado de Lusha)', async () => {
    await renderSheet(legacyCandidate());
    const buttons = revealButtons();
    assert.equal(buttons.length, 1, 'exactamente un botón "Revelar teléfono"');
    assert.equal((buttons[0] as HTMLButtonElement).disabled, false);
    assert.equal(lushaButton(), null, 'no hay botón separado "Revelar teléfono con Lusha"');
    assert.equal(bodyText().includes('Reintentar Lusha'), false);
  });

  it('conserva el MISMO copy legacy: máximo 5, Apollo no se repite, nunca 13', async () => {
    await renderSheet(legacyCandidate());

    // Ninguna superficie de confirmación: el clic ejecuta (4D).
    assert.equal(confirmButton(), null);
    const text = bodyText();
    assert.ok(/Puede consumir hasta 5 créditos\./i.test(text), text);
    assert.equal(/13 créditos/.test(text), false, 'nunca muestra 13');
    assert.ok(/Apollo ya fue intentado\./i.test(text), text);
    assert.ok(/SellUp intentará Lusha automáticamente/i.test(text), text);
    assert.ok(/No garantiza encontrar un teléfono/i.test(text), text);
    assert.ok(/No crea un contacto oficial/i.test(text), text);
    assert.ok(/No se escribirá en HubSpot/i.test(text), text);
  });

  it('exige una ACCIÓN nueva: abrir el drawer no gasta nada, el clic sí autoriza', async () => {
    await renderSheet(legacyCandidate());
    assert.equal(mockLegacyStart.mock.callCount(), 0, 'abrir el drawer no autoriza');

    await clickReveal();
    assert.equal(mockLegacyStart.mock.callCount(), 1, 'solo el clic autoriza');
    // Un candidato por invocación y nunca el reveal de Apollo.
    assert.deepEqual(mockLegacyStart.mock.calls[0].arguments[0], {
      candidateId: 'cand-legacy',
    });
    assert.equal(mockReveal.mock.callCount(), 0);
  });

  it('no hay reapertura ni reintento automáticos: sin clic no se autoriza nada', async () => {
    await renderSheet(legacyCandidate());
    // El drawer se abrió sobre una corrida terminal sin teléfono y nadie tocó nada.
    assert.equal(mockLegacyStart.mock.callCount(), 0);
    assert.equal(mockReveal.mock.callCount(), 0);
    assert.equal(mockLushaFallback.mock.callCount(), 0);
  });

  it('dos clics concurrentes crean UNA sola corrida', async () => {
    await renderSheet(legacyCandidate());
    const button = revealButtons()[0];
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    assert.equal(mockLegacyStart.mock.callCount(), 1);
  });
});

// ── 3. Resultados ───────────────────────────────────────────────────────────

describe('WATERFALL-2 UI — resultados de la autorización legacy', () => {
  it('Lusha sin teléfono ⇒ aviso claro, sin prometer nada', async () => {
    mockLegacyStart.mock.mockImplementation(async () => ({
      status: 'no_phone_found',
      reason: null,
      maxCreditsAuthorized: 5,
    }));
    await renderSheet(legacyCandidate());
    await clickReveal();
    assert.ok(/Lusha tampoco encontró un teléfono/i.test(bodyText()));
  });

  it('verificación de supresión NO disponible ⇒ no afirma que esté suprimido', async () => {
    mockLegacyStart.mock.mockImplementation(async () => ({
      status: 'closed_without_lusha',
      reason: 'suppression_check_unavailable',
      maxCreditsAuthorized: 5,
    }));
    await renderSheet(legacyCandidate());
    await clickReveal();
    const text = bodyText();
    assert.ok(/No se pudo verificar la supresión/i.test(text));
    assert.ok(/Lusha no fue ejecutado/i.test(text));
  });

  it('supresión/DNC confirmada ⇒ copy de restricción de privacidad', async () => {
    mockLegacyStart.mock.mockImplementation(async () => ({
      status: 'closed_without_lusha',
      reason: 'blocked_suppressed',
      maxCreditsAuthorized: 5,
    }));
    await renderSheet(legacyCandidate());
    await clickReveal();
    assert.ok(/restricción de privacidad/i.test(bodyText()));
  });

  it('la pata ya estaba reclamada ⇒ avisa que no hubo cargo nuevo', async () => {
    mockLegacyStart.mock.mockImplementation(async () => ({
      status: 'already_attempted',
      reason: 'already_attempted',
      maxCreditsAuthorized: 5,
    }));
    await renderSheet(legacyCandidate());
    await clickReveal();
    assert.ok(/ya se había intentado/i.test(bodyText()));
    assert.ok(/ningún cargo nuevo/i.test(bodyText()));
  });

  it('error técnico ⇒ no dice "no existe teléfono"', async () => {
    mockLegacyStart.mock.mockImplementation(async () => ({
      status: 'error',
      reason: 'provider_network_error',
      maxCreditsAuthorized: 5,
    }));
    await renderSheet(legacyCandidate());
    await clickReveal();
    const text = bodyText();
    assert.ok(/No fue posible completar la revelación/i.test(text));
    assert.equal(/no existe teléfono/i.test(text), false);
  });
});

// ── 4. Bloque de auditoría de una corrida legacy ────────────────────────────

describe('WATERFALL-2 UI — auditoría de una corrida legacy', () => {
  it('la pata Apollo dice "intentado anteriormente", nunca "No intentado"', async () => {
    mockAudit.mock.mockImplementation(async () => auditView());
    await renderSheet(legacyCandidate());
    const text = bodyText();
    assert.ok(/Intentado anteriormente, fuera de esta autorización/i.test(text));
    assert.equal(/No intentado/i.test(text), false);
  });

  it('el costo de Apollo NO se muestra como 0 ni como cifra alguna', async () => {
    mockAudit.mock.mockImplementation(async () => auditView());
    await renderSheet(legacyCandidate());
    const text = bodyText();
    assert.ok(/Sin cargo en esta autorización/i.test(text));
    assert.equal(/0 créditos/.test(text), false);
  });

  it('el máximo autorizado que se muestra es 5, no 13', async () => {
    mockAudit.mock.mockImplementation(async () => auditView());
    await renderSheet(legacyCandidate());
    const text = bodyText();
    assert.ok(/5 créditos/.test(text));
    assert.equal(/13 créditos/.test(text), false);
  });

  it('mientras Lusha corre, el copy NO dice que Apollo esté consultándose ahora', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({ status: 'lusha_running', isTerminal: false }),
    );
    await renderSheet(legacyCandidate());
    const text = bodyText();
    // 4D: copy único para las dos modalidades. Está en PASADO, así que no afirma que
    // Apollo esté corriendo ahora — y la fila de auditoría de Apollo aclara que ese
    // intento ocurrió fuera de esta autorización.
    assert.ok(/Apollo no encontró un teléfono\. SellUp está intentando Lusha\./.test(text), text);
    assert.equal(/[Cc]onsultando Apollo/.test(text), false, text);
    assert.ok(/Intentado anteriormente, fuera de esta autorización/i.test(text), text);
  });

  it('agotada: estado terminal único y Apollo situado en el pasado por la auditoría', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'exhausted',
        isTerminal: true,
        lushaAttempted: true,
        lushaOutcome: 'no_phone_found',
        lushaCostCredits: 0,
        lushaCostSource: 'reported',
        finalProvider: 'none',
      }),
    );
    await renderSheet(legacyCandidate());
    const text = bodyText();
    // 4D: el estado terminal ya no enumera proveedores…
    assert.ok(/Teléfono no disponible\./.test(text), text);
    // …y quien sitúa el intento de Apollo en el pasado, fuera de esta autorización,
    // es la fila de auditoría de Apollo, que sigue intacta.
    assert.ok(/Intentado anteriormente, fuera de esta autorización/i.test(text), text);
    assert.ok(/Sin cargo en esta autorización/i.test(text), text);
  });

  it('un costo de Lusha no reportado se muestra como "no reportado", nunca como 0', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'completed_lusha',
        isTerminal: true,
        lushaAttempted: true,
        lushaOutcome: 'revealed',
        lushaCostCredits: null,
        lushaCostSource: 'unknown',
        finalProvider: 'lusha',
      }),
    );
    await renderSheet(legacyCandidate());
    assert.ok(/costo no reportado/i.test(bodyText()));
  });
});
