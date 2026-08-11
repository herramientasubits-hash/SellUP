/**
 * Tests UI — «Ver más números» (Agente 2A · AGENT2A-PHONE-REVEAL-4O-G)
 *
 * Render real de React (jsdom + @testing-library/react) del drawer COMPLETO, no
 * de un componente aislado: lo que hay que demostrar es que el CTA aparece —y
 * sólo aparece— dentro de la pantalla de revisión real, y que pulsarlo no dispara
 * ninguna de las acciones que cuestan dinero.
 *
 * Por eso los mocks de Apollo, Lusha, waterfall y legacy están puestos aunque
 * ningún caso los use: si estuvieran ausentes, «no se llamó al proveedor» sería
 * una afirmación sobre un módulo que no existe en el test. Estando presentes, la
 * aserción `callCount() === 0` es una afirmación sobre el camino real.
 *
 * NO toca el servidor, NO llama proveedores, NO escribe en DB y NO revela
 * teléfonos reales: los server actions están mockeados y los números son ficticios.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que los tests 3D.4 / CACHE-1b) ─────────────

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

// ── Imports dependientes del entorno DOM ─────────────────────────────────────

import * as React from 'react';
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import type { StoredCandidatePhonesResult } from '@/modules/contact-enrichment/candidate-stored-phones-actions';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mocks de boundary ────────────────────────────────────────────────────────

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockApprove = mock.fn<() => Promise<{ ok: boolean }>>();
const mockDiscard = mock.fn<() => Promise<{ ok: boolean }>>();
const mockRouterRefresh = mock.fn<() => void>();

/** Las dos lecturas del hito. */
const mockStoredSummary = mock.fn<() => Promise<{ additionalCount: number }>>();
const mockStoredPhones = mock.fn<() => Promise<StoredCandidatePhonesResult>>();

/** Todo lo que CUESTA. Ningún caso de este archivo puede hacer que se llamen. */
const mockApolloReveal = mock.fn<() => Promise<unknown>>();
const mockLushaFallback = mock.fn<() => Promise<unknown>>();
const mockLegacyWaterfall = mock.fn<() => Promise<unknown>>();
const mockManualRecovery = mock.fn<() => Promise<unknown>>();
const mockWaterfallAudit = mock.fn<() => Promise<null>>();

const SPENDING_MOCKS: readonly (readonly [string, { mock: { callCount(): number } }])[] = [
  ['Apollo reveal', mockApolloReveal],
  ['Lusha fallback', mockLushaFallback],
  ['waterfall legacy', mockLegacyWaterfall],
  ['recovery manual', mockManualRecovery],
];

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getPendingContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
    approveContactCandidate: (...args: unknown[]) => mockApprove(...(args as [])),
    discardContactCandidate: (...args: unknown[]) => mockDiscard(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/candidate-stored-phones-actions', {
  namedExports: {
    getCandidateStoredPhoneSummaryAction: (...args: unknown[]) =>
      mockStoredSummary(...(args as [])),
    getCandidateStoredPhonesAction: (...args: unknown[]) => mockStoredPhones(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-actions', {
  namedExports: {
    revealCandidatePhoneAction: (...args: unknown[]) => mockApolloReveal(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/lusha-phone-fallback-actions', {
  namedExports: {
    revealCandidatePhoneViaLushaFallbackAction: (...args: unknown[]) =>
      mockLushaFallback(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions', {
  namedExports: {
    startLegacyPhoneRevealWaterfallAction: (...args: unknown[]) =>
      mockLegacyWaterfall(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-manual-recovery-actions', {
  namedExports: {
    recoverCandidatePhoneRevealNowAction: (...args: unknown[]) =>
      mockManualRecovery(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-actions', {
  namedExports: {
    getPhoneRevealWaterfallAuditAction: (...args: unknown[]) =>
      mockWaterfallAudit(...(args as [])),
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

const PRIMARY_PHONE = '+57 300 111 2222';
const EXTRA_MOBILE = '+57 300 444 5555';
const EXTRA_WORK = '+57 601 777 8888';

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-4o-g',
    full_name: 'Nombre Apellido',
    title: 'Gerente Comercial',
    email: 'contacto@empresa-ejemplo.test',
    linkedin_url: null,
    source_contact_id: '6a6826ba804c600014ead739',
    phone: PRIMARY_PHONE,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.81,
    enrichment_metadata: { phone: { number: PRIMARY_PHONE, type: 'mobile', source: 'apollo_reveal' } },
    enrichment_run_id: 'run-4o-g',
    created_at: '2026-08-01T00:00:00.000Z',
    phone_reveal_status: 'revealed',
    company_name: 'Empresa Ejemplo SAS',
    company_domain: 'empresa-ejemplo.test',
    account_id: 'acct-aaaa-1111',
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

/** Espera a que el resumen haya llegado y el CTA se haya decidido. */
async function waitForSummary() {
  await waitFor(() => {
    if (mockStoredSummary.mock.callCount() === 0) throw new Error('summary not requested');
  });
}

function storedPhonesCta(): HTMLElement | null {
  return screen.queryByRole('button', { name: /número(s)? más/i });
}

function assertNoProviderCalls() {
  for (const [label, spy] of SPENDING_MOCKS) {
    assert.equal(spy.mock.callCount(), 0, `${label} NO debe invocarse al ver números guardados`);
  }
}

// ── Setup/Teardown ───────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, waitFor, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  for (const spy of [
    mockGetById,
    mockApprove,
    mockDiscard,
    mockRouterRefresh,
    mockStoredSummary,
    mockStoredPhones,
    mockApolloReveal,
    mockLushaFallback,
    mockLegacyWaterfall,
    mockManualRecovery,
    mockWaterfallAudit,
  ]) {
    spy.mock.resetCalls();
  }
  mockWaterfallAudit.mock.mockImplementation(async () => null);
  mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 0 }));
  mockStoredPhones.mock.mockImplementation(async () => ({ status: 'ok', phones: [] }));
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// Visibilidad del CTA
// ═══════════════════════════════════════════════════════════════

describe('4O-G UI — cuándo existe «Ver más números»', () => {
  it('con un solo teléfono el CTA NO se muestra', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 0 }));
    await renderSheet(makeCandidate());
    await waitForSummary();
    assert.equal(storedPhonesCta(), null);
    // El principal sí se sigue viendo: el hito no cambia lo que ya había.
    assert.ok(screen.getAllByText(PRIMARY_PHONE).length > 0);
    cleanup();
  });

  it('con extras el CTA aparece y dice CUÁNTOS hay', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 2 }));
    await renderSheet(makeCandidate());
    await waitFor(() => {
      if (storedPhonesCta() === null) throw new Error('CTA no visible');
    });
    assert.ok(screen.getByRole('button', { name: /Ver 2 números más/ }));
    cleanup();
  });

  it('con exactamente un extra el CTA usa el singular', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    await renderSheet(makeCandidate());
    await waitFor(() => {
      if (screen.queryByRole('button', { name: /Ver 1 número más/ }) === null) {
        throw new Error('CTA singular no visible');
      }
    });
    cleanup();
  });

  it('el CTA no promete una búsqueda: no dice buscar, encontrar ni revelar más', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 2 }));
    await renderSheet(makeCandidate());
    await waitFor(() => {
      if (storedPhonesCta() === null) throw new Error('CTA no visible');
    });
    for (const forbidden of [/Buscar más/i, /Encontrar más/i, /Revelar más/i]) {
      assert.equal(screen.queryByText(forbidden), null);
    }
    cleanup();
  });

  it('mientras sólo se ve el CTA, NINGÚN número adicional ha viajado al navegador', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 2 }));
    await renderSheet(makeCandidate());
    await waitFor(() => {
      if (storedPhonesCta() === null) throw new Error('CTA no visible');
    });
    assert.equal(
      mockStoredPhones.mock.callCount(),
      0,
      'los números sólo se piden cuando el operador abre el disclosure',
    );
    cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════
// Expansión
// ═══════════════════════════════════════════════════════════════

describe('4O-G UI — abrir el disclosure', () => {
  const TWO_PHONES: StoredCandidatePhonesResult = {
    status: 'ok',
    phones: [
      { id: 'p2', number: EXTRA_MOBILE, type: 'mobile', isPrimary: false, sources: ['apollo_reveal'] },
      { id: 'p3', number: EXTRA_WORK, type: 'work', isPrimary: false, sources: ['lusha_reveal'] },
    ],
  };

  async function openDisclosure(result: StoredCandidatePhonesResult, count = 2) {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: count }));
    mockStoredPhones.mock.mockImplementation(async () => result);
    await renderSheet(makeCandidate());
    await waitFor(() => {
      if (storedPhonesCta() === null) throw new Error('CTA no visible');
    });
    fireEvent.click(storedPhonesCta() as HTMLElement);
    await waitFor(() => {
      if (mockStoredPhones.mock.callCount() === 0) throw new Error('lectura no invocada');
    });
  }

  it('muestra los números almacenados con su tipo y su fuente', async () => {
    await openDisclosure(TWO_PHONES);
    await waitFor(() => {
      if (screen.queryByText(EXTRA_MOBILE) === null) throw new Error('extra no renderizado');
    });
    assert.ok(screen.getByText(EXTRA_WORK));
    // Vocabulario UX en español, nunca el interno.
    assert.ok(screen.getAllByText('Móvil').length > 0);
    assert.ok(screen.getAllByText('Trabajo').length > 0);
    assert.equal(screen.queryByText('personal_mobile'), null);
    assert.equal(screen.queryByText('direct_dial'), null);
    cleanup();
  });

  it('un número visto por DOS proveedores es UNA fila con las dos fuentes', async () => {
    await openDisclosure(
      {
        status: 'ok',
        phones: [
          {
            id: 'p2',
            number: EXTRA_MOBILE,
            type: 'mobile',
            isPrimary: false,
            sources: ['apollo_reveal', 'lusha_reveal'],
          },
        ],
      },
      1,
    );
    await waitFor(() => {
      if (screen.queryByText(EXTRA_MOBILE) === null) throw new Error('extra no renderizado');
    });
    assert.equal(screen.getAllByText(EXTRA_MOBILE).length, 1, 'no debe duplicarse la fila');
    assert.ok(screen.getByText(/Apollo reveal\s*·\s*Lusha reveal/));
    cleanup();
  });

  it('NO repite el teléfono principal dentro de la sección', async () => {
    await openDisclosure(TWO_PHONES);
    await waitFor(() => {
      if (screen.queryByText(EXTRA_MOBILE) === null) throw new Error('extra no renderizado');
    });
    // El principal aparece UNA vez, arriba, y no otra vez como «adicional».
    assert.equal(screen.getAllByText(PRIMARY_PHONE).length, 1);
    cleanup();
  });

  it('no muestra ningún costo por número', async () => {
    await openDisclosure(TWO_PHONES);
    await waitFor(() => {
      if (screen.queryByText(EXTRA_MOBILE) === null) throw new Error('extra no renderizado');
    });
    assert.equal(screen.queryByText(/costó/i), null);
    assert.equal(screen.queryByText(/consumiendo créditos/i), null);
    assert.equal(screen.queryByText(/consultando Apollo/i), null);
    assert.equal(screen.queryByText(/consultando Lusha/i), null);
    cleanup();
  });

  it('cerrar el disclosure olvida lo leído: la siguiente apertura vuelve a preguntar', async () => {
    await openDisclosure(TWO_PHONES);
    await waitFor(() => {
      if (screen.queryByText(EXTRA_MOBILE) === null) throw new Error('extra no renderizado');
    });
    fireEvent.click(screen.getByRole('button', { name: /Ocultar números adicionales/ }));
    await waitFor(() => {
      if (screen.queryByText(EXTRA_MOBILE) !== null) throw new Error('sigue visible');
    });
    // Es lo que hace que una supresión posterior surta efecto sin tiempo real.
    fireEvent.click(storedPhonesCta() as HTMLElement);
    await waitFor(() => {
      if (mockStoredPhones.mock.callCount() < 2) throw new Error('no volvió a leer');
    });
    cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════
// Estados vacío y de error
// ═══════════════════════════════════════════════════════════════

describe('4O-G UI — estados seguros', () => {
  async function openWith(result: StoredCandidatePhonesResult) {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 2 }));
    mockStoredPhones.mock.mockImplementation(async () => result);
    await renderSheet(makeCandidate());
    await waitFor(() => {
      if (storedPhonesCta() === null) throw new Error('CTA no visible');
    });
    fireEvent.click(storedPhonesCta() as HTMLElement);
    // Deja que la lectura se resuelva DENTRO del entorno act de `waitFor`; si no,
    // el estado aterriza fuera y React avisa (ruido, no fallo).
    await waitFor(() => {
      if (mockStoredPhones.mock.callCount() === 0) throw new Error('lectura no invocada');
    });
  }

  it('si los extras desaparecieron entre el render y el clic, lo dice sin error técnico', async () => {
    // Caso real: una DSAR tombstoneó el número entre una cosa y la otra.
    await openWith({ status: 'ok', phones: [] });
    await waitFor(() => {
      if (screen.queryByText('No hay otros números disponibles.') === null) {
        throw new Error('estado vacío no renderizado');
      }
    });
    assertNoProviderCalls();
    cleanup();
  });

  it('un fallo de lectura se dice, y NO cae a ningún proveedor', async () => {
    // La afirmación central del hito: READ ERROR ≠ CALL PROVIDER.
    await openWith({ status: 'unavailable' });
    await waitFor(() => {
      if (screen.queryByText('No pudimos cargar los números adicionales.') === null) {
        throw new Error('estado de error no renderizado');
      }
    });
    assertNoProviderCalls();
    cleanup();
  });

  it('una excepción de la acción tampoco dispara un reveal', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 2 }));
    mockStoredPhones.mock.mockImplementation(async () => {
      throw new Error('boom');
    });
    await renderSheet(makeCandidate());
    await waitFor(() => {
      if (storedPhonesCta() === null) throw new Error('CTA no visible');
    });
    fireEvent.click(storedPhonesCta() as HTMLElement);
    await waitFor(() => {
      if (mockStoredPhones.mock.callCount() === 0) throw new Error('lectura no invocada');
    });
    await waitFor(() => {
      if (screen.queryByText('No pudimos cargar los números adicionales.') === null) {
        throw new Error('estado de error no renderizado');
      }
    });
    assertNoProviderCalls();
    cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════
// Coste cero
// ═══════════════════════════════════════════════════════════════

describe('4O-G UI — ver números almacenados cuesta CERO', () => {
  it('abrir y cerrar el disclosure no invoca ninguna acción que gaste', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    mockStoredPhones.mock.mockImplementation(async () => ({
      status: 'ok',
      phones: [
        {
          id: 'p2',
          number: EXTRA_MOBILE,
          type: 'mobile',
          isPrimary: false,
          sources: ['apollo_reveal'],
        },
      ],
    }));
    await renderSheet(makeCandidate());
    await waitFor(() => {
      if (storedPhonesCta() === null) throw new Error('CTA no visible');
    });

    fireEvent.click(storedPhonesCta() as HTMLElement);
    await waitFor(() => {
      if (screen.queryByText(EXTRA_MOBILE) === null) throw new Error('extra no renderizado');
    });
    fireEvent.click(screen.getByRole('button', { name: /Ocultar números adicionales/ }));

    assertNoProviderCalls();
    // Y tampoco se reescribió el candidato: ver no aprueba ni descarta.
    assert.equal(mockApprove.mock.callCount(), 0);
    assert.equal(mockDiscard.mock.callCount(), 0);
    cleanup();
  });

  it('el CTA aparece aunque el waterfall esté apagado y el rol no lo autorice', async () => {
    // Los flags gobiernan si se puede GASTAR. Un número ya guardado se ve igual.
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    mockGetById.mock.mockImplementation(async () => makeCandidate());
    render(
      <ContactCandidateDetailSheet
        candidateId="cand-4o-g"
        open
        onClose={() => {}}
        phoneRevealEnabled={false}
        phoneRevealAuthorized={false}
        phoneRevealWaterfallEnabled={false}
        phoneRevealWaterfallAuthorized={false}
      />,
    );
    await waitFor(() => {
      if (screen.queryByRole('button', { name: /Ver 1 número más/ }) === null) {
        throw new Error('CTA no visible con los flags apagados');
      }
    });
    assertNoProviderCalls();
    cleanup();
  });
});
