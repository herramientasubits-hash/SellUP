/**
 * Tests — UI de la CONTINUACIÓN legacy cross-provider
 * (Agente 2A · AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1)
 *
 * El caso real: Luis, un candidato NACIDO EN APOLLO cuyo reveal terminó
 * `no_phone_found`. Antes de este hito el drawer no le ofrecía nada — su regla local
 * era «el candidato nació en Lusha y trae su id», y Luis no cumple ninguna de las dos
 * cosas— aunque el servidor sí puede continuarlo comprando la identidad Lusha.
 *
 * Contrato de UX verificado aquí:
 *   * la oferta la decide el SERVIDOR (la vista previa legacy), no el navegador: las
 *     identidades persistidas y los identificadores exactos no existen en el cliente;
 *   * el copy dice 6, lo desglosa en «búsqueda hasta 1 + teléfono hasta 5» y NO nombra
 *     14, 13 ni los 8 de Apollo — ese gasto ya lo pagó la autorización histórica;
 *   * el copy dice que Apollo YA fue consultado y que no se volverá a consultar, y el
 *     botón nombra a Lusha en vez de prometer un reveal genérico;
 *   * el clic envía el techo que la persona acaba de leer, y un techo que ya no
 *     alcanza produce una pregunta nueva, no un gasto;
 *   * sin respuesta del servidor el drawer NO inventa la oferta (fail-closed).
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
const mockLegacyPreview = mock.fn<(input: unknown) => Promise<unknown>>();

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
    // La vista previa del waterfall COMPLETO no interviene aquí: este candidato ya
    // agotó Apollo. Devuelve `null` para que su ausencia no pueda explicar ningún
    // resultado de esta suite.
    getPhoneRevealWaterfallAuthorizationPreviewAction: async () => null,
    getLegacyPhoneRevealAuthorizationPreviewAction: (...args: unknown[]) =>
      mockLegacyPreview(...(args as [unknown])),
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

const LEGACY_BUTTON_LABEL = 'Buscar teléfono con Lusha';
const APOLLO_BUTTON_LABEL = 'Revelar teléfono';
/** Botón manual de Lusha del flujo PREVIO al waterfall. Debe estar ausente. */
const MANUAL_LUSHA_BUTTON_LABEL = 'Revelar teléfono con Lusha';

/**
 * Luis: nacido en Apollo, sin teléfono, con LinkedIn, sin email, y con el intento
 * Apollo histórico ya cerrado como `no_phone_found`.
 */
function luisCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-luis',
    full_name: 'Luis Jacome Gaona',
    title: 'Cargo de prueba',
    email: null,
    linkedin_url: 'https://www.linkedin.com/in/luis-jacome-gaona',
    source_contact_id: 'apollo-person-99',
    // Identidad de supresión EVALUABLE (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-2): sin
    // ella el botón se deshabilita por otro contrato, que esta suite no mide.
    apollo_person_id: '0123456789abcdef01234567',
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-luis',
    created_at: '2026-08-01T08:00:00.000Z',
    phone_reveal_status: 'no_phone_found',
    phone_reveal_provider: 'apollo',
    company_name: 'Empresa Demo',
    company_domain: 'empresademo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

/** Vista previa legacy tal como la devuelve el servidor. */
function legacyPreview(
  overrides: Partial<{
    eligible: boolean;
    reason: string | null;
    requiresIdentitySearch: boolean;
    maxCredits: number;
  }> = {},
) {
  return {
    eligible: true,
    reason: null,
    requiresIdentitySearch: true,
    maxCredits: 6,
    ...overrides,
  };
}

interface RenderProps {
  waterfallEnabled?: boolean;
  waterfallAuthorized?: boolean;
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
      lushaPhoneFallbackEnabled
      lushaPhoneFallbackAuthorized
      phoneRevealWaterfallEnabled={props.waterfallEnabled ?? true}
      phoneRevealWaterfallAuthorized={props.waterfallAuthorized ?? true}
    />,
  );
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
  // Dos vueltas: la vista previa se pide en paralelo al candidato, así que su efecto
  // sobre la oferta sólo es observable tras dejar correr las microtareas.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function legacyButton() {
  return screen.queryByRole('button', { name: LEGACY_BUTTON_LABEL });
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
  mockLegacyPreview.mock.resetCalls();

  // Sin corrida previa: es la primera autorización de este candidato.
  mockAudit.mock.mockImplementation(async () => null);
  mockLegacyPreview.mock.mockImplementation(async () => legacyPreview());
  mockLegacyStart.mock.mockImplementation(async () => ({
    status: 'revealed',
    reason: null,
    maxCreditsAuthorized: 6,
    requiredMaxCredits: null,
  }));
  mockReveal.mock.mockImplementation(async () => ({ status: 'revealed' }));
  mockLushaFallback.mock.mockImplementation(async () => ({ status: 'revealed' }));
});

// ═══════════════════════════════════════════════════════════════
// 1. La oferta la decide el servidor
// ═══════════════════════════════════════════════════════════════

describe('LEGACY-XP UI — un candidato Apollo agotado vuelve a tener una acción', () => {
  it('ofrece la continuación cuando el servidor la declara elegible', async () => {
    await renderSheet(luisCandidate());
    assert.ok(legacyButton(), bodyText());
    // Y NO ofrece un reveal genérico ni el botón manual de Lusha del flujo previo.
    assert.equal(screen.queryByRole('button', { name: APOLLO_BUTTON_LABEL }), null);
    assert.equal(
      screen.queryByRole('button', { name: MANUAL_LUSHA_BUTTON_LABEL }),
      null,
    );
  });

  it('la vista previa se pide para ESTE candidato, y es de solo lectura', async () => {
    await renderSheet(luisCandidate());
    assert.equal(mockLegacyPreview.mock.callCount() >= 1, true);
    assert.deepEqual(mockLegacyPreview.mock.calls[0].arguments[0], {
      candidateId: 'cand-luis',
    });
    // Abrir el drawer no autoriza nada.
    assert.equal(mockLegacyStart.mock.callCount(), 0);
    assert.equal(mockReveal.mock.callCount(), 0);
    assert.equal(mockLushaFallback.mock.callCount(), 0);
  });

  it('sin respuesta del servidor NO se inventa la oferta (fail-closed)', async () => {
    // Es el estado con la migración 124 sin aplicar, o con la lectura caída: el
    // servidor devuelve `null` y el drawer cae a su suelo local, que este candidato
    // —nacido en Apollo— no cumple.
    mockLegacyPreview.mock.mockImplementation(async () => null);
    await renderSheet(luisCandidate());
    assert.equal(legacyButton(), null);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });

  it('si el servidor dice NO elegible, tampoco se ofrece', async () => {
    mockLegacyPreview.mock.mockImplementation(async () =>
      legacyPreview({
        eligible: false,
        reason: 'missing_lusha_contact_id',
        requiresIdentitySearch: false,
        maxCredits: 5,
      }),
    );
    await renderSheet(luisCandidate());
    assert.equal(legacyButton(), null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Copy: 6 créditos desglosados, y Apollo ya consultado
// ═══════════════════════════════════════════════════════════════

describe('LEGACY-XP UI — el copy dice 6 y nunca los 8 de Apollo', () => {
  it('lee «hasta 6 créditos», desglosado en búsqueda 1 + teléfono 5', async () => {
    await renderSheet(luisCandidate());
    const text = bodyText();
    assert.ok(/hasta 6 créditos/i.test(text), text);
    assert.ok(/búsqueda hasta 1/i.test(text), text);
    assert.ok(/teléfono hasta 5/i.test(text), text);
  });

  it('dice que Apollo ya fue consultado y que NO se volverá a consultar', async () => {
    await renderSheet(luisCandidate());
    const text = bodyText();
    assert.ok(/Apollo ya fue consultado/i.test(text), text);
    assert.ok(/No se volverá a consultar/i.test(text), text);
    assert.equal(/Revelar teléfono con Apollo/i.test(text), false, text);
  });

  it('no muestra 14 ni 13 en ninguna parte', async () => {
    await renderSheet(luisCandidate());
    const text = bodyText();
    assert.equal(/\b14\b/.test(text), false, text);
    assert.equal(/\b13\b/.test(text), false, text);
  });

  it('con la identidad ya persistida el copy baja a 5 y deja de pedir la búsqueda', async () => {
    mockLegacyPreview.mock.mockImplementation(async () =>
      legacyPreview({ requiresIdentitySearch: false, maxCredits: 5 }),
    );
    await renderSheet(luisCandidate());
    const text = bodyText();
    assert.ok(/hasta 5 créditos/i.test(text), text);
    assert.equal(/búsqueda hasta 1/i.test(text), false, text);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. El techo viaja con el clic
// ═══════════════════════════════════════════════════════════════

describe('LEGACY-XP UI — el clic envía el techo que la persona leyó', () => {
  it('un clic invoca la acción legacy con el id y `acceptedMaxCredits: 6`', async () => {
    await renderSheet(luisCandidate());
    await act(async () => {
      fireEvent.click(legacyButton()!);
    });
    assert.equal(mockLegacyStart.mock.callCount(), 1);
    assert.deepEqual(mockLegacyStart.mock.calls[0].arguments[0], {
      candidateId: 'cand-luis',
      acceptedMaxCredits: 6,
    });
    // CERO Apollo desde esta UI, y cero fallback manual de Lusha.
    assert.equal(mockReveal.mock.callCount(), 0);
    assert.equal(mockLushaFallback.mock.callCount(), 0);
  });

  it('con la identidad persistida se envía 5, no 6', async () => {
    mockLegacyPreview.mock.mockImplementation(async () =>
      legacyPreview({ requiresIdentitySearch: false, maxCredits: 5 }),
    );
    await renderSheet(luisCandidate());
    await act(async () => {
      fireEvent.click(legacyButton()!);
    });
    assert.deepEqual(mockLegacyStart.mock.calls[0].arguments[0], {
      candidateId: 'cand-luis',
      acceptedMaxCredits: 5,
    });
  });

  it('dos clics en el MISMO tick producen UNA sola autorización', async () => {
    await renderSheet(luisCandidate());
    const button = legacyButton()!;
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    assert.equal(mockLegacyStart.mock.callCount(), 1);
  });

  it('techo obsoleto ⇒ aviso, y la vista previa se vuelve a pedir', async () => {
    mockLegacyStart.mock.mockImplementation(async () => ({
      status: 'authorization_changed',
      reason: 'authorization_ceiling_mismatch',
      maxCreditsAuthorized: null,
      requiredMaxCredits: 6,
    }));
    await renderSheet(luisCandidate());
    const previewCallsBefore = mockLegacyPreview.mock.callCount();
    await act(async () => {
      fireEvent.click(legacyButton()!);
    });
    await act(async () => {
      await Promise.resolve();
    });
    assert.ok(/autorización/i.test(bodyText()), bodyText());
    assert.ok(
      mockLegacyPreview.mock.callCount() > previewCallsBefore,
      'la vista previa manda en el número: se vuelve a pedir antes del siguiente clic',
    );
  });
});
