/**
 * Tests — Elegibilidad del botón de reveal para candidatos Lusha (Agente 2A ·
 * PHONE-3D.6B)
 *
 * Fix del bug de producción: el botón "Revelar teléfono" NO aparecía para
 * candidatos Lusha con identidad suficiente (email / LinkedIn) porque la UI
 * exigía `account_id` del run y no miraba la identidad, siendo MÁS restrictiva
 * que el server action. Ahora la elegibilidad de la UI está alineada con la
 * reachability del server (`buildApolloPhoneRevealMatchParams`): basta
 * source_contact_id, email o LinkedIn — sin importar la fuente del candidato.
 *
 * Render real de React (jsdom + @testing-library/react). NO toca el servidor,
 * NO llama proveedores, NO escribe en DB, NO revela teléfonos reales: el server
 * action está mockeado y devuelve resultados sintéticos.
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
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mocks de boundary ──────────────────────────────────────────────────────

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
    revealCandidatePhoneAction: (...args: unknown[]) => mockReveal(...(args as [unknown])),
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Candidato base tipo Lusha SIN account_id resuelto en el run — el escenario
 * exacto del bug de producción. Los overrides ajustan identidad/estado.
 */
function makeLushaCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-lusha-3d6b',
    full_name: 'Valentina Ruiz',
    title: 'Gerente Comercial',
    email: 'valentina@empresa.com',
    linkedin_url: 'linkedin.com/in/valentina',
    source_contact_id: null,
    phone: null,
    source: 'lusha',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.79,
    enrichment_metadata: {},
    enrichment_run_id: 'run-lusha-3d6b',
    created_at: '2026-07-24T00:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa SAS',
    company_domain: 'empresa.com',
    account_id: null,
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
      phoneRevealEnabled={opts.phoneRevealEnabled ?? true}
      phoneRevealAuthorized={opts.phoneRevealAuthorized ?? true}
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

// ── Elegibilidad: candidatos Lusha con identidad suficiente ──────────────────

describe('PHONE-3D.6B — el botón aparece para candidatos Lusha elegibles', () => {
  it('Lusha con email + LinkedIn y SIN account_id → el botón aparece (bug de prod)', async () => {
    await renderSheet(makeLushaCandidate());
    assert.ok(revealButton(), 'el botón debería aparecer para un candidato Lusha elegible');
    cleanup();
  });

  it('Lusha solo con email (sin LinkedIn ni account_id) → el botón aparece', async () => {
    await renderSheet(makeLushaCandidate({ linkedin_url: null }));
    assert.ok(revealButton());
    cleanup();
  });

  it('Lusha solo con LinkedIn (sin email ni account_id) → el botón aparece', async () => {
    await renderSheet(makeLushaCandidate({ email: null }));
    assert.ok(revealButton());
    cleanup();
  });

  it('solo con source_contact_id (sin email ni LinkedIn) → el botón aparece', async () => {
    await renderSheet(
      makeLushaCandidate({ email: null, linkedin_url: null, source_contact_id: 'apollo-person-77' }),
    );
    assert.ok(revealButton());
    cleanup();
  });

  it('no exige que la fuente sea Apollo: candidato Lusha con identidad → aparece', async () => {
    await renderSheet(makeLushaCandidate({ source: 'lusha', account_id: null }));
    assert.ok(revealButton());
    cleanup();
  });
});

// ── Elegibilidad: casos que NO deben ofrecer reveal ──────────────────────────

describe('PHONE-3D.6B — casos que ocultan el botón (fail-closed)', () => {
  it('sin email / LinkedIn / source_contact_id → identidad insuficiente → oculto', async () => {
    await renderSheet(
      makeLushaCandidate({ email: null, linkedin_url: null, source_contact_id: null }),
    );
    assert.equal(revealButton(), null);
    cleanup();
  });

  it('ya revelado (status revealed) → oculto', async () => {
    await renderSheet(makeLushaCandidate({ phone_reveal_status: 'revealed', phone: '+573001112233' }));
    assert.equal(revealButton(), null);
    cleanup();
  });

  it('teléfono con source apollo_reveal → oculto', async () => {
    await renderSheet(
      makeLushaCandidate({
        phone: '+573001112233',
        enrichment_metadata: {
          phone: { number: '+573001112233', type: 'mobile', source: 'apollo_reveal', raw_type: 'mobile' },
        },
      }),
    );
    assert.equal(revealButton(), null);
    cleanup();
  });

  it('no_phone_found previo → oculto (sin reintento)', async () => {
    await renderSheet(makeLushaCandidate({ phone_reveal_status: 'no_phone_found' }));
    assert.equal(revealButton(), null);
    cleanup();
  });

  it('flag OFF → oculto (aunque la identidad sea suficiente)', async () => {
    await renderSheet(makeLushaCandidate(), { phoneRevealEnabled: false, phoneRevealAuthorized: true });
    assert.equal(revealButton(), null);
    cleanup();
  });

  it('rol no autorizado → oculto', async () => {
    await renderSheet(makeLushaCandidate(), { phoneRevealEnabled: true, phoneRevealAuthorized: false });
    assert.equal(revealButton(), null);
    cleanup();
  });
});

// ── Contrato del payload (sin PII) para un candidato Lusha ───────────────────

describe('PHONE-3D.6B — payload mínimo del action (sin PII) para candidato Lusha', () => {
  it('confirmar → llama al action con candidateId + confirmCost + créditos + base, sin PII', async () => {
    await renderSheet(makeLushaCandidate());
    fireEvent.click(screen.getByRole('button', { name: 'Revelar teléfono' }));
    await waitFor(() => {
      if (!screen.queryByText('Revelar teléfono del candidato')) {
        throw new Error('reveal dialog not open yet');
      }
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Interés legítimo B2B' }));
    fireEvent.click(
      screen.getByRole('button', { name: /Revelar teléfono \(hasta 8 créditos\)/ }),
    );

    await waitFor(() => {
      if (mockReveal.mock.callCount() !== 1) throw new Error('action not called yet');
    });
    const arg = mockReveal.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(arg.candidateId, 'cand-lusha-3d6b');
    assert.equal(arg.confirmCost, true);
    assert.equal(arg.expectedMaxCredits, 8);
    assert.equal(arg.phoneProcessingBasis, 'legitimate_interest_b2b');
    assert.equal(arg.phoneProcessingBasisNote, undefined);
    // Sin PII: nada de teléfono / email / linkedin / nombre / source_contact_id / payload.
    const keys = Object.keys(arg);
    for (const forbidden of [
      'phone',
      'email',
      'linkedin_url',
      'linkedinUrl',
      'full_name',
      'firstName',
      'name',
      'source_contact_id',
      'sourceContactId',
    ]) {
      assert.equal(keys.includes(forbidden), false, `payload no debe incluir ${forbidden}`);
    }
    cleanup();
  });
});
