/**
 * Tests — el botón «Revelar teléfono» deja de prometer lo imposible
 * (Agente 2A · AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-2)
 *
 * Defecto que cierran: desde AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1 (PR #289) el
 * backend BLOQUEA fail-closed cualquier reveal cuya supresión no se pueda evaluar
 * —sin `provider_person_id` resoluble o sin cuenta—. La UI seguía ofreciendo el
 * botón habilitado, así que el operador hacía clic y recibía un error rojo de
 * privacidad por algo que se sabía imposible ANTES del clic.
 *
 * Contrato verificado, caso por caso (A–L del hito):
 *   A. cuenta + identidad Apollo válida        ⇒ habilitado
 *   B. sin cuenta                              ⇒ deshabilitado
 *   C. sin identidad de persona                ⇒ deshabilitado
 *   D. sin ninguna de las dos                  ⇒ deshabilitado
 *   E. Lusha con apollo_person_id + cuenta     ⇒ habilitado (semántica actual)
 *   F. Apollo con source_contact_id + cuenta   ⇒ habilitado
 *   G. source_contact_id inválido              ⇒ deshabilitado salvo columna válida
 *   L. NINGÚN caso llama a un proveedor: 0 invocaciones a cualquier server action
 *      que pueda gastar créditos, ni al render ni al intentar hacer clic.
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
import { PHONE_REVEAL_IDENTITY_BLOCKED_COPY } from '@/modules/contact-enrichment/phone-reveal-identity-eligibility';

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
    getPhoneRevealWaterfallAuditAction: async () => null,
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
const APOLLO_ID = '0123456789abcdef01234567';
const OTHER_APOLLO_ID = 'fedcba9876543210fedcba98';
const LUSHA_ID = 'v1.token-opaco-de-lusha-1234';

/**
 * Base: candidato Apollo con identidad de supresión completa (id + cuenta). Es el
 * caso ELEGIBLE; cada test le quita exactamente lo que quiere probar, para que la
 * diferencia entre habilitado y deshabilitado sea siempre una sola variable.
 */
function baseCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-identity',
    full_name: 'Contacto De Prueba',
    title: 'Cargo de prueba',
    email: 'prueba@ejemplo.test',
    linkedin_url: 'https://www.linkedin.com/in/prueba',
    source_contact_id: APOLLO_ID,
    apollo_person_id: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-identity',
    created_at: '2026-08-13T11:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

async function renderSheet(candidate: PendingContactCandidate): Promise<void> {
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

function revealButton(): HTMLButtonElement {
  const buttons = screen.queryAllByRole('button', { name: REVEAL_LABEL });
  assert.equal(buttons.length, 1, 'debe haber EXACTAMENTE un botón «Revelar teléfono»');
  return buttons[0] as HTMLButtonElement;
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
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
  mockLegacyStart.mock.resetCalls();
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
// Habilitado: la identidad de supresión existe
// ═══════════════════════════════════════════════════════════════

describe('botón HABILITADO cuando la supresión es evaluable', () => {
  it('A/F. candidato Apollo con source_contact_id válido + cuenta', async () => {
    await renderSheet(baseCandidate());
    assert.equal(revealButton().disabled, false);
    assert.equal(bodyText().includes(PHONE_REVEAL_IDENTITY_BLOCKED_COPY), false);
  });

  it('A. candidato Apollo con apollo_person_id propio + cuenta (sin source_contact_id)', async () => {
    await renderSheet(
      baseCandidate({ apollo_person_id: APOLLO_ID, source_contact_id: null }),
    );
    assert.equal(revealButton().disabled, false);
  });

  it('E. candidato LUSHA con apollo_person_id válido + cuenta', async () => {
    // Semántica ACTUAL del backend: la clave de supresión es Apollo-only, así que un
    // candidato Lusha solo es evaluable si arrastra un Apollo person id.
    await renderSheet(
      baseCandidate({
        source: 'lusha',
        source_contact_id: LUSHA_ID,
        apollo_person_id: OTHER_APOLLO_ID,
      }),
    );
    assert.equal(revealButton().disabled, false);
  });

  it('G. source_contact_id inválido pero apollo_person_id válido ⇒ habilitado', async () => {
    await renderSheet(
      baseCandidate({
        source_contact_id: 'no-es-un-object-id',
        apollo_person_id: APOLLO_ID,
      }),
    );
    assert.equal(revealButton().disabled, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Deshabilitado: la supresión NO se puede evaluar
// ═══════════════════════════════════════════════════════════════

describe('botón DESHABILITADO cuando la supresión no es evaluable', () => {
  // FASE 1 (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4) — RE-ESPECIFICADO.
  //
  // Los casos B, C y D de #291 afirmaban que el botón se deshabilitaba sin cuenta y para un
  // candidato de Lusha. Ese era el síntoma correcto del backend de entonces, y es
  // exactamente lo que la Fase 1 repara: los tres casos son ahora los del PRODUCTO que este
  // hito habilita —candidato descubierto antes de que exista cuenta, y candidato de Lusha
  // con su identidad propia— así que el botón tiene que estar HABILITADO y el copy de
  // bloqueo NO debe aparecer.
  it('B. FASE 1: sin cuenta SellUp el botón está HABILITADO', async () => {
    await renderSheet(baseCandidate({ account_id: null, hubspot_company_id: 'hs-1' }));
    assert.equal(revealButton().disabled, false);
    assert.equal(bodyText().includes(PHONE_REVEAL_IDENTITY_BLOCKED_COPY), false);
  });

  it('C. FASE 1: candidato Lusha sin apollo_person_id ⇒ botón HABILITADO', async () => {
    await renderSheet(
      baseCandidate({
        source: 'lusha',
        source_contact_id: LUSHA_ID,
        apollo_person_id: null,
      }),
    );
    assert.equal(revealButton().disabled, false);
    assert.equal(bodyText().includes(PHONE_REVEAL_IDENTITY_BLOCKED_COPY), false);
  });

  it('D. FASE 1: candidato Lusha SIN cuenta ⇒ botón HABILITADO', async () => {
    await renderSheet(
      baseCandidate({
        source: 'lusha',
        source_contact_id: LUSHA_ID,
        apollo_person_id: null,
        account_id: null,
        hubspot_company_id: 'hs-1',
      }),
    );
    assert.equal(revealButton().disabled, false);
    assert.equal(bodyText().includes(PHONE_REVEAL_IDENTITY_BLOCKED_COPY), false);
  });

  // El bloqueo de #291 SIGUE existiendo, con su copy intacto, para el único caso que de
  // verdad no tiene identidad: ni id de Apollo ni identidad nativa de un proveedor con
  // supresión propia. Es lo que impide que este hito se lea como «se quitó el bloqueo».
  it('D bis. sin NINGUNA identidad nativa ⇒ botón deshabilitado y copy de #291', async () => {
    await renderSheet(
      baseCandidate({
        source: 'hubspot',
        source_contact_id: null,
        apollo_person_id: null,
        account_id: null,
        hubspot_company_id: 'hs-1',
      }),
    );
    assert.equal(revealButton().disabled, true);
    assert.ok(bodyText().includes(PHONE_REVEAL_IDENTITY_BLOCKED_COPY));
  });

  it('G. source_contact_id inválido y sin columna propia', async () => {
    await renderSheet(
      baseCandidate({ source_contact_id: 'no-es-un-object-id', apollo_person_id: null }),
    );
    assert.equal(revealButton().disabled, true);
  });

  it('no promete créditos ni nombra proveedores mientras está bloqueado', async () => {
    // FASE 1: el candidato de Lusha ya NO está bloqueado, así que el caso se ejerce con el
    // candidato que sí lo está — sin ninguna identidad nativa.
    await renderSheet(
      baseCandidate({
        source: 'hubspot',
        source_contact_id: null,
        apollo_person_id: null,
      }),
    );
    const text = bodyText();
    // El copy de autorización («puede consumir hasta N créditos», desglose por pata)
    // describiría un gasto que no puede ocurrir.
    assert.equal(/puede consumir hasta/i.test(text), false);
    assert.equal(/unos minutos/i.test(text), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. Ningún proveedor se llama, en ningún caso
// ═══════════════════════════════════════════════════════════════

describe('L. 0 llamadas a proveedor', () => {
  it('renderizar el drawer no dispara ninguna acción que gaste créditos', async () => {
    for (const candidate of [
      baseCandidate(),
      baseCandidate({ account_id: null }),
      baseCandidate({ source: 'lusha', source_contact_id: LUSHA_ID }),
    ]) {
      cleanup();
      await renderSheet(candidate);
      assert.equal(totalProviderCalls(), 0);
    }
  });

  it('hacer clic en el botón deshabilitado no dispara nada', async () => {
    // FASE 1: mismo motivo que arriba — el candidato deshabilitado es el que no tiene
    // NINGUNA identidad nativa.
    await renderSheet(
      baseCandidate({
        source: 'hubspot',
        source_contact_id: null,
        apollo_person_id: null,
      }),
    );
    const button = revealButton();
    assert.equal(button.disabled, true);
    await act(async () => {
      fireEvent.click(button);
    });
    assert.equal(totalProviderCalls(), 0);
  });
});
