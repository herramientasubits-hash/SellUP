/**
 * AGENT2A D1 — «Búsqueda por lotes con ID de HubSpot» en el panel del agente.
 *
 * Contrato RUNTIME del flujo que pidió Ventas:
 *   - junto a «Nueva conversación» hay un botón «ID» con el nombre
 *     «Búsqueda por lotes con ID de HubSpot»;
 *   - al pulsarlo, el agente saluda con las instrucciones (1 a 10 IDs por coma);
 *   - la entrada se limpia de espacios y se busca empresa por empresa;
 *   - al terminar hay una tabla Nombre | País | Contactos encontrados |
 *     Contactos por revisar (ejecuciones anteriores) | HubSpot ID, la lista
 *     «Empresas no encontradas en HubSpot» y «Enriquecer otras empresas».
 *
 * La acción de servidor es un doble: sin red, sin proveedores, sin créditos.
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

// El autoscroll del hilo consulta prefers-reduced-motion; jsdom no trae matchMedia.
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

const ROWS: Record<string, HubSpotIdBatchItemResult> = {
  '65498491': {
    hubspotCompanyId: '65498491',
    status: 'processed',
    name: 'Acme SAS',
    country: 'Colombia',
    accountId: 'acc-1',
    contactsFound: 4,
    previousPendingContacts: 2,
    routingDisabled: false,
    errorMessage: null,
  },
  '65498497': {
    hubspotCompanyId: '65498497',
    status: 'processed',
    name: 'Globex',
    country: 'México',
    accountId: 'acc-2',
    contactsFound: 0,
    previousPendingContacts: 3,
    routingDisabled: false,
    errorMessage: null,
  },
};

const mockRunItem = mock.fn<(id: unknown) => Promise<HubSpotIdBatchItemResult>>(async (id) => {
  const key = String(id);
  return (
    ROWS[key] ?? {
      hubspotCompanyId: key,
      status: 'not_found',
      name: null,
      country: null,
      accountId: null,
      contactsFound: 0,
      previousPendingContacts: 0,
      routingDisabled: false,
      errorMessage: null,
    }
  );
});
const mockResolve = mock.fn(async () => ({ success: true, data: { candidates: [] } }));
const mockPush = mock.fn((href: string) => href);

mock.module('@/modules/contact-enrichment/hubspot-id-batch-actions', {
  namedExports: { runHubSpotIdBatchItemAction: (id: unknown) => mockRunItem(id) },
});
mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    resolveContactEnrichmentCompanyAction: () => mockResolve(),
    createContactEnrichmentRequestAction: async () => ({ success: false }),
  },
});
mock.module('@/modules/contact-enrichment/automatic-routing-actions', {
  namedExports: { runAutomaticContactEnrichmentForRequestAction: async () => ({ success: false }) },
});
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: (href: string) => mockPush(href), replace: () => {} }),
  },
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
  mockRunItem.mock.resetCalls();
  mockResolve.mock.resetCalls();
  mockPush.mock.resetCalls();
});

afterEach(() => {
  rtl.cleanup();
});

async function openBatchMode() {
  rtl.render(<Shell />);
  const button = await rtl.screen.findByTestId('chat-panel-hubspot-id-batch');
  rtl.fireEvent.click(button);
  return button;
}

function composer(): HTMLTextAreaElement {
  return rtl.within(rtl.screen.getByTestId('hubspot-id-batch')).getByRole('textbox') as HTMLTextAreaElement;
}

async function send(text: string) {
  const box = composer();
  rtl.fireEvent.change(box, { target: { value: text } });
  rtl.fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
}

describe('Panel del agente · Búsqueda por lotes con ID de HubSpot', () => {
  it('el botón «ID» está junto a «Nueva conversación» y se llama como pidió Ventas', async () => {
    rtl.render(<Shell />);
    const idButton = await rtl.screen.findByTestId('chat-panel-hubspot-id-batch');
    const newButton = rtl.screen.getByTestId('chat-panel-new');
    assert.equal(idButton.getAttribute('aria-label'), 'Búsqueda por lotes con ID de HubSpot');
    assert.equal(idButton.textContent, 'ID');
    // Inmediatamente antes de «Nueva conversación» en la cabecera.
    assert.equal(idButton.nextElementSibling, newButton);
  });

  it('al pulsarlo el agente presenta el modo por lotes con el ejemplo', async () => {
    const button = await openBatchMode();
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID de tus empresas/);
    await rtl.screen.findByText(/65498491,65498497,984654/);
  });

  it('busca empresa por empresa (sin espacios), pinta el reporte y lista las no encontradas', async () => {
    await openBatchMode();
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    await send(' 65498491 , 65498497,\n111222 ');

    const report = await rtl.screen.findByTestId('hubspot-id-batch-report', undefined, { timeout: 5000 });
    assert.deepEqual(
      mockRunItem.mock.calls.map((call) => call.arguments[0]),
      ['65498491', '65498497', '111222'],
    );

    const headers = rtl.within(report).getAllByRole('columnheader').map((th) => th.textContent);
    assert.deepEqual(headers, [
      'Nombre',
      'País',
      'Contactos encontrados',
      'Contactos por revisar (ejecuciones anteriores)',
      'HubSpot ID',
    ]);
    const rows = rtl.within(report).getAllByRole('row').slice(1);
    assert.deepEqual(
      rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent)),
      [
        ['Acme SAS', 'Colombia', '4', '2', '65498491'],
        ['Globex', 'México', '0', '3', '65498497'],
      ],
    );

    const notFound = rtl.screen.getByTestId('hubspot-id-batch-not-found');
    assert.match(notFound.textContent ?? '', /Empresas no encontradas en HubSpot/);
    assert.match(notFound.textContent ?? '', /111222/);

    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: /Revisar contactos/ }));
    assert.deepEqual(mockPush.mock.calls.map((call) => call.arguments[0]), ['/contacts?tab=candidates']);
  });

  it('«Enriquecer otras empresas» deja hacer una nueva búsqueda', async () => {
    await openBatchMode();
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    await send('65498491');
    const restart = await rtl.screen.findByTestId('hubspot-id-batch-restart', undefined, { timeout: 5000 });
    assert.match(restart.textContent ?? '', /Enriquecer otras empresas/);
    rtl.fireEvent.click(restart);
    await rtl.waitFor(() => assert.equal(rtl.screen.queryByTestId('hubspot-id-batch-report'), null));
    assert.equal(composer().disabled, false);
    await send('65498497');
    await rtl.screen.findByTestId('hubspot-id-batch-report', undefined, { timeout: 5000 });
    assert.equal(mockRunItem.mock.callCount(), 2);
  });

  it('más de 10 IDs o valores no numéricos: avisa y no busca nada', async () => {
    await openBatchMode();
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    await send(Array.from({ length: 11 }, (_, i) => String(1000 + i)).join(','));
    await rtl.screen.findByText(/El máximo es 10 empresas/, undefined, { timeout: 5000 });
    await send('123,abc');
    await rtl.screen.findByText(/no son HubSpot IDs válidos/, undefined, { timeout: 5000 });
    assert.equal(mockRunItem.mock.callCount(), 0);
  });

  it('volver a pulsar «ID» regresa al asistente de una empresa', async () => {
    const button = await openBatchMode();
    rtl.fireEvent.click(button);
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(rtl.screen.queryByTestId('hubspot-id-batch'), null);
    await rtl.screen.findByText(/dime el nombre, dominio o HubSpot ID/);
  });
});
