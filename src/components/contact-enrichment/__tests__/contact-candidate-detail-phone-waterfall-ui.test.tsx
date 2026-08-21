/**
 * Tests — UI del waterfall Apollo → Lusha en el sidepanel del candidato
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-1)
 *
 * Contrato de UX que se verifica:
 *   * flag OFF ⇒ UI anterior intacta: reveal Apollo one-click (sin modal) y botón
 *     manual de Lusha cuando aplica;
 *   * flag ON + admin ⇒ UN solo botón "Revelar teléfono" que EJECUTA en un clic
 *     (AGENT2A-PHONE-WATERFALL-4D: ya no hay modal ni «Confirmar y revelar»), con
 *     copy 13 con id Lusha y 8 sin él, y NINGÚN botón separado de Lusha;
 *   * flag ON + commercial_manager ⇒ Apollo-only (el rol no autorizado no ve el
 *     waterfall y no puede gastar la 2ª pata);
 *   * estados intermedios y terminales por corrida;
 *   * bloque de auditoría por proveedor con costos SEPARADOS;
 *   * no se puede aprobar el candidato mientras la corrida no sea terminal.
 *
 * Render real de React (jsdom + @testing-library/react). NO toca el servidor, NO
 * llama proveedores, NO escribe en DB y NO revela teléfonos reales: los server
 * actions están mockeados.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que los tests 3D.4 / L3 / cache-ui) ─────────

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

// Ruta legacy (AGENT2A-PHONE-WATERFALL-2). Se mockea para que esta suite siga siendo
// hermética Y para poder afirmar que en el waterfall NORMAL nunca se invoca: la
// autorización legacy solo debe existir para candidatos legacy.
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
const LUSHA_BUTTON_LABEL = 'Revelar teléfono con Lusha';

/** Candidato Lusha sin teléfono, listo para un reveal (pata Lusha posible). */
function lushaCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-waterfall',
    full_name: 'Contacto De Prueba',
    title: 'Cargo de prueba',
    email: 'contacto@ejemplo.test',
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
    enrichment_run_id: 'run-waterfall',
    created_at: '2026-08-03T11:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

/** Candidato Apollo: sin id Lusha reutilizable ⇒ Apollo-only, tope 8. */
function apolloCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return lushaCandidate({
    source: 'apollo',
    source_contact_id: '0123456789abcdef01234567',
    ...overrides,
  });
}

function auditView(
  overrides: Partial<PhoneRevealWaterfallAuditView> = {},
): PhoneRevealWaterfallAuditView {
  return {
    status: 'apollo_in_flight',
    // Default explícito: esta suite describe el waterfall completo, así que sus
    // aserciones no cambian de significado al añadirse la modalidad legacy
    // (AGENT2A-PHONE-WATERFALL-2). El caso legacy tiene su propia suite.
    runMode: 'full_waterfall',
    isTerminal: false,
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
      phoneRevealWaterfallEnabled={props.waterfallEnabled ?? false}
      phoneRevealWaterfallAuthorized={props.waterfallAuthorized ?? false}
    />,
  );
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
  // La auditoría se pide en paralelo al candidato: se deja resolver.
  await act(async () => {
    await Promise.resolve();
  });
}

function revealButton() {
  return screen.queryByRole('button', { name: REVEAL_LABEL });
}

function lushaButton() {
  return screen.queryByRole('button', { name: LUSHA_BUTTON_LABEL });
}

function approveButton() {
  return screen.queryByRole('button', { name: /Aprobar candidato/ });
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
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
  mockLegacyStart.mock.mockImplementation(async () => ({
    status: 'not_eligible',
    reason: 'apollo_not_exhausted',
    maxCreditsAuthorized: null,
  }));
  mockReveal.mock.mockImplementation(async () => ({
    ok: true,
    status: 'requested',
    requestAccepted: true,
    errorCode: null,
  }));
  mockAudit.mock.mockImplementation(async () => null);
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// 1. Flag OFF: la UI anterior queda intacta
// ═══════════════════════════════════════════════════════════════

describe('waterfall UI — flag OFF', () => {
  it('el reveal Apollo sigue siendo one-click (sin modal) con el copy de 8 créditos', async () => {
    await renderSheet(lushaCandidate(), { waterfallEnabled: false });
    const button = revealButton();
    assert.ok(button, 'debe ofrecerse el reveal Apollo');
    assert.ok(bodyText().includes('Consulta individual con Apollo'));
    assert.ok(bodyText().includes('hasta 8 créditos'));

    await act(async () => {
      fireEvent.click(button!);
    });
    // One-click: la acción se dispara sin diálogo intermedio.
    assert.equal(mockReveal.mock.callCount(), 1);
    const payload = mockReveal.mock.calls[0].arguments[0] as { expectedMaxCredits: number };
    assert.equal(payload.expectedMaxCredits, 8);
  });

  it('NO pide la auditoría del waterfall (ninguna llamada extra)', async () => {
    await renderSheet(lushaCandidate(), { waterfallEnabled: false });
    assert.equal(mockAudit.mock.callCount(), 0);
  });

  it('conserva el one-click de 8 SIN el desglose de 4B: no hay modal que desglosar', async () => {
    // Con el flag apagado no existe waterfall, así que tampoco existe una 2ª pata
    // que autorizar: el desglose por proveedor y el total de 13 no pueden aparecer.
    await renderSheet(lushaCandidate(), { waterfallEnabled: false });
    const text = bodyText();
    assert.ok(text.includes('hasta 8 créditos'));
    assert.equal(/Apollo: hasta 8 créditos/.test(text), false, text);
    assert.equal(/Lusha: hasta 5 créditos/.test(text), false, text);
    assert.equal(/Máximo total autorizado/.test(text), false, text);
    assert.equal(/13/.test(text), false, text);
    // Y sigue sin haber paso de confirmación: el clic gasta directo, como antes.
    // (El propio sidepanel es un Sheet con role="dialog", así que lo que distingue
    // "hay modal" de "no hay modal" es el botón de confirmar, no el rol ARIA.)
    assert.equal(screen.queryByRole('button', { name: 'Confirmar y revelar' }), null);
    await act(async () => {
      fireEvent.click(revealButton()!);
    });
    assert.equal(screen.queryByRole('button', { name: 'Confirmar y revelar' }), null);
    assert.equal(mockReveal.mock.callCount(), 1);
    const payload = mockReveal.mock.calls[0].arguments[0] as { expectedMaxCredits: number };
    assert.equal(payload.expectedMaxCredits, 8);
  });

  it('conserva el botón manual de Lusha tras un no_phone_found de Apollo', async () => {
    await renderSheet(
      lushaCandidate({ phone_reveal_status: 'no_phone_found' }),
      { waterfallEnabled: false },
    );
    assert.ok(lushaButton(), 'el botón manual de Lusha debe seguir disponible');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Flag ON + admin: un botón, un modal
// ═══════════════════════════════════════════════════════════════

describe('waterfall UI — flag ON con rol admin', () => {
  it('un SOLO botón "Revelar teléfono" y ningún botón separado de Lusha', async () => {
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    assert.equal(screen.getAllByRole('button', { name: REVEAL_LABEL }).length, 1);
    assert.equal(lushaButton(), null, 'no debe haber un segundo botón de Lusha');
  });

  // AGENT2A-PHONE-WATERFALL-4D: el clic EJECUTA. No hay modal intermedio, así que la
  // información de proveedores y costo tiene que estar visible ANTES del clic.
  it('el flujo y el tope se leen ANTES del clic, sin abrir nada', async () => {
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    const text = bodyText();
    assert.ok(text.includes('Apollo se intentará primero'));
    assert.ok(text.includes('SellUp intentará Lusha automáticamente'));
    assert.ok(text.includes('hasta 13 créditos'));
    // Y nada se ha gastado por el simple hecho de abrir el drawer.
    assert.equal(mockReveal.mock.callCount(), 0);
  });

  it('con id Lusha UN clic dispara la acción con expectedMaxCredits=13', async () => {
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    await act(async () => {
      fireEvent.click(revealButton()!);
    });
    assert.equal(mockReveal.mock.callCount(), 1, 'un clic, una corrida');
    const payload = mockReveal.mock.calls[0].arguments[0] as { expectedMaxCredits: number };
    assert.equal(payload.expectedMaxCredits, 13);
    // Y en ningún momento apareció un paso de confirmación.
    assert.equal(screen.queryByRole('button', { name: 'Confirmar y revelar' }), null);
  });

  it('sin id Lusha dice hasta 8, no menciona Lusha ni 13, y envía 8 en un clic', async () => {
    await renderSheet(apolloCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    const text = bodyText();
    assert.ok(text.includes('Consulta individual con Apollo'));
    assert.ok(text.includes('hasta 8 créditos'));
    assert.equal(text.includes('hasta 13 créditos'), false);
    assert.equal(/Lusha/.test(text), false, text);

    await act(async () => {
      fireEvent.click(revealButton()!);
    });
    assert.equal(mockReveal.mock.callCount(), 1);
    const payload = mockReveal.mock.calls[0].arguments[0] as { expectedMaxCredits: number };
    assert.equal(payload.expectedMaxCredits, 8);
  });

  it('advierte que no se escribe HubSpot y que es individual, debajo del botón', async () => {
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    const text = bodyText();
    assert.ok(text.includes('No se escribirá en HubSpot automáticamente'));
    assert.ok(text.includes('acción individual, no masiva'));
    assert.ok(text.includes('tipo de teléfono puede quedar como desconocido'));
  });

  it('no existe ningún paso de confirmación ni de cancelación', async () => {
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    assert.equal(screen.queryByRole('button', { name: 'Confirmar y revelar' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Cancelar' }), null);
  });

  it('tras un no_phone_found de Apollo NO reaparece el botón manual de Lusha', async () => {
    await renderSheet(lushaCandidate({ phone_reveal_status: 'no_phone_found' }), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    assert.equal(lushaButton(), null, 'la 2ª pata es automática: no hay segundo clic');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 bis. Consentimiento DEBAJO DEL BOTÓN (4B, movido en 4D)
// ═══════════════════════════════════════════════════════════════

/**
 * La autorización completa gasta 13 créditos y DOS proveedores. Al eliminarse el
 * modal (AGENT2A-PHONE-WATERFALL-4D) todo su contenido —desglose por pata, total y
 * advertencias— se lee AHORA debajo del botón, ANTES del clic: un consentimiento que
 * solo apareciera después del clic no sería consentimiento.
 *
 * Lo que se fija aquí es el contenido tal como se renderiza — no el objeto de copy —
 * y que abrir el drawer siga sin tener ningún efecto: ni corrida, ni proveedor, ni
 * crédito.
 */
describe('waterfall UI — consentimiento debajo del botón (4B/4D)', () => {
  async function renderFullWaterfall() {
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
  }

  it('desglosa la pata Apollo: hasta 8 créditos', async () => {
    await renderFullWaterfall();
    assert.ok(/Apollo: hasta 8 créditos\./.test(bodyText()), bodyText());
  });

  it('desglosa la pata Lusha: hasta 5 créditos', async () => {
    await renderFullWaterfall();
    assert.ok(/Lusha: hasta 5 créditos\./.test(bodyText()), bodyText());
  });

  it('declara el máximo TOTAL autorizado: 13 créditos', async () => {
    await renderFullWaterfall();
    assert.ok(/Máximo total autorizado: 13 créditos\./.test(bodyText()), bodyText());
  });

  it('advierte que no se garantiza encontrar un teléfono', async () => {
    await renderFullWaterfall();
    assert.ok(/No se garantiza encontrar un teléfono\./.test(bodyText()), bodyText());
  });

  it('advierte que no se creará un contacto oficial automáticamente', async () => {
    await renderFullWaterfall();
    assert.ok(
      /No se creará un contacto oficial automáticamente\./.test(bodyText()),
      bodyText(),
    );
  });

  it('advierte que no se escribirá en HubSpot automáticamente', async () => {
    await renderFullWaterfall();
    assert.ok(/No se escribirá en HubSpot automáticamente\./.test(bodyText()), bodyText());
  });

  it('abrir el drawer NO crea una corrida ni llama a ningún proveedor', async () => {
    await renderFullWaterfall();
    assert.equal(mockReveal.mock.callCount(), 0, 'Apollo no se llama al abrir');
    assert.equal(mockLushaFallback.mock.callCount(), 0);
    assert.equal(mockLegacyStart.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Flag ON + commercial_manager (rol no autorizado)
// ═══════════════════════════════════════════════════════════════

describe('waterfall UI — flag ON con rol NO autorizado', () => {
  it('conserva el flujo Apollo-only: one-click, copy 8, sin auditoría', async () => {
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      // El server component resuelve false para commercial_manager.
      waterfallAuthorized: false,
    });
    assert.ok(bodyText().includes('Consulta individual con Apollo'));
    assert.ok(bodyText().includes('hasta 8 créditos'));
    await act(async () => {
      fireEvent.click(revealButton()!);
    });
    assert.equal(mockReveal.mock.callCount(), 1, 'one-click, sin modal');
    const payload = mockReveal.mock.calls[0].arguments[0] as { expectedMaxCredits: number };
    assert.equal(payload.expectedMaxCredits, 8);
    assert.equal(mockAudit.mock.callCount(), 0);
  });

  it('NO recibe la pata Lusha: ni desglose de Lusha ni total de 13 en pantalla', async () => {
    // El candidato SÍ tiene id Lusha reutilizable: lo que lo deja fuera de la 2ª
    // pata es el rol, no el dato. Si el desglose de 4B se escapara al flujo
    // Apollo-only, el rol no autorizado estaría leyendo una autorización de 13 que
    // nunca va a poder dar.
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: false,
    });
    const text = bodyText();
    assert.equal(/Lusha: hasta 5 créditos/.test(text), false, text);
    assert.equal(/Máximo total autorizado/.test(text), false, text);
    assert.equal(/13/.test(text), false, text);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Estados de la corrida
// ═══════════════════════════════════════════════════════════════

describe('waterfall UI — estados', () => {
  async function renderWithAudit(
    audit: PhoneRevealWaterfallAuditView,
    candidate: PendingContactCandidate = lushaCandidate({
      phone_reveal_status: 'no_phone_found',
    }),
  ) {
    mockAudit.mock.mockImplementation(async () => audit);
    await renderSheet(candidate, { waterfallEnabled: true, waterfallAuthorized: true });
  }

  it('Apollo en vuelo: "Apollo está procesando el resultado."', async () => {
    await renderWithAudit(
      auditView({ status: 'apollo_in_flight' }),
      lushaCandidate({ phone_reveal_status: 'requested' }),
    );
    assert.ok(bodyText().includes('Apollo está procesando el resultado.'));
  });

  it('pata Lusha en curso: "Apollo no encontró un teléfono. SellUp está intentando Lusha."', async () => {
    await renderWithAudit(
      auditView({ status: 'lusha_running', apolloOutcome: 'no_phone_found' }),
    );
    assert.ok(
      bodyText().includes('Apollo no encontró un teléfono. SellUp está intentando Lusha.'),
    );
  });

  it('revelado (por Apollo): un solo estado terminal con teléfono', async () => {
    await renderWithAudit(
      auditView({
        status: 'completed_apollo',
        isTerminal: true,
        apolloOutcome: 'revealed',
        finalProvider: 'apollo',
      }),
    );
    const text = bodyText();
    assert.ok(text.includes('Teléfono revelado.'));
    // La atribución no desaparece: vive en el bloque de auditoría.
    assert.ok(text.includes('Proveedor final'));
    assert.ok(text.includes('Apollo'));
  });

  it('revelado (por Lusha): mismo estado, atribución en la auditoría', async () => {
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
    const text = bodyText();
    assert.ok(text.includes('Teléfono revelado.'));
    assert.ok(text.includes('Proveedor final'));
    assert.ok(text.includes('Lusha'));
  });

  it('agotado: "Teléfono no disponible."', async () => {
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
    assert.ok(bodyText().includes('Teléfono no disponible.'));
  });

  it('error controlado: no dice "no existe teléfono"', async () => {
    await renderWithAudit(
      auditView({ status: 'error', isTerminal: true, finalProvider: 'none' }),
    );
    const text = bodyText();
    assert.ok(text.includes('No fue posible completar la revelación de teléfono'));
    assert.equal(text.includes('Teléfono no disponible.'), false);
  });

  it('cierre por privacidad: lo dice explícitamente', async () => {
    await renderWithAudit(
      auditView({
        status: 'aborted',
        isTerminal: true,
        apolloOutcome: 'blocked_suppressed',
        lushaSkippedReason: 'suppressed',
        finalProvider: 'none',
      }),
    );
    assert.ok(bodyText().includes('restricción de privacidad'));
  });

  // ── CASO B: la comprobación de supresión no estuvo disponible ────

  it('supresión NO verificable: dice que no se pudo verificar y que Lusha no corrió', async () => {
    await renderWithAudit(
      auditView({
        status: 'error',
        isTerminal: true,
        apolloOutcome: 'suppression_check_unavailable',
        lushaSkippedReason: 'suppression_check_unavailable',
        lushaAttempted: false,
        lushaCostCredits: null,
        lushaCostSource: 'unknown',
        finalProvider: 'none',
      }),
    );
    const text = bodyText();

    // 1. Dice exactamente qué pasó.
    assert.ok(text.includes('No se pudo verificar la supresión'), text);
    assert.ok(text.includes('Lusha no fue ejecutado'), text);

    // 2. NO afirma que el candidato esté suprimido.
    assert.equal(/suprimid/i.test(text), false, 'no puede decir "suprimido"');
    assert.equal(
      text.includes('restricción de privacidad registrada para este contacto'),
      false,
      'no puede reusar el copy de supresión confirmada',
    );

    // 3. No degrada al copy genérico de error.
    assert.equal(
      text.includes('No fue posible completar la revelación de teléfono'),
      false,
    );

    // 4. Nunca muestra un costo 0 para Lusha: el costo es desconocido.
    assert.equal(text.includes('0 créditos'), false, 'no puede mostrar costo 0');
  });

  it('supresión NO verificable: la fila de auditoría de Lusha explica la omisión', async () => {
    await renderWithAudit(
      auditView({
        status: 'error',
        isTerminal: true,
        apolloOutcome: 'suppression_check_unavailable',
        lushaSkippedReason: 'suppression_check_unavailable',
        lushaAttempted: false,
        lushaCostCredits: null,
        lushaCostSource: 'unknown',
        finalProvider: 'none',
      }),
    );
    const text = bodyText();
    assert.ok(text.includes('Revelación de teléfono por proveedor'));
    assert.ok(
      text.includes('Omitida: no se pudo verificar la supresión'),
      'la fila de Lusha debe explicar por qué se omitió',
    );
    // Proveedor final "Ninguno", y ningún costo de Lusha en 0.
    assert.ok(text.includes('Ninguno'));
    assert.equal(text.includes('0 créditos'), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Bloque de auditoría por proveedor
// ═══════════════════════════════════════════════════════════════

describe('waterfall UI — auditoría por proveedor', () => {
  it('muestra intento, resultado y costo de CADA pata, más proveedor final y tope', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'completed_lusha',
        isTerminal: true,
        apolloAttempted: true,
        apolloOutcome: 'no_phone_found',
        apolloCostCredits: 0,
        apolloCostSource: 'reported',
        lushaAttempted: true,
        lushaOutcome: 'revealed',
        lushaCostCredits: 5,
        lushaCostSource: 'reported',
        finalProvider: 'lusha',
      }),
    );
    await renderSheet(lushaCandidate({ phone_reveal_status: 'no_phone_found' }), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    const text = bodyText();
    assert.ok(text.includes('Revelación de teléfono por proveedor'));
    assert.ok(text.includes('Apollo'));
    assert.ok(text.includes('Lusha'));
    assert.ok(text.includes('Sin teléfono'), 'resultado de la pata Apollo');
    assert.ok(text.includes('Teléfono encontrado'), 'resultado de la pata Lusha');
    assert.ok(text.includes('0 créditos'), 'costo de Apollo, en su propia línea');
    assert.ok(text.includes('5 créditos'), 'costo de Lusha, en su propia línea');
    assert.ok(text.includes('Proveedor final'));
    assert.ok(text.includes('13 créditos'), 'máximo autorizado');
  });

  it('explica por qué se OMITIÓ la pata Lusha', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'exhausted',
        isTerminal: true,
        apolloOutcome: 'no_phone_found',
        lushaEligible: false,
        lushaAttempted: false,
        lushaSkippedReason: 'missing_lusha_contact_id',
        finalProvider: 'none',
        maxCreditsAuthorized: 8,
      }),
    );
    await renderSheet(apolloCandidate({ phone_reveal_status: 'no_phone_found' }), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    const text = bodyText();
    assert.ok(text.includes('no tiene identificador Lusha reutilizable'));
    assert.ok(text.includes('Ninguno'), 'proveedor final none');
  });

  it('un costo no reportado se muestra como "no reportado", nunca como 0', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'error',
        isTerminal: true,
        apolloOutcome: 'error',
        apolloCostCredits: null,
        apolloCostSource: 'unknown',
        finalProvider: 'none',
      }),
    );
    await renderSheet(lushaCandidate({ phone_reveal_status: 'no_phone_found' }), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    assert.ok(bodyText().includes('costo no reportado'));
  });

  it('sin corrida NO se muestra el bloque de auditoría', async () => {
    mockAudit.mock.mockImplementation(async () => null);
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    assert.equal(bodyText().includes('Revelación de teléfono por proveedor'), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Gate de aprobación
// ═══════════════════════════════════════════════════════════════

describe('waterfall UI — no aprobar mientras la corrida no sea terminal', () => {
  it('bloquea aprobar y lo explica cuando la corrida sigue viva', async () => {
    for (const status of ['apollo_in_flight', 'lusha_pending', 'lusha_running'] as const) {
      cleanup();
      mockAudit.mock.mockImplementation(async () =>
        auditView({ status, isTerminal: false }),
      );
      await renderSheet(lushaCandidate({ phone_reveal_status: 'requested' }), {
        waterfallEnabled: true,
        waterfallAuthorized: true,
      });
      const approve = approveButton();
      assert.ok(approve, `botón de aprobar presente (${status})`);
      assert.equal(
        (approve as HTMLButtonElement).disabled,
        true,
        `aprobar debe estar bloqueado en ${status}`,
      );
      assert.ok(
        bodyText().includes('La revelación de teléfono sigue en proceso'),
        `debe explicar el bloqueo en ${status}`,
      );
    }
  });

  it('permite aprobar cuando la corrida ya es terminal', async () => {
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'completed_apollo',
        isTerminal: true,
        apolloOutcome: 'revealed',
        finalProvider: 'apollo',
      }),
    );
    await renderSheet(lushaCandidate({ phone: '+573001112233' }), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    const approve = approveButton();
    assert.ok(approve);
    assert.equal((approve as HTMLButtonElement).disabled, false);
    assert.equal(bodyText().includes('La revelación de teléfono sigue en proceso'), false);
  });

  it('supresión NO verificable: la corrida ES terminal, así que ya no bloquea aprobar', async () => {
    // El gate existe para no aprobar mientras se está pagando por un teléfono que
    // todavía puede llegar. Aquí la corrida se cerró sin gastar la 2ª pata: no hay
    // nada en vuelo, así que el operador puede decidir. Si quiere el teléfono,
    // tendrá que AUTORIZAR una revelación nueva.
    mockAudit.mock.mockImplementation(async () =>
      auditView({
        status: 'error',
        isTerminal: true,
        apolloOutcome: 'suppression_check_unavailable',
        lushaSkippedReason: 'suppression_check_unavailable',
        finalProvider: 'none',
      }),
    );
    await renderSheet(lushaCandidate({ phone_reveal_status: 'no_phone_found' }), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    const approve = approveButton();
    assert.ok(approve);
    assert.equal((approve as HTMLButtonElement).disabled, false);
    assert.equal(bodyText().includes('La revelación de teléfono sigue en proceso'), false);
  });

  it('con el flag OFF el gate no existe (comportamiento anterior)', async () => {
    await renderSheet(lushaCandidate({ phone_reveal_status: 'requested' }), {
      waterfallEnabled: false,
    });
    const approve = approveButton();
    assert.ok(approve);
    assert.equal((approve as HTMLButtonElement).disabled, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Infraestructura del waterfall NO DISPONIBLE (AGENT2A-PHONE-WATERFALL-2A)
// ═══════════════════════════════════════════════════════════════

/**
 * El servidor no pudo crear la corrida de auditoría, así que NO ejecutó ningún
 * proveedor. El operador tiene que entender exactamente eso: el proceso no
 * arrancó, ni Apollo ni Lusha corrieron, no se cobró nada, y puede reintentar.
 *
 * Lo que la UI NO puede decir aquí: que no se encontró teléfono (no se buscó), que
 * Apollo falló (Apollo no participó), que algo costó 0 (nadie cobró porque nadie
 * corrió), que hubo un éxito parcial, ni que existe una corrida.
 */
describe('waterfall UI — infraestructura de auditoría no disponible', () => {
  const INFRA_RESULT = {
    ok: false,
    status: 'waterfall_infrastructure_unavailable',
    requestAccepted: false,
    errorCode: 'waterfall_run_unavailable',
  };

  async function revealWithInfraFailure() {
    mockReveal.mock.mockImplementation(async () => INFRA_RESULT);
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    // 4D: un solo clic, sin confirmación intermedia.
    await act(async () => {
      fireEvent.click(revealButton()!);
    });
  }

  it('muestra el copy de infraestructura no disponible al operador', async () => {
    await revealWithInfraFailure();
    const text = bodyText();
    assert.ok(
      text.includes('No se pudo iniciar la revelación segura'),
      'el operador debe ver que el proceso NO pudo iniciarse',
    );
    assert.ok(
      text.includes('servicio de auditoría no está disponible'),
      'debe explicar la causa: la auditoría, no el proveedor',
    );
    assert.ok(text.includes('Intenta nuevamente más tarde'), 'es reintentable');
  });

  it('el copy confirma CERO proveedores ejecutados', async () => {
    await revealWithInfraFailure();
    const text = bodyText();
    assert.ok(text.includes('No se ejecutó Apollo'), 'Apollo no fue ejecutado');
    assert.ok(text.includes('no se ejecutó Lusha'), 'Lusha no fue ejecutado');
  });

  it('el copy confirma CERO créditos consumidos', async () => {
    await revealWithInfraFailure();
    assert.ok(bodyText().includes('no se consumieron créditos'));
  });

  it('NO lo representa como un error de Apollo ni como "sin teléfono"', async () => {
    await revealWithInfraFailure();
    const text = bodyText();
    // Nada de atribuir el fallo a Apollo ni de afirmar que se buscó y no había.
    assert.equal(text.includes('Teléfono no disponible tras consultar Apollo'), false);
    assert.equal(text.includes('Apollo no encontró teléfono'), false);
    assert.equal(text.includes('Sin teléfono'), false);
    assert.equal(text.includes('Revelación solicitada'), false);
    // Y ningún costo atribuido a un proveedor: nadie corrió, nadie cobró.
    assert.equal(text.includes('0 créditos'), false);
    assert.equal(text.includes('costo no reportado'), false);
  });

  it('NO muestra auditoría de una corrida inexistente', async () => {
    await revealWithInfraFailure();
    const text = bodyText();
    assert.equal(text.includes('Consultando Apollo'), false);
    assert.equal(text.includes('consultando Lusha'), false);
    assert.equal(text.includes('Omitida'), false);
    assert.equal(text.includes('Proveedor final'), false);
  });

  it('el error es VISIBLE en pantalla, no solo en console.error', async () => {
    await revealWithInfraFailure();
    // Se renderiza en el slot de error del bloque de reveal (estilo destructivo),
    // que es la afordancia de error que el operador ya reconoce en este panel: el
    // mensaje no puede quedarse únicamente en el log del navegador.
    const destructive = Array.from(
      document.querySelectorAll('.text-destructive'),
    ).map((el) => (el.textContent ?? '').replace(/\s+/g, ' '));
    assert.ok(
      destructive.some((t) => t.includes('No se pudo iniciar la revelación segura')),
      'el copy debe aparecer en el slot de error visible',
    );
  });

  it('no recarga el candidato: no se persistió nada', async () => {
    mockReveal.mock.mockImplementation(async () => INFRA_RESULT);
    await renderSheet(lushaCandidate(), {
      waterfallEnabled: true,
      waterfallAuthorized: true,
    });
    const loadsBefore = mockGetById.mock.callCount();
    await act(async () => {
      fireEvent.click(revealButton()!);
    });
    assert.equal(
      mockGetById.mock.callCount(),
      loadsBefore,
      'sin escrituras no hay nada nuevo que releer',
    );
  });

  it('el botón sigue disponible para reintentar', async () => {
    await revealWithInfraFailure();
    const button = revealButton();
    assert.ok(button, 'el operador puede volver a autorizar más tarde');
    assert.equal((button as HTMLButtonElement).disabled, false);
  });
});
