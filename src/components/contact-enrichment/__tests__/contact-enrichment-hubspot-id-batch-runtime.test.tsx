/**
 * AGENT2A D1 — «Búsqueda por lotes con ID de HubSpot» en el panel del agente.
 *
 * Contrato RUNTIME del flujo que pidió Ventas:
 *   - junto a «Nueva conversación» hay un botón con el logo de HubSpot y el nombre
 *     «Buscar por lote de HubSpot IDs» (F1: antes era el rótulo «ID»);
 *   - al pulsarlo, el agente saluda con las instrucciones (1 a 10 IDs por coma);
 *   - la entrada se limpia de espacios y se busca empresa por empresa;
 *   - Bryan 04-11: cada empresa se prepara en el servidor y se busca por la MISMA ruta que una
 *     empresa sola; al terminar hay una tabla Nombre | País | Aprobados (nuevos) |
 *     Por aprobar (encontrados / anteriores) | HubSpot ID y la lista «Empresas no encontradas
 *     en HubSpot»; la caja sigue activa para pegar más IDs; minimizar ya no corta el lote.
 *
 * La acción de servidor y la ruta son dobles: sin red, sin proveedores, sin créditos.
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

const COMPANIES: Record<string, { name: string; country: string }> = {
  '65498491': { name: 'Acme SAS', country: 'Colombia' },
  '65498497': { name: 'Globex', country: 'México' },
};

/** Lo que devuelve la ruta de búsqueda para cada request (el resultado de una empresa sola). */
const SEARCH_RESULTS: Record<string, Record<string, unknown>> = {
  'req-65498491': {
    hubspotFirstCandidates: 2,
    hubspotAutoApprovedContacts: 1,
    providerCandidatesCreated: { apollo: 3, lusha: null },
    previousPendingReviewCandidates: 2,
    approvedContactsTotal: 5,
  },
  'req-65498497': {
    providerCandidatesCreated: { apollo: 0, lusha: null },
    previousPendingReviewCandidates: 3,
    approvedContactsTotal: 0,
  },
};

/** Si está puesto, cada empresa espera a que se abra (para probar el minimizar). */
let itemGate: Promise<void> | null = null;

const mockRunItem = mock.fn<(id: unknown) => Promise<HubSpotIdBatchPrepared>>(async (id) => {
  if (itemGate) await itemGate;
  const key = String(id);
  const company = COMPANIES[key];
  if (!company) return { status: 'not_found', hubspotCompanyId: key };
  return { status: 'ready', hubspotCompanyId: key, ...company, accountId: `acc-${key}`, requestId: `req-${key}` };
});

const searchedRequests: string[] = [];
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const requestId = String(url).split('/requests/')[1]?.split('/')[0] ?? '';
  searchedRequests.push(requestId);
  return {
    redirected: false,
    url: `http://localhost${String(url)}`,
    ok: true,
    json: async () => ({
      ok: true,
      result: {
        success: true, status: 'no_fallback_needed', automaticRoutingEnabled: true, fallbackExecuted: false,
        attempt1AttemptId: 'a1', attempt2AttemptId: null, blockedReason: null, reusedExistingCandidates: 0,
        providerCandidatesCreated: { apollo: null, lusha: null }, failedProviders: [],
        ...(SEARCH_RESULTS[requestId] ?? {}),
      },
    }),
  };
};
const mockResolve = mock.fn(async () => ({ success: true, data: { candidates: [] } }));
const mockPush = mock.fn((href: string) => href);

mock.module('@/modules/contact-enrichment/hubspot-id-batch-actions', {
  namedExports: { prepareHubSpotIdBatchItemAction: (id: unknown) => mockRunItem(id) },
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
  itemGate = null;
  mockRunItem.mock.resetCalls();
  mockResolve.mock.resetCalls();
  mockPush.mock.resetCalls();
  searchedRequests.length = 0;
  resetHubSpotIdBatchConversationForTests();
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
  it('el botón de HubSpot está junto a «Nueva conversación» y se llama como pidió Ventas', async () => {
    rtl.render(<Shell />);
    const idButton = await rtl.screen.findByTestId('chat-panel-hubspot-id-batch');
    const newButton = rtl.screen.getByTestId('chat-panel-new');
    assert.equal(idButton.getAttribute('aria-label'), 'Buscar por lote de HubSpot IDs');
    // F1 — el rótulo «ID» pasó a ser el logo oficial de HubSpot (archivo sin modificar).
    assert.ok(idButton.querySelector('img[src="/brand/hubspot-sprocket.svg"]'));
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
      'Aprobados (nuevos)',
      'Por aprobar (encontrados / anteriores)',
      'HubSpot ID',
    ]);
    const rows = rtl.within(report).getAllByRole('row').slice(1);
    assert.deepEqual(
      rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent)),
      [
        ['Acme SAS', 'Colombia', '5 (1)', '6 (4 / 2)', '65498491'],
        ['Globex', 'México', '0 (0)', '3 (0 / 3)', '65498497'],
      ],
    );
    // Cada empresa existente se buscó por la ruta de una empresa sola; la inexistente no.
    assert.deepEqual(searchedRequests, ['req-65498491', 'req-65498497']);
    await rtl.screen.findByText(/5 contactos aprobados \| 1 contacto nuevo/);
    await rtl.screen.findByText(/9 contactos por aprobar \| 4 encontrados, 5 de ejecuciones anteriores/);

    const notFound = rtl.screen.getByTestId('hubspot-id-batch-not-found');
    assert.match(notFound.textContent ?? '', /Empresas no encontradas en HubSpot/);
    assert.match(notFound.textContent ?? '', /111222/);

    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: /Revisar contactos/ }));
    assert.deepEqual(mockPush.mock.calls.map((call) => call.arguments[0]), ['/contacts?tab=candidates']);
  });

  it('al terminar la caja sigue activa y otra lista sigue en la misma conversación', async () => {
    await openBatchMode();
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    await send('65498491');
    await rtl.screen.findByTestId('hubspot-id-batch-report', undefined, { timeout: 5000 });
    assert.equal(rtl.screen.queryByTestId('hubspot-id-batch-restart'), null);
    await rtl.waitFor(() => assert.equal(composer().disabled, false));
    assert.equal(composer().placeholder, 'Pega más Company IDs separados por coma');
    await send('65498497');
    await rtl.waitFor(() => assert.equal(mockRunItem.mock.callCount(), 2), { timeout: 5000 });
    await rtl.screen.findByText(/0 contactos aprobados \| 0 contactos nuevos/, undefined, { timeout: 5000 });
    // Lo anterior sigue en la conversación.
    assert.ok(rtl.screen.getAllByText('65498491').length >= 1);
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

  it('Bryan 04-11 — si se minimiza el panel a mitad de la lista, el lote SIGUE (como una empresa sola)', async () => {
    let open!: () => void;
    itemGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await openBatchMode();
    await rtl.screen.findByText(/puedes ingresar el HubSpot ID/);
    await send('65498491,65498497,111222');
    await rtl.waitFor(() => assert.equal(mockRunItem.mock.callCount(), 1));
    // Minimizar desmonta el lote (el panel vuelve al modo de una empresa y se cierra)…
    rtl.fireEvent.click(rtl.screen.getByTestId('chat-panel-minimize'));
    open();
    // …pero las empresas que faltan se buscan igual, con su fila en el Centro de procesos.
    await rtl.waitFor(() => assert.equal(mockRunItem.mock.callCount(), 3), { timeout: 5000 });
    await rtl.waitFor(() => assert.deepEqual(searchedRequests, ['req-65498491', 'req-65498497']), { timeout: 5000 });
  });

  it('volver a pulsar el botón de HubSpot regresa al asistente de una empresa', async () => {
    const button = await openBatchMode();
    rtl.fireEvent.click(button);
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(rtl.screen.queryByTestId('hubspot-id-batch'), null);
    await rtl.screen.findByText(/dime el nombre, dominio o HubSpot ID/);
  });
});
