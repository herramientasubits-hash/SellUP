/**
 * Tests — refresco acotado del drawer mientras el reveal está en vuelo
 * (Agente 2A · APOLLO-PHONE-REVEAL-LIVE-REFRESH-1)
 *
 * Incidente que motiva el hito (Production): el usuario pidió un Apollo Phone
 * Reveal, Apollo respondió por webhook en ~24 s y el backend persistió todo bien
 * (`revealed`, fuente `apollo_reveal`, caché escrita), pero el drawer se quedó en
 * "Revelación en proceso" hasta recargar la página. BACKEND_OK / UI_NOT_LIVE.
 *
 * Aquí se verifica que el drawer relee el candidato por su cuenta durante una
 * ventana acotada, que refleja el resultado en cuanto llega, y sobre todo que
 * PARA: estado terminal, teléfono presente, drawer cerrado, cambio de candidato,
 * presupuesto agotado. También que nunca hay dos refetch simultáneos y que el
 * refresco NO invoca reveal ni recovery (0 llamadas a proveedores, 0 créditos).
 *
 * Timers falsos (`mock.timers`) para no esperar en tiempo real. Los server actions
 * están mockeados: no toca servidor, DB, Apollo, Lusha ni HubSpot. Los datos son
 * ficticios (nada de teléfonos, correos, LinkedIn, nombres ni empresas reales).
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que los tests 3D.4 / stale-ui / L3) ────────

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
import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import {
  PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS,
  PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS,
  PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS,
  PHONE_REVEAL_LIVE_REFRESH_COPY,
} from '../phone-reveal-live-refresh-core';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Mocks de boundary ──────────────────────────────────────────────────────

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockReveal = mock.fn<(input: unknown) => Promise<unknown>>();
const mockRecoverNow = mock.fn<(input: unknown) => Promise<unknown>>();

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
    recoverCandidatePhoneRevealNowAction: (...args: unknown[]) =>
      mockRecoverNow(...(args as [unknown])),
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

// ── Fixtures (datos 100 % ficticios) ─────────────────────────────────────────

const FAKE_PHONE = '+570000000000';

/** ISO de hace n segundos, para situar el candidato dentro/fuera de la ventana L3. */
function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-live-refresh',
    full_name: 'Contacto De Prueba',
    title: 'Cargo de prueba',
    email: null,
    linkedin_url: null,
    source_contact_id: 'sc-1',
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-live-refresh',
    created_at: '2026-07-30T11:00:00.000Z',
    phone_reveal_status: 'requested',
    // 30 s: dentro de la ventana de espera, el CTA manual L3 todavía no aplica.
    phone_reveal_requested_at: agoIso(30),
    phone_reveal_recovery_id_present: true,
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

function revealedCandidate(): PendingContactCandidate {
  return makeCandidate({
    phone_reveal_status: 'revealed',
    phone: FAKE_PHONE,
    enrichment_metadata: {
      phone: { number: FAKE_PHONE, type: 'mobile', source: 'apollo_reveal' },
    },
  });
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

/** Deja correr las microtareas pendientes (refetch resueltos) dentro de `act`. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Avanza los timers falsos y deja que el refetch resultante se asiente. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    mock.timers.tick(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await flush();
}

function renderSheet(
  props: {
    candidateId?: string;
    open?: boolean;
    phoneRevealAuthorized?: boolean;
  } = {},
) {
  return render(
    <ContactCandidateDetailSheet
      candidateId={props.candidateId ?? 'cand-live-refresh'}
      open={props.open ?? true}
      onClose={() => {}}
      phoneRevealEnabled
      phoneRevealAuthorized={props.phoneRevealAuthorized ?? true}
    />,
  );
}

/** Monta el drawer con un candidato ya cargado, con los timers ya falsos. */
async function mountWith(
  candidate: PendingContactCandidate,
  props: Parameters<typeof renderSheet>[0] = {},
) {
  mockGetById.mock.mockImplementation(async () => candidate);
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = renderSheet({ candidateId: candidate.id, ...props });
  });
  await flush();
  assert.ok(bodyText().includes(candidate.full_name), 'el candidato debe estar cargado');
  return result;
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, cleanup, act } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  cleanup();
  mockGetById.mock.resetCalls();
  mockReveal.mock.resetCalls();
  mockRecoverNow.mock.resetCalls();
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// 1. Arranque del refresco
// ═══════════════════════════════════════════════════════════════

describe('LIVE-REFRESH-1 UI — arranque', () => {
  it('relee el candidato cuando el reveal está en vuelo', async () => {
    await mountWith(makeCandidate());
    const afterMount = mockGetById.mock.callCount();

    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    assert.equal(
      mockGetById.mock.callCount(),
      afterMount + 1,
      'debe haber releído el candidato una vez',
    );

    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);
    assert.equal(mockGetById.mock.callCount(), afterMount + 2);
  });

  it('no relee antes de que venza el primer retardo', async () => {
    await mountWith(makeCandidate());
    const afterMount = mockGetById.mock.callCount();
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS - 1);
    assert.equal(mockGetById.mock.callCount(), afterMount);
  });

  it('avisa en pantalla de que el estado se actualiza solo', async () => {
    await mountWith(makeCandidate());
    assert.ok(bodyText().includes('Revelación en proceso'));
    assert.ok(bodyText().includes(PHONE_REVEAL_LIVE_REFRESH_COPY));
  });

  it('el refresco NUNCA llama a reveal ni a recovery', async () => {
    await mountWith(makeCandidate());
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);
    assert.equal(mockReveal.mock.callCount(), 0, 'ningún reveal (0 créditos)');
    assert.equal(mockRecoverNow.mock.callCount(), 0, 'ninguna revisión manual');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. No arranca cuando no toca
// ═══════════════════════════════════════════════════════════════

describe('LIVE-REFRESH-1 UI — no arranca', () => {
  it('no arranca cuando el candidato ya tiene teléfono', async () => {
    await mountWith(revealedCandidate());
    const afterMount = mockGetById.mock.callCount();
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS * 3);
    assert.equal(mockGetById.mock.callCount(), afterMount);
    assert.ok(!bodyText().includes(PHONE_REVEAL_LIVE_REFRESH_COPY));
  });

  it('no arranca en un estado terminal desde el inicio', async () => {
    for (const status of ['no_phone_found', 'error', 'not_requested'] as const) {
      cleanup();
      mockGetById.mock.resetCalls();
      await mountWith(makeCandidate({ phone_reveal_status: status }));
      const afterMount = mockGetById.mock.callCount();
      await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS * 2);
      assert.equal(mockGetById.mock.callCount(), afterMount, `status ${status}`);
    }
  });

  it('no arranca con el drawer cerrado', async () => {
    mockGetById.mock.mockImplementation(async () => makeCandidate());
    await act(async () => {
      renderSheet({ open: false });
    });
    await flush();
    const afterMount = mockGetById.mock.callCount();
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS * 3);
    assert.equal(mockGetById.mock.callCount(), afterMount);
    assert.equal(afterMount, 0, 'un drawer cerrado no lee nada');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Paradas
// ═══════════════════════════════════════════════════════════════

describe('LIVE-REFRESH-1 UI — paradas', () => {
  it('para en cuanto el webhook cierra el caso como revealed y muestra el teléfono', async () => {
    let calls = 0;
    const inFlight = makeCandidate();
    mockGetById.mock.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? inFlight : revealedCandidate();
    });
    await act(async () => {
      renderSheet();
    });
    await flush();
    assert.ok(bodyText().includes('Revelación en proceso'));

    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);

    // El drawer refleja el resultado SIN recargar la página.
    assert.ok(bodyText().includes(FAKE_PHONE), 'debe mostrar el teléfono');
    assert.ok(bodyText().includes('Apollo reveal'), 'debe mostrar el badge de fuente');
    assert.ok(!bodyText().includes('Revelación en proceso'));
    assert.ok(!bodyText().includes(PHONE_REVEAL_LIVE_REFRESH_COPY));

    const afterReveal = mockGetById.mock.callCount();
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS * 3);
    assert.equal(mockGetById.mock.callCount(), afterReveal, 'el refresco quedó apagado');
  });

  it('para cuando el resultado es no_phone_found', async () => {
    let calls = 0;
    mockGetById.mock.mockImplementation(async () => {
      calls += 1;
      return calls === 1
        ? makeCandidate()
        : makeCandidate({ phone_reveal_status: 'no_phone_found' });
    });
    await act(async () => {
      renderSheet();
    });
    await flush();

    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    assert.ok(bodyText().includes('Teléfono no disponible tras consultar Apollo'));
    assert.ok(!bodyText().includes('Revelación en proceso'));

    const afterTerminal = mockGetById.mock.callCount();
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS * 3);
    assert.equal(mockGetById.mock.callCount(), afterTerminal);
  });

  it('cancela los timers al cerrar el drawer', async () => {
    const candidate = makeCandidate();
    mockGetById.mock.mockImplementation(async () => candidate);
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = renderSheet();
    });
    await flush();
    const afterMount = mockGetById.mock.callCount();

    await act(async () => {
      view.rerender(
        <ContactCandidateDetailSheet
          candidateId={candidate.id}
          open={false}
          onClose={() => {}}
          phoneRevealEnabled
          phoneRevealAuthorized
        />,
      );
    });
    await flush();

    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS * 3);
    assert.equal(mockGetById.mock.callCount(), afterMount, 'no hay refetch tras cerrar');
  });

  it('cancela el ciclo anterior al cambiar de candidato', async () => {
    const first = makeCandidate();
    const second = makeCandidate({ id: 'cand-live-refresh-2' });
    const seen: string[] = [];
    mockGetById.mock.mockImplementation(async (...args: unknown[]) => {
      const id = String(args[0]);
      seen.push(id);
      return id === second.id ? second : first;
    });

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = renderSheet({ candidateId: first.id });
    });
    await flush();

    // Justo antes de que venciera el primer refetch del candidato inicial.
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS - 1);
    await act(async () => {
      view.rerender(
        <ContactCandidateDetailSheet
          candidateId={second.id}
          open
          onClose={() => {}}
          phoneRevealEnabled
          phoneRevealAuthorized
        />,
      );
    });
    await flush();

    seen.length = 0;
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    assert.ok(seen.length > 0, 'el candidato nuevo sí se refresca');
    assert.ok(
      seen.every((id) => id === second.id),
      'ningún refetch puede seguir apuntando al candidato anterior',
    );
  });

  it('deja de refrescar al agotar el presupuesto de tiempo', async () => {
    await mountWith(makeCandidate());
    const afterMount = mockGetById.mock.callCount();

    // Cada refetch programa el siguiente de forma asíncrona, así que hay que
    // avanzar paso a paso. El corte del bucle es por sí mismo la prueba de que la
    // cadena TERMINA sola: si no terminara, `steps` llegaría a la cota.
    const stepMs =
      PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS + PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS;
    const maxSteps = 40;
    let steps = 0;
    let previous = -1;
    while (steps < maxSteps && mockGetById.mock.callCount() !== previous) {
      previous = mockGetById.mock.callCount();
      await advance(stepMs);
      steps += 1;
    }

    assert.ok(steps < maxSteps, 'el refresco no puede ser un bucle infinito');
    const afterBudget = mockGetById.mock.callCount();
    const refetches = afterBudget - afterMount;
    const maxPossible =
      Math.ceil(
        PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS / PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS,
      ) + 1;
    assert.ok(refetches > 0, 'debe haber refrescado durante la ventana');
    assert.ok(
      refetches <= maxPossible,
      `refetches (${refetches}) fuera del presupuesto (máx ${maxPossible})`,
    );
    assert.ok(
      !bodyText().includes(PHONE_REVEAL_LIVE_REFRESH_COPY),
      'agotado el presupuesto, ya no se anuncia refresco automático',
    );

    // Y no revive: más tiempo no produce más lecturas.
    await advance(PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS * 2);
    assert.equal(mockGetById.mock.callCount(), afterBudget, 'no hay bucle infinito');

    // El caso sigue en vuelo: las salidas existentes (aviso + reapertura) siguen.
    assert.ok(bodyText().includes('Revelación en proceso'));
    assert.ok(bodyText().includes('Vuelve a abrir el candidato más tarde'));
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Carreras
// ═══════════════════════════════════════════════════════════════

describe('LIVE-REFRESH-1 UI — carreras', () => {
  it('no dispara dos refetch simultáneos', async () => {
    const candidate = makeCandidate();
    let resolveSecond: ((value: PendingContactCandidate) => void) | null = null;
    let calls = 0;
    mockGetById.mock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return candidate;
      // El refetch del refresco se queda colgado a propósito.
      return new Promise<PendingContactCandidate>((resolve) => {
        resolveSecond = resolve;
      });
    });

    await act(async () => {
      renderSheet();
    });
    await flush();
    assert.equal(mockGetById.mock.callCount(), 1);

    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    assert.equal(mockGetById.mock.callCount(), 2, 'arrancó el primer refetch');

    // Vencen varios ticks más mientras el refetch sigue en vuelo: ninguno abre otro.
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);
    assert.equal(
      mockGetById.mock.callCount(),
      2,
      'no puede haber dos lecturas simultáneas',
    );

    // Al liberarse, el ciclo continúa normalmente.
    await act(async () => {
      resolveSecond?.(candidate);
      await Promise.resolve();
    });
    await flush();
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);
    assert.ok(mockGetById.mock.callCount() >= 3, 'el ciclo se reanuda');
  });

  it('un refetch que falla no rompe el panel ni detiene el ciclo', async () => {
    const candidate = makeCandidate();
    let calls = 0;
    mockGetById.mock.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      return candidate;
    });

    await act(async () => {
      renderSheet();
    });
    await flush();

    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    assert.ok(bodyText().includes('Contacto De Prueba'), 'el panel sigue en pie');

    const afterFailure = mockGetById.mock.callCount();
    await advance(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS);
    assert.ok(mockGetById.mock.callCount() > afterFailure, 'el ciclo continúa');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. No interfiere con lo existente
// ═══════════════════════════════════════════════════════════════

describe('LIVE-REFRESH-1 UI — convivencia', () => {
  it('no añade botones nuevos mientras el reveal está en vuelo', async () => {
    await mountWith(makeCandidate());
    await advance(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS);
    assert.equal(screen.queryByRole('button', { name: 'Revelar teléfono' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Revisar resultado ahora' }), null);
  });

  it('el CTA manual L3 sigue apareciendo por su propia ventana de 2 min', async () => {
    await mountWith(makeCandidate({ phone_reveal_requested_at: agoIso(600) }));
    assert.ok(screen.queryByRole('button', { name: 'Revisar resultado ahora' }));
    assert.ok(bodyText().includes(PHONE_REVEAL_LIVE_REFRESH_COPY));
    assert.equal(mockRecoverNow.mock.callCount(), 0, 'nadie la invoca automáticamente');
  });
});
