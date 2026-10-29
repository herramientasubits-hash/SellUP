/**
 * Búsqueda masiva · seguimiento (PR 4) — cómo se lee cada estado, qué hace el
 * conductor después de cada respuesta y cuáles se ven en el Centro de procesos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BULK_AWAY_AFTER_MS,
  bulkDisplayState,
  bulkProgressPercent,
  bulkSearchesForTray,
  bulkSearchSummary,
  bulkWizardOutcome,
  nextDriverStep,
} from '../bulk-search-display';
import { currentRoundRequestIdOf, type BulkSearchView } from '../bulk-search-view';

const NOW = Date.parse('2026-10-27T18:00:00Z');

function view(overrides: Partial<BulkSearchView> = {}): BulkSearchView {
  return {
    id: 's1',
    label: 'Colombia · Tecnología',
    status: 'running',
    stopReason: null,
    targetCount: 100,
    deliveredCount: 63,
    creditCap: 160,
    creditsUsed: 84,
    roundsDone: 9,
    maxRounds: 22,
    roundInFlight: false,
    lastRoundAt: new Date(NOW - 60_000).toISOString(),
    createdAt: new Date(NOW - 3_600_000).toISOString(),
    completedAt: null,
    batchIds: ['b1'],
    currentRoundRequestId: null,
    ...overrides,
  };
}

describe('estado a la vista', () => {
  it('buscando mientras hay una ronda en vuelo, alguien la conduce o la última fue hace poco', () => {
    assert.equal(bulkDisplayState(view({ roundInFlight: true }), NOW), 'searching');
    assert.equal(bulkDisplayState(view({ lastRoundAt: new Date(NOW - 3_600_000).toISOString() }), NOW, true), 'searching');
    assert.equal(bulkDisplayState(view(), NOW), 'searching');
  });

  it('«en pausa porque saliste» si nadie la conduce desde hace rato', () => {
    const stale = view({ lastRoundAt: new Date(NOW - BULK_AWAY_AFTER_MS - 1).toISOString() });
    assert.equal(bulkDisplayState(stale, NOW), 'paused_away');
    assert.match(bulkSearchSummary(stale, 'paused_away'), /Sigue sola al volver/);
  });

  it('«pausada por ti» se distingue de «porque saliste»', () => {
    const paused = view({ status: 'paused' });
    assert.equal(bulkDisplayState(paused, NOW), 'paused_by_user');
    assert.equal(bulkSearchSummary(paused, 'paused_by_user'), 'Pausada por ti · 63 de 100');
  });

  it('al terminar dice cuántas faltaron y por qué', () => {
    assert.equal(
      bulkSearchSummary(view({ status: 'exhausted', stopReason: 'no_new_companies' }), 'exhausted'),
      'Entregó 63 de 100: no aparecieron más empresas nuevas.',
    );
    assert.equal(
      bulkSearchSummary(view({ status: 'budget_capped', stopReason: 'credit_cap' }), 'budget_capped'),
      'Entregó 63 de 100: se acabó el tope de créditos.',
    );
    assert.equal(
      bulkSearchSummary(view({ status: 'budget_capped', stopReason: 'monthly_budget' }), 'budget_capped'),
      'Entregó 63 de 100: se acabó el presupuesto del mes.',
    );
    assert.equal(bulkSearchSummary(view({ status: 'completed', deliveredCount: 100 }), 'completed'), 'Listo: 100 empresas para revisar.');
  });

  it('el avance nunca pasa del 100 %', () => {
    assert.equal(bulkProgressPercent(view()), 63);
    assert.equal(bulkProgressPercent(view({ deliveredCount: 130 })), 100);
  });
});

describe('el conductor', () => {
  it('sigue, espera o para según lo que responde la ronda', () => {
    const search = view();
    assert.deepEqual(nextDriverStep({ ok: true, next: 'continue', retryAfterMs: 0, search }), { kind: 'again' });
    assert.deepEqual(nextDriverStep({ ok: true, next: 'wait', retryAfterMs: 30_000, search }), { kind: 'wait', ms: 30_000 });
    assert.deepEqual(nextDriverStep({ ok: true, next: 'done', retryAfterMs: 0, search }), { kind: 'stop' });
    assert.deepEqual(nextDriverStep({ ok: false, code: 'NETWORK' }), { kind: 'stop' });
  });

  it('nunca espera menos de un segundo (no martilla el servidor)', () => {
    assert.deepEqual(nextDriverStep({ ok: true, next: 'wait', retryAfterMs: 0, search: view() }), { kind: 'wait', ms: 1_000 });
  });
});

describe('qué se ve en el Centro de procesos', () => {
  it('las vivas y las que terminaron en el último día, hasta tres', () => {
    const list = [
      view({ id: 'live' }),
      view({ id: 'today', status: 'completed', completedAt: new Date(NOW - 3_600_000).toISOString() }),
      view({ id: 'old', status: 'completed', completedAt: new Date(NOW - 2 * 86_400_000).toISOString() }),
    ];
    assert.deepEqual(bulkSearchesForTray(list, NOW).map((s) => s.id), ['live', 'today']);
  });
});

describe('el asistente abierto sigue la búsqueda masiva como una búsqueda normal (dueña 28-10)', () => {
  it('la ronda en curso es la última que sigue corriendo', () => {
    assert.equal(currentRoundRequestIdOf([]), null);
    assert.equal(
      currentRoundRequestIdOf([
        { round_index: 0, status: 'succeeded', client_request_id: 'r0' },
        { round_index: 1, status: 'running', client_request_id: 'r1' },
      ]),
      'r1',
    );
    assert.equal(currentRoundRequestIdOf([{ round_index: 0, status: 'succeeded', client_request_id: 'r0' }]), null);
  });

  it('mientras sigue (en curso o en pausa) no se cierra', () => {
    assert.equal(bulkWizardOutcome(view({ status: 'running' })), null);
    assert.equal(bulkWizardOutcome(view({ status: 'paused' })), null);
  });

  it('al terminar usa el estado del panel final de siempre, con su último lote', () => {
    assert.deepEqual(bulkWizardOutcome(view({ status: 'completed', deliveredCount: 25, targetCount: 25, batchIds: ['a', 'b'] })), {
      status: 'success_target_reached',
      batchId: 'b',
    });
    assert.deepEqual(bulkWizardOutcome(view({ status: 'exhausted', deliveredCount: 12, targetCount: 25, batchIds: ['a'] })), {
      status: 'success_partial',
      batchId: 'a',
    });
    assert.deepEqual(bulkWizardOutcome(view({ status: 'budget_capped', deliveredCount: 0, targetCount: 25, batchIds: [] })), {
      status: 'no_new_candidates',
      batchId: '',
    });
  });
});
