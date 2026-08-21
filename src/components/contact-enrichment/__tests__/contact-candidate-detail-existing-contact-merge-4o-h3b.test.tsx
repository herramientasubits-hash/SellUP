/**
 * Tests — decisión humana sobre un duplicado con contacto existente
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-H3-B)
 *
 * Render real de React (jsdom + @testing-library/react). NO toca el servidor, NO llama
 * proveedores, NO escribe en DB — todo mockeado en el límite exacto.
 *
 * Lo que se fija aquí es la parte del contrato que sólo se ve en pantalla:
 *
 *   - sin oferta del servidor, el flujo de duplicado es EXACTAMENTE el de antes de este hito
 *     (aviso y cierre) — ninguna acción nueva aparece;
 *   - con oferta, el drawer NO se cierra: se muestran las DOS decisiones y ninguna se toma sola;
 *   - «Descartar como duplicado» no llama a ninguna acción de servidor: el veredicto ya estaba
 *     escrito;
 *   - «Agregar información» envía el candidato y el contacto que el SERVIDOR ofreció, nunca otro;
 *   - un doble clic produce UNA sola petición;
 *   - la pantalla no expone internals: ni uuids, ni nombres de columna, ni la evidencia cruda.
 *
 * Requiere --experimental-test-module-mocks.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que las suites hermanas) ────────────────────

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
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mocks de boundary ─────────────────────────────────────────────────────────

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

type ApproveResult = {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  contactId?: string;
  mergeOffer?:
    | { offered: true; contactId: string; signal: 'email' | 'linkedin' }
    | { offered: false; reason: string };
};

const mockApprove = mock.fn<() => Promise<ApproveResult>>();
const mockMerge = mock.fn<
  (candidateId: string, contactId: string) => Promise<{ ok: boolean; message?: string; error?: string }>
>();
const mockDiscard = mock.fn<() => Promise<{ ok: boolean }>>();
const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockRouterRefresh = mock.fn<() => void>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getReviewableContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
    // 4O-H3-B-R1: el drawer relee la oferta duradera al abrir un candidato ya `duplicate`. En
    // esta suite los candidatos entran en `pending_review`, así que no se llama; se declara para
    // que el módulo mockeado siga siendo completo.
    getDuplicateCandidateMergeOffer: async () => null,
    approveContactCandidate: (...args: unknown[]) => mockApprove(...(args as [])),
    mergeContactCandidateIntoExistingContactAction: (...args: [string, string]) =>
      mockMerge(...args),
    discardContactCandidate: (...args: unknown[]) => mockDiscard(...(args as [])),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-h3b-001',
    full_name: 'Carolina Herrera',
    title: 'VP de Ventas',
    email: 'carolina@empresa.com',
    linkedin_url: null,
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-001',
    created_at: '2026-08-12T00:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa SAS',
    company_domain: 'empresa.com',
    account_id: 'acc-001',
    hubspot_company_id: null,
    ...overrides,
  };
}

async function renderAndApprove(result: ApproveResult) {
  const candidate = makeCandidate();
  mockGetById.mock.mockImplementation(async () => candidate);
  mockApprove.mock.mockImplementation(async () => result);
  const onClose = mock.fn<() => void>();
  render(<ContactCandidateDetailSheet candidateId={candidate.id} open onClose={onClose} />);
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
  fireEvent.click(screen.getByRole('button', { name: /^Aprobar candidato$/i }));
  await waitFor(() => {
    if (mockApprove.mock.callCount() === 0) throw new Error('approve not called yet');
  });
  return { candidate, onClose };
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  mockApprove.mock.resetCalls();
  mockMerge.mock.resetCalls();
  mockDiscard.mock.resetCalls();
  mockGetById.mock.resetCalls();
  mockRouterRefresh.mock.resetCalls();
  cleanup();
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// 1. Sin oferta: nada cambia
// ═══════════════════════════════════════════════════════════════

describe('1 — sin oferta del servidor, el duplicado se comporta como siempre', () => {
  it('1a duplicado sin `mergeOffer` → cierra el drawer y no aparece ninguna acción nueva', async () => {
    const { onClose } = await renderAndApprove({
      ok: false,
      duplicate: true,
      contactId: CONTACT_ID,
      error: 'Este candidato parece estar duplicado con un contacto existente.',
    });
    await waitFor(() => {
      if (onClose.mock.callCount() === 0) throw new Error('todavía no cerró');
    });
    assert.equal(
      screen.queryByRole('button', { name: /Agregar información al contacto existente/i }),
      null,
    );
    assert.equal(mockMerge.mock.callCount(), 0);
  });

  it('1b oferta RECHAZADA (identidad por nombre) → tampoco aparece la acción', async () => {
    const { onClose } = await renderAndApprove({
      ok: false,
      duplicate: true,
      contactId: CONTACT_ID,
      mergeOffer: { offered: false, reason: 'name_only' },
    });
    await waitFor(() => {
      if (onClose.mock.callCount() === 0) throw new Error('todavía no cerró');
    });
    assert.equal(
      screen.queryByRole('button', { name: /Agregar información al contacto existente/i }),
      null,
    );
    assert.equal(mockMerge.mock.callCount(), 0);
  });

  it('1c oferta AMBIGUA → tampoco aparece la acción', async () => {
    const { onClose } = await renderAndApprove({
      ok: false,
      duplicate: true,
      contactId: CONTACT_ID,
      mergeOffer: { offered: false, reason: 'multiple_contacts' },
    });
    await waitFor(() => {
      if (onClose.mock.callCount() === 0) throw new Error('todavía no cerró');
    });
    assert.equal(mockMerge.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Con oferta: la decisión es del humano
// ═══════════════════════════════════════════════════════════════

describe('2 — con oferta, se presentan las dos decisiones y ninguna se toma sola', () => {
  const offered: ApproveResult = {
    ok: false,
    duplicate: true,
    contactId: CONTACT_ID,
    mergeOffer: { offered: true, contactId: CONTACT_ID, signal: 'email' },
  };

  it('2a no cierra el drawer y muestra AMBAS acciones', async () => {
    const { onClose } = await renderAndApprove(offered);
    await waitFor(() => {
      screen.getByRole('button', { name: /Agregar información al contacto existente/i });
    });
    assert.ok(screen.getByRole('button', { name: /Descartar como duplicado/i }));
    assert.equal(onClose.mock.callCount(), 0, 'la decisión no puede tomarse cerrando el drawer');
    assert.equal(mockMerge.mock.callCount(), 0, 'aprobar NUNCA fusiona por sí solo');
  });

  it('2b explica la coincidencia sin exponer internals', async () => {
    await renderAndApprove(offered);
    await waitFor(() => {
      screen.getByRole('button', { name: /Agregar información al contacto existente/i });
    });
    const text = document.body.textContent ?? '';
    assert.match(text, /coincide con un contacto que ya existe/i);
    assert.match(text, /correo electrónico/i);
    // Ni el uuid, ni el nombre de la columna, ni el vocabulario interno.
    for (const internal of [CONTACT_ID, 'matched_contacts_id', 'mergeOffer', 'dedupe']) {
      assert.equal(text.includes(internal), false, `${internal} no puede aparecer en pantalla`);
    }
  });

  it('2c promete explícitamente que no se reemplaza lo que el contacto ya tiene', async () => {
    await renderAndApprove(offered);
    await waitFor(() => {
      screen.getByRole('button', { name: /Agregar información al contacto existente/i });
    });
    assert.match(document.body.textContent ?? '', /No se reemplaza nada/i);
  });

  it('2d con señal LinkedIn el texto lo dice, sin cambiar la acción', async () => {
    await renderAndApprove({
      ...offered,
      mergeOffer: { offered: true, contactId: CONTACT_ID, signal: 'linkedin' },
    });
    await waitFor(() => {
      screen.getByRole('button', { name: /Agregar información al contacto existente/i });
    });
    assert.match(document.body.textContent ?? '', /perfil de LinkedIn/i);
  });

  it('2e «Descartar como duplicado» cierra sin llamar a ninguna acción de servidor', async () => {
    const { onClose } = await renderAndApprove(offered);
    await waitFor(() => {
      screen.getByRole('button', { name: /Descartar como duplicado/i });
    });
    fireEvent.click(screen.getByRole('button', { name: /Descartar como duplicado/i }));
    await waitFor(() => {
      if (onClose.mock.callCount() === 0) throw new Error('todavía no cerró');
    });
    assert.equal(mockMerge.mock.callCount(), 0);
    assert.equal(mockDiscard.mock.callCount(), 0, 'el veredicto duplicado ya estaba escrito');
  });

  it('2f «Agregar información» envía el candidato y el contacto que ofreció el SERVIDOR', async () => {
    mockMerge.mock.mockImplementation(async () => ({ ok: true, message: 'Listo.' }));
    const { candidate, onClose } = await renderAndApprove(offered);
    await waitFor(() => {
      screen.getByRole('button', { name: /Agregar información al contacto existente/i });
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Agregar información al contacto existente/i }),
    );
    await waitFor(() => {
      if (mockMerge.mock.callCount() === 0) throw new Error('merge no llamado');
    });
    assert.deepEqual(mockMerge.mock.calls[0].arguments, [candidate.id, CONTACT_ID]);
    await waitFor(() => {
      if (onClose.mock.callCount() === 0) throw new Error('todavía no cerró');
    });
  });

  it('2g un DOBLE clic produce UNA sola petición', async () => {
    let resolveMerge: (v: { ok: boolean }) => void = () => {};
    mockMerge.mock.mockImplementation(
      () => new Promise<{ ok: boolean }>((resolve) => { resolveMerge = resolve; }),
    );
    await renderAndApprove(offered);
    await waitFor(() => {
      screen.getByRole('button', { name: /Agregar información al contacto existente/i });
    });
    const button = screen.getByRole('button', {
      name: /Agregar información al contacto existente/i,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    assert.equal(mockMerge.mock.callCount(), 1);
    resolveMerge({ ok: true });
  });

  it('2h un fallo del servidor NO cierra el drawer ni pierde la decisión', async () => {
    mockMerge.mock.mockImplementation(async () => ({ ok: false, error: 'No fue posible.' }));
    const { onClose } = await renderAndApprove(offered);
    await waitFor(() => {
      screen.getByRole('button', { name: /Agregar información al contacto existente/i });
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Agregar información al contacto existente/i }),
    );
    await waitFor(() => {
      if (mockMerge.mock.callCount() === 0) throw new Error('merge no llamado');
    });
    await waitFor(() => {
      screen.getByRole('button', { name: /Agregar información al contacto existente/i });
    });
    assert.equal(onClose.mock.callCount(), 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Invariantes: la aprobación limpia no se toca
// ═══════════════════════════════════════════════════════════════

describe('3 — la aprobación limpia sigue igual', () => {
  it('3a aprobar sin duplicado cierra el drawer y nunca abre la decisión', async () => {
    const { onClose } = await renderAndApprove({ ok: true });
    await waitFor(() => {
      if (onClose.mock.callCount() === 0) throw new Error('todavía no cerró');
    });
    assert.equal(
      screen.queryByRole('button', { name: /Agregar información al contacto existente/i }),
      null,
    );
    assert.equal(mockMerge.mock.callCount(), 0);
  });
});
