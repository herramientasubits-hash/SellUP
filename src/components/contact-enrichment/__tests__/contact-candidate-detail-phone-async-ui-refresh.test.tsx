/**
 * Tests — el ciclo de vida del reveal asíncrono se ve SOLO en la UI
 * (Agente 2A · AGENT2A-PHONE-REVEAL-ASYNC-UI-REFRESH-1)
 *
 * Incidente que motiva el hito (Production QA, 2026-08-18 21:43:40 → 21:43:59 UTC):
 * el backend cerró el reveal en ~20 s y persistió todo bien (`revealed`, proveedor
 * `apollo`, 1 teléfono, 1 fila de origen). La UI, en cambio, no se movió: tras el
 * clic el drawer siguió idéntico, sin estado de espera, y el teléfono sólo apareció
 * al recargar el navegador. BACKEND_OK / UI_NOT_LIVE.
 *
 * Causa raíz que cubren estas pruebas: TODO el estado de espera —el badge
 * «Revelación en proceso» y el refresco acotado de LIVE-REFRESH-1— se derivaba
 * EXCLUSIVAMENTE del `phone_reveal_status` LEÍDO del servidor. El cliente no
 * registraba en ningún sitio "acabo de solicitar un reveal", así que entre el
 * `finally` del handler (que apaga su propio spinner) y el momento en que el
 * refetch posterior entrega el nuevo estado, el drawer volvía a pintarse IDLE. Y
 * como el refresco automático también dependía de ese mismo estado leído, un
 * refetch que fallara o llegara sin el estado nuevo dejaba la UI idle para
 * siempre: no había segunda oportunidad, porque el único disparador del sondeo
 * era justamente el dato que no había llegado.
 *
 * Lo que se verifica aquí:
 *   1. idle → el CTA dice «Revelar teléfono»
 *   2. al aceptarse la solicitud el CTA deja de estar idle INMEDIATAMENTE
 *   3. el estado de espera no admite un segundo envío
 *   4. el candidato se revalida solo, aunque el refetch inmediato falle
 *   5. `revealed` pinta el teléfono sin recargar el navegador
 *   6. el sondeo PARA en `revealed`
 *   7. el sondeo PARA en un terminal sin teléfono
 *   8. el sondeo NUNCA llama a reveal / Lusha / recovery
 *   9. el sondeo no gasta créditos (no hay superficie de gasto invocada)
 *  10. 1 teléfono guardado ⇒ NO aparece «Ver más números»
 *  11. >1 teléfono guardado ⇒ SÍ aparece
 *  12. el bloqueo por identidad no evaluable (#295) sigue intacto
 *
 * Los server actions están mockeados: no toca servidor, DB, Apollo, Lusha ni
 * HubSpot. Todos los datos son ficticios. Timers falsos (`mock.timers`).
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from "jsdom";

// ── jsdom bootstrap (mismo patrón que las suites 3D.4 / live-refresh / stale) ──

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}

defineGlobal("window", dom.window);
defineGlobal("document", dom.window.document);
defineGlobal("navigator", dom.window.navigator);
defineGlobal("IS_REACT_ACT_ENVIRONMENT", true);

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
defineGlobal("ResizeObserver", ResizeObserverStub);

if (!dom.window.matchMedia) {
  (
    dom.window as unknown as { matchMedia: (q: string) => MediaQueryList }
  ).matchMedia = (query: string) =>
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
(globalThis as unknown as { matchMedia: unknown }).matchMedia =
  dom.window.matchMedia;

for (const proto of [
  dom.window.HTMLElement.prototype,
  dom.window.Element.prototype,
]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== "function")
    p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== "function") p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== "function")
    p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== "function") p.scrollIntoView = () => {};
}

// ── Imports dependientes del entorno DOM ──────────────────────────────────────

import * as React from "react";
import {
  describe,
  it,
  before,
  after,
  beforeEach,
  afterEach,
  mock,
} from "node:test";
import assert from "node:assert/strict";
import type { PendingContactCandidate } from "@/modules/contact-enrichment/types";
import {
  PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS,
  PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS,
} from "../phone-reveal-live-refresh-core";
import { PHONE_REVEAL_SUBMITTED_COPY } from "../phone-reveal-submission-latch-core";
import { PHONE_REVEAL_IDENTITY_BLOCKED_COPY } from "@/modules/contact-enrichment/phone-reveal-identity-eligibility";
import { getStoredPhonesCtaLabel } from "../candidate-stored-phones-copy";

let render: (typeof import("@testing-library/react"))["render"];
let screen: (typeof import("@testing-library/react"))["screen"];
let cleanup: (typeof import("@testing-library/react"))["cleanup"];
let act: (typeof import("@testing-library/react"))["act"];
let fireEvent: (typeof import("@testing-library/react"))["fireEvent"];

// ── Mocks de boundary (ninguna llamada real sale de aquí) ────────────────────

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockReveal = mock.fn<(input: unknown) => Promise<unknown>>();
const mockRecoverNow = mock.fn<(input: unknown) => Promise<unknown>>();
const mockLushaFallback = mock.fn<(input: unknown) => Promise<unknown>>();
const mockLegacyStart = mock.fn<(input: unknown) => Promise<unknown>>();
const mockStoredPhoneSummary =
  mock.fn<() => Promise<{ additionalCount: number }>>();

mock.module("@/modules/contact-enrichment/actions", {
  namedExports: {
    getReviewableContactCandidateById: (...args: unknown[]) =>
      mockGetById(...(args as [])),
    approveContactCandidate: async () => ({ ok: true }),
    discardContactCandidate: async () => ({ ok: true }),
    getDuplicateCandidateMergeOffer: async () => null,
  },
});

mock.module("@/modules/contact-enrichment/phone-reveal-actions", {
  namedExports: {
    revealCandidatePhoneAction: (...args: unknown[]) =>
      mockReveal(...(args as [unknown])),
  },
});

mock.module(
  "@/modules/contact-enrichment/phone-reveal-manual-recovery-actions",
  {
    namedExports: {
      recoverCandidatePhoneRevealNowAction: (...args: unknown[]) =>
        mockRecoverNow(...(args as [unknown])),
    },
  },
);

mock.module(
  "@/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions",
  {
    namedExports: {
      startLegacyPhoneRevealWaterfallAction: (...args: unknown[]) =>
        mockLegacyStart(...(args as [unknown])),
    },
  },
);

mock.module("@/modules/contact-enrichment/candidate-stored-phones-actions", {
  namedExports: {
    getCandidateStoredPhoneSummaryAction: (...args: unknown[]) =>
      mockStoredPhoneSummary(...(args as [])),
    getCandidateStoredPhonesAction: async () => ({ phones: [] }),
  },
});

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});

mock.module("sonner", {
  namedExports: {
    toast: {
      success: () => {},
      warning: () => {},
      error: () => {},
      info: () => {},
    },
  },
});

let ContactCandidateDetailSheet: (typeof import("../contact-candidate-detail-sheet"))["ContactCandidateDetailSheet"];

// ── Fixtures (100 % ficticios) ───────────────────────────────────────────────

const REVEAL_LABEL = "Revelar teléfono";
const FAKE_PHONE = "+570000000000";
/** CTA real de «ver más números» para UN número adicional guardado (4O-G). */
const MORE_NUMBERS_COPY = getStoredPhonesCtaLabel(1);

/**
 * Candidato Apollo IDLE: sin teléfono y sin ningún intento previo. Es el estado
 * exacto del candidato de la QA justo antes del clic.
 */
function idleCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: "cand-async-ui",
    full_name: "Contacto De Prueba",
    title: "Cargo de prueba",
    email: "prueba@ejemplo.test",
    linkedin_url: null,
    source_contact_id: "0123456789abcdef01234567",
    // Identidad de supresión EVALUABLE (#289/#295): sin esto el CTA se deshabilita
    // por identidad y no se podría ejercitar el ciclo de vida asíncrono.
    apollo_person_id: "0123456789abcdef01234567",
    phone: null,
    source: "apollo",
    status: "pending_review",
    duplicate_status: "unchecked",
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: "run-async-ui",
    created_at: "2026-08-18T21:00:00.000Z",
    phone_reveal_status: null,
    phone_reveal_recovery_id_present: true,
    company_name: "Empresa De Prueba",
    company_domain: "ejemplo.test",
    account_id: "acct-1",
    hubspot_company_id: null,
    ...overrides,
  } as PendingContactCandidate;
}

/** El mismo candidato una vez que el servidor aceptó la solicitud. */
function requestedCandidate(): PendingContactCandidate {
  return idleCandidate({
    phone_reveal_status: "requested",
    phone_reveal_requested_at: new Date().toISOString(),
    phone_reveal_provider: "apollo",
  });
}

/** El mismo candidato una vez que el webhook cerró el caso con teléfono. */
function revealedCandidate(): PendingContactCandidate {
  return idleCandidate({
    phone_reveal_status: "revealed",
    phone_reveal_provider: "apollo",
    phone: FAKE_PHONE,
    enrichment_metadata: {
      phone: { number: FAKE_PHONE, type: "mobile", source: "apollo_reveal" },
    },
  });
}

/** Terminal sin teléfono: Apollo no encontró nada. */
function noPhoneCandidate(): PendingContactCandidate {
  return idleCandidate({
    phone_reveal_status: "no_phone_found",
    phone_reveal_provider: "apollo",
  });
}

function bodyText(): string {
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
}

function revealButtons() {
  return screen.queryAllByRole("button", { name: REVEAL_LABEL });
}

/** El CTA en estado de espera: mismo botón, copy y disponibilidad distintos. */
function pendingButtons() {
  return screen.queryAllByRole("button", { name: PHONE_REVEAL_SUBMITTED_COPY });
}

/** Total de invocaciones a CUALQUIER superficie capaz de gastar créditos. */
function totalProviderCalls(): number {
  return (
    mockReveal.mock.callCount() +
    mockLushaFallback.mock.callCount() +
    mockLegacyStart.mock.callCount() +
    mockRecoverNow.mock.callCount()
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    mock.timers.tick(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await flush();
}

function renderSheet(candidateId: string, open = true) {
  return render(
    <ContactCandidateDetailSheet
      candidateId={candidateId}
      open={open}
      onClose={() => {}}
      phoneRevealEnabled
      phoneRevealAuthorized
    />,
  );
}

/** Monta el drawer con un candidato ya cargado y los timers ya falsos. */
async function mountWith(candidate: PendingContactCandidate) {
  mockGetById.mock.mockImplementation(async () => candidate);
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = renderSheet(candidate.id);
  });
  await flush();
  assert.ok(
    bodyText().includes(candidate.full_name),
    "el candidato debe estar cargado",
  );
  return result;
}

async function clickReveal() {
  const buttons = revealButtons();
  assert.equal(
    buttons.length,
    1,
    "debe haber EXACTAMENTE un botón «Revelar teléfono»",
  );
  await act(async () => {
    fireEvent.click(buttons[0]);
  });
  await flush();
}

// ── Setup/Teardown ───────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, cleanup, act, fireEvent } =
    await import("@testing-library/react"));
  ({ ContactCandidateDetailSheet } =
    await import("../contact-candidate-detail-sheet"));
});

beforeEach(() => {
  cleanup();
  mockGetById.mock.resetCalls();
  mockReveal.mock.resetCalls();
  mockRecoverNow.mock.resetCalls();
  mockLushaFallback.mock.resetCalls();
  mockLegacyStart.mock.resetCalls();
  mockStoredPhoneSummary.mock.resetCalls();
  mockStoredPhoneSummary.mock.mockImplementation(async () => ({
    additionalCount: 0,
  }));
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// 1–3. Del idle al estado de espera, sin ventana idle intermedia
// ═══════════════════════════════════════════════════════════════

describe("ASYNC-UI-REFRESH-1 — envío", () => {
  it("1. un candidato idle ofrece «Revelar teléfono»", async () => {
    await mountWith(idleCandidate());
    assert.equal(revealButtons().length, 1);
    assert.equal(
      pendingButtons().length,
      0,
      "nada debe estar en espera todavía",
    );
  });

  it("2. aceptada la solicitud, el CTA deja de estar idle INMEDIATAMENTE — aunque el refetch aún no traiga el estado nuevo", async () => {
    await mountWith(idleCandidate());
    // El servidor acepta, pero la proyección de lectura sigue devolviendo el
    // candidato ANTERIOR: es la ventana exacta del defecto de Producción.
    mockReveal.mock.mockImplementation(async () => ({ status: "requested" }));
    mockGetById.mock.mockImplementation(async () => idleCandidate());

    await clickReveal();

    assert.equal(
      revealButtons().length,
      0,
      "el CTA idle NO puede seguir en pantalla tras aceptarse la solicitud",
    );
    const pending = pendingButtons();
    assert.equal(
      pending.length,
      1,
      "debe mostrarse el CTA en estado de espera",
    );
    assert.ok(
      bodyText().includes(PHONE_REVEAL_SUBMITTED_COPY),
      "debe verse el copy de espera",
    );
  });

  it("3. el estado de espera no admite un segundo envío", async () => {
    await mountWith(idleCandidate());
    mockReveal.mock.mockImplementation(async () => ({ status: "requested" }));
    mockGetById.mock.mockImplementation(async () => idleCandidate());

    await clickReveal();
    assert.equal(mockReveal.mock.callCount(), 1);

    const pending = pendingButtons();
    assert.equal(pending.length, 1);
    assert.equal(
      (pending[0] as HTMLButtonElement).disabled,
      true,
      "el CTA en espera debe estar deshabilitado",
    );

    // Aunque se fuerce el clic, no puede salir una segunda solicitud (créditos).
    await act(async () => {
      fireEvent.click(pending[0]);
    });
    await flush();
    assert.equal(
      mockReveal.mock.callCount(),
      1,
      "un segundo clic NO puede disparar otra revelación",
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 4–5. Revalidación automática y aparición del teléfono
// ═══════════════════════════════════════════════════════════════

describe("ASYNC-UI-REFRESH-1 — revalidación automática", () => {
  it("4. revalida el candidato aunque el refetch inmediato posterior al envío falle", async () => {
    await mountWith(idleCandidate());
    mockReveal.mock.mockImplementation(async () => ({ status: "requested" }));
    // El refetch inmediato REVIENTA: antes esto dejaba la UI idle para siempre,
    // porque el sondeo dependía del estado que ese refetch no llegó a traer.
    mockGetById.mock.mockImplementation(async () => {
      throw new Error("read failed");
    });

    await clickReveal();
    const afterClick = mockGetById.mock.callCount();

    mockGetById.mock.mockImplementation(async () => requestedCandidate());
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);

    assert.ok(
      mockGetById.mock.callCount() > afterClick,
      "el refresco automático debe releer el candidato pese al fallo anterior",
    );
    assert.ok(
      bodyText().includes("Revelación en proceso"),
      "el estado en vuelo confirmado por el servidor debe verse",
    );
  });

  it("5. al pasar a `revealed` pinta el teléfono sin recargar el navegador", async () => {
    await mountWith(idleCandidate());
    mockReveal.mock.mockImplementation(async () => ({ status: "requested" }));
    mockGetById.mock.mockImplementation(async () => requestedCandidate());

    await clickReveal();
    assert.ok(!bodyText().includes(FAKE_PHONE), "todavía no hay teléfono");

    // El webhook cierra el caso mientras el drawer sigue abierto.
    mockGetById.mock.mockImplementation(async () => revealedCandidate());
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);

    assert.ok(
      bodyText().includes(FAKE_PHONE),
      "el teléfono debe aparecer sin recargar la página",
    );
    assert.ok(
      bodyText().includes("Apollo"),
      "debe verse el proveedor de la revelación",
    );
    assert.equal(
      pendingButtons().length,
      0,
      "el estado de espera debe desaparecer",
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 6–7. El sondeo PARA
// ═══════════════════════════════════════════════════════════════

describe("ASYNC-UI-REFRESH-1 — paradas", () => {
  it("6. para en cuanto el estado es `revealed`", async () => {
    await mountWith(idleCandidate());
    mockReveal.mock.mockImplementation(async () => ({ status: "requested" }));
    mockGetById.mock.mockImplementation(async () => revealedCandidate());

    await clickReveal();
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    const settled = mockGetById.mock.callCount();

    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS * 4);
    assert.equal(
      mockGetById.mock.callCount(),
      settled,
      "ninguna lectura más tras el estado terminal",
    );
  });

  it("7. para en un terminal sin teléfono (`no_phone_found`)", async () => {
    await mountWith(idleCandidate());
    mockReveal.mock.mockImplementation(async () => ({ status: "requested" }));
    mockGetById.mock.mockImplementation(async () => noPhoneCandidate());

    await clickReveal();
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    const settled = mockGetById.mock.callCount();

    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS * 4);
    assert.equal(
      mockGetById.mock.callCount(),
      settled,
      "no debe seguir sondeando",
    );
    assert.equal(
      pendingButtons().length,
      0,
      "el estado de espera no puede sobrevivir a un terminal",
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 8–9. El sondeo no toca proveedores ni gasta créditos
// ═══════════════════════════════════════════════════════════════

describe("ASYNC-UI-REFRESH-1 — contrato de gasto", () => {
  it("8-9. sondear no invoca Apollo/Lusha/recovery y no gasta créditos", async () => {
    await mountWith(idleCandidate());
    mockReveal.mock.mockImplementation(async () => ({ status: "requested" }));
    mockGetById.mock.mockImplementation(async () => requestedCandidate());

    await clickReveal();
    const afterSubmit = totalProviderCalls();
    assert.equal(afterSubmit, 1, "sólo la solicitud del usuario");

    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);

    assert.equal(
      totalProviderCalls(),
      afterSubmit,
      "el sondeo NO puede invocar ninguna superficie de gasto",
    );
    assert.equal(
      mockReveal.mock.callCount(),
      1,
      "ninguna revelación adicional",
    );
    assert.equal(mockRecoverNow.mock.callCount(), 0, "ninguna revisión manual");
    assert.ok(
      mockGetById.mock.callCount() > 1,
      "el sondeo sólo hace lecturas de la proyección",
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 10–11. «Ver más números» depende del conteo guardado
// ═══════════════════════════════════════════════════════════════

describe("ASYNC-UI-REFRESH-1 — teléfonos guardados", () => {
  it("10. un solo teléfono guardado NO ofrece «Ver más números»", async () => {
    mockStoredPhoneSummary.mock.mockImplementation(async () => ({
      additionalCount: 0,
    }));
    await mountWith(revealedCandidate());
    assert.ok(bodyText().includes(FAKE_PHONE));
    assert.ok(
      !bodyText().includes(MORE_NUMBERS_COPY),
      "con un único teléfono no hay nada más que ver",
    );
  });

  it("11. más de un teléfono guardado SÍ ofrece «Ver más números»", async () => {
    mockStoredPhoneSummary.mock.mockImplementation(async () => ({
      additionalCount: 1,
    }));
    await mountWith(revealedCandidate());
    assert.ok(
      bodyText().includes(MORE_NUMBERS_COPY),
      "con números adicionales guardados el CTA debe aparecer",
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. La privacidad de #295 no se toca
// ═══════════════════════════════════════════════════════════════

describe("ASYNC-UI-REFRESH-1 — privacidad intacta (#295)", () => {
  it("12. sin identidad evaluable el CTA sigue deshabilitado y no se puede enviar", async () => {
    // Sin `apollo_person_id` y sin id de proveedor resoluble: identidad NO
    // evaluable ⇒ el backend bloquearía, así que la UI no ofrece el clic.
    await mountWith(
      idleCandidate({ apollo_person_id: null, source_contact_id: null }),
    );

    const buttons = revealButtons();
    assert.equal(buttons.length, 1, "el botón sigue visible, pero inerte");
    assert.equal(
      (buttons[0] as HTMLButtonElement).disabled,
      true,
      "debe estar deshabilitado por identidad no evaluable",
    );
    assert.ok(
      bodyText().includes(PHONE_REVEAL_IDENTITY_BLOCKED_COPY),
      "debe explicarse por qué no se puede revelar",
    );

    await act(async () => {
      fireEvent.click(buttons[0]);
    });
    await flush();
    assert.equal(
      mockReveal.mock.callCount(),
      0,
      "no puede salir ninguna solicitud",
    );
    assert.equal(
      pendingButtons().length,
      0,
      "no puede entrar en estado de espera",
    );
  });
});
