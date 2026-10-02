/**
 * ContactsScreenActions — contrato RUNTIME. En «Contactos» y en «Por revisar»
 * la primaria es «Crear contacto» y «Buscar contactos con IA» es el agente de
 * la barra (degradado de IA, a un clic). Cada uno abre SU panel y solo ese.
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
let ContactsScreenActions: (typeof import('../contacts-screen-actions'))['ContactsScreenActions'];
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

// Especificadores RELATIVOS (ver nota en accounts-screen-actions-runtime).
mock.module('../create-contact-drawer', {
  namedExports: { CreateContactDrawer: fakePanel('crear contacto') },
});
mock.module('../../contact-enrichment/contacts-enrichment-cta', {
  namedExports: { ContactsEnrichmentCTA: fakePanel('búsqueda con IA') },
});

const openDialogs = () => screen.queryAllByRole('dialog').map((dialog) => dialog.getAttribute('aria-label'));
const toolbarLabels = () =>
  visibleActionLabels(Array.from(screen.getByRole('toolbar').querySelectorAll<HTMLElement>('button')));

function renderActions() {
  return render(
    <ListActionRailProvider label="Acciones de contactos" gender="m">
      <ContactsScreenActions accounts={[]} />
    </ListActionRailProvider>,
  );
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ContactsScreenActions } = await import('../contacts-screen-actions'));
  ({ ListActionRailProvider } = await import('../../action-rail'));
});

beforeEach(() => setCompactViewport(false));

afterEach(() => {
  cleanup();
  resetRailPreferences();
});

describe('ContactsScreenActions — «Crear contacto» y el agente de IA', () => {
  it('la primaria es «Crear contacto» y «Buscar contactos con IA» es el agente', () => {
    renderActions();

    assert.deepEqual(toolbarLabels(), ['Crear contacto', 'Buscar contactos con IA']);
    const agent = screen.getByRole('button', { name: 'Buscar contactos con IA' });
    assert.equal(agent.getAttribute('data-slot'), 'rail-agent');
    assert.ok(agent.className.includes('bg-ai-gradient'));
    assert.equal(screen.queryByText(/sin controlar/), null);
  });

  it('el agente abre la búsqueda con UN clic, y solo ese panel', () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Buscar contactos con IA' }));

    assert.deepEqual(openDialogs(), ['búsqueda con IA']);
  });

  it('«Crear contacto» abre su panel y solo ese', () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));

    assert.deepEqual(openDialogs(), ['crear contacto']);
  });

  it('con las acciones «En la pantalla»: «Crear contacto» rellena y el botón de IA al final', () => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline');
    renderActions();

    assert.equal(screen.queryByRole('toolbar'), null);
    assert.deepEqual(
      screen.getAllByRole('button').map((button) => button.textContent),
      ['Crear contacto', 'Buscar contactos con IA'],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buscar contactos con IA' }));
    assert.deepEqual(openDialogs(), ['búsqueda con IA']);
  });
});
