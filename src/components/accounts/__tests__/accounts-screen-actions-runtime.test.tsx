/**
 * AccountsScreenActions + GenerateProspectsAgentActions — contrato RUNTIME.
 *   - «Empresas»: primaria «Crear empresa» + «Rumbo», que pregunta primero qué
 *     hacer (prospectar, buscar contactos o preparar el primer contacto; dueña 18-10).
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
  onBack?: () => void;
}

function fakePanel(name: string) {
  return function FakePanel({ open, onOpenChange, onBack }: PanelProps) {
    if (open === undefined) return <p>{`${name}: sin controlar`}</p>;
    if (!open) return null;
    return (
      <div role="dialog" aria-label={name}>
        {onBack && <button type="button" onClick={onBack}>{`Volver desde ${name}`}</button>}
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

mock.module('../../contact-enrichment/contacts-enrichment-cta', {
  namedExports: { ContactsEnrichmentCTA: fakePanel('buscar contactos') },
});
mock.module('../../first-call/first-contact-outside-launcher', {
  namedExports: { FirstContactOutsideLauncher: fakePanel('primer contacto') },
});
// El agente de Empresas pregunta primero qué hacer (dueña 18-10): un doble con sus opciones.
mock.module('../accounts-agent-chooser', {
  namedExports: {
    AccountsAgentChooser: ({ open, onChoose, prospect, firstContactAvailable }: PanelProps & {
      onChoose: (flow: string) => void;
      prospect: string;
      firstContactAvailable: boolean;
    }) =>
      open ? (
        <div role="dialog" aria-label="qué hacer">
          {prospect !== 'none' && <button type="button" onClick={() => onChoose('prospect')}>{`Prospectar (${prospect})`}</button>}
          <button type="button" onClick={() => onChoose('contacts')}>Buscar contactos</button>
          {firstContactAvailable && <button type="button" onClick={() => onChoose('first-contact')}>Preparar el primer contacto</button>}
        </div>
      ) : null,
  },
});

const FakeGenerateDrawer = fakePanel('asistente de IA');

const openDialogs = () => screen.queryAllByRole('dialog').map((dialog) => dialog.getAttribute('aria-label'));
const railState = () => document.querySelector('[data-slot="action-rail"]')?.getAttribute('data-state');
const toolbarLabels = () =>
  visibleActionLabels(Array.from(screen.getByRole('toolbar').querySelectorAll<HTMLElement>('button')));

function renderAccounts(isGenerateAvailable: boolean | null = true, firstCallEnabled = true) {
  return render(
    <ListActionRailProvider label="Acciones de empresas" gender="f">
      <AccountsScreenActions
        users={[]}
        firstCallEnabled={firstCallEnabled}
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

describe('Empresas — «Crear empresa» y el agente, que pregunta qué hacer', () => {
  it('la primaria sigue siendo «Crear empresa» y el agente cierra la barra', () => {
    renderAccounts();

    assert.deepEqual(toolbarLabels(), ['Crear empresa', 'Rumbo IA']);
    assert.equal(screen.getByRole('button', { name: 'Rumbo IA' }).getAttribute('data-variant'), 'ai');
    assert.equal(screen.queryByText(/sin controlar/), null, 'los paneles se montan controlados, sin su botón');
  });

  it('el agente pregunta qué hacer y cada respuesta abre su flujo; la barra se recoge', () => {
    renderAccounts();

    fireEvent.click(screen.getByRole('button', { name: 'Rumbo IA' }));
    assert.deepEqual(openDialogs(), ['qué hacer']);
    assert.equal(railState(), 'blocked');

    fireEvent.click(screen.getByRole('button', { name: 'Prospectar (available)' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asistente de IA' }));
    assert.deepEqual(openDialogs(), []);
    assert.equal(railState(), 'expanded');

    fireEvent.click(screen.getByRole('button', { name: 'Rumbo IA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buscar contactos' }));
    assert.deepEqual(openDialogs(), ['buscar contactos']);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar buscar contactos' }));

    fireEvent.click(screen.getByRole('button', { name: 'Rumbo IA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preparar el primer contacto' }));
    assert.deepEqual(openDialogs(), ['primer contacto']);
  });

  it('desde cualquiera de los tres caminos, «Volver» regresa a «¿Qué quieres hacer?»', () => {
    renderAccounts();

    for (const [option, panel] of [
      ['Prospectar (available)', 'asistente de IA'],
      ['Buscar contactos', 'buscar contactos'],
      ['Preparar el primer contacto', 'primer contacto'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Rumbo IA' }));
      fireEvent.click(screen.getByRole('button', { name: option }));
      assert.deepEqual(openDialogs(), [panel]);
      fireEvent.click(screen.getByRole('button', { name: `Volver desde ${panel}` }));
      assert.deepEqual(openDialogs(), ['qué hacer'], `volver desde ${panel}`);
      fireEvent.click(screen.getByRole('button', { name: /^Buscar contactos$/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar buscar contactos' }));
    }
  });

  it('«Crear empresa» abre su panel y solo ese', () => {
    renderAccounts();

    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));

    assert.deepEqual(openDialogs(), ['crear empresa']);
  });

  it('🔴 sin búsqueda disponible, «Prospectar» abre la explicación (nunca la búsqueda)', () => {
    renderAccounts(false);

    fireEvent.click(screen.getByRole('button', { name: 'Rumbo IA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prospectar (unavailable)' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });

  it('si el servidor no pudo resolver la búsqueda, el agente sigue (contactos y primer contacto) sin prospectar', () => {
    renderAccounts(null);

    fireEvent.click(screen.getByRole('button', { name: 'Rumbo IA' }));
    assert.equal(screen.queryByRole('button', { name: /Prospectar/ }), null);
    assert.ok(screen.getByRole('button', { name: 'Buscar contactos' }));
  });

  it('con el Agente 3 apagado no se ofrece preparar el primer contacto', () => {
    renderAccounts(true, false);

    fireEvent.click(screen.getByRole('button', { name: 'Rumbo IA' }));
    assert.equal(screen.queryByRole('button', { name: 'Preparar el primer contacto' }), null);
  });

  it('con las acciones «En la pantalla»: «Crear empresa» rellena y el botón de IA al final', () => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline');
    renderAccounts();

    assert.equal(screen.queryByRole('toolbar'), null);
    assert.deepEqual(
      screen.getAllByRole('button').map((button) => button.textContent),
      ['Crear empresa', 'Rumbo IA'],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rumbo IA' }));
    assert.deepEqual(openDialogs(), ['qué hacer']);
  });
});

describe('Descartadas — el agente «Generar con IA»', () => {
  it('la barra lleva solo el agente, a un clic', () => {
    renderDiscarded();

    assert.deepEqual(toolbarLabels(), ['Generar con Rumbo IA']);
    fireEvent.click(screen.getByRole('button', { name: 'Generar con Rumbo IA' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });

  it('🔴 sin búsqueda disponible: «Búsqueda no disponible», nunca «Generar con IA»', () => {
    renderDiscarded(false);

    assert.deepEqual(toolbarLabels(), ['Búsqueda no disponible']);
    assert.equal(screen.queryByText('Generar con Rumbo IA'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Búsqueda no disponible' }));
    assert.deepEqual(openDialogs(), ['asistente de IA']);
  });
});
