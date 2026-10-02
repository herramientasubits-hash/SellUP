/**
 * PhoneInput (port de Thema) — contrato RUNTIME: emite E.164, descarta lo que
 * no son dígitos, respeta la longitud del país, no emite al montar y se enlaza
 * con `Field`. Más los dos ayudantes de SellUp para teléfonos ya guardados.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
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

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let PhoneInput: (typeof import('../phone-input'))['PhoneInput'];
let Field: (typeof import('../field'))['Field'];
let countries: typeof import('../phone-countries');

const h = React.createElement;

function spy() {
  const calls: string[] = [];
  const fn = (value: string) => {
    calls.push(value);
  };
  return { fn, calls, last: () => calls[calls.length - 1] };
}

before(async () => {
  ({ render, screen, cleanup, fireEvent, waitFor } = await import('@testing-library/react'));
  ({ PhoneInput } = await import('../phone-input'));
  ({ Field } = await import('../field'));
  countries = await import('../phone-countries');
});

afterEach(() => {
  cleanup();
});

function Controlled({ initial, onValueChange }: { initial: string; onValueChange: (v: string) => void }) {
  const [value, setValue] = React.useState(initial);
  return h(PhoneInput, {
    value,
    onValueChange: (next: string) => {
      setValue(next);
      onValueChange(next);
    },
  });
}

describe('PhoneInput — escritura', () => {
  it('muestra el número nacional agrupado y el prefijo del país', () => {
    const onValueChange = spy();
    render(h(Controlled, { initial: '+573001234567', onValueChange: onValueChange.fn }));
    assert.equal((screen.getByRole('textbox') as HTMLInputElement).value, '300 123 4567');
    assert.match(screen.getByRole('combobox', { name: 'Prefijo de país' }).textContent ?? '', /\+57/);
  });

  it('montar con un valor NO emite: un teléfono que no se toca no se reescribe', () => {
    const onValueChange = spy();
    render(h(Controlled, { initial: '+57 300 123 4567', onValueChange: onValueChange.fn }));
    assert.equal((screen.getByRole('textbox') as HTMLInputElement).value, '300 123 4567');
    assert.deepEqual(onValueChange.calls, []);
  });

  it('emite E.164 al escribir', () => {
    const onValueChange = spy();
    render(h(Controlled, { initial: '', onValueChange: onValueChange.fn }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3101234567' } });
    assert.equal(onValueChange.last(), '+573101234567');
    assert.equal(input.value, '310 123 4567');
  });

  it('descarta lo que no son dígitos y respeta la longitud del país', () => {
    const onValueChange = spy();
    render(h(PhoneInput, { onValueChange: onValueChange.fn, defaultCountry: 'ES' }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '612-345-678999' } });
    assert.equal(onValueChange.last(), '+34612345678');
    assert.equal(input.value, '612 345 678');
  });

  it('borrar todos los dígitos emite cadena vacía, no el prefijo suelto', () => {
    const onValueChange = spy();
    render(h(Controlled, { initial: '+573001234567', onValueChange: onValueChange.fn }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    assert.equal(onValueChange.last(), '');
  });

  it('el país del valor manda sobre el país por defecto', () => {
    render(h(PhoneInput, { value: '+525512345678', defaultCountry: 'CO' }));
    assert.match(screen.getByRole('combobox', { name: 'Prefijo de país' }).textContent ?? '', /\+52/);
    assert.equal((screen.getByRole('textbox') as HTMLInputElement).value, '55 1234 5678');
  });

  it('sin valor, el marcador de posición es el formato del país', () => {
    render(h(PhoneInput, { defaultCountry: 'CO' }));
    assert.equal((screen.getByRole('textbox') as HTMLInputElement).placeholder, '000 000 0000');
  });

  it('disabled apaga el campo y el selector de país', () => {
    render(h(PhoneInput, { disabled: true }));
    assert.equal((screen.getByRole('textbox') as HTMLInputElement).disabled, true);
    const trigger = screen.getByRole('combobox', { name: 'Prefijo de país' });
    assert.ok(trigger.hasAttribute('disabled') || trigger.getAttribute('aria-disabled') === 'true' || trigger.hasAttribute('data-disabled'));
  });
});

describe('PhoneInput — cambio de país', () => {
  it('cambiar de país conserva los dígitos y emite con el prefijo nuevo', async () => {
    const onValueChange = spy();
    render(h(Controlled, { initial: '+573001234567', onValueChange: onValueChange.fn }));

    const trigger = screen.getByRole('combobox', { name: 'Prefijo de país' });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseDown(trigger, { button: 0 });
    fireEvent.click(trigger, { button: 0 });
    const option = await waitFor(() => screen.getByRole('option', { name: /México/ }));
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
    fireEvent.mouseUp(option, { button: 0 });
    fireEvent.click(option, { button: 0 });

    await waitFor(() => assert.equal(onValueChange.last(), '+523001234567'));
    assert.equal((screen.getByRole('textbox') as HTMLInputElement).value, '30 0123 4567');
  });
});

describe('PhoneInput — dentro de Field', () => {
  it('la etiqueta apunta al campo del número', () => {
    render(h(Field, { label: 'Teléfono', description: 'Con prefijo.', children: h(PhoneInput, {}) }));
    const input = screen.getByLabelText('Teléfono') as HTMLInputElement;
    assert.equal(input.type, 'tel');
    assert.ok(input.getAttribute('aria-describedby'));
  });
});

describe('teléfonos ya guardados', () => {
  it('canEditAsE164: vacío y E.164 de un país de la lista sí', () => {
    assert.equal(countries.canEditAsE164(''), true);
    assert.equal(countries.canEditAsE164('+573001234567'), true);
    assert.equal(countries.canEditAsE164('+57 300 123 4567'), true);
    assert.equal(countries.canEditAsE164('+1 (415) 555-0100'), true);
  });

  it('canEditAsE164: lo que el campo cortaría o no sabría leer, no', () => {
    assert.equal(countries.canEditAsE164('3001234567'), false, 'sin prefijo');
    assert.equal(countries.canEditAsE164('+44 20 7946 0958'), false, 'país fuera de la lista');
    assert.equal(countries.canEditAsE164('+57 601 234 5678 ext. 12'), false, 'extensión');
    assert.equal(countries.canEditAsE164('+54 9 11 1234 5678'), false, 'más dígitos que el país');
    assert.equal(countries.canEditAsE164('+57'), false, 'solo prefijo');
  });

  it('isSamePhoneNumber ignora espacios y guiones, no dígitos', () => {
    assert.equal(countries.isSamePhoneNumber('+573001234567', '+57 300 123-4567'), true);
    assert.equal(countries.isSamePhoneNumber('+573001234567', '+573001234568'), false);
    assert.equal(countries.isSamePhoneNumber('', ''), false);
  });
});
