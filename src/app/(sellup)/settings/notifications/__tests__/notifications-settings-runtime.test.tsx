/**
 * Configuración › Avisos de Slack — contrato RUNTIME.
 *
 * Lo que se protege:
 *   - la matriz pinta cada aviso por rol, con «—» donde no aplica;
 *   - 🔴 mover un interruptor llama a `setNotificationSetting` con el rol, el aviso y el valor;
 *   - «Restablecer» manda `enabled: null` (vuelve al valor heredado);
 *   - si el servidor no guarda, el interruptor vuelve a su estado;
 *   - la vista previa del boletín pinta titular, alerta y cifras del pulso.
 *
 * Sin red ni base de datos: las acciones llegan por props como espías.
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { BulletinModel } from '@/modules/bulletin/bulletin-model';
import type { NotificationSettingRow } from '@/modules/notifications/notification-catalog';
import type { NotificationSettingsActions, NotificationSettingsData, RuleInput } from '../notification-settings-types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let NotificationsSettingsClient: (typeof import('../notifications-settings-client'))['NotificationsSettingsClient'];
let BulletinPreview: (typeof import('../bulletin-preview'))['BulletinPreview'];
let NOTIFICATION_CATALOG: (typeof import('@/modules/notifications/notification-catalog'))['NOTIFICATION_CATALOG'];

const h = React.createElement;

const ROLES = [
  { key: 'admin', label: 'Administrador' },
  { key: 'commercial_manager', label: 'Gerente comercial' },
  { key: 'commercial_lead', label: 'Líder comercial' },
  { key: 'seller_bd', label: 'Vendedor' },
  { key: 'growth', label: 'Growth' },
];

const calls: RuleInput[] = [];
let nextResult: { success: true; data: undefined } | { success: false; error: string } = { success: true, data: undefined };

function actions(): NotificationSettingsActions {
  return {
    setNotificationSetting: async (input) => {
      calls.push(input);
      return nextResult;
    },
    previewBulletin: async () => ({ success: false, error: 'no usado' }),
    sendBulletinPreviewToMe: async () => ({ success: false, error: 'no usado' }),
    getBulletinDelivery: async () => ({ success: false, error: 'no usado' }),
  };
}

function data(rows: NotificationSettingRow[] = []): NotificationSettingsData {
  return {
    catalog: [...NOTIFICATION_CATALOG],
    roles: ROLES,
    rows,
    users: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Bea Soto', email: 'bea@ubits.co', roleKey: 'seller_bd', roleLabel: 'Vendedor' }],
    ready: true,
  };
}

function renderClient(rows: NotificationSettingRow[] = []) {
  return render(h(NotificationsSettingsClient, { data: data(rows), history: [], actions: actions() }));
}

const switchFor = (label: string) => screen.getByRole('switch', { name: label });
const isChecked = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';

const MODEL: BulletinModel = {
  version: 1,
  frequency: 'weekly',
  period: {
    frequency: 'weekly',
    start: '2026-11-02',
    end: '2026-11-08',
    previousStart: '2026-10-26',
    previousEnd: '2026-11-01',
    label: 'Semana del 2 nov – 8 nov 2026',
    previousLabel: 'la semana anterior',
  },
  recipientName: 'Leonardo Ruiz',
  scopeLabel: 'Mid Market',
  teamSize: 6,
  moneyVisible: true,
  status: 'amarillo',
  headline: '5 de 6 personas trabajaron en SellUp · 12 empresas aprobadas (+20% vs. la semana anterior)',
  mainAlert: '1 persona tiene empresas por revisar con más de 7 días.',
  pulse: [
    { key: 'approved', label: 'Empresas aprobadas', emoji: '✅', value: 12, previous: 10, higherIsBetter: true, format: 'count' },
    { key: 'usageUsd', label: 'Consumo de IA y proveedores', emoji: '💳', value: 4.5, previous: 3, higherIsBetter: false, format: 'usd' },
  ],
  approvalRate: { before: 50, now: 60 },
  funnel: [
    { label: 'Encontradas', value: 40 },
    { label: 'Aprobadas', value: 12 },
  ],
  teams: [{ name: 'Equipo Carla', people: 3, approved: 8, discarded: 2, pending: 4, oldestDays: 9, active: 3 }],
  behind: [{ name: 'Ana Gómez', pending: 4, oldestDays: 9 }],
  inactive: ['Pedro Díaz'],
  closing: 'Revisar los pendientes de más de 7 días y sostener el ritmo de aprobación.',
};

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ NotificationsSettingsClient } = await import('../notifications-settings-client'));
  ({ BulletinPreview } = await import('../bulletin-preview'));
  ({ NOTIFICATION_CATALOG } = await import('@/modules/notifications/notification-catalog'));
});

beforeEach(() => {
  calls.length = 0;
  nextResult = { success: true, data: undefined };
});

afterEach(() => cleanup());

describe('Avisos por rol — la matriz', () => {
  it('pinta cada aviso con su valor por rol y «—» donde no aplica', () => {
    renderClient();
    assert.ok(screen.getByRole('table', { name: 'Avisos por rol' }));
    assert.equal(isChecked(switchFor('Boletín semanal — Líder comercial')), true, 'semanal encendido por defecto para líderes');
    assert.equal(isChecked(switchFor('Boletín semanal — Vendedor')), false);
    // Las alertas de consumo sólo aplican a administración.
    assert.ok(switchFor('Consumo de proveedores (80 % y 100 %) — Administrador'));
    assert.equal(screen.queryByRole('switch', { name: 'Consumo de proveedores (80 % y 100 %) — Vendedor' }), null);
  });

  it('🔴 mover un interruptor guarda la regla de ESE rol y ESE aviso', async () => {
    renderClient();
    fireEvent.click(switchFor('Boletín diario — Vendedor'));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0], { scopeType: 'role', scopeId: 'seller_bd', notificationKey: 'bulletin_daily', enabled: true });
    await waitFor(() => assert.equal(isChecked(switchFor('Boletín diario — Vendedor')), true));
  });

  it('«Restablecer» quita la regla del rol (enabled: null)', async () => {
    renderClient([{ scope_type: 'role', scope_id: 'growth', notification_key: 'run_finished', enabled: false }]);
    assert.equal(isChecked(switchFor('Tu búsqueda terminó — Growth')), false);
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer Tu búsqueda terminó — Growth' }));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0], { scopeType: 'role', scopeId: 'growth', notificationKey: 'run_finished', enabled: null });
    await waitFor(() => assert.equal(isChecked(switchFor('Tu búsqueda terminó — Growth')), true));
  });

  it('si el servidor no guarda, el interruptor vuelve a su estado', async () => {
    nextResult = { success: false, error: 'No se pudo guardar.' };
    renderClient();
    fireEvent.click(switchFor('Boletín mensual — Administrador'));
    await waitFor(() => assert.equal(calls.length, 1));
    await waitFor(() => assert.equal(isChecked(switchFor('Boletín mensual — Administrador')), false));
  });
});

describe('Vista previa del boletín', () => {
  it('pinta encabezado, semáforo, titular, alerta y cifras del pulso', () => {
    render(h(BulletinPreview, { model: MODEL }));
    assert.ok(screen.getByRole('heading', { name: 'Boletín semanal' }));
    assert.ok(screen.getByText('Para revisar'));
    assert.ok(screen.getByText(MODEL.headline));
    assert.ok(screen.getByText(MODEL.mainAlert as string));
    const approved = screen.getByTestId('pulse-approved');
    assert.match(approved.textContent ?? '', /12/);
    assert.match(approved.textContent ?? '', /▲ \+20 %/);
    const usage = screen.getByTestId('pulse-usageUsd');
    assert.match(usage.textContent ?? '', /US\$4,50/);
    assert.ok(screen.getByText('Equipo Carla'));
    assert.ok(screen.getByText('Ana Gómez'));
    assert.ok(screen.getByText(MODEL.closing));
  });
});
