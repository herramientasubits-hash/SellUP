/**
 * Agente 2A — REANUDACIÓN DURABLE, en la pantalla
 * (AGENT2A-POST-APPROVAL-REVEAL-DURABLE-RESUME).
 *
 * Render REAL de React (jsdom + @testing-library/react) del CTA del contacto oficial. Lo que hay
 * que demostrar aquí no se puede demostrar en el servidor: que CERRAR y REABRIR la ficha —un
 * desmontaje y un montaje— ya no borra una operación viva.
 *
 * El defecto era exactamente eso. `inFlight` era un `useState` y el cleanup del efecto lo ponía a
 * `false`; al volver, el componente arrancaba creyendo que nunca se había pedido nada y volvía a
 * pintar «Revelar teléfono» sobre una solicitud ya pagada. Un test de servidor no lo habría visto
 * nunca, porque el servidor siempre supo la verdad: era el navegador el que la olvidaba.
 *
 * ── QUÉ SE MOCKEA, Y POR QUÉ ESO NO DEBILITA NADA ───────────────
 *
 * `usePhoneRevealLiveRefresh` se sustituye por un doble que REGISTRA su entrada y devuelve un
 * estado controlado. No se está probando el sondeo —tiene su propio archivo y su propia política
 * de parada, con presupuesto real—: se está probando QUIÉN lo enciende. La afirmación de este
 * corte es «el ciclo arranca porque el SERVIDOR dice que hay algo en vuelo», y eso se mide
 * leyendo el `enabled` con el que el componente lo invoca. Usar el hook real obligaría a esperar
 * 5 segundos de reloj para observar lo mismo, con un test que además fallaría por timing.
 *
 * NO toca el servidor, NO llama proveedores, NO escribe en DB y NO revela teléfonos reales.
 * 0 créditos, 0 escrituras, 0 PII.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que 4O-H4 / 3D.4 / CACHE-1b) ───────────────

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

for (const prop of Object.getOwnPropertyNames(dom.window)) {
  const target = globalThis as unknown as Record<string, unknown>;
  if (prop in target) continue;
  const descriptor = Object.getOwnPropertyDescriptor(
    dom.window as unknown as Record<string, unknown>,
    prop,
  );
  if (descriptor) Object.defineProperty(target, prop, descriptor);
}

// ── Imports dependientes del entorno DOM ─────────────────────────────────────

import * as React from 'react';
import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { OfficialContactPhoneRevealOfferView } from '@/modules/contact-enrichment/post-approval-reveal-core';
import type { UsePhoneRevealLiveRefreshInput } from '@/components/contact-enrichment/use-phone-reveal-live-refresh';
import {
  OFFICIAL_REVEAL_BUY_LABEL,
  OFFICIAL_REVEAL_IN_FLIGHT_COPY,
  OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY,
  OFFICIAL_REVEAL_NO_PHONE_COPY,
  OFFICIAL_REVEAL_REUSE_LABEL,
  OFFICIAL_REVEAL_TERMINAL_FAILURE_COPY,
} from '../post-approval-reveal-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Mocks de boundary ────────────────────────────────────────────────────────

const CONTACT_ID = '45959dfa-9607-406e-bcd0-bcb9e78b9d4c';

type StartResult = {
  ok: boolean;
  gate: string;
  revealStatus: string | null;
  projectionStatus: string | null;
  phoneProjected: boolean;
  errorCode: string | null;
  hubspotSyncTransition: string | null;
  hubspotAutoUpdate: null;
};

const mockGetOffer = mock.fn<() => Promise<OfficialContactPhoneRevealOfferView>>();
/** LA acción que puede gastar. Ningún caso de reanudación puede hacer que se llame. */
const mockReveal = mock.fn<() => Promise<StartResult>>();
const mockReconcile = mock.fn<() => Promise<StartResult>>();

mock.module('@/modules/contact-enrichment/post-approval-reveal-actions', {
  namedExports: {
    getOfficialContactPhoneRevealOfferAction: (...a: unknown[]) => mockGetOffer(...(a as [])),
    revealOfficialContactPhoneAction: (...a: unknown[]) => mockReveal(...(a as [])),
    reconcileOfficialContactPhoneFromCandidateAction: (...a: unknown[]) =>
      mockReconcile(...(a as [])),
  },
});

/**
 * Doble del refresco acotado. Registra CON QUÉ lo invoca el componente —que es la medida de «quién
 * enciende el sondeo»— y deja al test decidir el estado del ciclo.
 */
let hookCalls: UsePhoneRevealLiveRefreshInput[] = [];
let hookState: { active: boolean; budgetExhausted: boolean } = {
  active: true,
  budgetExhausted: false,
};

mock.module('@/components/contact-enrichment/use-phone-reveal-live-refresh', {
  namedExports: {
    usePhoneRevealLiveRefresh: (input: UsePhoneRevealLiveRefreshInput) => {
      hookCalls.push(input);
      return input.enabled && input.candidateId ? hookState : { active: false, budgetExhausted: false };
    },
    PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS: 90_000,
  },
});

let OfficialContactPhoneRevealCta: (typeof import('../post-approval-reveal-cta'))['OfficialContactPhoneRevealCta'];

// ── Fixtures ─────────────────────────────────────────────────────────────────

const offerOf = (
  over: Partial<OfficialContactPhoneRevealOfferView>,
): OfficialContactPhoneRevealOfferView => ({
  status: 'eligible',
  actionable: true,
  free: false,
  maxCredits: 14,
  requiresIdentitySearch: true,
  lushaEligible: true,
  ...over,
});

const ELIGIBLE = offerOf({});
const IN_FLIGHT = offerOf({
  status: 'reveal_in_flight',
  actionable: false,
  free: true,
  maxCredits: null,
  requiresIdentitySearch: false,
  lushaEligible: false,
});
const ALREADY_PRESENT = offerOf({
  status: 'phone_already_present',
  actionable: false,
  free: true,
  maxCredits: null,
  requiresIdentitySearch: false,
  lushaEligible: false,
});

const startResult = (over: Partial<StartResult> = {}): StartResult => ({
  ok: true,
  gate: 'delegated',
  revealStatus: 'requested',
  projectionStatus: null,
  phoneProjected: false,
  errorCode: null,
  hubspotSyncTransition: null,
  hubspotAutoUpdate: null,
  ...over,
});

let projectedCount = 0;

function mount() {
  return render(
    React.createElement(OfficialContactPhoneRevealCta, {
      contactId: CONTACT_ID,
      onPhoneProjected: () => {
        projectedCount += 1;
      },
    }),
  );
}

/** El último `enabled` con el que el componente invocó el refresco acotado. */
function lastHookInput(): UsePhoneRevealLiveRefreshInput {
  assert.ok(hookCalls.length > 0, 'el componente ni siquiera invocó el hook');
  return hookCalls[hookCalls.length - 1];
}

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  waitFor = rtl.waitFor;
  fireEvent = rtl.fireEvent;
  cleanup = rtl.cleanup;
  act = rtl.act;
  ({ OfficialContactPhoneRevealCta } = await import('../post-approval-reveal-cta'));
});

beforeEach(() => {
  cleanup?.();
  mockGetOffer.mock.resetCalls();
  mockReveal.mock.resetCalls();
  mockReconcile.mock.resetCalls();
  hookCalls = [];
  hookState = { active: true, budgetExhausted: false };
  projectedCount = 0;
  mockGetOffer.mock.mockImplementation(async () => ELIGIBLE);
  mockReveal.mock.mockImplementation(async () => startResult());
  mockReconcile.mock.mockImplementation(async () =>
    startResult({ ok: false, revealStatus: null, phoneProjected: false }),
  );
});

// ═══════════════════════════════════════════════════════════════════
// TEST 1 / 14 / 15 — lo normal sigue siendo lo normal
// ═══════════════════════════════════════════════════════════════════

describe('durable resume UI — el comportamiento normal no se toca', () => {
  it('TEST 1 — un contacto elegible ofrece «Revelar teléfono»', async () => {
    mount();
    await waitFor(() => assert.ok(screen.getByRole('button', { name: /Revelar teléfono/ })));
    assert.equal(mockReveal.mock.callCount(), 0, 'pintar el botón no compra nada');
  });

  it('TEST 15 — la reutilización sigue ofreciendo su propio botón, sin costo', async () => {
    mockGetOffer.mock.mockImplementation(async () =>
      offerOf({ status: 'reuse_from_candidate', free: true, maxCredits: 0 }),
    );
    mount();
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: new RegExp(OFFICIAL_REVEAL_REUSE_LABEL) })),
    );
    assert.match(document.body.textContent ?? '', /Sin costo/);
  });

  it('con la oferta elegible, el sondeo está APAGADO: no hay nada que esperar', async () => {
    mount();
    await waitFor(() => assert.ok(screen.getByRole('button', { name: /Revelar teléfono/ })));
    assert.equal(lastHookInput().enabled, false);
    assert.equal(lastHookInput().candidateId, null);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2 / 3 / 4 — el clic, el cierre y la reapertura
// ═══════════════════════════════════════════════════════════════════

describe('durable resume UI — cerrar y reabrir NO olvida la solicitud', () => {
  it('TEST 2 — el clic delega UNA vez y el estado pasa a «en vuelo»', async () => {
    // Tras el clic la oferta se RELEE, y el servidor ya devuelve el hecho durable.
    let served = ELIGIBLE;
    mockGetOffer.mock.mockImplementation(async () => served);
    mockReveal.mock.mockImplementation(async () => {
      served = IN_FLIGHT;
      return startResult();
    });

    mount();
    const button = await waitFor(() => screen.getByRole('button', { name: /Revelar teléfono/ }));
    await act(async () => {
      fireEvent.click(button);
    });

    assert.equal(mockReveal.mock.callCount(), 1);
    await waitFor(() => assert.match(document.body.textContent ?? '', /Solicitud enviada/));
    assert.equal(screen.queryByRole('button', { name: /Revelar teléfono/ }), null);
  });

  it('TEST 3 — DESMONTAR y volver a MONTAR: sigue en vuelo y NO hay botón de compra', async () => {
    // Éste es el bug, literalmente. Antes, el cleanup del efecto ponía `inFlight = false` y el
    // montaje siguiente pintaba «Revelar teléfono» sobre una solicitud ya pagada.
    let served: OfficialContactPhoneRevealOfferView = ELIGIBLE;
    mockGetOffer.mock.mockImplementation(async () => served);
    mockReveal.mock.mockImplementation(async () => {
      served = IN_FLIGHT;
      return startResult();
    });

    const first = mount();
    const button = await waitFor(() => screen.getByRole('button', { name: /Revelar teléfono/ }));
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => assert.match(document.body.textContent ?? '', /Solicitud enviada/));

    // Cerrar la ficha.
    first.unmount();
    assert.equal(document.body.textContent, '');

    // Volver a abrirla. El componente nace SIN memoria; el servidor la tiene.
    mount();
    await waitFor(() =>
      assert.match(document.body.textContent ?? '', new RegExp(OFFICIAL_REVEAL_IN_FLIGHT_COPY)),
    );
    assert.equal(
      screen.queryByRole('button', { name: /Revelar teléfono/ }),
      null,
      'reabrir NO puede volver a ofrecer una compra',
    );
    assert.equal(mockReveal.mock.callCount(), 1, 'y sigue habiendo UNA sola compra en total');
  });

  it('TEST 4 — equivalente a RECARGAR el navegador: un montaje limpio reanuda', async () => {
    // Una recarga es un montaje sin ningún estado previo de React. Si el estado en vuelo se
    // deriva del servidor, este caso y el anterior son el mismo hecho.
    mockGetOffer.mock.mockImplementation(async () => IN_FLIGHT);
    mount();
    await waitFor(() =>
      assert.match(document.body.textContent ?? '', new RegExp(OFFICIAL_REVEAL_IN_FLIGHT_COPY)),
    );
    assert.equal(screen.queryByRole('button'), null);
    assert.equal(mockReveal.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5 / 6 — el sondeo arranca solo, y para solo
// ═══════════════════════════════════════════════════════════════════

describe('durable resume UI — el sondeo lo enciende el servidor', () => {
  it('TEST 5 — al montar con estado en vuelo, el refresco acotado arranca', async () => {
    mockGetOffer.mock.mockImplementation(async () => IN_FLIGHT);
    mount();
    await waitFor(() => assert.equal(lastHookInput().enabled, true));
    assert.equal(lastHookInput().candidateId, CONTACT_ID);
  });

  it('TEST 6 — cuando llega el teléfono: se proyecta UNA vez, se para y se avisa a la ficha', async () => {
    let served: OfficialContactPhoneRevealOfferView = IN_FLIGHT;
    mockGetOffer.mock.mockImplementation(async () => served);
    mockReconcile.mock.mockImplementation(async () => {
      // El candidato ya tiene número: la 128 lo proyecta y el contacto pasa a tenerlo.
      served = ALREADY_PRESENT;
      return startResult({ ok: true, revealStatus: null, phoneProjected: true });
    });

    mount();
    await waitFor(() => assert.equal(lastHookInput().enabled, true));

    // Un tick del ciclo: es lo que el hook real haría al vencer su timer.
    await act(async () => {
      await lastHookInput().reload();
    });

    assert.equal(mockReconcile.mock.callCount(), 1, 'UNA reconciliación');
    assert.equal(projectedCount, 1, 'y la ficha se entera exactamente una vez');
    await waitFor(() => assert.equal(lastHookInput().enabled, false), { timeout: 2000 });
    assert.equal(mockReveal.mock.callCount(), 0, 'recoger un teléfono no vuelve a comprarlo');
    assert.match(document.body.textContent ?? '', /ya tiene un teléfono guardado/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 10 / 11 / 12 — los desenlaces terminales apagan el ciclo
// ═══════════════════════════════════════════════════════════════════

describe('durable resume UI — la espera termina, y se dice cómo', () => {
  for (const [label, status, copy] of [
    ['TEST 10 — sin número', 'reveal_terminal_no_phone', OFFICIAL_REVEAL_NO_PHONE_COPY],
    ['TEST 11 — en fallo', 'reveal_terminal_failed', OFFICIAL_REVEAL_TERMINAL_FAILURE_COPY],
  ] as const) {
    it(`${label}: se para el sondeo y se muestra el desenlace`, async () => {
      mockGetOffer.mock.mockImplementation(async () =>
        offerOf({ status, actionable: false, free: true, maxCredits: null }),
      );
      mount();
      await waitFor(() => assert.match(document.body.textContent ?? '', new RegExp(copy)));
      assert.equal(lastHookInput().enabled, false, 'un estado terminal no se sondea');
      assert.equal(screen.queryByRole('button'), null, 'y no reabre una compra');
    });
  }

  it('TEST 12 — estado ilegible: NO se pinta un CTA de pago, y no se sondea', async () => {
    mockGetOffer.mock.mockImplementation(async () =>
      offerOf({ status: 'reveal_state_unreadable', actionable: false, free: true, maxCredits: null }),
    );
    mount();
    await waitFor(() => assert.equal(mockGetOffer.mock.callCount(), 1));
    assert.equal(screen.queryByRole('button'), null);
    assert.equal(document.body.textContent, '');
    assert.equal(lastHookInput().enabled, false);
  });

  it('TEST 12 — y si la LECTURA de la oferta lanza, tampoco aparece un botón', async () => {
    mockGetOffer.mock.mockImplementation(async () => {
      throw new Error('offer read failed');
    });
    mount();
    await waitFor(() => assert.equal(mockGetOffer.mock.callCount(), 1));
    assert.equal(screen.queryByRole('button'), null);
    assert.equal(mockReveal.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 13 — el presupuesto del navegador se agota; el servidor no
// ═══════════════════════════════════════════════════════════════════

describe('durable resume UI — presupuesto agotado ≠ nada en vuelo', () => {
  it('TEST 13 — agotado el sondeo con el backend activo: NO vuelve «Revelar teléfono»', async () => {
    mockGetOffer.mock.mockImplementation(async () => IN_FLIGHT);
    hookState = { active: false, budgetExhausted: true };

    mount();
    await waitFor(() =>
      assert.match(
        document.body.textContent ?? '',
        new RegExp(OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY),
      ),
    );
    assert.equal(
      screen.queryByRole('button', { name: /Revelar teléfono/ }),
      null,
      'que el navegador se canse de mirar no es una prueba de que no haya nada en vuelo',
    );
    // Y no promete una vigilancia que ya no existe.
    assert.equal(
      (document.body.textContent ?? '').includes(OFFICIAL_REVEAL_IN_FLIGHT_COPY),
      false,
    );
  });

  it('TEST 13 — y al REABRIR, el ciclo vuelve a arrancar con presupuesto nuevo', async () => {
    mockGetOffer.mock.mockImplementation(async () => IN_FLIGHT);
    hookState = { active: false, budgetExhausted: true };
    const first = mount();
    await waitFor(() =>
      assert.match(
        document.body.textContent ?? '',
        new RegExp(OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY),
      ),
    );
    first.unmount();

    hookState = { active: true, budgetExhausted: false };
    hookCalls = [];
    mount();
    await waitFor(() => assert.equal(lastHookInput().enabled, true));
    assert.match(document.body.textContent ?? '', new RegExp(OFFICIAL_REVEAL_IN_FLIGHT_COPY));
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 7 — el doble clic, en la ventana en la que todavía hay botón
// ═══════════════════════════════════════════════════════════════════

describe('durable resume UI — el doble clic no autoriza dos veces', () => {
  it('TEST 7 — dos clics seguidos producen UNA sola llamada a la acción de compra', async () => {
    // El pestillo síncrono corta el segundo clic ANTES de que el re-render deshabilite el botón,
    // que es la ventana real del doble clic. La protección DE VERDAD es el servidor —probado en
    // `post-approval-reveal-durable-resume.test.ts`—; esto es la capa de UX.
    let resolveReveal: (() => void) | null = null;
    mockReveal.mock.mockImplementation(
      () =>
        new Promise<StartResult>((resolve) => {
          resolveReveal = () => resolve(startResult());
        }),
    );

    mount();
    const button = await waitFor(() => screen.getByRole('button', { name: /Revelar teléfono/ }));
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    assert.equal(mockReveal.mock.callCount(), 1);

    await act(async () => {
      resolveReveal?.();
      await Promise.resolve();
    });
  });

  it('el botón de compra sólo existe cuando la oferta es ACCIONABLE', async () => {
    mockGetOffer.mock.mockImplementation(async () => IN_FLIGHT);
    mount();
    await waitFor(() => assert.equal(mockGetOffer.mock.callCount(), 1));
    assert.equal(screen.queryByText(OFFICIAL_REVEAL_BUY_LABEL), null);
  });
});
