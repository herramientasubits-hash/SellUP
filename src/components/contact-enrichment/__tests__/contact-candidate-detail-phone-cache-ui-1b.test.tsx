/**
 * Tests UI — Apollo Phone Cache: estados nuevos del reveal (Agente 2A ·
 * APOLLO-PHONE-CACHE-1b, FIX H2 / FIX H4)
 *
 * Antes de este fix, `revealed_from_cache`, `blocked_suppressed` y
 * `cache_unavailable` caían en el `default` del switch de `applyPhoneRevealResult`
 * y se mostraban como "No fue posible solicitar la revelación del teléfono":
 *   * un cache hit EXITOSO se presentaba como error y no recargaba el candidato,
 *     así que el operador no veía el teléfono que ya estaba persistido;
 *   * un bloqueo por supresión (DSAR) se confundía con un fallo transitorio, e
 *     invitaba a reintentar algo que nunca puede tener éxito.
 *
 * Render real de React (jsdom + @testing-library/react). NO toca el servidor,
 * NO llama proveedores, NO escribe en DB, NO revela teléfonos reales: el server
 * action está mockeado y devuelve resultados sintéticos.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que los tests 3D.4 / 3D.6B) ────────────────

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

// ── Mocks de boundary ──────────────────────────────────────────────────────

type RevealResult = {
  ok: boolean;
  status: string;
  requestAccepted: boolean;
  errorCode: string | null;
  servedFromCache?: boolean;
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
    revealCandidatePhoneAction: (...args: unknown[]) => mockReveal(...(args as [unknown])),
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: mockRouterRefresh, push: () => {}, replace: () => {} }),
  },
});

// Toast como no-op, igual que los tests 3D.4 / 3D.6B: lo observable para el
// operador (y lo que se asegura aquí) es el texto RENDERIZADO en el panel. Que
// cada rama emita su toast se vigila en el guard estático de CACHE-1b.
mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Candidato Apollo elegible para reveal y SIN teléfono todavía. */
function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-cache-1b',
    full_name: 'Nombre Apellido',
    title: 'Gerente Comercial',
    email: 'contacto@empresa-ejemplo.test',
    linkedin_url: null,
    source_contact_id: '6a6826ba804c600014ead739',
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.81,
    enrichment_metadata: {},
    enrichment_run_id: 'run-cache-1b',
    created_at: '2026-07-29T00:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa Ejemplo SAS',
    company_domain: 'empresa-ejemplo.test',
    account_id: 'acct-aaaa-1111',
    hubspot_company_id: null,
    ...overrides,
  };
}

const SUPPRESSED_MESSAGE =
  'No se puede revelar este teléfono porque existe una supresión registrada.';
const GENERIC_ERROR = 'No fue posible solicitar la revelación del teléfono.';
const REUSE_NOTICE = 'Reutilizado de una revelación anterior (sin costo).';

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

function revealButton() {
  return screen.queryByRole('button', { name: 'Revelar teléfono' });
}

/** Espera a que el panel muestre el aviso de reutilización desde caché. */
async function waitForReuseNotice() {
  await waitFor(() => {
    if (screen.queryByText(REUSE_NOTICE) === null) {
      throw new Error('aviso de reutilización no renderizado');
    }
  });
}

/** Hace clic en "Revelar teléfono" y espera a que la acción se haya resuelto. */
async function clickReveal() {
  const button = revealButton();
  assert.ok(button, 'el botón de reveal debería estar visible');
  fireEvent.click(button);
  await waitFor(() => {
    if (mockReveal.mock.callCount() === 0) throw new Error('reveal not called yet');
  });
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────

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
});

after(() => {
  cleanup();
});

// ── FIX H2: cache hit = éxito ────────────────────────────────────────────────

describe('CACHE-1b UI — revealed_from_cache es un ÉXITO', () => {
  beforeEach(() => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: true,
      status: 'revealed_from_cache',
      requestAccepted: false,
      errorCode: null,
      servedFromCache: true,
    }));
  });

  it('recarga el candidato para mostrar el teléfono ya persistido', async () => {
    await renderSheet(makeCandidate());
    const callsBefore = mockGetById.mock.callCount();
    await clickReveal();
    await waitFor(() => {
      if (mockGetById.mock.callCount() <= callsBefore) {
        throw new Error('reloadCandidate no se ejecutó');
      }
    });
    cleanup();
  });

  it('NO muestra el mensaje de error genérico', async () => {
    await renderSheet(makeCandidate());
    await clickReveal();
    await waitForReuseNotice();
    assert.equal(screen.queryByText(GENERIC_ERROR), null);
    assert.equal(screen.queryByText(SUPPRESSED_MESSAGE), null);
    cleanup();
  });

  it('muestra un aviso positivo que aclara que no hubo costo', async () => {
    await renderSheet(makeCandidate());
    await clickReveal();
    await waitForReuseNotice();
    const notice = screen.getByText(REUSE_NOTICE).textContent ?? '';
    assert.match(notice, /sin costo/i);
    cleanup();
  });
});

// ── FIX H2: supresión = bloqueo explicado ────────────────────────────────────

describe('CACHE-1b UI — blocked_suppressed es un bloqueo explicado', () => {
  beforeEach(() => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'blocked_suppressed',
      requestAccepted: false,
      errorCode: null,
      servedFromCache: false,
    }));
  });

  it('muestra el mensaje específico de supresión', async () => {
    await renderSheet(makeCandidate());
    await clickReveal();
    await waitFor(() => {
      if (screen.queryByText(SUPPRESSED_MESSAGE) === null) {
        throw new Error('mensaje de supresión no renderizado');
      }
    });
    cleanup();
  });

  it('NO usa el mensaje de fallo genérico', async () => {
    await renderSheet(makeCandidate());
    await clickReveal();
    await waitFor(() => {
      if (screen.queryByText(SUPPRESSED_MESSAGE) === null) {
        throw new Error('mensaje de supresión no renderizado');
      }
    });
    assert.equal(screen.queryByText(GENERIC_ERROR), null);
    cleanup();
  });

  it('no recarga el candidato: no hay nada nuevo que mostrar', async () => {
    await renderSheet(makeCandidate());
    const callsBefore = mockGetById.mock.callCount();
    await clickReveal();
    await waitFor(() => {
      if (screen.queryByText(SUPPRESSED_MESSAGE) === null) {
        throw new Error('mensaje de supresión no renderizado');
      }
    });
    assert.equal(mockGetById.mock.callCount(), callsBefore);
    cleanup();
  });
});

// ── FIX H4: caché no disponible = fallo seguro ───────────────────────────────

describe('CACHE-1b UI — cache_unavailable es un fallo seguro y reintentable', () => {
  beforeEach(() => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'cache_unavailable',
      requestAccepted: false,
      errorCode: 'cache_unavailable',
      servedFromCache: false,
    }));
  });

  it('explica que no se pudo verificar la caché y que no hubo cargo', async () => {
    await renderSheet(makeCandidate());
    await clickReveal();
    await waitFor(() => {
      if (screen.queryByText(/caché de teléfonos/) === null) {
        throw new Error('mensaje de caché no disponible no renderizado');
      }
    });
    const message = screen.getByText(/caché de teléfonos/).textContent ?? '';
    assert.match(message, /no se hizo ningún cargo/i);
    assert.equal(screen.queryByText(GENERIC_ERROR), null);
    cleanup();
  });
});

// ── FIX 2: supresión no verificable = fallo seguro ────────────────────────────
// Este estado se emite con ENABLE_APOLLO_PHONE_CACHE encendido o apagado: el flag
// gobierna la reutilización, no el cumplimiento de la supresión. La UI tiene que
// decir que no hubo cargo y que se puede reintentar, sin caer en el genérico.

describe('CACHE-1b UI — suppression_check_unavailable es un fallo seguro', () => {
  beforeEach(() => {
    mockReveal.mock.mockImplementation(async () => ({
      ok: false,
      status: 'suppression_check_unavailable',
      requestAccepted: false,
      errorCode: 'suppression_check_unavailable',
      servedFromCache: false,
    }));
  });

  it('explica que no se pudo verificar la supresión y que no hubo cargo', async () => {
    await renderSheet(makeCandidate());
    await clickReveal();
    await waitFor(() => {
      if (screen.queryByText(/supresión registrada/) === null) {
        throw new Error('mensaje de supresión no verificable no renderizado');
      }
    });
    const message = screen.getByText(/supresión registrada/).textContent ?? '';
    assert.match(message, /no se hizo ningún cargo/i);
    assert.match(message, /intenta de nuevo/i);
    assert.equal(screen.queryByText(GENERIC_ERROR), null);
    cleanup();
  });

  it('no recarga el candidato ni muestra el aviso de reutilización', async () => {
    await renderSheet(makeCandidate());
    const callsBefore = mockGetById.mock.callCount();
    await clickReveal();
    await waitFor(() => {
      if (screen.queryByText(/supresión registrada/) === null) {
        throw new Error('mensaje de supresión no verificable no renderizado');
      }
    });
    assert.equal(mockGetById.mock.callCount(), callsBefore);
    assert.equal(screen.queryByText(REUSE_NOTICE), null);
    cleanup();
  });
});
