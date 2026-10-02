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
let BOARD_STAGE_STATUS: (typeof import('../pipeline-board'))['BOARD_STAGE_STATUS'];

type Props = React.ComponentProps<(typeof import('../pipeline-board'))['PipelineBoard']>;
type Call = [string, string, string];

const h = React.createElement;

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ PipelineBoard, BOARD_STAGE_STATUS } = await import('../pipeline-board'));
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

describe('PipelineBoard — columnas = las 8 etapas del proceso', () => {
  const columns = () => Array.from(document.querySelectorAll<HTMLElement>('[data-slot="kanban"] section'));

  it('son las 8 etapas, en orden, con el vocabulario y el icono del resumen', () => {
    renderBoard();

    assert.deepEqual(
      columns().map((section) => section.getAttribute('aria-label')),
      ['Prospección', 'Enriquecimiento', 'Inteligencia', 'Preparación', 'Reunión', 'Cotización', 'Venta interna', 'Cierre'],
    );
    // Cada columna lleva la baldosa de icono de su etapa (no el punto de tono).
    for (const section of columns()) assert.ok(section.querySelector('header [data-slot="icon-tile"]'), section.getAttribute('aria-label') ?? '');
  });

  it('solo admiten mover las etapas con estado; las demás van estrechas, apagadas y sin contador', () => {
    renderBoard();

    const byName = Object.fromEntries(columns().map((section) => [section.getAttribute('aria-label'), section]));
    for (const name of ['Prospección', 'Reunión', 'Cotización', 'Venta interna', 'Cierre']) {
      const section = byName[name];
      assert.equal(section.getAttribute('data-disabled'), 'true', name);
      assert.equal(section.style.width, '176px', name);
      assert.ok(section.querySelector('ul') === null, `${name} no tiene zona de soltar`);
      assert.ok(section.querySelector('[data-slot="badge"]') === null, `${name} no lleva contador`);
    }
    assert.ok(within(byName['Prospección']).getByText('Ya superada'));
    assert.ok(within(byName['Reunión']).getByText('Próximamente'));
    for (const name of ['Enriquecimiento', 'Inteligencia', 'Preparación']) {
      assert.equal(byName[name].hasAttribute('data-disabled'), false, name);
      assert.equal(byName[name].style.width, '288px', name);
    }
    // Inteligencia y Preparación: el agente llega pronto, pero se puede mover a ellas.
    assert.ok(within(byName['Inteligencia']).getByText(/Agente próximamente/));
    assert.ok(within(byName['Enriquecimiento']).getByText('El Agente 2A busca sus contactos.'));
    assert.deepEqual(BOARD_STAGE_STATUS, { enriquecimiento: 'new', inteligencia: 'ready_for_research', preparacion: 'ready_for_outreach' });
  });

  it('cada empresa va en la columna de su etapa actual; Inteligencia agrupa sus dos estados', () => {
    renderBoard();

    assert.deepEqual(cardsIn('Enriquecimiento'), ['Acme']);
    assert.deepEqual(cardsIn('Inteligencia'), ['Initech', 'Globex']);
    assert.deepEqual(cardsIn('Preparación'), ['Umbrella']);
    assert.ok(screen.queryByText('Todavía no hay empresas en el tablero') === null);
  });
});

describe('PipelineBoard — la tarjeta es la fila de la lista', () => {
  it('nombre, bandera + país, «hace N días» y el subestado', () => {
    renderBoard();

    const acme = within(card('Acme'));
    assert.ok(acme.getByText('🇨🇴 Colombia · hace 30 días'));
    assert.equal(acme.getByText('Nueva').getAttribute('data-status'), 'info');
    // En Inteligencia, el subestado distingue sus dos estados.
    assert.ok(within(card('Globex')).getByText('Lista para investigar'));
    assert.ok(within(card('Initech')).getByText('Investigación en curso'));
  });

  it('el punto de aviso lleva el color de la severidad y nombra las señales', () => {
    renderBoard();

    const acmeDot = card('Acme').querySelector('[data-slot="board-signal-dot"]') as HTMLElement;
    assert.equal(acmeDot.getAttribute('data-severity'), 'critical');
    assert.match(acmeDot.className, /bg-destructive/);
    assert.equal(acmeDot.getAttribute('aria-label'), 'Requiere atención: Sin movimiento 30 días, Sin contactos');
    const initechDot = card('Initech').querySelector('[data-slot="board-signal-dot"]') as HTMLElement;
    assert.match(initechDot.className, /bg-warning/);
    assert.ok(card('Globex').querySelector('[data-slot="board-signal-dot"]') === null);
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
    assert.ok(within(column('Enriquecimiento')).getByText('Acme'));
  });
});

describe('PipelineBoard — alertas y archivadas', () => {
  it('arriba, los motivos de atención del resumen: pulsar uno filtra el tablero', () => {
    renderBoard();

    const strip = within(screen.getByRole('group', { name: 'Empresas que requieren atención' }));
    assert.ok(strip.getByText('2 empresas requieren atención'));
    fireEvent.click(strip.getByRole('button', { name: /Sin responsable/ }));
    assert.deepEqual(cardsIn('Enriquecimiento'), []);
    assert.deepEqual(cardsIn('Inteligencia'), ['Initech']);
    assert.ok(within(screen.getByRole('group', { name: 'Filtros activos' })).getByText('Señal: Sin responsable'));
  });

  it('las archivadas no están en el tablero: su total va aparte', () => {
    renderBoard({ archivedTotal: 3 });
    assert.equal(
      document.querySelector('[data-slot="board-archived"]')?.textContent,
      'Archivadas: 3 · fuera del tablero, no cuentan en las etapas.',
    );
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
    assert.deepEqual(cardsIn('Inteligencia'), ['Acme', 'Initech', 'Globex']);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(calls, []);
    assert.deepEqual(cardsIn('Enriquecimiento'), ['Acme']);
    assert.deepEqual(cardsIn('Inteligencia'), ['Initech', 'Globex']);
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
    assert.deepEqual(cardsIn('Enriquecimiento'), ['Acme']);
  });

  it('las columnas sin estado no reciben tarjetas: con teclado se saltan', async () => {
    const { calls } = renderBoard();

    // De Enriquecimiento a la izquierda está Prospección (ya superada): no hay a dónde ir.
    const node = card('Acme');
    node.focus();
    fireEvent.keyDown(node, { key: ' ' });
    fireEvent.keyDown(card('Acme'), { key: 'ArrowLeft' });
    assert.ok(screen.queryByRole('dialog') === null);
    assert.deepEqual(cardsIn('Enriquecimiento'), ['Acme']);

    // De Preparación a la derecha están Reunión a Cierre (próximamente): tampoco.
    fireEvent.keyDown(card('Acme'), { key: ' ' });
    const umbrella = card('Umbrella');
    umbrella.focus();
    fireEvent.keyDown(umbrella, { key: ' ' });
    fireEvent.keyDown(card('Umbrella'), { key: 'ArrowRight' });
    assert.ok(screen.queryByRole('dialog') === null);
    assert.deepEqual(cardsIn('Preparación'), ['Umbrella']);
    assert.deepEqual(calls, []);
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
