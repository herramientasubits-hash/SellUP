/**
 * wizard-apollo-continuation-journey-runtime.test.tsx — el RECORRIDO de una
 * corrida a medias, desde la pantalla real.
 *
 * AGENT1-APOLLO-CONTINUATION-WIZARD-WIRING · §§ 2, 3, 4.
 *
 * ── Qué se ejercita, y por qué así ───────────────────────────────────────────
 *
 * Renderiza el `ProspectChatWizard` REAL —el cajón entero, que es donde vive el
 * panel— y, para la mitad que depende de la respuesta del servidor, el
 * `WizardConversationSummary` REAL con el estado que produce el REDUCTOR REAL.
 * Lo único sustituido son los módulos de acciones de servidor: ni Apollo, ni
 * Lusha, ni Supabase, ni la cola.
 *
 * Es deliberado que la prueba NO se quede en el resolutor puro ni en el
 * conductor: los dos ya estaban probados antes de este corte y aun así la
 * funcionalidad no existía, porque nada en pantalla los usaba. Lo que aquí se
 * comprueba es exactamente ese hueco — que la pantalla los usa.
 *
 *   caso 1 — al abrir, el trabajo pendiente se ve y se conduce hasta el final
 *   caso 2 — se respeta `retryAfterMs` en las dos direcciones
 *   caso 3 — cerrar detiene la conducción; reabrir RECUPERA sin nueva corrida
 *   caso 4 — un error real termina en fallo visible y deja de insistir
 *   caso 5 — sin reclamo (lo tiene el cron u otra pestaña) las vueltas se acotan
 *   caso 6 — sin trabajo pendiente no se pinta nada y el éxito normal no cambia
 *   caso 7 — la respuesta PARCIAL: el reductor la conserva, el panel de éxito
 *            no se cierra ni la anuncia como un vacío, y la señal hace que la
 *            pantalla vuelva a preguntar
 *   caso 8 — el cableado de esa señal en la raíz del mago
 *
 * LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
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
// El mago consulta `prefers-reduced-motion`; jsdom no trae `matchMedia`.
if (typeof dom.window.matchMedia !== 'function') {
  Object.defineProperty(dom.window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
defineGlobal('matchMedia', dom.window.matchMedia);

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub;
for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}


import * as React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type {
  ProspectWizardState,
  ProspectWizardAction,
} from '@/modules/prospect-batches/chat-wizard';
import type { WizardLushaCriteriaDecision } from '@/modules/prospect-batches/wizard-lusha-criteria';

// ── Registro de llamadas al servidor ──────────────────────────────────────────
//
// Vive fuera del mock para que cada caso lo reprograme sin volver a mockear el
// módulo: `mock.module` se instala UNA vez, antes de cualquier import.

type UiStatus = 'processing' | 'pending_continuation' | 'finished' | 'failed' | 'forbidden';

type ContinueResult = {
  status: UiStatus;
  pendingOrganizationCount: number;
  retryAfterMs: number | null;
};

const server = {
  continueCalls: [] as string[],
  findCalls: 0,
  continueQueue: [] as (ContinueResult | Error)[],
  continueDefault: null as ContinueResult | Error | null,
  pending: null as
    | { batchId: string; status: Exclude<UiStatus, 'forbidden'>; pendingOrganizationCount: number }
    | null,
};

function resetServer(): void {
  server.continueCalls = [];
  server.findCalls = 0;
  server.continueQueue = [];
  server.continueDefault = null;
  server.pending = null;
}

mock.module('@/modules/prospect-batches/apollo-continuation-actions', {
  namedExports: {
    continueApolloRound: async (batchId: string) => {
      server.continueCalls.push(batchId);
      const next = server.continueQueue.shift() ?? server.continueDefault;
      if (next instanceof Error) throw next;
      return next ?? { status: 'finished', pendingOrganizationCount: 0, retryAfterMs: null };
    },
    findPendingApolloContinuation: async () => {
      server.findCalls += 1;
      return server.pending;
    },
  },
});

// Fronteras que estas pantallas arrastran y que nunca deben cargarse de verdad.
//
// 🔴 La EJECUCIÓN entre ellas: ninguna prueba de este archivo puede lanzar una
// corrida, y el doble lo hace imposible además de improbable.
mock.module('@/modules/prospect-batches/chat-wizard-execution', {
  namedExports: {
    executeProspectWizardGenerationAction: async () => {
      throw new Error('ninguna prueba de continuación puede lanzar una corrida');
    },
  },
});
mock.module('@/modules/industry-catalog/action', {
  namedExports: {
    validateExploratorySearch: async () => ({ ok: true, warnings: [], blockingIssues: [] }),
  },
});
mock.module('@/modules/prospect-batches/lusha-preview-actions', {
  namedExports: { previewLushaCompaniesAction: async () => ({ ok: false }) },
});
mock.module('@/modules/prospect-batches/lusha-pending-review-actions', {
  namedExports: { generateLushaPendingReviewBatchAction: async () => ({ ok: false }) },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
    redirect: () => {},
  },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ProspectChatWizard: (typeof import('../prospect-chat-wizard'))['ProspectChatWizard'];
let WizardConversationSummary: (typeof import('../wizard-conversation-summary'))['WizardConversationSummary'];
let WizardApolloContinuationPanel: (typeof import('../wizard-apollo-continuation-panel'))['WizardApolloContinuationPanel'];
let prospectWizardReducer: (typeof import('@/modules/prospect-batches/chat-wizard'))['prospectWizardReducer'];
let createInitialProspectWizardState: (typeof import('@/modules/prospect-batches/chat-wizard'))['createInitialProspectWizardState'];
let STATUS_COPY: (typeof import('@/modules/prospect-batches/apollo-continuation-status'))['APOLLO_CONTINUATION_STATUS_COPY'];
let TRANSPORT_ERROR_COPY: string;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BATCH_ID = '11111111-2222-4333-8444-555555555555';
const INITIAL_PARAMS = { catalogVersion: 'v1', defaultRequestedCount: 25 };

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [{ id: 'ind-1', name: 'Tecnología', slug: 'tecnologia', description: null } as never],
  subindustries: [],
} as unknown as ActiveIndustryCatalog;

const NO_LUSHA: WizardLushaCriteriaDecision = {
  provider: 'default_ai',
  input: null,
} as unknown as WizardLushaCriteriaDecision;

/** El cajón REAL, recién abierto: primer paso, sin corrida en el estado. */
function renderWizard(onClose: () => void = () => {}) {
  return render(<ProspectChatWizard catalog={CATALOG} onClose={onClose} executionEnabled />);
}

/**
 * El estado REAL que deja una respuesta PARCIAL.
 *
 * 🔴 No se escribe a mano: lo produce el reductor de producción a partir de la
 * acción `EXECUTION_SUCCEEDED` que despacha el mago. Si el reductor dejara de
 * conservar la pausa, esta prueba se cae — que es exactamente lo que se quiere.
 */
function pausedSuccessState(): ProspectWizardState {
  const submitting = {
    ...createInitialProspectWizardState(INITIAL_PARAMS),
    currentStep: 'submitting',
  } as ProspectWizardState;
  return prospectWizardReducer(submitting, {
    type: 'EXECUTION_SUCCEEDED',
    batchId: BATCH_ID,
    redirectPath: '/prospect-batches',
    status: 'no_new_candidates',
    candidateCount: 0,
    acceptedForTarget: null,
    continuationPending: true,
  });
}

/** Éxito NORMAL: la misma acción sin pausa. */
function plainSuccessState(): ProspectWizardState {
  const submitting = {
    ...createInitialProspectWizardState(INITIAL_PARAMS),
    currentStep: 'submitting',
  } as ProspectWizardState;
  return prospectWizardReducer(submitting, {
    type: 'EXECUTION_SUCCEEDED',
    batchId: BATCH_ID,
    redirectPath: '/prospect-batches',
    status: 'success_target_reached',
    candidateCount: 3,
    acceptedForTarget: null,
  });
}

function renderSummary(state: ProspectWizardState, onClose: () => void = () => {}) {
  const noopDispatch = (() => {}) as React.Dispatch<ProspectWizardAction>;
  return render(
    <WizardConversationSummary
      state={state}
      catalog={CATALOG}
      dispatch={noopDispatch}
      onClose={onClose}
      executionEnabled
      onExecute={() => {
        throw new Error('la pantalla NO debe lanzar otra corrida');
      }}
      onEditSearch={() => {}}
      lushaPreviewEnabled={false}
      lushaCriteria={NO_LUSHA}
    />,
  );
}

const panel = () => document.querySelector('[data-testid="wizard-apollo-continuation"]');
const panelStatus = () => panel()?.getAttribute('data-continuation-status') ?? null;
const panelBody = () =>
  document.querySelector('[data-testid="wizard-apollo-continuation-body"]')?.textContent ?? null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  waitFor = rtl.waitFor;
  cleanup = rtl.cleanup;

  ({ ProspectChatWizard } = await import('../prospect-chat-wizard'));
  ({ WizardConversationSummary } = await import('../wizard-conversation-summary'));
  ({ WizardApolloContinuationPanel } = await import('../wizard-apollo-continuation-panel'));
  ({ prospectWizardReducer, createInitialProspectWizardState } = await import(
    '@/modules/prospect-batches/chat-wizard'
  ));
  const statusModule = await import('@/modules/prospect-batches/apollo-continuation-status');
  STATUS_COPY = statusModule.APOLLO_CONTINUATION_STATUS_COPY;
  TRANSPORT_ERROR_COPY = statusModule.APOLLO_CONTINUATION_TRANSPORT_ERROR_COPY;
});

beforeEach(() => {
  resetServer();
  document.body.innerHTML = '';
});
afterEach(() => {
  cleanup();
});

// ── Caso 1 ────────────────────────────────────────────────────────────────────

describe('§ 2 · caso 1 — al abrir el mago con trabajo pendiente', () => {
  it('se ve el estado, se conduce el MISMO lote y se termina en éxito real', async () => {
    server.pending = {
      batchId: BATCH_ID,
      status: 'pending_continuation',
      pendingOrganizationCount: 12,
    };
    server.continueQueue = [
      { status: 'processing', pendingOrganizationCount: 1, retryAfterMs: 1 },
      { status: 'finished', pendingOrganizationCount: 0, retryAfterMs: null },
    ];

    renderWizard();

    // Al montar se PREGUNTA por el trabajo pendiente. No se reclama nada aún.
    await waitFor(() => assert.equal(server.findCalls, 1));
    await waitFor(() => assert.ok(panel(), 'el cajón enseña la corrida a medias'));

    await waitFor(() => assert.equal(panelStatus(), 'finished'));

    // Dos vueltas, las dos sobre el lote que el SERVIDOR nombró. Ninguna otra.
    assert.deepEqual(server.continueCalls, [BATCH_ID, BATCH_ID]);
    assert.equal(panel()?.getAttribute('data-continuation-batch-id'), BATCH_ID);
  });

  it('el panel aparece en el PRIMER paso, no sólo al final de una corrida', async () => {
    server.pending = {
      batchId: BATCH_ID,
      status: 'processing',
      pendingOrganizationCount: 3,
    };
    server.continueDefault = {
      status: 'processing',
      pendingOrganizationCount: 1,
      retryAfterMs: 5_000,
    };

    renderWizard();

    await waitFor(() => assert.equal(panelStatus(), 'processing'));
    assert.equal(panelBody(), STATUS_COPY.processing);
    // El mago sigue en su conversación: continuar no secuestra la pantalla.
    assert.ok(
      document.body.textContent && document.body.textContent.length > 0,
      'el cajón sigue mostrando su contenido',
    );
  });
});

// ── Caso 2 ────────────────────────────────────────────────────────────────────

describe('§ 2 · caso 2 — se respeta `retryAfterMs`', () => {
  it('una espera larga aplaza la siguiente vuelta', async () => {
    server.pending = { batchId: BATCH_ID, status: 'pending_continuation', pendingOrganizationCount: 9 };
    server.continueDefault = {
      status: 'pending_continuation',
      pendingOrganizationCount: 1,
      retryAfterMs: 5_000,
    };

    renderWizard();

    await waitFor(() => assert.equal(server.continueCalls.length, 1));
    await sleep(80);
    assert.equal(
      server.continueCalls.length,
      1,
      'con 5 s de espera no puede haber una segunda vuelta a los 80 ms',
    );
  });

  it('una espera corta encadena la siguiente vuelta', async () => {
    server.pending = { batchId: BATCH_ID, status: 'pending_continuation', pendingOrganizationCount: 9 };
    server.continueQueue = [
      { status: 'pending_continuation', pendingOrganizationCount: 1, retryAfterMs: 1 },
      { status: 'processing', pendingOrganizationCount: 1, retryAfterMs: 1 },
      { status: 'finished', pendingOrganizationCount: 0, retryAfterMs: null },
    ];

    renderWizard();

    await waitFor(() => assert.equal(panelStatus(), 'finished'));
    assert.equal(server.continueCalls.length, 3);
  });
});

// ── Caso 3 ────────────────────────────────────────────────────────────────────

describe('§ 3 · caso 3 — cerrar y reabrir', () => {
  it('cerrar detiene la conducción; reabrir la RECUPERA sin crear otra corrida', async () => {
    server.pending = { batchId: BATCH_ID, status: 'pending_continuation', pendingOrganizationCount: 7 };
    server.continueDefault = {
      status: 'pending_continuation',
      pendingOrganizationCount: 1,
      retryAfterMs: 5_000,
    };

    renderWizard();
    await waitFor(() => assert.equal(server.continueCalls.length, 1));

    // Se cierra la ventana.
    cleanup();
    document.body.innerHTML = '';
    const callsAtClose = server.continueCalls.length;
    await sleep(60);
    assert.equal(
      server.continueCalls.length,
      callsAtClose,
      'una pantalla desmontada no sigue llamando al servidor',
    );

    // Se REABRE: el mago vuelve a su primer paso y no recuerda ningún lote. El
    // trabajo pendiente se recupera del servidor.
    server.continueQueue = [{ status: 'finished', pendingOrganizationCount: 0, retryAfterMs: null }];
    server.continueDefault = null;

    renderWizard();

    await waitFor(() => assert.equal(server.findCalls, 2));
    await waitFor(() => assert.equal(panelStatus(), 'finished'));

    assert.deepEqual(
      server.continueCalls.slice(callsAtClose),
      [BATCH_ID],
      'la reapertura continúa el MISMO lote',
    );
  });

  it('sin trabajo pendiente, abrir no pinta nada y no llama a continuar', async () => {
    server.pending = null;

    renderWizard();

    await waitFor(() => assert.equal(server.findCalls, 1));
    await sleep(30);
    assert.equal(panel(), null);
    assert.deepEqual(server.continueCalls, []);
  });
});

// ── Caso 4 ────────────────────────────────────────────────────────────────────

describe('§ 2 · caso 4 — un error real', () => {
  it('termina en fallo visible, lo describe sin mentir y deja de insistir', async () => {
    server.pending = { batchId: BATCH_ID, status: 'pending_continuation', pendingOrganizationCount: 3 };
    server.continueDefault = new Error('network down');

    renderWizard();

    await waitFor(() => assert.equal(panelStatus(), 'failed'));
    assert.equal(
      panelBody(),
      TRANSPORT_ERROR_COPY,
      'un fallo de transporte NO se anuncia como un trabajo agotado',
    );
    assert.notEqual(panelBody(), STATUS_COPY.failed);

    const calls = server.continueCalls.length;
    await sleep(60);
    assert.equal(calls, server.continueCalls.length, 'no hay bucle apretado contra el error');
  });

  it('un trabajo AGOTADO en el servidor se anuncia como fallo de la continuación', async () => {
    server.pending = { batchId: BATCH_ID, status: 'pending_continuation', pendingOrganizationCount: 3 };
    server.continueQueue = [{ status: 'failed', pendingOrganizationCount: 0, retryAfterMs: null }];

    renderWizard();

    await waitFor(() => assert.equal(panelStatus(), 'failed'));
    assert.equal(panelBody(), STATUS_COPY.failed);
    assert.equal(server.continueCalls.length, 1);
  });
});

// ── Caso 5 ────────────────────────────────────────────────────────────────────

describe('§ 2 · caso 5 — el trabajo lo tiene otro', () => {
  it('las vueltas sin reclamo se acotan y el estado guardado queda a la vista', async () => {
    server.pending = { batchId: BATCH_ID, status: 'pending_continuation', pendingOrganizationCount: 5 };
    // Nadie reclama: es lo que devuelve la acción cuando el cron —u otra
    // pestaña— tiene el lease.
    server.continueDefault = {
      status: 'pending_continuation',
      pendingOrganizationCount: 0,
      retryAfterMs: 1,
    };

    renderWizard();

    await waitFor(() => assert.equal(server.continueCalls.length, 5));
    await sleep(60);
    assert.equal(
      server.continueCalls.length,
      5,
      'insistir contra un lease ajeno no lo acelera: se para',
    );
    assert.equal(panelStatus(), 'pending_continuation');
    assert.ok(
      document.querySelector('[data-testid="wizard-apollo-continuation-browser-note"]'),
      'queda dicho que cerrar no pierde el trabajo',
    );
  });
});

// ── Caso 6 ────────────────────────────────────────────────────────────────────

describe('§ 4 · caso 6 — una corrida normal no cambia', () => {
  it('sin pausa el panel de éxito sigue cerrándose solo', async () => {
    let closed = 0;
    renderSummary(plainSuccessState(), () => {
      closed += 1;
    });

    await waitFor(() => assert.equal(closed, 1));
    assert.deepEqual(server.continueCalls, [], 'nada que continuar, nada que llamar');
  });
});

// ── Caso 7 ────────────────────────────────────────────────────────────────────

describe('§ 4 · caso 7 — la respuesta PARCIAL', () => {
  it('el reductor la conserva en el estado de la corrida', () => {
    assert.equal(pausedSuccessState().executionContinuationPending, true);
    assert.equal(plainSuccessState().executionContinuationPending, false);
  });

  it('el panel de éxito NO se cierra solo y NO anuncia un vacío', async () => {
    let closed = 0;
    renderSummary(pausedSuccessState(), () => {
      closed += 1;
    });

    await waitFor(() =>
      assert.ok(
        document.querySelector('[data-testid="wizard-success-paused"]'),
        'el panel de éxito usa su rama de pausa',
      ),
    );
    await sleep(40);
    assert.equal(closed, 0, 'cerrarse sería declarar terminada una corrida a medias');
    assert.equal(
      screen.queryByText(/No encontramos empresas nuevas/i),
      null,
      'una corrida en pausa no puede anunciarse como «sin empresas nuevas»',
    );
  });

  it('la señal de pausa hace que la pantalla vuelva a preguntar, sin remontar nada', async () => {
    server.pending = null;

    // La corrida arranca: al abrir no había nada pendiente.
    const view = render(<WizardApolloContinuationPanel pausedRunSignal={false} />);
    await waitFor(() => assert.equal(server.findCalls, 1));
    assert.equal(panel(), null);

    // La corrida termina EN PAUSA: el estado del mago levanta la señal.
    server.pending = { batchId: BATCH_ID, status: 'pending_continuation', pendingOrganizationCount: 6 };
    server.continueQueue = [{ status: 'finished', pendingOrganizationCount: 0, retryAfterMs: null }];
    view.rerender(<WizardApolloContinuationPanel pausedRunSignal />);

    await waitFor(() => assert.equal(server.findCalls, 2));
    await waitFor(() => assert.equal(panelStatus(), 'finished'));
    assert.deepEqual(server.continueCalls, [BATCH_ID]);
  });
});

// ── Caso 8 ────────────────────────────────────────────────────────────────────

describe('§ 4 · caso 8 — el cableado de la señal', () => {
  /**
   * 🔴 Esta es la única parte del recorrido que un render no puede alcanzar: la
   * raíz del mago crea su propio estado con `useReducer`, así que no hay forma
   * de llevarla al paso `success` sin conducir la conversación entera. Lo que
   * sí se puede exigir —y es donde el defecto viviría— es que la prop que une
   * el estado con el panel siga ahí.
   */
  it('la raíz pasa `executionContinuationPending` al panel', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'prospect-chat-wizard.tsx'),
      'utf8',
    );
    assert.match(
      source,
      /<WizardApolloContinuationPanel\s+pausedRunSignal=\{state\.executionContinuationPending\}\s*\/>/,
      'el panel tiene que recibir la señal de pausa del estado de la corrida',
    );
    assert.match(
      source,
      /continuationPending: result\.apolloContinuation !== undefined/,
      'y esa señal tiene que venir de lo que el servidor declaró',
    );
  });
});
