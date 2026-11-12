import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bar,
  buildBulletinModel,
  memberLine,
  namesText,
  bulletinPeriod,
  isBulletinDue,
  periodBounds,
  renderBulletinBlocks,
  trendText,
  type PersonActivity,
} from '../bulletin-model';
import { buildTeams } from '../bulletin-data.server';
import {
  appliesToRole,
  defaultEnabled,
  isNotificationEnabled,
  notificationSource,
  roleEnabled,
  type NotificationSettingRow,
} from '@/modules/notifications/notification-catalog';

// Bogotá = UTC-5. 2026-11-16 es lunes.
const MON_NOV_16 = new Date('2026-11-16T13:15:00Z');
const WED_NOV_18 = new Date('2026-11-18T13:15:00Z');

describe('períodos del boletín (hora de Bogotá)', () => {
  it('diario: ayer; el lunes cubre viernes a domingo', () => {
    const wed = bulletinPeriod('daily', WED_NOV_18);
    assert.deepEqual([wed.start, wed.end, wed.previousStart, wed.previousEnd], ['2026-11-17', '2026-11-17', '2026-11-16', '2026-11-16']);
    const mon = bulletinPeriod('daily', MON_NOV_16);
    assert.deepEqual([mon.start, mon.end], ['2026-11-13', '2026-11-15']);
    assert.deepEqual([mon.previousStart, mon.previousEnd], ['2026-11-10', '2026-11-12']);
  });

  it('semanal: la semana anterior de lunes a domingo, contra la previa', () => {
    const p = bulletinPeriod('weekly', WED_NOV_18);
    assert.deepEqual([p.start, p.end, p.previousStart, p.previousEnd], ['2026-11-09', '2026-11-15', '2026-11-02', '2026-11-08']);
  });

  it('mensual y trimestral: el mes y el trimestre anteriores', () => {
    const m = bulletinPeriod('monthly', new Date('2026-12-01T13:15:00Z'));
    assert.deepEqual([m.start, m.end, m.previousStart, m.previousEnd], ['2026-11-01', '2026-11-30', '2026-10-01', '2026-10-31']);
    assert.equal(m.label, 'noviembre 2026');
    const q = bulletinPeriod('quarterly', new Date('2027-01-01T13:15:00Z'));
    assert.deepEqual([q.start, q.end, q.previousStart, q.previousEnd], ['2026-10-01', '2026-12-31', '2026-07-01', '2026-09-30']);
    assert.equal(q.label, 'Trimestre 4 · 2026');
  });

  it('cuándo toca cada uno', () => {
    assert.equal(isBulletinDue('weekly', MON_NOV_16), true);
    assert.equal(isBulletinDue('weekly', WED_NOV_18), false);
    assert.equal(isBulletinDue('daily', new Date('2026-11-15T13:15:00Z')), false, 'domingo');
    assert.equal(isBulletinDue('monthly', new Date('2026-12-01T13:15:00Z')), true);
    assert.equal(isBulletinDue('quarterly', new Date('2026-12-01T13:15:00Z')), false);
    assert.equal(isBulletinDue('quarterly', new Date('2027-01-01T13:15:00Z')), true);
  });

  it('los días de Bogotá en UTC', () => {
    assert.deepEqual(periodBounds('2026-11-09', '2026-11-15'), { from: '2026-11-09T05:00:00.000Z', to: '2026-11-16T05:00:00.000Z' });
  });
});

function person(id: string, over: Partial<PersonActivity> = {}): PersonActivity {
  return {
    id,
    name: id.toUpperCase(),
    searches: 0,
    found: 0,
    approved: 0,
    discarded: 0,
    contactsApproved: 0,
    firstContacts: 0,
    firstContactsUsed: 0,
    usageUsd: 0,
    usageCredits: 0,
    pending: 0,
    oldestPendingDays: null,
    ...over,
  };
}

describe('modelo del boletín', () => {
  const period = bulletinPeriod('weekly', WED_NOV_18);
  const model = buildBulletinModel({
    period,
    recipientName: 'Leonardo',
    scopeLabel: 'Tu equipo y sus equipos (en cascada)',
    moneyVisible: true,
    current: [
      person('ana', { searches: 2, found: 20, approved: 6, discarded: 2, contactsApproved: 4, firstContacts: 2, firstContactsUsed: 1, usageUsd: 3.5, pending: 3, oldestPendingDays: 2 }),
      person('luis', { approved: 1, discarded: 3, pending: 9, oldestPendingDays: 12 }),
      person('eva'),
    ],
    previous: [person('ana', { approved: 10, discarded: 1, usageUsd: 2 }), person('luis', { approved: 2 }), person('eva', { approved: 1 })],
    teams: [
      { name: 'Carla', memberIds: ['ana', 'luis'] },
      { name: 'Pedro', memberIds: ['eva'] },
    ],
  });

  it('semáforo, titular y alerta principal', () => {
    assert.equal(model.status, 'rojo', 'aprobadas cayeron más del 30 %');
    assert.match(model.headline, /^2 de 3 personas trabajaron en SellUp · 7 empresas aprobadas \(-46\.2% vs\. la semana anterior\)$/);
    assert.equal(model.mainAlert, 'LUIS tiene empresas por revisar con más de 7 días.', 'dice quién es');
    assert.deepEqual(model.inactive, ['EVA']);
  });

  it('pulso con comparación, tasa de aprobación, embudo y equipos', () => {
    const approved = model.pulse.find((m) => m.key === 'approved');
    assert.deepEqual([approved?.value, approved?.previous], [7, 13]);
    assert.equal(model.pulse.at(-1)?.format, 'usd');
    assert.deepEqual(model.approvalRate, { before: 92.9, now: 58.3 });
    assert.deepEqual(model.funnel.map((f) => f.value), [20, 7, 4, 2, 1]);
    assert.deepEqual(model.teams.map((t) => [t.name, t.approved, t.pending, t.oldestDays]), [['Carla', 7, 12, 12], ['Pedro', 0, 0, null]]);
    assert.deepEqual(model.behind[0], { name: 'LUIS', pending: 9, oldestDays: 12 });
  });

  it('🔴 sin dólares para quien no los ve: el pulso usa créditos', () => {
    const seller = buildBulletinModel({ period, recipientName: 'X', scopeLabel: 'Tu actividad', moneyVisible: false, current: [person('a')], previous: [person('a')], teams: [] });
    assert.equal(seller.pulse.at(-1)?.key, 'usageCredits');
  });

  it('dibujo para Slack: secciones, barras y botones', () => {
    const { text, blocks } = renderBulletinBlocks(model, 'https://app.example/');
    assert.match(text, /^BOLETÍN SEMANAL de SellUp/);
    const all = JSON.stringify(blocks);
    for (const section of ['LECTURA EJECUTIVA', 'PULSO DEL PERÍODO', 'EMBUDO DEL PERÍODO', 'POR EQUIPO Y POR PERSONA', 'A QUIÉN ACOMPAÑAR', 'CIERRE']) assert.ok(all.includes(section), section);
    assert.ok(all.includes('https://app.example/accounts?tab=prospectos'));
    assert.ok(blocks.length <= 50);
    assert.equal(bar(5, 10), '█████░░░░░');
    assert.equal(trendText({ value: 7, previous: 13, higherIsBetter: true, format: 'count' }), '🔴 ▼ -46.2% · vs. 13');
  });

  it('🔴 por persona: cada miembro con sus cifras y qué le pasa, lo urgente primero', () => {
    const carla = model.teams.find((t) => t.name === 'Carla');
    assert.deepEqual(carla?.members?.map((m) => [m.name, m.signal]), [['LUIS', 'rojo'], ['ANA', 'naranja']]);
    const luis = carla?.members?.[0];
    assert.equal(luis?.note, 'Tiene 9 empresas por revisar; la más antigua lleva 12 días.');
    assert.equal(carla?.members?.[1].note, 'Aprobó menos que en el período anterior (6 frente a 10).');
    const eva = model.teams.find((t) => t.name === 'Pedro')?.members?.[0];
    assert.deepEqual([eva?.signal, eva?.note, eva?.approvedPrevious], ['gris', 'Sin actividad en el período.', 1]);
    assert.equal(
      memberLine(luis!, true),
      '🔴 *LUIS* — 1 aprobada (antes 2) · 3 descartadas · 9 por revisar (12 días)\n      ↳ _Tiene 9 empresas por revisar; la más antigua lleva 12 días._',
    );
    const all = JSON.stringify(renderBulletinBlocks(model, 'https://app.example').blocks);
    for (const name of ['*LUIS*', '*ANA*', '*EVA*']) assert.ok(all.includes(name), name);
  });

  it('nombres en las alertas', () => {
    assert.equal(namesText(['Ana']), 'Ana');
    assert.equal(namesText(['Ana', 'Luis']), 'Ana y Luis');
    assert.equal(namesText(['Ana', 'Luis', 'Eva']), 'Ana, Luis y Eva');
    assert.equal(namesText(['A', 'B', 'C', 'D', 'E']), 'A, B, C y 2 más');
  });

  it('🔴 un equipo grande no rompe el límite de 50 bloques de Slack', () => {
    const people = Array.from({ length: 120 }, (_, i) => person(`p${i}`, { approved: i % 5, found: 10, pending: i % 3, oldestPendingDays: i % 3 ? 9 : null }));
    const big = buildBulletinModel({
      period, recipientName: 'X', scopeLabel: 'Todo', moneyVisible: true, current: people, previous: people,
      teams: Array.from({ length: 8 }, (_, t) => ({ name: `Equipo ${t}`, memberIds: people.filter((_, i) => i % 8 === t).map((p) => p.id) })),
    });
    const { blocks } = renderBulletinBlocks(big, 'https://app.example');
    assert.ok(blocks.length <= 50, `bloques: ${blocks.length}`);
    for (const b of blocks as Array<{ text?: { text: string } }>) assert.ok((b.text?.text.length ?? 0) <= 3000);
  });
});

describe('sub-equipos en cascada por el organigrama', () => {
  const u = (id: string, manager: string | null, group: string | null = null) => ({
    id,
    full_name: id,
    email: `${id}@x.co`,
    manager_id: manager,
    group_id: group,
    access_status: 'active',
    roles: null,
  });

  it('cada reporte directo con toda su cascada; lo demás, «Otros del equipo»', () => {
    const teams = buildTeams('leo', [u('leo', null), u('carla', 'leo'), u('ana', 'carla'), u('luis', 'ana'), u('pedro', 'leo'), u('eva', 'pedro'), u('suelto', 'nadie')], new Map());
    assert.deepEqual(teams.map((t) => [t.name, [...t.memberIds].sort()]), [
      ['carla', ['ana', 'carla', 'luis']],
      ['pedro', ['eva', 'pedro']],
      ['Otros del equipo', ['leo', 'suelto']],
    ]);
  });

  it('sin reportes directos: por grupo de la organización', () => {
    const teams = buildTeams('admin', [u('a', null, 'g1'), u('b', null, 'g2')], new Map([['g1', 'Mid Market'], ['g2', 'Enterprise']]));
    assert.deepEqual(teams.map((t) => t.name), ['Mid Market', 'Enterprise']);
  });
});

describe('avisos configurables por rol y persona', () => {
  const rows: NotificationSettingRow[] = [
    { scope_type: 'role', scope_id: 'seller_bd', notification_key: 'bulletin_weekly', enabled: true },
    { scope_type: 'user', scope_id: 'u-ana', notification_key: 'bulletin_weekly', enabled: false },
    { scope_type: 'role', scope_id: 'commercial_lead', notification_key: 'assignments', enabled: false },
  ];

  it('valores por defecto: boletín semanal a líderes y admin; recordatorio diario apagado', () => {
    assert.equal(defaultEnabled('bulletin_weekly', 'commercial_lead'), true);
    assert.equal(defaultEnabled('bulletin_weekly', 'seller_bd'), false);
    assert.equal(defaultEnabled('daily_reminder', 'seller_bd'), false);
    assert.equal(defaultEnabled('assignments', 'growth'), true);
  });

  it('🔴 la regla de la persona gana sobre la de su rol; la del rol sobre el defecto', () => {
    assert.equal(isNotificationEnabled('bulletin_weekly', { userId: 'u-ana', roleKey: 'seller_bd' }, rows), false);
    assert.equal(isNotificationEnabled('bulletin_weekly', { userId: 'u-luis', roleKey: 'seller_bd' }, rows), true);
    assert.equal(isNotificationEnabled('assignments', { userId: 'u-x', roleKey: 'commercial_lead' }, rows), false);
    assert.equal(notificationSource('bulletin_weekly', { userId: 'u-ana', roleKey: 'seller_bd' }, rows), 'personal');
    assert.equal(notificationSource('bulletin_weekly', { userId: 'u-luis', roleKey: 'seller_bd' }, rows), 'rol');
    assert.equal(notificationSource('run_finished', { userId: 'u-luis', roleKey: 'seller_bd' }, rows), 'por_defecto');
  });

  it('🔴 un aviso que no aplica al rol nunca llega (alertas de consumo sólo admin)', () => {
    assert.equal(appliesToRole('cost_alerts', 'seller_bd'), false);
    assert.equal(isNotificationEnabled('cost_alerts', { userId: 'u', roleKey: 'seller_bd' }, [
      { scope_type: 'user', scope_id: 'u', notification_key: 'cost_alerts', enabled: true },
    ]), false);
    assert.equal(roleEnabled('cost_alerts', 'admin', []), true);
    assert.equal(isNotificationEnabled('assignments', { userId: 'u', roleKey: null }, []), false);
  });
});
