/**
 * UX-EMPRESAS-CONTACTOS — la tabla «Contactos» (ContactsDataTableClient) como
 * se usa: indicadores que filtran, vacíos que dicen qué hacer, archivar con un
 * diálogo del sistema (ya no `window.confirm`) y vista «Lista».
 *
 * Las acciones de servidor y los drawers son dobles: sin red ni base de datos.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test has no DOM environment) ────────────────────────
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
import type { ContactListItem } from '@/modules/contacts/actions';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});

const archived: string[] = [];
const statusChanges: Array<{ id: string; status: string }> = [];
mock.module('@/modules/contacts/actions', {
  namedExports: {
    setPrimaryContact: async () => ({ success: true }),
    changeContactStatus: async (id: string, status: string) => {
      statusChanges.push({ id, status });
      return { success: true };
    },
    archiveContact: async (id: string) => {
      archived.push(id);
      return { success: true };
    },
  },
});

let detailOpenFor: string | null = null;
mock.module('@/components/contacts/contact-detail-sheet', {
  namedExports: {
    ContactDetailSheet: (props: { contactId: string | null; open: boolean }) => {
      detailOpenFor = props.open ? props.contactId : null;
      return null;
    },
  },
});
mock.module('@/components/contacts/edit-contact-drawer', {
  namedExports: { EditContactDrawer: () => null },
});

let ContactsDataTableClient: (typeof import('../contacts-data-table-client'))['ContactsDataTableClient'];
let NavAccessProvider: (typeof import('@/components/layout/nav-access-context'))['NavAccessProvider'];

function contact(overrides: Partial<ContactListItem>): ContactListItem {
  return {
    id: 'c',
    account_id: 'acc-1',
    account_name: 'Acme',
    first_name: null,
    last_name: null,
    full_name: 'Ana Ruiz',
    email: 'ana@acme.co',
    phone: null,
    mobile_phone: null,
    linkedin_url: null,
    job_title: 'Directora de Talento',
    department: null,
    seniority: 'director',
    role_in_account: 'decision_maker',
    contact_status: 'active',
    source: 'manual',
    hubspot_contact_id: null,
    email_confidence: null,
    phone_confidence: null,
    phone_type: null,
    phone_source: null,
    phone_raw_type: null,
    phone_revealed_at: null,
    phone_processing_basis: null,
    is_primary: false,
    notes: null,
    metadata: {},
    created_by: null,
    updated_by: null,
    created_at: '2026-01-10T15:00:00.000Z',
    updated_at: '2026-01-10T15:00:00.000Z',
    archived_at: null,
    archived_by: null,
    ...overrides,
  } as ContactListItem;
}

const CONTACTS = [
  contact({ id: 'c1', full_name: 'Ana Ruiz', role_in_account: 'decision_maker', is_primary: true }),
  contact({ id: 'c2', full_name: 'Beto Gil', role_in_account: 'champion', email: null, job_title: null, seniority: null }),
  contact({ id: 'c3', full_name: 'Carla Paz', role_in_account: null, contact_status: 'inactive' }),
];

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ContactsDataTableClient } = await import('../contacts-data-table-client'));
  ({ NavAccessProvider } = await import('@/components/layout/nav-access-context'));
});

beforeEach(() => {
  archived.length = 0;
  statusChanges.length = 0;
  detailOpenFor = null;
  window.localStorage.clear();
});

/** «Menú en cada fila» (Configurar tabla): las mismas entradas que el clic derecho. */
function enableRowMenus(): void {
  window.localStorage.setItem('sellup:table:contacts', JSON.stringify({ rowControl: 'menu' }));
}
afterEach(() => cleanup());

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((row) => row.querySelector('button[title]')?.textContent ?? '')
    .filter(Boolean);
}

function indicators(): HTMLElement {
  return screen.getByRole('group', { name: 'Indicadores de contactos' });
}

function renderTable(contacts: ContactListItem[] = CONTACTS, access = { isAdmin: false, roleKey: 'seller_bd' }) {
  return render(
    <NavAccessProvider value={access}>
      <ContactsDataTableClient contacts={contacts} />
    </NavAccessProvider>,
  );
}

const ADMIN_ACCESS = { isAdmin: true, roleKey: 'admin' };

describe('Contactos — los indicadores son filtros de un toque', () => {
  it('decisores, champions y primarios, con su recuento', () => {
    renderTable();

    const group = within(indicators());
    assert.match(group.getByRole('button', { name: /Decisores/ }).textContent ?? '', /1/);
    assert.match(group.getByRole('button', { name: /Champions/ }).textContent ?? '', /1/);
    assert.match(group.getByRole('button', { name: /Primarios/ }).textContent ?? '', /1/);
  });

  it('pulsar «Champions» deja solo esos contactos; otra vez, todos', () => {
    renderTable();
    const button = () => within(indicators()).getByRole('button', { name: /Champions/ });

    fireEvent.click(button());
    assert.deepEqual(rowNames(), ['Beto Gil']);
    assert.equal(button().getAttribute('aria-pressed'), 'true');

    fireEvent.click(button());
    assert.equal(rowNames().length, 3);
  });
});

describe('Contactos — vacíos y celdas', () => {
  it('sin contactos no repite las acciones de la pantalla («Buscar contactos» y «Crear contacto» ya están)', () => {
    renderTable([]);

    const empty = screen.getByText('Todavía no hay contactos').closest('[data-slot="empty"]') as HTMLElement;
    assert.equal(within(empty).queryAllByRole('button').length, 0);
  });

  it('lo que falta es siempre una raya con nombre', () => {
    renderTable();

    for (const label of ['Sin email', 'Sin cargo', 'Sin rol']) {
      assert.ok(screen.getAllByText(label).length >= 1, label);
    }
  });

  it('solo el estado va en chip; el rol es texto y el primario lleva su marca', () => {
    renderTable();

    const row = screen.getByRole('button', { name: 'Ana Ruiz' }).closest('tr');
    assert.ok(row);
    assert.equal(row.querySelectorAll('[data-slot="badge"]').length, 1);
    assert.equal(within(row).getByText('Activo').getAttribute('data-slot'), 'badge');
    assert.ok(within(row).getByText('Decisor'));
    assert.ok(within(row).getByRole('img', { name: 'Contacto primario' }));
  });

  it('el nombre abre el detalle', () => {
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Carla Paz' }));
    assert.equal(detailOpenFor, 'c3');
  });
});

describe('Contactos — archivar pide confirmación en un diálogo del sistema', () => {
  async function openArchiveFor(name: string) {
    fireEvent.click(screen.getByRole('button', { name: `Acciones de ${name}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archivar contacto' }));
    // `ConfirmDialog` es un diálogo de alerta (pide una decisión antes de seguir).
    return screen.findByRole('alertdialog');
  }

  it('no usa window.confirm y no archiva hasta que se confirma', async () => {
    let nativeConfirms = 0;
    (window as unknown as { confirm: () => boolean }).confirm = () => {
      nativeConfirms += 1;
      return true;
    };
    enableRowMenus();
    renderTable(CONTACTS, ADMIN_ACCESS);

    const dialog = await openArchiveFor('Ana Ruiz');

    assert.equal(nativeConfirms, 0);
    assert.deepEqual(archived, [], 'abrir el diálogo no archiva');
    assert.ok(within(dialog).getByText(/Ana Ruiz dejará de aparecer en la lista/));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Archivar contacto' }));
    await waitFor(() => assert.deepEqual(archived, ['c1']));
  });

  it('cancelar no archiva', async () => {
    enableRowMenus();
    renderTable(CONTACTS, ADMIN_ACCESS);

    const dialog = await openArchiveFor('Beto Gil');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null));
    assert.deepEqual(archived, []);
  });
  it('archivar es sólo de admin: a un no admin ni se le ofrece', async () => {
    enableRowMenus();
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Ana Ruiz' }));
    await screen.findAllByRole('menuitem');
    assert.equal(screen.queryByRole('menuitem', { name: 'Archivar contacto' }), null);
  });
});

describe('Contactos — el menú dice a qué estado pasa', () => {
  it('una entrada por estado posible, nunca el actual', async () => {
    enableRowMenus();
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Carla Paz' }));

    const target = await screen.findByRole('menuitem', { name: 'Marcar como «Activo»' });
    assert.ok(screen.getByRole('menuitem', { name: 'Marcar como «No contactar»' }));
    assert.equal(screen.queryByRole('menuitem', { name: 'Marcar como «Inactivo»' }), null);
    assert.equal(screen.queryByRole('menuitem', { name: 'Cambiar estado' }), null);

    fireEvent.click(target);
    await waitFor(() => assert.deepEqual(statusChanges, [{ id: 'c3', status: 'active' }]));
  });
});

describe('Contactos — vista «Lista»', () => {
  it('pinta cada contacto como fila de lista con su estado', () => {
    window.localStorage.setItem('sellup:table:contacts', JSON.stringify({ view: 'list' }));
    renderTable();

    assert.equal(document.querySelector('table'), null);
    const items = screen.getAllByRole('listitem');
    assert.equal(items.length, 3);
    const first = within(items[0]);
    assert.ok(first.getByRole('button', { name: 'Ana Ruiz' }));
    assert.ok(first.getByText('Directora de Talento · Acme · ana@acme.co'));
    assert.ok(first.getByText('Activo'));
  });
});

describe('Contactos — columnas del contacto y su empresa (AGENT2-CONTACTS-TABLE-COLUMNS)', () => {
  const PORTAL = '123456';
  const ENRICHED = [
    contact({
      id: 'h1',
      full_name: 'Ana Ruiz',
      hubspot_contact_id: '987001',
      linkedin_url: 'https://www.linkedin.com/in/ana-ruiz',
      department: 'Recursos Humanos',
      seniority: 'director',
      source: 'apollo',
      account_country: 'Colombia',
      account_domain: 'acme.co',
      account_website: 'https://www.acmegroup.co/',
      account_hubspot_company_id: '555001',
    }),
    contact({ id: 'h2', full_name: 'Beto Gil', seniority: null, source: 'manual' }),
  ];

  function headers(): string[] {
    return Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
  }

  function renderEnriched() {
    return render(<ContactsDataTableClient contacts={ENRICHED} hubspotPortalId={PORTAL} />);
  }

  it('de entrada sólo suma «Contacto en HubSpot»; las demás se piden desde «Configurar tabla»', () => {
    renderEnriched();

    const visible = headers();
    assert.ok(visible.some((h) => h.includes('Contacto en HubSpot')), 'se ve de entrada');
    for (const hidden of [
      'LinkedIn',
      'Departamento',
      'Seniority',
      'Fuente',
      'Creado',
      'País',
      'Dominio de la empresa',
      'Página web de la empresa',
      'Empresa en HubSpot',
    ]) {
      assert.ok(!visible.some((h) => h === hidden || h.startsWith(hidden)), `${hidden} arranca oculta`);
    }
  });

  it('el ID de HubSpot abre el contacto en HubSpot en otra pestaña, sin abrir la ficha', () => {
    renderEnriched();

    const link = screen.getByRole('link', { name: /Abrir Ana Ruiz en HubSpot/ });
    assert.equal(link.getAttribute('href'), `https://app.hubspot.com/contacts/${PORTAL}/contact/987001`);
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.textContent?.includes('987001'), true);

    fireEvent.click(link);
    assert.equal(detailOpenFor, null, 'el clic en el enlace no abre el detalle');

    const otherRow = screen.getByRole('button', { name: 'Beto Gil' }).closest('tr');
    assert.ok(otherRow);
    assert.ok(within(otherRow).getByText('No está en HubSpot'));
  });

  it('con todas las columnas a la vista: datos del contacto y de su empresa', () => {
    window.localStorage.setItem('sellup:table:contacts', JSON.stringify({ hidden: [] }));
    renderEnriched();

    const row = within(screen.getByRole('button', { name: 'Ana Ruiz' }).closest('tr') as HTMLElement);
    assert.equal(
      row.getByRole('link', { name: /Abrir el LinkedIn de Ana Ruiz/ }).getAttribute('href'),
      'https://www.linkedin.com/in/ana-ruiz',
    );
    assert.ok(row.getByText('Recursos Humanos'));
    assert.ok(row.getByText('Director'));
    assert.ok(row.getByText('Apollo'));
    assert.ok(row.getByText('Colombia'));
    assert.ok(row.getByText('acme.co'));
    assert.equal(
      row.getByRole('link', { name: /Abrir la página web de Acme/ }).getAttribute('href'),
      'https://www.acmegroup.co/',
    );
    assert.ok(row.getByText('acmegroup.co'), 'la web se lee sin protocolo ni «www.»');
    assert.equal(
      row.getByRole('link', { name: /Abrir Acme en HubSpot/ }).getAttribute('href'),
      `https://app.hubspot.com/contacts/${PORTAL}/company/555001`,
    );

    const empty = within(screen.getByRole('button', { name: 'Beto Gil' }).closest('tr') as HTMLElement);
    for (const label of ['Sin LinkedIn', 'Sin departamento', 'Sin seniority', 'Sin país', 'Sin dominio', 'Sin página web', 'No existe en HubSpot']) {
      assert.ok(empty.getByText(label), label);
    }
  });
});
