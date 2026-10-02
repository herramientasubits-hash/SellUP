/**
 * ListActionRailProvider + RailScreenActions + useRailSelectionReporter —
 * contrato RUNTIME de la regla «una sola barra por pantalla»: la pantalla
 * declara sus acciones, la lista cuenta su selección y UNA barra las enseña.
 */
import { RAIL_KEYS, resetRailPreferences, setCompactViewport, visibleActionLabels } from './rail-test-dom';

import * as React from 'react';
import { describe, it, before, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type RailActionSpec = import('../rail-actions').RailActionSpec;

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];
let ListActionRailProvider: (typeof import('../list-action-rail'))['ListActionRailProvider'];
let RailScreenActions: (typeof import('../list-action-rail'))['RailScreenActions'];
let useRailSelectionReporter: (typeof import('../list-action-rail'))['useRailSelectionReporter'];
let setRailPosition: (typeof import('../rail-preferences'))['setRailPosition'];

const ICON = <span data-testid="icono" />;

const fired: string[] = [];

const SCREEN_ACTIONS: readonly RailActionSpec[] = [
  { id: 'import', label: 'Importar', icon: ICON, scope: ['screen'], onSelect: () => fired.push('import') },
  { id: 'create', label: 'Crear empresa', icon: ICON, scope: ['screen'], primary: true, onSelect: () => fired.push('create') },
];

/** Hace de tabla: cuenta su selección a la barra con la función del hook. */
function FakeList({ name = 'lista' }: { name?: string }) {
  const report = useRailSelectionReporter();
  const [count, setCount] = React.useState(0);

  const selectionActions = React.useMemo<readonly RailActionSpec[]>(
    () => [
      { id: 'edit', label: 'Editar', icon: ICON, scope: ['single'], onSelect: () => fired.push(`edit:${count}`) },
      {
        id: 'archive',
        label: 'Archivar',
        icon: ICON,
        scope: ['single', 'bulk'],
        countInLabel: true,
        onSelect: () => fired.push(`archive:${count}`),
      },
    ],
    [count],
  );

  React.useEffect(() => {
    report?.(count > 0 ? { count, actions: selectionActions, onClear: () => setCount(0), gender: 'f' } : null);
  }, [report, count, selectionActions]);

  return (
    <div>
      <p>{report ? 'con proveedor' : 'sin proveedor'}</p>
      <button type="button" onClick={() => setCount(1)}>{`Marcar una en ${name}`}</button>
      <button type="button" onClick={() => setCount(3)}>{`Marcar tres en ${name}`}</button>
    </div>
  );
}

function Screen({ isBlocked = false, showList = true }: { isBlocked?: boolean; showList?: boolean }) {
  return (
    <ListActionRailProvider label="Acciones de empresas" gender="f">
      <RailScreenActions actions={SCREEN_ACTIONS} isBlocked={isBlocked} />
      {showList ? <FakeList /> : null}
    </ListActionRailProvider>
  );
}

const toolbarActions = () =>
  visibleActionLabels(Array.from(screen.getByRole('toolbar').querySelectorAll<HTMLElement>('button')));
const reserve = () => document.querySelector('[data-slot="action-rail-reserve"]') as HTMLElement;

before(async () => {
  ({ render, screen, fireEvent, cleanup, act } = await import('@testing-library/react'));
  ({ ListActionRailProvider, RailScreenActions, useRailSelectionReporter } = await import('../list-action-rail'));
  ({ setRailPosition } = await import('../rail-preferences'));
});

beforeEach(() => {
  setCompactViewport(false);
  fired.length = 0;
});

afterEach(() => {
  cleanup();
  resetRailPreferences();
});

describe('ListActionRailProvider — una sola barra por pantalla', () => {
  it('sin selección la barra enseña las acciones de la pantalla, con la primaria al final', () => {
    render(<Screen />);

    assert.equal(screen.getAllByRole('toolbar').length, 1);
    assert.ok(screen.getByRole('toolbar', { name: 'Acciones de empresas' }));
    assert.deepEqual(toolbarActions(), ['Importar', 'Crear empresa']);
  });

  it('la acción de pantalla dispara lo que declaró la pantalla', () => {
    render(<Screen />);

    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));

    assert.deepEqual(fired, ['create']);
  });

  it('con una fila marcada las de pantalla se SUSTITUYEN por el recuento y las individuales', () => {
    render(<Screen />);

    fireEvent.click(screen.getByRole('button', { name: 'Marcar una en lista' }));

    assert.equal(screen.getAllByRole('toolbar').length, 1, 'sigue habiendo una sola barra');
    assert.ok(screen.getByText('1 seleccionada'));
    assert.deepEqual(toolbarActions(), ['Editar', 'Archivar']);
    assert.equal(screen.queryByRole('button', { name: 'Crear empresa' }), null);
  });

  it('con varias se caen las individuales y el recuento entra en la etiqueta', () => {
    render(<Screen />);

    fireEvent.click(screen.getByRole('button', { name: 'Marcar tres en lista' }));

    assert.ok(screen.getByText('3 seleccionadas'));
    assert.deepEqual(toolbarActions(), ['Archivar (3)']);
  });

  it('la acción sobre lo marcado se dispara con exactamente lo que hay marcado', () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar tres en lista' }));

    fireEvent.click(screen.getByRole('button', { name: 'Archivar (3)' }));

    assert.deepEqual(fired, ['archive:3']);
  });

  it('limpiar la selección devuelve las acciones de la pantalla', () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar tres en lista' }));

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));

    assert.deepEqual(toolbarActions(), ['Importar', 'Crear empresa']);
  });

  it('si la lista se desmonta con filas marcadas, la barra vuelve a la pantalla', () => {
    const { rerender } = render(<Screen />);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar tres en lista' }));

    rerender(<Screen showList={false} />);

    assert.deepEqual(toolbarActions(), ['Importar', 'Crear empresa']);
  });

  it('`isBlocked` de la pantalla recoge la barra mientras su panel está abierto', () => {
    const { rerender } = render(<Screen isBlocked />);
    const root = () => document.querySelector('[data-slot="action-rail"]') as HTMLElement;
    assert.equal(root().getAttribute('data-state'), 'blocked');
    assert.equal(screen.queryByRole('button', { name: 'Crear empresa' }), null);

    rerender(<Screen />);

    assert.equal(root().getAttribute('data-state'), 'expanded');
  });

  it('dos listas en la misma pantalla no se pisan: manda la que tiene filas marcadas', () => {
    render(
      <ListActionRailProvider>
        <RailScreenActions actions={SCREEN_ACTIONS} />
        <FakeList name="A" />
        <FakeList name="B" />
      </ListActionRailProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Marcar una en B' }));

    assert.equal(screen.getAllByRole('toolbar').length, 1);
    assert.ok(screen.getByText('1 seleccionada'));
  });
});

describe('ListActionRailProvider — el hueco que protege el pie de la tabla', () => {
  it('tendida y atracada reserva abajo', () => {
    render(<Screen />);

    assert.ok(reserve().classList.contains('pb-20'));
    assert.equal(reserve().classList.contains('pr-20'), false);
  });

  it('de pie reserva a la derecha y deja libre abajo', () => {
    window.localStorage.setItem(RAIL_KEYS.orientation, 'vertical');
    render(<Screen />);

    assert.ok(reserve().classList.contains('pr-20'));
    assert.equal(reserve().classList.contains('pb-20'), false);
  });

  it('arrastrada no reserva nada, y al volver a su sitio vuelve a reservar', () => {
    render(<Screen />);

    act(() => setRailPosition({ x: 300, y: 100 }));
    assert.equal(reserve().classList.contains('pb-20'), false);
    assert.equal(reserve().classList.contains('pr-20'), false);

    act(() => setRailPosition(null));
    assert.ok(reserve().classList.contains('pb-20'));
  });

  it('en pantalla estrecha reserva abajo para el botón flotante', () => {
    setCompactViewport(true);
    window.localStorage.setItem(RAIL_KEYS.orientation, 'vertical');
    render(<Screen />);

    assert.ok(reserve().classList.contains('pb-20'));
    assert.ok(screen.getByRole('button', { name: 'Abrir las acciones' }));
  });

  it('mantiene la cadena flex que necesita DataTablePage', () => {
    render(<Screen />);

    for (const className of ['flex', 'min-h-0', 'flex-1', 'flex-col']) {
      assert.ok(reserve().classList.contains(className), className);
    }
  });
});

describe('fuera de un ListActionRailProvider', () => {
  it('RailScreenActions monta su propia barra: la pantalla nunca se queda sin acciones', () => {
    render(<RailScreenActions actions={SCREEN_ACTIONS} />);

    assert.deepEqual(toolbarActions(), ['Importar', 'Crear empresa']);
  });

  it('useRailSelectionReporter devuelve null: la lista sabe que debe montar su barra', () => {
    render(<FakeList />);

    assert.ok(screen.getByText('sin proveedor'));
    assert.doesNotThrow(() => fireEvent.click(screen.getByRole('button', { name: 'Marcar una en lista' })));
  });
});
