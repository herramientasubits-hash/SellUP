/**
 * EditContactDrawer — contrato RUNTIME del teléfono.
 *
 * `updateContact` decide la procedencia de `contacts.phone` comparando lo que
 * llega con lo guardado: si el formulario reenvía los MISMOS bytes, la
 * procedencia del proveedor sobrevive. Por eso el campo con prefijo de país
 * (`PhoneInput`) no puede reescribir un teléfono que nadie tocó, ni uno que se
 * tocó y se dejó igual, ni mostrar cortado uno que no sabe leer.
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

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) },
});
mock.module('sonner', {
  namedExports: { toast: { success: () => {}, error: () => {} } },
});

const updateCalls: Array<{ id: string; input: Record<string, unknown> }> = [];
mock.module('@/modules/contacts/actions', {
  namedExports: {
    updateContact: async (id: string, input: Record<string, unknown>) => {
      updateCalls.push({ id, input });
      return { success: true };
    },
  },
});

let EditContactDrawer: (typeof import('../edit-contact-drawer'))['EditContactDrawer'];
type Contact = Parameters<typeof EditContactDrawer>[0]['contact'];

const h = React.createElement;

function contact(overrides: Record<string, unknown>): Contact {
  return {
    id: 'c-1',
    account_id: 'a-1',
    first_name: 'Ana',
    last_name: 'Ruiz',
    full_name: 'Ana Ruiz',
    email: 'ana@acme.co',
    phone: null,
    mobile_phone: null,
    linkedin_url: null,
    job_title: 'CHRO',
    department: null,
    seniority: null,
    role_in_account: null,
    contact_status: 'active',
    is_primary: false,
    notes: null,
    ...overrides,
  } as unknown as Contact;
}

async function save() {
  const form = document.getElementById('edit-contact-form') as HTMLFormElement;
  fireEvent.submit(form);
  await waitFor(() => assert.equal(updateCalls.length, 1));
  return updateCalls[0].input;
}

function open(c: Contact) {
  render(h(EditContactDrawer, { contact: c, open: true, onClose: () => {} }));
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ EditContactDrawer } = await import('../edit-contact-drawer'));
});

beforeEach(() => {
  updateCalls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('EditContactDrawer — el teléfono guardado no se reescribe solo', () => {
  it('un teléfono que no se toca se envía idéntico, byte a byte', async () => {
    open(contact({ phone: '+57 300 123 4567', mobile_phone: '+52 (55) 1234-5678' }));
    const phone = screen.getByLabelText('Teléfono') as HTMLInputElement;
    assert.equal(phone.value, '300 123 4567', 'se muestra el número nacional agrupado');

    const input = await save();
    assert.equal(input.phone, '+57 300 123 4567');
    assert.equal(input.mobile_phone, '+52 (55) 1234-5678');
  });

  it('tocar y dejar el mismo número conserva el texto guardado', async () => {
    open(contact({ phone: '+57 300 123 4567' }));
    const phone = screen.getByLabelText('Teléfono') as HTMLInputElement;
    fireEvent.change(phone, { target: { value: '300 123 4568' } });
    fireEvent.change(phone, { target: { value: '300 123 4567' } });

    const input = await save();
    assert.equal(input.phone, '+57 300 123 4567');
  });

  it('un número distinto se envía en E.164', async () => {
    open(contact({ phone: '+57 300 123 4567' }));
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '310 555 0000' } });

    const input = await save();
    assert.equal(input.phone, '+573105550000');
  });

  it('borrar el número lo envía vacío (undefined), como antes', async () => {
    open(contact({ phone: '+57 300 123 4567' }));
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '' } });

    const input = await save();
    assert.equal(input.phone, undefined);
  });

  it('un teléfono que el campo con prefijo cortaría se edita como texto y sale idéntico', async () => {
    open(contact({ phone: '601 234 5678 ext. 12', mobile_phone: '+44 20 7946 0958' }));
    const phone = screen.getByLabelText('Teléfono') as HTMLInputElement;
    const mobile = screen.getByLabelText('Celular') as HTMLInputElement;
    assert.equal(phone.value, '601 234 5678 ext. 12', 'se muestra entero, sin recortar');
    assert.equal(mobile.value, '+44 20 7946 0958');
    assert.equal(screen.queryByRole('combobox', { name: 'Prefijo de país' }), null);

    const input = await save();
    assert.equal(input.phone, '601 234 5678 ext. 12');
    assert.equal(input.mobile_phone, '+44 20 7946 0958');
  });

  it('sin teléfono guardado, ofrece el campo con prefijo de país', () => {
    open(contact({}));
    assert.equal(screen.getAllByRole('combobox', { name: 'Prefijo de país' }).length, 2);
  });
});
