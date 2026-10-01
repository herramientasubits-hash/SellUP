/**
 * DateRangeColumnHeader — contrato RUNTIME: el rango de la columna «Fecha» se
 * elige con el `DateRangePicker` del sistema (no con inputs de fecha del
 * navegador) y el filtro sigue guardando días `AAAA-MM-DD`.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let DateRangeColumnHeader: (typeof import('../prospect-date-range-column-header'))['DateRangeColumnHeader'];
let parseIsoDay: (typeof import('../prospect-date-range-column-header'))['parseIsoDay'];
let toIsoDay: (typeof import('../prospect-date-range-column-header'))['toIsoDay'];
let TooltipProvider: (typeof import('../../ui/tooltip'))['TooltipProvider'];

const h = React.createElement;

function fakeColumn(initial: unknown, calls: unknown[]) {
  let value = initial;
  return {
    getFilterValue: () => value,
    setFilterValue: (next: unknown) => {
      value = next;
      calls.push(next);
    },
    getIsSorted: () => false,
    getCanSort: () => true,
    toggleSorting: () => {},
    clearSorting: () => {},
  } as unknown as import('@tanstack/react-table').Column<unknown, unknown>;
}

function openFilter(initial: unknown, calls: unknown[] = []): void {
  render(
    h(TooltipProvider, null, h(DateRangeColumnHeader, { column: fakeColumn(initial, calls), title: 'Fecha' })),
  );
  fireEvent.click(screen.getByRole('button', { name: /fecha de creación/i }));
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ DateRangeColumnHeader, parseIsoDay, toIsoDay } = await import('../prospect-date-range-column-header'));
  ({ TooltipProvider } = await import('../../ui/tooltip'));
});

afterEach(() => {
  cleanup();
});

describe('DateRangeColumnHeader', () => {
  it('ofrece el selector de rango del sistema, sin inputs de fecha del navegador', async () => {
    openFilter(undefined);
    assert.ok(await screen.findByText('Fecha de creación'));
    assert.equal(document.querySelector('input[type="date"]'), null);
    assert.ok(screen.getByRole('button', { name: 'Rango' }));
    assert.equal(screen.queryByRole('button', { name: 'Limpiar el rango' }), null);
  });

  it('con rango puesto lo muestra y «Limpiar el rango» quita el filtro', async () => {
    const calls: unknown[] = [];
    openFilter({ from: '2026-09-01', to: '2026-09-30' }, calls);
    const picker = await screen.findByRole('button', { name: 'Rango' });
    assert.match(picker.textContent ?? '', /2026.*2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar el rango' }));
    assert.deepEqual(calls, [undefined]);
  });
});

describe('días del filtro', () => {
  it('van y vuelven sin correrse de día', () => {
    const day = parseIsoDay('2026-09-03');
    assert.ok(day);
    assert.equal(day.getDate(), 3);
    assert.equal(day.getMonth(), 8);
    assert.equal(toIsoDay(day), '2026-09-03');
  });

  it('un valor vacío o mal formado no es un día', () => {
    assert.equal(parseIsoDay(undefined), undefined);
    assert.equal(parseIsoDay('03/09/2026'), undefined);
    assert.equal(toIsoDay(undefined), undefined);
  });
});
