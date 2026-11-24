/**
 * AGENT2A — Formas de buscar del panel del agente y «Nueva conversación».
 *
 * Dueña 24-11: el panel guía como la búsqueda de empresas (Agente 1). Antes la caja dejaba
 * escribir sin elegir y bajo cada modo salía otra lista «¿Prefieres otra forma de buscar?».
 *
 * Contrato RUNTIME:
 *   - la cabecera no tiene botones de modo;
 *   - el primer paso pregunta «¿Cómo quieres buscar contactos?» con las formas numeradas (el
 *     contacto puntual sólo con CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED) y la caja APAGADA;
 *   - se elige tocando la opción o con su número; elegida, se enciende la caja de esa forma;
 *   - dentro de un modo no hay otra lista de opciones: sólo «Cambiar forma de buscar», que vuelve
 *     a la pregunta;
 *   - «Nueva conversación» vuelve a la pregunta con la caja vacía y apagada;
 *   - con un lote en curso, «Nueva conversación» lo cancela: no se inicia ninguna empresa más
 *     y el reporte queda como «Cancelado».
 *
 * Acciones de servidor en dobles: sin red, sin proveedores, sin créditos.
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { HubSpotIdBatchPrepared } from '@/modules/contact-enrichment/hubspot-id-batch-core';

for (const proto of [window.HTMLElement.prototype, window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
  if (typeof p.scrollTo !== 'function') p.scrollTo = () => {};
}
if (typeof window.matchMedia !== 'function') {
  const matchMedia = (query: string) =>
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
  (window as unknown as { matchMedia: typeof matchMedia }).matchMedia = matchMedia;
  (globalThis as unknown as { matchMedia: typeof matchMedia }).matchMedia = matchMedia;
}

let rtl: typeof import('@testing-library/react');

let linkedinFlag = false;
/** Si está puesto, cada empresa del lote espera a que se abra. */
let itemGate: Promise<void> | null = null;

/** Paso 1 del lote (servidor): preparar la empresa. */
const mockRunItem = mock.fn<(id: unknown) => Promise<HubSpotIdBatchPrepared>>(async (id) => {
  if (itemGate) await itemGate;
  return {
    status: 'ready',
    hubspotCompanyId: String(id),
    name: `Empresa ${String(id)}`,
    country: 'Colombia',
    accountId: `acc-${String(id)}`,
    requestId: `req-${String(id)}`,
  };
});

/** Paso 2 del lote: la ruta de búsqueda de una empresa sola (sin red). */
(globalThis as unknown as { fetch: unknown }).fetch = async () => ({
  redirected: false,
  url: 'http://localhost/api/contact-enrichment/requests/x/search',
  ok: true,
  json: async () => ({
    ok: true,
    result: {
      success: true, status: 'no_fallback_needed', automaticRoutingEnabled: true, fallbackExecuted: false,
      attempt1AttemptId: 'a1', attempt2AttemptId: null, blockedReason: null, reusedExistingCandidates: 0,
      providerCandidatesCreated: { apollo: 2, lusha: null }, failedProviders: [],
    },
  }),
});

mock.module('@/modules/contact-enrichment/panel-flags-actions', {
  namedExports: {
    getContactEnrichmentPanelFlagsAction: async () => ({ linkedinSearchEnabled: linkedinFlag }),
  },
});
mock.module('@/modules/contact-enrichment/hubspot-id-batch-actions', {
  namedExports: { prepareHubSpotIdBatchItemAction: (id: unknown) => mockRunItem(id) },
});
mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    resolveContactEnrichmentCompanyAction: async () => ({ success: true, data: { candidates: [] } }),
    createContactEnrichmentRequestAction: async () => ({ success: false }),
  },
});
mock.module('@/modules/contact-enrichment/automatic-routing-actions', {
  namedExports: { runAutomaticContactEnrichmentForRequestAction: async () => ({ success: false }) },
});
mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});

let ContactEnrichmentDrawer: (typeof import('../contact-enrichment-drawer'))['ContactEnrichmentDrawer'];
let resetHubSpotIdBatchConversationForTests: () => void;
let ShellAgentPanelSlotProvider: (typeof import('@/components/layout/shell-agent-panel-slot'))['ShellAgentPanelSlotProvider'];

function Shell() {
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(true);
  return (
    <ShellAgentPanelSlotProvider value={slot}>
      <main>
        <ContactEnrichmentDrawer open={open} onOpenChange={setOpen} />
      </main>
      <div ref={setSlot} />
    </ShellAgentPanelSlotProvider>
  );
}

before(async () => {
  rtl = await import('@testing-library/react');
  ({ ContactEnrichmentDrawer } = await import('../contact-enrichment-drawer'));
  ({ resetHubSpotIdBatchConversationForTests } = await import('../contact-enrichment-hubspot-id-batch'));
  ({ ShellAgentPanelSlotProvider } = await import('@/components/layout/shell-agent-panel-slot'));
});

beforeEach(() => {
  linkedinFlag = false;
  itemGate = null;
  mockRunItem.mock.resetCalls();
  resetHubSpotIdBatchConversationForTests();
});

afterEach(() => {
  rtl.cleanup();
});

const COMPANY_PLACEHOLDER = 'Nombre o dominio de la empresa';
const CHOOSER_PLACEHOLDER = 'Elige primero cómo quieres buscar';
const BATCH_OPTION = /Varias empresas por HubSpot ID/;
const LINKEDIN_OPTION = /Un contacto por LinkedIn, correo o ID de HubSpot/;
const COMPANY_OPTION = /Contactos de una empresa/;

function textbox(): HTMLTextAreaElement {
  return rtl.within(rtl.screen.getByTestId('chat-panel')).getByRole('textbox') as HTMLTextAreaElement;
}

async function options(): Promise<HTMLElement> {
  return rtl.screen.findByTestId('search-mode-options');
}

async function chooseOption(name: RegExp) {
  const panel = await options();
  rtl.fireEvent.click(await rtl.within(panel).findByRole('button', { name }));
}

/** Deja llegar la respuesta de la bandera. */
async function settleFlag() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** El primer paso: la pregunta con sus opciones y la caja vacía y apagada. */
async function expectChooserWithLockedBox() {
  const panel = await options();
  assert.match(panel.textContent ?? '', /¿Cómo quieres buscar contactos\?/);
  assert.ok(rtl.within(panel).getByRole('button', { name: COMPANY_OPTION }));
  assert.ok(rtl.within(panel).getByRole('button', { name: BATCH_OPTION }));
  assert.equal(rtl.screen.queryByTestId('hubspot-id-batch'), null);
  assert.equal(rtl.screen.queryByTestId('linkedin-contact-search'), null);
  assert.equal(textbox().disabled, true, 'sin elegir no se puede escribir');
  assert.equal(textbox().getAttribute('placeholder'), CHOOSER_PLACEHOLDER);
  assert.equal(textbox().value, '');
}

async function expectCompanyModeWithEmptyBox() {
  await rtl.screen.findByText(/dime el nombre, dominio o HubSpot ID/);
  assert.equal(rtl.screen.queryByTestId('hubspot-id-batch'), null);
  assert.equal(rtl.screen.queryByTestId('linkedin-contact-search'), null);
  await rtl.waitFor(() => assert.equal(textbox().getAttribute('placeholder'), COMPANY_PLACEHOLDER));
  await rtl.waitFor(() => assert.equal(textbox().disabled, false));
  assert.equal(textbox().value, '');
  assert.equal(rtl.screen.queryByTestId('search-mode-options'), null, 'sin otra lista de opciones');
  assert.ok(await rtl.screen.findByTestId('search-mode-back'));
}

async function openCompanyMode() {
  rtl.render(<Shell />);
  await chooseOption(COMPANY_OPTION);
  await expectCompanyModeWithEmptyBox();
}

describe('Panel del agente · primero se elige la forma de buscar (dueña 24-11)', () => {
  it('la cabecera ya no tiene los botones de HubSpot ni de LinkedIn', async () => {
    linkedinFlag = true;
    rtl.render(<Shell />);
    await options();
    await settleFlag();
    assert.equal(rtl.screen.queryByTestId('chat-panel-hubspot-id-batch'), null);
    assert.equal(rtl.screen.queryByTestId('chat-panel-linkedin-search'), null);
  });

  it('al abrir pregunta cómo buscar y la caja está apagada hasta elegir', async () => {
    rtl.render(<Shell />);
    await expectChooserWithLockedBox();
  });

  it('con la bandera apagada se ofrecen una empresa y el lote', async () => {
    rtl.render(<Shell />);
    await settleFlag();
    const panel = await options();
    assert.ok(rtl.within(panel).getByRole('button', { name: COMPANY_OPTION }));
    assert.ok(rtl.within(panel).getByRole('button', { name: BATCH_OPTION }));
    assert.equal(rtl.within(panel).queryByRole('button', { name: LINKEDIN_OPTION }), null);
  });

  it('con la bandera encendida se ofrecen las tres, numeradas como en la búsqueda de empresas', async () => {
    linkedinFlag = true;
    rtl.render(<Shell />);
    const panel = await options();
    assert.ok(rtl.within(panel).getByRole('button', { name: LINKEDIN_OPTION }));
    assert.equal(panel.querySelectorAll('kbd').length, 3, 'cada opción muestra su número');
  });

  it('pulsar el número de una opción la elige', async () => {
    rtl.render(<Shell />);
    await options();
    rtl.fireEvent.keyDown(window, { key: '2' });
    await rtl.screen.findByTestId('hubspot-id-batch');
  });

  it('«Contactos de una empresa» enciende la caja de la empresa, sin otra lista de opciones', async () => {
    await openCompanyMode();
  });

  it('«Cambiar forma de buscar» vuelve a la pregunta con la caja apagada', async () => {
    await openCompanyMode();
    rtl.fireEvent.change(textbox(), { target: { value: 'Acme' } });
    rtl.fireEvent.click(rtl.screen.getByTestId('search-mode-back'));
    await expectChooserWithLockedBox();
  });

  it('«Varias empresas por HubSpot ID» abre el lote con su caja', async () => {
    rtl.render(<Shell />);
    await chooseOption(BATCH_OPTION);
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID de tus empresas/);
    assert.equal(textbox().getAttribute('placeholder'), 'Company IDs (con coma o uno por fila)');
    assert.equal(rtl.screen.queryByTestId('search-mode-options'), null);
    assert.ok(rtl.screen.getByTestId('search-mode-back'));
  });

  it('el contacto puntual tiene su caja y «Cambiar forma de buscar» vuelve a la pregunta', async () => {
    linkedinFlag = true;
    rtl.render(<Shell />);
    await chooseOption(LINKEDIN_OPTION);
    await rtl.screen.findByTestId('linkedin-contact-search');
    assert.equal(textbox().getAttribute('placeholder'), 'Pega el LinkedIn, el correo o el ID de HubSpot del contacto');
    assert.equal(rtl.screen.queryByTestId('search-mode-options'), null);
    rtl.fireEvent.click(await rtl.screen.findByTestId('search-mode-back'));
    await expectChooserWithLockedBox();
  });

  it('cambiar de forma empieza limpio: lo escrito en el lote no pasa al otro modo', async () => {
    linkedinFlag = true;
    rtl.render(<Shell />);
    await chooseOption(BATCH_OPTION);
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    rtl.fireEvent.change(textbox(), { target: { value: '65498491' } });
    rtl.fireEvent.click(rtl.screen.getByTestId('search-mode-back'));
    await chooseOption(LINKEDIN_OPTION);
    await rtl.screen.findByTestId('linkedin-contact-search');
    assert.equal(textbox().value, '');
    assert.equal(rtl.screen.queryByText(/puedes ingresar el HubSpot ID/), null);
  });

  it('desde el modo lote, «Nueva conversación» vuelve a la pregunta con la caja vacía', async () => {
    rtl.render(<Shell />);
    await chooseOption(BATCH_OPTION);
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    rtl.fireEvent.change(textbox(), { target: { value: '65498491,65498497' } });
    rtl.fireEvent.click(rtl.screen.getByTestId('chat-panel-new'));
    await expectChooserWithLockedBox();
    assert.equal(mockRunItem.mock.callCount(), 0);
  });

  it('desde una empresa, «Nueva conversación» vuelve a la pregunta', async () => {
    await openCompanyMode();
    rtl.fireEvent.click(rtl.screen.getByTestId('chat-panel-new'));
    await expectChooserWithLockedBox();
  });

  it('un perfil de persona en «Contactos de una empresa» con la bandera apagada: explica y no busca la empresa', async () => {
    await openCompanyMode();
    rtl.fireEvent.change(textbox(), { target: { value: 'https://www.linkedin.com/in/persona-ficticia-1/' } });
    rtl.fireEvent.keyDown(textbox(), { key: 'Enter', code: 'Enter' });
    await rtl.screen.findByText(/escribe abajo el nombre, el dominio o el HubSpot ID de su empresa/);
    assert.equal(rtl.screen.queryByTestId('contact-enrichment-search-as-person'), null);
    assert.equal(textbox().disabled, false);
  });

  it('varios IDs pegados en «Por empresa»: ofrece «Buscarlas como lote» y, al aceptarlo, los busca como lote', async () => {
    await openCompanyMode();
    rtl.fireEvent.change(textbox(), { target: { value: '111\n222' } });
    rtl.fireEvent.keyDown(textbox(), { key: 'Enter', code: 'Enter' });
    await rtl.screen.findByText(/Eso parece una lista de 2 HubSpot IDs de empresa/);
    const offer = await rtl.screen.findByTestId('contact-enrichment-search-as-batch');
    assert.equal(offer.textContent, 'Buscarlas como lote (2)');
    assert.equal(textbox().disabled, false);
    assert.equal(mockRunItem.mock.callCount(), 0);

    rtl.fireEvent.click(offer);
    await rtl.screen.findByTestId('hubspot-id-batch');
    await rtl.waitFor(() => assert.deepEqual(mockRunItem.mock.calls.map((c) => c.arguments[0]), ['111', '222']));
    await rtl.screen.findByText(/Terminé\. Procesé 2 empresas/, undefined, { timeout: 5000 });
  });

  it('más de 10 IDs pegados en «Por empresa»: avisa el tope y no ofrece el lote', async () => {
    await openCompanyMode();
    rtl.fireEvent.change(textbox(), { target: { value: Array.from({ length: 11 }, (_, i) => `${100 + i}`).join(',') } });
    rtl.fireEvent.keyDown(textbox(), { key: 'Enter', code: 'Enter' });
    await rtl.screen.findByText(/Pegaste 11 HubSpot IDs distintos/);
    assert.equal(rtl.screen.queryByTestId('contact-enrichment-search-as-batch'), null);
    assert.equal(mockRunItem.mock.callCount(), 0);
  });

  it('con un lote de 3 IDs en curso, «Nueva conversación» lo cancela: el 2 y el 3 no se inician y el reporte dice «Cancelado»', async () => {
    let open!: () => void;
    itemGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    rtl.render(<Shell />);
    await chooseOption(BATCH_OPTION);
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    rtl.fireEvent.change(textbox(), { target: { value: '111,222,333' } });
    rtl.fireEvent.keyDown(textbox(), { key: 'Enter', code: 'Enter' });
    await rtl.waitFor(() => assert.equal(mockRunItem.mock.callCount(), 1));
    // Mientras corre el lote no se puede cambiar la forma de buscar.
    assert.equal(rtl.screen.queryByTestId('search-mode-back'), null);

    const newButton = rtl.screen.getByTestId('chat-panel-new') as HTMLButtonElement;
    assert.equal(newButton.disabled, false, '«Nueva conversación» se puede usar con el lote en curso');
    rtl.fireEvent.click(newButton);
    await rtl.screen.findByText(/Cancelando: no voy a iniciar las empresas que faltan/);

    // La empresa en curso termina.
    open();
    // El reporte se oculta mientras se escribe el mensaje final: se espera a ese mensaje y
    // luego al reporte, sin suponer que ya están en pantalla (en CI, más lento, no lo estaban).
    await rtl.screen.findByText(/Lote cancelado\. Procesé 1 empresa y no inicié 2 empresas/, undefined, {
      timeout: 5000,
    });
    await rtl.screen.findByTestId('hubspot-id-batch-cancelled-badge', undefined, { timeout: 5000 });
    assert.deepEqual(mockRunItem.mock.calls.map((c) => c.arguments[0]), ['111']);
    const report = await rtl.screen.findByTestId('hubspot-id-batch-report', undefined, { timeout: 5000 });
    assert.match(report.textContent ?? '', /Empresa 111/);
    const notStarted = await rtl.screen.findByTestId('hubspot-id-batch-not-started', undefined, { timeout: 5000 });
    assert.match(notStarted.textContent ?? '', /222, 333/);

    // El siguiente clic vuelve a la pregunta del primer paso.
    rtl.fireEvent.click(rtl.screen.getByTestId('chat-panel-new'));
    await expectChooserWithLockedBox();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(mockRunItem.mock.callCount(), 1);
  });
});
