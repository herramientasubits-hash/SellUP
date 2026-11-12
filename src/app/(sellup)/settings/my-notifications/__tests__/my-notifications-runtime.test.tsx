/**
 * Configuración › Mis avisos de Slack — contrato RUNTIME.
 *
 * Lo que se protege:
 *   - sólo se pintan los avisos que llegan del servidor (ya filtrados por rol),
 *     separados en «Boletín» y «Avisos»;
 *   - 🔴 mover un interruptor llama a `setMyNotificationSetting` con ese aviso;
 *   - «Volver a lo de mi rol» manda `enabled: null`;
 *   - si el servidor no guarda, el interruptor vuelve a su estado;
 *   - sin la tabla (ready=false) se avisa con calma y no se puede cambiar nada.
 *
 * Sin red ni base de datos: las acciones llegan por props como espías.
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { MyNotificationSettings } from '@/modules/notifications/my-notification-actions';
import type { MyNotificationsActions } from '../my-notifications-client';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let MyNotificationsClient: (typeof import('../my-notifications-client'))['MyNotificationsClient'];
let notificationDefinition: (typeof import('@/modules/notifications/notification-catalog'))['notificationDefinition'];

const h = React.createElement;
const ME = '44444444-4444-4444-4444-444444444444';

const calls: Array<{ notificationKey: string; enabled: boolean | null }> = [];
let nextResult: { success: true; data: undefined } | { success: false; error: string } = { success: true, data: undefined };

function item(key: string, enabled: boolean, source: 'personal' | 'rol' | 'por_defecto' = 'por_defecto') {
  const definition = notificationDefinition(key);
  assert.ok(definition, key);
  return { definition, enabled, source };
}

// Un vendedor: no ve las alertas de proveedores (sólo admin) porque el servidor no las manda.
function data(ready = true): MyNotificationSettings {
  return {
    userId: ME,
    name: 'Bea Soto',
    roleKey: 'seller_bd',
    ready,
    items: [
      item('assignments', true),
      item('run_finished', true),
      item('bulletin_weekly', false),
      item('bulletin_daily', true, 'personal'),
    ],
  };
}

function actions(): MyNotificationsActions {
  return {
    getMyNotificationSettings: async () => ({ success: false, error: 'no usado' }),
    setMyNotificationSetting: async (input) => {
      calls.push(input);
      return nextResult;
    },
    previewMyBulletin: async () => ({ success: false, error: 'no usado' }),
    getMyBulletinHistory: async () => ({ success: true, data: [] }),
    getMyBulletinDelivery: async () => ({ success: false, error: 'no usado' }),
  };
}

const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ MyNotificationsClient } = await import('../my-notifications-client'));
  ({ notificationDefinition } = await import('@/modules/notifications/notification-catalog'));
});

beforeEach(() => {
  calls.length = 0;
  nextResult = { success: true, data: undefined };
});

afterEach(() => cleanup());

describe('Mis avisos de Slack', () => {
  it('sólo pinta lo que aplica a mi rol, separado en Boletín y Avisos', () => {
    render(h(MyNotificationsClient, { data: data(), actions: actions() }));
    const bulletins = screen.getByRole('list', { name: 'Mis boletines' });
    const notices = screen.getByRole('list', { name: 'Mis avisos' });
    assert.equal(bulletins.querySelectorAll('[role="switch"]').length, 2);
    assert.equal(notices.querySelectorAll('[role="switch"]').length, 2);
    // Diario antes que semanal, aunque el servidor los mande al revés.
    assert.match(bulletins.textContent ?? '', /Boletín diario[\s\S]*Boletín semanal/);
    assert.equal(screen.queryByRole('switch', { name: 'Consumo de proveedores (80 % y 100 %)' }), null);
    assert.ok(screen.getByText('Lo elegiste tú'));
  });

  it('🔴 mover un interruptor guarda MI regla de ese aviso', async () => {
    render(h(MyNotificationsClient, { data: data(), actions: actions() }));
    fireEvent.click(screen.getByRole('switch', { name: 'Boletín semanal' }));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0], { notificationKey: 'bulletin_weekly', enabled: true });
    await waitFor(() => assert.equal(isChecked(screen.getByRole('switch', { name: 'Boletín semanal' })), true));
  });

  it('«Volver a lo de mi rol» quita mi regla (enabled: null)', async () => {
    render(h(MyNotificationsClient, { data: data(), actions: actions() }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver a lo de mi rol: Boletín diario' }));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0], { notificationKey: 'bulletin_daily', enabled: null });
  });

  it('si el servidor no guarda, el interruptor vuelve a su estado', async () => {
    nextResult = { success: false, error: 'No se pudo guardar.' };
    render(h(MyNotificationsClient, { data: data(), actions: actions() }));
    fireEvent.click(screen.getByRole('switch', { name: 'Tu búsqueda terminó' }));
    await waitFor(() => assert.equal(calls.length, 1));
    await waitFor(() => assert.equal(isChecked(screen.getByRole('switch', { name: 'Tu búsqueda terminó' })), true));
  });

  it('sin la tabla lista avisa con calma y no deja cambiar', () => {
    render(h(MyNotificationsClient, { data: data(false), actions: actions() }));
    assert.ok(screen.getByText('Todavía no se pueden guardar cambios'));
    const sw = screen.getByRole('switch', { name: 'Boletín semanal' });
    fireEvent.click(sw);
    assert.equal(calls.length, 0);
  });
});
