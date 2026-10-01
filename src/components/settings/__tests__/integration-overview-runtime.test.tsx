/**
 * Pantalla de una integración — contrato RUNTIME: el estado se dice en una
 * palabra que alguien entiende, y lo que SellUp puede hacer se lee en tareas.
 */

import './jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let overview: typeof import('../integration-overview');

const h = React.createElement;

before(async () => {
  ({ render, screen, within, cleanup } = await import('@testing-library/react'));
  overview = await import('../integration-overview');
});

afterEach(() => {
  cleanup();
});

describe('resolveIntegrationHealth', () => {
  it('🔴 sin credencial es «sin conectar», diga lo que diga el estado guardado', () => {
    assert.equal(overview.resolveIntegrationHealth(false, 'connected'), 'not_connected');
    assert.equal(overview.resolveIntegrationHealth(false, undefined), 'not_connected');
  });

  it('con credencial respeta conectado, error y desconectado', () => {
    assert.equal(overview.resolveIntegrationHealth(true, 'connected'), 'connected');
    assert.equal(overview.resolveIntegrationHealth(true, 'error'), 'error');
    assert.equal(overview.resolveIntegrationHealth(true, 'disconnected'), 'disconnected');
  });

  it('con credencial y sin prueba (o un estado desconocido) es «sin probar»', () => {
    assert.equal(overview.resolveIntegrationHealth(true, 'not_tested'), 'not_tested');
    assert.equal(overview.resolveIntegrationHealth(true, null), 'not_tested');
    assert.equal(overview.resolveIntegrationHealth(true, 'algo_nuevo'), 'not_tested');
  });
});

describe('IntegrationStatusCard', () => {
  it('conectado: lo dice, con la fecha de la última prueba', () => {
    render(
      h(overview.IntegrationStatusCard, {
        name: 'HubSpot',
        hasCredential: true,
        connectionStatus: 'connected',
        lastTestedAt: '2026-09-26T12:00:00Z',
      }),
    );

    assert.ok(screen.getByText('Conectado'));
    assert.ok(screen.getByText('SellUp puede hablar con HubSpot.'));
    assert.equal(screen.queryByText('Aún no se ha probado'), null);
  });

  it('sin conectar: invita a conectar y no inventa una fecha', () => {
    render(
      h(overview.IntegrationStatusCard, {
        name: 'Slack',
        hasCredential: false,
        connectionStatus: undefined,
        lastTestedAt: null,
      }),
    );

    assert.ok(screen.getByText('Sin conectar'));
    assert.ok(screen.getByText('Conecta Slack para empezar a usarlo desde SellUp.'));
    assert.ok(screen.getByText('Aún no se ha probado'));
  });

  it('con error: muestra qué falló', () => {
    render(
      h(overview.IntegrationStatusCard, {
        name: 'Tavily',
        hasCredential: true,
        connectionStatus: 'error',
        lastTestedAt: '2026-09-26T12:00:00Z',
        lastError: 'La clave ya no es válida.',
      }),
    );

    assert.ok(screen.getByText('Con error'));
    assert.ok(within(screen.getByRole('alert')).getByText('La clave ya no es válida.'));
  });

  it('pinta los datos de uso y las acciones que recibe', () => {
    render(
      h(
        overview.IntegrationStatusCard,
        {
          name: 'Slack',
          hasCredential: true,
          connectionStatus: 'connected',
          lastTestedAt: null,
          facts: [{ label: 'Canal oficial', value: 'sellup-alertas' }],
        },
        h('button', { type: 'button' }, 'Probar conexión'),
      ),
    );

    assert.ok(screen.getByText('Canal oficial'));
    assert.ok(screen.getByText('sellup-alertas'));
    assert.ok(screen.getByRole('button', { name: 'Probar conexión' }));
  });
});

describe('IntegrationCapabilities', () => {
  const capabilities = [
    { label: 'Consultar empresas', state: 'ready' as const },
    { label: 'Crear contactos', state: 'missing' as const, hint: 'Añade el permiso en HubSpot.' },
    { label: 'Consultar contactos', state: 'pending' as const, hint: 'No debe leerse.' },
    { label: 'Enviar avisos', state: 'soon' as const },
  ];

  it('dice de cada tarea si está disponible, falta permiso, está por comprobar o llegará', () => {
    render(h(overview.IntegrationCapabilities, { name: 'HubSpot', capabilities }));

    assert.ok(screen.getByText('Qué puede hacer SellUp con HubSpot'));
    const rows = screen.getAllByRole('listitem');
    assert.equal(rows.length, 4);
    assert.ok(within(rows[0]).getByText('Disponible'));
    assert.ok(within(rows[1]).getByText('Falta permiso'));
    assert.ok(within(rows[2]).getByText('Por comprobar'));
    assert.ok(within(rows[3]).getByText('Próximamente'));
  });

  it('la pista de qué falta solo se lee cuando de verdad falta el permiso', () => {
    render(h(overview.IntegrationCapabilities, { name: 'HubSpot', capabilities }));

    assert.ok(screen.getByText('Añade el permiso en HubSpot.'));
    assert.equal(screen.queryByText('No debe leerse.'), null);
  });
});
