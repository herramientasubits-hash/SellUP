/**
 * Tests — Phone type/source badge en revisión humana (Agente 2A · PHONE-3B)
 *
 * Verifica que el detalle de candidato VISUALICE el tipo y la fuente del
 * teléfono que PHONE-3A conservó en `enrichment_metadata.phone`, con render
 * real de React (jsdom + @testing-library/react). NO toca el servidor, NO
 * llama proveedores, NO escribe en DB, NO revela teléfonos — todo mockeado.
 *
 * PHONE-3B es solo UI/typing/tests. Invariantes verificados aquí:
 *   - Sin teléfono → "No disponible", sin badges.
 *   - Teléfono + mobile/apollo_search → número + "Móvil" + "Apollo búsqueda".
 *   - personal_mobile → "Móvil / posible personal" (copy prudente).
 *   - direct_dial → "Directo corporativo".
 *   - hq → "Central / HQ".
 *   - type unknown/ausente → "Tipo desconocido".
 *   - NO existe botón "Revelar teléfono".
 *   - NO se menciona confirmación de costo.
 *   - Botones Aprobar/Rechazar intactos.
 *
 * Requiere --experimental-test-module-mocks (mock.module) para interceptar
 * `@/modules/contact-enrichment/actions`, `next/navigation` y `sonner` antes de
 * importar el componente bajo prueba.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (idéntico patrón al test de identity-override) ────────────

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
import type {
  PendingContactCandidate,
  ContactCandidatePhoneMetadata,
} from '@/modules/contact-enrichment/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mocks de boundary: server actions, router, toast ──────────────────────────

const mockApprove = mock.fn<() => Promise<{ ok: boolean }>>();
const mockDiscard = mock.fn<() => Promise<{ ok: boolean }>>();
const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockRouterRefresh = mock.fn<() => void>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getPendingContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
    approveContactCandidate: (...args: unknown[]) => mockApprove(...(args as [])),
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
    toast: {
      success: () => {},
      warning: () => {},
      error: () => {},
      info: () => {},
    },
  },
});

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-phone-001',
    full_name: 'Andrea Rojas',
    title: 'Directora de Compras',
    email: 'andrea@empresa.com',
    linkedin_url: null,
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.82,
    enrichment_metadata: {},
    enrichment_run_id: 'run-phone-001',
    created_at: '2026-07-23T00:00:00.000Z',
    company_name: 'Empresa SAS',
    company_domain: 'empresa.com',
    account_id: 'acc-001',
    hubspot_company_id: null,
    ...overrides,
  };
}

function withPhone(
  phone: string | null,
  meta: ContactCandidatePhoneMetadata | null,
): PendingContactCandidate {
  return makeCandidate({
    phone,
    enrichment_metadata: meta ? { phone: meta } : {},
  });
}

async function renderWithCandidate(candidate: PendingContactCandidate) {
  mockGetById.mock.mockImplementation(async () => candidate);
  const onClose = mock.fn<() => void>();
  render(
    <ContactCandidateDetailSheet candidateId={candidate.id} open onClose={onClose} />,
  );
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
  return { onClose };
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  mockApprove.mock.resetCalls();
  mockDiscard.mock.resetCalls();
  mockGetById.mock.resetCalls();
  mockRouterRefresh.mock.resetCalls();
});

after(() => {
  cleanup();
});

// ── Caso A — sin teléfono ────────────────────────────────────────────────────

describe('A — candidato sin teléfono', () => {
  it('muestra "No disponible" y no renderiza badges de tipo/fuente', async () => {
    const candidate = withPhone(null, null);
    await renderWithCandidate(candidate);

    // "No disponible" aparece para varios campos vacíos; basta con que exista.
    assert.ok(screen.getAllByText('No disponible').length >= 1);

    // Ningún label de tipo/fuente presente.
    assert.equal(screen.queryByText('Móvil'), null);
    assert.equal(screen.queryByText('Móvil / posible personal'), null);
    assert.equal(screen.queryByText('Apollo búsqueda'), null);
    assert.equal(screen.queryByText('Tipo desconocido'), null);

    cleanup();
  });
});

// ── Caso B — teléfono + mobile + apollo_search ───────────────────────────────

describe('B — teléfono con type mobile / source apollo_search', () => {
  it('muestra número + "Móvil" + "Apollo búsqueda"', async () => {
    const candidate = withPhone('+573001112233', {
      number: '+573001112233',
      type: 'mobile',
      source: 'apollo_search',
      raw_type: 'mobile',
    });
    await renderWithCandidate(candidate);

    assert.ok(screen.getByText('+573001112233'));
    assert.ok(screen.getByText('Móvil'));
    assert.ok(screen.getByText('Apollo búsqueda'));

    cleanup();
  });
});

// ── Caso C — personal_mobile (copy prudente) ─────────────────────────────────

describe('C — teléfono con type personal_mobile', () => {
  it('muestra "Móvil / posible personal" y NUNCA "personal garantizado/confirmado"', async () => {
    const candidate = withPhone('+573004445566', {
      number: '+573004445566',
      type: 'personal_mobile',
      source: 'apollo_search',
      raw_type: 'personal',
    });
    await renderWithCandidate(candidate);

    assert.ok(screen.getByText('Móvil / posible personal'));
    assert.ok(screen.getByText('Apollo búsqueda'));
    // Copy prudente: sin afirmaciones de personal garantizado/confirmado.
    assert.equal(screen.queryByText(/personal garantizado/i), null);
    assert.equal(screen.queryByText(/personal confirmado/i), null);

    cleanup();
  });
});

// ── Caso D — direct_dial y hq ────────────────────────────────────────────────

describe('D — labels direct_dial / work / hq', () => {
  it('direct_dial → "Directo corporativo"', async () => {
    const candidate = withPhone('+576011234567', {
      number: '+576011234567',
      type: 'direct_dial',
      source: 'apollo_search',
      raw_type: 'direct',
    });
    await renderWithCandidate(candidate);
    assert.ok(screen.getByText('Directo corporativo'));
    cleanup();
  });

  it('work → "Trabajo"', async () => {
    const candidate = withPhone('+576017654321', {
      number: '+576017654321',
      type: 'work',
      source: 'apollo_search',
      raw_type: 'work',
    });
    await renderWithCandidate(candidate);
    assert.ok(screen.getByText('Trabajo'));
    cleanup();
  });

  it('hq → "Central / HQ"', async () => {
    const candidate = withPhone('+576010000000', {
      number: '+576010000000',
      type: 'hq',
      source: 'apollo_search',
      raw_type: 'hq',
    });
    await renderWithCandidate(candidate);
    assert.ok(screen.getByText('Central / HQ'));
    cleanup();
  });
});

// ── Caso E — teléfono con tipo unknown/ausente ───────────────────────────────

describe('E — teléfono con tipo unknown o ausente', () => {
  it('type unknown → "Tipo desconocido" + fuente si existe', async () => {
    const candidate = withPhone('+573007778899', {
      number: '+573007778899',
      type: 'unknown',
      source: 'apollo_search',
      raw_type: null,
    });
    await renderWithCandidate(candidate);
    assert.ok(screen.getByText('+573007778899'));
    assert.ok(screen.getByText('Tipo desconocido'));
    assert.ok(screen.getByText('Apollo búsqueda'));
    cleanup();
  });

  it('tipo ausente → "Tipo desconocido"; sin fuente → sin badge de fuente', async () => {
    const candidate = withPhone('+573001234567', {
      number: '+573001234567',
    });
    await renderWithCandidate(candidate);
    assert.ok(screen.getByText('Tipo desconocido'));
    // Sin source declarado → no debe aparecer ningún label de fuente.
    assert.equal(screen.queryByText('Apollo búsqueda'), null);
    assert.equal(screen.queryByText('Fuente desconocida'), null);
    cleanup();
  });
});

// ── Invariantes de seguridad (no reveal, no costo, aprobación intacta) ────────

describe('Invariantes de seguridad — NO reveal, NO costo, aprobación intacta', () => {
  it('con teléfono presente NO renderiza botón "Revelar teléfono" ni menciona costo', async () => {
    const candidate = withPhone('+573001112233', {
      number: '+573001112233',
      type: 'mobile',
      source: 'apollo_search',
      raw_type: 'mobile',
    });
    await renderWithCandidate(candidate);

    assert.equal(screen.queryByRole('button', { name: /revelar/i }), null);
    assert.equal(screen.queryByText(/revelar tel[eé]fono/i), null);
    // No hay confirmación de costo asociada al teléfono en este hito.
    assert.equal(screen.queryByText(/confirmar costo/i), null);
    assert.equal(screen.queryByText(/cr[eé]dito/i), null);

    cleanup();
  });

  it('botones Aprobar/Rechazar siguen presentes (approval flow intacto)', async () => {
    const candidate = withPhone('+573001112233', {
      number: '+573001112233',
      type: 'mobile',
      source: 'apollo_search',
      raw_type: 'mobile',
    });
    await renderWithCandidate(candidate);

    assert.ok(screen.getByRole('button', { name: /^Aprobar candidato$/i }));
    assert.ok(screen.getByRole('button', { name: /rechazar/i }));

    cleanup();
  });
});
