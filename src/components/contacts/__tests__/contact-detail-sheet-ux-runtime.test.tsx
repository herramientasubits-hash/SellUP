/**
 * UX-EMPRESAS-CONTACTOS — el panel de detalle de un contacto
 * (ContactDetailSheet) como se lee.
 *
 *   1. Cabecera con nombre y estado; debajo, un resumen de lo esencial
 *      (empresa, cargo, rol, seniority) antes de las pestañas.
 *   2. Lo que está en el resumen no se repite en las secciones.
 *   3. El pie lleva «Más acciones» a la izquierda y «Editar contacto», la
 *      principal, a la derecha.
 *   4. Los vacíos dicen qué hacer.
 *
 * Acciones de servidor dobles: sin red, sin proveedor, nada se revela.
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
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

const CONTACT = {
  id: '00000000-0000-4000-8000-00000000c0a1',
  account_id: '00000000-0000-4000-8000-00000000acc1',
  full_name: 'Persona Ficticia De Prueba',
  job_title: 'Directora de Talento',
  department: null,
  seniority: 'director',
  email: null,
  phone: null,
  mobile_phone: null,
  linkedin_url: null,
  contact_status: 'active',
  role_in_account: 'decision_maker',
  is_primary: true,
  source: 'manual',
  notes: null,
  metadata: {},
  hubspot_contact_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

let contactToReturn: Record<string, unknown> = CONTACT;

mock.module('@/modules/contacts/actions', {
  namedExports: {
    getContactById: async () => contactToReturn,
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
let editDrawerOpen = false;
mock.module('@/components/contacts/edit-contact-drawer', {
  namedExports: {
    EditContactDrawer: (props: { open: boolean }) => {
      editDrawerOpen = props.open;
      return null;
    },
  },
});

let ContactDetailSheet: (typeof import('../contact-detail-sheet'))['ContactDetailSheet'];

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ContactDetailSheet } = await import('../contact-detail-sheet'));
});

beforeEach(() => {
  contactToReturn = CONTACT;
  editDrawerOpen = false;
});
afterEach(() => cleanup());

async function renderSheet() {
  render(<ContactDetailSheet contactId={CONTACT.id} open onClose={() => {}} />);
  return screen.findByRole('region', { name: 'Resumen del contacto' });
}

describe('Detalle de contacto — cabecera y resumen', () => {
  it('la cabecera lleva el nombre, el estado y la marca de primario', async () => {
    await renderSheet();

    const dialog = screen.getByRole('dialog');
    assert.ok(within(dialog).getByRole('heading', { name: 'Persona Ficticia De Prueba' }));
    assert.equal(within(dialog).getByText('Activo').getAttribute('data-slot'), 'badge');
    assert.ok(within(dialog).getByText('Primario'));
  });

  it('resume lo esencial antes de las pestañas', async () => {
    const summary = await renderSheet();

    assert.equal(
      within(summary).getByRole('link', { name: 'Empresa Ficticia' }).getAttribute('href'),
      '/accounts/00000000-0000-4000-8000-00000000acc1',
    );
    assert.ok(within(summary).getByText('Directora de Talento'));
    assert.ok(within(summary).getByText('Decisor'));
    assert.ok(within(summary).getByText('Director'));
  });

  it('lo que está en el resumen no se repite en las secciones', async () => {
    await renderSheet();

    for (const label of ['Cargo', 'Seniority', 'Rol en la empresa']) {
      assert.equal(screen.getAllByText(label).length, 1, label);
    }
    assert.equal(screen.queryByText('Cargo y función'), null);
    assert.equal(screen.queryByText('Rol en cuenta'), null);
  });

  it('no mete bloques dentro de un párrafo (HTML válido)', async () => {
    await renderSheet();

    for (const paragraph of Array.from(document.querySelectorAll('p'))) {
      assert.equal(paragraph.querySelector('div, p'), null);
    }
  });
});

describe('Detalle de contacto — vacíos que dicen qué hacer', () => {
  it('sin email ni notas lo dice y señala «Editar contacto»', async () => {
    await renderSheet();

    assert.ok(screen.getByText('Sin email. Añádelo con «Editar contacto».'));
    assert.ok(screen.getByText('Sin notas todavía. Añádelas con «Editar contacto».'));
  });

  it('con email lo muestra como enlace', async () => {
    contactToReturn = { ...CONTACT, email: 'persona@ficticia.test' };
    await renderSheet();

    assert.equal(
      screen.getByRole('link', { name: 'persona@ficticia.test' }).getAttribute('href'),
      'mailto:persona@ficticia.test',
    );
    assert.equal(screen.queryByText(/Sin email/), null);
  });
});

describe('Detalle de contacto — pie', () => {
  it('«Más acciones» a la izquierda y «Editar contacto» a la derecha, como primaria', async () => {
    await renderSheet();

    const more = screen.getByRole('button', { name: 'Más acciones' });
    const edit = screen.getByRole('button', { name: 'Editar contacto' });
    assert.equal(edit.getAttribute('data-variant'), 'default');
    assert.ok(more.compareDocumentPosition(edit) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('«Editar contacto» abre el editor', async () => {
    await renderSheet();
    assert.equal(editDrawerOpen, false);

    fireEvent.click(screen.getByRole('button', { name: 'Editar contacto' }));
    assert.equal(editDrawerOpen, true);
  });

  it('el menú del pie no repite «Ver detalle» ni «Editar»: ya estás en el detalle', async () => {
    await renderSheet();

    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));

    assert.ok(await screen.findByRole('menuitem', { name: /Archivar contacto/ }));
    assert.equal(screen.queryByRole('menuitem', { name: /Ver detalle/ }), null);
    assert.equal(screen.queryByRole('menuitem', { name: /Editar/ }), null);
  });
});
