/**
 * Tests — UI de reveal de teléfono en revisión humana (Agente 2A · one-click)
 *
 * APOLLO-PHONE-ASYNC-5: producto eliminó el modal de confirmación/base legal.
 * El botón "Revelar teléfono" ahora solicita la revelación asíncrona en UN clic,
 * con base fija (interés legítimo B2B). Render real de React (jsdom +
 * @testing-library/react) del detalle de candidato. NO toca el servidor, NO
 * llama proveedores, NO escribe en DB, NO revela teléfonos reales: el server
 * action `revealCandidatePhoneAction` está mockeado y devuelve resultados
 * sintéticos.
 *
 * Invariantes verificados:
 *   - Con el feature OFF (o rol no autorizado) el botón NO aparece.
 *   - Con el feature ON + candidato elegible el botón aparece.
 *   - El clic NO abre ningún modal/diálogo de reveal (no existe selector de base).
 *   - El clic llama al action UNA sola vez con confirmCost=true,
 *     expectedMaxCredits=8 y base legitimate_interest_b2b; sin PII.
 *   - Doble clic no dispara dos actions; el botón queda deshabilitado (loading).
 *   - requested/pending → "Revelación en proceso" y el botón se oculta.
 *   - revealed → teléfono + badge "Apollo reveal".
 *   - no_phone_found → mensaje seguro; error → mensaje seguro.
 *   - No hay reveal en lote; los botones Aprobar/Rechazar siguen intactos.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (idéntico patrón a los tests de phone-badge / identity) ───

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
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mocks de boundary: server actions, router, toast ──────────────────────────

type RevealResult = {
  ok: boolean;
  status: string;
  requestAccepted: boolean;
  errorCode: string | null;
};

const mockApprove = mock.fn<() => Promise<{ ok: boolean }>>();
const mockDiscard = mock.fn<() => Promise<{ ok: boolean }>>();
const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockReveal = mock.fn<(input: unknown) => Promise<RevealResult>>();
const mockRouterRefresh = mock.fn<() => void>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getPendingContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
    approveContactCandidate: (...args: unknown[]) => mockApprove(...(args as [])),
    discardContactCandidate: (...args: unknown[]) => mockDiscard(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-actions', {
  namedExports: {
    revealCandidatePhoneAction: (...args: unknown[]) =>
      mockReveal(...(args as [unknown])),
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: mockRouterRefresh, push: () => {}, replace: () => {} }),
  },
});

mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-reveal-001',
    full_name: 'Andrea Rojas',
    title: 'Directora de Compras',
    email: 'andrea@empresa.com',
    linkedin_url: 'linkedin.com/in/andrea',
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.82,
    enrichment_metadata: {},
    enrichment_run_id: 'run-reveal-001',
    created_at: '2026-07-24T00:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa SAS',
    company_domain: 'empresa.com',
    account_id: 'acc-001',
    hubspot_company_id: null,
    ...overrides,
  };
}

interface RenderOpts {
  phoneRevealEnabled?: boolean;
  phoneRevealAuthorized?: boolean;
}

async function renderSheet(candidate: PendingContactCandidate, opts: RenderOpts = {}) {
  mockGetById.mock.mockImplementation(async () => candidate);
  const onClose = mock.fn<() => void>();
  render(
    <ContactCandidateDetailSheet
      candidateId={candidate.id}
      open
      onClose={onClose}
      phoneRevealEnabled={opts.phoneRevealEnabled ?? false}
      phoneRevealAuthorized={opts.phoneRevealAuthorized ?? false}
    />,
  );
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
  return { onClose };
}

function revealButton() {
  return screen.queryByRole('button', { name: 'Revelar teléfono' });
}

function clickReveal() {
  fireEvent.click(screen.getByRole('button', { name: 'Revelar teléfono' }));
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, waitFor, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  mockApprove.mock.resetCalls();
  mockDiscard.mock.resetCalls();
  mockGetById.mock.resetCalls();
  mockReveal.mock.resetCalls();
  mockRouterRefresh.mock.resetCalls();
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

// ── Visibilidad del botón ────────────────────────────────────────────────────

describe('Visibilidad del botón "Revelar teléfono"', () => {
  it('feature OFF → el botón NO aparece', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: false, phoneRevealAuthorized: true });
    assert.equal(revealButton(), null);
    cleanup();
  });

  it('feature ON pero rol no autorizado → el botón NO aparece', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: false });
    assert.equal(revealButton(), null);
    cleanup();
  });

  it('feature ON + autorizado + candidato elegible → el botón aparece', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    assert.ok(revealButton());
    cleanup();
  });

  it('candidato ya revelado (source apollo_reveal) → el botón NO aparece', async () => {
    const candidate = makeCandidate({
      phone: '+573001112233',
      phone_reveal_status: 'revealed',
      enrichment_metadata: {
        phone: { number: '+573001112233', type: 'mobile', source: 'apollo_reveal', raw_type: 'mobile' },
      },
    });
    await renderSheet(candidate, { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    assert.equal(revealButton(), null);
    // Muestra el badge "Apollo reveal" del teléfono ya revelado.
    assert.ok(screen.getByText('Apollo reveal'));
    cleanup();
  });

  it('candidato con no_phone_found previo → el botón NO aparece (sin reintento)', async () => {
    const candidate = makeCandidate({ phone_reveal_status: 'no_phone_found' });
    await renderSheet(candidate, { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    assert.equal(revealButton(), null);
    // Mensaje seguro, sin botón de reintento.
    assert.ok(screen.getByText('Teléfono no disponible tras consultar Apollo.'));
    cleanup();
  });
});

// ── One-click: NO hay modal ni selector de base ──────────────────────────────

describe('One-click: sin modal ni selección de base', () => {
  it('el clic NO abre ningún diálogo de reveal', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    clickReveal();
    await waitFor(() => {
      if (mockReveal.mock.callCount() !== 1) throw new Error('action not called yet');
    });
    // No aparece el título del viejo modal ni el selector de base.
    assert.equal(screen.queryByText('Revelar teléfono del candidato'), null);
    assert.equal(screen.queryByRole('radiogroup', { name: /base de tratamiento/i }), null);
    assert.equal(
      screen.queryByRole('button', { name: /Solicitar revelación/ }),
      null,
    );
    cleanup();
  });

  it('muestra el microcopy de costo/base junto al botón (no bloqueante)', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    assert.ok(screen.getByText(/hasta 8 créditos y tardar algunos minutos/));
    assert.ok(screen.getByText('Base aplicada: interés legítimo B2B.'));
    cleanup();
  });
});

// ── Contrato de la llamada al action ─────────────────────────────────────────

describe('El clic llama al action con el payload mínimo (sin PII)', () => {
  it('un clic → action con confirmCost=true, créditos=8 y base fija', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    clickReveal();

    await waitFor(() => {
      if (mockReveal.mock.callCount() !== 1) throw new Error('action not called yet');
    });
    const arg = mockReveal.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(arg.candidateId, 'cand-reveal-001');
    assert.equal(arg.confirmCost, true);
    assert.equal(arg.expectedMaxCredits, 8);
    assert.equal(arg.phoneProcessingBasis, 'legitimate_interest_b2b');
    // Base fija: nunca se manda nota.
    assert.equal(arg.phoneProcessingBasisNote, undefined);
    // Sin PII: nada de teléfono / email / linkedin / nombre / payload.
    const keys = Object.keys(arg);
    for (const forbidden of ['phone', 'email', 'linkedin_url', 'linkedinUrl', 'full_name', 'firstName', 'name']) {
      assert.equal(keys.includes(forbidden), false, `payload no debe incluir ${forbidden}`);
    }
    cleanup();
  });
});

// ── Loading + protección contra doble clic ───────────────────────────────────

describe('Loading y protección contra doble clic', () => {
  it('doble clic no dispara dos actions', async () => {
    // El action queda pendiente hasta resolverlo manualmente para simular latencia.
    let resolveReveal: (v: RevealResult) => void = () => {};
    mockReveal.mock.mockImplementation(
      () =>
        new Promise<RevealResult>((resolve) => {
          resolveReveal = resolve;
        }),
    );
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    clickReveal();
    // Segundo clic inmediato (antes de que resuelva la primera solicitud).
    fireEvent.click(screen.getByRole('button', { name: 'Solicitando…' }));

    assert.equal(mockReveal.mock.callCount(), 1, 'solo debe llamarse una vez');
    // El botón está en estado loading y deshabilitado.
    const loadingBtn = screen.getByRole('button', {
      name: 'Solicitando…',
    }) as HTMLButtonElement;
    assert.equal(loadingBtn.disabled, true);

    resolveReveal({ ok: true, status: 'requested', requestAccepted: true, errorCode: null });
    cleanup();
  });
});

// ── Estados de respuesta ─────────────────────────────────────────────────────

describe('Estados de respuesta', () => {
  it('requested → refetch y muestra "Revelación en proceso"; el botón se oculta', async () => {
    const inFlight = makeCandidate({ phone_reveal_status: 'requested' });
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    // El refetch posterior devuelve el candidato en estado en vuelo.
    mockGetById.mock.mockImplementation(async () => inFlight);
    clickReveal();

    await waitFor(() => {
      if (!screen.queryByText('Revelación en proceso')) {
        throw new Error('pending badge not shown yet');
      }
    });
    assert.equal(revealButton(), null);
    // RECOVERY-CRON-1: el copy en vuelo dejó de prometer que basta esperar en esta
    // pantalla; ahora dice que el servidor revisa el resultado. Detalle en
    // contact-candidate-detail-phone-reveal-stale-ui.test.tsx.
    assert.ok(
      (document.body.textContent ?? '')
        .replace(/\s+/g, ' ')
        .includes('SellUp revisará automáticamente el resultado'),
    );
    cleanup();
  });

  it('already_pending → muestra "Revelación en proceso" y oculta el botón', async () => {
    const inFlight = makeCandidate({ phone_reveal_status: 'pending' });
    mockReveal.mock.mockImplementation(async () => ({
      ok: true,
      status: 'already_pending',
      requestAccepted: false,
      errorCode: null,
    }));
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    mockGetById.mock.mockImplementation(async () => inFlight);
    clickReveal();

    await waitFor(() => {
      if (!screen.queryByText('Revelación en proceso')) {
        throw new Error('pending badge not shown yet');
      }
    });
    assert.equal(revealButton(), null);
    cleanup();
  });

  it('provider_not_configured → mensaje seguro junto al botón (sigue disponible)', async () => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'provider_not_configured',
      requestAccepted: false,
      errorCode: null,
    }));
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    clickReveal();
    await waitFor(() => {
      if (!screen.queryByText('La revelación de teléfono no está configurada.')) {
        throw new Error('provider_not_configured message not shown yet');
      }
    });
    // El botón sigue visible para reintentar.
    assert.ok(revealButton());
    cleanup();
  });

  it('error → mensaje seguro (sin detalle técnico) y el botón sigue disponible', async () => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'error',
      requestAccepted: false,
      errorCode: 'HTTP_422',
    }));
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    clickReveal();
    await waitFor(() => {
      if (!screen.queryByText('No fue posible solicitar la revelación del teléfono.')) {
        throw new Error('safe error not shown yet');
      }
    });
    // No filtra el código técnico del proveedor.
    assert.equal(screen.queryByText(/HTTP_422/), null);
    assert.ok(revealButton());
    cleanup();
  });

  it('unauthorized_role del servidor → muestra "No tienes permisos…"', async () => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'unauthorized_role',
      requestAccepted: false,
      errorCode: null,
    }));
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    clickReveal();
    await waitFor(() => {
      if (!screen.queryByText('No tienes permisos para revelar teléfonos.')) {
        throw new Error('unauthorized message not shown yet');
      }
    });
    cleanup();
  });
});

// ── Invariantes: sin bulk, approval flow intacto ─────────────────────────────

describe('Invariantes de seguridad', () => {
  it('no existe un botón de reveal en lote / masivo', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    assert.equal(screen.queryByRole('button', { name: /revelar.*todos|revelar.*lote|masivo/i }), null);
    // Un único botón "Revelar teléfono" (el disparador individual).
    assert.equal(screen.getAllByRole('button', { name: 'Revelar teléfono' }).length, 1);
    cleanup();
  });

  it('los botones Aprobar/Rechazar siguen presentes (approval flow intacto)', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    assert.ok(screen.getByRole('button', { name: /^Aprobar candidato$/i }));
    assert.ok(screen.getByRole('button', { name: /rechazar/i }));
    cleanup();
  });
});
