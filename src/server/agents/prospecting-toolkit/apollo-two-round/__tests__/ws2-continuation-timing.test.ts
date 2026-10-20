/**
 * AGENT1-AUDIT-WS2 §§ 1, 3, 4, 5 — plazo de la invocación, conductor de
 * continuaciones y cascada tras continuar. Puro: reloj inyectado, sin red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRunDeadline, resolveInvocationStartedAtMs } from '../run-deadline';
import {
  APOLLO_CONTINUATION_MIN_JOB_ROOM_MS,
  canStartContinuationJob,
  decideContinuationLushaPrecondition,
  readApolloContinuationPending,
  runApolloRoundContinuationWorker,
  type ApolloContinuationJob,
  type ApolloContinuationWorkerDeps,
} from '../continuation-worker';

describe('§ 1 — el plazo cuenta desde el inicio de la invocación', () => {
  it('Apollo que arranca a los 150 s tiene 150 s, no 300', () => {
    const now = 150_000;
    const deadline = createRunDeadline({ now: () => now, startedAtMs: resolveInvocationStartedAtMs(0, now) });
    assert.equal(deadline.remainingMs(), 150_000);
    // Sin el inicio (como antes) creía tener 300 s.
    const legacy = createRunDeadline({ now: () => now, startedAtMs: resolveInvocationStartedAtMs(undefined, now) });
    assert.equal(legacy.remainingMs(), 300_000);
  });

  it('un inicio en el futuro o ilegible nunca da más tiempo del que queda', () => {
    assert.equal(resolveInvocationStartedAtMs(10_000, 5_000), 5_000);
    assert.equal(resolveInvocationStartedAtMs(Number.NaN, 5_000), 5_000);
    assert.equal(resolveInvocationStartedAtMs(null, 5_000), 5_000);
  });
});

function job(id: string): ApolloContinuationJob {
  return {
    id,
    batchId: `batch-${id}`,
    wizardRunId: 'run',
    idempotencyKey: 'k',
    requestFingerprint: 'f',
    attempts: 1,
    maxAttempts: 3,
    leaseToken: `lease-${id}`,
  };
}

describe('§ 1 — el conductor no empieza un trabajo sin hueco', () => {
  it('canStartContinuationJob exige el plazo propio Y el hueco mínimo hasta el límite', () => {
    assert.equal(canStartContinuationJob({ elapsedMs: 0, timeBudgetMs: 240_000 }), true);
    assert.equal(
      canStartContinuationJob({ elapsedMs: 300_000 - APOLLO_CONTINUATION_MIN_JOB_ROOM_MS + 1, timeBudgetMs: 240_000 }),
      false,
      '🔴 antes empezaba hasta los 240 s, a 60 s del límite',
    );
    assert.equal(canStartContinuationJob({ elapsedMs: 240_000, timeBudgetMs: 240_000 }), false);
  });

  it('pasa su inicio a la reanudación y aplaza el segundo trabajo si no cabe', async () => {
    let clock = 1_000;
    const resumedWith: number[] = [];
    const settled: Array<{ jobId: string; resolution: string }> = [];
    const deps: ApolloContinuationWorkerDeps = {
      claimJobs: async () => [job('a'), job('b')],
      loadCheckpointView: async () => ({
        wizardRunId: 'run',
        idempotencyKey: 'k',
        requestFingerprint: 'f',
        pendingOrganizationCount: 3,
        candidatesPersisted: false,
      }),
      resumeRun: async ({ invocationStartedAtMs }) => {
        resumedWith.push(invocationStartedAtMs);
        clock += 200_000; // el primer trabajo se come 200 s
        return { assessmentDeadlineReached: false, pendingOrganizationCount: 0 };
      },
      settleJob: async ({ jobId, resolution }) => void settled.push({ jobId, resolution }),
      now: () => clock,
    };
    const stats = await runApolloRoundContinuationWorker(deps);
    assert.deepEqual(resumedWith, [1_000], 'la reanudación recibe el inicio del conductor');
    assert.equal(stats.deferredForTime, 1, 'el segundo trabajo vuelve a la cola: no cabría');
    assert.deepEqual(settled.map((s) => s.resolution), ['completed', 'requeued']);
  });
});

describe('§§ 3, 4 — Lusha tras una continuación', () => {
  it('sin tiempo ⇒ skipped_no_time; sin sesión (cron) ⇒ skipped_no_session; con ambas ⇒ sigue', () => {
    assert.equal(decideContinuationLushaPrecondition({ elapsedMs: 250_000, hasUserSession: true }), 'skipped_no_time');
    assert.equal(decideContinuationLushaPrecondition({ elapsedMs: 10_000, hasUserSession: false }), 'skipped_no_session');
    assert.equal(decideContinuationLushaPrecondition({ elapsedMs: 10_000, hasUserSession: true }), null);
  });
});

describe('§ 5 — pausa provisional sólo si alguien la retoma', () => {
  it('readApolloContinuationPending', () => {
    assert.equal(readApolloContinuationPending({ assessmentDeadlineReached: true }), true, 'sin dato: como antes');
    assert.equal(readApolloContinuationPending({ assessmentDeadlineReached: true, continuationEnqueued: true }), true);
    assert.equal(readApolloContinuationPending({ assessmentDeadlineReached: true, continuationEnqueued: false }), false);
    assert.equal(readApolloContinuationPending({ assessmentDeadlineReached: false }), false);
    assert.equal(readApolloContinuationPending(null), false);
  });
});
