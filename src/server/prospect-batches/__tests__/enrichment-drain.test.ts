/**
 * Tests — AGENT1-IMPORT-PARITY-10: el vaciado de la cola de enriquecimiento.
 * Worker falso inyectado: cero base de datos, cero IA.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { drainEnrichmentJobs } from '../enrichment-drain';
import type { WorkerExecutionStats } from '../enrichment-worker';

function stats(processed: number, success = processed): WorkerExecutionStats {
  return { processedCount: processed, successCount: success, failedCount: 0, skippedCount: 0, durationMs: 1, jobsProcessed: [] };
}

function scriptedWorker(sequence: number[]): { run: () => Promise<WorkerExecutionStats>; calls: () => number } {
  let i = 0;
  return {
    run: async () => stats(sequence[i++] ?? 0),
    calls: () => i,
  };
}

describe('drainEnrichmentJobs', () => {
  it('repite el worker hasta vaciar la cola', async () => {
    const w = scriptedWorker([3, 3, 1, 0]);
    const r = await drainEnrichmentJobs({ runWorker: w.run });
    assert.deepEqual(r, { rounds: 4, processed: 7, succeeded: 7, stoppedBy: 'queue_empty' });
  });

  it('cola vacía desde el inicio → una sola ronda', async () => {
    const r = await drainEnrichmentJobs({ runWorker: scriptedWorker([0]).run });
    assert.equal(r.rounds, 1);
    assert.equal(r.stoppedBy, 'queue_empty');
  });

  it('se detiene al agotar el presupuesto de tiempo (lo que quede sigue pendiente)', async () => {
    let t = 0;
    const w = scriptedWorker(Array(100).fill(3));
    const r = await drainEnrichmentJobs({
      runWorker: async () => { t += 20_000; return w.run(); },
      now: () => t,
      timeBudgetMs: 45_000,
    });
    assert.equal(r.stoppedBy, 'time_budget');
    assert.equal(r.rounds, 3);
  });

  it('se detiene en el tope de rondas', async () => {
    const r = await drainEnrichmentJobs({ runWorker: scriptedWorker(Array(100).fill(3)).run, maxRounds: 5 });
    assert.equal(r.stoppedBy, 'max_rounds');
    assert.equal(r.rounds, 5);
  });

  it('un fallo del worker NO lanza: corta y deja lo demás pendiente', async () => {
    let n = 0;
    const r = await drainEnrichmentJobs({
      runWorker: async () => {
        n++;
        if (n === 2) throw new Error('RPC caída');
        return stats(3);
      },
    });
    assert.deepEqual(r, { rounds: 1, processed: 3, succeeded: 3, stoppedBy: 'worker_error' });
  });
});

// ─── FEEDBACK 24-11 — vueltas encadenadas ────────────────────────────────────

import {
  decideEnrichmentContinuation,
  ENRICHMENT_CHAIN_MAX_HOPS,
  parseEnrichmentHop,
} from '../enrichment-drain';

describe('decideEnrichmentContinuation', () => {
  it('pide otra vuelta si el vaciado se quedó sin tiempo con trabajo hecho', () => {
    assert.deepEqual(
      decideEnrichmentContinuation({ rounds: 5, processed: 15, succeeded: 12, stoppedBy: 'time_budget' }, 0),
      { continue: true, nextHop: 1 },
    );
    assert.deepEqual(
      decideEnrichmentContinuation({ rounds: 20, processed: 60, succeeded: 60, stoppedBy: 'max_rounds' }, 3),
      { continue: true, nextHop: 4 },
    );
  });

  it('para con la cola vacía, con error del worker o sin trabajo', () => {
    assert.deepEqual(decideEnrichmentContinuation({ rounds: 2, processed: 3, succeeded: 3, stoppedBy: 'queue_empty' }, 0), { continue: false });
    assert.deepEqual(decideEnrichmentContinuation({ rounds: 0, processed: 0, succeeded: 0, stoppedBy: 'worker_error' }, 0), { continue: false });
    assert.deepEqual(decideEnrichmentContinuation({ rounds: 1, processed: 0, succeeded: 0, stoppedBy: 'time_budget' }, 0), { continue: false });
  });

  it('no encadena más allá del tope', () => {
    assert.deepEqual(
      decideEnrichmentContinuation({ rounds: 5, processed: 15, succeeded: 15, stoppedBy: 'time_budget' }, ENRICHMENT_CHAIN_MAX_HOPS),
      { continue: false },
    );
  });
});

describe('parseEnrichmentHop', () => {
  it('lee { hop } y cae a 0 con cualquier otra cosa', () => {
    assert.equal(parseEnrichmentHop({ hop: 4 }), 4);
    assert.equal(parseEnrichmentHop({ hop: -1 }), 0);
    assert.equal(parseEnrichmentHop({ hop: 1.5 }), 0);
    assert.equal(parseEnrichmentHop({ hop: ENRICHMENT_CHAIN_MAX_HOPS + 1 }), 0);
    assert.equal(parseEnrichmentHop(null), 0);
  });
});

// ─── Prod 24-11 — margen para relevar antes del límite de Vercel ────────────

import { ENRICHMENT_CHAIN_TIME_BUDGET_MS } from '../enrichment-drain';

describe('margen de la vuelta encadenada', () => {
  it('deja tiempo para terminar la última ronda (~75 s) y pedir la siguiente antes de los 300 s', () => {
    const VERCEL_LIMIT_MS = 300_000;
    const WORST_ROUND_MS = 75_000;
    const TRIGGER_MS = 10_000;
    assert.ok(ENRICHMENT_CHAIN_TIME_BUDGET_MS + WORST_ROUND_MS * 2 + TRIGGER_MS < VERCEL_LIMIT_MS);
  });
});
