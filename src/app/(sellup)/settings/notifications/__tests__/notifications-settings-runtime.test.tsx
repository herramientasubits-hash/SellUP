/**
 * Configuración › Avisos de Slack — contrato RUNTIME.
 *
 * Lo que se protege:
 *   - la matriz pinta cada aviso por rol, con «—» donde no aplica;
 *   - 🔴 mover un interruptor llama a `setNotificationSetting` con el rol, el aviso y el valor;
 *   - «Restablecer» manda `enabled: null` (vuelve al valor heredado);
 *   - si el servidor no guarda, el interruptor vuelve a su estado;
 *   - la vista previa del boletín pinta titular, alerta y cifras del pulso;
 *   - «Boletín»: la lista de personas se filtra por rol y por frecuencia activa;
 *     el interruptor semanal de una persona guarda una regla `user` con su id;
 *     el visor con fecha pide ese día; pulsar un enviado lo abre en el visor.
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

const BEA = '11111111-1111-1111-1111-111111111111';
const LEO = '22222222-2222-2222-2222-222222222222';
const GUS = '33333333-3333-3333-3333-333333333333';

const calls: RuleInput[] = [];
const previewCalls: Array<{ userId: string; frequency: string; day?: string | null }> = [];
const historyCalls: Array<string | null | undefined> = [];
const deliveryCalls: string[] = [];
let nextResult: { success: true; data: undefined } | { success: false; error: string } = { success: true, data: undefined };

function actions(): NotificationSettingsActions {
  return {
    setNotificationSetting: async (input) => {
      calls.push(input);
      return nextResult;
    },
    previewBulletin: async (input) => {
      previewCalls.push(input);
      return { success: true, data: MODEL };
    },
    sendBulletinPreviewToMe: async () => ({ success: false, error: 'no usado' }),
    getBulletinHistory: async (userId) => {
      historyCalls.push(userId);
      return { success: true, data: userId === LEO ? SENT : [] };
    },
    getBulletinDelivery: async (id) => {
      deliveryCalls.push(id);
      return { success: true, data: MODEL };
    },
  };
}

const SENT = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', recipientId: LEO, recipientName: 'Leo Ruiz', frequency: 'weekly' as const, periodStart: '2026-11-02', periodEnd: '2026-11-08', status: 'sent', manual: false, createdAt: '2026-11-09T13:16:00Z' },
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', recipientId: LEO, recipientName: 'Leo Ruiz', frequency: 'monthly' as const, periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'failed', manual: false, createdAt: '2026-11-01T13:16:00Z' },
];

function data(rows: NotificationSettingRow[] = []): NotificationSettingsData {
  return {
    catalog: [...NOTIFICATION_CATALOG],
    roles: ROLES,
    rows,
    users: [
      { id: BEA, name: 'Bea Soto', email: 'bea@ubits.co', roleKey: 'seller_bd', roleLabel: 'Vendedor' },
      { id: LEO, name: 'Leo Ruiz', email: 'leo@ubits.co', roleKey: 'commercial_lead', roleLabel: 'Líder comercial' },
      { id: GUS, name: 'Gus Paz', email: 'gus@ubits.co', roleKey: 'growth', roleLabel: 'Growth' },
    ],
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
  previewCalls.length = 0;
  historyCalls.length = 0;
  deliveryCalls.length = 0;
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

// ---------------------------------------------------------------------------
// «Boletín»: personas a la izquierda, sus boletines y el visor a la derecha.
// ---------------------------------------------------------------------------

async function chooseOption(comboboxName: string, optionName: string) {
  const trigger = screen.getByRole('combobox', { name: comboboxName });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.click(trigger, { button: 0 });
  const option = await waitFor(() => screen.getByRole('option', { name: optionName }));
  fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseUp(option, { button: 0 });
  fireEvent.click(option, { button: 0 });
}

function openBulletinTab(rows: NotificationSettingRow[] = []) {
  renderClient(rows);
  const tab = screen.getByRole('tab', { name: 'Boletín' });
  fireEvent.pointerDown(tab, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

const peopleNames = () =>
  Array.from(screen.getByRole('list', { name: 'Lista de personas' }).querySelectorAll('li button')).map((b) => b.getAttribute('aria-label'));

describe('Boletín — personas y filtros', () => {
  it('sin elegir a nadie muestra el vacío y la lista con chips de lo que le llega', async () => {
    openBulletinTab();
    await waitFor(() => assert.ok(screen.getByText('Elige una persona')));
    assert.deepEqual(peopleNames(), ['Bea Soto', 'Leo Ruiz', 'Gus Paz']);
    // El semanal está encendido por defecto para líderes.
    assert.match(screen.getByTestId(`chips-${LEO}`).textContent ?? '', /Semanal/);
    assert.match(screen.getByTestId(`chips-${BEA}`).textContent ?? '', /Sin boletín/);
  });

  it('filtra por rol', async () => {
    openBulletinTab();
    await waitFor(() => assert.ok(screen.getByRole('combobox', { name: 'Rol' })));
    await chooseOption('Rol', 'Growth');
    await waitFor(() => assert.deepEqual(peopleNames(), ['Gus Paz']));
    assert.ok(screen.getByText('1 persona'));
  });

  it('filtra por frecuencia activa (incluida una regla personal) y por «Sin boletín»', async () => {
    openBulletinTab([{ scope_type: 'user', scope_id: GUS, notification_key: 'bulletin_daily', enabled: true }]);
    await waitFor(() => assert.ok(screen.getByRole('combobox', { name: 'Frecuencia activa' })));
    await chooseOption('Frecuencia activa', 'Diario');
    await waitFor(() => assert.deepEqual(peopleNames(), ['Gus Paz']));
    await chooseOption('Frecuencia activa', 'Sin boletín');
    await waitFor(() => assert.deepEqual(peopleNames(), ['Bea Soto']));
  });
});

describe('Boletín — una persona', () => {
  it('🔴 encender su semanal guarda una regla de ESA persona (scope user)', async () => {
    openBulletinTab();
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Bea Soto' })));
    fireEvent.click(screen.getByRole('button', { name: 'Bea Soto' }));
    const sw = await waitFor(() => screen.getByRole('switch', { name: 'Boletín semanal de Bea Soto' }));
    assert.equal(isChecked(sw), false);
    fireEvent.click(sw);
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0], { scopeType: 'user', scopeId: BEA, notificationKey: 'bulletin_weekly', enabled: true });
    await waitFor(() => assert.equal(isChecked(screen.getByRole('switch', { name: 'Boletín semanal de Bea Soto' })), true));
    // Ahora es personal: aparece «Volver a lo de su rol» y manda null.
    fireEvent.click(screen.getByRole('button', { name: 'Volver a lo de su rol: Boletín semanal de Bea Soto' }));
    await waitFor(() => assert.equal(calls.length, 2));
    assert.equal(calls[1].enabled, null);
  });

  it('el visor con fecha pide el boletín de ese día', async () => {
    openBulletinTab();
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Leo Ruiz' })));
    fireEvent.click(screen.getByRole('button', { name: 'Leo Ruiz' }));
    await waitFor(() => assert.deepEqual(historyCalls, [LEO]));
    fireEvent.change(screen.getByLabelText('Fecha del boletín'), { target: { value: '2026-10-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    await waitFor(() => assert.equal(previewCalls.length, 1));
    assert.deepEqual(previewCalls[0], { userId: LEO, frequency: 'weekly', day: '2026-10-15' });
    await waitFor(() => assert.ok(screen.getByRole('heading', { name: 'Boletín semanal' })));
  });

  it('pulsar un enviado lo abre en el visor (getBulletinDelivery) y el filtro de frecuencia lo acota', async () => {
    openBulletinTab();
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Leo Ruiz' })));
    fireEvent.click(screen.getByRole('button', { name: 'Leo Ruiz' }));
    const sent = await waitFor(() => screen.getByRole('list', { name: 'Boletines enviados' }));
    assert.equal(sent.querySelectorAll('li').length, 2);
    fireEvent.click(screen.getByRole('button', { name: /^Ver Boletín mensual/ }));
    await waitFor(() => assert.deepEqual(deliveryCalls, [SENT[1].id]));
    await waitFor(() => assert.ok(screen.getByRole('region', { name: 'Boletín en pantalla' })));
    await chooseOption('Filtrar enviados por frecuencia', 'Semanal');
    await waitFor(() => assert.equal(screen.getByRole('list', { name: 'Boletines enviados' }).querySelectorAll('li').length, 1));
  });
});
