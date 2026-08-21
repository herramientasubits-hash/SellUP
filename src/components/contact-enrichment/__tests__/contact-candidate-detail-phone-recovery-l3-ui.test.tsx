/**
 * Tests — CTA "Revisar resultado ahora" en el sidepanel
 * (Agente 2A · APOLLO-PHONE-RECOVERY-L3)
 *
 * El recovery L2 es un cron DIARIO, así que un reveal cuyo webhook se pierde podía
 * quedarse "Revelación en proceso" hasta 24 h. Apollo confirmó que su
 * `webhook_result` se puede consultar a los 1–2 min, así que la UI ofrece revisar el
 * resultado AHORA — sin iniciar un reveal nuevo.
 *
 * Cubre: la ventana de 2 min, la exigencia de id de correlación, el gate de rol, el
 * bloqueo del botón durante la ejecución (una sola invocación por clic), los estados
 * de respuesta (pending con y sin `retry_after_seconds`, no_phone_found, revealed,
 * error) y la ausencia de polling automático.
 *
 * Render real de React (jsdom + @testing-library/react). NO toca el servidor, NO
 * llama proveedores, NO escribe en DB y NO revela teléfonos reales: los server
 * actions están mockeados.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que los tests 3D.4 / stale-ui) ─────────────

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
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import type { ManualRecoveryRuntimeResult } from '@/modules/contact-enrichment/phone-reveal-manual-recovery-runtime-core';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];

// ── Mocks de boundary ──────────────────────────────────────────────────────

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockReveal = mock.fn<(input: unknown) => Promise<unknown>>();
const mockRecoverNow = mock.fn<
  (input: unknown) => Promise<ManualRecoveryRuntimeResult>
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CTA_LABEL = 'Revisar resultado ahora';

/** ISO de hace n segundos, para colocar el candidato dentro/fuera de la ventana. */
function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-l3-ui',
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
    enrichment_run_id: 'run-l3',
    created_at: '2026-07-30T11:00:00.000Z',
    phone_reveal_status: 'requested',
    // 10 min: la ventana de 2 min ya se cumplió.
    phone_reveal_requested_at: agoIso(600),
    phone_reveal_recovery_id_present: true,
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

function safeResult(
  overrides: Partial<ManualRecoveryRuntimeResult> = {},
): ManualRecoveryRuntimeResult {
  return {
    ok: true,
    mode: 'manual_single',
    status: 'still_pending',
    phoneRevealStatus: 'requested',
    phoneRevealed: false,
    noPhoneFound: false,
    stillPending: true,
    retryAfterSeconds: null,
    phoneType: null,
    creditsUsed: null,
    message: 'still_pending',
    ...overrides,
  };
}

async function renderSheet(
  candidate: PendingContactCandidate,
  props: { phoneRevealAuthorized?: boolean } = {},
) {
  mockGetById.mock.mockImplementation(async () => candidate);
  render(
    <ContactCandidateDetailSheet
      candidateId={candidate.id}
      open
      onClose={() => {}}
      phoneRevealEnabled
      phoneRevealAuthorized={props.phoneRevealAuthorized ?? true}
    />,
  );
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
}

function ctaButton() {
  return screen.queryByRole('button', { name: CTA_LABEL });
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, waitFor, cleanup, fireEvent } = await import(
    '@testing-library/react'
  ));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  cleanup();
  mockGetById.mock.resetCalls();
  mockReveal.mock.resetCalls();
  mockRecoverNow.mock.resetCalls();
  mockRecoverNow.mock.mockImplementation(async () => safeResult());
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// 1. Visibilidad del CTA
// ═══════════════════════════════════════════════════════════════

describe('L3 UI — visibilidad del CTA', () => {
  it('ofrece el CTA cuando el reveal está en vuelo y ya pasaron 2 min', async () => {
    await renderSheet(makeCandidate());
    assert.ok(ctaButton(), 'debe ofrecerse la revisión manual');
    assert.ok(bodyText().includes('o puedes revisarlo ahora'));
  });

  it('aplica igual a requested y a pending', async () => {
    for (const status of ['requested', 'pending'] as const) {
      cleanup();
      await renderSheet(makeCandidate({ phone_reveal_status: status }));
      assert.ok(ctaButton(), `status ${status}`);
    }
  });

  it('NO ofrece el CTA antes de los 2 min: explica la espera', async () => {
    await renderSheet(makeCandidate({ phone_reveal_requested_at: agoIso(30) }));
    assert.equal(ctaButton(), null);
    const text = bodyText();
    assert.ok(text.includes('El resultado aún puede estar procesándose'));
    assert.ok(text.includes('SellUp revisará automáticamente el resultado'));
    assert.ok(!text.includes('o puedes revisarlo ahora'));
  });

  it('NO ofrece el CTA si no hay id de correlación', async () => {
    await renderSheet(makeCandidate({ phone_reveal_recovery_id_present: false }));
    assert.equal(ctaButton(), null);
  });

  it('NO ofrece el CTA en candidatos legacy sin marca de solicitud', async () => {
    const candidate = makeCandidate();
    delete (candidate as { phone_reveal_requested_at?: string | null })
      .phone_reveal_requested_at;
    await renderSheet(candidate);
    assert.equal(ctaButton(), null);
  });

  it('NO ofrece el CTA a un rol no autorizado', async () => {
    await renderSheet(makeCandidate(), { phoneRevealAuthorized: false });
    assert.equal(ctaButton(), null);
  });

  it('NO ofrece el CTA cuando el reveal ya es terminal', async () => {
    for (const status of ['revealed', 'no_phone_found', 'error'] as const) {
      cleanup();
      await renderSheet(makeCandidate({ phone_reveal_status: status }));
      assert.equal(ctaButton(), null, `status ${status}`);
    }
  });

  it('sigue mostrando la última revisión del recovery si existe', async () => {
    await renderSheet(
      makeCandidate({ phone_reveal_last_checked_at: '2026-07-30T14:07:00.000Z' }),
    );
    assert.ok(bodyText().includes('Última revisión:'));
  });

  it('no dispara nada al renderizar (sin polling automático)', async () => {
    await renderSheet(makeCandidate());
    assert.equal(mockRecoverNow.mock.callCount(), 0);
    assert.equal(mockReveal.mock.callCount(), 0);
  });

  it('nunca renderiza el botón de revelar mientras el reveal está en vuelo', async () => {
    await renderSheet(makeCandidate());
    assert.equal(screen.queryByRole('button', { name: 'Revelar teléfono' }), null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Ejecución
// ═══════════════════════════════════════════════════════════════

describe('L3 UI — ejecución del CTA', () => {
  it('ejecuta la acción UNA sola vez, con solo el id del candidato', async () => {
    await renderSheet(makeCandidate());
    fireEvent.click(ctaButton()!);
    await waitFor(() => {
      if (mockRecoverNow.mock.callCount() === 0) throw new Error('sin invocar');
    });
    assert.equal(mockRecoverNow.mock.callCount(), 1);
    assert.deepEqual(mockRecoverNow.mock.calls[0].arguments[0], {
      candidateId: 'cand-l3-ui',
    });
  });

  it('deshabilita el botón mientras se ejecuta y no admite un segundo clic', async () => {
    let release: (value: ManualRecoveryRuntimeResult) => void = () => {};
    mockRecoverNow.mock.mockImplementation(
      () =>
        new Promise<ManualRecoveryRuntimeResult>((resolve) => {
          release = resolve;
        }),
    );
    await renderSheet(makeCandidate());
    fireEvent.click(ctaButton()!);

    await waitFor(() => {
      if (!screen.queryByRole('button', { name: 'Revisando…' })) {
        throw new Error('sin estado de carga');
      }
    });
    const loadingButton = screen.getByRole('button', { name: 'Revisando…' });
    assert.equal((loadingButton as HTMLButtonElement).disabled, true);

    // Un segundo clic durante la ejecución no debe disparar otra invocación.
    fireEvent.click(loadingButton);
    assert.equal(mockRecoverNow.mock.callCount(), 1);

    release(safeResult());
    await waitFor(() => {
      if (screen.queryByRole('button', { name: 'Revisando…' })) {
        throw new Error('sigue cargando');
      }
    });
    assert.equal(mockRecoverNow.mock.callCount(), 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Estados de respuesta
// ═══════════════════════════════════════════════════════════════

describe('L3 UI — respuesta pendiente', () => {
  it('muestra que Apollo sigue procesando', async () => {
    mockRecoverNow.mock.mockImplementation(async () => safeResult());
    await renderSheet(makeCandidate());
    fireEvent.click(ctaButton()!);
    await waitFor(() => {
      if (!bodyText().includes('Apollo aún está procesando el resultado')) {
        throw new Error('sin mensaje de pendiente');
      }
    });
    assert.ok(bodyText().includes('Intenta nuevamente más tarde'));
  });

  it('muestra los segundos sugeridos por Apollo cuando los hay', async () => {
    mockRecoverNow.mock.mockImplementation(async () =>
      safeResult({ retryAfterSeconds: 10 }),
    );
    await renderSheet(makeCandidate());
    fireEvent.click(ctaButton()!);
    await waitFor(() => {
      if (!bodyText().includes('aproximadamente 10 segundos')) {
        throw new Error('sin sugerencia de reintento');
      }
    });
    assert.ok(bodyText().includes('Apollo sugirió volver a revisar'));
  });
});

describe('L3 UI — respuestas terminales', () => {
  it('refleja no_phone_found tras el refresh', async () => {
    const inFlight = makeCandidate();
    const terminal = makeCandidate({ phone_reveal_status: 'no_phone_found' });
    let calls = 0;
    mockGetById.mock.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? inFlight : terminal;
    });
    mockRecoverNow.mock.mockImplementation(async () =>
      safeResult({
        ok: true,
        status: 'no_phone_found',
        phoneRevealStatus: 'no_phone_found',
        noPhoneFound: true,
        stillPending: false,
        message: 'no_phone_found',
      }),
    );

    render(
      <ContactCandidateDetailSheet
        candidateId={inFlight.id}
        open
        onClose={() => {}}
        phoneRevealEnabled
        phoneRevealAuthorized
      />,
    );
    await waitFor(() => {
      if (!ctaButton()) throw new Error('sin CTA todavía');
    });
    fireEvent.click(ctaButton()!);

    await waitFor(() => {
      if (!bodyText().includes('Teléfono no disponible')) {
        throw new Error('sin estado terminal');
      }
    });
    assert.equal(ctaButton(), null, 'el CTA desaparece al cerrarse el caso');
    assert.ok(!bodyText().includes('Revelación en proceso'));
  });

  it('muestra el teléfono con el comportamiento existente cuando se revela', async () => {
    const inFlight = makeCandidate();
    const revealed = makeCandidate({
      phone_reveal_status: 'revealed',
      phone: '+570000000000',
      enrichment_metadata: {
        phone: { number: '+570000000000', type: 'mobile', source: 'apollo_reveal' },
      },
    });
    let calls = 0;
    mockGetById.mock.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? inFlight : revealed;
    });
    mockRecoverNow.mock.mockImplementation(async () =>
      safeResult({
        status: 'revealed',
        phoneRevealStatus: 'revealed',
        phoneRevealed: true,
        stillPending: false,
        phoneType: 'mobile',
        creditsUsed: 8,
        message: 'revealed',
      }),
    );

    render(
      <ContactCandidateDetailSheet
        candidateId={inFlight.id}
        open
        onClose={() => {}}
        phoneRevealEnabled
        phoneRevealAuthorized
      />,
    );
    await waitFor(() => {
      if (!ctaButton()) throw new Error('sin CTA todavía');
    });
    fireEvent.click(ctaButton()!);

    await waitFor(() => {
      if (!bodyText().includes('+570000000000')) throw new Error('sin teléfono');
    });
    assert.equal(ctaButton(), null);
  });

  it('muestra un error recuperable sin detalle técnico', async () => {
    mockRecoverNow.mock.mockImplementation(async () =>
      safeResult({
        ok: false,
        status: 'error',
        stillPending: false,
        message: 'possible_missing_webhook_result_read_scope',
      }),
    );
    await renderSheet(makeCandidate());
    fireEvent.click(ctaButton()!);
    await waitFor(() => {
      if (!bodyText().includes('No pudimos revisar el resultado')) {
        throw new Error('sin mensaje de error');
      }
    });
    assert.ok(
      !bodyText().includes('webhook_result_read'),
      'el código técnico no se muestra al operador',
    );
  });

  it('un fallo inesperado de la acción no rompe el panel', async () => {
    mockRecoverNow.mock.mockImplementation(async () => {
      throw new Error('boom');
    });
    await renderSheet(makeCandidate());
    fireEvent.click(ctaButton()!);
    await waitFor(() => {
      if (!bodyText().includes('No pudimos revisar el resultado')) {
        throw new Error('sin mensaje de error');
      }
    });
    assert.ok(bodyText().includes('Contacto De Prueba'), 'el panel sigue en pie');
  });

  it('el bloqueo por supresión se explica por su causa', async () => {
    mockRecoverNow.mock.mockImplementation(async () =>
      safeResult({
        status: 'blocked_suppressed',
        stillPending: false,
        message: 'blocked_suppressed',
      }),
    );
    await renderSheet(makeCandidate());
    fireEvent.click(ctaButton()!);
    await waitFor(() => {
      if (!bodyText().includes('supresión registrada')) {
        throw new Error('sin mensaje de supresión');
      }
    });
  });

  it('si el backend dice "todavía no toca", la UI lo dice con los segundos', async () => {
    mockRecoverNow.mock.mockImplementation(async () =>
      safeResult({
        ok: false,
        status: 'not_eligible',
        stillPending: false,
        retryAfterSeconds: 42,
        message: 'checked_too_recently',
      }),
    );
    await renderSheet(makeCandidate());
    fireEvent.click(ctaButton()!);
    await waitFor(() => {
      if (!bodyText().includes('aproximadamente 42 segundos')) {
        throw new Error('sin espera indicada');
      }
    });
    assert.ok(!bodyText().includes('checked_too_recently'));
  });
});
