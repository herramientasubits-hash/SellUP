/**
 * Tests — UI de reveal de teléfono en revisión humana (Agente 2A · PHONE-3D.4)
 *
 * Render real de React (jsdom + @testing-library/react) del detalle de
 * candidato con el botón + modal de reveal. NO toca el servidor, NO llama
 * proveedores, NO escribe en DB, NO revela teléfonos reales: el server action
 * `revealCandidatePhoneAction` está mockeado y devuelve resultados sintéticos.
 *
 * Invariantes verificados:
 *   - Con el feature OFF (o rol no autorizado) el botón NO aparece.
 *   - Con el feature ON + candidato elegible el botón aparece.
 *   - El modal muestra el costo "hasta 8 créditos".
 *   - La base de tratamiento es obligatoria (validación cliente).
 *   - other_approved_basis exige nota.
 *   - Confirmar llama al action con confirmCost=true, expectedMaxCredits=8 y la
 *     base; sin teléfono/email/linkedin/nombre.
 *   - revealed → cierra modal + refetch → teléfono + badge "Apollo reveal".
 *   - no_phone_found → mensaje "Teléfono no disponible tras reveal.".
 *   - error → mensaje seguro "No fue posible revelar el teléfono.".
 *   - already_revealed / do_not_contact bloquean el botón.
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
  phoneRevealed: boolean;
  phoneType: string | null;
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

/** Abre el modal de reveal haciendo click en el botón "Revelar teléfono". */
async function openRevealDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Revelar teléfono' }));
  await waitFor(() => {
    if (!screen.queryByText('Revelar teléfono del candidato')) {
      throw new Error('reveal dialog not open yet');
    }
  });
}

function clickConfirm() {
  fireEvent.click(
    screen.getByRole('button', { name: /Revelar teléfono \(hasta 8 créditos\)/ }),
  );
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
    status: 'revealed',
    phoneRevealed: true,
    phoneType: 'mobile',
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
    assert.equal(screen.queryByRole('button', { name: 'Revelar teléfono' }), null);
    cleanup();
  });

  it('feature ON pero rol no autorizado → el botón NO aparece', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: false });
    assert.equal(screen.queryByRole('button', { name: 'Revelar teléfono' }), null);
    cleanup();
  });

  it('feature ON + autorizado + candidato elegible → el botón aparece', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    assert.ok(screen.getByRole('button', { name: 'Revelar teléfono' }));
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
    assert.equal(screen.queryByRole('button', { name: 'Revelar teléfono' }), null);
    // Muestra el badge "Apollo reveal" del teléfono ya revelado.
    assert.ok(screen.getByText('Apollo reveal'));
    cleanup();
  });

  it('candidato con no_phone_found previo → el botón NO aparece (sin reintento)', async () => {
    const candidate = makeCandidate({ phone_reveal_status: 'no_phone_found' });
    await renderSheet(candidate, { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    assert.equal(screen.queryByRole('button', { name: 'Revelar teléfono' }), null);
    cleanup();
  });
});

// ── Modal: costo, base obligatoria, nota condicional ─────────────────────────

describe('Modal de confirmación', () => {
  it('muestra el título y el costo "hasta 8 créditos"', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    await openRevealDialog();
    assert.ok(screen.getByText('Revelar teléfono del candidato'));
    assert.ok(screen.getByText(/hasta 8 créditos Apollo/));
    assert.ok(screen.getByRole('button', { name: /Revelar teléfono \(hasta 8 créditos\)/ }));
    cleanup();
  });

  it('base obligatoria: confirmar sin base → validación y NO llama al action', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    await openRevealDialog();
    clickConfirm();
    await waitFor(() => {
      if (!screen.queryByText('Selecciona la base de tratamiento aplicable.')) {
        throw new Error('validation not shown yet');
      }
    });
    assert.equal(mockReveal.mock.callCount(), 0);
    cleanup();
  });

  it('other_approved_basis exige nota: confirmar sin nota → validación y NO llama', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    await openRevealDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Otra base aprobada' }));
    await waitFor(() => {
      if (!screen.queryByText('Justificación de la base aprobada')) {
        throw new Error('note textarea not shown yet');
      }
    });
    clickConfirm();
    await waitFor(() => {
      if (!screen.queryByText('La justificación de la base aprobada es obligatoria.')) {
        throw new Error('note validation not shown yet');
      }
    });
    assert.equal(mockReveal.mock.callCount(), 0);
    cleanup();
  });
});

// ── Contrato de la llamada + estados de respuesta ────────────────────────────

describe('Llamada al action y estados de respuesta', () => {
  it('confirmar con base → llama al action con el payload mínimo (sin PII)', async () => {
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    await openRevealDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Interés legítimo B2B' }));
    clickConfirm();

    await waitFor(() => {
      if (mockReveal.mock.callCount() !== 1) throw new Error('action not called yet');
    });
    const arg = mockReveal.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(arg.candidateId, 'cand-reveal-001');
    assert.equal(arg.confirmCost, true);
    assert.equal(arg.expectedMaxCredits, 8);
    assert.equal(arg.phoneProcessingBasis, 'legitimate_interest_b2b');
    // Sin nota para bases distintas de other_approved_basis.
    assert.equal(arg.phoneProcessingBasisNote, undefined);
    // Sin PII: nada de teléfono / email / linkedin / nombre / payload.
    const keys = Object.keys(arg);
    for (const forbidden of ['phone', 'email', 'linkedin_url', 'linkedinUrl', 'full_name', 'firstName', 'name']) {
      assert.equal(keys.includes(forbidden), false, `payload no debe incluir ${forbidden}`);
    }
    cleanup();
  });

  it('revealed → cierra modal, refetch y muestra teléfono + badge "Apollo reveal"', async () => {
    const revealed = makeCandidate({
      phone: '+573001112233',
      phone_reveal_status: 'revealed',
      enrichment_metadata: {
        phone: { number: '+573001112233', type: 'mobile', source: 'apollo_reveal', raw_type: 'mobile' },
      },
    });
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    await openRevealDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Interés legítimo B2B' }));
    // El refetch posterior devuelve el candidato ya revelado.
    mockGetById.mock.mockImplementation(async () => revealed);
    clickConfirm();

    await waitFor(() => {
      if (!screen.queryByText('Apollo reveal')) throw new Error('revealed badge not shown yet');
    });
    // Modal cerrado y botón de reveal ya no disponible.
    assert.equal(screen.queryByText('Revelar teléfono del candidato'), null);
    assert.equal(screen.queryByRole('button', { name: 'Revelar teléfono' }), null);
    assert.ok(screen.getByText('+573001112233'));
    cleanup();
  });

  it('no_phone_found → muestra "Teléfono no disponible tras reveal."', async () => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: true,
      status: 'no_phone_found',
      phoneRevealed: false,
      phoneType: null,
      errorCode: null,
    }));
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    await openRevealDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Interés legítimo B2B' }));
    clickConfirm();
    await waitFor(() => {
      if (!screen.queryByText('Teléfono no disponible tras reveal.')) {
        throw new Error('no_phone_found notice not shown yet');
      }
    });
    cleanup();
  });

  it('error → muestra mensaje seguro y mantiene el modal', async () => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'error',
      phoneRevealed: false,
      phoneType: null,
      errorCode: 'apollo_reveal_failed',
    }));
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    await openRevealDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Interés legítimo B2B' }));
    clickConfirm();
    await waitFor(() => {
      if (!screen.queryByText('No fue posible revelar el teléfono.')) {
        throw new Error('safe error not shown yet');
      }
    });
    // El modal sigue abierto para reintentar / cancelar.
    assert.ok(screen.getByText('Revelar teléfono del candidato'));
    cleanup();
  });

  it('unauthorized_role del servidor → muestra "No tienes permisos…"', async () => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'unauthorized_role',
      phoneRevealed: false,
      phoneType: null,
      errorCode: null,
    }));
    await renderSheet(makeCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: true });
    await openRevealDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Interés legítimo B2B' }));
    clickConfirm();
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
