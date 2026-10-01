/**
 * Kanban (Thema `data-display/Kanban`) — contrato RUNTIME del movimiento: con
 * `onItemMove` las tarjetas se levantan y se mueven con teclado, cada paso se
 * anuncia, y Escape devuelve la tarjeta a su sitio. Sin `onItemMove`, el
 * tablero solo pinta.
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
let Kanban: (typeof import('../kanban'))['Kanban'];
let moveKanbanItem: (typeof import('../kanban'))['moveKanbanItem'];

type KanbanItem = import('../kanban').KanbanItem;

const h = React.createElement;

const COLUMNS = [
  { id: 'review', title: 'En revisión' },
  { id: 'approved', title: 'Aprobados' },
  { id: 'sent', title: 'Enviados' },
];
const ITEMS: KanbanItem[] = [
  { id: '1', columnId: 'review', title: 'Acme SAS' },
  { id: '2', columnId: 'review', title: 'Initech' },
  { id: '3', columnId: 'approved', title: 'Globex' },
];

type Move = [string, string, number];

function Board({ moves, onItemClick }: { moves: Move[]; onItemClick?: (item: KanbanItem) => void }) {
  const [items, setItems] = React.useState(ITEMS);
  return h(Kanban, {
    columns: COLUMNS,
    items,
    onItemClick,
    onItemMove: (id: string, toColumnId: string, toIndex: number) => {
      moves.push([id, toColumnId, toIndex]);
      setItems((current) => moveKanbanItem(current, id, toColumnId, toIndex));
    },
  });
}

const column = (name: string) => screen.getByRole('region', { name });
const titles = (name: string) =>
  Array.from(column(name).querySelectorAll('[data-slot="kanban-card"]'), (card) =>
    card.getAttribute('aria-label'),
  );
const card = (title: string) =>
  document.querySelector(`[data-slot="kanban-card"][aria-label="${title}"]`) as HTMLElement;
const announcement = () =>
  document.querySelector('[data-slot="kanban-announcement"]')?.textContent ?? '';

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ Kanban, moveKanbanItem } = await import('../kanban'));
});

afterEach(() => {
  cleanup();
});

describe('Kanban — mover con teclado', () => {
  it('Espacio levanta la tarjeta y → la pasa de columna (dispara onItemMove)', () => {
    const moves: Move[] = [];
    render(h(Board, { moves }));

    const acme = card('Acme SAS');
    acme.focus();
    fireEvent.keyDown(acme, { key: ' ' });
    assert.equal(card('Acme SAS').getAttribute('data-lifted'), 'true');
    assert.match(announcement(), /Acme SAS levantada/);

    fireEvent.keyDown(card('Acme SAS'), { key: 'ArrowRight' });
    assert.deepEqual(moves, [['1', 'approved', 0]]);
    assert.deepEqual(titles('En revisión'), ['Initech']);
    assert.deepEqual(titles('Aprobados'), ['Acme SAS', 'Globex']);
    assert.equal(announcement(), 'Acme SAS movida a Aprobados, posición 1 de 2');
    // La tarjeta se volvió a montar en otra columna y conserva el foco.
    assert.ok(document.activeElement === card('Acme SAS'));
  });

  it('↓ y ↑ reordenan dentro de la columna', () => {
    const moves: Move[] = [];
    render(h(Board, { moves }));

    fireEvent.keyDown(card('Acme SAS'), { key: 'Enter' });
    fireEvent.keyDown(card('Acme SAS'), { key: 'ArrowDown' });
    assert.deepEqual(moves, [['1', 'review', 1]]);
    assert.deepEqual(titles('En revisión'), ['Initech', 'Acme SAS']);

    // Ya es la última: bajar otra vez no dispara nada.
    fireEvent.keyDown(card('Acme SAS'), { key: 'ArrowDown' });
    assert.equal(moves.length, 1);

    fireEvent.keyDown(card('Acme SAS'), { key: 'ArrowUp' });
    assert.deepEqual(moves[1], ['1', 'review', 0]);
  });

  it('Espacio la suelta donde está; sin levantar, las flechas no mueven', () => {
    const moves: Move[] = [];
    render(h(Board, { moves }));

    fireEvent.keyDown(card('Globex'), { key: 'ArrowRight' });
    assert.deepEqual(moves, []);

    fireEvent.keyDown(card('Globex'), { key: ' ' });
    fireEvent.keyDown(card('Globex'), { key: 'ArrowRight' });
    fireEvent.keyDown(card('Globex'), { key: ' ' });
    assert.equal(card('Globex').getAttribute('data-lifted'), null);
    assert.equal(announcement(), 'Globex soltada en Enviados, posición 1 de 1.');

    fireEvent.keyDown(card('Globex'), { key: 'ArrowLeft' });
    assert.equal(moves.length, 1);
  });

  it('Escape devuelve la tarjeta a donde estaba', () => {
    const moves: Move[] = [];
    render(h(Board, { moves }));

    fireEvent.keyDown(card('Initech'), { key: ' ' });
    fireEvent.keyDown(card('Initech'), { key: 'ArrowRight' });
    fireEvent.keyDown(card('Initech'), { key: 'ArrowRight' });
    assert.deepEqual(titles('Enviados'), ['Initech']);

    fireEvent.keyDown(card('Initech'), { key: 'Escape' });
    assert.deepEqual(moves[moves.length - 1], ['2', 'review', 1]);
    assert.deepEqual(titles('En revisión'), ['Acme SAS', 'Initech']);
    assert.match(announcement(), /Movimiento cancelado/);
  });

  it('no se sale por los extremos del tablero', () => {
    const moves: Move[] = [];
    render(h(Board, { moves }));
    fireEvent.keyDown(card('Acme SAS'), { key: ' ' });
    fireEvent.keyDown(card('Acme SAS'), { key: 'ArrowLeft' });
    assert.deepEqual(moves, []);
  });

  it('con detalle que abrir, Enter abre y Espacio levanta', () => {
    const moves: Move[] = [];
    const opened: string[] = [];
    render(h(Board, { moves, onItemClick: (item: KanbanItem) => opened.push(item.id) }));

    fireEvent.keyDown(card('Acme SAS'), { key: 'Enter' });
    assert.deepEqual(opened, ['1']);
    assert.equal(card('Acme SAS').getAttribute('data-lifted'), null);

    fireEvent.keyDown(card('Acme SAS'), { key: ' ' });
    assert.equal(card('Acme SAS').getAttribute('data-lifted'), 'true');
    fireEvent.click(card('Globex'));
    assert.deepEqual(opened, ['1', '3']);
  });
});

describe('Kanban — sin onItemMove solo pinta', () => {
  it('las tarjetas no son reordenables ni enfocables', () => {
    render(h(Kanban, { columns: COLUMNS, items: ITEMS }));
    assert.equal(document.querySelector('[data-slot="kanban-card"]'), null);
    assert.equal(document.querySelector('[data-slot="kanban-announcement"]'), null);
    assert.ok(within(column('En revisión')).getByText('Acme SAS'));
  });
});

describe('moveKanbanItem', () => {
  it('devuelve un arreglo nuevo con la tarjeta en su columna y posición', () => {
    const moved = moveKanbanItem(ITEMS, '1', 'approved', 1);
    assert.notEqual(moved, ITEMS);
    assert.equal(ITEMS[0].columnId, 'review');
    assert.deepEqual(
      moved.map((item) => [item.id, item.columnId]),
      [['2', 'review'], ['3', 'approved'], ['1', 'approved']],
    );
  });

  it('en una columna vacía la deja al final', () => {
    const moved = moveKanbanItem(ITEMS, '3', 'sent', 0);
    assert.deepEqual(moved.map((item) => [item.id, item.columnId]).at(-1), ['3', 'sent']);
  });

  it('un id desconocido no cambia nada', () => {
    assert.deepEqual(moveKanbanItem(ITEMS, 'x', 'sent', 0), ITEMS);
  });
});
