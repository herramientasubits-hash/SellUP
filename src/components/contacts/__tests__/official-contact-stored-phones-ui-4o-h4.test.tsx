/**
 * Tests UI — «Ver más números» del contacto OFICIAL
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-H4)
 *
 * Render real de React (jsdom + @testing-library/react) de la ficha COMPLETA del
 * contacto, no de un componente aislado: lo que hay que demostrar es que el CTA
 * aparece —y sólo aparece— dentro de la pantalla real, junto a los escalares que ya
 * se mostraban, y que pulsarlo no dispara ninguna de las acciones que cuestan
 * dinero ni ninguna de las que escriben.
 *
 * Por eso los mocks de HubSpot y de la escritura de contactos están puestos aunque
 * ningún caso los use: si estuvieran ausentes, «no se escribió nada» sería una
 * afirmación sobre un módulo que no existe en el test. Estando presentes, la
 * aserción `callCount() === 0` es una afirmación sobre el camino real.
 *
 * NO toca el servidor, NO llama proveedores, NO escribe en DB y NO revela teléfonos
 * reales: los server actions están mockeados y los números son ficticios.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que los tests 3D.4 / CACHE-1b / 4O-G) ──────

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
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Contact } from '@/modules/contacts/types';
import type { StoredOfficialPhonesResult } from '@/modules/contact-enrichment/official-contact-stored-phones-actions';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let within: (typeof import('@testing-library/react'))['within'];

// ── Mocks de boundary ────────────────────────────────────────────────────────

const mockGetContactById = mock.fn<() => Promise<Contact | null>>();
const mockGetContactAudit = mock.fn<() => Promise<unknown[]>>();
const mockGetAccountById = mock.fn<() => Promise<unknown>>();

/** Las dos lecturas del hito. */
const mockStoredSummary = mock.fn<() => Promise<{ additionalCount: number }>>();
const mockStoredPhones = mock.fn<() => Promise<StoredOfficialPhonesResult>>();

/** Todo lo que ESCRIBE. Ningún caso de este archivo puede hacer que se llamen. */
const mockUpdateContact = mock.fn<() => Promise<unknown>>();
const mockArchiveContact = mock.fn<() => Promise<unknown>>();
const mockSetPrimaryContact = mock.fn<() => Promise<unknown>>();
const mockChangeStatus = mock.fn<() => Promise<unknown>>();
const mockSyncHubSpot = mock.fn<() => Promise<unknown>>();

const WRITE_MOCKS: readonly (readonly [string, { mock: { callCount(): number } }])[] = [
  ['updateContact', mockUpdateContact],
  ['archiveContact', mockArchiveContact],
  ['setPrimaryContact', mockSetPrimaryContact],
  ['changeContactStatus', mockChangeStatus],
  ['syncContactToHubSpot', mockSyncHubSpot],
];

mock.module('@/modules/contacts/actions', {
  namedExports: {
    getContactById: (...args: unknown[]) => mockGetContactById(...(args as [])),
    getContactAudit: (...args: unknown[]) => mockGetContactAudit(...(args as [])),
    updateContact: (...args: unknown[]) => mockUpdateContact(...(args as [])),
    archiveContact: (...args: unknown[]) => mockArchiveContact(...(args as [])),
    setPrimaryContact: (...args: unknown[]) => mockSetPrimaryContact(...(args as [])),
    changeContactStatus: (...args: unknown[]) => mockChangeStatus(...(args as [])),
    syncContactToHubSpot: (...args: unknown[]) => mockSyncHubSpot(...(args as [])),
  },
});

mock.module('@/modules/accounts/actions', {
  namedExports: {
    getAccountById: (...args: unknown[]) => mockGetAccountById(...(args as [])),
  },
});

mock.module('@/modules/contact-enrichment/official-contact-stored-phones-actions', {
  namedExports: {
    getOfficialContactStoredPhoneSummaryAction: (...args: unknown[]) =>
      mockStoredSummary(...(args as [])),
    getOfficialContactStoredPhonesAction: (...args: unknown[]) =>
      mockStoredPhones(...(args as [])),
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

let ContactDetailSheet: (typeof import('../contact-detail-sheet'))['ContactDetailSheet'];

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SCALAR_PHONE = '+57 601 111 2222';
const SCALAR_MOBILE = '+57 300 111 2222';
const EXTRA_MOBILE = '+57 300 444 5555';
const EXTRA_WORK = '+57 601 777 8888';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-4o-h4',
    account_id: 'acct-1',
    first_name: 'Nombre',
    last_name: 'Apellido',
    full_name: 'Nombre Apellido',
    email: 'contacto@empresa-ejemplo.test',
    phone: SCALAR_PHONE,
    mobile_phone: SCALAR_MOBILE,
    linkedin_url: null,
    job_title: 'Gerente Comercial',
    department: null,
    seniority: null,
    role_in_account: null,
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
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    archived_at: null,
    archived_by: null,
    ...overrides,
  } as Contact;
}

function renderSheet() {
  return render(
    React.createElement(ContactDetailSheet, {
      contactId: 'contact-4o-h4',
      open: true,
      onClose: () => {},
    }),
  );
}

/** Espera a que la ficha termine de cargar. */
async function waitForLoaded() {
  await waitFor(() => {
    assert.ok(screen.getByText('Nombre Apellido'));
  });
}

function ctaButton() {
  return screen.queryByRole('button', { name: /Ver \d+ números? más/ });
}

/** El panel desplegado, localizado por el `aria-controls` del propio disclosure. */
function openPanel(): HTMLElement {
  const collapse = screen.getByRole('button', { name: /Ocultar números adicionales/ });
  const panelId = collapse.getAttribute('aria-controls');
  assert.ok(panelId, 'el disclosure debe declarar aria-controls');
  const panel = document.getElementById(panelId);
  assert.ok(panel, 'el panel referenciado debe existir');
  return panel;
}

/** Ninguna escritura, en ningún caso de este archivo. */
function assertNoWrites() {
  for (const [label, spy] of WRITE_MOCKS) {
    assert.equal(spy.mock.callCount(), 0, `${label} no debe llamarse al ver números`);
  }
}

// ── Ciclo de vida ────────────────────────────────────────────────────────────

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  waitFor = rtl.waitFor;
  fireEvent = rtl.fireEvent;
  cleanup = rtl.cleanup;
  within = rtl.within;
  ({ ContactDetailSheet } = await import('../contact-detail-sheet'));
});

beforeEach(() => {
  // Cada caso monta la ficha entera. Sin desmontar la anterior, el drawer previo
  // sigue en el DOM y las consultas encuentran dos veces al mismo contacto.
  cleanup?.();
  for (const spy of [
    mockGetContactById,
    mockGetContactAudit,
    mockGetAccountById,
    mockStoredSummary,
    mockStoredPhones,
    mockUpdateContact,
    mockArchiveContact,
    mockSetPrimaryContact,
    mockChangeStatus,
    mockSyncHubSpot,
  ]) {
    spy.mock.resetCalls();
  }
  mockGetContactById.mock.mockImplementation(async () => makeContact());
  mockGetContactAudit.mock.mockImplementation(async () => []);
  mockGetAccountById.mock.mockImplementation(async () => null);
  mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 0 }));
  mockStoredPhones.mock.mockImplementation(async () => ({ status: 'ok', phones: [] }));
});

after(() => {
  cleanup?.();
});

// ═══════════════════════════════════════════════════════════════
// 1. Cuándo existe el CTA
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 UI — el CTA existe sólo si hay extras', () => {
  it('0 extras: no se pinta ningún CTA, y no se piden números', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 0 }));
    renderSheet();
    await waitForLoaded();

    assert.equal(ctaButton(), null, 'sin extras no debe haber botón');
    assert.equal(
      mockStoredPhones.mock.callCount(),
      0,
      'ningún número puede viajar al navegador sin que el operador lo pida',
    );
    assertNoWrites();
  });

  it('1 extra: el CTA usa el singular', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    renderSheet();
    await waitForLoaded();

    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: /Ver 1 número más/ }));
    });
    assertNoWrites();
  });

  it('N extras: el CTA dice cuántos', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 3 }));
    renderSheet();
    await waitForLoaded();

    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: /Ver 3 números más/ }));
    });
    assertNoWrites();
  });

  it('los escalares que ya se mostraban siguen visibles junto al CTA', async () => {
    // Este hito AÑADE una superficie de lectura; no reemplaza ninguna.
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 2 }));
    renderSheet();
    await waitForLoaded();

    assert.ok(screen.getByText(SCALAR_PHONE), '`contacts.phone` sigue a la vista');
    assert.ok(screen.getByText(SCALAR_MOBILE), 'el escalar de móvil sigue a la vista');
    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: /Ver 2 números más/ }));
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Abrir: qué se muestra y qué NO se llama
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 UI — abrir el disclosure lee, y nada más', () => {
  async function openWith(phones: StoredOfficialPhonesResult) {
    mockStoredSummary.mock.mockImplementation(async () => ({
      additionalCount: phones.status === 'ok' ? Math.max(phones.phones.length, 1) : 1,
    }));
    mockStoredPhones.mock.mockImplementation(async () => phones);
    renderSheet();
    await waitForLoaded();
    const cta = await waitFor(() => {
      const button = ctaButton();
      assert.ok(button);
      return button;
    });
    fireEvent.click(cta);
  }

  it('muestra número, tipo y fuentes; cero escrituras y cero proveedores', async () => {
    await openWith({
      status: 'ok',
      phones: [
        {
          id: 'p2',
          number: EXTRA_MOBILE,
          type: 'mobile',
          isPrimary: false,
          sources: ['apollo_reveal'],
        },
      ],
    });

    await waitFor(() => {
      assert.ok(screen.getByText(EXTRA_MOBILE));
    });
    assert.ok(screen.getByText('Móvil'), 'el tipo se rotula con la tabla compartida');
    assert.ok(screen.getByText('Apollo reveal'), 'la procedencia se rotula');
    assert.equal(mockStoredPhones.mock.callCount(), 1, 'exactamente UNA lectura');
    assertNoWrites();
  });

  it('cross-provider: UN número con DOS fuentes en la misma línea', async () => {
    await openWith({
      status: 'ok',
      phones: [
        {
          id: 'p2',
          number: EXTRA_WORK,
          type: 'work',
          isPrimary: false,
          sources: ['apollo_reveal', 'lusha_reveal'],
        },
      ],
    });

    await waitFor(() => {
      assert.ok(screen.getByText(EXTRA_WORK));
    });
    assert.ok(screen.getByText('Apollo reveal · Lusha reveal'));
    // Y sigue siendo UNA fila, no dos.
    assert.equal(screen.getAllByText(EXTRA_WORK).length, 1);
    assertNoWrites();
  });

  it('manual y desconocida se rotulan sin asimilarse a un proveedor', async () => {
    await openWith({
      status: 'ok',
      phones: [
        { id: 'p2', number: EXTRA_MOBILE, type: null, isPrimary: false, sources: ['manual'] },
        { id: 'p3', number: EXTRA_WORK, type: null, isPrimary: false, sources: ['unknown'] },
      ],
    });

    await waitFor(() => {
      assert.ok(screen.getByText(EXTRA_MOBILE));
    });

    // Se consulta DENTRO del panel: la ficha ya rotula «Manual» en otro sitio (el
    // origen del contacto), y una aserción global confundiría los dos hechos.
    const panel = within(openPanel());
    assert.ok(panel.getByText('Manual'));
    assert.ok(panel.getByText('Fuente desconocida'));
    // Sin tipo declarado, se dice explícitamente en vez de inventarlo.
    assert.equal(panel.getAllByText('Tipo desconocido').length, 2);
    assertNoWrites();
  });

  it('lista vacía al abrir (una supresión entre el render y el clic) no es un error', async () => {
    await openWith({ status: 'ok', phones: [] });

    await waitFor(() => {
      assert.ok(screen.getByText('No hay otros números disponibles.'));
    });
    assertNoWrites();
  });

  it('un fallo de LECTURA se queda en un fallo de lectura: no hay camino a un proveedor', async () => {
    await openWith({ status: 'unavailable' });

    await waitFor(() => {
      assert.ok(screen.getByText('No pudimos cargar los números adicionales.'));
    });
    // Sin reintento automático y, sobre todo, sin ninguna llamada que gaste.
    assert.equal(mockStoredPhones.mock.callCount(), 1);
    assertNoWrites();
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Abrir / cerrar / reabrir
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 UI — abrir, cerrar y reabrir', () => {
  it('cerrar OLVIDA lo leído, y reabrir vuelve a preguntar — sin proveedor jamás', async () => {
    // La propiedad que hace que una DSAR aplicada entre medias surta efecto sin
    // tiempo real. Y las tres interacciones juntas siguen sin escribir ni gastar.
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    mockStoredPhones.mock.mockImplementation(async () => ({
      status: 'ok',
      phones: [
        {
          id: 'p2',
          number: EXTRA_MOBILE,
          type: 'mobile',
          isPrimary: false,
          sources: ['lusha_reveal'],
        },
      ],
    }));

    renderSheet();
    await waitForLoaded();

    const cta = await waitFor(() => {
      const button = ctaButton();
      assert.ok(button);
      return button;
    });

    fireEvent.click(cta);
    await waitFor(() => {
      assert.ok(screen.getByText(EXTRA_MOBILE));
    });
    assert.equal(mockStoredPhones.mock.callCount(), 1);

    const collapse = screen.getByRole('button', { name: /Ocultar números adicionales/ });
    assert.equal(collapse.getAttribute('aria-expanded'), 'true');
    fireEvent.click(collapse);

    await waitFor(() => {
      assert.equal(screen.queryByText(EXTRA_MOBILE), null, 'al cerrar, el número se olvida');
    });

    const reopened = await waitFor(() => {
      const button = ctaButton();
      assert.ok(button);
      return button;
    });
    fireEvent.click(reopened);
    await waitFor(() => {
      assert.ok(screen.getByText(EXTRA_MOBILE));
    });

    assert.equal(
      mockStoredPhones.mock.callCount(),
      2,
      'reabrir vuelve a LEER — nunca a buscar',
    );
    assertNoWrites();
  });

  it('el disclosure es accesible por teclado: aria-expanded y aria-controls', async () => {
    mockStoredSummary.mock.mockImplementation(async () => ({ additionalCount: 1 }));
    renderSheet();
    await waitForLoaded();

    const cta = await waitFor(() => {
      const button = ctaButton();
      assert.ok(button);
      return button;
    });
    assert.equal(cta.getAttribute('aria-expanded'), 'false');
    const controls = cta.getAttribute('aria-controls');
    assert.ok(controls, 'debe apuntar al panel');

    fireEvent.click(cta);
    await waitFor(() => {
      assert.ok(document.getElementById(controls));
    });
  });
});
