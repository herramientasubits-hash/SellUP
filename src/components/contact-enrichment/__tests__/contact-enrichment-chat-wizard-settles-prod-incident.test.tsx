/**
 * Tests — la búsqueda de empresa SIEMPRE sale del estado de carga
 * (AGENT2A-PROD-INCIDENT · incidente B, contact search).
 *
 * Incidente de Producción: al buscar una empresa (caso observado: un nombre
 * corriente), el drawer «Enriquecer contactos» se quedaba indefinidamente en
 * «Buscando en SellUp y HubSpot…».
 *
 * El reducer NUNCA fue el problema: con un resultado en la mano sabe salir del
 * paso `resolving`. El problema era el llamador — `await` del server action SIN
 * `catch`. Cuando la llamada RECHAZA (invocación cortada, red caída, función
 * matada por la plataforma tras quedarse esperando a HubSpot) la promesa no
 * devuelve nada que despachar, el rechazo queda sin manejar y el wizard se queda
 * en `resolving` para siempre: el spinner infinito.
 *
 * Casos cubiertos (§ 14 del brief):
 *   A. resultado con coincidencias ⇒ sale de la carga
 *   B. resultado vacío ⇒ sale de la carga (no se queda girando)
 *   C. fallo del servidor devuelto como `{success:false}` ⇒ sale de la carga
 *   D. la llamada RECHAZA ⇒ sale de la carga y muestra copy accionable
 *   E. el copy del fallo inesperado no filtra stack, SQL, proveedor ni PII
 *   F. tras el fallo se puede reintentar (el composer vuelve a estar usable)
 *
 * Antes del fix, D y F fallan: el spinner se queda puesto.
 *
 * Los server actions están mockeados: 0 servidor, 0 DB, 0 Apollo, 0 Lusha,
 * 0 HubSpot, 0 créditos. Datos 100 % ficticios.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que el resto de tests de UI del módulo) ─────

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
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_ENRICHMENT_COMPANY_SEARCH_UNEXPECTED_ERROR_COPY } from '../contact-enrichment-chat-error-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Mocks de boundary ────────────────────────────────────────────────────────

type ResolveResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

/**
 * Implementación intercambiable del action. `node:test` no tiene
 * `mockImplementation`, así que el doble delega en esta variable.
 */
let resolveImpl: () => Promise<ResolveResult> = async () => ({
  success: true,
  data: { candidates: [], skippedHubSpot: false },
});

const mockResolve = mock.fn<() => Promise<ResolveResult>>(() => resolveImpl());

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    resolveContactEnrichmentCompanyAction: () => mockResolve(),
    createContactEnrichmentRequestAction: async () => ({ success: true, requestId: 'req-fake' }),
  },
});

mock.module('@/modules/contact-enrichment/automatic-routing-actions', {
  namedExports: {
    runAutomaticContactEnrichmentForRequestAction: async () => ({ success: true }),
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});

mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let ContactEnrichmentChatWizard: (typeof import('../contact-enrichment-chat-wizard'))['ContactEnrichmentChatWizard'];

// ── Copy que la UI muestra mientras busca — el spinner del incidente ─────────

const SEARCHING_LABEL = 'Buscando en SellUp y HubSpot';
const FAKE_QUERY = 'Empresa Ficticia';

/**
 * Escribe la empresa en el composer y envía con Enter — la misma interacción que
 * hace la operadora. El composer es un `textarea` que solo aparece cuando el
 * timeline ha terminado de revelarse, así que hay que asentar antes.
 */
async function submitCompany(query: string = FAKE_QUERY): Promise<void> {
  const composer = screen.getByPlaceholderText(
    /Escribe el nombre, dominio o HubSpot ID/i,
  ) as HTMLTextAreaElement;

  await act(async () => {
    // React escucha el evento `input`; se fija el valor por el setter nativo.
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    setter?.call(composer, query);
    composer.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  await act(async () => {
    composer.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: false,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** Deja que la microtask del action y los reveals progresivos se asienten. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }
}

function isStillSearching(): boolean {
  return screen.queryAllByText(new RegExp(SEARCHING_LABEL, 'i')).length > 0;
}

describe('AGENT2A-PROD-INCIDENT — la búsqueda de empresa siempre se asienta', () => {
  before(async () => {
    const rtl = await import('@testing-library/react');
    render = rtl.render;
    screen = rtl.screen;
    cleanup = rtl.cleanup;
    act = rtl.act;
    ContactEnrichmentChatWizard = (await import('../contact-enrichment-chat-wizard'))
      .ContactEnrichmentChatWizard;
  });

  beforeEach(() => {
    mockResolve.mock.resetCalls();
  });

  function setResolve(impl: () => Promise<ResolveResult>): void {
    resolveImpl = impl;
  }

  afterEach(() => {
    cleanup();
  });

  it('A. resultado con coincidencias ⇒ sale del estado de carga', async () => {
    setResolve(async () => ({
      success: true,
      data: {
        candidates: [
          {
            source: 'sellup',
            name: 'Empresa Ficticia SAS',
            domain: 'empresa-ficticia.test',
            matchConfidence: 1,
            sellupAccountId: 'account-fake',
          },
        ],
        skippedHubSpot: false,
      },
    }));

    render(<ContactEnrichmentChatWizard />);
    await settle();
    await submitCompany();
    await settle();

    assert.equal(isStillSearching(), false, 'no debe quedarse en «Buscando…»');
  });

  it('B. resultado vacío ⇒ sale del estado de carga', async () => {
    setResolve(async () => ({
      success: true,
      data: { candidates: [], skippedHubSpot: false },
    }));

    render(<ContactEnrichmentChatWizard />);
    await settle();
    await submitCompany();
    await settle();

    assert.equal(isStillSearching(), false, 'un cero resultados no es un spinner');
  });

  it('C. fallo del servidor devuelto como resultado ⇒ sale del estado de carga', async () => {
    setResolve(async () => ({
      success: false,
      error: 'No fue posible buscar la empresa.',
    }));

    render(<ContactEnrichmentChatWizard />);
    await settle();
    await submitCompany();
    await settle();

    assert.equal(isStillSearching(), false);
  });

  it('D. la llamada RECHAZA ⇒ sale del estado de carga y muestra copy accionable', async () => {
    // Este es el incidente: la promesa del server action rechaza en vez de
    // devolver. Sin `catch` en el llamador, el wizard se queda en `resolving`.
    setResolve(async () => {
      throw new Error('Failed to fetch');
    });

    render(<ContactEnrichmentChatWizard />);
    await settle();
    await submitCompany();
    await settle();

    assert.equal(
      isStillSearching(),
      false,
      'SPINNER INFINITO: la llamada rechazó y la UI sigue «Buscando…»',
    );
    assert.ok(
      screen.queryAllByText(
        new RegExp(CONTACT_ENRICHMENT_COMPANY_SEARCH_UNEXPECTED_ERROR_COPY, 'i'),
      ).length > 0,
      'debe explicar el fallo en vez de dejar la pantalla muda',
    );
  });

  it('E. el copy del fallo inesperado no filtra detalles internos', () => {
    const copy = CONTACT_ENRICHMENT_COMPANY_SEARCH_UNEXPECTED_ERROR_COPY;
    for (const leak of ['Error:', 'stack', 'select ', 'PGRST', 'hubapi', 'supabase', 'Bearer']) {
      assert.ok(
        !copy.toLowerCase().includes(leak.toLowerCase()),
        `el copy no debe contener «${leak}»`,
      );
    }
    assert.ok(/intenta nuevamente/i.test(copy), 'debe decirle a la operadora qué hacer');
  });

  it('F. tras el fallo se puede reintentar', async () => {
    setResolve(async () => {
      throw new Error('Failed to fetch');
    });

    render(<ContactEnrichmentChatWizard />);
    await settle();
    await submitCompany();
    await settle();

    // El fallo deja el wizard en `error`, que BLOQUEA el composer a propósito y
    // ofrece «Intentar de nuevo». Lo que se prueba aquí es que ese camino de
    // salida EXISTE: un spinner infinito no ofrece ninguno.
    const retry = screen.getByRole('button', { name: /Intentar de nuevo/i });
    assert.ok(retry, 'el fallo debe ofrecer una salida, no un callejón sin salida');

    // Segundo intento: ahora responde bien. Si el wizard se hubiera quedado
    // atrapado en `resolving`, no habría botón que pulsar ni composer que usar.
    setResolve(async () => ({
      success: true,
      data: { candidates: [], skippedHubSpot: false },
    }));

    await act(async () => {
      retry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    const callsAfterFailure = mockResolve.mock.callCount();
    await submitCompany('Otra Empresa Ficticia');
    await settle();

    assert.ok(
      mockResolve.mock.callCount() > callsAfterFailure,
      'tras reiniciar, una búsqueda nueva debe volver a llegar al action',
    );
    assert.equal(isStillSearching(), false);
  });
});
