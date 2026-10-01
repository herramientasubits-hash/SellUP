/**
 * DataListActionRail + ActionRailShell — contrato RUNTIME (portado de
 * `DataListActionRail.test.tsx` de Thema y ampliado con la anatomía de la
 * barra: asa, ajustes, auto-ocultar, orientación, posición y bloqueo).
 * La barra se monta por portal a document.body.
 */
import { RAIL_KEYS, resetRailPreferences, setCompactViewport, sleep, visibleActionLabels } from './rail-test-dom';

import * as React from 'react';
import { describe, it, before, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type RailActionSpec = import('../rail-actions').RailActionSpec;
type RailProps = import('../data-list-action-rail').DataListActionRailProps;

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];
let DataListActionRail: (typeof import('../data-list-action-rail'))['DataListActionRail'];
let setRailPosition: (typeof import('../rail-preferences'))['setRailPosition'];

const ICON = <span data-testid="icono" />;

const ACTIONS: readonly RailActionSpec[] = [
  { id: 'create', label: 'Crear proceso', icon: ICON, scope: ['screen'], primary: true },
  { id: 'import', label: 'Cargar', icon: ICON, scope: ['screen'] },
  { id: 'edit', label: 'Editar', icon: ICON, scope: ['single'] },
  { id: 'duplicate', label: 'Duplicar', icon: ICON, scope: ['single', 'bulk'], countInLabel: true },
  { id: 'delete', label: 'Eliminar', icon: ICON, scope: ['single', 'bulk'], tone: 'danger', countInLabel: true },
];

function rail(props: Partial<RailProps> = {}) {
  return render(<DataListActionRail actions={ACTIONS} selectedCount={0} onClearSelection={() => {}} {...props} />);
}

const visibleActions = () => visibleActionLabels(screen.queryAllByRole('button'));
const railRoot = () => document.querySelector('[data-slot="action-rail"]') as HTMLElement;

async function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la barra' }));
  await screen.findByRole('button', { name: 'Vertical' });
}

before(async () => {
  ({ render, screen, fireEvent, cleanup, act } = await import('@testing-library/react'));
  ({ DataListActionRail } = await import('../data-list-action-rail'));
  ({ setRailPosition } = await import('../rail-preferences'));
});

beforeEach(() => {
  setCompactViewport(false);
});

afterEach(() => {
  cleanup();
  resetRailPreferences();
});

describe('DataListActionRail — qué acciones enseña', () => {
  it('sin selección solo salen las de la pantalla, con la primaria al final', () => {
    rail();

    assert.deepEqual(visibleActions(), ['Cargar', 'Crear proceso']);
  });

  it('la fila va de menor a mayor peso: lo plegado, lo de a diario y la principal', () => {
    rail({
      actions: [...ACTIONS, { id: 'settings', label: 'Activar equipo', icon: ICON, scope: ['screen'], overflow: true }],
    });

    assert.deepEqual(visibleActions(), ['Más acciones', 'Cargar', 'Crear proceso']);
  });

  it('una acción plegada se ejecuta desde el menú', async () => {
    let calls = 0;
    rail({
      actions: [
        ...ACTIONS,
        { id: 'settings', label: 'Activar equipo', icon: ICON, scope: ['screen'], overflow: true, onSelect: () => calls++ },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Activar equipo' }));

    assert.equal(calls, 1);
  });

  it('con un registro las de la pantalla se van y entran el recuento y las suyas', () => {
    rail({ selectedCount: 1 });

    const actions = visibleActions();
    assert.equal(actions.includes('Crear proceso'), false);
    assert.equal(actions.includes('Cargar'), false);
    assert.deepEqual(actions, ['Editar', 'Duplicar', 'Eliminar']);
    assert.ok(screen.getByText('1 seleccionado'));
  });

  it('con varios se cae lo que solo vale para uno y el recuento entra en la etiqueta', () => {
    rail({ selectedCount: 3 });

    assert.deepEqual(visibleActions(), ['Duplicar (3)', 'Eliminar (3)']);
  });

  it('el recuento se lee y su ✕ suelta la selección', () => {
    let cleared = 0;
    rail({ selectedCount: 2, onClearSelection: () => cleared++ });

    assert.ok(screen.getByText('2 seleccionados'));
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));

    assert.equal(cleared, 1);
  });

  it('el género concuerda', () => {
    rail({ selectedCount: 2, gender: 'f' });

    assert.ok(screen.getByText('2 seleccionadas'));
  });

  it('pulsar una acción avisa a quien la declaró', () => {
    let calls = 0;
    rail({
      selectedCount: 1,
      actions: [{ id: 'edit', label: 'Editar', icon: ICON, scope: ['single'], onSelect: () => calls++ }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    assert.equal(calls, 1);
  });

  it('`blockedReason` deja la acción a la vista, apagada, y no la ejecuta', () => {
    let calls = 0;
    rail({
      selectedCount: 2,
      actions: [
        {
          id: 'approve',
          label: 'Aprobar',
          icon: ICON,
          scope: ['single', 'bulk'],
          blockedReason: 'Aprobación masiva pendiente',
          onSelect: () => calls++,
        },
      ],
    });

    const button = screen.getByRole('button', { name: 'Aprobar' });
    fireEvent.click(button);

    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(calls, 0);
  });

  it('la primaria bloqueada tampoco se ejecuta', () => {
    let calls = 0;
    rail({
      actions: [
        { id: 'create', label: 'Crear', icon: ICON, scope: ['screen'], primary: true, blockedReason: 'Sin permiso', onSelect: () => calls++ },
      ],
    });

    const button = screen.getByRole('button', { name: 'Crear' });
    fireEvent.click(button);

    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(calls, 0);
  });

  it('lo que no cabe se pliega, pero una sola sobrante no monta un menú', () => {
    const six: readonly RailActionSpec[] = Array.from({ length: 6 }, (_, index) => ({
      id: `a${index}`,
      label: `Acción ${index}`,
      icon: ICON,
      scope: ['bulk'] as const,
    }));

    const { unmount } = rail({ selectedCount: 2, actions: six, inlineLimit: 5 });
    assert.equal(screen.queryByRole('button', { name: 'Más acciones' }), null);
    assert.equal(visibleActions().length, 6);
    unmount();

    rail({ selectedCount: 2, actions: six, inlineLimit: 3 });
    assert.ok(screen.getByRole('button', { name: 'Más acciones' }));
  });

  it('`locked` desmonta la barra en vez de dejarla flotando', () => {
    rail({ selectedCount: 1, locked: true });

    assert.equal(screen.queryAllByRole('button').length, 0);
  });

  it('sin nada marcado y sin acciones de pantalla no hay barra', () => {
    rail({ actions: ACTIONS.filter((action) => !action.scope.includes('screen')) });

    assert.equal(railRoot(), null);
  });
});

describe('DataListActionRail — primaria con opciones y grupos con menú', () => {
  it('la primaria con `options` abre un popover de creación y ejecuta la opción elegida', async () => {
    const chosen: string[] = [];
    rail({
      actions: [
        {
          id: 'add',
          label: 'Agregar prospectos',
          icon: ICON,
          scope: ['screen'],
          primary: true,
          options: [
            { id: 'ai', title: 'Generar con IA', description: 'La IA propone empresas.', icon: ICON, variant: 'ai', onSelect: () => chosen.push('ai') },
            { id: 'import', title: 'Importar archivo', description: 'Sube un CSV.', icon: ICON, onSelect: () => chosen.push('import') },
          ],
        },
      ],
    });

    assert.equal(screen.queryByText('Importar archivo'), null, 'las opciones no están a la vista hasta abrir');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar prospectos' }));
    assert.ok(await screen.findByText('La IA propone empresas.'));
    fireEvent.click(screen.getByRole('button', { name: /Importar archivo/ }));

    assert.deepEqual(chosen, ['import']);
  });

  it('la primaria `ai` conserva el degradado de marca', () => {
    rail({
      actions: [{ id: 'ai', label: 'Buscar con IA', icon: ICON, scope: ['screen'], primary: true, variant: 'ai' }],
    });

    const button = screen.getByRole('button', { name: 'Buscar con IA' });
    assert.equal(button.getAttribute('data-variant'), 'ai');
    assert.ok(button.classList.contains('su-ai-gradient'));
  });

  it('un grupo con `menu` despliega sus acciones, cada una con su propio bloqueo', async () => {
    let calls = 0;
    rail({
      selectedCount: 1,
      actions: [
        {
          id: 'more',
          label: 'Más acciones',
          icon: ICON,
          scope: ['single', 'bulk'],
          menu: [
            { id: 'dup', label: 'Marcar duplicado', icon: ICON, onSelect: () => calls++ },
            { id: 'enrich', label: 'Enviar a enriquecimiento', icon: ICON, blockedReason: 'Disponible en siguiente fase', onSelect: () => calls++ },
          ],
        },
      ],
    });

    assert.equal(screen.queryByText('Marcar duplicado'), null, 'las acciones del grupo viven dentro del menú');
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }));

    const blocked = (await screen.findByRole('button', { name: 'Enviar a enriquecimiento' })) as HTMLButtonElement;
    assert.equal(blocked.disabled, true);
    assert.ok(screen.getByText('Disponible en siguiente fase'), 'la razón se lee bajo el rótulo');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar duplicado' }));
    assert.equal(calls, 1);
  });
});

describe('ActionRailShell — anatomía de la barra', () => {
  it('es una barra de herramientas con nombre: asa, ajustes y luego las acciones', () => {
    rail({ label: 'Acciones de empresas' });

    const toolbar = screen.getByRole('toolbar', { name: 'Acciones de empresas' });
    const labels = Array.from(toolbar.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'));

    assert.deepEqual(labels, ['Mover barra de acciones', 'Ajustes de la barra', 'Cargar', 'Crear proceso']);
  });

  it('flota en document.body, fuera del árbol donde se declara', () => {
    const { container } = rail();

    assert.equal(container.contains(railRoot()), false);
    assert.ok(document.body.contains(railRoot()));
  });

  it('de fábrica va tendida, abierta y atracada abajo', () => {
    rail();

    assert.equal(railRoot().getAttribute('data-orientation'), 'horizontal');
    assert.equal(railRoot().getAttribute('data-state'), 'expanded');
    assert.equal(railRoot().getAttribute('data-docked'), 'true');
  });
});

describe('ActionRailShell — menú de ajustes y persistencia', () => {
  it('«Vertical» pone la barra de pie y lo recuerda', async () => {
    rail();
    await openSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Vertical' }));

    assert.equal(railRoot().getAttribute('data-orientation'), 'vertical');
    assert.equal(screen.getByRole('toolbar').getAttribute('aria-orientation'), 'vertical');
    assert.equal(window.localStorage.getItem(RAIL_KEYS.orientation), 'vertical');
  });

  it('de pie, el recuento pasa a una insignia y la primaria queda cuadrada', () => {
    window.localStorage.setItem(RAIL_KEYS.orientation, 'vertical');
    const { unmount } = rail({ selectedCount: 3 });
    assert.equal(screen.getByRole('status').textContent, '3');
    assert.equal(screen.getByRole('status').getAttribute('aria-label'), '3 seleccionados');
    unmount();

    rail();
    const primary = screen.getByRole('button', { name: 'Crear proceso' });
    assert.equal(primary.textContent, '', 'el rótulo pasa al tooltip');
  });

  it('«Ocultar sola» recoge la barra en su pastilla y lo recuerda; el cursor la vuelve a abrir', async () => {
    rail();
    await openSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar sola' }));
    assert.equal(window.localStorage.getItem(RAIL_KEYS.autoHide), 'true');

    // Con el menú de ajustes abierto la barra no se recoge; al cerrarlo, sí.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await act(async () => {
      await sleep(250);
    });
    cleanup();

    rail();
    assert.equal(railRoot().getAttribute('data-state'), 'collapsed');
    const pill = screen.getByRole('button', { name: 'Mostrar la barra de acciones' });
    assert.equal(screen.queryByRole('button', { name: 'Crear proceso' }), null, 'recogida, sus acciones no se alcanzan');

    fireEvent.mouseEnter(pill.parentElement as HTMLElement);
    assert.equal(railRoot().getAttribute('data-state'), 'expanded');
    assert.ok(screen.getByRole('button', { name: 'Crear proceso' }));

    fireEvent.mouseLeave(screen.getByRole('toolbar').parentElement?.parentElement as HTMLElement);
    await act(async () => {
      await sleep(250);
    });
    assert.equal(railRoot().getAttribute('data-state'), 'collapsed');
  });

  it('la pastilla también se abre al pulsarla (teclado y táctil)', () => {
    window.localStorage.setItem(RAIL_KEYS.autoHide, 'true');
    rail();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar la barra de acciones' }));

    assert.equal(railRoot().getAttribute('data-state'), 'expanded');
  });

  it('con selección la barra se queda abierta aunque esté en «Ocultar sola»', () => {
    window.localStorage.setItem(RAIL_KEYS.autoHide, 'true');
    rail({ selectedCount: 2 });

    assert.equal(railRoot().getAttribute('data-state'), 'expanded');
    assert.ok(screen.getByRole('button', { name: 'Duplicar (2)' }));
  });

  it('«Mantener abierta» la deja fija otra vez', async () => {
    window.localStorage.setItem(RAIL_KEYS.autoHide, 'true');
    rail({ selectedCount: 1 });
    await openSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Mantener abierta' }));

    assert.equal(window.localStorage.getItem(RAIL_KEYS.autoHide), 'false');
    assert.equal(screen.getByRole('button', { name: 'Mantener abierta' }).getAttribute('aria-pressed'), 'true');
  });

  it('lo guardado se aplica al montar: de pie y en el sitio donde se dejó', () => {
    window.localStorage.setItem(RAIL_KEYS.orientation, 'vertical');
    window.localStorage.setItem(RAIL_KEYS.position, JSON.stringify({ x: 400, y: 120 }));

    rail();

    assert.equal(railRoot().getAttribute('data-orientation'), 'vertical');
    assert.equal(railRoot().getAttribute('data-docked'), null);
    assert.equal(railRoot().style.left, '400px');
    assert.equal(railRoot().style.top, '120px');
  });

  it('«Volver a su sitio» solo se ofrece si se movió, y la devuelve a su atraque', async () => {
    rail();
    await openSettings();
    assert.equal((screen.getByRole('button', { name: 'Volver a su sitio' }) as HTMLButtonElement).disabled, true);

    act(() => setRailPosition({ x: 300, y: 200 }));
    assert.equal(railRoot().style.left, '300px');
    assert.equal(railRoot().getAttribute('data-docked'), null);

    fireEvent.click(screen.getByRole('button', { name: 'Volver a su sitio' }));

    assert.equal(window.localStorage.getItem(RAIL_KEYS.position), null);
    assert.equal(railRoot().getAttribute('data-docked'), 'true');
    assert.equal(railRoot().style.left, '');
  });

  it('una posición guardada corrupta se ignora', () => {
    window.localStorage.setItem(RAIL_KEYS.position, '{"x":"izquierda"}');

    rail();

    assert.equal(railRoot().getAttribute('data-docked'), 'true');
  });

  it('el doble clic en el asa también la devuelve a su sitio', () => {
    window.localStorage.setItem(RAIL_KEYS.position, JSON.stringify({ x: 300, y: 200 }));
    rail();

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Mover barra de acciones' }));

    assert.equal(window.localStorage.getItem(RAIL_KEYS.position), null);
    assert.equal(railRoot().getAttribute('data-docked'), 'true');
  });
});

describe('ActionRailShell — isBlocked', () => {
  it('se recoge en una pastilla inerte: ni acciones ni forma de abrirla', () => {
    rail({ isBlocked: true });

    assert.equal(railRoot().getAttribute('data-state'), 'blocked');
    assert.equal(screen.queryByRole('button', { name: 'Crear proceso' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Mostrar la barra de acciones' }), null);
    assert.equal(screen.queryByRole('toolbar'), null);
  });

  it('gana a la selección: bloqueada no ofrece acciones sobre lo marcado', () => {
    rail({ isBlocked: true, selectedCount: 2 });

    assert.equal(railRoot().getAttribute('data-state'), 'blocked');
    assert.equal(screen.queryByRole('button', { name: 'Eliminar (2)' }), null);
  });

  it('al desbloquearse vuelve sola', () => {
    const { rerender } = rail({ isBlocked: true });

    rerender(<DataListActionRail actions={ACTIONS} selectedCount={0} onClearSelection={() => {}} />);

    assert.equal(railRoot().getAttribute('data-state'), 'expanded');
    assert.ok(screen.getByRole('button', { name: 'Crear proceso' }));
  });
});

describe('DataListActionRail — pantalla estrecha', () => {
  it('es la misma pieza en su otra forma: un botón flotante, no una barra encogida', () => {
    setCompactViewport(true);
    rail();

    assert.equal(screen.queryByRole('toolbar'), null);
    assert.ok(screen.getByRole('button', { name: 'Abrir las acciones' }));
  });
});
