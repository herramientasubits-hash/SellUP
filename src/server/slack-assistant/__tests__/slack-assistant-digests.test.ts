import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { costAlertMessage, costAlertTitle, evaluateCostAlerts, providerBlockedTitle } from '../digests/cost-alerts';
import { digestFlagOn, isBogotaMonday, isBogotaWeekday, reminderText, weeklySummaryText } from '../digests/reminders';
import { buildRunFinishedNotification, ranLongEnough, runKindFor } from '@/modules/notifications/run-finished-message';
import { buildSlackNotificationMessage, slackNotificationsEnabled } from '@/modules/notifications/slack-notification-message';
import { creditDecisionButtons, decodeCreditDecision } from '@/modules/notifications/credit-approval-slack';

const NOV_10 = new Date('2026-11-10T20:00:00Z'); // martes 10 nov, Bogotá

describe('alertas de consumo', () => {
  it('80 % con proyección del día de agotamiento; 100 %; sin cuota no alerta', () => {
    const alerts = evaluateCostAlerts(
      [
        { proveedor: 'Apollo', asignacionMensualCreditos: 1000, asignacionMensualUsd: null, usadoMesCreditos: 820, usadoMesUsd: 0 },
        { proveedor: 'Lusha', asignacionMensualCreditos: 100, asignacionMensualUsd: null, usadoMesCreditos: 130, usadoMesUsd: 0 },
        { proveedor: 'Tavily', asignacionMensualCreditos: null, asignacionMensualUsd: null, usadoMesCreditos: 999, usadoMesUsd: 50 },
        { proveedor: 'Claude', asignacionMensualCreditos: null, asignacionMensualUsd: 100, usadoMesCreditos: 0, usadoMesUsd: 40 },
      ],
      NOV_10,
    );
    assert.deepEqual(alerts.map((a) => [a.proveedor, a.umbral, a.porcentaje]), [['Apollo', 80, 82], ['Lusha', 100, 130]]);
    assert.equal(alerts[0].diaAgotamiento, 13);
    assert.equal(costAlertTitle(alerts[0]), 'Apollo pasó el 80 % de su cuota del mes');
    assert.match(costAlertMessage(alerts[0]), /se agota el día 13/);
    assert.match(costAlertMessage(alerts[1]), /bloqueadas o pedir aprobación/);
    assert.equal(providerBlockedTitle('Claude', 'credits_exhausted'), 'Claude se quedó sin créditos');
  });
});

describe('recordatorios y resumen', () => {
  it('texto del recordatorio (de parte de alguien, con nota) y fin de semana', () => {
    const text = reminderText({ personName: 'Pedro Tapia', pending: { total: 12, oldestDays: 9, olderThan7: 3, sample: ['A', 'B', 'C'] }, fromName: 'Carla', note: 'prioriza Chile' });
    assert.match(text, /^Hola, Pedro\. Carla te recuerda que tienes \*12\* empresas por revisar en SellUp \(3 con más de 7 días\)\./);
    assert.match(text, /Nota: prioriza Chile/);
    assert.equal(isBogotaWeekday(new Date('2026-11-15T15:00:00Z')), false);
    assert.equal(isBogotaWeekday(NOV_10), true);
    assert.equal(isBogotaMonday(new Date('2026-11-16T13:15:00Z')), true);
    assert.equal(digestFlagOn(undefined), false);
    assert.equal(digestFlagOn('on'), true);
  });

  it('resumen semanal: totales, atrasados primero y consumo en dólares', () => {
    const text = weeklySummaryText({
      leaderName: 'Carla Pía',
      rows: [
        { name: 'Ana', approved: 3, discarded: 1, pending: 2, oldestDays: 4 },
        { name: 'Luis', approved: 0, discarded: 0, pending: 9, oldestDays: 15 },
      ],
      usageUsd: 12.5,
      usageCredits: 40,
    });
    assert.match(text, /Aprobadas: \*3\* · Descartadas: \*1\* · Por revisar hoy: \*11\*/);
    assert.ok(text.indexOf('Luis') < text.indexOf('Ana'));
    assert.match(text, /US\$12\.50/);
  });
});

describe('avisos por Slack', () => {
  it('trabajo terminado: búsqueda de empresas, contactos, falla y corridas cortas', () => {
    assert.equal(runKindFor('prospect_generation'), 'company_search');
    assert.equal(runKindFor('agent_2a_contact_enrichment'), 'contact_search');
    assert.equal(buildRunFinishedNotification({ kind: 'other', status: 'completed', batchName: null, batchId: null, pendingReview: 0, resultsGenerated: 0, errorMessage: null }), null);
    const done = buildRunFinishedNotification({ kind: 'company_search', status: 'completed', batchName: 'Retail CL', batchId: 'b1', pendingReview: 7, resultsGenerated: 9, errorMessage: null });
    assert.equal(done?.title, 'Tu búsqueda «Retail CL» terminó');
    assert.match(done?.message ?? '', /7 empresas por revisar/);
    const failed = buildRunFinishedNotification({ kind: 'contact_search', status: 'failed', batchName: null, batchId: null, pendingReview: null, resultsGenerated: 0, errorMessage: 'Apollo sin créditos' });
    assert.match(failed?.message ?? '', /Apollo sin créditos/);
    assert.equal(ranLongEnough('2026-11-11T10:00:00Z', '2026-11-11T10:00:20Z'), false);
    assert.equal(ranLongEnough('2026-11-11T10:00:00Z', '2026-11-11T10:02:00Z'), true);
  });

  it('mensaje con botón a SellUp; se apaga con off', () => {
    const msg = buildSlackNotificationMessage({ title: 'Te asignaron 2 empresas', message: 'Carla te asignó…', actionLabel: 'Ver empresas', actionUrl: '/accounts' }, 'https://app.example/');
    const actions = msg.blocks.find((b) => b.type === 'actions') as { elements: Array<{ url?: string }> };
    assert.equal(actions.elements[0].url, 'https://app.example/accounts');
    assert.equal(slackNotificationsEnabled({ SELLUP_SLACK_NOTIFICATIONS: 'off' }), false);
    assert.equal(slackNotificationsEnabled({}), true);
  });

  it('🔴 botones de créditos: ida y vuelta y rechazo de valores raros', () => {
    const req = '00000000-0000-4000-8000-000000000001';
    const [approve, reject] = creditDecisionButtons(req, 120.4) as Array<{ action_id: string; value: string }>;
    assert.deepEqual(decodeCreditDecision(approve.action_id, approve.value), { requestId: req, decision: 'approve', credits: 121 });
    assert.deepEqual(decodeCreditDecision(reject.action_id, reject.value), { requestId: req, decision: 'reject', credits: null });
    assert.equal(decodeCreditDecision(approve.action_id, JSON.stringify({ r: req, c: 0 })), null);
    assert.equal(decodeCreditDecision(approve.action_id, JSON.stringify({ r: 'x', c: 5 })), null);
    assert.equal(decodeCreditDecision('otro', approve.value), null);
  });
});
