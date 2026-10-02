/**
 * AccountsScreenActions + GenerateProspectsAgentActions — contrato RUNTIME.
 * El agente «Generar con IA» está en las tres pestañas del módulo Empresas, a
 * un clic, y abre el MISMO asistente que resolvió el servidor:
 *   - «Empresas»: primaria «Crear empresa» + el agente.
 *   - «Descartadas»: solo el agente.
 *   («Por revisar» tiene su propia prueba: prospects-screen-actions-runtime.)
 * 🔴 Si la búsqueda no puede ejecutarse, el agente se llama «Búsqueda no
 * disponible» y abre la explicación; nunca «Generar con IA».
 *
 * Los paneles se sustituyen por dobles: sin servidor, sin red, sin proveedores.
 */
import {
  ACTIONS_PLACEMENT_KEY,
  resetRailPreferences,
  setCompactViewport,
  visibleActionLabels,
} from '../../action-rail/__tests__/rail-test-dom';

import * as React from 'react';
import { describe, it, before, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let AccountsScreenActions: (typeof import('../accounts-screen-actions'))['AccountsScreenActions'];
let GenerateProspectsAgentActions: (typeof import('../../prospects/generate-prospects-agent'))['GenerateProspectsAgentActions'];
let ListActionRailProvider: (typeof import('../../action-rail'))['ListActionRailProvider'];

interface PanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

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

// Especificador RELATIVO: con los hooks ESM de CI, `mock.module('@/…')` se
// resuelve respecto a este archivo.
mock.module('../create-account-drawer', {
  namedExports: { CreateAccountDrawer: fakePanel('crear empresa') },
});

const FakeGenerateDrawer = fakePanel('asistente de IA');

const openDialogs = () => screen.queryAllByRole('dialog').map((dialog) => dialog.getAttribute('aria-label'));
const railState = () => document.querySelector('[data-slot="action-rail"]')?.getAttribute('data-state');
const toolbarLabels = () =>
  visibleActionLabels(Array.from(screen.getByRole('toolbar').querySelectorAll<HTMLElement>('button')));

function renderAccounts(isGenerateAvailable: boolean | null = true) {
  return render(
    <ListActionRailProvider label="Acciones de empresas" gender="f">
      <AccountsScreenActions
        users={[]}
        generateAgent={
          isGenerateAvailable === null ? null : { generateDrawer: <FakeGenerateDrawer />, isGenerateAvailable }
        }
      />
    </ListActionRailProvider>,
  );
}

function renderDiscarded(isGenerateAvailable = true) {
  return render(
    <ListActionRailProvider label="Acciones de empresas descartadas" gender="f">
      <GenerateProspectsAgentActions
        generateDrawer={<FakeGenerateDrawer />}
        isGenerateAvailable={isGenerateAvailable}
      />
    </ListActionRailProvider>,
  );
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ AccountsScreenActions } = await import('../accounts-screen-actions'));
  ({ GenerateProspectsAgentActions } = await import('../../prospects/generate-prospects-agent'));
  ({ ListActionRailProvider } = await import('../../action-rail'));
});

beforeEach(() => setCompactViewport(false));

afterEach(() => {
  cleanup();
  resetRailPreferences();
});

describe('Empresas — «Crear empresa» y el agente «Generar con IA»', () => {
  it('la primaria sigue siendo «Crear empresa» y el agente cierra la barra', () => {
    renderAccounts();

    assert.deepEqual(toolbarLabels(), ['Crear empresa', 'Generar con IA']);
    assert.equal(screen.getByRole('button', { name: 'Generar con IA' }).getAttribute('data-variant'), 'ai');
    assert.equal(screen.queryByText(/sin controlar/), null, 'los paneles se montan controlados, sin su botón');
  });

  it('«Generar con IA» abre el asistente con UN clic; la barra se recoge', () => {
    renderAccounts();

    fireEvent.click(screen.getByRole('button', { name: 'Generar con IA' }));

    assert.deepEqual(openDialogs(), ['asistente de IA']);
    assert.equal(railState(), 'blocked');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asistente de IA' }));
    assert.deepEqual(openDialogs(), []);
    assert.equal(railState(), 'expanded');
  });

  it('«Crear empresa» abre su panel y solo ese', () => {
    renderAccounts();

    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));

    assert.deepEqual(openDialogs(), ['crear empresa']);
  });

  it('🔴 sin búsqueda disponible el agente es «Búsqueda no disponible» y abre la explicación', () => {
    renderAccounts(false);

    assert.deepEqual(toolbarLabels(), ['Crear empresa', 'Búsqueda no disponible']);
    assert.equal(screen.queryByText('Generar con IA'), null);
    assert.equal(
      screen.getByRole('button', { name: 'Búsqueda no disponible' }).className.includes('bg-ai-gradient'),
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Búsqueda no disponible' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });

  it('si el servidor no pudo resolver el agente, la pantalla sale sin él y sigue funcionando', () => {
    renderAccounts(null);

    assert.deepEqual(toolbarLabels(), ['Crear empresa']);
    assert.equal(screen.queryByRole('button', { name: /Generar con IA|Búsqueda no disponible/ }), null);
  });

  it('con las acciones «En la pantalla»: «Crear empresa» rellena y el botón de IA al final', () => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline');
    renderAccounts();

    assert.equal(screen.queryByRole('toolbar'), null);
    assert.deepEqual(
      screen.getAllByRole('button').map((button) => button.textContent),
      ['Crear empresa', 'Generar con IA'],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generar con IA' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });
});

describe('Descartadas — el agente «Generar con IA»', () => {
  it('la barra lleva solo el agente, a un clic', () => {
    renderDiscarded();

    assert.deepEqual(toolbarLabels(), ['Generar con IA']);
    fireEvent.click(screen.getByRole('button', { name: 'Generar con IA' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });

  it('🔴 sin búsqueda disponible: «Búsqueda no disponible», nunca «Generar con IA»', () => {
    renderDiscarded(false);

    assert.deepEqual(toolbarLabels(), ['Búsqueda no disponible']);
    assert.equal(screen.queryByText('Generar con IA'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Búsqueda no disponible' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });
});
