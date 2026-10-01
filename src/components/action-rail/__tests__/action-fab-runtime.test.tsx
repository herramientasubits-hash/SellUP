/**
 * ActionFab — contrato RUNTIME (portado de `ActionFab.test.tsx` de Thema).
 * La barra de acciones cuando no hay sitio para una barra.
 */
import './rail-test-dom';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

type RailActionSpec = import('../rail-actions').RailActionSpec;
type FabProps = import('../action-fab').ActionFabProps;

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ActionFab: (typeof import('../action-fab'))['ActionFab'];

const ICON = <span data-testid="icono" />;

const ACTIONS: readonly RailActionSpec[] = [
  { id: 'create', label: 'Crear proceso', icon: ICON, scope: ['screen'], primary: true },
  { id: 'import', label: 'Cargar', icon: ICON, scope: ['screen'] },
  { id: 'edit', label: 'Editar', icon: ICON, scope: ['single'] },
  { id: 'delete', label: 'Eliminar', icon: ICON, scope: ['single', 'bulk'], tone: 'danger', countInLabel: true },
];

function fab(props: Partial<FabProps> = {}) {
  return render(<ActionFab actions={ACTIONS} selectedCount={0} onClearSelection={() => {}} {...props} />);
}

const openFab = () => fireEvent.click(screen.getByRole('button', { name: 'Abrir las acciones' }));

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ActionFab } = await import('../action-fab'));
});

afterEach(() => cleanup());

describe('ActionFab', () => {
  it('cerrado es un solo botón: nada de lo que ofrece está a la vista', () => {
    fab();

    assert.ok(screen.getByRole('button', { name: 'Abrir las acciones' }));
    assert.equal(screen.queryByText('Crear proceso'), null);
    assert.equal(screen.queryByText('Cargar'), null);
  });

  it('al abrirlo despliega lo que aplica y pasa a ser la salida', () => {
    fab();
    openFab();

    assert.ok(screen.getByText('Crear proceso'));
    assert.ok(screen.getByText('Cargar'));
    // Sin selección, lo que solo vale para un registro no se ofrece.
    assert.equal(screen.queryByText('Editar'), null);
    assert.ok(screen.getByRole('button', { name: 'Cerrar las acciones' }));
  });

  it('reparte las acciones igual que la barra: un registro trae las suyas', () => {
    fab({ selectedCount: 1 });
    openFab();

    assert.ok(screen.getByText('Editar'));
    assert.ok(screen.getByText('Eliminar'));
    assert.equal(screen.queryByText('Crear proceso'), null);
  });

  it('con varios se cae lo individual y el recuento entra en la etiqueta', () => {
    fab({ selectedCount: 3 });
    openFab();

    assert.equal(screen.queryByText('Editar'), null);
    assert.ok(screen.getByText('Eliminar (3)'));
  });

  it('cerrado enseña el recuento cuando hay algo marcado', () => {
    fab({ selectedCount: 4 });

    assert.equal(screen.getByRole('button', { name: 'Abrir las acciones' }).textContent, '4');
  });

  it('pulsar una acción la ejecuta y cierra el abanico', () => {
    let calls = 0;
    fab({
      actions: [{ id: 'create', label: 'Crear proceso', icon: ICON, scope: ['screen'], primary: true, onSelect: () => calls++ }],
    });
    openFab();

    fireEvent.click(screen.getByText('Crear proceso'));

    assert.equal(calls, 1);
    assert.ok(screen.getByRole('button', { name: 'Abrir las acciones' }));
  });

  it('se puede soltar la selección desde el abanico', () => {
    let cleared = 0;
    fab({ selectedCount: 2, onClearSelection: () => cleared++ });
    openFab();

    fireEvent.click(screen.getByText('Soltar 2 seleccionados'));

    assert.equal(cleared, 1);
  });

  it('el recuento concuerda en género', () => {
    fab({ selectedCount: 2, gender: 'f' });
    openFab();

    assert.ok(screen.getByText('Soltar 2 seleccionadas'));
  });

  it('sin nada que ofrecer no se pinta el botón', () => {
    fab({ actions: [] });

    assert.equal(screen.queryByRole('button'), null);
  });

  it('una acción bloqueada sale apagada y no se ejecuta', () => {
    let calls = 0;
    fab({
      selectedCount: 2,
      actions: [
        { id: 'approve', label: 'Aprobar', icon: ICON, scope: ['bulk'], blockedReason: 'Aprobación masiva pendiente', onSelect: () => calls++ },
      ],
    });
    openFab();

    const row = screen.getByText('Aprobar').closest('button') as HTMLButtonElement;
    fireEvent.click(row);

    assert.equal(row.disabled, true);
    assert.equal(row.getAttribute('title'), 'Aprobación masiva pendiente');
    assert.equal(calls, 0);
  });

  it('la primaria con opciones y los grupos con menú se abren en filas', () => {
    const chosen: string[] = [];
    const { unmount } = fab({
      actions: [
        {
          id: 'add',
          label: 'Agregar prospectos',
          icon: ICON,
          scope: ['screen'],
          primary: true,
          options: [
            { id: 'ai', title: 'Generar con IA', description: '', icon: ICON, onSelect: () => chosen.push('ai') },
            { id: 'import', title: 'Importar archivo', description: '', icon: ICON, onSelect: () => chosen.push('import') },
          ],
        },
      ],
    });
    openFab();
    assert.equal(screen.queryByText('Agregar prospectos'), null, 'no hay botón relleno: van sus opciones');
    fireEvent.click(screen.getByText('Importar archivo'));
    assert.deepEqual(chosen, ['import']);
    unmount();

    fab({
      selectedCount: 1,
      actions: [
        {
          id: 'more',
          label: 'Más acciones',
          icon: ICON,
          scope: ['single'],
          menu: [{ id: 'dup', label: 'Marcar duplicado', icon: ICON, onSelect: () => chosen.push('dup') }],
        },
      ],
    });
    openFab();
    fireEvent.click(screen.getByText('Marcar duplicado'));
    assert.deepEqual(chosen, ['import', 'dup']);
  });
});
