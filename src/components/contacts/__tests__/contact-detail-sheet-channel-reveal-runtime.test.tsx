/**
 * AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE — la ficha del contacto que vino de HubSpot ofrece
 * «Revelar LinkedIn» / «Revelar correo» cuando el servidor lo dice, y tras revelar relee la ficha.
 *
 * Acciones de servidor dobles: sin red, sin proveedor.
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

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];

const BASE = {
  id: '00000000-0000-4000-8000-00000000c0a2',
  account_id: '00000000-0000-4000-8000-00000000acc1',
  full_name: 'Persona Ficticia De HubSpot',
  job_title: 'Gerente de Talento',
  department: null,
  seniority: null,
  email: 'persona@empresa-ficticia.com',
  phone: null,
  mobile_phone: null,
  linkedin_url: null as string | null,
  contact_status: 'active',
  role_in_account: null,
  is_primary: false,
  source: 'hubspot',
  notes: null,
  metadata: { source_candidate_id: '11111111-1111-4111-8111-111111111111' },
  hubspot_contact_id: '501',
  created_at: '2026-11-17T00:00:00.000Z',
  updated_at: '2026-11-17T00:00:00.000Z',
};

let contactToReturn: Record<string, unknown> = BASE;
type EmailStateDouble = {
  employment: null | { status: string; currentCompany: string | null; currentTitle: string | null; since: string | null; checkedAt: string | null };
  check: null | { case: string; foundEmail: string | null; checkedAt: string; resolution: string | null; newCandidateId: string | null };
  pendingCompanyChange: boolean;
  newCompanyName: string | null;
};
const NO_EMAIL_STATE: EmailStateDouble = { employment: null, check: null, pendingCompanyChange: false, newCompanyName: null };
let offer: { email: boolean; linkedin: boolean; verifyEmail?: boolean; emailState?: EmailStateDouble } = { email: false, linkedin: true };
const verifyCalls: string[] = [];
const confirmCalls: string[] = [];
const keepCalls: string[] = [];
let contactReads = 0;
type RevealResult = { ok: boolean; status: string; contactUpdated: boolean };
const foundLinkedin = async (input: { contactId: string; channel: string }): Promise<RevealResult> => {
  revealCalls.push(input);
  contactToReturn = { ...BASE, linkedin_url: 'https://www.linkedin.com/in/persona-ficticia', updated_at: '2026-11-17T01:00:00.000Z' };
  offer = { email: false, linkedin: false };
  return { ok: true, status: 'completed', contactUpdated: true };
};
let revealImpl: (input: { contactId: string; channel: string }) => Promise<RevealResult> = foundLinkedin;
const revealCalls: Array<{ contactId: string; channel: string }> = [];

mock.module('@/modules/contacts/actions', {
  namedExports: {
    getContactById: async () => {
      contactReads += 1;
      return contactToReturn;
    },
    getContactAudit: async () => [],
    setPrimaryContact: async () => ({ success: true }),
    changeContactStatus: async () => ({ success: true }),
    archiveContact: async () => ({ success: true }),
    syncContactToHubSpot: async () => ({ ok: false, message: 'no' }),
    updateContact: async () => ({ success: true }),
  },
});
mock.module('@/modules/accounts/actions', {
  namedExports: {
    getAccountById: async () => ({ id: '00000000-0000-4000-8000-00000000acc1', name: 'Empresa Ficticia' }),
  },
});
mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});
mock.module('sonner', {
  namedExports: { toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} } },
});
mock.module('@/components/contacts/post-approval-reveal-cta', {
  namedExports: { OfficialContactPhoneRevealCta: () => null },
});
mock.module('@/components/contacts/edit-contact-drawer', {
  namedExports: { EditContactDrawer: () => null },
});
mock.module('@/modules/contact-enrichment/official-contact-identity-completion-actions', {
  namedExports: {
    getOfficialContactChannelRevealOfferAction: async () => ({ verifyEmail: false, emailState: NO_EMAIL_STATE, ...offer }),
    revealOfficialContactChannelAction: (input: { contactId: string; channel: string }) => revealImpl(input),
    verifyOfficialContactEmailAction: async (input: { contactId: string }) => {
      verifyCalls.push(input.contactId);
      return { ok: true, status: 'checked', case: 'same_company_new_email', hubspot: 'promoted' };
    },
    keepOfficialContactAtCompanyAction: async (input: { contactId: string }) => {
      keepCalls.push(input.contactId);
      return { ok: true, applied: false, hubspot: null };
    },
  },
});
// AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE — sin 409 pendiente: el panel de fusión no se pinta.
mock.module('@/modules/contact-enrichment/official-contact-hubspot-merge-actions', {
  namedExports: {
    getOfficialContactHubSpotMergeOfferAction: async () => ({ status: 'none' }),
    mergeOfficialContactInHubSpotAction: async () => ({ ok: false, outcome: 'not_pending', message: '', otherSellupContacts: 0 }),
  },
});
mock.module('@/modules/contact-enrichment/contact-company-change-actions', {
  namedExports: {
    confirmOfficialContactCompanyChangeAction: async (input: { contactId: string }) => {
      confirmCalls.push(input.contactId);
      return { ok: true, candidateId: 'cand-new', companyName: 'Empresa Nueva', companyAssigned: true, message: 'Listo: el contacto se archivó.' };
    },
    restoreCompanyChangeContactAction: async () => ({ ok: true, message: 'Contacto desarchivado.' }),
  },
});

let ContactDetailSheet: (typeof import('../contact-detail-sheet'))['ContactDetailSheet'];
let NavAccessProvider: (typeof import('@/components/layout/nav-access-context'))['NavAccessProvider'];

before(async () => {
  ({ render, screen, fireEvent, cleanup, waitFor } = await import('@testing-library/react'));
  ({ ContactDetailSheet } = await import('../contact-detail-sheet'));
  ({ NavAccessProvider } = await import('@/components/layout/nav-access-context'));
});

beforeEach(() => {
  contactToReturn = BASE;
  offer = { email: false, linkedin: true };
  contactReads = 0;
  revealCalls.length = 0;
  verifyCalls.length = 0;
  confirmCalls.length = 0;
  keepCalls.length = 0;
});
afterEach(() => cleanup());

async function renderSheet() {
  render(
    <NavAccessProvider value={{ isAdmin: true, roleKey: 'admin' }}>
      <ContactDetailSheet contactId={BASE.id} open onClose={() => {}} />
    </NavAccessProvider>,
  );
  return screen.findByRole('region', { name: 'Resumen del contacto' });
}

describe('ficha del contacto traído de HubSpot: revelar lo que falta', () => {
  it('sin LinkedIn y con oferta: «Revelar LinkedIn» con su costo; al revelar relee la ficha', async () => {
    await renderSheet();
    const button = await screen.findByRole('button', { name: /Revelar LinkedIn/ });
    assert.ok(screen.getByText(/Busca a la persona en Apollo por su correo/));
    const readsBefore = contactReads;
    fireEvent.click(button);
    await waitFor(() => assert.deepEqual(revealCalls, [{ contactId: BASE.id, channel: 'linkedin' }]));
    await waitFor(() => assert.ok(contactReads > readsBefore));
    // El dato se lee en su fila (la ficha releída) y el botón ya no se ofrece.
    assert.ok(await screen.findByText('https://www.linkedin.com/in/persona-ficticia'));
    assert.equal(screen.queryByRole('button', { name: /Revelar LinkedIn/ }), null);
  });

  it('sin resultado: el desenlace queda escrito en la fila', async () => {
    const original = revealImpl;
    revealImpl = async () => ({ ok: false, status: 'not_found', contactUpdated: false });
    await renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: /Revelar LinkedIn/ }));
    assert.ok(await screen.findByText(/No encontramos a esta persona en los proveedores/));
    revealImpl = original;
  });

  it('sin oferta del servidor no se pinta nada (el vacío de siempre)', async () => {
    offer = { email: false, linkedin: false };
    contactToReturn = { ...BASE, email: null };
    await renderSheet();
    assert.ok(await screen.findByText('Sin email. Añádelo con «Editar contacto».'));
    assert.equal(screen.queryByRole('button', { name: /Revelar (LinkedIn|correo)/ }), null);
  });

  it('sin correo y con oferta: «Revelar correo» en la fila del email', async () => {
    offer = { email: true, linkedin: false };
    contactToReturn = { ...BASE, email: null, linkedin_url: 'https://www.linkedin.com/in/persona-ficticia' };
    await renderSheet();
    assert.ok(await screen.findByRole('button', { name: /Revelar correo/ }));
    assert.equal(screen.queryByText('Sin email. Añádelo con «Editar contacto».'), null);
  });
});

describe('AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — verificar correo y cambio de empresa', () => {
  it('con correo y LinkedIn: «Verificar correo» con su costo; al verificar dice qué pasó', async () => {
    offer = { email: false, linkedin: false, verifyEmail: true };
    contactToReturn = { ...BASE, linkedin_url: 'https://www.linkedin.com/in/persona-ficticia' };
    await renderSheet();
    const button = await screen.findByRole('button', { name: /Verificar correo/ });
    assert.ok(screen.getByText(/Pregunta a Apollo por su LinkedIn dónde trabaja hoy/));
    fireEvent.click(button);
    await waitFor(() => assert.deepEqual(verifyCalls, [BASE.id]));
    assert.ok(await screen.findByText(/quedó como principal y el anterior se conserva como adicional/));
  });

  it('cambio de empresa pendiente: aviso con «Enviar a revisión en …», confirmación y «Sigue aquí»', async () => {
    offer = {
      email: false,
      linkedin: false,
      verifyEmail: true,
      emailState: {
        employment: { status: 'other_company', currentCompany: 'Empresa Nueva', currentTitle: 'Directora', since: '2026-03', checkedAt: null },
        check: { case: 'company_change', foundEmail: 'persona@nueva.com', checkedAt: '2026-11-18T00:00:00.000Z', resolution: null, newCandidateId: null },
        pendingCompanyChange: true,
        newCompanyName: 'Empresa Nueva',
      },
    };
    contactToReturn = { ...BASE, linkedin_url: 'https://www.linkedin.com/in/persona-ficticia' };
    await renderSheet();
    assert.ok(await screen.findByText('Cambió de empresa'));
    assert.ok(screen.getByText(/Ahora trabaja en Empresa Nueva desde 2026-03/));
    // Con un cambio pendiente no se ofrece volver a verificar (primero se decide).
    assert.equal(screen.queryByRole('button', { name: /Verificar correo/ }), null);
    fireEvent.click(screen.getByRole('button', { name: /Enviar a revisión en Empresa Nueva/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar cambio/ }));
    await waitFor(() => assert.deepEqual(confirmCalls, [BASE.id]));

    fireEvent.click(screen.getByRole('button', { name: /Sigue aquí/ }));
    await waitFor(() => assert.deepEqual(keepCalls, [BASE.id]));
  });

  it('contacto archivado por cambio de empresa: aviso y «Desarchivar»', async () => {
    offer = { email: false, linkedin: false };
    contactToReturn = {
      ...BASE,
      archived_at: '2026-11-18T00:00:00.000Z',
      contact_status: 'archived',
      metadata: {
        company_change: {
          new_candidate_id: 'cand-new',
          confirmed_at: '2026-11-18T00:00:00.000Z',
          new_company_name: 'Empresa Nueva',
          outcome: 'pending_review',
        },
      },
    };
    await renderSheet();
    assert.ok(await screen.findByText(/Archivado por cambio de empresa: ahora en Empresa Nueva/));
    assert.ok(screen.getByRole('button', { name: /Desarchivar/ }));
  });
});
