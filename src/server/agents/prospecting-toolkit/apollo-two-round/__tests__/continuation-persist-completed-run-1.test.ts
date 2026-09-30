/**
 * AGENT1-APOLLO-CONTINUATION-PERSIST-COMPLETED-RUN-1 — una corrida ya pagada y
 * evaluada entera no se pierde por quedarse sin tiempo ESCRIBIENDO.
 *
 * Medido en Producción el 2026-09-30 (México × Tecnología, lote `6d39ed4b`):
 * 3 búsquedas y 5 enrichments pagados; la continuación dejó el checkpoint en
 * `run_completed` y el writer no terminó dentro de los 300 s de la función
 * (0 candidatas escritas, lease caducado). Al reclamarla de nuevo, el conductor
 * veía «0 organizaciones pendientes» y la cerraba como `nothing_pending`: lo
 * pagado se tiraba. Y la pantalla la pintaba «terminada».
 *
 *   § 1 · el conductor reanuda para ESCRIBIR sólo si la evaluación terminó;
 *   § 2 · la pantalla la sigue mostrando abierta;
 *   § 3 · la pasada gratuita por los sitios web ya no es secuencial ni infinita.
 *
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloRoundContinuationWorker,
  type ApolloContinuationCheckpointView,
  type ApolloContinuationJob,
  type ApolloContinuationWorkerDeps,
} from '../continuation-worker';
import { resolveApolloContinuationUiStatus } from '@/modules/prospect-batches/apollo-continuation-status';
import {
  runWebsiteLinkedInExtraction,
  type WebsiteLinkedInBatchCandidate,
} from '../../linkedin-website-social-extractor';
import type { LinkedInEnrichmentMetadata } from '../../types';

// ─── § 1 ──────────────────────────────────────────────────────────────────────

const JOB: ApolloContinuationJob = {
  id: 'job-1',
  batchId: 'batch-1',
  wizardRunId: 'run-1',
  idempotencyKey: 'idem-1',
  requestFingerprint: 'fp-1',
  attempts: 2,
  maxAttempts: 3,
  leaseToken: 'lease-1',
};

function view(overrides: Partial<ApolloContinuationCheckpointView>): ApolloContinuationCheckpointView {
  return {
    wizardRunId: 'run-1',
    idempotencyKey: 'idem-1',
    requestFingerprint: 'fp-1',
    pendingOrganizationCount: 0,
    candidatesPersisted: false,
    ...overrides,
  };
}

async function drive(checkpoint: ApolloContinuationCheckpointView) {
  let resumed = 0;
  const settled: string[] = [];
  const deps: ApolloContinuationWorkerDeps = {
    claimJobs: async () => [JOB],
    loadCheckpointView: async () => checkpoint,
    resumeRun: async () => {
      resumed++;
      return { assessmentDeadlineReached: false, pendingOrganizationCount: 0 };
    },
    settleJob: async ({ resolution }) => {
      settled.push(resolution);
    },
    now: () => 0,
  };
  const stats = await runApolloRoundContinuationWorker(deps, { batchId: 'batch-1' });
  return { resumed, settled, stats };
}

describe('§ 1 — el conductor escribe lo ya pagado', () => {
  it('🔴 `run_completed` + sin escribir ⇒ se reanuda (para escribir) y se cierra completed', async () => {
    const r = await drive(view({ assessmentCompleted: true }));
    assert.equal(r.resumed, 1, 'antes: 0 — se cerraba como nothing_pending');
    assert.deepEqual(r.settled, ['completed']);
  });

  it('ya escrita ⇒ nothing_pending, sin reanudar', async () => {
    const r = await drive(view({ assessmentCompleted: true, candidatesPersisted: true }));
    assert.equal(r.resumed, 0);
    assert.deepEqual(r.settled, ['nothing_pending']);
  });

  it('una pausa con 0 pendientes que NO terminó de evaluar ⇒ nothing_pending (no abre gasto)', async () => {
    const r = await drive(view({ assessmentCompleted: false }));
    assert.equal(r.resumed, 0);
    assert.deepEqual(r.settled, ['nothing_pending']);
  });

  it('una vista antigua sin el campo se comporta como siempre', async () => {
    const r = await drive(view({}));
    assert.equal(r.resumed, 0);
    assert.deepEqual(r.settled, ['nothing_pending']);
  });

  it('con organizaciones pendientes, nada cambia: se reanuda', async () => {
    const r = await drive(view({ pendingOrganizationCount: 3 }));
    assert.equal(r.resumed, 1);
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

describe('§ 2 — la pantalla no la pinta «terminada»', () => {
  it('🔴 0 pendientes + escritura pendiente + trabajo en cola ⇒ pending_continuation', () => {
    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 0, jobStatus: 'pending', persistencePending: true }),
      'pending_continuation',
    );
  });
  it('… y si alguien la está procesando ⇒ processing', () => {
    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 0, jobStatus: 'processing', persistencePending: true }),
      'processing',
    );
  });
  it('sin trabajo abierto, sigue terminada; y sin el flag, lo de siempre', () => {
    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 0, jobStatus: 'completed', persistencePending: true }),
      'finished',
    );
    assert.equal(resolveApolloContinuationUiStatus({ pendingOrganizationCount: 0, jobStatus: 'pending' }), 'finished');
    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 0, jobStatus: 'failed', persistencePending: true }),
      'failed',
    );
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

const NOT_FOUND = { status: 'not_found' } as unknown as LinkedInEnrichmentMetadata;

function candidates(n: number): WebsiteLinkedInBatchCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Empresa ${i}`,
    website: `https://empresa${i}.com.mx`,
    domain: `empresa${i}.com.mx`,
    countryCode: 'MX',
    currentEnrichment: NOT_FOUND,
  }));
}

describe('§ 3 — la pasada por los sitios web cabe en el tiempo', () => {
  it('🔴 corre en paralelo (nunca más de `concurrency` a la vez) y conserva el orden', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await runWebsiteLinkedInExtraction(candidates(20), '2026-09-30T00:00:00Z', {
      concurrency: 5,
      extract: async (input) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return {
          status: 'not_found',
          linkedInUrl: null,
          slug: null,
          reason: `visto:${input.candidateDomain}`,
          pages_attempted: 1,
        } as never;
      },
    });
    assert.ok(peak > 1, 'antes era secuencial');
    assert.ok(peak <= 5);
    assert.equal(out.results.length, 20);
    assert.equal(out.batchSummary.attempted_count, 20);
    assert.equal(out.batchSummary.pages_attempted_count, 20);
  });

  it('🔴 pasado el presupuesto no EMPIEZA ninguna más: el resto queda skipped', async () => {
    let clock = 0;
    const out = await runWebsiteLinkedInExtraction(candidates(10), '2026-09-30T00:00:00Z', {
      concurrency: 1,
      timeBudgetMs: 3,
      now: () => clock,
      extract: async () => {
        clock += 1;
        return { status: 'not_found', linkedInUrl: null, slug: null, reason: null, pages_attempted: 1 } as never;
      },
    });
    assert.equal(out.batchSummary.attempted_count, 3);
    assert.equal(out.batchSummary.skipped_count, 7);
    assert.equal(out.results.filter((r) => r.extractionStatus === 'skipped').length, 7);
  });

  it('un fallo inesperado del extractor cuenta como error y no tumba la pasada', async () => {
    const out = await runWebsiteLinkedInExtraction(candidates(3), '2026-09-30T00:00:00Z', {
      extract: async (input) => {
        if (input.candidateDomain === 'empresa1.com.mx') throw new Error('boom');
        return { status: 'not_found', linkedInUrl: null, slug: null, reason: null, pages_attempted: 1 } as never;
      },
    });
    assert.equal(out.batchSummary.error_count, 1);
    assert.equal(out.results[1]!.extractionStatus, 'error');
    assert.equal(out.results.length, 3);
  });

  it('las que ya traen LinkedIn o no tienen web se saltan sin visitar nada', async () => {
    let calls = 0;
    const input = candidates(2);
    input[0] = { ...input[0]!, website: null };
    input[1] = { ...input[1]!, currentEnrichment: { status: 'found' } as unknown as LinkedInEnrichmentMetadata };
    const out = await runWebsiteLinkedInExtraction(input, '2026-09-30T00:00:00Z', {
      extract: async () => {
        calls++;
        return { status: 'not_found', linkedInUrl: null, slug: null, reason: null, pages_attempted: 1 } as never;
      },
    });
    assert.equal(calls, 0);
    assert.equal(out.batchSummary.skipped_count, 2);
  });
});
