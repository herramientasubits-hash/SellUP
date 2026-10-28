/**
 * Búsqueda masiva de Growth — núcleo puro: el tope de créditos, cuándo lanzar
 * otra ronda y qué hace una ronda que falla. Lo que se prueba aquí es lo que
 * impide gastar de más.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BULK_TARGET_OPTIONS, isBulkTargetCount, type BulkSearchProgress } from '../bulk-search-types';
import { bulkMaxRounds, confirmedCapCoversEstimate, estimateBulkSearch } from '../bulk-search-estimate';
import {
  BULK_MAX_CONSECUTIVE_FAILURES,
  applySucceededRound,
  classifyRoundFailure,
  decideBulkNextStep,
} from '../bulk-search-decision';

const PER_ROUND = { apollo: 12, lusha: 4, tavily: 20 };

function progress(overrides: Partial<BulkSearchProgress> = {}): BulkSearchProgress {
  return {
    status: 'running',
    targetCount: 100,
    deliveredCount: 0,
    roundsDone: 0,
    maxRounds: bulkMaxRounds(100),
    creditCap: 160,
    creditsUsed: 0,
    consecutiveEmptyRounds: 0,
    consecutiveFailedRounds: 0,
    ...overrides,
  };
}
const CTX = { perRoundPaidCredits: 16, continuationPending: false };

describe('cantidades', () => {
  it('solo las cuatro opciones de la pantalla', () => {
    assert.deepEqual([...BULK_TARGET_OPTIONS], [25, 50, 100, 200]);
    assert.equal(isBulkTargetCount(100), true);
    for (const value of [10, 30, 150, 500, '100', null]) assert.equal(isBulkTargetCount(value), false);
  });
});

describe('estimado del tope', () => {
  it('rondas pagadas en el rendimiento de 10; techo de rondas en el peor de 5', () => {
    const estimate = estimateBulkSearch(200, PER_ROUND);
    assert.equal(estimate.plannedRounds, 20);
    assert.equal(estimate.maxRounds, 42);
    assert.equal(estimate.perRoundPaidCredits, 16);
    assert.equal(estimate.creditCap, 320);
    assert.deepEqual(estimate.breakdown, { apollo: 240, lusha: 80, tavily: 840 });
  });

  it('el tiempo crece con la cantidad (de 2 a 5 minutos por ronda)', () => {
    const small = estimateBulkSearch(25, PER_ROUND);
    assert.deepEqual(small.minutes, { min: 6, max: 25 });
    const large = estimateBulkSearch(200, PER_ROUND);
    assert.ok(large.minutes.max > small.minutes.max);
  });

  it('un peor caso inválido no infla ni abarata el tope', () => {
    const estimate = estimateBulkSearch(25, { apollo: Number.NaN, lusha: -3, tavily: 20 });
    assert.equal(estimate.creditCap, 0);
    assert.equal(estimate.perRoundPaidCredits, 0);
  });

  it('el tope confirmado tiene que cubrir el del servidor', () => {
    const estimate = estimateBulkSearch(50, PER_ROUND);
    assert.equal(confirmedCapCoversEstimate(estimate.creditCap, estimate), true);
    assert.equal(confirmedCapCoversEstimate(estimate.creditCap - 1, estimate), false);
    assert.equal(confirmedCapCoversEstimate('80', estimate), false);
    assert.equal(confirmedCapCoversEstimate(Number.POSITIVE_INFINITY, estimate), false);
  });
});

describe('antes de cada ronda', () => {
  it('lanza mientras falten empresas y quepa el peor caso', () => {
    assert.deepEqual(decideBulkNextStep(progress(), CTX), { kind: 'run_round' });
  });

  it('se detiene al llegar a N', () => {
    assert.deepEqual(decideBulkNextStep(progress({ deliveredCount: 100 }), CTX), {
      kind: 'stop',
      status: 'completed',
      reason: 'target_reached',
    });
  });

  it('una ronda sin empresas nuevas agota la búsqueda', () => {
    assert.deepEqual(decideBulkNextStep(progress({ deliveredCount: 63, consecutiveEmptyRounds: 1 }), CTX), {
      kind: 'stop',
      status: 'exhausted',
      reason: 'no_new_companies',
    });
  });

  it('nunca pasa del techo de rondas', () => {
    assert.equal(decideBulkNextStep(progress({ roundsDone: 22 }), CTX).kind, 'stop');
  });

  it('🔴 nunca pasa del tope: si lo que queda no cubre otra ronda, se detiene', () => {
    assert.deepEqual(decideBulkNextStep(progress({ creditsUsed: 145 }), CTX), {
      kind: 'stop',
      status: 'budget_capped',
      reason: 'credit_cap',
    });
    assert.deepEqual(decideBulkNextStep(progress({ creditsUsed: 144 }), CTX), { kind: 'run_round' });
  });

  it('demasiadas fallas seguidas la terminan', () => {
    assert.deepEqual(
      decideBulkNextStep(progress({ consecutiveFailedRounds: BULK_MAX_CONSECUTIVE_FAILURES }), CTX),
      { kind: 'stop', status: 'failed', reason: 'repeated_failures' },
    );
  });

  it('pausada o cancelada no lanza nada', () => {
    for (const status of ['paused', 'cancelled', 'completed'] as const) {
      assert.deepEqual(decideBulkNextStep(progress({ status }), CTX), { kind: 'stop', status, reason: null });
    }
  });

  it('con una continuación de Apollo pendiente, espera antes de comprar otra ronda', () => {
    const step = decideBulkNextStep(progress(), { ...CTX, continuationPending: true });
    assert.equal(step.kind, 'wait');
  });
});

describe('después de cada ronda', () => {
  it('una ronda con empresas reinicia los contadores; una vacía suma', () => {
    assert.deepEqual(applySucceededRound({ roundsDone: 3, consecutiveEmptyRounds: 0 }, 7), {
      roundsDone: 4,
      consecutiveEmptyRounds: 0,
      consecutiveFailedRounds: 0,
    });
    assert.equal(applySucceededRound({ roundsDone: 3, consecutiveEmptyRounds: 0 }, 0).consecutiveEmptyRounds, 1);
  });

  it('otra corrida ocupando el cupo no cuenta: se reintenta', () => {
    assert.equal(classifyRoundFailure('CONCURRENT_EXECUTION_ACTIVE').kind, 'skip');
  });

  it('sin presupuesto del mes, termina con lo que lleva', () => {
    for (const code of ['BUDGET_EXCEEDED', 'EXECUTION_CREDIT_LIMIT_EXCEEDED', 'BUDGET_PERIOD_CLOSED'] as const) {
      assert.deepEqual(classifyRoundFailure(code), { kind: 'stop', status: 'budget_capped', reason: 'monthly_budget' });
    }
  });

  it('sin permiso o con el piloto en pausa, termina', () => {
    for (const code of ['NOT_ALLOWED_FOR_ROLE', 'EXECUTION_DISABLED', 'PILOT_PAUSED', 'PERSISTENCE_NOT_READY'] as const) {
      assert.equal(classifyRoundFailure(code).kind, 'stop');
    }
  });

  it('una falla pasajera del proveedor se reintenta', () => {
    assert.deepEqual(classifyRoundFailure('PROVIDER_UNAVAILABLE'), { kind: 'retry' });
    assert.deepEqual(classifyRoundFailure('GENERATION_FAILED'), { kind: 'retry' });
  });
});
