/**
 * CheckboxFilterButton — contrato RUNTIME: un botón que dice cuántas opciones
 * hay elegidas, abre una lista con casillas y recuentos, permite marcar varias,
 * deja las opciones con 0 apagadas pero elegibles y limpia de una vez.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let CheckboxFilterButton: (typeof import('../checkbox-filter-button'))['CheckboxFilterButton'];

const h = React.createElement;

const OPTIONS = [
  { value: 'a', label: 'Alfa', count: 3 },
  { value: 'b', label: 'Beta', count: 0 },
  { value: 'c', label: 'Gamma', count: 12 },
];

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ CheckboxFilterButton } = await import('../checkbox-filter-button'));
});

afterEach(() => {
  cleanup();
});

function Harness({ initial = [], log }: { initial?: string[]; log: string[][] }) {
  const [selected, setSelected] = React.useState<string[]>(initial);
  return h(CheckboxFilterButton, {
    label: 'Etapa',
    options: OPTIONS,
    selected,
    onChange: (next: string[]) => {
      log.push(next);
      setSelected(next);
    },
  });
}

describe('CheckboxFilterButton', () => {
  it('sin selección el botón dice solo el nombre; con selección, cuántas', () => {
    const { rerender } = render(h(Harness, { log: [] }));
    assert.ok(screen.getByRole('button', { name: 'Etapa' }));

    rerender(h(Harness, { log: [], initial: ['a', 'c'] }));
    cleanup();
    render(h(Harness, { log: [], initial: ['a', 'c'] }));
    assert.ok(screen.getByRole('button', { name: 'Etapa · 2' }));
  });

  it('abre la lista con una casilla y un recuento por opción', async () => {
    render(h(Harness, { log: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Etapa' }));

    const list = await screen.findByRole('list', { name: 'Filtrar por Etapa' });
    assert.deepEqual(
      within(list).getAllByRole('listitem').map((item) => item.textContent),
      ['Alfa3', 'Beta0', 'Gamma12'],
    );
    assert.ok(within(list).queryByRole('button', { name: 'Limpiar' }) === null);
  });

  it('marca varias a la vez y avisa con el resultado en el orden de las opciones', async () => {
    const log: string[][] = [];
    render(h(Harness, { log }));
    fireEvent.click(screen.getByRole('button', { name: 'Etapa' }));
    const list = within(await screen.findByRole('list', { name: 'Filtrar por Etapa' }));

    fireEvent.click(list.getByRole('checkbox', { name: 'Gamma' }));
    fireEvent.click(list.getByRole('checkbox', { name: 'Alfa' }));
    assert.deepEqual(log, [['c'], ['a', 'c']]);

    fireEvent.click(list.getByRole('checkbox', { name: 'Gamma' }));
    assert.deepEqual(log[2], ['a']);
  });

  it('una opción con 0 sale apagada pero se puede marcar', async () => {
    const log: string[][] = [];
    render(h(Harness, { log }));
    fireEvent.click(screen.getByRole('button', { name: 'Etapa' }));
    const list = within(await screen.findByRole('list', { name: 'Filtrar por Etapa' }));

    const empty = list.getByRole('checkbox', { name: 'Beta' });
    assert.equal((empty as HTMLButtonElement).disabled, false);
    assert.match(empty.closest('label')?.querySelector('span')?.className ?? '', /text-text-muted/);
    fireEvent.click(empty);
    assert.deepEqual(log, [['b']]);
  });

  it('«Limpiar» aparece con selección y la vacía', async () => {
    const log: string[][] = [];
    render(h(Harness, { log, initial: ['a', 'b'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Etapa · 2' }));
    const list = await screen.findByRole('list', { name: 'Filtrar por Etapa' });

    const dialog = list.closest('[role="dialog"], [data-open]') ?? document.body;
    fireEvent.click(within(dialog as HTMLElement).getByRole('button', { name: 'Limpiar' }));
    assert.deepEqual(log, [[]]);
  });
});
