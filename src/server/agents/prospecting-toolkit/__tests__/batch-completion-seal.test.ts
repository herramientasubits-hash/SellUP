/**
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 7 — sellado terminal del lote.
 *
 * El lote `e1622574…` quedó en `ready_for_review` con `completed_at = null`
 * porque nadie lo escribía.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { decideBatchCompletionSeal, isTerminalBatchStatus } from '../batch-completion-seal';

const NOW = new Date('2026-08-05T22:20:08.933Z');

describe('§ 7 · qué estados son terminales', () => {
  for (const status of ['ready_for_review', 'completed', 'completed_with_errors', 'failed']) {
    test(`«${status}» es terminal`, () => {
      assert.equal(isTerminalBatchStatus(status), true);
    });
  }

  for (const status of ['draft', 'generating', 'in_review', 'cancelled']) {
    test(`«${status}» NO es terminal`, () => {
      assert.equal(isTerminalBatchStatus(status), false);
    });
  }

  test('un estado ausente no es terminal', () => {
    assert.equal(isTerminalBatchStatus(null), false);
    assert.equal(isTerminalBatchStatus(undefined), false);
  });
});

describe('§ 7 · el estado terminal sella', () => {
  test('ready_for_review sin marca previa escribe completed_at', () => {
    const decision = decideBatchCompletionSeal({
      status: 'ready_for_review',
      currentCompletedAt: null,
      now: NOW,
    });

    assert.equal(decision.shouldWrite, true);
    assert.equal(decision.completedAt, NOW.toISOString());
    assert.equal(decision.reason, 'terminal_status_sealed');
  });

  for (const status of ['completed', 'failed']) {
    test(`«${status}» también sella`, () => {
      const decision = decideBatchCompletionSeal({
        status,
        currentCompletedAt: null,
        now: NOW,
      });
      assert.equal(decision.shouldWrite, true);
      assert.equal(decision.completedAt, NOW.toISOString());
    });
  }

  test('un lote activo NUNCA escribe completed_at', () => {
    for (const status of ['draft', 'generating', 'in_review']) {
      const decision = decideBatchCompletionSeal({
        status,
        currentCompletedAt: null,
        now: NOW,
      });
      assert.equal(decision.shouldWrite, false);
      assert.equal(decision.completedAt, null);
      assert.equal(decision.reason, 'status_not_terminal');
    }
  });
});

describe('§ 7 · idempotencia', () => {
  test('dos cierres terminales no producen marcas contradictorias', () => {
    const first = decideBatchCompletionSeal({
      status: 'ready_for_review',
      currentCompletedAt: null,
      now: NOW,
    });
    assert.equal(first.shouldWrite, true);

    const later = new Date('2026-08-06T01:00:00.000Z');
    const second = decideBatchCompletionSeal({
      status: 'ready_for_review',
      currentCompletedAt: first.completedAt,
      now: later,
    });

    assert.equal(second.shouldWrite, false);
    assert.equal(second.reason, 'already_sealed');
    // La segunda lectura devuelve la MISMA marca: la corrida dejó de avanzar una
    // sola vez, y dos lecturas no pueden dar instantes distintos.
    assert.equal(second.completedAt, first.completedAt);
  });

  test('un cambio de estado terminal posterior respeta la marca original', () => {
    const sealedAt = '2026-08-05T22:20:08.933Z';
    const decision = decideBatchCompletionSeal({
      status: 'failed',
      currentCompletedAt: sealedAt,
      now: new Date('2026-08-06T03:00:00.000Z'),
    });

    assert.equal(decision.shouldWrite, false);
    assert.equal(decision.completedAt, sealedAt);
  });

  test('la marca previa gana incluso si el lote vuelve a un estado activo', () => {
    const sealedAt = '2026-08-05T22:20:08.933Z';
    const decision = decideBatchCompletionSeal({
      status: 'in_review',
      currentCompletedAt: sealedAt,
      now: NOW,
    });

    assert.equal(decision.shouldWrite, false);
    assert.equal(decision.reason, 'already_sealed');
    assert.equal(decision.completedAt, sealedAt);
  });
});
