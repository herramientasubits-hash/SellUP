/**
 * ActiveFilterChips — contrato RUNTIME: un chip por filtro puesto que se quita
 * de uno en uno, «Limpiar todo» opcional, y ninguna fila sin filtros.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ActiveFilterChips: (typeof import('../active-filter-chips'))['ActiveFilterChips'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ActiveFilterChips } = await import('../active-filter-chips'));
});

afterEach(() => {
  cleanup();
});

describe('ActiveFilterChips', () => {
  it('sin chips no pinta nada', () => {
    const { container } = render(h(ActiveFilterChips, { chips: [] }));
    assert.equal(container.childElementCount, 0);
  });

  it('pinta un chip por filtro, en un grupo con nombre', () => {
    render(
      h(ActiveFilterChips, {
        chips: [
          { key: 'a', label: 'Etapa: Inteligencia', onRemove: () => {} },
          { key: 'b', label: 'Señal: Sin responsable', onRemove: () => {} },
        ],
      }),
    );

    const group = screen.getByRole('group', { name: 'Filtros activos' });
    assert.ok(group.textContent?.includes('Etapa: Inteligencia'));
    assert.ok(group.textContent?.includes('Señal: Sin responsable'));
  });

  it('cada chip se quita por su cuenta', () => {
    const removed: string[] = [];
    render(
      h(ActiveFilterChips, {
        chips: [
          { key: 'a', label: 'Etapa: Inteligencia', onRemove: () => removed.push('a') },
          { key: 'b', label: 'Etapa: Cierre', onRemove: () => removed.push('b') },
        ],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Etapa: Cierre' }));
    assert.deepEqual(removed, ['b']);
  });

  it('«Limpiar todo» solo existe si quien la usa lo pide, y avisa una vez', () => {
    const chips = [{ key: 'a', label: 'Etapa: Cierre', onRemove: () => {} }];
    const { rerender } = render(h(ActiveFilterChips, { chips }));
    assert.ok(screen.queryByRole('button', { name: 'Limpiar todo' }) === null);

    let cleared = 0;
    rerender(h(ActiveFilterChips, { chips, onClearAll: () => (cleared += 1) }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar todo' }));
    assert.equal(cleared, 1);
  });
});
