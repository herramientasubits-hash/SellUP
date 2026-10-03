/**
 * Kanban — contrato RUNTIME de las columnas: icono propio en la cabecera, ancho
 * propio, y columnas apagadas (`disabled`) que no reciben tarjetas, no llevan
 * contador ni zona de soltar, y que el teclado salta.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let Kanban: (typeof import('../kanban'))['Kanban'];
let moveKanbanItem: (typeof import('../kanban'))['moveKanbanItem'];

type KanbanItem = import('../kanban').KanbanItem;
type KanbanColumn = import('../kanban').KanbanColumn;

const h = React.createElement;

const COLUMNS: KanbanColumn[] = [
  { id: 'a', title: 'Alfa', icon: h('span', { 'data-testid': 'icono-alfa' }), width: 300 },
  { id: 'b', title: 'Beta', disabled: true, description: 'Próximamente', width: 160 },
  { id: 'c', title: 'Gamma' },
];
const ITEMS: KanbanItem[] = [{ id: '1', columnId: 'a', title: 'Acme' }];

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ Kanban, moveKanbanItem } = await import('../kanban'));
});

afterEach(() => {
  cleanup();
});

function Board({ moves }: { moves: [string, string][] }) {
  const [items, setItems] = React.useState(ITEMS);
  return h(Kanban, {
    columns: COLUMNS,
    items,
    onItemMove: (id: string, to: string, index: number) => {
      moves.push([id, to]);
      setItems((current) => moveKanbanItem(current, id, to, index));
    },
  });
}

const section = (name: string) => screen.getByRole('region', { name });
const card = (title: string) => document.querySelector(`[data-slot="kanban-card"][aria-label="${title}"]`) as HTMLElement;

describe('Kanban — columnas', () => {
  it('el icono propio sustituye al punto de tono y el ancho propio manda', () => {
    render(h(Board, { moves: [] }));
    assert.ok(section('Alfa').querySelector('[data-testid="icono-alfa"]'));
    assert.equal(section('Alfa').style.width, '300px');
    assert.equal(section('Gamma').style.width, '288px');
  });

  it('una columna apagada: solo su cabecera, sin contador ni zona de soltar', () => {
    render(h(Board, { moves: [] }));
    const beta = section('Beta');
    assert.equal(beta.getAttribute('data-disabled'), 'true');
    assert.ok(beta.querySelector('ul') === null);
    assert.ok(beta.querySelector('[data-slot="badge"]') === null);
    assert.ok(beta.textContent?.includes('Próximamente'));
    assert.ok(section('Alfa').querySelector('[data-slot="badge"]'));
  });

  it('con teclado, la tarjeta salta la columna apagada', () => {
    const moves: [string, string][] = [];
    render(h(Board, { moves }));
    card('Acme').focus();
    fireEvent.keyDown(card('Acme'), { key: ' ' });
    fireEvent.keyDown(card('Acme'), { key: 'ArrowRight' });
    assert.deepEqual(moves, [['1', 'c']]);
    assert.ok(section('Gamma').textContent?.includes('Acme'));
  });
});
