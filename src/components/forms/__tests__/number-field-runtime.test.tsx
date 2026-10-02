/**
 * NumberField (port de Thema) — contrato RUNTIME: flechas, límites, botones,
 * recorte al salir y enlace con `Field`.
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
let NumberField: (typeof import('../number-field'))['NumberField'];
let Field: (typeof import('../field'))['Field'];

const h = React.createElement;

function spy() {
  const calls: Array<number | null> = [];
  const fn = (value: number | null) => {
    calls.push(value);
  };
  return { fn, calls, last: () => calls[calls.length - 1] };
}

before(async () => {
  ({ render, screen, cleanup, fireEvent } = await import('@testing-library/react'));
  ({ NumberField } = await import('../number-field'));
  ({ Field } = await import('../field'));
});

afterEach(() => {
  cleanup();
});

describe('NumberField — teclado', () => {
  it('las flechas suben y bajan el valor según el step', () => {
    const onValueChange = spy();
    render(h(NumberField, { defaultValue: 8, step: 2, onValueChange: onValueChange.fn, 'aria-label': 'Duración' }));
    const input = screen.getByRole('spinbutton', { name: 'Duración' }) as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    assert.equal(onValueChange.last(), 10);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    assert.equal(onValueChange.last(), 6);
    assert.equal(input.value, '6');
  });

  it('PageUp salta diez pasos y no pasa de max', () => {
    const onValueChange = spy();
    render(h(NumberField, { defaultValue: 19, min: 1, max: 20, onValueChange: onValueChange.fn, 'aria-label': 'Cupos' }));
    const input = screen.getByRole('spinbutton', { name: 'Cupos' });

    fireEvent.keyDown(input, { key: 'PageUp' });
    assert.equal(onValueChange.last(), 20);
    assert.equal((screen.getByRole('button', { name: 'Sumar' }) as HTMLButtonElement).disabled, true);
  });
});

describe('NumberField — botones y límites', () => {
  it('Restar baja un paso y Sumar lo sube', () => {
    const onValueChange = spy();
    render(h(NumberField, { defaultValue: 5, min: 1, max: 20, onValueChange: onValueChange.fn, 'aria-label': 'Cupos' }));

    fireEvent.click(screen.getByRole('button', { name: 'Restar' }));
    assert.equal(onValueChange.last(), 4);
    fireEvent.click(screen.getByRole('button', { name: 'Sumar' }));
    assert.equal(onValueChange.last(), 5);
  });

  it('en el mínimo, Restar queda apagado', () => {
    render(h(NumberField, { defaultValue: 1, min: 1, 'aria-label': 'Cupos' }));
    assert.equal((screen.getByRole('button', { name: 'Restar' }) as HTMLButtonElement).disabled, true);
  });

  it('recorta al salir del campo si se escribe fuera de rango', () => {
    const onValueChange = spy();
    render(h(NumberField, { defaultValue: 5, min: 1, max: 20, onValueChange: onValueChange.fn, 'aria-label': 'Cupos' }));
    const input = screen.getByRole('spinbutton', { name: 'Cupos' }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: '99' } });
    assert.equal(onValueChange.last(), 99, 'mientras se escribe no se recorta');
    fireEvent.blur(input);
    assert.equal(input.value, '20');
    assert.equal(onValueChange.last(), 20);
  });

  it('acepta la coma decimal y vacío emite null', () => {
    const onValueChange = spy();
    render(h(NumberField, { defaultValue: 1, step: 0.5, onValueChange: onValueChange.fn, 'aria-label': 'Costo' }));
    const input = screen.getByRole('spinbutton', { name: 'Costo' }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: '3,5' } });
    assert.equal(onValueChange.last(), 3.5);
    fireEvent.change(input, { target: { value: '' } });
    assert.equal(onValueChange.last(), null);
  });

  it('deshabilitado no cambia con el teclado', () => {
    const onValueChange = spy();
    render(h(NumberField, { defaultValue: 5, disabled: true, onValueChange: onValueChange.fn, 'aria-label': 'Cupos' }));

    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Cupos' }), { key: 'ArrowUp' });
    assert.equal(onValueChange.calls.length, 0);
  });

  it('stepper="none" no pinta botones', () => {
    render(h(NumberField, { defaultValue: 5, stepper: 'none', 'aria-label': 'Cupos' }));
    assert.equal(screen.queryByRole('button', { name: 'Sumar' }), null);
  });
});

describe('NumberField — formulario', () => {
  it('no es type="number" y expone los límites al lector de pantalla', () => {
    render(h(NumberField, { defaultValue: 5, min: 1, max: 20, name: 'limit', 'aria-label': 'Cupos' }));
    const input = screen.getByRole('spinbutton', { name: 'Cupos' }) as HTMLInputElement;

    assert.equal(input.type, 'text');
    assert.equal(input.name, 'limit');
    assert.equal(input.getAttribute('aria-valuenow'), '5');
    assert.equal(input.getAttribute('aria-valuemin'), '1');
    assert.equal(input.getAttribute('aria-valuemax'), '20');
  });

  it('dentro de Field, la etiqueta y la ayuda quedan enlazadas al input', () => {
    render(
      React.createElement(
        Field as unknown as React.ComponentType<Record<string, unknown>>,
        { label: 'Límite mensual', description: 'En créditos.' },
        h(NumberField, { defaultValue: 5, name: 'limit' }),
      ),
    );
    const input = screen.getByLabelText('Límite mensual');

    assert.equal(input.getAttribute('role'), 'spinbutton');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    assert.equal(document.getElementById(describedBy)?.textContent, 'En créditos.');
  });

  it('controlado: refleja el valor que llega de fuera', () => {
    const { rerender } = render(h(NumberField, { value: 3, 'aria-label': 'Cupos' }));
    rerender(h(NumberField, { value: 7, 'aria-label': 'Cupos' }));
    assert.equal((screen.getByRole('spinbutton', { name: 'Cupos' }) as HTMLInputElement).value, '7');
  });
});
