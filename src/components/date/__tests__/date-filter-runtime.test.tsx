/**
 * PeriodSelector y DateFilterBar (Thema `date/*`) — contrato RUNTIME: qué
 * control pinta cada modo, cómo se anuncia y qué avisa al cambiar.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let PeriodSelector: (typeof import('../period-selector'))['PeriodSelector'];
let DateFilterBar: (typeof import('../date-filter-bar'))['DateFilterBar'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ PeriodSelector } = await import('../period-selector'));
  ({ DateFilterBar } = await import('../date-filter-bar'));
});

afterEach(() => {
  cleanup();
});

describe('PeriodSelector', () => {
  it('muestra el periodo elegido con su rótulo', () => {
    render(h(PeriodSelector, { label: 'Periodo', value: 'last_30_days' }));
    const trigger = screen.getByRole('combobox', { name: 'Periodo' });
    assert.equal(trigger.textContent, 'Últimos 30 días');
  });

  it('sin valor muestra el texto de ayuda para elegir', () => {
    render(h(PeriodSelector, { ariaLabel: 'Periodo del informe' }));
    assert.equal(screen.getByRole('combobox', { name: 'Periodo del informe' }).textContent, 'Elige un periodo');
  });

  it('el error sustituye a la ayuda y marca el control', () => {
    render(h(PeriodSelector, { label: 'Periodo', description: 'Se aplica a todo el tablero.', error: 'Elige un periodo.' }));
    assert.equal(screen.queryByText('Se aplica a todo el tablero.'), null);
    assert.ok(screen.getByText('Elige un periodo.'));
    assert.equal(screen.getByRole('combobox', { name: 'Periodo' }).getAttribute('aria-invalid'), 'true');
  });

  it('elegir un periodo avisa con su valor', async () => {
    const calls: string[] = [];
    render(
      h(PeriodSelector, {
        label: 'Periodo',
        value: 'today',
        onChange: (value: string) => calls.push(value),
        options: [
          { label: 'Hoy', value: 'today' },
          { label: 'Este mes', value: 'this_month', description: 'Del 1 a hoy' },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Periodo' }));
    const option = await screen.findByRole('option', { name: /Este mes/ });
    assert.match(option.textContent ?? '', /Del 1 a hoy/);
    // Base UI confirma la opción al soltar el puntero sobre ella.
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.mouseUp(option);
    fireEvent.pointerUp(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    await waitFor(() => assert.deepEqual(calls, ['this_month']));
  });
});

describe('DateFilterBar', () => {
  it('en modo periodo pinta el selector de periodos', () => {
    render(h(DateFilterBar, { mode: 'period', period: 'this_month' }));
    assert.equal(screen.getByRole('combobox', { name: 'Filtrar por' }).textContent, 'Periodo');
    assert.equal(screen.getByRole('combobox', { name: 'Elige el periodo' }).textContent, 'Este mes');
  });

  it('en modo rango pinta el selector de rango del sistema, no un input de fecha', () => {
    render(
      h(DateFilterBar, {
        mode: 'range',
        range: { from: new Date(2026, 8, 1), to: new Date(2026, 8, 30) },
      }),
    );
    assert.equal(document.querySelector('input[type="date"]'), null);
    assert.ok(screen.getByText('Elige el rango'));
    assert.match(screen.getByRole('button', { name: /2026/ }).textContent ?? '', /2026.*2026/);
  });

  it('en modo día pinta el selector de un día', () => {
    render(h(DateFilterBar, { mode: 'date' }));
    assert.ok(screen.getByRole('button', { name: 'Elige un día' }));
  });

  it('con un solo modo no pinta el selector de modo', () => {
    render(h(DateFilterBar, { mode: 'period', modes: ['period'] }));
    assert.equal(screen.queryByRole('combobox', { name: 'Filtrar por' }), null);
  });

  it('deshabilitada, ningún control responde', () => {
    render(h(DateFilterBar, { mode: 'period', disabled: true }));
    for (const control of screen.getAllByRole('combobox')) {
      assert.ok(control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true');
    }
  });
});
