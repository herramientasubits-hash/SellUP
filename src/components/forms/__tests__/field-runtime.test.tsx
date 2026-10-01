/**
 * Field — contrato RUNTIME: asociación etiqueta/control, required, descripción y error.
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
let Field: (typeof import('../field'))['Field'];

const h = React.createElement;

/** `createElement` para componentes cuyo `children` es obligatorio en sus props. */
function el<P extends { children?: unknown }>(
  type: React.ComponentType<P>,
  props: Omit<P, 'children'> | null,
  ...children: React.ReactNode[]
): React.ReactElement {
  return React.createElement(type as unknown as React.ComponentType<object>, props, ...children);
}

function describedByText(control: HTMLElement): string[] {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `<<sin elemento #${id}>>`);
}

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ Field } = await import('../field'));
});

afterEach(() => {
  cleanup();
});

describe('Field — etiqueta y control', () => {
  it('asocia la etiqueta a un control que no trae id', () => {
    render(el(Field, { label: 'NIT' }, h('input', { name: 'nit' })));

    const control = screen.getByLabelText('NIT');
    assert.equal(control.tagName, 'INPUT');
    assert.ok(control.id.length > 0);
  });

  it('respeta el id del control y apunta la etiqueta a él', () => {
    render(el(Field, { label: 'NIT' }, h('input', { id: 'nit-propio', name: 'nit' })));

    assert.equal(screen.getByLabelText('NIT').id, 'nit-propio');
  });

  it('dos Field sin id no comparten id', () => {
    render(
      h(
        'form',
        null,
        el(Field, { label: 'NIT' }, h('input', { name: 'nit' })),
        el(Field, { label: 'Razón social' }, h('input', { name: 'name' })),
      ),
    );

    assert.notEqual(screen.getByLabelText('NIT').id, screen.getByLabelText('Razón social').id);
  });

  it('sin label no pinta etiqueta', () => {
    const { container } = render(el(Field, null, h('input', { name: 'nit' })));

    assert.equal(container.querySelector('label'), null);
  });

  it('required pinta el asterisco oculto a lectores de pantalla', () => {
    const { container } = render(el(Field, { label: 'NIT', required: true }, h('input', { name: 'nit' })));

    const mark = container.querySelector('label span') as HTMLElement;
    assert.equal(mark.textContent?.trim(), '*');
    assert.equal(mark.getAttribute('aria-hidden'), 'true');
  });

  it('sin required no hay asterisco', () => {
    const { container } = render(el(Field, { label: 'NIT' }, h('input', { name: 'nit' })));

    assert.equal(container.querySelector('label span'), null);
  });

  it('disabled deshabilita el control', () => {
    render(el(Field, { label: 'NIT', disabled: true }, h('input', { name: 'nit' })));

    assert.equal((screen.getByLabelText('NIT') as HTMLInputElement).disabled, true);
  });
});

describe('Field — descripción y error', () => {
  it('la descripción queda enlazada por aria-describedby', () => {
    render(el(Field, { label: 'NIT', description: 'Sin dígito de verificación.' }, h('input', { name: 'nit' })));

    assert.deepEqual(describedByText(screen.getByLabelText('NIT')), ['Sin dígito de verificación.']);
  });

  it('sin descripción ni error el control no lleva aria-describedby', () => {
    render(el(Field, { label: 'NIT' }, h('input', { name: 'nit' })));

    assert.equal(screen.getByLabelText('NIT').hasAttribute('aria-describedby'), false);
  });

  it('error sustituye a la descripción', () => {
    render(
      el(Field,
        { label: 'NIT', description: 'Sin dígito de verificación.', error: 'El NIT no es válido' },
        h('input', { name: 'nit' }),
      ),
    );

    assert.ok(screen.getByText('El NIT no es válido'));
    assert.equal(screen.queryByText('Sin dígito de verificación.'), null);
  });

  it('el error queda en aria-describedby y la descripción no', () => {
    render(
      el(Field,
        { label: 'NIT', description: 'Sin dígito de verificación.', error: 'El NIT no es válido' },
        h('input', { name: 'nit' }),
      ),
    );

    assert.deepEqual(describedByText(screen.getByLabelText('NIT')), ['El NIT no es válido']);
  });

  it('con id propio, los ids de ayuda y error derivan de él', () => {
    render(el(Field, { label: 'NIT', error: 'Obligatorio' }, h('input', { id: 'nit-propio' })));

    assert.equal(screen.getByLabelText('NIT').getAttribute('aria-describedby'), 'nit-propio-error');
    assert.equal(document.getElementById('nit-propio-error')?.textContent, 'Obligatorio');
  });

  it('conserva el aria-describedby que ya trae el control', () => {
    render(
      h(
        'div',
        null,
        h('p', { id: 'ayuda-externa' }, 'Ayuda externa'),
        el(Field, { label: 'NIT', error: 'Obligatorio' }, h('input', { 'aria-describedby': 'ayuda-externa' })),
      ),
    );

    assert.deepEqual(describedByText(screen.getByLabelText('NIT')), ['Ayuda externa', 'Obligatorio']);
  });

  it('funciona con el Input del sistema', async () => {
    const { Input } = await import('@/components/ui/input');

    render(el(Field, { label: 'Correo', description: 'El de la empresa.' }, h(Input, { type: 'email' })));

    const control = screen.getByLabelText('Correo');
    assert.equal(control.getAttribute('data-slot'), 'input');
    assert.deepEqual(describedByText(control), ['El de la empresa.']);
  });
});
