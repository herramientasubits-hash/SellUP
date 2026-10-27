/**
 * AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — modo «Buscar contacto por LinkedIn» en el panel.
 *
 * Contrato RUNTIME:
 *   - el chat nunca muestra la URL pegada (dato personal);
 *   - vista previa con nombre, cargo, empresa según el proveedor y datos encontrados;
 *   - «Crear candidato» sólo con una empresa elegida; se envía la empresa elegida;
 *   - error del proveedor ≠ no encontrado, con «Reintentar».
 *
 * Acciones de servidor en dobles: sin red, sin proveedores, sin créditos. Datos ficticios.
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

for (const proto of [window.HTMLElement.prototype, window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
  if (typeof p.scrollTo !== 'function') p.scrollTo = () => {};
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
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

const FAKE_URL = 'https://es.linkedin.com/in/persona-ficticia-123/';

type SearchResponse = Record<string, unknown>;
let searchResponses: SearchResponse[] = [];
const FOUND: SearchResponse = {
  status: 'found',
  token: 'tok',
  hubspotCheck: 'clear',
  preview: {
    provider: 'apollo',
    fullName: 'Ana Ficticia',
    title: 'Directora de Talento',
    providerCompanyName: 'Empresa Ficticia SAS',
    providerCompanyDomain: 'empresa-ficticia.test',
    email: 'ana@empresa-ficticia.test',
    phoneAvailable: null,
    suggestedCompanyQuery: 'empresa-ficticia.test',
  },
};

const mockSearch = mock.fn<(url: unknown) => Promise<SearchResponse>>(async () => searchResponses.shift() ?? FOUND);
const mockCreate = mock.fn<(token: unknown, company: unknown) => Promise<Record<string, unknown>>>(async () => ({
  ok: true,
  candidateId: 'cand-1',
  runId: 'run-1',
  accountId: 'acc-1',
  companyConsistency: { status: 'match' },
  message: 'Listo. Dejé a Ana Ficticia en «Por revisar» con Empresa Ficticia SAS.',
}));
const mockResolve = mock.fn<(input: unknown) => Promise<Record<string, unknown>>>(async () => ({
  success: true,
  data: {
    resolved: true,
    singleMatch: true,
    skippedHubSpot: false,
    candidates: [
      { source: 'sellup', name: 'Empresa Ficticia SAS', domain: 'empresa-ficticia.test', sellupAccountId: 'acc-1', matchConfidence: 1 },
    ],
  },
}));

mock.module('@/modules/contact-enrichment/panel-flags-actions', {
  namedExports: { getContactEnrichmentPanelFlagsAction: async () => ({ linkedinSearchEnabled: true }) },
});
mock.module('@/modules/contact-enrichment/linkedin-contact-search-actions', {
  namedExports: {
    searchContactByLinkedinAction: (url: unknown) => mockSearch(url),
    createLinkedinContactCandidateAction: (token: unknown, company: unknown) => mockCreate(token, company),
  },
});
mock.module('@/modules/contact-enrichment/resolve-company-client', {
  namedExports: { resolveCompanyViaRoute: (input: unknown) => mockResolve(input) },
});
mock.module('@/modules/contact-enrichment/hubspot-id-batch-actions', {
  namedExports: { runHubSpotIdBatchItemAction: async () => ({}) },
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
  searchResponses = [];
  mockSearch.mock.resetCalls();
  mockCreate.mock.resetCalls();
  mockResolve.mock.resetCalls();
});

afterEach(() => {
  rtl.cleanup();
});

async function openLinkedinModeAndSend(url = FAKE_URL) {
  rtl.render(<Shell />);
  rtl.fireEvent.click(await rtl.screen.findByTestId('chat-panel-linkedin-search'));
  const panel = await rtl.screen.findByTestId('linkedin-contact-search');
  await rtl.within(panel).findByText(/Pega el enlace del perfil de LinkedIn de la persona/);
  const box = rtl.within(panel).getByRole('textbox') as HTMLTextAreaElement;
  await rtl.waitFor(() => assert.equal(box.disabled, false));
  rtl.fireEvent.change(box, { target: { value: url } });
  rtl.fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
  return panel;
}

describe('Panel del agente · Buscar contacto por LinkedIn (F2)', () => {
  it('el chat no repite la URL y muestra la vista previa del proveedor', async () => {
    const panel = await openLinkedinModeAndSend();
    await rtl.within(panel).findByText('Perfil de LinkedIn enviado.');
    const preview = await rtl.screen.findByTestId('linkedin-preview', undefined, { timeout: 5000 });
    assert.deepEqual(mockSearch.mock.calls.map((c) => c.arguments[0]), [FAKE_URL]);
    assert.equal(document.body.textContent?.includes('persona-ficticia-123'), false);
    const text = preview.textContent ?? '';
    for (const expected of ['Ana Ficticia', 'Directora de Talento', 'Empresa Ficticia SAS', 'ana@empresa-ficticia.test', 'Empresa actual según Apollo']) {
      assert.ok(text.includes(expected), expected);
    }
  });

  it('«Crear candidato» exige elegir empresa y envía la empresa elegida', async () => {
    await openLinkedinModeAndSend();
    rtl.fireEvent.click(await rtl.screen.findByTestId('linkedin-associate-company', undefined, { timeout: 5000 }));
    const dialog = await rtl.screen.findByTestId('linkedin-company-dialog');
    const create = rtl.screen.getByTestId('linkedin-create-candidate') as HTMLButtonElement;
    assert.equal(create.disabled, true);
    // Precargado con el dominio que trajo el proveedor.
    const input = rtl.within(dialog).getByDisplayValue('empresa-ficticia.test');
    rtl.fireEvent.submit(input.closest('form') as HTMLFormElement);
    await rtl.waitFor(() => assert.equal(mockResolve.mock.callCount(), 1));
    await rtl.waitFor(() => assert.equal((rtl.screen.getByTestId('linkedin-create-candidate') as HTMLButtonElement).disabled, false));
    rtl.fireEvent.click(rtl.screen.getByTestId('linkedin-create-candidate'));
    await rtl.screen.findByText(/Dejé a Ana Ficticia en «Por revisar»/, undefined, { timeout: 5000 });
    assert.equal(mockCreate.mock.calls[0].arguments[0], 'tok');
    assert.deepEqual(
      (mockCreate.mock.calls[0].arguments[1] as { sellupAccountId: string }).sellupAccountId,
      'acc-1',
    );
  });

  it('error del proveedor: mensaje propio y «Reintentar» vuelve a buscar el mismo perfil', async () => {
    searchResponses = [{ status: 'provider_error', message: 'No pudimos consultar los proveedores en este momento.' }];
    const panel = await openLinkedinModeAndSend();
    await rtl.within(panel).findByText(/No pudimos consultar los proveedores/, undefined, { timeout: 5000 });
    assert.equal(rtl.within(panel).queryByText(/No encontramos datos para este perfil/), null);
    rtl.fireEvent.click(await rtl.screen.findByTestId('linkedin-search-retry'));
    await rtl.screen.findByTestId('linkedin-preview', undefined, { timeout: 5000 });
    assert.deepEqual(mockSearch.mock.calls.map((c) => c.arguments[0]), [FAKE_URL, FAKE_URL]);
  });

  it('perfil no encontrado: no hay vista previa ni botón de empresa', async () => {
    searchResponses = [{ status: 'not_found', message: 'No encontramos datos para este perfil.', creditsSpent: true }];
    const panel = await openLinkedinModeAndSend();
    await rtl.within(panel).findByText(/No encontramos datos para este perfil/, undefined, { timeout: 5000 });
    assert.equal(rtl.screen.queryByTestId('linkedin-preview'), null);
    assert.equal(rtl.screen.queryByTestId('linkedin-associate-company'), null);
  });
});
