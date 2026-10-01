/**
 * ProspectingProviderCard — contrato RUNTIME de la tarjeta común a Apollo y
 * Lusha.
 *
 * Lo que se protege:
 *   - conectar llama a la acción de conectar DEL PROVEEDOR QUE SE LE PASÓ, con
 *     la clave escrita, y no a ninguna otra;
 *   - actualizar la clave llama a la de actualizar, no a la de conectar;
 *   - desconectar borra una credencial: solo se dispara tras confirmar; ni al
 *     abrir la pregunta ni al cancelarla.
 *
 * Sin red: las cuatro acciones llegan por props y aquí son espías.
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ProspectingProviderConnection } from '@/modules/prospecting-config/types';
import type { ProspectingProviderActions } from '../prospecting-provider-card';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ProspectingProviderCard: (typeof import('../prospecting-provider-card'))['ProspectingProviderCard'];
let Search: (typeof import('@/icons'))['Search'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ProspectingProviderCard } = await import('../prospecting-provider-card'));
  ({ Search } = await import('@/icons'));
});

afterEach(() => {
  cleanup();
});

const API_KEY = 'clave-de-prueba-123456';

function connectedConnection(): ProspectingProviderConnection {
  return {
    id: 'conn-1',
    provider_id: 'prov-1',
    vault_secret_id: null,
    credentials_status: 'stored',
    connection_status: 'connected',
    last_tested_at: null,
    last_connected_at: null,
    last_connection_error: null,
    configured_by: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  };
}

/** Acciones espía: cada llamada queda anotada con el nombre del proveedor. */
function spyActions(tag: string, log: string[]): ProspectingProviderActions {
  return {
    connect: async (apiKey) => {
      log.push(`${tag}:connect:${apiKey}`);
      return { success: true };
    },
    updateApiKey: async (apiKey) => {
      log.push(`${tag}:update:${apiKey}`);
      return { success: true };
    },
    testConnection: async () => {
      log.push(`${tag}:test`);
      return { success: true };
    },
    disconnect: async () => {
      log.push(`${tag}:disconnect`);
      return { success: true };
    },
  };
}

function renderCard(options: {
  tag: string;
  name: string;
  log: string[];
  connection: ProspectingProviderConnection | null;
}) {
  return render(
    h(ProspectingProviderCard, {
      providerId: options.tag,
      name: options.name,
      icon: Search,
      purpose: 'Prospección',
      credentialDescription: 'La clave se guarda cifrada.',
      credentialHint: 'Depende de tu plan.',
      connection: options.connection,
      description: null,
      actions: spyActions(options.tag, options.log),
    }),
  );
}

describe('ProspectingProviderCard — conectar', () => {
  it('sin credencial ofrece conectar y no las acciones de un proveedor ya conectado', () => {
    renderCard({ tag: 'lusha', name: 'Lusha', log: [], connection: null });
    assert.ok(screen.getByRole('button', { name: 'Conectar Lusha' }));
    assert.equal(screen.queryByRole('button', { name: 'Desconectar' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Probar conexión' }), null);
    assert.ok(screen.getByText('No configurado'));
  });

  it('abrir el diálogo no llama a nada y no deja guardar una clave demasiado corta', () => {
    const log: string[] = [];
    renderCard({ tag: 'lusha', name: 'Lusha', log, connection: null });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar Lusha' }));

    const save = screen.getByRole('button', { name: 'Guardar credencial' }) as HTMLButtonElement;
    assert.equal(save.disabled, true);
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'corta' } });
    assert.equal(save.disabled, true);
    assert.deepEqual(log, []);
  });

  it('guardar llama a la acción de conectar del proveedor que se le pasó, con la clave', async () => {
    const log: string[] = [];
    renderCard({ tag: 'lusha', name: 'Lusha', log, connection: null });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar Lusha' }));
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: `  ${API_KEY}  ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar credencial' }));

    await waitFor(() => assert.deepEqual(log, [`lusha:connect:${API_KEY}`]));
    // Queda guardada pero sin probar: lo dice el estado y aparecen las acciones.
    await waitFor(() => assert.ok(screen.getByText('Credencial guardada')));
    assert.ok(screen.getByRole('button', { name: 'Probar conexión' }));
  });

  it('con otro proveedor, la misma tarjeta llama a las acciones de ese otro', async () => {
    const log: string[] = [];
    renderCard({ tag: 'apollo', name: 'Apollo.io', log, connection: null });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar Apollo.io' }));
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: API_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar credencial' }));

    await waitFor(() => assert.deepEqual(log, [`apollo:connect:${API_KEY}`]));
  });

  it('si el servidor rechaza la clave, el error se ve en el campo y el diálogo sigue abierto', async () => {
    const actions: ProspectingProviderActions = {
      ...spyActions('lusha', []),
      connect: async () => ({ success: false, error: 'La API Key es inválida.' }),
    };
    render(
      h(ProspectingProviderCard, {
        providerId: 'lusha',
        name: 'Lusha',
        icon: Search,
        purpose: 'Prospección',
        credentialDescription: 'La clave se guarda cifrada.',
        credentialHint: 'Depende de tu plan.',
        connection: null,
        description: null,
        actions,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Conectar Lusha' }));
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: API_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar credencial' }));

    await waitFor(() => assert.ok(screen.getByText('La API Key es inválida.')));
    // El diálogo no se cierra: al terminar el guardado vuelve a ofrecer guardar.
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Guardar credencial' })));
  });
});

describe('ProspectingProviderCard — proveedor ya conectado', () => {
  it('actualizar la clave llama a la acción de actualizar, no a la de conectar', async () => {
    const log: string[] = [];
    renderCard({ tag: 'apollo', name: 'Apollo.io', log, connection: connectedConnection() });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar API Key' }));
    // El `id` del campo sale de `providerId`: es el contrato con la etiqueta.
    const input = document.getElementById('apollo-api-key');
    assert.ok(input, 'el campo de la clave lleva el id del proveedor');
    fireEvent.change(input, { target: { value: API_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar credencial' }));

    await waitFor(() => assert.deepEqual(log, [`apollo:update:${API_KEY}`]));
  });

  it('probar conexión llama solo a la prueba', async () => {
    const log: string[] = [];
    renderCard({ tag: 'apollo', name: 'Apollo.io', log, connection: connectedConnection() });
    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }));
    await waitFor(() => assert.deepEqual(log, ['apollo:test']));
  });
});

describe('ProspectingProviderCard — desconectar solo tras confirmar', () => {
  it('pulsar Desconectar pregunta y NO desconecta', () => {
    const log: string[] = [];
    renderCard({ tag: 'apollo', name: 'Apollo.io', log, connection: connectedConnection() });
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));

    assert.ok(screen.getByText('¿Desconectar Apollo.io?'));
    assert.deepEqual(log, []);
  });

  it('cancelar la pregunta no desconecta y el proveedor sigue conectado', async () => {
    const log: string[] = [];
    renderCard({ tag: 'apollo', name: 'Apollo.io', log, connection: connectedConnection() });
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => assert.equal(screen.queryByText('¿Desconectar Apollo.io?'), null));
    assert.deepEqual(log, []);
    assert.ok(screen.getByText('Conectado'));
  });

  it('confirmar llama una vez a la acción de desconectar de ese proveedor', async () => {
    const log: string[] = [];
    renderCard({ tag: 'apollo', name: 'Apollo.io', log, connection: connectedConnection() });
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));

    const dialog = screen.getByText('¿Desconectar Apollo.io?').closest('[role="alertdialog"], [role="dialog"]');
    assert.ok(dialog, 'la pregunta se pinta en un diálogo');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Desconectar',
    );
    assert.ok(confirm, 'el diálogo tiene su botón de confirmar');
    fireEvent.click(confirm);

    await waitFor(() => assert.deepEqual(log, ['apollo:disconnect']));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Conectar Apollo.io' })));
  });

  it('si desconectar falla, se dice por qué y el proveedor sigue conectado', async () => {
    const actions: ProspectingProviderActions = {
      ...spyActions('apollo', []),
      disconnect: async () => ({ success: false, error: 'No autorizado.' }),
    };
    render(
      h(ProspectingProviderCard, {
        providerId: 'apollo',
        name: 'Apollo.io',
        icon: Search,
        purpose: 'Prospección',
        credentialDescription: 'La clave se guarda cifrada.',
        credentialHint: 'Depende de tu plan.',
        connection: connectedConnection(),
        description: null,
        actions,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    const dialog = screen.getByText('¿Desconectar Apollo.io?').closest('[role="alertdialog"], [role="dialog"]');
    assert.ok(dialog);
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Desconectar',
    );
    assert.ok(confirm);
    fireEvent.click(confirm);

    await waitFor(() => assert.ok(screen.getByText('No autorizado.')));
    assert.ok(screen.getByText('Conectado'));
  });
});
