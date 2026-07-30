/**
 * Tests — Estado "Revelación en proceso" honesto + última revisión del recovery
 * (Agente 2A · APOLLO-PHONE-RECOVERY-CRON-1)
 *
 * El bug de experiencia: mientras un reveal seguía en vuelo la UI decía solo
 * "Apollo puede tardar algunos minutos", lo que hacía pensar que el spinner se
 * resolvería solo si el usuario esperaba en la pantalla. No es así: el resultado
 * llega por el webhook de Apollo (que puede no aterrizar nunca) o por el recovery
 * del servidor. Ahora el copy lo dice y, si el recovery ya comprobó el caso, se
 * muestra la última revisión.
 *
 * Render real de React (jsdom + @testing-library/react). NO toca el servidor,
 * NO llama proveedores, NO escribe en DB y NO revela teléfonos reales: los server
 * actions están mockeados.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que el test 3D.4) ──────────────────────────

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

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mocks de boundary ──────────────────────────────────────────────────────

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockReveal = mock.fn<(input: unknown) => Promise<unknown>>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getPendingContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
    approveContactCandidate: async () => ({ ok: true }),
    discardContactCandidate: async () => ({ ok: true }),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-actions', {
  namedExports: {
    revealCandidatePhoneAction: (...args: unknown[]) => mockReveal(...(args as [unknown])),
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

const LAST_CHECKED_ISO = '2026-07-30T14:07:00.000Z';

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-stale-1',
    full_name: 'Valentina Ruiz',
    title: 'Gerente Comercial',
    email: 'valentina@empresa.com',
    linkedin_url: 'linkedin.com/in/valentina',
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.81,
    enrichment_metadata: {},
    enrichment_run_id: 'run-stale-1',
    created_at: '2026-07-30T11:00:00.000Z',
    phone_reveal_status: 'requested',
    company_name: 'Empresa SAS',
    company_domain: 'empresa.com',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

async function renderSheet(candidate: PendingContactCandidate) {
  mockGetById.mock.mockImplementation(async () => candidate);
  render(
    <ContactCandidateDetailSheet
      candidateId={candidate.id}
      open
      onClose={() => {}}
      phoneRevealEnabled
      phoneRevealAuthorized
    />,
  );
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
}

/** El botón no debe estar disponible mientras el reveal sigue en vuelo. */
function revealButton() {
  return screen.queryByRole('button', { name: 'Revelar teléfono' });
}

function bodyText(): string {
  return document.body.textContent ?? '';
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  // Aislamiento: sin desmontar, el DOM del test anterior contaminaría las
  // aserciones de ausencia ("no debe mostrar la última revisión").
  cleanup();
  mockGetById.mock.resetCalls();
  mockReveal.mock.resetCalls();
});

after(() => {
  cleanup();
});

// ── 1. Copy honesto del estado en vuelo ────────────────────────

describe('RECOVERY-CRON-1 — copy del estado en vuelo', () => {
  it('dice que SellUp revisará automáticamente el resultado', async () => {
    await renderSheet(makeCandidate({ phone_reveal_status: 'requested' }));
    const text = bodyText().replace(/\s+/g, ' ');
    assert.ok(text.includes('Revelación en proceso'));
    assert.ok(
      text.includes('SellUp revisará automáticamente el resultado'),
      'el copy debe decir que el servidor vigila el caso',
    );
  });

  it('ya no promete que basta esperar en esta pantalla', async () => {
    await renderSheet(makeCandidate({ phone_reveal_status: 'pending' }));
    const text = bodyText().replace(/\s+/g, ' ');
    assert.ok(
      !text.includes('Apollo puede tardar algunos minutos.'),
      'el copy antiguo dejaba al usuario esperando el spinner',
    );
    assert.ok(text.includes('Vuelve a abrir el candidato más tarde'));
  });

  it('aplica igual a requested y a pending', async () => {
    for (const status of ['requested', 'pending'] as const) {
      cleanup();
      await renderSheet(makeCandidate({ phone_reveal_status: status }));
      assert.ok(bodyText().includes('Revelación en proceso'), `status ${status}`);
    }
  });
});

// ── 2. Última revisión del recovery ────────────────────────────

describe('RECOVERY-CRON-1 — última revisión', () => {
  it('muestra la última revisión cuando el recovery ya comprobó el caso', async () => {
    await renderSheet(
      makeCandidate({
        phone_reveal_status: 'requested',
        phone_reveal_last_checked_at: LAST_CHECKED_ISO,
      }),
    );
    const text = bodyText().replace(/\s+/g, ' ');
    assert.ok(text.includes('Última revisión:'), 'debe rotular la última revisión');
    // Se renderiza con el formateador de fechas del sheet (es-CO), no el ISO crudo.
    assert.ok(text.includes('julio'), `se esperaba una fecha legible en: ${text}`);
    assert.ok(!text.includes(LAST_CHECKED_ISO), 'no se muestra el ISO crudo');
  });

  it('omite la línea cuando todavía no hubo ninguna comprobación', async () => {
    await renderSheet(
      makeCandidate({
        phone_reveal_status: 'requested',
        phone_reveal_last_checked_at: null,
      }),
    );
    assert.ok(!bodyText().includes('Última revisión:'));
  });

  it('omite la línea en candidatos legacy sin el campo', async () => {
    const candidate = makeCandidate({ phone_reveal_status: 'requested' });
    delete (candidate as { phone_reveal_last_checked_at?: string | null })
      .phone_reveal_last_checked_at;
    await renderSheet(candidate);
    assert.ok(!bodyText().includes('Última revisión:'));
  });

  it('no muestra la última revisión cuando el reveal ya terminó', async () => {
    await renderSheet(
      makeCandidate({
        phone_reveal_status: 'no_phone_found',
        phone_reveal_last_checked_at: LAST_CHECKED_ISO,
      }),
    );
    const text = bodyText();
    assert.ok(!text.includes('Revelación en proceso'));
    assert.ok(!text.includes('Última revisión:'));
  });
});

// ── 3. El botón sigue bloqueado en vuelo ───────────────────────

describe('RECOVERY-CRON-1 — el botón no se reactiva en vuelo', () => {
  it('no ofrece "Revelar teléfono" mientras el reveal está en vuelo', async () => {
    for (const status of ['requested', 'pending'] as const) {
      cleanup();
      await renderSheet(
        makeCandidate({
          phone_reveal_status: status,
          phone_reveal_last_checked_at: LAST_CHECKED_ISO,
        }),
      );
      assert.equal(revealButton(), null, `status ${status}: el botón debe seguir oculto`);
      assert.equal(mockReveal.mock.callCount(), 0, 'no se dispara ningún reveal');
    }
  });

  it('mostrar la última revisión no habilita un reveal nuevo', async () => {
    await renderSheet(
      makeCandidate({
        phone_reveal_status: 'requested',
        phone_reveal_last_checked_at: LAST_CHECKED_ISO,
      }),
    );
    assert.ok(bodyText().includes('Última revisión:'));
    assert.equal(revealButton(), null);
  });
});
