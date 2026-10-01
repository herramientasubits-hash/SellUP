/**
 * ProspectsScreenActions — contrato RUNTIME. Las acciones de pantalla de «Por
 * revisar» en la barra flotante: UNA acción primaria que abre un popover de
 * creación con las tres maneras de traer prospectos.
 *
 * Protege dos cosas que antes garantizaban los tres botones sueltos:
 *   1. Cada opción abre SU panel y solo ese (nunca dos a la vez).
 *   2. Capa 4 del cerco del camino heredado: cuando el servidor resuelve que la
 *      búsqueda con IA no puede ejecutarse, la barra NO ofrece «Generar con IA»
 *      — ofrece «Búsqueda no disponible», que abre la explicación.
 *
 * Los tres paneles se sustituyen por dobles ligeros: aquí no hay acciones de
 * servidor, ni red, ni proveedores.
 */
import { resetRailPreferences, setCompactViewport } from '@/components/action-rail/__tests__/rail-test-dom';

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

async function chooseOption(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: 'Agregar prospectos' }));
  fireEvent.click(await screen.findByRole('button', { name }));
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ProspectsScreenActions } = await import('../prospects-screen-actions'));
});

beforeEach(() => setCompactViewport(false));

afterEach(() => {
  cleanup();
  resetRailPreferences();
});

describe('ProspectsScreenActions — una primaria con tres maneras de agregar', () => {
  it('la barra ofrece una sola acción y ningún panel está abierto', () => {
    renderActions();

    const actions = Array.from(screen.getByRole('toolbar').querySelectorAll('button'), (button) =>
      button.getAttribute('aria-label'),
    ).filter((label) => label && !/Mover barra|Ajustes de la barra/.test(label));

    assert.deepEqual(actions, ['Agregar prospectos']);
    assert.deepEqual(openDialogs(), []);
    assert.equal(screen.queryByText(/sin controlar/), null, 'los tres paneles se montan controlados, sin su botón');
  });

  it('el popover de creación explica las tres opciones', async () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Agregar prospectos' }));

    assert.ok(await screen.findByRole('button', { name: /Generar con IA/ }));
    assert.ok(screen.getByRole('button', { name: /Importar archivo/ }));
    assert.ok(screen.getByRole('button', { name: /Crear a mano/ }));
  });

  for (const [option, panel] of [
    [/Generar con IA/, 'asistente de IA'],
    [/Importar archivo/, 'importar'],
    [/Crear a mano/, 'crear a mano'],
  ] as const) {
    it(`«${option.source}» abre su panel y solo ese; al cerrarlo la barra vuelve`, async () => {
      renderActions();

      await chooseOption(option);

      assert.deepEqual(openDialogs(), [panel]);
      assert.equal(railState(), 'blocked', 'la barra se recoge mientras el panel tiene la pantalla');

      fireEvent.click(screen.getByRole('button', { name: `Cerrar ${panel}` }));

      assert.deepEqual(openDialogs(), []);
      assert.equal(railState(), 'expanded');
    });
  }
});

describe('ProspectsScreenActions — búsqueda con IA no disponible', () => {
  it('🔴 la barra no ofrece «Generar con IA»: ofrece «Búsqueda no disponible»', async () => {
    renderActions(false);

    fireEvent.click(screen.getByRole('button', { name: 'Agregar prospectos' }));

    assert.ok(await screen.findByRole('button', { name: /Búsqueda no disponible/ }));
    assert.equal(screen.queryByText('Generar con IA'), null);
    // Importar y crear a mano no dependen de la búsqueda: siguen disponibles.
    assert.ok(screen.getByRole('button', { name: /Importar archivo/ }));
    assert.ok(screen.getByRole('button', { name: /Crear a mano/ }));
  });

  it('abre el mismo panel del asistente, que es quien explica por qué', async () => {
    renderActions(false);

    await chooseOption(/Búsqueda no disponible/);

    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });
});
