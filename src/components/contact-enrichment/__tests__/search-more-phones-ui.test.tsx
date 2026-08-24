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
  getSearchMoreCostDisclosure,
  SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
  SEARCH_MORE_BUDGET_UNAVAILABLE_COPY,
  SEARCH_MORE_COST_HONESTY_COPY,
  SEARCH_MORE_CTA_LABEL,
  SEARCH_MORE_INSUFFICIENT_CREDITS_COPY,
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
  /** Veredicto del pozo de Lusha (AGENT2A-SEARCH-MORE-PHONES-1K). Default: hay saldo. */
  budgetDecision?: SearchMorePlannerInput['budgetDecision'];
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
    budgetDecision: facts.budgetDecision ?? 'authorized',
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

/**
 * El drawer del candidato ES un diálogo: `DrawerShell` monta un `Sheet` de radix, que expone
 * `role="dialog"`. Así que la propiedad de 1J no es «cero diálogos» —eso sería falso incluso
 * antes del clic— sino que NO SE APILE UN SEGUNDO encima. Ese apilamiento era el síntoma que
 * la QA de Producción describió como modal-sobre-modal.
 */
const DRAWER_DIALOG_COUNT = 1;

/**
 * Ningún diálogo APILADO sobre el drawer. Se afirma por ROL, que es lo que un lector de
 * pantalla —y radix— entienden por diálogo, en vez de por una clase CSS.
 *
 * `alertdialog` se cuenta aparte y su cuenta permitida es CERO: es un rol distinto, así que
 * medir sólo `dialog` dejaría pasar un `AlertDialog` de confirmación, que es exactamente la
 * forma que 1J prohíbe.
 */
function assertNoStackedDialog(context: string) {
  assert.equal(
    screen.queryAllByRole('dialog').length,
    DRAWER_DIALOG_COUNT,
    `${context}: el único diálogo en pantalla tiene que seguir siendo el drawer`,
  );
  assert.equal(
    screen.queryAllByRole('alertdialog').length,
    0,
    `${context}: una confirmación es exactamente lo que 1J retira`,
  );
}

/**
 * Renderiza el drawer, espera el CTA y lo PULSA. Un solo paso, porque desde 1J un clic es
 * toda la interacción: no hay confirmación que abrir ni un segundo botón que buscar.
 */
async function clickSearchMore(facts: PreflightFacts = {}) {
  await renderSheetWith(facts);
  await waitFor(() => {
    if (searchMoreCta() === null) throw new Error('CTA no renderizado');
  });
  fireEvent.click(searchMoreCta()!);
}

/**
 * La fila del teléfono: el elemento que contiene el NÚMERO junto con sus badges de tipo y
 * procedencia. Es el contenedor del que la acción tiene que estar fuera.
 */
function phoneBadgeRow(): HTMLElement {
  const row = screen.getAllByText(PRIMARY_PHONE)[0].parentElement;
  assert.ok(row, 'no se encontró la fila del teléfono');
  return row;
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

  // «Buscar más números» sigue siendo admin-only por decisión PROPIA
  // (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: dejó de heredar la lista del
  // waterfall, así que ensanchar el waterfall no ensancha esta compra).
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
// 1K — EL CTA PAGADO NO SE OFRECE SI EL POZO NO PUEDE RESPALDARLO
// ═══════════════════════════════════════════════════════════════
//
// Lo que Producción encontró: el CTA se pintaba con su línea de costo, el operador pulsaba, y
// la respuesta era «No pudimos iniciar la búsqueda. No se consumió ningún crédito.» — porque
// no hay NINGUNA regla de crédito activa para Lusha y el runtime sí resolvía el pozo. Cero
// gasto, pero la pantalla afirmaba algo que el servidor podía desmentir antes del clic.
//
// Estos casos afirman las dos mitades de la corrección: el botón NO se renderiza, y la línea
// que ocupa su sitio dice CUÁL de los tres hechos de presupuesto ocurrió. Los tres son hechos
// OPERATIVOS: ninguna de las tres frases dice nada sobre la persona ni sobre su teléfono.

describe('SEARCH-MORE UI 1K — el presupuesto decide ANTES del clic', () => {
  it('CASO A — todo elegible pero SIN presupuesto de Lusha ⇒ 0 botón y copy de no-configurado', async () => {
    await renderSheetWith({ budgetDecision: 'budget_not_configured' });

    assert.equal(
      searchMoreCta(),
      null,
      'ofrecer la compra que el runtime ya puede rechazar es el defecto que 1K cierra',
    );
    await waitFor(() => {
      if (screen.queryAllByText(SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY).length === 0) {
        throw new Error('sin la línea de presupuesto no configurado');
      }
    });
    // La línea de costo pertenece al botón: sin botón no puede quedarse suelta prometiendo
    // una compra que no existe.
    assert.equal(
      screen.queryAllByText(new RegExp(SEARCH_MORE_COST_HONESTY_COPY, 'i')).length,
      0,
      'la divulgación de costo no sobrevive al botón que la justificaba',
    );
    assertNoProviderCalls('cuando no hay presupuesto configurado');
    assertExistingPhoneVisible();
  });

  it('CASO B — hay regla pero NO alcanza ⇒ 0 botón y copy de créditos insuficientes', async () => {
    await renderSheetWith({ budgetDecision: 'insufficient_credits' });

    assert.equal(searchMoreCta(), null);
    await waitFor(() => {
      if (screen.queryAllByText(SEARCH_MORE_INSUFFICIENT_CREDITS_COPY).length === 0) {
        throw new Error('sin la línea de créditos insuficientes');
      }
    });
    // Y NO la del caso A: mandar al operador a conseguir créditos cuando lo que falta es la
    // regla —o al revés— le hace perder el día en la gestión equivocada.
    assert.equal(
      screen.queryAllByText(SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY).length,
      0,
      'falta de saldo y falta de configuración NO se colapsan',
    );
    assertNoProviderCalls('cuando el saldo no cubre el techo');
  });

  it('CASO E — el presupuesto NO se pudo verificar ⇒ 0 botón, y no se afirma cuál de los otros dos', async () => {
    await renderSheetWith({ budgetDecision: 'balance_unavailable' });

    assert.equal(searchMoreCta(), null, 'un presupuesto ilegible NO autoriza una compra');
    await waitFor(() => {
      if (screen.queryAllByText(SEARCH_MORE_BUDGET_UNAVAILABLE_COPY).length === 0) {
        throw new Error('sin la línea de presupuesto no verificable');
      }
    });
    for (const forbidden of [
      SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
      SEARCH_MORE_INSUFFICIENT_CREDITS_COPY,
    ]) {
      assert.equal(
        screen.queryAllByText(forbidden).length,
        0,
        'no se pudo mirar el pozo: afirmar por qué sería inventarse el hecho',
      );
    }
    assertNoProviderCalls('cuando el presupuesto no se pudo leer');
  });

  it('CASOS C y D — con saldo JUSTO o de sobra el CTA sí se ofrece, con su divulgación', async () => {
    // El veredicto llega ya resuelto por el core canónico, así que «justo» y «de sobra»
    // producen el MISMO valor: lo que se afirma aquí es que un pozo que cubre el techo no
    // bloquea nada, ni siquiera en el límite exacto.
    await renderSheetWith({ budgetDecision: 'authorized' });

    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado con saldo suficiente');
    });
    await waitFor(() => {
      if (screen.queryAllByText(new RegExp(SEARCH_MORE_COST_HONESTY_COPY, 'i')).length === 0) {
        throw new Error('sin divulgación de costo');
      }
    });
    // Ninguna de las tres líneas de presupuesto aparece cuando el pozo respalda la compra.
    for (const forbidden of [
      SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY,
      SEARCH_MORE_INSUFFICIENT_CREDITS_COPY,
      SEARCH_MORE_BUDGET_UNAVAILABLE_COPY,
    ]) {
      assert.equal(screen.queryAllByText(forbidden).length, 0);
    }
    assertNoProviderCalls('por renderizar el CTA con saldo');
  });

  it('CASO H — un bloqueo de presupuesto NO apila ningún diálogo sobre el drawer', async () => {
    // 1J retiró el modal y 1K no lo devuelve por la puerta de atrás: un bloqueo se dice en la
    // misma línea informativa, sin pedirle al operador que cierre nada.
    await renderSheetWith({ budgetDecision: 'budget_not_configured' });
    assertNoStackedDialog('con el presupuesto bloqueado');
  });

  it('la privacidad GANA al presupuesto: un bloqueo de la persona no se cuenta como de tesorería', async () => {
    await renderSheetWith({
      privacyState: 'blocked_suppressed',
      budgetDecision: 'budget_not_configured',
    });

    assert.equal(searchMoreCta(), null);
    assert.equal(
      screen.queryAllByText(SEARCH_MORE_BUDGET_NOT_CONFIGURED_COPY).length,
      0,
      'un problema de presupuesto NO puede tapar una restricción de privacidad registrada',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 1J — LA FORMA DEL BOTÓN, Y QUE UN CLIC EJECUTA
// ═══════════════════════════════════════════════════════════════
//
// El bloque anterior de esta suite (§14) demostraba lo CONTRARIO: que el primer clic abría un
// modal y NO gastaba. 1J retira ese modal por decisión de producto, así que esas aserciones se
// INVIERTEN — no se borran, y ninguna propiedad de seguridad se pierde con ellas:
//
//   * «abrir el modal no cuesta un crédito» se sustituye por «un clic produce EXACTAMENTE una
//     compra», que es la garantía que de verdad protegía el crédito;
//   * «sólo confirmar invoca la compra, con el candidato como único argumento» se conserva
//     ENTERA: la acción sigue recibiendo `{ candidateId }` y nada más, así que el cliente
//     sigue sin poder imponer proveedor ni techo;
//   * «la confirmación nombra a Lusha y su techo de 5» se traslada a la DIVULGACIÓN pre-clic,
//     que ahora es permanente en vez de aparecer al abrir un diálogo. Sigue siendo la misma
//     pregunta —¿el operador sabe qué compra antes de comprarlo?— sobre otra superficie;
//   * «cancelar cierra sin gastar» desaparece porque no hay diálogo del que salir. Lo que
//     ocupa su sitio es la aserción de que NINGÚN diálogo llega a montarse.

describe('SEARCH-MORE UI 1J — el CTA es un botón secundario, no un enlace de texto', () => {
  it('§12.1 el CTA es un <button> con la forma del secundario canónico', async () => {
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    const cta = searchMoreCta()!;
    assert.equal(cta.tagName, 'BUTTON');
    // `variant="outline"`: borde y superficie de tarjeta. Es lo que lo hace leerse como una
    // ACCIÓN y no como el enlace de texto que la QA de Producción encontró.
    assert.match(cta.className, /\bborder\b/);
    assert.doesNotMatch(
      cta.className,
      /underline/,
      'un subrayado al pasar el ratón lo devolvería a parecer un enlace',
    );
    assert.doesNotMatch(
      cta.className,
      /px-0/,
      'sin relleno horizontal el botón no tiene cuerpo: era el `ghost` de antes',
    );
  });

  it('§12.2 el CTA vive FUERA de la fila del teléfono y sus badges', async () => {
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    const row = phoneBadgeRow();
    // Prueba de no-vacuidad: la fila que se está usando como referencia es de verdad la del
    // número CON sus badges. Sin esto, un `parentElement` que fuera otro contenedor haría
    // pasar la aserción de abajo sin demostrar nada.
    assert.match(row.textContent ?? '', /Móvil/);
    assert.match(row.textContent ?? '', /Apollo reveal/);

    assert.equal(
      row.contains(searchMoreCta()!),
      false,
      'la acción pegada a los badges era el problema de jerarquía: el dato y la acción son cosas distintas',
    );
  });

  it('§12.12/§9 la divulgación de costo se lee ANTES del clic', async () => {
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    // Sin modal, ésta es la ÚNICA oportunidad de decir qué se compra. Tiene que estar en
    // pantalla con el botón todavía sin pulsar.
    const disclosure = String(getSearchMoreCostDisclosure(['lusha'], SEARCH_MORE_MAX_CREDITS));
    assert.match(document.body.textContent ?? '', new RegExp('hasta 5 créditos'));
    assert.match(document.body.textContent ?? '', new RegExp('Lusha'));
    assert.ok(
      (document.body.textContent ?? '').includes(disclosure),
      'la línea de costo canónica tiene que estar renderizada tal cual',
    );
    assert.ok(
      (document.body.textContent ?? '').includes(SEARCH_MORE_COST_HONESTY_COPY),
      'y la frase que dice que puede cobrarse sin encontrar nada nuevo',
    );
    // La divulgación es texto secundario, no un bloque de alarma: nada la envuelve en un
    // recuadro de advertencia.
    assert.equal(
      document.querySelectorAll('[role="alert"]').length,
      0,
      'el aviso amarillo pertenecía al modal',
    );
    assertNoProviderCalls('sólo por leer la divulgación');
  });

  it('§12.14 con el permiso de producto apagado no hay botón NI divulgación de costo', async () => {
    await renderSheetWith({ featureEnabled: false });
    assert.equal(searchMoreCta(), null);
    assert.doesNotMatch(
      document.body.textContent ?? '',
      /hasta 5 créditos/,
      'anunciar un costo de una operación que no existe describiría un gasto imposible',
    );
    assertNoProviderCalls('con el flag apagado');
  });
});

describe('SEARCH-MORE UI 1J — un clic EJECUTA, y sin diálogo', () => {
  it('§12.3 el drawer NO monta ningún diálogo: ni antes del clic, ni después', async () => {
    await renderSheetWith();
    await waitFor(() => {
      if (searchMoreCta() === null) throw new Error('CTA no renderizado');
    });
    assertNoStackedDialog('antes del clic');

    fireEvent.click(searchMoreCta()!);
    await waitFor(() => {
      if (mockSearchMore.mock.callCount() === 0) throw new Error('compra no invocada');
    });
    assertNoStackedDialog('durante la corrida');

    await settledMessage();
    assertNoStackedDialog('al terminar');
  });

  it('§12.4/§12.5 el PRIMER clic invoca la compra, exactamente UNA vez', async () => {
    await clickSearchMore();
    await waitFor(() => {
      if (mockSearchMore.mock.callCount() === 0) throw new Error('compra no invocada');
    });
    assert.equal(
      mockSearchMore.mock.callCount(),
      1,
      'un clic = una corrida: ni cero (el modal de antes) ni dos',
    );

    // §20.18/§20.19 — el cliente NO puede imponer proveedor ni techo: no existe el parámetro.
    // Esta aserción sobrevive intacta a la retirada del modal, y es la que de verdad impedía
    // pedir 50 créditos desde el navegador.
    const args = mockSearchMore.mock.calls[0].arguments[0];
    assert.deepEqual(Object.keys(args), ['candidateId']);
  });

  it('§20.13 un DOBLE clic produce UNA sola invocación', async () => {
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
    const cta = searchMoreCta()!;

    // Dos clics SINCRÓNICOS, antes de que React haya re-renderizado. Un booleano de estado no
    // los pararía: por eso el pestillo vive en un ref. Sin modal, este pestillo es la PRIMERA
    // barrera del cliente y no la segunda, así que la prueba pesa más que antes.
    fireEvent.click(cta);
    fireEvent.click(cta);

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

  it('§10 tras un desenlace TERMINAL el botón ya no está: no hay repetición accidental', async () => {
    // Sin confirmación, la única cosa entre un operador y una segunda compra es que el botón
    // deje de existir. Se retira desde el estado local y no esperando al refresco del
    // preflight: si la relectura fallara, un botón vivo ofrecería una compra que el
    // planificador ya no autoriza —una corrida `search_more` terminal AGOTA Lusha para este
    // candidato— y el clic terminaría en un error que el operador no puede entender.
    await clickSearchMore();

    const message = await settledMessage();
    assert.match(message, /1 número adicional/i);
    assert.equal(
      searchMoreCta(),
      null,
      'el CTA no puede sobrevivir a su propio desenlace terminal',
    );
    // Y el desenlace se queda LEÍDO en su sitio, junto al teléfono: un toast desaparece.
    assert.ok((document.body.textContent ?? '').includes(message));
    assert.equal(mockSearchMore.mock.callCount(), 1);
  });

  it('§8/§12.11 un fallo del proveedor se dice INLINE y con tono de error', async () => {
    mockSearchMore.mock.mockImplementation(async () => ({
      outcome: 'provider_error',
      reason: 'provider_error',
      newDistinctPhoneCount: 0,
      lushaOutcome: 'error',
      maxCreditsAuthorized: 5,
    }));

    await clickSearchMore();
    await settledMessage();

    // El mismo sitio que el éxito —la sección de Teléfono, en línea— pero con el color del
    // producto para los fallos, igual que `phoneRecoveryError` y el error del fallback manual
    // en este mismo panel. Sin modal, sin overlay y sin recuadro.
    const status = screen.getAllByRole('status').at(-1)!;
    assert.match(status.className, /text-destructive/);
    assertNoStackedDialog('tras un fallo del proveedor');
    assertExistingPhoneVisible();
  });

  it('§12.6/§12.7/§5 mientras BUSCA: el BOTÓN se deshabilita y el teléfono sigue visible', async () => {
    // La compra queda colgada a propósito: así el render intermedio es observable.
    let release: (value: unknown) => void = () => {};
    mockSearchMore.mock.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }) as Promise<unknown>,
    );

    await clickSearchMore();

    // El estado de carga vive DENTRO del botón (§5): el operador tiene que seguir viendo
    // dónde estaba la acción que acaba de disparar.
    const running = await waitFor(() => {
      const button = screen.queryByRole('button', {
        name: new RegExp(SEARCH_MORE_RUNNING_LABEL, 'i'),
      });
      if (button === null) throw new Error('el botón no entró en estado de carga');
      return button;
    });
    assert.equal(running.tagName, 'BUTTON');
    assert.ok(
      (running as HTMLButtonElement).disabled,
      'un botón vivo durante la corrida invitaría a un segundo gasto',
    );

    // LA propiedad de §15/§5: sustituir el número por un esqueleto esconderría un dato ya
    // pagado. Y nada bloquea el resto del drawer: sin overlay y sin segunda hoja.
    assertExistingPhoneVisible();
    assertNoStackedDialog('mientras busca');
    assert.ok(
      screen.getAllByText(makeCandidate().full_name).length > 0,
      'el resto del drawer sigue legible durante la corrida',
    );

    release({
      outcome: 'no_new_phones',
      reason: null,
      newDistinctPhoneCount: 0,
      lushaOutcome: 'no_new_distinct_phone',
      maxCreditsAuthorized: 5,
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// §15/§16 — mientras busca, y al terminar
// ═══════════════════════════════════════════════════════════════

describe('SEARCH-MORE UI — el teléfono NO desaparece', () => {

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

    // 1J: un clic ejecuta. No hay confirmación que abrir.
    fireEvent.click(searchMoreCta()!);

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
    // 1J: un clic ejecuta. No hay confirmación que abrir.
    fireEvent.click(searchMoreCta()!);

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
    // 1J: un clic ejecuta. No hay confirmación que abrir.
    fireEvent.click(searchMoreCta()!);

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
    // 1J: un clic ejecuta. No hay confirmación que abrir.
    fireEvent.click(searchMoreCta()!);

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
    // 1J: un clic ejecuta. No hay confirmación que abrir.
    fireEvent.click(searchMoreCta()!);

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
