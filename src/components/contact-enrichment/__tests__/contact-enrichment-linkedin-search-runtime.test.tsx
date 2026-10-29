/**
 * AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — modo «Buscar contacto por LinkedIn» en el panel.
 * AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — también por correo, y el candidato se crea al
 * encontrar a la persona: «Revisar ahora» abre su ficha en «Por revisar».
 *
 * Contrato RUNTIME:
 *   - el chat nunca repite lo pegado (URL o correo) como mensaje del usuario;
 *   - con resultado: tarjeta con nombre, cargo, empresa según la fuente y empresa asignada (o
 *     «Sin empresa asociada»), y «Revisar ahora» que lleva a la ficha del candidato;
 *   - ya en «Por revisar» y visible: «Abrir candidato»;
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
const FAKE_EMAIL = 'ana@empresa-ficticia.test';
const CANDIDATE_ID = '3f2b8c1e-1a2b-4c3d-9e8f-001122334455';

type SearchResponse = Record<string, unknown>;
let searchResponses: SearchResponse[] = [];
const PREVIEW = {
  provider: 'apollo',
  fullName: 'Ana Ficticia',
  title: 'Directora de Talento',
  providerCompanyName: 'Empresa Ficticia SAS',
  providerCompanyDomain: 'empresa-ficticia.test',
  email: FAKE_EMAIL,
  phoneAvailable: null,
  hasLinkedin: true,
  hasPhone: false,
  suggestedCompanyQuery: 'empresa-ficticia.test',
};
const CREATED: SearchResponse = {
  status: 'created',
  entryMode: 'linkedin_single',
  candidateId: CANDIDATE_ID,
  preview: PREVIEW,
  company: { name: 'Empresa Ficticia SAS', source: 'hubspot' },
  companyMismatch: false,
  hubspotUnavailable: false,
};

const mockSearch = mock.fn<(input: unknown) => Promise<SearchResponse>>(async () => searchResponses.shift() ?? CREATED);
const pushed: string[] = [];

mock.module('@/modules/contact-enrichment/panel-flags-actions', {
  namedExports: { getContactEnrichmentPanelFlagsAction: async () => ({ linkedinSearchEnabled: true }) },
});
mock.module('@/modules/contact-enrichment/linkedin-contact-search-actions', {
  namedExports: { searchContactQuickAction: (input: unknown) => mockSearch(input) },
});
mock.module('@/modules/contact-enrichment/resolve-company-client', {
  namedExports: { resolveCompanyViaRoute: async () => ({ success: true, data: { candidates: [] } }) },
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
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: (href: string) => pushed.push(href), replace: () => {} }),
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
  searchResponses = [];
  pushed.length = 0;
  mockSearch.mock.resetCalls();
});

afterEach(() => {
  rtl.cleanup();
});

async function openModeAndSend(value = FAKE_URL) {
  rtl.render(<Shell />);
  rtl.fireEvent.click(await rtl.screen.findByTestId('chat-panel-linkedin-search'));
  const panel = await rtl.screen.findByTestId('linkedin-contact-search');
  await rtl.within(panel).findByText(/Pega el enlace del perfil de LinkedIn .* o el correo de la persona/);
  const box = rtl.within(panel).getByRole('textbox') as HTMLTextAreaElement;
  await rtl.waitFor(() => assert.equal(box.disabled, false));
  rtl.fireEvent.change(box, { target: { value } });
  rtl.fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
  return panel;
}

describe('Panel del agente · Buscar contacto por LinkedIn o correo', () => {
  it('LinkedIn: no repite la URL, crea el candidato y muestra lo encontrado con la empresa asignada', async () => {
    const panel = await openModeAndSend();
    await rtl.within(panel).findByText('Perfil de LinkedIn enviado.');
    const preview = await rtl.screen.findByTestId('linkedin-preview', undefined, { timeout: 5000 });
    assert.deepEqual(mockSearch.mock.calls.map((c) => c.arguments[0]), [FAKE_URL]);
    assert.equal(document.body.textContent?.includes('persona-ficticia-123'), false);
    const text = preview.textContent ?? '';
    for (const expected of ['Ana Ficticia', 'Directora de Talento', 'Empresa actual según Apollo', 'Empresa asignada', FAKE_EMAIL]) {
      assert.ok(text.includes(expected), expected);
    }
    await rtl.within(panel).findByText(/lo dejé en «Por revisar» con Empresa Ficticia SAS/);
    // Ya no hay paso de «Asociar a una empresa»: el candidato existe.
    assert.equal(rtl.screen.queryByTestId('linkedin-associate-company'), null);
  });

  it('«Revisar ahora» abre la ficha del candidato en «Por revisar»', async () => {
    await openModeAndSend();
    const opened: unknown[] = [];
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener('sellup:contact-candidate:open', onOpen);
    try {
      rtl.fireEvent.click(await rtl.screen.findByTestId('linkedin-review-now', undefined, { timeout: 5000 }));
      assert.deepEqual(pushed, [`/contacts?tab=candidates&candidate=${CANDIDATE_ID}`]);
      assert.deepEqual(opened, [{ candidateId: CANDIDATE_ID }]);
    } finally {
      window.removeEventListener('sellup:contact-candidate:open', onOpen);
    }
  });

  it('correo: el chat dice «Correo enviado.» y la tarjeta dice si encontró el LinkedIn', async () => {
    searchResponses = [{ ...CREATED, entryMode: 'email_single', preview: { ...PREVIEW, provider: 'hubspot', hasPhone: true } }];
    const panel = await openModeAndSend(FAKE_EMAIL);
    await rtl.within(panel).findByText('Correo enviado.');
    const preview = await rtl.screen.findByTestId('linkedin-preview', undefined, { timeout: 5000 });
    assert.deepEqual(mockSearch.mock.calls.map((c) => c.arguments[0]), [FAKE_EMAIL]);
    const text = preview.textContent ?? '';
    assert.ok(text.includes('Datos encontrados en HubSpot'));
    assert.ok(text.includes('Registrado en HubSpot'));
    assert.ok(text.includes('LinkedIn'));
    assert.equal(text.includes('Empresa actual según'), false);
    await rtl.within(panel).findByText(/en HubSpot \(sin gastar créditos\)/);
  });

  it('sin coincidencia única: «Sin empresa asociada» y aviso de asignarla antes de aprobar', async () => {
    searchResponses = [{ ...CREATED, company: null }];
    const panel = await openModeAndSend();
    const preview = await rtl.screen.findByTestId('linkedin-preview', undefined, { timeout: 5000 });
    assert.ok((preview.textContent ?? '').includes('Sin empresa asociada'));
    await rtl.within(panel).findByText(/Asígnala con «Reasignar empresa» antes de aprobar/);
    assert.ok(rtl.screen.getByTestId('linkedin-review-now'));
  });

  it('ya en «Por revisar» y visible: «Abrir candidato»', async () => {
    searchResponses = [
      {
        status: 'already_known',
        where: 'sellup_pending_candidate',
        matchedBy: 'linkedin',
        match: { fullName: 'Ana Ficticia', companyName: null },
        creditsSpent: false,
        message: 'Esta persona ya está en «Por revisar». No se gastaron créditos.',
        candidateId: CANDIDATE_ID,
      },
    ];
    await openModeAndSend();
    rtl.fireEvent.click(await rtl.screen.findByTestId('linkedin-open-candidate', undefined, { timeout: 5000 }));
    assert.deepEqual(pushed, [`/contacts?tab=candidates&candidate=${CANDIDATE_ID}`]);
  });

  it('error del proveedor: mensaje propio y «Reintentar» vuelve a buscar lo mismo', async () => {
    searchResponses = [{ status: 'provider_error', message: 'No pudimos consultar los proveedores en este momento.' }];
    const panel = await openModeAndSend();
    await rtl.within(panel).findByText(/No pudimos consultar los proveedores/, undefined, { timeout: 5000 });
    assert.equal(rtl.within(panel).queryByText(/No encontramos datos/), null);
    rtl.fireEvent.click(await rtl.screen.findByTestId('linkedin-search-retry'));
    await rtl.screen.findByTestId('linkedin-preview', undefined, { timeout: 5000 });
    assert.deepEqual(mockSearch.mock.calls.map((c) => c.arguments[0]), [FAKE_URL, FAKE_URL]);
  });

  it('no encontrado: no hay tarjeta ni «Revisar ahora», y se puede buscar otra persona', async () => {
    searchResponses = [{ status: 'not_found', message: 'No encontramos datos para este perfil.', creditsSpent: true }];
    const panel = await openModeAndSend();
    await rtl.within(panel).findByText(/No encontramos datos para este perfil/, undefined, { timeout: 5000 });
    assert.equal(rtl.screen.queryByTestId('linkedin-preview'), null);
    assert.equal(rtl.screen.queryByTestId('linkedin-review-now'), null);
    const box = rtl.within(panel).getByRole('textbox') as HTMLTextAreaElement;
    await rtl.waitFor(() => assert.equal(box.disabled, false));
  });
});
