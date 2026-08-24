/**
 * Tests de UI — el waterfall es el comportamiento NORMAL del botón, y el copy dice
 * la verdad sobre el tope (Agente 2A · AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1)
 *
 * Contrato verificado:
 *   * § 11.H — PARIDAD UI/SERVIDOR: para el MISMO actor, el MISMO candidato y el
 *     MISMO flag, la UI no puede discrepar del servidor sobre la autorización. El
 *     drawer no recalcula la modalidad: la LEE del servidor, que la resuelve con el
 *     mismo core puro que reserva los créditos.
 *   * Caso A — flag OFF ⇒ Apollo-only, hasta 8, sin mencionar Lusha.
 *   * Caso B — flag ON + identidad Lusha persistida ⇒ Apollo + reveal Lusha, 13.
 *   * Caso C — flag ON + candidato Apollo SIN identidad persistida pero con
 *     identificador exacto ⇒ Apollo + búsqueda (1) + reveal (5), 14.
 *   * § 6 — sin respuesta del servidor NO se promete 14: el copy cae al conservador.
 *   * el rol ya no parte el producto: `commercial_manager` ve exactamente lo mismo
 *     que `admin` (el server component resuelve la MISMA autorización para los dos).
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
import type {
  PhoneRevealWaterfallAuditView,
  PhoneRevealWaterfallAuthorizationPreview,
} from '@/modules/contact-enrichment/phone-reveal-waterfall-core';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Mocks de boundary ─────────────────────────────────────────────────────────

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockReveal = mock.fn<(input: unknown) => Promise<unknown>>();
const mockLegacyStart = mock.fn<(input: unknown) => Promise<unknown>>();
const mockPreview = mock.fn<
  (input: { candidateId: string }) => Promise<PhoneRevealWaterfallAuthorizationPreview | null>
>();

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
    revealCandidatePhoneViaLushaFallbackAction: async () => ({
      ok: true,
      status: 'revealed',
      errorCode: null,
    }),
  },
});

// La acción de auditoría devuelve `null` en toda esta suite: lo que se mide es el
// copy ANTES del clic, y una corrida viva lo sustituiría por estados de progreso.
mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-actions', {
  namedExports: {
    getPhoneRevealWaterfallAuditAction: async (): Promise<PhoneRevealWaterfallAuditView | null> =>
      null,
    getPhoneRevealWaterfallAuthorizationPreviewAction: (...args: unknown[]) =>
      mockPreview(...(args as [{ candidateId: string }])),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * «Candidato Jaime»: nacido en Apollo, con email y LinkedIn, sin teléfono. La UI no
 * puede saber por su cuenta si Lusha ya lo conoce; el servidor sí.
 */
function jaime(overrides: Partial<PendingContactCandidate> = {}): PendingContactCandidate {
  return {
    id: 'cand-jaime',
    full_name: 'Jaime Pruebas',
    title: 'Cargo de prueba',
    email: 'jaime@ejemplo.test',
    linkedin_url: 'https://www.linkedin.com/in/jaime-pruebas',
    source_contact_id: '0123456789abcdef01234567',
    apollo_person_id: '0123456789abcdef01234567',
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-wdrb1',
    created_at: '2026-08-24T11:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

/** Lo que devolvería el servidor para el caso C (búsqueda pagada disponible). */
const PREVIEW_WITH_SEARCH: PhoneRevealWaterfallAuthorizationPreview = {
  lushaEligible: true,
  requiresIdentitySearch: true,
  maxCredits: 14,
};

/** Caso B: la identidad de Lusha ya está persistida, así que no hay que buscarla. */
const PREVIEW_PERSISTED_IDENTITY: PhoneRevealWaterfallAuthorizationPreview = {
  lushaEligible: true,
  requiresIdentitySearch: false,
  maxCredits: 13,
};

/** Caso F: ni identidad persistida ni nada con lo que buscarla. */
const PREVIEW_APOLLO_ONLY: PhoneRevealWaterfallAuthorizationPreview = {
  lushaEligible: false,
  requiresIdentitySearch: false,
  maxCredits: 8,
};

const REVEAL_LABEL = 'Revelar teléfono';

interface RenderProps {
  waterfallEnabled?: boolean;
  /**
   * Lo que el SERVER COMPONENT resolvió. Desde este hito es el MISMO booleano para
   * `phoneRevealAuthorized` y `phoneRevealWaterfallAuthorized`, así que la suite lo
   * pasa una sola vez: poder pasar dos valores distintos es precisamente la
   * divergencia que el hito elimina.
   */
  authorized?: boolean;
}

async function renderSheet(
  candidate: PendingContactCandidate,
  props: RenderProps = {},
) {
  const authorized = props.authorized ?? true;
  mockGetById.mock.mockImplementation(async () => candidate);
  render(
    <ContactCandidateDetailSheet
      candidateId={candidate.id}
      open
      onClose={() => {}}
      phoneRevealEnabled
      phoneRevealAuthorized={authorized}
      lushaPhoneFallbackEnabled={false}
      lushaPhoneFallbackAuthorized={false}
      phoneRevealWaterfallEnabled={props.waterfallEnabled ?? true}
      phoneRevealWaterfallAuthorized={authorized}
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
  // Segundo tick: la vista previa se pide en paralelo al candidato.
  await act(async () => {
    await Promise.resolve();
  });
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function revealButtons() {
  return screen.queryAllByRole('button', { name: REVEAL_LABEL });
}

// ── Setup/Teardown ────────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, waitFor, cleanup, act } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  cleanup();
  mockGetById.mock.resetCalls();
  mockReveal.mock.resetCalls();
  mockLegacyStart.mock.resetCalls();
  mockPreview.mock.resetCalls();
  mockPreview.mock.mockImplementation(async () => PREVIEW_WITH_SEARCH);
  mockReveal.mock.mockImplementation(async () => ({
    ok: true,
    status: 'requested',
    requestAccepted: true,
    errorCode: null,
  }));
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// Caso A — flag OFF: Apollo-only, hasta 8, sin Lusha
// ═══════════════════════════════════════════════════════════════

describe('§ 5 caso A — flag OFF ⇒ Apollo-only, tope 8', () => {
  it('el copy habla solo de Apollo y no pide la vista previa al servidor', async () => {
    await renderSheet(jaime(), { waterfallEnabled: false });
    const text = bodyText();
    assert.ok(text.includes('Consulta individual con Apollo'), text);
    assert.ok(/hasta 8 créditos/.test(text), text);
    assert.equal(/Lusha/.test(text), false, text);
    assert.equal(/13|14/.test(text), false, text);
    // Con el flag apagado no se hace NINGUNA lectura extra.
    assert.equal(mockPreview.mock.callCount(), 0);
  });

  it('el flag apagado es Apollo-only para los DOS roles autorizados', async () => {
    // El server component resuelve la MISMA autorización para admin y para
    // commercial_manager —es el mismo booleano—, así que la única variable que le
    // queda a la UI es el flag: `authorized: true` cubre a los dos roles a la vez.
    for (const attempt of [1, 2]) {
      cleanup();
      await renderSheet(jaime(), { waterfallEnabled: false, authorized: true });
      assert.ok(/hasta 8 créditos/.test(bodyText()), `render ${attempt}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Caso B — identidad Lusha persistida: 13, sin crédito de búsqueda
// ═══════════════════════════════════════════════════════════════

describe('§ 5 caso B — identidad Lusha persistida ⇒ 13', () => {
  it('desglosa Apollo 8 + Lusha 5 y NO pide crédito de búsqueda', async () => {
    mockPreview.mock.mockImplementation(async () => PREVIEW_PERSISTED_IDENTITY);
    await renderSheet(jaime());
    const text = bodyText();
    assert.ok(/hasta 13 créditos/.test(text), text);
    assert.ok(/Apollo: hasta 8 créditos/.test(text), text);
    assert.ok(/Lusha: hasta 5 créditos/.test(text), text);
    assert.ok(/Máximo total autorizado: 13 créditos/.test(text), text);
    // Nada de búsqueda: esa autorización no puede ejecutarla.
    assert.equal(/búsqueda/i.test(text), false, text);
    assert.equal(/14 créditos/.test(text), false, text);
  });

  it('el clic envía 13 como tope aceptado, no 8', async () => {
    mockPreview.mock.mockImplementation(async () => PREVIEW_PERSISTED_IDENTITY);
    await renderSheet(jaime());
    const buttons = revealButtons();
    assert.equal(buttons.length, 1);
    await act(async () => {
      buttons[0].click();
    });
    assert.equal(mockReveal.mock.callCount(), 1);
    const input = mockReveal.mock.calls[0].arguments[0] as { expectedMaxCredits?: number };
    assert.equal(input.expectedMaxCredits, 13);
  });
});

// ═══════════════════════════════════════════════════════════════
// Caso C — el candidato Jaime: 14, con la búsqueda desglosada
// ═══════════════════════════════════════════════════════════════

describe('§ 5 caso C — Apollo sin identidad Lusha + identificador exacto ⇒ 14', () => {
  it('el botón existe y el copy describe Apollo → búsqueda → teléfono', async () => {
    await renderSheet(jaime());
    const text = bodyText();
    assert.equal(revealButtons().length, 1, 'un solo botón «Revelar teléfono»');
    assert.ok(/hasta 14 créditos/.test(text), text);
    assert.ok(/Apollo se intentará primero/.test(text), text);
    assert.ok(/buscará el contacto en Lusha/.test(text), text);
    // Las dos operaciones de Lusha se nombran POR SEPARADO: 1 de búsqueda y 5 de
    // teléfono. Un 6 opaco dejaría al operador autorizando algo que no ve.
    assert.ok(/búsqueda hasta 1/.test(text), text);
    assert.ok(/teléfono hasta 5/.test(text), text);
    assert.ok(/Máximo total autorizado: 14 créditos/.test(text), text);
  });

  it('el clic envía 14 como tope aceptado', async () => {
    await renderSheet(jaime());
    await act(async () => {
      revealButtons()[0].click();
    });
    assert.equal(mockReveal.mock.callCount(), 1);
    const input = mockReveal.mock.calls[0].arguments[0] as { expectedMaxCredits?: number };
    assert.equal(input.expectedMaxCredits, 14);
  });

  it('abrir el drawer no gasta: 0 llamadas a la acción de reveal', async () => {
    await renderSheet(jaime());
    assert.equal(mockReveal.mock.callCount(), 0);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 6 — no se inventa un 14
// ═══════════════════════════════════════════════════════════════

describe('§ 6 — el copy no promete lo que no se puede ejecutar', () => {
  it('el servidor dice «Apollo-only» ⇒ 8, aunque el candidato tenga email y LinkedIn', async () => {
    mockPreview.mock.mockImplementation(async () => PREVIEW_APOLLO_ONLY);
    await renderSheet(jaime());
    const text = bodyText();
    assert.ok(/hasta 8 créditos/.test(text), text);
    assert.equal(/13|14/.test(text), false, text);
    assert.equal(/Lusha/.test(text), false, text);
  });

  it('sin respuesta del servidor cae al copy conservador, nunca a 14', async () => {
    // `null` = flag apagado en el servidor, rol no autorizado o hechos de identidad
    // ilegibles (por ejemplo con la migración 124 sin aplicar).
    mockPreview.mock.mockImplementation(async () => null);
    await renderSheet(jaime());
    const text = bodyText();
    assert.equal(/14 créditos/.test(text), false, text);
    assert.ok(/hasta 8 créditos/.test(text), text);
  });

  it('si la lectura FALLA, el drawer sigue vivo y el copy sigue siendo el conservador', async () => {
    mockPreview.mock.mockImplementation(async () => {
      throw new Error('tabla ausente con detalle del driver');
    });
    await renderSheet(jaime());
    const text = bodyText();
    assert.ok(text.includes('Jaime Pruebas'), 'el candidato se sigue renderizando');
    assert.equal(/14 créditos/.test(text), false, text);
    assert.equal(revealButtons().length, 1, 'el botón no desaparece por eso');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 11.H — paridad UI / servidor
// ═══════════════════════════════════════════════════════════════

describe('§ 11.H — UI y servidor no pueden discrepar', () => {
  it('el tope que se muestra y el que se envía son SIEMPRE el del servidor', async () => {
    const cases: Array<[PhoneRevealWaterfallAuthorizationPreview, number]> = [
      [PREVIEW_WITH_SEARCH, 14],
      [PREVIEW_PERSISTED_IDENTITY, 13],
      [PREVIEW_APOLLO_ONLY, 8],
    ];
    for (const [preview, expected] of cases) {
      cleanup();
      mockReveal.mock.resetCalls();
      mockPreview.mock.mockImplementation(async () => preview);
      await renderSheet(jaime());
      assert.ok(
        new RegExp(`hasta ${expected} créditos`).test(bodyText()),
        `copy para ${expected}`,
      );
      await act(async () => {
        revealButtons()[0].click();
      });
      const input = mockReveal.mock.calls[0].arguments[0] as {
        expectedMaxCredits?: number;
      };
      assert.equal(input.expectedMaxCredits, expected, `envío para ${expected}`);
    }
  });

  it('la UI NO recalcula la modalidad: pregunta por ESTE candidato', async () => {
    await renderSheet(jaime());
    assert.ok(mockPreview.mock.callCount() >= 1);
    assert.equal(mockPreview.mock.calls[0].arguments[0].candidateId, 'cand-jaime');
  });

  it('un actor NO autorizado no ve el botón y no consulta al servidor', async () => {
    // § 11.G en la UI: el mismo booleano gobierna el botón y el waterfall, así que
    // no existe el estado «puede revelar pero no puede usar el waterfall».
    await renderSheet(jaime(), { authorized: false });
    assert.equal(revealButtons().length, 0);
    assert.equal(mockPreview.mock.callCount(), 0);
    assert.equal(mockReveal.mock.callCount(), 0);
  });
});
