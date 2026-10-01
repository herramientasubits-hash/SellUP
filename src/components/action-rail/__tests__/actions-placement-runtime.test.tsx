/**
 * «Dónde van las acciones» — contrato RUNTIME de la preferencia GLOBAL de la
 * persona (Thema · `actionsPlacement`) y del agente de IA de la barra
 * (Thema · `railAgent`):
 *
 *   1. Se cambia desde los ajustes de la barra y persiste en este navegador.
 *   2. «En la pantalla»: la barra flotante NO se monta (ni con selección), el
 *      hueco reservado desaparece y las MISMAS acciones —con los mismos
 *      bloqueos— se pintan en la cabecera.
 *   3. El agente de IA cierra la barra con el degradado de IA y la chispa, a un
 *      clic; en la cabecera es el botón de IA; en móvil, una fila con su tono.
 */
import {
  ACTIONS_PLACEMENT_KEY,
  resetRailPreferences,
  setCompactViewport,
  visibleActionLabels,
} from './rail-test-dom';

import * as React from 'react';
import { describe, it, before, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type RailActionSpec = import('../rail-actions').RailActionSpec;

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];
let ListActionRailProvider: (typeof import('../list-action-rail'))['ListActionRailProvider'];
let RailScreenActions: (typeof import('../list-action-rail'))['RailScreenActions'];
let ActionRailReserve: (typeof import('../list-action-rail'))['ActionRailReserve'];
let useRailSelectionReporter: (typeof import('../list-action-rail'))['useRailSelectionReporter'];
let setActionsPlacement: (typeof import('../actions-placement'))['setActionsPlacement'];
let useActionsPlacement: (typeof import('../actions-placement'))['useActionsPlacement'];
let useRailVisible: (typeof import('../rail-agent'))['useRailVisible'];

const ICON = <span data-testid="icono" />;
const fired: string[] = [];

const SCREEN_ACTIONS: readonly RailActionSpec[] = [
  { id: 'rules', label: 'Reglas de asignación', icon: ICON, scope: ['screen'], overflow: true, onSelect: () => fired.push('rules') },
  { id: 'import', label: 'Importar', icon: ICON, scope: ['screen'], onSelect: () => fired.push('import') },
  {
    id: 'export',
    label: 'Exportar',
    icon: ICON,
    scope: ['screen'],
    blockedReason: 'No hay nada que exportar',
    onSelect: () => fired.push('export'),
  },
  { id: 'create', label: 'Crear empresa', icon: ICON, scope: ['screen'], primary: true, onSelect: () => fired.push('create') },
];

const AI_AGENT: RailActionSpec = {
  id: 'agent',
  label: 'Generar con IA',
  icon: ICON,
  scope: ['screen'],
  variant: 'ai',
  onSelect: () => fired.push('agent'),
};

const PLAIN_AGENT: RailActionSpec = {
  id: 'agent',
  label: 'Búsqueda no disponible',
  icon: ICON,
  scope: ['screen'],
  onSelect: () => fired.push('agent-unavailable'),
};

/** Hace de tabla: cuenta su selección a la barra de la pantalla. */
function FakeList() {
  const report = useRailSelectionReporter();
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    report?.(
      count > 0
        ? {
            count,
            actions: [{ id: 'archive', label: 'Archivar', icon: ICON, scope: ['single', 'bulk'] }],
            onClear: () => setCount(0),
          }
        : null,
    );
  }, [report, count]);
  return (
    <button type="button" onClick={() => setCount(2)}>
      Marcar dos
    </button>
  );
}

function Probe() {
  const [placement] = useActionsPlacement();
  const isRailVisible = useRailVisible();
  return (
    <p data-testid="probe" data-placement={placement} data-rail-visible={String(isRailVisible)} />
  );
}

function Screen({ agent = null, actions = SCREEN_ACTIONS }: { agent?: RailActionSpec | null; actions?: readonly RailActionSpec[] }) {
  return (
    <ListActionRailProvider label="Acciones de empresas" gender="f">
      <header data-testid="cabecera">
        <RailScreenActions actions={actions} agent={agent} />
      </header>
      <FakeList />
      <Probe />
    </ListActionRailProvider>
  );
}

const header = () => screen.getByTestId('cabecera');
const probe = () => screen.getByTestId('probe');
const reserve = () => document.querySelector('[data-slot="action-rail-reserve"]') as HTMLElement;
const rail = () => document.querySelector('[data-slot="action-rail"]');
const toolbarLabels = () =>
  visibleActionLabels(Array.from(screen.getByRole('toolbar').querySelectorAll<HTMLElement>('button')));

before(async () => {
  ({ render, screen, within, fireEvent, cleanup, act } = await import('@testing-library/react'));
  ({ ListActionRailProvider, RailScreenActions, ActionRailReserve, useRailSelectionReporter } = await import(
    '../list-action-rail'
  ));
  ({ setActionsPlacement, useActionsPlacement } = await import('../actions-placement'));
  ({ useRailVisible } = await import('../rail-agent'));
});

beforeEach(() => {
  setCompactViewport(false);
  fired.length = 0;
});

afterEach(() => {
  cleanup();
  resetRailPreferences();
});

describe('Dónde van las acciones — preferencia global', () => {
  it('de fábrica mandan la barra y su hueco; la cabecera no pinta botones', () => {
    render(<Screen />);

    assert.equal(probe().getAttribute('data-placement'), 'rail');
    assert.ok(rail());
    assert.equal(probe().getAttribute('data-rail-visible'), 'true');
    assert.ok(reserve().classList.contains('pb-20'));
    assert.equal(within(header()).queryAllByRole('button').length, 0);
  });

  it('los ajustes de la barra ofrecen el grupo, con «En esta barra» marcada', async () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la barra' }));

    const group = await screen.findByRole('group', { name: 'Dónde van las acciones' });
    assert.equal(within(group).getByRole('button', { name: 'En esta barra' }).getAttribute('aria-pressed'), 'true');
    assert.equal(within(group).getByRole('button', { name: 'En la pantalla' }).getAttribute('aria-pressed'), 'false');
  });

  it('«En la pantalla» desde los ajustes apaga la barra, quita el hueco y se recuerda', async () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la barra' }));
    fireEvent.click(await screen.findByRole('button', { name: 'En la pantalla' }));

    assert.equal(window.localStorage.getItem(ACTIONS_PLACEMENT_KEY), 'inline');
    assert.equal(rail(), null, 'la barra flotante no se monta');
    assert.equal(screen.queryByRole('toolbar'), null);
    assert.equal(probe().getAttribute('data-rail-visible'), 'false');
    assert.equal(reserve().classList.contains('pb-20'), false);
    assert.equal(reserve().classList.contains('pr-20'), false);
    // Y las acciones están en la cabecera.
    assert.ok(within(header()).getByRole('button', { name: 'Crear empresa' }));
  });

  it('lo guardado se aplica al volver a entrar (otra pantalla, otra sesión)', () => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline');
    render(<Screen />);

    assert.equal(probe().getAttribute('data-placement'), 'inline');
    assert.equal(rail(), null);
  });

  it('se vuelve a la barra desde fuera de ella (Personalización usa este mismo ajuste)', () => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline');
    render(<Screen />);
    assert.equal(rail(), null);

    act(() => setActionsPlacement('rail'));

    assert.ok(rail());
    assert.equal(window.localStorage.getItem(ACTIONS_PLACEMENT_KEY), 'rail');
    assert.ok(reserve().classList.contains('pb-20'));
    assert.equal(within(header()).queryAllByRole('button').length, 0);
  });

  it('un valor desconocido guardado cae en la barra', () => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'lo-que-sea');
    render(<Screen />);
    assert.equal(probe().getAttribute('data-placement'), 'rail');
  });

  it('en modo pantalla la barra tampoco aparece al marcar filas, ni en móvil', () => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline');
    setCompactViewport(true);
    render(<Screen />);

    fireEvent.click(screen.getByRole('button', { name: 'Marcar dos' }));

    assert.equal(rail(), null);
    assert.equal(screen.queryByRole('button', { name: 'Abrir las acciones' }), null, 'tampoco el botón flotante');
    assert.equal(reserve().classList.contains('pb-20'), false);
  });

  it('ActionRailReserve (esqueleto de carga) reserva lo mismo que la pantalla', () => {
    const view = render(<ActionRailReserve>contenido</ActionRailReserve>);
    assert.ok(reserve().classList.contains('pb-20'));
    view.unmount();

    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline');
    render(<ActionRailReserve>contenido</ActionRailReserve>);
    assert.equal(reserve().classList.contains('pb-20'), false);
  });
});

describe('Acciones en la cabecera — las mismas, con los mismos bloqueos', () => {
  beforeEach(() => window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline'));

  it('el mismo reparto: «⋯» con lo plegado, lo de a diario a la vista y la principal al final', () => {
    render(<Screen />);

    const labels = within(header())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    assert.deepEqual(labels, ['Más acciones', 'Importar', 'Exportar', 'Crear empresa']);
    assert.equal(within(header()).getByRole('button', { name: 'Crear empresa' }).getAttribute('data-variant'), 'default');
    assert.equal(within(header()).getByRole('button', { name: 'Importar' }).getAttribute('data-variant'), 'outline');
  });

  it('disparan exactamente lo que declaró la pantalla', async () => {
    render(<Screen />);

    fireEvent.click(within(header()).getByRole('button', { name: 'Importar' }));
    fireEvent.click(within(header()).getByRole('button', { name: 'Crear empresa' }));
    fireEvent.click(within(header()).getByRole('button', { name: 'Más acciones' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reglas de asignación' }));

    assert.deepEqual(fired, ['import', 'create', 'rules']);
  });

  it('🔴 una acción bloqueada sigue bloqueada: a la vista, apagada y sin disparar', () => {
    render(<Screen />);

    const blocked = within(header()).getByRole('button', { name: 'Exportar' });
    assert.equal(blocked.getAttribute('aria-disabled'), 'true');
    fireEvent.click(blocked);

    assert.deepEqual(fired, []);
  });

  it('🔴 y bloqueada en la barra igual: es la misma `RailActionSpec`', () => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'rail');
    render(<Screen />);

    const blocked = screen.getByRole('button', { name: 'Exportar' });
    assert.equal(blocked.getAttribute('aria-disabled'), 'true');
    fireEvent.click(blocked);

    assert.deepEqual(fired, []);
  });

  it('el agente de IA cierra la cabecera como botón de IA', () => {
    render(<Screen agent={AI_AGENT} />);

    const buttons = within(header()).getAllByRole('button');
    const agent = buttons[buttons.length - 1];
    assert.equal(agent.textContent, 'Generar con IA');
    assert.ok(agent.className.includes('su-ai-gradient'), 'es el AIButton del sistema');

    fireEvent.click(agent);
    assert.deepEqual(fired, ['agent']);
  });

  it('un agente sin IA («Búsqueda no disponible») no lleva el degradado', () => {
    render(<Screen agent={PLAIN_AGENT} />);

    const agent = within(header()).getByRole('button', { name: 'Búsqueda no disponible' });
    assert.equal(agent.className.includes('su-ai-gradient'), false);
    assert.equal(agent.getAttribute('data-variant'), 'outline');

    fireEvent.click(agent);
    assert.deepEqual(fired, ['agent-unavailable']);
  });
});

describe('El agente de IA en la barra', () => {
  it('cierra la barra, después de la principal, con el degradado de IA y su nombre accesible', () => {
    render(<Screen agent={AI_AGENT} />);

    assert.deepEqual(toolbarLabels(), ['Más acciones', 'Importar', 'Exportar', 'Crear empresa', 'Generar con IA']);
    const agent = screen.getByRole('button', { name: 'Generar con IA' });
    assert.equal(agent.getAttribute('data-slot'), 'rail-agent');
    assert.equal(agent.getAttribute('data-variant'), 'ai');
    assert.ok(agent.className.includes('bg-ai-gradient'));
    assert.equal(agent.textContent, '', 'solo la chispa: el nombre va en el tooltip');
  });

  it('está a UN clic', () => {
    render(<Screen agent={AI_AGENT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generar con IA' }));

    assert.deepEqual(fired, ['agent']);
  });

  it('de pie es el mismo botón', () => {
    window.localStorage.setItem('sellup:action-rail:orientation', 'vertical');
    render(<Screen agent={AI_AGENT} />);

    const agent = screen.getByRole('button', { name: 'Generar con IA' });
    assert.ok(agent.className.includes('bg-ai-gradient'));
    assert.ok(agent.className.includes('size-10'));
  });

  it('una pantalla que solo tiene agente también tiene barra', () => {
    render(<Screen agent={AI_AGENT} actions={[]} />);

    assert.deepEqual(toolbarLabels(), ['Generar con IA']);
  });

  it('sin agente y sin acciones no hay barra', () => {
    render(<Screen actions={[]} />);
    assert.equal(screen.queryByRole('toolbar'), null);
  });

  it('con filas marcadas deja paso a las acciones sobre lo marcado', () => {
    render(<Screen agent={AI_AGENT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Marcar dos' }));

    assert.equal(screen.queryByRole('button', { name: 'Generar con IA' }), null);
    assert.ok(screen.getByRole('button', { name: 'Archivar' }));
  });

  it('🔴 «Búsqueda no disponible» no se viste de IA: es un icono más de la barra', () => {
    render(<Screen agent={PLAIN_AGENT} />);

    const agent = screen.getByRole('button', { name: 'Búsqueda no disponible' });
    assert.equal(agent.className.includes('bg-ai-gradient'), false);
    assert.equal(screen.queryByRole('button', { name: 'Generar con IA' }), null);

    fireEvent.click(agent);
    assert.deepEqual(fired, ['agent-unavailable']);
  });

  it('fuera de un proveedor, la barra propia de la pantalla también lo lleva', () => {
    render(<RailScreenActions actions={SCREEN_ACTIONS} agent={AI_AGENT} />);
    assert.ok(screen.getByRole('button', { name: 'Generar con IA' }));
  });

  it('en móvil es una acción más del abanico, con su tono de IA', () => {
    setCompactViewport(true);
    render(<Screen agent={AI_AGENT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir las acciones' }));
    const row = screen.getByRole('button', { name: 'Generar con IA' });
    assert.ok(row.querySelector('[data-variant="ai"]')?.className.includes('bg-ai-gradient'));

    fireEvent.click(row);
    assert.deepEqual(fired, ['agent']);
  });
});
