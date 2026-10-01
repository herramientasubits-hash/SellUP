/**
 * FilterChips — contrato RUNTIME.
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
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let FilterChips: (typeof import('../filter-chips'))['FilterChips'];

const h = React.createElement;

const OPTIONS = [
  { value: 'all', label: 'Todos', count: 12345 },
  { value: 'review', label: 'En revisión', count: 12 },
  { value: 'approved', label: 'Aprobados', count: 0 },
  { value: 'archived', label: 'Archivados' },
  { value: 'blocked', label: 'Bloqueados', count: 3, disabled: true },
];

function renderChips(value = 'all', onChange: (value: string) => void = () => {}) {
  return render(h(FilterChips, { options: OPTIONS, value, onChange, ariaLabel: 'Filtrar por estado' }));
}

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ FilterChips } = await import('../filter-chips'));
});

afterEach(() => {
  cleanup();
});

describe('FilterChips', () => {
  it('es un radiogroup con el nombre accesible que recibe', () => {
    renderChips();

    assert.ok(screen.getByRole('radiogroup', { name: 'Filtrar por estado' }));
  });

  it('pinta una opción por filtro', () => {
    renderChips();

    assert.equal(within(screen.getByRole('radiogroup')).getAllByRole('radio').length, OPTIONS.length);
  });

  it('solo la opción puesta queda marcada', () => {
    renderChips('review');

    const checked = screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true');
    assert.equal(checked.length, 1);
    assert.match(checked[0].textContent ?? '', /En revisión/);
  });

  it('onChange recibe el valor técnico de la opción pulsada', () => {
    const calls: string[] = [];
    renderChips('all', (value) => calls.push(value));

    fireEvent.click(screen.getByRole('radio', { name: /En revisión/ }));

    assert.deepEqual(calls, ['review']);
  });

  it('pinta el contador de cada opción, con separador de miles', () => {
    renderChips();

    assert.ok(within(screen.getByRole('radio', { name: /Todos/ })).getByText('12.345'));
    assert.ok(within(screen.getByRole('radio', { name: /En revisión/ })).getByText('12'));
  });

  it('una opción sin count no lleva contador', () => {
    renderChips();

    assert.equal(screen.getByRole('radio', { name: /Archivados/ }).textContent, 'Archivados');
  });

  it('una opción deshabilitada no llama onChange', () => {
    const calls: string[] = [];
    renderChips('all', (value) => calls.push(value));
    const blocked = screen.getByRole('radio', { name: /Bloqueados/ }) as HTMLButtonElement;

    fireEvent.click(blocked);

    assert.equal(blocked.disabled, true);
    assert.deepEqual(calls, []);
  });

  it('pinta el título y la pista de la fila', () => {
    render(
      h(FilterChips, {
        options: OPTIONS,
        value: 'all',
        onChange: () => {},
        ariaLabel: 'Filtrar por estado',
        title: 'Estados',
        hint: 'Prospectos que esperan tu decisión',
      }),
    );

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Estados' }));
    assert.ok(screen.getByText('Prospectos que esperan tu decisión'));
  });

  // `OptionTile` sólo pinta `badge` si es truthy. `FilterChips` le pasa el
  // contador ya formateado ("0"), que lo es. Esta prueba fija ese borde: si
  // alguien pasa el número crudo, el cero desaparecería en silencio.
  it('un contador en cero se pinta (no se confunde con «sin contador»)', () => {
    renderChips();

    assert.ok(within(screen.getByRole('radio', { name: /Aprobados/ })).getByText('0'));
  });
});
