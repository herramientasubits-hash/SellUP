/**
 * Pipeline · vista «Tablero» — contrato RUNTIME: una tarjeta por empresa en la
 * columna de su estado; mover una tarjeta PIDE confirmación y solo escribe al
 * aceptar (una vez, con el estado elegido); cancelar o fallar devuelve la
 * tarjeta a su columna; y un único vacío cuando no hay empresas.
 */

import '../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildOverview } from './pipeline-fixtures';
import { chooseMoveWithoutAction, findMoveDialog } from './stage-move-helpers';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let PipelineBoard: (typeof import('../pipeline-board'))['PipelineBoard'];
let PIPELINE_BOARD_COLUMNS: (typeof import('../pipeline-board'))['PIPELINE_BOARD_COLUMNS'];

type Props = React.ComponentProps<(typeof import('../pipeline-board'))['PipelineBoard']>;
type Call = [string, string, string];

const h = React.createElement;

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ PipelineBoard, PIPELINE_BOARD_COLUMNS } = await import('../pipeline-board'));
});

afterEach(() => {
  cleanup();
});

// `hidden`: con el diálogo de confirmación abierto, el tablero queda fuera del árbol accesible.
// `hidden`: con el diálogo abierto, el tablero queda fuera del árbol accesible.
const column = (name: string) => screen.getByRole('region', { name, hidden: true });
const card = (title: string) =>
  document.querySelector(`[data-slot="kanban-card"][aria-label="${title}"]`) as HTMLElement;
const cardsIn = (name: string) =>
  Array.from(column(name).querySelectorAll('[data-slot="kanban-card"]'), (node) => node.getAttribute('aria-label'));

function renderBoard(props: Partial<Props> = {}) {
  const calls: Call[] = [];
  const utils = render(
    h(PipelineBoard, {
      accounts: buildOverview().accounts,
      onMoveAccount: async (id: string, status: string, context: { kind: string }) => {
        calls.push([id, status, context.kind]);
        return { success: true as const };
      },
      ...props,
    }),
  );
  return { ...utils, calls };
}

/** Levanta la tarjeta con Espacio y la pasa a la columna de la derecha. */
function moveRight(title: string) {
  const node = card(title);
  node.focus();
  fireEvent.keyDown(node, { key: ' ' });
  fireEvent.keyDown(card(title), { key: 'ArrowRight' });
}

describe('PipelineBoard — sin empresas', () => {
  it('muestra un único estado vacío, no uno por columna, y lleva a los prospectos', () => {
    render(h(PipelineBoard, { accounts: [] }));

    assert.equal(screen.getAllByText('Todavía no hay empresas en el tablero').length, 1);
    assert.ok(screen.queryByText('Sin empresas') === null);
    assert.equal(screen.getByRole('link', { name: /Ir a prospectos/ }).getAttribute('href'), '/accounts?tab=prospectos');
  });
});

describe('PipelineBoard — con empresas', () => {
  it('son los cuatro estados, en orden, cada uno con su descripción', () => {
    renderBoard();

    assert.deepEqual(
      PIPELINE_BOARD_COLUMNS.map((stage) => [stage.id, stage.title]),
      [
        ['new', 'Nuevas'],
        ['ready_for_research', 'Listas para investigar'],
        ['research_in_progress', 'Investigación en curso'],
        ['ready_for_outreach', 'Listas para contacto'],
      ],
    );
    for (const stage of PIPELINE_BOARD_COLUMNS) {
      assert.ok(column(stage.title));
      assert.ok(screen.getByText(stage.description as string));
    }
  });

  it('pinta una tarjeta por empresa en la columna de su estado', () => {
    renderBoard();

    assert.deepEqual(cardsIn('Nuevas'), ['Acme']);
    assert.deepEqual(cardsIn('Listas para investigar'), ['Globex']);
    assert.deepEqual(cardsIn('Investigación en curso'), ['Initech']);
    assert.deepEqual(cardsIn('Listas para contacto'), ['Umbrella']);
    assert.ok(screen.queryByText('Todavía no hay empresas en el tablero') === null);
  });

  it('la tarjeta dice país · industria, el último movimiento y sus señales', () => {
    renderBoard();

    const acme = within(card('Acme'));
    assert.ok(acme.getByText('Colombia · Tecnología'));
    assert.ok(acme.getByText('Último movimiento: hace 30 días'));
    assert.ok(acme.getByText('Sin movimiento 30 días'));
    assert.ok(acme.getByText('Sin contactos'));
    assert.ok(within(card('Globex')).queryByText('Sin contactos') === null);
  });

  it('pulsar una tarjeta abre el recorrido de esa empresa', () => {
    const opened: string[] = [];
    renderBoard({ onOpenAccount: (id) => opened.push(id) });

    fireEvent.click(card('Globex'));
    assert.deepEqual(opened, ['globex']);
  });

  it('sin acción de mover, el tablero solo se mira', () => {
    render(h(PipelineBoard, { accounts: buildOverview().accounts }));

    assert.ok(document.querySelector('[data-slot="kanban-card"]') === null);
    assert.ok(within(column('Nuevas')).getByText('Acme'));
  });
});

describe('PipelineBoard — mover de etapa', () => {
  const rtl = () => ({ render, screen, within, fireEvent, waitFor, cleanup }) as unknown as typeof import('@testing-library/react');

  it('mover NO escribe: abre el flujo «Mover de etapa», que pide el contexto', async () => {
    const { calls } = renderBoard();

    moveRight('Acme');
    const dialog = await findMoveDialog(rtl());
    assert.ok(within(dialog).getByText('Mover Acme a «Lista para investigar»'));
    assert.ok(within(dialog).getByText('¿Cómo le damos a SellUp el contexto de esta etapa?'));
    assert.deepEqual(calls, []);
  });

  it('al confirmar llama UNA vez con la empresa, el estado elegido y el contexto', async () => {
    const { calls } = renderBoard();

    moveRight('Acme');
    const dialog = await findMoveDialog(rtl());
    fireEvent.click(chooseMoveWithoutAction(rtl(), dialog));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(calls, [['acme', 'ready_for_research', 'none']]);
  });

  it('si se cancela no escribe y la tarjeta vuelve a su columna', async () => {
    const { calls } = renderBoard();

    moveRight('Acme');
    const dialog = await findMoveDialog(rtl());
    assert.deepEqual(cardsIn('Listas para investigar'), ['Acme', 'Globex']);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(calls, []);
    assert.deepEqual(cardsIn('Nuevas'), ['Acme']);
    assert.deepEqual(cardsIn('Listas para investigar'), ['Globex']);
  });

  it('si falla, avisa del motivo, el diálogo sigue abierto y al cancelar la tarjeta vuelve', async () => {
    const failures: string[] = [];
    renderBoard({
      onMoveAccount: async () => ({ success: false, error: 'Cuenta no encontrada' }),
      onMoveFailed: (message) => failures.push(message),
    });

    moveRight('Acme');
    const dialog = await findMoveDialog(rtl());
    fireEvent.click(chooseMoveWithoutAction(rtl(), dialog));
    await waitFor(() => assert.deepEqual(failures, ['Cuenta no encontrada']));
    assert.equal(within(dialog).getByRole('alert').textContent, 'Cuenta no encontrada');
    assert.ok(screen.getByRole('dialog'));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(cardsIn('Nuevas'), ['Acme']);
  });

  it('reordenar dentro de la misma columna no es un cambio de etapa', () => {
    const { calls } = renderBoard();

    const node = card('Acme');
    fireEvent.keyDown(node, { key: ' ' });
    fireEvent.keyDown(card('Acme'), { key: 'ArrowDown' });
    assert.ok(screen.queryByRole('dialog') === null);
    assert.deepEqual(calls, []);
  });
});
