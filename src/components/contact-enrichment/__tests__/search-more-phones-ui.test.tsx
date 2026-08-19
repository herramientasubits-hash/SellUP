/**
 * Tests UI — «Buscar más números» (Agente 2A · AGENT2A-SEARCH-MORE-PHONES-1)
 *
 * ═══════════════════════════════════════════════════════════════
 * QUÉ DEMUESTRA ESTA SUITE
 * ═══════════════════════════════════════════════════════════════
 *
 * Render REAL de React (jsdom + @testing-library/react) del drawer COMPLETO, no de un
 * componente aislado. La razón es la misma que en 4O-G: lo que hay que demostrar es que el CTA
 * aparece —y SÓLO aparece— dentro de la pantalla de revisión real, junto al CTA GRATUITO con el
 * que un operador podría confundirlo.
 *
 * La propiedad central de este archivo es la más caliente del hito:
 *
 *   EL PRIMER CLIC NO GASTA.
 *
 * El CTA abre una confirmación. Sólo el botón de confirmación puede invocar la acción que paga.
 * Se afirma con el contador de la acción, no con la ausencia de un `await`.
 *
 * ═══════════════════════════════════════════════════════════════
 * POR QUÉ LOS PLANES SE CONSTRUYEN CON EL PLANIFICADOR REAL
 * ═══════════════════════════════════════════════════════════════
 *
 * El plan lo resuelve el SERVIDOR y llega por el preflight. Un mock que devolviera
 * `{ eligible: true }` a mano probaría que el componente pinta un botón cuando le dicen que
 * sí, lo cual no es el riesgo. Aquí el arnés le da HECHOS a `planSearchMorePhones` —el módulo
 * real— y entrega su veredicto, así que un cambio de elegibilidad se ve en esta suite.
 *
 * Los mocks de Apollo, Lusha, waterfall y legacy están puestos aunque ningún caso los use: si
 * estuvieran ausentes, «no se llamó al proveedor» sería una afirmación sobre un módulo que no
 * existe en el test. Estando presentes, `callCount() === 0` afirma algo sobre el camino real.
 *
 * NO toca el servidor, NO llama proveedores, NO escribe en DB y NO revela teléfonos reales.
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
import {
  planSearchMorePhones,
  SEARCH_MORE_MAX_CREDITS,
  type SearchMorePlan,
  type SearchMorePlannerInput,
} from '@/modules/contact-enrichment/search-more-phones-planner';
import {
  SEARCH_MORE_CTA_LABEL,
  SEARCH_MORE_RUNNING_LABEL,
} from '../search-more-phones-copy';

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

/** Las dos lecturas GRATUITAS. */
const mockStoredSummary = mock.fn<() => Promise<{ additionalCount: number }>>();
const mockStoredPhones = mock.fn<() => Promise<unknown>>();
/** El preflight de «Buscar más números». GRATUITO: es lo que sondea la UI. */
const mockSearchMorePreflight = mock.fn<() => Promise<unknown>>();
/**
 * LA COMPRA. Su contador es el que vigila casi todos los casos de este archivo.
 *
 * El tipo DECLARA su argumento —y no es cosmético— porque uno de los casos inspecciona las
 * claves con las que se invocó: es así como se afirma que el cliente no puede colar un
 * proveedor ni un techo de crédito. Con `() => …` esas claves no serían observables.
 */
const mockSearchMore = mock.fn<(input: { candidateId: string }) => Promise<unknown>>();

/** Todo lo demás que CUESTA. Ningún caso puede hacer que se llamen. */
const mockApolloReveal = mock.fn<() => Promise<unknown>>();
const mockLushaFallback = mock.fn<() => Promise<unknown>>();
const mockLegacyWaterfall = mock.fn<() => Promise<unknown>>();
const mockManualRecovery = mock.fn<() => Promise<unknown>>();
const mockWaterfallAudit = mock.fn<() => Promise<null>>();

const SPENDING_MOCKS: readonly (readonly [string, { mock: { callCount(): number } }])[] = [
  ['Buscar más números', mockSearchMore],
  ['Apollo reveal', mockApolloReveal],
  ['Lusha fallback', mockLushaFallback],
  ['waterfall legacy', mockLegacyWaterfall],
  ['recovery manual', mockManualRecovery],
];

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getReviewableContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
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

mock.module('@/modules/contact-enrichment/search-more-phones-actions', {
  namedExports: {
    getSearchMorePhonesPreflightAction: (...args: unknown[]) =>
      mockSearchMorePreflight(...(args as [])),
    searchMoreCandidatePhonesAction: (input: { candidateId: string }) =>
      mockSearchMore(input),
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

const toasts: { level: string; message: string }[] = [];
mock.module('sonner', {
  namedExports: {
    toast: {
      success: (m: string) => toasts.push({ level: 'success', message: m }),
      warning: (m: string) => toasts.push({ level: 'warning', message: m }),
      error: (m: string) => toasts.push({ level: 'error', message: m }),
      info: (m: string) => toasts.push({ level: 'info', message: m }),
    },
  },
});

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PRIMARY_PHONE = '+57 300 111 2222';
const LUSHA_CONTACT_ID = 'v1.lusha-native-token';

/**
 * La forma CANÓNICA del candidato de este flujo, y la que la inspección READ-ONLY de
 * Producción encontró: revelado por APOLLO, con UN teléfono guardado, y con identidad nativa
 * de LUSHA en la misma fila — así que Lusha es la fuente que falta.
 */
function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-search-more',
    full_name: 'Nombre Apellido',
    title: 'Gerente Comercial',
    email: 'contacto@empresa-ejemplo.test',
    linkedin_url: null,
    source_contact_id: LUSHA_CONTACT_ID,
    phone: PRIMARY_PHONE,
    source: 'lusha',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.81,
    enrichment_metadata: {
      phone: { number: PRIMARY_PHONE, type: 'mobile', source: 'apollo_reveal' },
    },
    enrichment_run_id: 'run-search-more',
    created_at: '2026-08-01T00:00:00.000Z',
    phone_reveal_status: 'revealed',
    company_name: 'Empresa Ejemplo SAS',
    company_domain: 'empresa-ejemplo.test',
    account_id: 'acct-aaaa-1111',
    hubspot_company_id: null,
    ...overrides,
  };
}

/** Hechos del preflight. Los defaults son el caso ELEGIBLE. */
interface PreflightFacts {
  featureEnabled?: boolean;
  actorRoleKey?: string | null;
  candidateStatus?: string | null;
  storedUnsuppressedPhoneCount?: number;
  source?: string | null;
  sourceContactId?: string | null;
  providersWithStoredProvenance?: readonly string[];
  providersAlreadySearchedForMore?: readonly string[];
  hasActivePhoneRun?: boolean;
  privacyState?: SearchMorePlannerInput['privacyState'];
}

/** Plan construido con el planificador REAL. Nunca a mano. */
function planFor(facts: PreflightFacts = {}): SearchMorePlan {
  return planSearchMorePhones({
    featureEnabled: facts.featureEnabled ?? true,
    actorRoleKey: facts.actorRoleKey ?? 'admin',
    candidateId: 'cand-search-more',
    candidateStatus: facts.candidateStatus ?? 'pending_review',
    storedUnsuppressedPhoneCount: facts.storedUnsuppressedPhoneCount ?? 1,
    source: facts.source ?? 'lusha',
    sourceContactId: facts.sourceContactId ?? LUSHA_CONTACT_ID,
    providersWithStoredProvenance: facts.providersWithStoredProvenance ?? ['apollo'],
    providersAlreadySearchedForMore: facts.providersAlreadySearchedForMore ?? [],
    hasActivePhoneRun: facts.hasActivePhoneRun ?? false,
    privacyState: facts.privacyState ?? 'clear',
  });
}

function summaryFor(facts: PreflightFacts = {}) {
  const plan = planFor(facts);
  return {
    status: 'ok' as const,
    summary: {
      candidateId: 'cand-search-more',
      storedPhoneCount: facts.storedUnsuppressedPhoneCount ?? 1,
      hasLushaNativeIdentity: (facts.source ?? 'lusha') === 'lusha',
      hasActivePhoneRun: facts.hasActivePhoneRun ?? false,
      lushaAlreadySearched: (facts.providersAlreadySearchedForMore ?? []).includes('lusha'),
      lushaHasStoredProvenance: (facts.providersWithStoredProvenance ?? ['apollo']).includes(
        'lusha',
      ),
      plan,
    },
  };
}

/** Configura el preflight con esos hechos y renderiza el drawer. */
async function renderSheetWith(
  facts: PreflightFacts = {},
  candidate: PendingContactCandidate = makeCandidate(),
) {
  mockGetById.mock.mockImplementation(async () => candidate);
  mockSearchMorePreflight.mock.mockImplementation(async () => summaryFor(facts));
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
  await waitFor(() => {
    if (mockSearchMorePreflight.mock.callCount() === 0) {
      throw new Error('preflight not requested');
    }
  });
}

/** El CTA PAGADO. Se busca por el verbo BUSCAR, que es lo que lo separa del gratuito. */
function searchMoreCta(): HTMLElement | null {
  return screen.queryByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') });
}

/** El CTA GRATUITO de 4O-G. */
function storedPhonesCta(): HTMLElement | null {
  return screen.queryByRole('button', { name: /Ver \d+ números? más|Ver más números/i });
}

function assertNoProviderCalls(context: string) {
  for (const [label, spy] of SPENDING_MOCKS) {
    assert.equal(spy.mock.callCount(), 0, `${label} NO debe invocarse ${context}`);
  }
}

/**
 * El mensaje terminal que el operador LEE, tomado del DOM.
 *
 * Se afirma sobre el DOM y no sobre el toast a propósito: el toast es una notificación que
 * desaparece, y lo que queda junto al teléfono es esta línea. Si sólo se comprobara el toast,
 * un componente que notifica y luego no deja rastro pasaría el test.
 */
async function settledMessage(): Promise<string> {
  await waitFor(() => {
    if (screen.queryAllByRole('status').length === 0) {
      throw new Error('sin mensaje terminal');
    }
  });
  return screen.getAllByRole('status').at(-1)!.textContent ?? '';
}

/** El teléfono que el candidato ya tenía sigue en pantalla. */
function assertExistingPhoneVisible() {
  // `queryAllByText` y no `queryByText`: el mismo número puede aparecer legítimamente en el
  // escalar y dentro del disclosure de números guardados. Lo que se afirma es que NO
  // desapareció, no cuántas veces se pinta.
  assert.ok(
    screen.queryAllByText(PRIMARY_PHONE).length > 0,
    'el teléfono que ya estaba NO puede desaparecer: ya se pagó',
  );
}

// ── Setup/Teardown ───────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, waitFor, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  // Desmonta lo renderizado por el caso anterior. Sin esto los árboles se ACUMULAN en el
  // mismo `document` y cualquier consulta por texto encuentra el teléfono dos veces — lo que
  // convierte una aserción real («el número sigue visible») en un fallo de ambigüedad.
  cleanup?.();
  for (const spy of [
    mockGetById,
    mockApprove,
    mockDiscard,
    mockRouterRefresh,
    mockStoredSummary,
    mockStoredPhones,
    mockSearchMorePreflight,
    mockSearchMore,
    mockApolloReveal,
    mockLushaFallback,
    mockLegacyWaterfall,
    mockManualRecovery,
    mockWaterfallAudit,
  ]) {
    spy.mock.resetCalls();
  }
  toasts.length = 0;
  mockWaterfallAudit.mock.mockImplementation(async () => null);
  mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 0 }));
  mockStoredPhones.mock.mockImplementation(async () => ({ status: 'ok', phones: [] }));
  mockSearchMorePreflight.mock.mockImplementation(async () => summaryFor());
  mockSearchMore.mock.mockImplementation(async () => ({
    outcome: 'new_phones_found',
    reason: null,
    newDistinctPhoneCount: 1,
    lushaOutcome: 'revealed',
    maxCreditsAuthorized: SEARCH_MORE_MAX_CREDITS,
  }));
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// §13 — cuándo existe el CTA
// ═══════════════════════════════════════════════════════════════

describe('SEARCH-MORE UI — cuándo existe «Buscar más números»', () => {
  it('§20.2 con teléfono + identidad nativa de Lusha sin usar ⇒ el CTA APARECE', async () => {
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    assertNoProviderCalls('sólo por renderizar la pantalla');
  });

  it('§20.1 SIN teléfono guardado ⇒ el CTA NO existe (ahí toca «Revelar teléfono»)', async () => {
    await renderSheetWith(
      { storedUnsuppressedPhoneCount: 0 },
      makeCandidate({ phone: null, phone_reveal_status: 'pending' }),
    );
    assert.equal(
      searchMoreCta(),
      null,
      'un botón deshabilitado aquí ofrecería la operación equivocada',
    );
  });

  it('§20.3 sin identidad nativa de Lusha ⇒ el CTA NO se ofrece', async () => {
    await renderSheetWith({ source: 'apollo', sourceContactId: 'a1b2c3d4e5f60718293a4b5c' });
    assert.equal(searchMoreCta(), null);
    assertNoProviderCalls('cuando no hay fuente que consultar');
  });

  it('§20.4 Lusha ya tiene procedencia almacenada ⇒ el CTA NO se ofrece', async () => {
    // Su respuesta completa ya está guardada desde 4O-D: volver a llamarla pagaría por el
    // mismo payload.
    await renderSheetWith({ providersWithStoredProvenance: ['apollo', 'lusha'] });
    assert.equal(searchMoreCta(), null);
  });

  it('§20.5 una corrida `search_more` TERMINAL previa ⇒ el CTA NO se ofrece', async () => {
    await renderSheetWith({ providersAlreadySearchedForMore: ['lusha'] });
    assert.equal(searchMoreCta(), null);
  });

  it('§20.6 con una corrida de teléfono ACTIVA ⇒ el CTA NO se ofrece', async () => {
    await renderSheetWith({ hasActivePhoneRun: true });
    assert.equal(searchMoreCta(), null);
  });

  it('§20.7 un rol NO admin ⇒ el CTA NO se ofrece', async () => {
    await renderSheetWith({ actorRoleKey: 'commercial_manager' });
    assert.equal(searchMoreCta(), null);
    assertNoProviderCalls('para un rol sin autorización');
  });

  it('el permiso de producto apagado NO RENDERIZA nada (la lección de #287)', async () => {
    await renderSheetWith({ featureEnabled: false });
    assert.equal(
      searchMoreCta(),
      null,
      '«deshabilitado» no puede ser mostrar una función que no existe',
    );
  });

  it('un preflight NO DISPONIBLE deja el CTA fuera: fail-closed', async () => {
    mockSearchMorePreflight.mock.mockImplementation(async () => ({ status: 'unavailable' }));
    mockGetById.mock.mockImplementation(async () => makeCandidate());
    render(
      <ContactCandidateDetailSheet
        candidateId="cand-search-more"
        open
        onClose={() => {}}
        phoneRevealEnabled
        phoneRevealAuthorized
      />,
    );
    await waitFor(() => {
      if (mockSearchMorePreflight.mock.callCount() === 0) throw new Error('sin preflight');
    });
    assert.equal(searchMoreCta(), null, 'un fallo de LECTURA no autoriza una compra');
  });

  it('el CTA pagado y el gratuito son DISTINGUIBLES: verbos diferentes', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    await renderSheetWith({ storedUnsuppressedPhoneCount: 2 });
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA pagado no renderizado');
      if (storedPhonesCta() === null) throw new Error('CTA gratuito no renderizado');
    });
    // Viven a centímetros: el riesgo real no es estético, es que el operador confunda cuál
    // gasta. El pagado dice BUSCAR y el gratuito dice VER.
    assert.match(searchMoreCta()!.textContent ?? '', /buscar/i);
    assert.doesNotMatch(searchMoreCta()!.textContent ?? '', /^ver/i);
    assert.match(storedPhonesCta()!.textContent ?? '', /ver/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// §14 — la confirmación, y que el primer clic NO gasta
// ═══════════════════════════════════════════════════════════════

describe('SEARCH-MORE UI — el primer clic NO gasta', () => {
  async function openCta() {
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    fireEvent.click(searchMoreCta()!);
  }

  it('§20.8/§20.9 el primer clic abre una CONFIRMACIÓN y NO invoca la compra', async () => {
    await openCta();
    // Se detecta por ROL. El TÍTULO del modal y la etiqueta del CTA comparten palabras a
    // propósito —el operador tiene que reconocer que es la misma acción— así que buscar por
    // texto encontraría los dos.
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    assert.equal(
      mockSearchMore.mock.callCount(),
      0,
      'ÉSTA es la propiedad central: abrir el modal no puede costar un crédito',
    );
    assertNoProviderCalls('al abrir la confirmación');
  });

  it('§20.10 la confirmación NOMBRA a Lusha', async () => {
    await openCta();
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    const dialog = screen.getByRole('dialog');
    assert.match(
      dialog.textContent ?? '',
      /lusha/i,
      'el operador acepta un gasto concreto contra un proveedor concreto',
    );
    assert.doesNotMatch(
      dialog.textContent ?? '',
      /apollo/i,
      'Apollo no se consulta en esta operación: nombrarlo sería falso',
    );
  });

  it('§20.11 la confirmación muestra el techo de 5 créditos', async () => {
    await openCta();
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    const dialog = screen.getByRole('dialog');
    assert.match(dialog.textContent ?? '', /5 créditos/);
    assert.match(dialog.textContent ?? '', /máximo autorizado/i);
    // Ni el techo de Apollo ni el del waterfall completo.
    assert.doesNotMatch(dialog.textContent ?? '', /8 créditos|13 créditos/);
  });

  it('la confirmación advierte que puede cobrarse SIN encontrar nada nuevo', async () => {
    await openCta();
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    // El desenlace más probable es `no_new_distinct_phone`: Lusha contesta, cobra, y devuelve
    // lo que ya estaba. Sin esta frase el operador cree que sólo paga cuando gana algo.
    assert.match(screen.getByRole('dialog').textContent ?? '', /aunque.*no encuentre/i);
  });

  it('CANCELAR cierra sin gastar', async () => {
    await openCta();
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    fireEvent.click(screen.getByRole('button', { name: /^Cancelar$/i }));
    assert.equal(mockSearchMore.mock.callCount(), 0);
    assertNoProviderCalls('tras cancelar');
  });

  it('sólo CONFIRMAR invoca la compra, y con el candidato como ÚNICO argumento', async () => {
    await openCta();
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    const confirm = screen
      .getAllByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') })
      .at(-1)!;
    fireEvent.click(confirm);

    await waitFor(() => {
      if (mockSearchMore.mock.callCount() === 0) throw new Error('compra no invocada');
    });
    assert.equal(mockSearchMore.mock.callCount(), 1);

    // §20.18/§20.19 — el cliente NO puede imponer proveedor ni techo: no existe el parámetro.
    const args = mockSearchMore.mock.calls[0].arguments[0];
    assert.deepEqual(
      Object.keys(args),
      ['candidateId'],
      'un argumento de proveedor o de techo sería la puerta para pedir 50 créditos',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// §15/§16 — mientras busca, y al terminar
// ═══════════════════════════════════════════════════════════════

describe('SEARCH-MORE UI — el teléfono NO desaparece', () => {
  async function confirmSearch() {
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    fireEvent.click(searchMoreCta()!);
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') })
        .at(-1)!,
    );
  }

  it('§20.20 mientras BUSCA, el teléfono existente sigue visible y se ve el estado', async () => {
    // La compra queda colgada a propósito: así el render intermedio es observable.
    let release: (value: unknown) => void = () => {};
    mockSearchMore.mock.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }) as Promise<unknown>,
    );

    await confirmSearch();

    await waitFor(() => {
      if (screen.queryByText(new RegExp(SEARCH_MORE_RUNNING_LABEL, 'i')) === null) {
        throw new Error('estado «Buscando…» no renderizado');
      }
    });
    // LA propiedad de §15: sustituir el número por un esqueleto esconderría un dato ya pagado.
    assertExistingPhoneVisible();

    release({
      outcome: 'no_new_phones',
      reason: null,
      newDistinctPhoneCount: 0,
      lushaOutcome: 'no_new_distinct_phone',
      maxCreditsAuthorized: 5,
    });
  });

  it('§20.13 un DOBLE clic en confirmar produce UNA sola invocación', async () => {
    let release: (value: unknown) => void = () => {};
    mockSearchMore.mock.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }) as Promise<unknown>,
    );

    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    fireEvent.click(searchMoreCta()!);
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    const confirm = screen
      .getAllByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') })
      .at(-1)!;

    // Dos clics SINCRÓNICOS, antes de que React haya re-renderizado. Un booleano de estado no
    // los pararía: por eso el pestillo vive en un ref.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      if (mockSearchMore.mock.callCount() === 0) throw new Error('compra no invocada');
    });
    assert.equal(mockSearchMore.mock.callCount(), 1, 'el pestillo paró el segundo clic');

    release({
      outcome: 'new_phones_found',
      reason: null,
      newDistinctPhoneCount: 1,
      lushaOutcome: 'revealed',
      maxCreditsAuthorized: 5,
    });
  });

  it('§20.31 con un número NUEVO, «Ver más números» aparece SIN recargar la página', async () => {
    // Antes de la compra: 1 solo teléfono, así que el CTA gratuito no existe.
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 0 }));
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    assert.equal(storedPhonesCta(), null, 'con un solo número no hay nada que «ver más»');

    // Después de la compra la colección tiene 2, y el preflight ya declara Lusha agotada.
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    mockSearchMorePreflight.mock.mockImplementation(async () =>
      summaryFor({
        storedUnsuppressedPhoneCount: 2,
        providersAlreadySearchedForMore: ['lusha'],
      }),
    );

    fireEvent.click(searchMoreCta()!);
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') })
        .at(-1)!,
    );

    // Sin F5: el refresco del preflight dispara la relectura del conteo, y el CTA gratuito
    // aparece solo.
    await waitFor(
      () => {
        if (storedPhonesCta() === null) {
          throw new Error('«Ver más números» no apareció automáticamente');
        }
      },
      { timeout: 4000 },
    );
    assert.match(await settledMessage(), /1 número adicional/i);
    assertExistingPhoneVisible();
  });

  it('§20.21/§20.22 el REFRESCO tras la compra sólo lee: 0 proveedores y 0 compras extra', async () => {
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    fireEvent.click(searchMoreCta()!);
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') })
        .at(-1)!,
    );

    await waitFor(() => {
      if (mockSearchMore.mock.callCount() === 0) throw new Error('compra no invocada');
    });
    // El preflight se vuelve a pedir (es lo que destapa «Ver más números»)…
    await waitFor(() => {
      if (mockSearchMorePreflight.mock.callCount() < 2) {
        throw new Error('el refresco no volvió a leer el preflight');
      }
    });
    // …y aun así la COMPRA se invocó exactamente una vez. El refresco no gasta.
    assert.equal(mockSearchMore.mock.callCount(), 1);
    for (const [label, spy] of SPENDING_MOCKS.filter(([l]) => l !== 'Buscar más números')) {
      assert.equal(spy.mock.callCount(), 0, `${label} NO puede llamarse desde el refresco`);
    }
  });

  it('§20.33 un fallo del proveedor deja el teléfono existente INTACTO y lo dice como fallo', async () => {
    mockSearchMore.mock.mockImplementation(async () => ({
      outcome: 'provider_error',
      reason: 'provider_error',
      newDistinctPhoneCount: 0,
      lushaOutcome: 'error',
      maxCreditsAuthorized: 5,
    }));

    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    fireEvent.click(searchMoreCta()!);
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') })
        .at(-1)!,
    );

    const message = await settledMessage();
    assertExistingPhoneVisible();
    assert.match(message, /no pudimos completar/i);
    assert.doesNotMatch(
      message,
      /no encontramos/i,
      'un fallo técnico no es un hecho sobre los datos de la persona',
    );
    assert.doesNotMatch(
      message,
      /vuelve a intentar/i,
      '§18: una corrida terminal agota Lusha; prometer reintento ofrecería una compra ya cerrada',
    );
  });

  it('§10 CASE B — «sólo duplicados» NO dice que Lusha no tenga teléfono', async () => {
    mockSearchMore.mock.mockImplementation(async () => ({
      outcome: 'no_new_phones',
      reason: null,
      newDistinctPhoneCount: 0,
      lushaOutcome: 'no_new_distinct_phone',
      maxCreditsAuthorized: 5,
    }));

    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    fireEvent.click(searchMoreCta()!);
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') })
        .at(-1)!,
    );

    const message = await settledMessage();
    assert.match(message, /no encontró números diferentes/i);
    assert.doesNotMatch(
      message,
      /no tiene teléfono/i,
      'el contacto SÍ tiene teléfono: sigue visible arriba',
    );
    assertExistingPhoneVisible();
  });

  it('§10 CASE A — `phones: []` dice que no hay adicionales EN LUSHA, no que no haya teléfono', async () => {
    mockSearchMore.mock.mockImplementation(async () => ({
      outcome: 'no_new_phones',
      reason: null,
      newDistinctPhoneCount: 0,
      lushaOutcome: 'no_phone_found',
      maxCreditsAuthorized: 5,
    }));

    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    fireEvent.click(searchMoreCta()!);
    await waitFor(() => {
      if (screen.queryAllByRole('dialog').length === 0) {
        throw new Error('confirmación no abierta');
      }
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: new RegExp(SEARCH_MORE_CTA_LABEL, 'i') })
        .at(-1)!,
    );

    // Los dos casos comparten desenlace para el operador pero NO comparten cadena.
    assert.match(
      await settledMessage(),
      /no encontramos números adicionales en Lusha/i,
    );
    assertExistingPhoneVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
// §17 — «Ver más números» sigue siendo GRATIS
// ═══════════════════════════════════════════════════════════════

describe('SEARCH-MORE UI — el CTA gratuito no cambió de contrato', () => {
  it('§20.32 abrir «Ver más números» sigue costando 0: ninguna acción pagada se invoca', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    mockStoredPhones.mock.mockImplementation(async () => ({
      status: 'ok',
      phones: [
        {
          id: 'p2',
          phone: '+57 300 444 5555',
          type: 'work',
          sources: ['lusha'],
          isPrimary: false,
        },
      ],
    }));

    await renderSheetWith({ storedUnsuppressedPhoneCount: 2 });
    await waitFor(() => {
      if (storedPhonesCta() === null) throw new Error('CTA gratuito no renderizado');
    });

    fireEvent.click(storedPhonesCta()!);
    await waitFor(() => {
      if (mockStoredPhones.mock.callCount() === 0) throw new Error('lista no pedida');
    });

    // La única llamada fue el `SELECT` de la lista.
    assertNoProviderCalls('al abrir el disclosure gratuito');
  });
});
