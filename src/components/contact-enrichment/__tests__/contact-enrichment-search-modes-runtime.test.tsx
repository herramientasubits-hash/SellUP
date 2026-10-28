/**
 * AGENT2A F1 — Modos de búsqueda del panel del agente y «Nueva conversación».
 *
 * Contrato RUNTIME:
 *   - el botón de HubSpot («Buscar por lote de HubSpot IDs») abre el mismo flujo que «ID»;
 *   - el botón de LinkedIn («Buscar contacto por LinkedIn») sólo aparece con la bandera
 *     CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED encendida;
 *   - tocar el botón activo vuelve a «Por empresa»;
 *   - la caja dice lo que se espera en cada modo;
 *   - «Nueva conversación» abre SIEMPRE en «Por empresa» con la caja vacía;
 *   - con un lote en curso, «Nueva conversación» lo cancela: no se inicia ninguna empresa más
 *     y el reporte queda como «Cancelado».
 *
 * Acciones de servidor en dobles: sin red, sin proveedores, sin créditos.
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { HubSpotIdBatchItemResult } from '@/modules/contact-enrichment/hubspot-id-batch-core';

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

const mockRunItem = mock.fn<(id: unknown) => Promise<HubSpotIdBatchItemResult>>(async (id) => {
  if (itemGate) await itemGate;
  return {
    hubspotCompanyId: String(id),
    status: 'processed',
    name: `Empresa ${String(id)}`,
    country: 'Colombia',
    accountId: `acc-${String(id)}`,
    contactsFound: 2,
    previousPendingContacts: 0,
    routingDisabled: false,
    errorMessage: null,
  };
});

mock.module('@/modules/contact-enrichment/panel-flags-actions', {
  namedExports: {
    getContactEnrichmentPanelFlagsAction: async () => ({ linkedinSearchEnabled: linkedinFlag }),
  },
});
mock.module('@/modules/contact-enrichment/hubspot-id-batch-actions', {
  namedExports: { runHubSpotIdBatchItemAction: (id: unknown) => mockRunItem(id) },
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
  ({ ShellAgentPanelSlotProvider } = await import('@/components/layout/shell-agent-panel-slot'));
});

beforeEach(() => {
  linkedinFlag = false;
  itemGate = null;
  mockRunItem.mock.resetCalls();
});

afterEach(() => {
  rtl.cleanup();
});

const COMPANY_PLACEHOLDER = 'Nombre o dominio de la empresa';

function textbox(): HTMLTextAreaElement {
  return rtl.within(rtl.screen.getByTestId('chat-panel')).getByRole('textbox') as HTMLTextAreaElement;
}

async function expectCompanyModeWithEmptyBox() {
  await rtl.screen.findByText(/dime el nombre, dominio o HubSpot ID/);
  assert.equal(rtl.screen.queryByTestId('hubspot-id-batch'), null);
  assert.equal(rtl.screen.queryByTestId('linkedin-contact-search'), null);
  assert.equal(rtl.screen.getByTestId('chat-panel-hubspot-id-batch').getAttribute('aria-pressed'), 'false');
  await rtl.waitFor(() => assert.equal(textbox().getAttribute('placeholder'), COMPANY_PLACEHOLDER));
  assert.equal(textbox().value, '');
}

describe('Panel del agente · modos de búsqueda (F1)', () => {
  it('con la bandera apagada no aparece el botón de LinkedIn', async () => {
    rtl.render(<Shell />);
    await rtl.screen.findByTestId('chat-panel-hubspot-id-batch');
    // Deja llegar la respuesta de la bandera.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(rtl.screen.queryByTestId('chat-panel-linkedin-search'), null);
  });

  it('con la bandera encendida aparece «Buscar contacto por LinkedIn» con el logo oficial', async () => {
    linkedinFlag = true;
    rtl.render(<Shell />);
    const button = await rtl.screen.findByTestId('chat-panel-linkedin-search');
    assert.equal(button.getAttribute('aria-label'), 'Buscar contacto por LinkedIn');
    assert.ok(button.querySelector('img[src="/brand/linkedin-in.svg"]'));
    // Orden de la cabecera: HubSpot, LinkedIn, «Nueva conversación».
    assert.equal(rtl.screen.getByTestId('chat-panel-hubspot-id-batch').nextElementSibling, button);
    assert.equal(button.nextElementSibling, rtl.screen.getByTestId('chat-panel-new'));
  });

  it('el modo «Por empresa» pide nombre o dominio', async () => {
    rtl.render(<Shell />);
    await expectCompanyModeWithEmptyBox();
  });

  it('el botón de HubSpot abre el mismo flujo de lote que antes abría «ID», con su caja', async () => {
    rtl.render(<Shell />);
    const button = await rtl.screen.findByTestId('chat-panel-hubspot-id-batch');
    assert.equal(button.getAttribute('aria-label'), 'Buscar por lote de HubSpot IDs');
    rtl.fireEvent.click(button);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID de tus empresas/);
    assert.equal(textbox().getAttribute('placeholder'), 'Company IDs separados por coma');
  });

  it('LinkedIn: estado activo, caja propia y tocarlo de nuevo vuelve a «Por empresa»', async () => {
    linkedinFlag = true;
    rtl.render(<Shell />);
    const button = await rtl.screen.findByTestId('chat-panel-linkedin-search');
    rtl.fireEvent.click(button);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    await rtl.screen.findByTestId('linkedin-contact-search');
    assert.equal(textbox().getAttribute('placeholder'), 'Pega el enlace del perfil de LinkedIn');
    rtl.fireEvent.click(button);
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    await expectCompanyModeWithEmptyBox();
  });

  it('desde el modo lote, «Nueva conversación» abre en «Por empresa» con la caja vacía', async () => {
    rtl.render(<Shell />);
    rtl.fireEvent.click(await rtl.screen.findByTestId('chat-panel-hubspot-id-batch'));
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    rtl.fireEvent.change(textbox(), { target: { value: '65498491,65498497' } });
    rtl.fireEvent.click(rtl.screen.getByTestId('chat-panel-new'));
    await expectCompanyModeWithEmptyBox();
    assert.equal(mockRunItem.mock.callCount(), 0);
  });

  it('desde el modo LinkedIn, «Nueva conversación» abre en «Por empresa» con la caja vacía', async () => {
    linkedinFlag = true;
    rtl.render(<Shell />);
    rtl.fireEvent.click(await rtl.screen.findByTestId('chat-panel-linkedin-search'));
    await rtl.screen.findByTestId('linkedin-contact-search');
    rtl.fireEvent.click(rtl.screen.getByTestId('chat-panel-new'));
    await expectCompanyModeWithEmptyBox();
  });

  it('con un lote de 3 IDs en curso, «Nueva conversación» lo cancela: el 2 y el 3 no se inician y el reporte dice «Cancelado»', async () => {
    let open!: () => void;
    itemGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    rtl.render(<Shell />);
    rtl.fireEvent.click(await rtl.screen.findByTestId('chat-panel-hubspot-id-batch'));
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    rtl.fireEvent.change(textbox(), { target: { value: '111,222,333' } });
    rtl.fireEvent.keyDown(textbox(), { key: 'Enter', code: 'Enter' });
    await rtl.waitFor(() => assert.equal(mockRunItem.mock.callCount(), 1));

    const newButton = rtl.screen.getByTestId('chat-panel-new') as HTMLButtonElement;
    assert.equal(newButton.disabled, false, '«Nueva conversación» se puede usar con el lote en curso');
    rtl.fireEvent.click(newButton);
    await rtl.screen.findByText(/Cancelando: no voy a iniciar las empresas que faltan/);

    // La empresa en curso termina.
    open();
    await rtl.screen.findByTestId('hubspot-id-batch-cancelled-badge', undefined, { timeout: 5000 });
    assert.deepEqual(mockRunItem.mock.calls.map((c) => c.arguments[0]), ['111']);
    const report = rtl.screen.getByTestId('hubspot-id-batch-report');
    assert.match(report.textContent ?? '', /Empresa 111/);
    const notStarted = rtl.screen.getByTestId('hubspot-id-batch-not-started');
    assert.match(notStarted.textContent ?? '', /222, 333/);
    await rtl.screen.findByText(/Lote cancelado\. Procesé 1 empresa y no inicié 2 empresas/);

    // El siguiente clic abre la conversación nueva en «Por empresa».
    rtl.fireEvent.click(rtl.screen.getByTestId('chat-panel-new'));
    await expectCompanyModeWithEmptyBox();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(mockRunItem.mock.callCount(), 1);
  });
});
