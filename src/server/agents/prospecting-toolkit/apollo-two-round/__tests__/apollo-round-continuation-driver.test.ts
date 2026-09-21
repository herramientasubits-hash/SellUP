/**
 * apollo-round-continuation-driver.test.ts
 *
 * AGENT1-APOLLO-ROUND-EXECUTION-TIME-BUDGET § 7 — el RECORRIDO COMPLETO.
 *
 * ── Qué prueba, y por qué así ────────────────────────────────────────────────
 *
 * Guardar `pending_organizations` no es retomarlas. Esta suite ejercita el
 * CONDUCTOR REAL (`runApolloRoundContinuationWorker`) contra el ORQUESTADOR REAL
 * (`runApolloTwoRoundDiscovery`), con una cola y un almacén de checkpoints en
 * memoria y con I/O simulado. Ninguna pieza de política está mockeada: lo único
 * fingido es la red y la base.
 *
 * El recorrido: 166 organizaciones → pausa forzada → continuación → final.
 *
 * G1 · el flujo TERMINA solo, en varias invocaciones, sin tocar nada a mano.
 * G2 · una sola búsqueda pagada en todo el recorrido.
 * G3 · ninguna evaluación completada se repite en una reanudación normal.
 * G4 · los recuentos salen completos: ni se pierden ni se cuentan dos veces.
 * G5 · el presupuesto acumulado sobrevive a las reanudaciones.
 * G6 · persistencia idempotente: reanudar un lote cerrado no hace nada.
 * G7 · fallo y reintento de la continuación, con agotamiento acotado.
 * G8 · el plazo del conductor aplaza trabajos en vez de morir a mitad.
 *
 * 0 llamadas reales · 0 créditos · 0 red · 0 base · 0 Producción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundResumeState,
  type ApolloTwoRoundRunResult,
  type RawDiscoveredOrganization,
} from '../orchestrator';
import {
  runApolloRoundContinuationWorker,
  continuationIdentityMatches,
  type ApolloContinuationJob,
  type ApolloContinuationCheckpointView,
  type ApolloContinuationWorkerDeps,
} from '../continuation-worker';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  orgs,
  passingAssessment,
  rejectedAssessment,
  simulatedEffectiveRequestBuilder,
} from './fixtures';

const ORGANIZATIONS = 166;
const CONCURRENCY = 8;
const IDEMPOTENCY_KEY = 'idem-a86e3fdd';
const REQUEST_FINGERPRINT = 'fp-a86e3fdd';
const WIZARD_RUN_ID = 'run-7d8a9b85';
const BATCH_ID = 'batch-a86e3fdd';

/** Cola durable, en memoria. Espeja los estados de la migración 139. */
type QueuedJob = ApolloContinuationJob & {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  lastResolution?: string;
};

type World = {
  queue: QueuedJob[];
  checkpoint: ApolloTwoRoundResumeState | null;
  /** Cuántas veces se pidió una búsqueda al proveedor. Debe quedarse en 1. */
  searchCalls: number;
  /** Cuántas veces se evaluó CADA organización, en todo el recorrido. */
  assessmentsById: Map<string, number>;
  /** Invocaciones del orquestador (la primera más las continuaciones). */
  runs: ApolloTwoRoundRunResult[];
  /** Tandas permitidas por invocación; `null` = sin límite. */
  wavesPerInvocation: number | null;
  resumeFailuresRemaining: number;
};

function newWorld(options: { wavesPerInvocation?: number | null } = {}): World {
  return {
    queue: [],
    checkpoint: null,
    searchCalls: 0,
    assessmentsById: new Map(),
    runs: [],
    wavesPerInvocation: options.wavesPerInvocation ?? null,
    resumeFailuresRemaining: 0,
  };
}

/** Una invocación del orquestador. Es la unidad que el runtime limita. */
async function invokeOrchestrator(world: World): Promise<ApolloTwoRoundRunResult> {
  let wavesLeft = world.wavesPerInvocation;

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }) => {
      world.searchCalls++;
      return {
        organizations: roundNumber === 1 ? orgs('a', ORGANIZATIONS) : [],
        providerRequestCount: 1,
        internalRecordedCredits: 2,
      };
    },
    assessmentConcurrency: CONCURRENCY,
    assessmentTimeGuard:
      wavesLeft === null
        ? undefined
        : () => {
            if (wavesLeft === null) return true;
            if (wavesLeft <= 0) return false;
            wavesLeft--;
            return true;
          },
    assessCandidate: async ({ organization }) => {
      const id = organization.providerOrganizationId ?? '';
      world.assessmentsById.set(id, (world.assessmentsById.get(id) ?? 0) + 1);
      // I/O simulado: cede el turno sin dormir.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return rejectedAssessment('country_incompatible');
    },
    enrichCandidate: async () => ({
      executed: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      internalRecordedCredits: 1,
    }),
    saveCheckpoint: (checkpoint) => {
      world.checkpoint = checkpoint.resume;
      return true;
    },
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig({ maxRounds: 1 }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      remainingTarget: null,
      ...(world.checkpoint ? { resume: world.checkpoint } : {}),
    },
    deps,
  );
  world.runs.push(result);

  // Pausa ⇒ encola, con la misma exclusión que el índice único de la migración.
  if (result.assessmentDeadlineReached && result.pendingOrganizationCount > 0) {
    const live = world.queue.some(
      (job) => job.batchId === BATCH_ID && (job.status === 'pending' || job.status === 'processing'),
    );
    if (!live) {
      world.queue.push({
        id: `job-${world.queue.length + 1}`,
        batchId: BATCH_ID,
        wizardRunId: WIZARD_RUN_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        requestFingerprint: REQUEST_FINGERPRINT,
        attempts: 0,
        maxAttempts: 3,
        status: 'pending',
      });
    }
  }
  return result;
}

/** Las dependencias REALES del conductor, contra el mundo en memoria. */
function workerDeps(world: World, clock: { value: number }): ApolloContinuationWorkerDeps {
  return {
    claimJobs: async ({ limit }) => {
      const claimed = world.queue.filter((job) => job.status === 'pending').slice(0, limit);
      for (const job of claimed) {
        job.status = 'processing';
        job.attempts++;
      }
      return claimed.map((job) => ({ ...job }));
    },
    loadCheckpointView: async (batchId): Promise<ApolloContinuationCheckpointView | null> => {
      if (batchId !== BATCH_ID || world.checkpoint === null) return null;
      const pending = (world.checkpoint.pendingRoundOrganizations ?? []).reduce(
        (total, entry) => total + entry.organizations.length,
        0,
      );
      return {
        wizardRunId: WIZARD_RUN_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        requestFingerprint: REQUEST_FINGERPRINT,
        pendingOrganizationCount: pending,
        candidatesPersisted: world.checkpoint.candidatesPersisted === true,
      };
    },
    resumeRun: async () => {
      if (world.resumeFailuresRemaining > 0) {
        world.resumeFailuresRemaining--;
        throw new Error('resume_transient_failure');
      }
      const result = await invokeOrchestrator(world);
      return {
        assessmentDeadlineReached: result.assessmentDeadlineReached,
        pendingOrganizationCount: result.pendingOrganizationCount,
      };
    },
    settleJob: async ({ jobId, status, resolution }) => {
      const job = world.queue.find((entry) => entry.id === jobId);
      if (!job) return;
      job.status = status;
      job.lastResolution = resolution;
    },
    now: () => clock.value,
  };
}

/** Corre el conductor hasta que la cola se queda sin trabajo pendiente. */
async function drain(world: World, maxInvocations = 60): Promise<number> {
  const clock = { value: 0 };
  let invocations = 0;
  while (world.queue.some((job) => job.status === 'pending') && invocations < maxInvocations) {
    invocations++;
    clock.value += 1_000;
    await runApolloRoundContinuationWorker(workerDeps(world, clock), { limit: 1 });
  }
  return invocations;
}

// ── G1 · el flujo termina solo ───────────────────────────────────────────────

describe('§ G1 — 166 organizaciones, pausa, continuación y final SIN intervención', () => {
  test('la primera invocación pausa y el conductor la lleva hasta el final', async () => {
    // 3 tandas de 8 por invocación: la ronda NO cabe en una sola.
    const world = newWorld({ wavesPerInvocation: 3 });

    const first = await invokeOrchestrator(world);
    assert.equal(first.assessmentDeadlineReached, true, 'la primera invocación se queda sin tiempo');
    assert.ok(first.pendingOrganizationCount > 0);
    assert.equal(world.queue.length, 1, 'la pausa encola exactamente una continuación');

    const invocations = await drain(world);

    assert.ok(invocations > 1, 'hicieron falta varias vueltas, que es justo el punto');
    assert.equal(
      world.queue.filter((job) => job.status === 'pending').length,
      0,
      'no queda trabajo pendiente',
    );
    const last = world.runs[world.runs.length - 1]!;
    assert.equal(last.assessmentDeadlineReached, false, 'la última vuelta ya no se queda sin tiempo');
    assert.equal(last.pendingOrganizationCount, 0);
    assert.equal(world.queue[0]!.status, 'completed');
  });
});

// ── G2/G3 · una búsqueda, ninguna evaluación repetida ────────────────────────

describe('§ G2 y G3 — el recorrido no vuelve a pagar ni a repetir trabajo', () => {
  test('una sola búsqueda y exactamente una evaluación por organización', async () => {
    const world = newWorld({ wavesPerInvocation: 4 });
    await invokeOrchestrator(world);
    await drain(world);

    assert.equal(world.searchCalls, 1, 'la búsqueda ya pagada NO se repite en ninguna vuelta');
    assert.equal(
      world.assessmentsById.size,
      ORGANIZATIONS,
      'todas las organizaciones pagadas acabaron evaluadas',
    );
    for (const [id, calls] of world.assessmentsById) {
      assert.equal(calls, 1, `${id} se evaluó ${calls} veces en el recorrido completo`);
    }
  });
});

// ── G4/G5 · recuentos y presupuesto ──────────────────────────────────────────

describe('§ G4 y G5 — los recuentos y el gasto sobreviven a las reanudaciones', () => {
  test('la ronda se publica UNA vez y con el recuento completo', async () => {
    const world = newWorld({ wavesPerInvocation: 5 });
    await invokeOrchestrator(world);
    await drain(world);

    const last = world.runs[world.runs.length - 1]!;
    assert.equal(last.rounds.length, 1, 'una ronda, publicada una sola vez');
    assert.equal(
      last.rounds[0]!.normalizedResults,
      ORGANIZATIONS,
      'el recuento de la ronda es el TOTAL, no el de la última vuelta',
    );
  });

  test('el mismo recuento sale con y sin pausas: acumular no cambia el total', async () => {
    const paused = newWorld({ wavesPerInvocation: 3 });
    await invokeOrchestrator(paused);
    await drain(paused);

    const uninterrupted = newWorld({ wavesPerInvocation: null });
    await invokeOrchestrator(uninterrupted);

    const a = paused.runs[paused.runs.length - 1]!.rounds[0]!;
    const b = uninterrupted.runs[0]!.rounds[0]!;
    assert.deepEqual(a, b, 'una corrida pausada y una de un tirón cuentan lo mismo');
  });

  test('los créditos de búsqueda no se re-acumulan al reanudar', async () => {
    const world = newWorld({ wavesPerInvocation: 3 });
    await invokeOrchestrator(world);
    await drain(world);

    const last = world.runs[world.runs.length - 1]!;
    assert.equal(
      last.runMetrics.totalSearchCredits,
      2,
      'el gasto es el de la ÚNICA búsqueda, no el de una por vuelta',
    );
  });
});

// ── G6 · idempotencia ────────────────────────────────────────────────────────

describe('§ G6 — reanudar lo ya terminado no hace nada', () => {
  test('un lote sin pendientes se cierra sin volver a evaluar', async () => {
    const world = newWorld({ wavesPerInvocation: null });
    await invokeOrchestrator(world);
    assert.equal(world.queue.length, 0, 'sin pausa no hay continuación que encolar');

    // Se fuerza un trabajo sobre un lote que ya no tiene pendientes.
    world.queue.push({
      id: 'job-forzado',
      batchId: BATCH_ID,
      wizardRunId: WIZARD_RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestFingerprint: REQUEST_FINGERPRINT,
      attempts: 0,
      maxAttempts: 3,
      status: 'pending',
    });
    const assessmentsBefore = world.assessmentsById.size;
    const runsBefore = world.runs.length;

    const clock = { value: 0 };
    const stats = await runApolloRoundContinuationWorker(workerDeps(world, clock), { limit: 1 });

    assert.equal(stats.resolutions[0]!.resolution, 'nothing_pending');
    assert.equal(world.queue[0]!.status, 'completed');
    assert.equal(world.runs.length, runsBefore, 'no se reanudó nada');
    assert.equal(world.assessmentsById.size, assessmentsBefore, 'no se evaluó nada de nuevo');
  });

  test('un trabajo de OTRA corrida se descarta sin tocar el lote', async () => {
    const world = newWorld({ wavesPerInvocation: 3 });
    await invokeOrchestrator(world);
    world.queue[0]!.idempotencyKey = 'idem-de-otra-corrida';
    const runsBefore = world.runs.length;

    const clock = { value: 0 };
    const stats = await runApolloRoundContinuationWorker(workerDeps(world, clock), { limit: 1 });

    assert.equal(stats.resolutions[0]!.resolution, 'identity_mismatch');
    assert.equal(world.queue[0]!.status, 'skipped');
    assert.equal(world.runs.length, runsBefore);
  });

  test('la comprobación de identidad exige las tres piezas', () => {
    const job: ApolloContinuationJob = {
      id: 'j',
      batchId: BATCH_ID,
      wizardRunId: WIZARD_RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestFingerprint: REQUEST_FINGERPRINT,
      attempts: 0,
      maxAttempts: 3,
    };
    const view: ApolloContinuationCheckpointView = {
      wizardRunId: WIZARD_RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestFingerprint: REQUEST_FINGERPRINT,
      pendingOrganizationCount: 1,
      candidatesPersisted: false,
    };
    assert.equal(continuationIdentityMatches(job, view), true);
    assert.equal(continuationIdentityMatches(job, { ...view, idempotencyKey: 'x' }), false);
    assert.equal(continuationIdentityMatches(job, { ...view, requestFingerprint: 'x' }), false);
    assert.equal(continuationIdentityMatches(job, { ...view, wizardRunId: 'x' }), false);
    // Checkpoint antiguo sin `wizard_run_id`: la identidad la prueban las otras dos.
    assert.equal(continuationIdentityMatches(job, { ...view, wizardRunId: null }), true);
  });
});

// ── G7 · fallo, reintento y agotamiento ──────────────────────────────────────

describe('§ G7 — la continuación falla, reintenta y acaba acotándose', () => {
  test('un fallo transitorio devuelve el trabajo a la cola y el flujo termina', async () => {
    const world = newWorld({ wavesPerInvocation: 4 });
    await invokeOrchestrator(world);
    world.resumeFailuresRemaining = 1;

    const invocations = await drain(world);

    assert.ok(invocations >= 2, 'el fallo costó una vuelta, no el recorrido');
    assert.equal(world.queue.filter((job) => job.status === 'pending').length, 0);
    assert.equal(world.assessmentsById.size, ORGANIZATIONS, 'ninguna organización se perdió');
    for (const [, calls] of world.assessmentsById) assert.equal(calls, 1);
  });

  test('agotados los intentos el trabajo se marca fallido y NO entra en bucle', async () => {
    const world = newWorld({ wavesPerInvocation: 3 });
    await invokeOrchestrator(world);
    world.resumeFailuresRemaining = Number.MAX_SAFE_INTEGER;

    const invocations = await drain(world, 20);

    const job = world.queue[0]!;
    assert.equal(job.status, 'failed');
    assert.equal(job.lastResolution, 'exhausted');
    assert.ok(job.attempts <= job.maxAttempts + 1, `intentos desbocados: ${job.attempts}`);
    assert.ok(invocations < 20, 'el conductor paró solo');
  });
});

// ── G8 · plazo del conductor ─────────────────────────────────────────────────

describe('§ G8 — el conductor aplaza en vez de morir a mitad', () => {
  test('sin plazo restante, el trabajo vuelve a la cola intacto', async () => {
    const world = newWorld({ wavesPerInvocation: 3 });
    await invokeOrchestrator(world);
    const runsBefore = world.runs.length;

    const clock = { value: 0 };
    const deps = workerDeps(world, clock);
    const stats = await runApolloRoundContinuationWorker(
      { ...deps, now: () => (clock.value += 500_000) },
      { limit: 1, timeBudgetMs: 1_000 },
    );

    assert.equal(stats.deferredForTime, 1);
    assert.equal(world.runs.length, runsBefore, 'no se empezó un trabajo sin tiempo para él');
    assert.equal(world.queue[0]!.status, 'pending', 'sigue en la cola, intacto');
  });
});
