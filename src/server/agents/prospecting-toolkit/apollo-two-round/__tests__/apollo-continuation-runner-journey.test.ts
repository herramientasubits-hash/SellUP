/**
 * apollo-continuation-runner-journey.test.ts
 *
 * AGENT1-APOLLO-CONTINUATION-COMPLETES § 7 — LA PRUEBA QUE FALTÓ.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * La suite anterior conducía el ORQUESTADOR. Pasaba en verde, CI pasaba en
 * verde, y la continuación no reanudaba NADA en producción: el defecto vivía en
 * el RUNNER, que tras pausar seguía hasta persistir candidatos y dejaba
 * `candidates_persisted: true`. El conductor leía ese campo como «no queda
 * trabajo» y cerraba el trabajo al instante. Justo la costura que la prueba no
 * cruzaba.
 *
 * Aquí se ejercita `runApolloTwoRoundWizardDiscovery` —el runner REAL, con su
 * persistencia y su finalización— contra el conductor REAL, con el checkpoint y
 * la cola en memoria y el reloj inyectado.
 *
 * El recorrido: 166 organizaciones → pausa → encolado → continuación desde el
 * wizard → finalización.
 *
 * G1 · la pausa NO persiste ni finaliza, y deja el trabajo encolado.
 * G2 · la continuación termina el recorrido: evalúa, escribe y cierra.
 * G3 · una sola búsqueda, una sola escritura, ninguna evaluación repetida.
 * G4 · presupuesto acumulado: reanudar no vuelve a cobrar lo ya cobrado.
 * G5 · caída y recuperación: un lease vencido se vuelve a reclamar.
 * G6 · worker antiguo: su cierre no pisa el estado del nuevo.
 * G7 · cascada: no en la pausa; sí al terminar, y con la política congelada.
 * G8 · aislamiento Apollo-only y fallo de encolado.
 *
 * I/O simulado. 0 proveedores reales · 0 créditos · 0 red · 0 Producción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import {
  readTwoRoundCheckpoint,
  writeTwoRoundCheckpoint,
  type CheckpointStoreClient,
} from '../checkpoint.server';
import { APOLLO_TWO_ROUND_CHECKPOINT_KEY, type ApolloTwoRoundCheckpointV1 } from '../checkpoint';
import { defaultApolloTwoRoundConfig } from '../config';
import { captureApolloCompanyFields } from '../../apollo-company-fields-mapping';
import type { ProspectingPipelineCandidate, WebSearchOutput, WebSearchResult } from '../../types';
import {
  runApolloRoundContinuationWorker,
  resolveContinuationCascadeInputs,
  restoreContinuationRunInput,
  type ApolloContinuationJob,
  type ApolloContinuationRunPolicy,
  type ApolloContinuationWorkerDeps,
  type ContinuationJobMetadata,
} from '../continuation-worker';
import type { ResolveExtraBatchMetadata } from '../../writer-metadata-resolution';
import {
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  buildWriterAcceptedForTargetMetadata,
  type RunAcceptanceFacts,
} from '@/modules/prospect-batches/accepted-for-target';
import { resolveProviderResultDemand } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';

const CORRELATION = {
  wizardRunId: 'run-continuation-1',
  clientRequestId: 'client-continuation-1',
  batchId: 'batch-continuation-1',
  reservationId: 'reservation-continuation-1',
  requestFingerprint: 'fingerprint-continuation-1',
  idempotencyKey: 'idempotency-continuation-1',
};

// ─── Almacén compartido con CAS real ──────────────────────────────────────────

/**
 * `prospect_batches.metadata` de UN lote, compartido por los dos procesos.
 *
 * Reproduce el filtro de comparación-y-cambio sobre `checkpoint_version` que
 * PostgREST aplica: un UPDATE cuyo filtro no coincide afecta CERO filas, que es
 * exactamente lo que convierte una escritura concurrente en `stale_rejected`.
 */
function sharedBatchStore(): {
  client: CheckpointStoreClient;
  read: () => Record<string, unknown>;
  storedCheckpoint: () => ApolloTwoRoundCheckpointV1 | null;
  updates: number;
} {
  let document: Record<string, unknown> = {};
  const store = {
    updates: 0,
    read: () => document,
    storedCheckpoint: () =>
      (document[APOLLO_TWO_ROUND_CHECKPOINT_KEY] as ApolloTwoRoundCheckpointV1 | undefined) ?? null,
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { metadata: document }, error: null }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          const apply = (matches: boolean) => ({
            select: async () => {
              if (!matches) return { data: [], error: null };
              store.updates++;
              document = values['metadata'] as Record<string, unknown>;
              return { data: [{ id: CORRELATION.batchId }], error: null };
            },
          });
          return {
            eq: () => ({
              eq: (column: string, value: string) => {
                const stored = document[APOLLO_TWO_ROUND_CHECKPOINT_KEY] as
                  | { checkpoint_version?: number }
                  | undefined;
                return apply(
                  column.includes('checkpoint_version') &&
                    String(stored?.checkpoint_version ?? '') === value,
                );
              },
              is: () => apply(document[APOLLO_TWO_ROUND_CHECKPOINT_KEY] === undefined),
            }),
          };
        },
      }),
    } as unknown as CheckpointStoreClient,
  };
  return store;
}

// ─── Proveedor y filas económicas compartidos ─────────────────────────────────

/**
 * Lo que el mundo exterior observa, compartido por todos los procesos del run.
 *
 * `providerCalls` cuenta llamadas REALES: una operación ya ejecutada se sirve del
 * ledger, que es lo que la idempotencia del hito garantiza. `usageLogs` deduplica
 * por `usage_key` igual que el índice único de `provider_usage_logs`.
 */
type ExternalWorld = {
  providerCalls: number;
  usageLogs: Map<string, { credits: number }>;
  writerCalls: number;
  ledger: Map<string, WebSearchOutput>;
  /**
   * AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — el resolutor de metadata que el
   * writer RECIBIÓ en cada escritura. `null` = llegó sin él.
   */
  writerResolvers: (ResolveExtraBatchMetadata | null)[];
};

function externalWorld(): ExternalWorld {
  return {
    providerCalls: 0,
    usageLogs: new Map(),
    writerCalls: 0,
    ledger: new Map(),
    writerResolvers: [],
  };
}

function recordedCredits(world: ExternalWorld): number {
  return [...world.usageLogs.values()].reduce((total, row) => total + row.credits, 0);
}

const FIXTURE_OBSERVED_AT = '2026-08-10T00:00:00.000Z';

function supermarket(index: number): WebSearchResult {
  return {
    // AGENT1-APOLLO-FINALIZATION-HARDENING-1 § A — el nombre coincide con el
    // dominio ("supermercadoN" ≈ "supermercadoN.com.co"). Antes decía
    // "Supermercado Uno N", que el gate REAL de ownership rechaza (el dominio no
    // contiene "uno"); ese rechazo estaba oculto porque los gates finales sólo
    // corrían al final, después de que la decisión de enrichment ya se hubiera
    // tomado sobre un `eligibleCount()` provisional. Con la § A resuelta, el
    // rechazo se ve ANTES, y expuso que el fixture nunca pasaba ownership — algo
    // ajeno a lo que esta suite prueba (la resolución de CAS concurrente).
    title: `Supermercado ${index}`,
    url: `https://supermercado${index}.com.co`,
    snippet: 'cadena de supermercados y autoservicio con tiendas de abarrotes',
    source: 'apollo_organizations',
    rank: index,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `org-${index}`,
      domain: `supermercado${index}.com.co`,
      industry: 'retail',
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 500,
      estimated_num_employees: 500,
      // STABLE-TARGET-WRITER-PARITY § 6 — sin LinkedIn el contrato de
      // completitud deja al candidato fuera del objetivo, la corrida no se
      // detiene y compra enrichments que esta suite —que prueba la resolución
      // de CAS concurrente, no la completitud— prohíbe explícitamente.
      linkedin_url: `https://www.linkedin.com/company/org-${index}`,
      apollo_profile: { industry: 'retail', industries: [] },
    },
  };
}

const ROUND_1_RESULTS = [1, 2, 3, 4, 5].map(supermarket);
const SEARCH_CREDITS = 1;

function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const domain = (result.metadata?.['domain'] as string) ?? null;
  // § 1 — el doble reproduce lo que produce `buildCandidateFromResult`.
  const providerCompanyFields = captureApolloCompanyFields(result, FIXTURE_OBSERVED_AT);
  return {
    name: result.title,
    website: result.url,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Supermercados e Hipermercados',
    sourceUrl: result.url,
    sourceTitle: result.title,
    sourceSnippet: result.snippet ?? null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 0,
      input: { name: result.title, domain },
      matches: [],
      summary: 'test',
      checkedSources: ['sellup', 'hubspot'],
    } as ProspectingPipelineCandidate['duplicateCheck'],
    scoring: { qualityLabel: 'high_quality_new' } as ProspectingPipelineCandidate['scoring'],
    providerCompanyFields,
    companyLinkedInUrl: providerCompanyFields.linkedin.companyLinkedInUrl,
    ...(providerCompanyFields.employeeCount.status === 'confirmed'
      ? { employeeCount: providerCompanyFields.employeeCount.employeeCount }
      : {}),
  };
}

/**
 * Dependencias de UN proceso del run.
 *
 * `staleFirstLoad` reproduce el interleaving exacto del contrato: el proceso lee
 * el checkpoint ANTES de que el otro escriba (versión N), y sólo las relecturas
 * posteriores —las que hace la resolución del `stale_rejected`— ven el documento
 * ganador.
 *
 * `maxRounds` existe por WRITER-ONLY-ADMISSION-PENDING § 4. Esta suite prueba la
 * resolución de CAS concurrente, y para eso necesita una corrida SANA que emita
 * exactamente UNA operación externa. Antes lo conseguía dejando que el objetivo se
 * declarara alcanzado en la ronda 1, es decir apoyándose en la parada temprana —y
 * esa parada ya no existe en producción, porque las admisiones que sólo el writer
 * resuelve se declaran pendientes y un pendiente nunca cuenta—. Acotar las rondas
 * aquí desacopla la suite de la semántica de objetivo, que no es su tema: una
 * segunda ronda legítima añadiría una segunda operación y con ella un segundo
 * crédito, y las aserciones dejarían de hablar de contención.
 */

// ─── La ronda que no cabe: 166 organizaciones ────────────────────────────────

const ORGANIZATIONS = 166;

function manyResults(): WebSearchResult[] {
  return Array.from({ length: ORGANIZATIONS }, (_unused, index) => ({
    title: `Empresa ${index + 1}`,
    url: `https://empresa-${index + 1}.com.co`,
    snippet: 'Tecnología',
    rank: index + 1,
    metadata: { apollo_organization_id: `org-${index + 1}`, domain: `empresa-${index + 1}.com.co` },
  })) as unknown as WebSearchResult[];
}

/** Cola durable en memoria, con la exclusión del índice único parcial. */
type QueueRow = {
  id: string;
  batchId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  attempts: number;
  maxAttempts: number;
  leaseToken: string | null;
  leaseExpiresAtMs: number | null;
  runPolicy: ApolloContinuationRunPolicy | null;
  /**
   * AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — la columna `metadata` TAL COMO la
   * guarda Postgres: el payload del encolado pasado por JSON. Es lo único que un
   * worker de producción puede leer, y JSON no transporta funciones.
   */
  storedMetadata: unknown;
};

type Journey = {
  world: ExternalWorld;
  store: ReturnType<typeof sharedBatchStore>;
  queue: QueueRow[];
  assessedIds: Map<string, number>;
  /** Milisegundos que cada organización «tarda» en evaluarse. */
  clockMs: number;
  enqueueFails: boolean;
  cascadeCalls: { usefulAccumulated: number }[];
};

function newJourney(options: { enqueueFails?: boolean } = {}): Journey {
  return {
    world: externalWorld(),
    store: sharedBatchStore(),
    queue: [],
    assessedIds: new Map(),
    clockMs: 0,
    enqueueFails: options.enqueueFails === true,
    cascadeCalls: [],
  };
}

const RUN_POLICY: ApolloContinuationRunPolicy = {
  waterfallEnabledAtRunStart: true,
  lushaAvailableAtRunStart: true,
  target: 5,
  countryCode: 'CO',
  macroIndustryKey: 'technology',
  subIndustryId: null,
  requestedSubindustries: [],
  wizardClientRequestId: CORRELATION.clientRequestId,
  batchId: CORRELATION.batchId,
};

/**
 * Dependencias del runner para UNA invocación.
 *
 * `msPerOrganization` es el I/O simulado: cada evaluación adelanta el reloj
 * inyectado, así que el plazo se agota de verdad sin esperar de verdad.
 */
function runnerDeps(
  journey: Journey,
  options: { msPerOrganization: number },
): Partial<ApolloTwoRoundProductionDeps> {
  return {
    now: () => journey.clockMs,

    searchApollo: (async (
      _input: unknown,
      _maxResults: number,
      usageContext: { operationContext?: { operation_id?: string } | null },
    ) => {
      const operationId = usageContext?.operationContext?.operation_id ?? 'no_operation';
      const cached = journey.world.ledger.get(operationId);
      if (cached !== undefined) return cached;
      journey.world.providerCalls++;
      journey.world.usageLogs.set(`organizations_search:${operationId}`, { credits: 2 });
      const output: WebSearchOutput = {
        provider: 'apollo_organizations',
        query: 'tecnología',
        results: manyResults(),
        resultsCount: ORGANIZATIONS,
        skipped: false,
        skipReason: null,
        estimatedCostUsd: 0,
        metadata: { usage: { credits_used: 2 } },
      };
      journey.world.ledger.set(operationId, output);
      return output;
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => {
      const id = String((result.metadata as { apollo_organization_id?: string })?.apollo_organization_id ?? '');
      journey.assessedIds.set(id, (journey.assessedIds.get(id) ?? 0) + 1);
      // I/O simulado: el reloj avanza, el proceso no duerme.
      journey.clockMs += options.msPerOrganization;
      return { candidate: pipelineCandidate(result), nameQualityFiltered: false };
    }) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    enrichCascade: (async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_confirmed',
      internalRecordedCredits: 0,
    })) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
      resolveExtraBatchMetadata?: ResolveExtraBatchMetadata | null;
    }) => {
      journey.world.writerCalls++;
      journey.world.writerResolvers.push(writerInput.resolveExtraBatchMetadata ?? null);
      return {
        dryRun: false,
        batchId: CORRELATION.batchId,
        candidatesCreated: writerInput.pipelineOutput.candidates.length,
        candidatesSkipped: 0,
        createdCandidateIds: writerInput.pipelineOutput.candidates.map((_c, i) => `cand-${i + 1}`),
        skipped: [],
        status: 'success',
        errors: [],
      };
    }) as unknown as ApolloTwoRoundProductionDeps['persistCandidates'],

    loadNegativeMemory: async (scope) => ({
      scope,
      excludedDomains: new Set<string>(),
      excludedDomainsSample: [],
      excludedIdentityKeys: new Set<string>(),
      excludedIdentityKeysSample: [],
      previousCandidateCount: 0,
      previousBatchCount: 0,
    }),

    loadCheckpoint: async (batchId, identity) =>
      readTwoRoundCheckpoint(batchId, identity, journey.store.client),
    saveCheckpoint: (batchId, checkpoint) =>
      writeTwoRoundCheckpoint(batchId, checkpoint, journey.store.client, {
        now: () => '2026-09-21T00:00:00.000Z',
      }),

    loadEnrichmentUnitCostUsd: async () => 0.02,
    enrichOrganization: (async () => ({ success: true, data: undefined })) as never,
    logEnrichmentUsage: (async () => ({ kind: 'already_logged' as const })) as never,

    // § 7 — el encolado, con la exclusión del índice único parcial.
    enqueueContinuation: async ({ batchId, runPolicy, runInput }) => {
      if (journey.enqueueFails) return { enqueued: false, reason: 'relation_missing' };
      const live = journey.queue.some(
        (job) => job.batchId === batchId && (job.status === 'pending' || job.status === 'processing'),
      );
      if (live) return { enqueued: false, reason: 'already_queued' };
      journey.queue.push({
        id: `job-${journey.queue.length + 1}`,
        batchId,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        leaseToken: null,
        leaseExpiresAtMs: null,
        runPolicy: runPolicy ?? null,
        // Lo mismo que `enqueueApolloRoundContinuation` inserta en la columna.
        storedMetadata: JSON.parse(
          JSON.stringify({
            run_input: runInput,
            ...(runPolicy ? { run_policy: runPolicy } : {}),
          }),
        ),
      });
      return { enqueued: true };
    },
  };
}

function runInputFor(): ApolloTwoRoundWizardRunInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    subindustries: [],
    additionalCriteria: null,
    reservedBatchId: CORRELATION.batchId,
    triggeredByUserId: 'user-1',
    ownerId: 'user-1',
    correlation: CORRELATION,
    reservedCredits: 15,
    continuationRunPolicy: RUN_POLICY,
  } as unknown as ApolloTwoRoundWizardRunInput;
}

/** Una invocación del runner con el reloj en cero: 300 s frescos. */
async function invokeRunner(
  journey: Journey,
  msPerOrganization: number,
  input: ApolloTwoRoundWizardRunInput = runInputFor(),
) {
  journey.clockMs = 0;
  return runApolloTwoRoundWizardDiscovery(input, runnerDeps(journey, { msPerOrganization }));
}

/**
 * AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — reanuda como PRODUCCIÓN: desde la
 * `metadata` guardada en la cola, pasada por el MISMO `restoreContinuationRunInput`
 * que usa el worker real. Las pruebas anteriores reanudaban con un `run_input`
 * recién construido en memoria, así que la función del mago nunca se perdía y el
 * defecto no se podía ver.
 */
async function resumeFromStoredMetadata(journey: Journey, jobId: string, msPerOrganization: number) {
  const row = journey.queue.find((q) => q.id === jobId);
  const restored = restoreContinuationRunInput<ApolloTwoRoundWizardRunInput>(
    row?.storedMetadata as ContinuationJobMetadata<ApolloTwoRoundWizardRunInput>,
  );
  if (!restored) throw new Error('continuation_run_input_missing');
  return invokeRunner(journey, msPerOrganization, restored.runInput);
}

/** El conductor REAL contra la cola en memoria. */
function conductorDeps(
  journey: Journey,
  msPerOrganization: number,
  options: { resumeFromQueue?: boolean } = {},
): ApolloContinuationWorkerDeps {
  let nowMs = 1_000_000;
  return {
    claimJobs: async ({ limit, lockDurationMinutes, batchId }) => {
      const claimable = journey.queue.filter(
        (job) =>
          (batchId === null || job.batchId === batchId) &&
          (job.status === 'pending' ||
            (job.status === 'processing' &&
              job.leaseExpiresAtMs !== null &&
              job.leaseExpiresAtMs < nowMs)),
      );
      const claimed = claimable.slice(0, limit);
      const out: ApolloContinuationJob[] = [];
      for (const job of claimed) {
        job.status = 'processing';
        job.attempts++;
        job.leaseToken = `lease-${job.id}-${job.attempts}`;
        job.leaseExpiresAtMs = nowMs + lockDurationMinutes * 60_000;
        out.push({
          id: job.id,
          batchId: job.batchId,
          wizardRunId: CORRELATION.wizardRunId,
          idempotencyKey: CORRELATION.idempotencyKey,
          requestFingerprint: CORRELATION.requestFingerprint,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          leaseToken: job.leaseToken,
        });
      }
      return out;
    },
    loadCheckpointView: async (batchId) => {
      const checkpoint = await readTwoRoundCheckpoint(
        batchId,
        { idempotencyKey: CORRELATION.idempotencyKey, requestFingerprint: CORRELATION.requestFingerprint },
        journey.store.client,
      );
      if (!checkpoint) return null;
      return {
        wizardRunId: checkpoint.wizard_run_id,
        idempotencyKey: checkpoint.idempotency_key,
        requestFingerprint: checkpoint.request_fingerprint,
        pendingOrganizationCount: checkpoint.pending_organizations.length,
        candidatesPersisted: checkpoint.candidates_persisted,
      };
    },
    resumeRun: async ({ job }) => {
      const outcome = options.resumeFromQueue
        ? await resumeFromStoredMetadata(journey, job.id, msPerOrganization)
        : await invokeRunner(journey, msPerOrganization);
      const paused = outcome.assessmentDeadlineReached === true;
      const pending = outcome.pendingOrganizationCount ?? 0;
      if (!paused && pending === 0) {
        const policy = journey.queue.find((q) => q.id === job.id)?.runPolicy;
        if (policy) {
          const effective = resolveContinuationCascadeInputs(policy, {
            waterfallEnabled: true,
            lushaAvailable: true,
          });
          if (effective.waterfallEnabled && effective.lushaAvailable) {
            journey.cascadeCalls.push({ usefulAccumulated: outcome.candidatesCreated ?? 0 });
          }
        }
      }
      return { assessmentDeadlineReached: paused, pendingOrganizationCount: pending };
    },
    settleJob: async ({ jobId, leaseToken, status }) => {
      // § 3 — vallado por token: un dueño antiguo no cierra nada.
      const job = journey.queue.find((q) => q.id === jobId && q.leaseToken === leaseToken);
      if (!job) return;
      job.status = status;
      job.leaseToken = null;
      job.leaseExpiresAtMs = null;
    },
    now: () => (nowMs += 1_000),
  };
}

// ── G1 · la pausa no finaliza ────────────────────────────────────────────────

describe('§ G1 — una pausa conserva el trabajo y NO marca la corrida terminada', () => {
  test('no escribe candidatos, no persiste el lote y deja la continuación encolada', async () => {
    const journey = newJourney();
    // 2.000 ms por organización: 166 no caben en una invocación.
    const outcome = await invokeRunner(journey, 2_000);

    assert.equal(outcome.assessmentDeadlineReached, true, 'la corrida se pausa');
    assert.ok((outcome.pendingOrganizationCount ?? 0) > 0, 'queda trabajo pendiente');
    assert.equal(journey.world.writerCalls, 0, '🔴 una pausa NO puede escribir candidatos');

    const checkpoint = journey.store.storedCheckpoint();
    assert.ok(checkpoint);
    assert.equal(
      checkpoint?.candidates_persisted,
      false,
      '🔴 `candidates_persisted` en una pausa cortocircuitaría la continuación',
    );
    assert.ok((checkpoint?.pending_organizations.length ?? 0) > 0, 'las pendientes se conservan');
    assert.equal(journey.queue.length, 1, 'la continuación queda encolada');
    assert.equal(journey.queue[0]!.status, 'pending');
  });

  test('una pausa NO activa la cascada', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000);
    assert.deepEqual(journey.cascadeCalls, [], 'Lusha no se plantea con trabajo pendiente');
  });
});

// ── G2/G3/G4 · el recorrido completo ─────────────────────────────────────────

describe('§ G2, G3 y G4 — la continuación termina el recorrido', () => {
  test('166 organizaciones: pausa, continuación y finalización real', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000);
    assert.equal(journey.world.writerCalls, 0);

    // El conductor, con un reloj que ya no aprieta: la continuación cierra.
    let guard = 0;
    while (journey.queue.some((j) => j.status === 'pending') && guard < 20) {
      guard++;
      await runApolloRoundContinuationWorker(conductorDeps(journey, 1), {
        limit: 1,
        batchId: CORRELATION.batchId,
      });
    }

    assert.ok(guard < 20, 'el recorrido terminó solo');
    assert.equal(journey.world.writerCalls, 1, 'se escribe UNA vez, al final');
    assert.equal(journey.world.providerCalls, 1, 'una sola búsqueda en todo el recorrido');
    assert.equal(
      journey.store.storedCheckpoint()?.candidates_persisted,
      true,
      'la corrida queda finalizada por la CONTINUACIÓN',
    );
    assert.equal(
      journey.store.storedCheckpoint()?.pending_organizations.length,
      0,
      'no queda trabajo pendiente',
    );
  });

  test('el presupuesto se acumula: reanudar no vuelve a cobrar la búsqueda', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000);
    let guard = 0;
    while (journey.queue.some((j) => j.status === 'pending') && guard < 20) {
      guard++;
      await runApolloRoundContinuationWorker(conductorDeps(journey, 1), {
        limit: 1,
        batchId: CORRELATION.batchId,
      });
    }
    assert.equal(recordedCredits(journey.world), 2, 'los 2 créditos de la ÚNICA búsqueda');
  });
});

// ── G5/G6 · caída, recuperación y worker antiguo ─────────────────────────────

describe('§ G5 y G6 — trabajos interrumpidos y dueños caducados', () => {
  test('un trabajo en `processing` con lease vencido se vuelve a reclamar', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000);

    // Un worker lo reclamó y murió: queda `processing` con lease ya vencido.
    const job = journey.queue[0]!;
    job.status = 'processing';
    job.leaseToken = 'lease-huerfano';
    job.leaseExpiresAtMs = 0;

    const stats = await runApolloRoundContinuationWorker(conductorDeps(journey, 1), {
      limit: 1,
      batchId: CORRELATION.batchId,
    });

    assert.equal(stats.claimed, 1, '🔴 un `processing` abandonado TIENE que ser reclamable');
    assert.notEqual(job.leaseToken, 'lease-huerfano', 'el reclamo acuña un token nuevo');
  });

  test('el cierre de un worker ANTIGUO no pisa el estado del nuevo', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000);
    const deps = conductorDeps(journey, 1);
    const job = journey.queue[0]!;

    // El nuevo dueño reclama y se queda con un token fresco.
    await deps.claimJobs({ workerId: 'nuevo', limit: 1, lockDurationMinutes: 5, batchId: null });
    const tokenDelNuevo = job.leaseToken;

    // El antiguo intenta cerrar con SU token caducado.
    await deps.settleJob({
      jobId: job.id,
      leaseToken: 'lease-antiguo',
      status: 'failed',
      resolution: 'exhausted',
    });

    assert.equal(job.status, 'processing', 'el trabajo sigue siendo del nuevo dueño');
    assert.equal(job.leaseToken, tokenDelNuevo, 'el token del nuevo no se tocó');
  });

  test('dos llamadas simultáneas sólo dan trabajo a UNA', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000);
    const deps = conductorDeps(journey, 1);

    const a = await deps.claimJobs({ workerId: 'pestaña-1', limit: 1, lockDurationMinutes: 5, batchId: null });
    const b = await deps.claimJobs({ workerId: 'pestaña-2', limit: 1, lockDurationMinutes: 5, batchId: null });

    assert.equal(a.length, 1, 'la primera se lo lleva');
    assert.equal(b.length, 0, 'la segunda no encuentra nada reclamable');
  });
});

// ── G7 · cascada con la política congelada ───────────────────────────────────

describe('§ G7 — la cascada se reevalúa al terminar, con la política de la corrida', () => {
  test('al cerrar la continuación, la cascada se plantea una vez', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000);
    let guard = 0;
    while (journey.queue.some((j) => j.status === 'pending') && guard < 20) {
      guard++;
      await runApolloRoundContinuationWorker(conductorDeps(journey, 1), {
        limit: 1,
        batchId: CORRELATION.batchId,
      });
    }
    assert.equal(journey.cascadeCalls.length, 1, 'se plantea al terminar, y una sola vez');
  });

  test('una bandera encendida DESPUÉS no puede habilitar gasto antes excluido', () => {
    const excluida: ApolloContinuationRunPolicy = {
      ...RUN_POLICY,
      waterfallEnabledAtRunStart: false,
    };
    const efectiva = resolveContinuationCascadeInputs(excluida, {
      waterfallEnabled: true,
      lushaAvailable: true,
    });
    assert.equal(efectiva.waterfallEnabled, false, '🔴 la conjunción sólo puede restringir');

    // Y al revés: apagarla después SÍ apaga la pierna.
    const apagadaAhora = resolveContinuationCascadeInputs(RUN_POLICY, {
      waterfallEnabled: false,
      lushaAvailable: true,
    });
    assert.equal(apagadaAhora.waterfallEnabled, false);
  });
});

// ── G8 · aislamiento y fallo de encolado ─────────────────────────────────────

describe('§ G8 — aislamiento Apollo-only y encolado que falla', () => {
  test('si el encolado falla, la pausa sigue conservando el trabajo', async () => {
    const journey = newJourney({ enqueueFails: true });
    const outcome = await invokeRunner(journey, 2_000);

    assert.equal(outcome.assessmentDeadlineReached, true);
    assert.equal(outcome.continuationEnqueued, false, 'no se declara encolado lo que no se encoló');
    assert.equal(journey.queue.length, 0);
    assert.ok(
      (journey.store.storedCheckpoint()?.pending_organizations.length ?? 0) > 0,
      '🔴 el trabajo pendiente sobrevive aunque la cola no esté disponible',
    );
    assert.equal(journey.world.writerCalls, 0, 'tampoco finaliza');
  });

  test('todo el recorrido es Apollo: ni una llamada a otro proveedor', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000);
    let guard = 0;
    while (journey.queue.some((j) => j.status === 'pending') && guard < 20) {
      guard++;
      await runApolloRoundContinuationWorker(conductorDeps(journey, 1), {
        limit: 1,
        batchId: CORRELATION.batchId,
      });
    }
    // El único proveedor que se invocó es la búsqueda de Apollo, y una vez.
    assert.equal(journey.world.providerCalls, 1);
    assert.deepEqual(
      [...journey.world.usageLogs.keys()].filter((k) => !k.startsWith('organizations_search:')),
      [],
      'ninguna fila económica de otro proveedor',
    );
  });
});

// ── G9 · un timeout de duplicados NO es «no hay duplicados» ──────────────────

describe('§ G9 — la comprobación de duplicados degradada es fail-closed', () => {
  test('`status: error` degrada el veredicto; `unchecked` no', async () => {
    const { readDuplicateVerdict } = await import('../production-runner.server');

    const base = pipelineCandidate(supermarket(1));

    const conTimeout = readDuplicateVerdict({
      ...base,
      duplicateCheck: { ...base.duplicateCheck, status: 'error', matches: [] },
    } as ProspectingPipelineCandidate);
    assert.equal(
      conTimeout.duplicateCheckDegraded,
      true,
      '🔴 un tope que salta deja la lista vacía: leerla sola convierte «no pude mirar» en «no hay»',
    );
    assert.equal(conTimeout.hubSpotDuplicate, false, 'no se inventa un duplicado');

    // HubSpot no conectado es una configuración estable, no un fallo.
    const sinHubSpot = readDuplicateVerdict({
      ...base,
      duplicateCheck: { ...base.duplicateCheck, status: 'unchecked', matches: [] },
    } as ProspectingPipelineCandidate);
    assert.equal(sinHubSpot.duplicateCheckDegraded, false);

    const limpio = readDuplicateVerdict(base);
    assert.equal(limpio.duplicateCheckDegraded, false);
  });
});

// ── G10 · los estados que la UI enseña ───────────────────────────────────────

describe('§ G10 — estado visible: procesando, pendiente, terminado, falló', () => {
  test('cada combinación durable tiene UN estado, sin heurísticas', async () => {
    const { resolveApolloContinuationUiStatus } = await import(
      '@/modules/prospect-batches/apollo-continuation-status'
    );

    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 10, jobStatus: 'processing' }),
      'processing',
    );
    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 10, jobStatus: 'pending' }),
      'pending_continuation',
    );
    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 0, jobStatus: 'completed' }),
      'finished',
    );
    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 10, jobStatus: 'failed' }),
      'failed',
    );
    // Un trabajo huérfano no puede reabrir un lote que ya no tiene pendientes.
    assert.equal(
      resolveApolloContinuationUiStatus({ pendingOrganizationCount: 0, jobStatus: 'pending' }),
      'finished',
    );
  });

  test('el aviso de navegador cerrado NO promete un plazo de finalización', async () => {
    const { APOLLO_CONTINUATION_BROWSER_CLOSED_NOTE } = await import(
      '@/modules/prospect-batches/apollo-continuation-status'
    );
    assert.match(APOLLO_CONTINUATION_BROWSER_CLOSED_NOTE, /no se pierde nada/);
    assert.match(APOLLO_CONTINUATION_BROWSER_CLOSED_NOTE, /cuándo puede reintentarse/);
    // 🔴 La cadencia dice cuándo se puede volver a INTENTAR, no cuándo termina.
    assert.ok(!/segundos/.test(APOLLO_CONTINUATION_BROWSER_CLOSED_NOTE));
    assert.ok(!/24 horas/.test(APOLLO_CONTINUATION_BROWSER_CLOSED_NOTE));
  });
});

// ── G9 · la continuación publica la MISMA aceptación que el mago ─────────────
//
// AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1. El lote `c681bfcd` (2026-09-22) se
// pausó, terminó en la continuación y quedó SIN `accepted_for_target`: la primera
// pasada no escribe, y la continuación escribía con un `run_input` leído de JSON,
// que no transporta la función con la que el mago resolvía la aceptación.

/** Los hechos de una corrida con aporte gratuito: el caso que más puede fallar. */
const ACCEPTANCE_FACTS: RunAcceptanceFacts = {
  demand: resolveProviderResultDemand(
    { requestedTarget: 5, acceptedBeforeProvider: 2, residualGap: 3, providerRequired: true },
    5,
  ),
  freePersistedCandidates: 2,
};

const WRITER_OUTCOME = {
  completeValidCandidates: 1,
  persistedCandidates: 3,
  reviewOnlyCandidates: 2,
} as const;

/** El `run_input` que el mago construye: la función de aceptación Y sus hechos. */
function wizardRunInput(
  policy: ApolloContinuationRunPolicy = { ...RUN_POLICY, acceptanceFacts: ACCEPTANCE_FACTS },
): ApolloTwoRoundWizardRunInput {
  return {
    ...runInputFor(),
    continuationRunPolicy: policy,
    resolveExtraBatchMetadata: (outcome: Parameters<ResolveExtraBatchMetadata>[0]) =>
      buildWriterAcceptedForTargetMetadata(ACCEPTANCE_FACTS, outcome),
  } as unknown as ApolloTwoRoundWizardRunInput;
}

async function pauseThenFinishFromQueue(journey: Journey, input: ApolloTwoRoundWizardRunInput) {
  await invokeRunner(journey, 2_000, input);
  assert.equal(journey.world.writerCalls, 0, 'la pausa no escribe');
  let guard = 0;
  while (journey.queue.some((j) => j.status === 'pending') && guard < 20) {
    guard++;
    await runApolloRoundContinuationWorker(conductorDeps(journey, 1, { resumeFromQueue: true }), {
      limit: 1,
      batchId: CORRELATION.batchId,
    });
  }
  assert.ok(guard < 20, 'el recorrido terminó solo');
  assert.equal(journey.world.writerCalls, 1, 'se escribe UNA vez, al final');
}

describe('§ G9 — la continuación publica la aceptación, reanudando desde la cola durable', () => {
  test('🔴 el defecto: lo encolado pasa por JSON y la FUNCIÓN del mago no sobrevive', async () => {
    const journey = newJourney();
    const input = wizardRunInput();
    assert.equal(typeof (input as { resolveExtraBatchMetadata?: unknown }).resolveExtraBatchMetadata, 'function');

    await invokeRunner(journey, 2_000, input);
    const stored = journey.queue[0]!.storedMetadata as { run_input: Record<string, unknown> };
    assert.equal(
      'resolveExtraBatchMetadata' in stored.run_input,
      false,
      'JSON la descarta en silencio: esto es lo que un worker de producción lee',
    );
  });

  test('la continuación reconstruye el resolutor y el writer publica `accepted_for_target`', async () => {
    const journey = newJourney();
    await pauseThenFinishFromQueue(journey, wizardRunInput());

    const resolver = journey.world.writerResolvers[0];
    assert.equal(typeof resolver, 'function', '🔴 el writer de la continuación recibe el resolutor');
    const published = resolver!(WRITER_OUTCOME);
    assert.ok(published && ACCEPTED_FOR_TARGET_METADATA_KEY in published);
  });

  test('🔴 paridad: la continuación publica EXACTAMENTE lo que el mago habría publicado', async () => {
    const journey = newJourney();
    const input = wizardRunInput();
    await pauseThenFinishFromQueue(journey, input);

    const fromContinuation = journey.world.writerResolvers[0]!(WRITER_OUTCOME);
    const fromWizard = (input as unknown as { resolveExtraBatchMetadata: ResolveExtraBatchMetadata })
      .resolveExtraBatchMetadata(WRITER_OUTCOME);
    assert.deepEqual(fromContinuation, fromWizard);
  });

  test('un trabajo encolado ANTES de este corte —sin hechos— termina igual y NO inventa aceptación', async () => {
    const journey = newJourney();
    await pauseThenFinishFromQueue(journey, wizardRunInput(RUN_POLICY));
    assert.equal(
      journey.world.writerResolvers[0],
      null,
      'sin los hechos de la corrida no hay aceptación que publicar: la clave queda ausente, como hoy',
    );
  });

  test('hechos corruptos en la cola ⇒ la corrida termina igual y NO inventa aceptación', async () => {
    const journey = newJourney();
    await invokeRunner(journey, 2_000, wizardRunInput());
    const stored = journey.queue[0]!.storedMetadata as {
      run_policy: { acceptanceFacts: { demand: { requestedTarget: unknown } } };
    };
    stored.run_policy.acceptanceFacts.demand.requestedTarget = -1;

    let guard = 0;
    while (journey.queue.some((j) => j.status === 'pending') && guard < 20) {
      guard++;
      await runApolloRoundContinuationWorker(conductorDeps(journey, 1, { resumeFromQueue: true }), {
        limit: 1,
        batchId: CORRELATION.batchId,
      });
    }
    assert.equal(journey.world.writerCalls, 1, 'la corrida se completa');
    assert.equal(journey.world.writerResolvers[0], null);
  });

  test('sin `run_input` en la cola no hay nada que reanudar', () => {
    assert.equal(restoreContinuationRunInput(null), null);
    assert.equal(restoreContinuationRunInput({ run_policy: RUN_POLICY }), null);
  });
});
