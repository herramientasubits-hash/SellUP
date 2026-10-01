/**
 * ProspectsScreenActions — contrato RUNTIME. Las acciones de pantalla de «Por
 * revisar»: la IA a UN clic (el agente de la barra) e «Importar archivo» y
 * «Crear a mano» como acciones de pantalla, sin repetir la IA.
 *
 * Protege lo mismo que protegía con el popover «Agregar prospectos»:
 *   1. Cada entrada abre SU panel y solo ese (nunca dos a la vez).
 *   2. Capa 4 del cerco del camino heredado: cuando el servidor resuelve que la
 *      búsqueda con IA no puede ejecutarse, la barra NO ofrece «Generar con IA»
 *      — ofrece «Búsqueda no disponible», que abre la explicación.
 * Y lo mismo con las acciones «En la pantalla» (cabecera en vez de barra).
 *
 * Los tres paneles se sustituyen por dobles ligeros: aquí no hay acciones de
 * servidor, ni red, ni proveedores.
 */
import {
  ACTIONS_PLACEMENT_KEY,
  resetRailPreferences,
  setCompactViewport,
  visibleActionLabels,
} from '@/components/action-rail/__tests__/rail-test-dom';

import * as React from 'react';
import { describe, it, before, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ProspectsScreenActions: (typeof import('../prospects-screen-actions'))['ProspectsScreenActions'];

interface PanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Un panel de mentira: dice si está abierto y deja cerrarlo. */
function fakePanel(name: string) {
  return function FakePanel({ open, onOpenChange }: PanelProps) {
    if (open === undefined) return <p>{`${name}: sin controlar`}</p>;
    if (!open) return null;
    return (
      <div role="dialog" aria-label={name}>
        <button type="button" onClick={() => onOpenChange?.(false)}>{`Cerrar ${name}`}</button>
      </div>
    );
  };
}

mock.module('@/components/prospect-batches/import-candidates-drawer', {
  namedExports: { ImportCandidatesDrawer: fakePanel('importar') },
});
mock.module('@/components/prospect-batches/create-candidate-drawer', {
  namedExports: { CreateCandidateDrawer: fakePanel('crear a mano') },
});

const FakeGenerateDrawer = fakePanel('asistente de IA');

function renderActions(isGenerateAvailable = true) {
  return render(
    <ProspectsScreenActions generateDrawer={<FakeGenerateDrawer />} isGenerateAvailable={isGenerateAvailable} />,
  );
}

const railState = () => document.querySelector('[data-slot="action-rail"]')?.getAttribute('data-state');
const openDialogs = () => screen.queryAllByRole('dialog').map((dialog) => dialog.getAttribute('aria-label'));

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ProspectsScreenActions } = await import('../prospects-screen-actions'));
});

beforeEach(() => setCompactViewport(false));

afterEach(() => {
  cleanup();
  resetRailPreferences();
});

const toolbarLabels = () =>
  visibleActionLabels(Array.from(screen.getByRole('toolbar').querySelectorAll<HTMLElement>('button')));

describe('ProspectsScreenActions — la IA a un clic y dos acciones de pantalla', () => {
  it('la barra ofrece importar, crear a mano y el agente de IA; ningún panel está abierto', () => {
    renderActions();

    assert.deepEqual(toolbarLabels(), ['Importar archivo', 'Crear a mano', 'Generar con IA']);
    assert.equal(screen.getByRole('button', { name: 'Generar con IA' }).getAttribute('data-slot'), 'rail-agent');
    assert.deepEqual(openDialogs(), []);
    assert.equal(screen.queryByText(/sin controlar/), null, 'los tres paneles se montan controlados, sin su botón');
  });

  it('ya no hay «Agregar prospectos»: la IA no se esconde tras un popover ni se repite', () => {
    renderActions();

    assert.equal(screen.queryByRole('button', { name: 'Agregar prospectos' }), null);
    assert.equal(screen.getAllByRole('button', { name: /Generar con IA/ }).length, 1);
  });

  for (const [action, panel] of [
    ['Generar con IA', 'asistente de IA'],
    ['Importar archivo', 'importar'],
    ['Crear a mano', 'crear a mano'],
  ] as const) {
    it(`«${action}» abre su panel con UN clic y solo ese; al cerrarlo la barra vuelve`, () => {
      renderActions();

      fireEvent.click(screen.getByRole('button', { name: action }));

      assert.deepEqual(openDialogs(), [panel]);
      assert.equal(railState(), 'blocked', 'la barra se recoge mientras el panel tiene la pantalla');

      fireEvent.click(screen.getByRole('button', { name: `Cerrar ${panel}` }));

      assert.deepEqual(openDialogs(), []);
      assert.equal(railState(), 'expanded');
    });
  }
});

describe('ProspectsScreenActions — búsqueda con IA no disponible', () => {
  it('🔴 la barra no ofrece «Generar con IA»: ofrece «Búsqueda no disponible», sin vestirla de IA', () => {
    renderActions(false);

    const agent = screen.getByRole('button', { name: 'Búsqueda no disponible' });
    assert.equal(agent.className.includes('bg-ai-gradient'), false);
    assert.equal(screen.queryByRole('button', { name: /Generar con IA/ }), null);
    assert.equal(screen.queryByText('Generar con IA'), null);
    // Importar y crear a mano no dependen de la búsqueda: siguen disponibles.
    assert.ok(screen.getByRole('button', { name: 'Importar archivo' }));
    assert.ok(screen.getByRole('button', { name: 'Crear a mano' }));
  });

  it('abre el mismo panel del asistente, que es quien explica por qué', () => {
    renderActions(false);

    fireEvent.click(screen.getByRole('button', { name: 'Búsqueda no disponible' }));

    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });
});

describe('ProspectsScreenActions — con las acciones «En la pantalla»', () => {
  beforeEach(() => window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline'));

  it('son botones de la cabecera, con la IA al final; no hay barra', () => {
    renderActions();

    assert.equal(screen.queryByRole('toolbar'), null);
    assert.deepEqual(
      screen.getAllByRole('button').map((button) => button.textContent),
      ['Importar archivo', 'Crear a mano', 'Generar con IA'],
    );
  });

  it('cada botón abre su panel y solo ese', () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Generar con IA' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asistente de IA' }));

    fireEvent.click(screen.getByRole('button', { name: 'Importar archivo' }));
    assert.deepEqual(openDialogs(), ['importar']);
  });

  it('🔴 sin búsqueda disponible tampoco aquí se ofrece «Generar con IA»', () => {
    renderActions(false);

    assert.equal(screen.queryByText('Generar con IA'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Búsqueda no disponible' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });
});
