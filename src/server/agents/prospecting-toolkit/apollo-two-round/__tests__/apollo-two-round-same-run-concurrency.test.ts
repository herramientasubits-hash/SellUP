/**
 * apollo-two-round-same-run-concurrency.test.ts — Dos procesos del MISMO run
 * escribiendo el mismo checkpoint.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-CAS-CLOSE · § 1, § 2, § 3, § 4.
 *
 * El defecto que cierra: `writeTwoRoundCheckpoint` resuelve la concurrencia con
 * un compare-and-swap. Cuando dos procesos del mismo run escriben a la vez, uno
 * gana y el otro recibe `stale_rejected`. El adaptador interpretaba ese rechazo
 * como "el estado ya está durable" y devolvía `true` — sin comprobarlo.
 *
 * Aquí se ejercita el camino completo con un almacén compartido y CAS REAL
 * (`writeTwoRoundCheckpoint` / `readTwoRoundCheckpoint` sin mockear), un ledger
 * de proveedor compartido que hace que la llamada externa ocurra UNA vez, y un
 * registro de `provider_usage_logs` que deduplica por `usage_key` igual que el
 * índice único de la tabla.
 *
 * Todo offline por construcción: ninguna dependencia inyectada abre un socket.
 *   LIVE_APOLLO_CALLS = 0
 *   APOLLO_CREDITS_USED = 0
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
import type { ProspectingPipelineCandidate, WebSearchOutput, WebSearchResult } from '../../types';

const CORRELATION = {
  wizardRunId: 'run-concurrency-1',
  clientRequestId: 'client-concurrency-1',
  batchId: 'batch-concurrency-1',
  reservationId: 'reservation-concurrency-1',
  requestFingerprint: 'fingerprint-concurrency-1',
  idempotencyKey: 'idempotency-concurrency-1',
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
};

function externalWorld(): ExternalWorld {
  return { providerCalls: 0, usageLogs: new Map(), writerCalls: 0, ledger: new Map() };
}

function recordedCredits(world: ExternalWorld): number {
  return [...world.usageLogs.values()].reduce((total, row) => total + row.credits, 0);
}

function supermarket(index: number): WebSearchResult {
  return {
    title: `Supermercado Uno ${index}`,
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
      apollo_profile: { industry: 'retail', industries: [] },
    },
  };
}

const ROUND_1_RESULTS = [1, 2, 3, 4, 5].map(supermarket);
const SEARCH_CREDITS = 1;

function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const domain = (result.metadata?.['domain'] as string) ?? null;
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
  };
}

/**
 * Dependencias de UN proceso del run.
 *
 * `staleFirstLoad` reproduce el interleaving exacto del contrato: el proceso lee
 * el checkpoint ANTES de que el otro escriba (versión N), y sólo las relecturas
 * posteriores —las que hace la resolución del `stale_rejected`— ven el documento
 * ganador.
 */
function processDeps(options: {
  world: ExternalWorld;
  store: ReturnType<typeof sharedBatchStore>;
  staleFirstLoad?: boolean;
}): Partial<ApolloTwoRoundProductionDeps> {
  let firstLoadServed = false;

  return {
    searchApollo: (async (
      _input: unknown,
      _maxResults: number,
      usageContext: { operationContext?: { operation_id?: string } | null },
    ) => {
      const operationId = usageContext?.operationContext?.operation_id ?? 'no_operation';
      const cached = options.world.ledger.get(operationId);
      // Operación ya ejecutada: se sirve del ledger. Ni llamada, ni fila, ni crédito.
      if (cached !== undefined) return cached;

      options.world.providerCalls++;
      options.world.usageLogs.set(`organizations_search:${operationId}`, {
        credits: SEARCH_CREDITS,
      });
      const output: WebSearchOutput = {
        provider: 'apollo_organizations',
        query: 'supermercados',
        results: ROUND_1_RESULTS,
        resultsCount: ROUND_1_RESULTS.length,
        skipped: false,
        skipReason: null,
        estimatedCostUsd: 0,
        metadata: { usage: { credits_used: SEARCH_CREDITS } },
      };
      options.world.ledger.set(operationId, output);
      return output;
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    // Ningún candidato lo necesita: los cinco llegan con el sector confirmado.
    enrichCascade: (async () => {
      throw new Error('el enrichment no debe ejecutarse en este escenario');
    }) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
    }) => {
      options.world.writerCalls++;
      return {
        dryRun: false,
        batchId: CORRELATION.batchId,
        candidatesCreated: writerInput.pipelineOutput.candidates.length,
        candidatesSkipped: 0,
        createdCandidateIds: writerInput.pipelineOutput.candidates.map(
          (_c, index) => `candidate-${index + 1}`,
        ),
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

    loadCheckpoint: async (batchId, identity) => {
      if (options.staleFirstLoad === true && !firstLoadServed) {
        firstLoadServed = true;
        // La lectura de arranque: este proceso empezó antes de que el otro escribiera.
        return null;
      }
      return readTwoRoundCheckpoint(batchId, identity, options.store.client);
    },

    // CAS real contra el almacén compartido.
    saveCheckpoint: (batchId, checkpoint) =>
      writeTwoRoundCheckpoint(batchId, checkpoint, options.store.client, {
        now: () => '2026-08-03T00:00:00.000Z',
      }),

    loadEnrichmentUnitCostUsd: async () => 0.02,
    enrichOrganization: (async () => ({ success: true, data: undefined })) as never,
    logEnrichmentUsage: (async (logInput: { usageKey: string; accounting: { creditsUsed?: number } }) => {
      if (options.world.usageLogs.has(logInput.usageKey)) return { kind: 'already_logged' as const };
      options.world.usageLogs.set(logInput.usageKey, {
        credits: logInput.accounting.creditsUsed ?? 0,
      });
      return { kind: 'logged' as const };
    }) as never,
    resolveConfig: () => defaultApolloTwoRoundConfig(),
  };
}

function runInput(): ApolloTwoRoundWizardRunInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Supermercados e Hipermercados',
    subindustries: [],
    additionalCriteria: null,
    reservedBatchId: CORRELATION.batchId,
    triggeredByUserId: 'user-1',
    ownerId: 'user-1',
    correlation: CORRELATION,
    runCorrelationMetadata: null,
    extraBatchMetadata: null,
    reservedCredits: 12,
  };
}

// ─── § 1 · el escenario del contrato ──────────────────────────────────────────

describe('CAS-CLOSE § 1 · dos procesos del mismo run, una sola operación externa', () => {
  test('B relee el checkpoint ganador, reconoce la operación y no vuelve a gastar', async () => {
    const world = externalWorld();
    const store = sharedBatchStore();

    // 1-3. Proceso A lee el checkpoint (no hay), ejecuta la operación y persiste.
    const resultA = await runApolloTwoRoundWizardDiscovery(
      runInput(),
      processDeps({ world, store }),
    );

    assert.equal(world.providerCalls, 1, 'A emitió la única llamada al proveedor');
    const afterA = store.storedCheckpoint();
    assert.ok(afterA !== null, 'A dejó un checkpoint durable');
    const versionAfterA = afterA.checkpoint_version;
    assert.ok(versionAfterA >= 1);

    // 4-6. Proceso B leyó ANTES de que A escribiera: su primera escritura choca
    // contra el CAS, relee el ganador y reconoce en él su propia operación.
    const resultB = await runApolloTwoRoundWizardDiscovery(
      runInput(),
      processDeps({ world, store, staleFirstLoad: true }),
    );

    assert.equal(world.providerCalls, 1, 'B no emitió una segunda llamada');
    assert.equal(world.usageLogs.size, 1, 'una sola fila económica');
    assert.equal(recordedCredits(world), 1, 'un solo crédito registrado');

    // La prueba de que se recorrió el camino del contrato y no otro: B reconoció
    // SU operación dentro del checkpoint ganador. Sin esta aserción el test
    // pasaría igual si la resolución hubiera caído en la fusión.
    assert.ok(
      resultB.warnings?.some((warning) =>
        warning.startsWith('concurrent_checkpoint_already_contains_operation:'),
      ),
      'B probó la durabilidad releyendo el ganador',
    );
    assert.ok(
      !resultB.warnings?.some((warning) =>
        warning.startsWith('two_round_checkpoint_persist_failed'),
      ),
      'y no degradó ninguna operación',
    );

    const afterB = store.storedCheckpoint();
    assert.ok(afterB !== null);
    assert.equal(
      afterB.completed_operation_keys.length,
      1,
      'una operación durable, no dos',
    );
    assert.equal(afterB.indeterminate_operation_keys.length, 0);
    assert.equal(afterB.manual_reconciliation_required, false);
    assert.equal(
      afterB.recorded_operation_credits.length,
      1,
      'el gasto está atribuido a UNA operación',
    );
    assert.equal(afterB.recorded_operation_credits[0]?.credits, 1);
    assert.equal(afterB.spend_accounting.recorded_usage_credits, 1, 'sin doble conteo');
    assert.ok(
      afterB.checkpoint_version >= versionAfterA,
      'el documento sólo avanza de versión',
    );
    assert.equal(afterB.candidates_persisted, true);
    assert.equal(world.writerCalls, 1, 'los candidatos se escribieron una sola vez');

    // B no puede reportar la corrida como vacía ni como fallida.
    assert.equal(resultA.batchId, CORRELATION.batchId);
    assert.equal(resultB.batchId, CORRELATION.batchId);
    assert.deepEqual(resultB.budgetAnomalies, undefined, 'ninguna anomalía de gasto');

    // 8. Un tercer reintento rehidrata el estado final sin tocar nada.
    const providerCallsBeforeThird = world.providerCalls;
    const usageLogsBeforeThird = world.usageLogs.size;
    const creditsBeforeThird = recordedCredits(world);

    const resultC = await runApolloTwoRoundWizardDiscovery(
      runInput(),
      processDeps({ world, store }),
    );

    assert.equal(
      world.providerCalls - providerCallsBeforeThird,
      0,
      'tercer reintento: cero llamadas al proveedor',
    );
    assert.equal(
      world.usageLogs.size - usageLogsBeforeThird,
      0,
      'tercer reintento: cero filas económicas',
    );
    assert.equal(
      recordedCredits(world) - creditsBeforeThird,
      0,
      'tercer reintento: cero créditos',
    );
    assert.equal(world.writerCalls, 1, 'tercer reintento: cero escrituras de candidatos');
    assert.equal(resultC.batchId, CORRELATION.batchId);

    const afterC = store.storedCheckpoint();
    assert.equal(afterC?.completed_operation_keys.length, 1);
    assert.equal(afterC?.spend_accounting.recorded_usage_credits, 1);
  });

  test('un `stale_rejected` cuyo ganador NO contiene la operación no se da por durable', async () => {
    // El ganador es un checkpoint de la misma corrida que NO registró la búsqueda:
    // ni la operación, ni su ronda, ni su gasto. Reconocerlo como durable sería
    // exactamente el defecto que este hito cierra.
    const world = externalWorld();
    const store = sharedBatchStore();

    // Un documento durable ajeno a la operación, ya en versión 5.
    const intruder: ApolloTwoRoundCheckpointV1 = {
      version: 1,
      checkpoint_version: 5,
      checkpoint_updated_at: null,
      checkpoint_reason: 'round_assessment_completed',
      idempotency_key: CORRELATION.idempotencyKey,
      request_fingerprint: CORRELATION.requestFingerprint,
      wizard_run_id: CORRELATION.wizardRunId,
      config: defaultApolloTwoRoundConfig(),
      completed_operation_keys: [],
      indeterminate_operation_keys: [],
      seen_organization_keys: [],
      round_summaries: [],
      candidate_snapshots: [],
      pending_organizations: [],
      enrichment_snapshots: [],
      recorded_operation_credits: [],
      persisted_candidate_ids: [],
      candidates_persisted: false,
      observed_rejection_reasons: [],
      second_round_skipped_reason: null,
      totals: { raw_results: 0, search_credits: 0, enrichment_credits: 0, enrichments_executed: 0 },
      spend_accounting: {
        estimated_credits: 12,
        reserved_credits: 12,
        recorded_usage_credits: 0,
        confirmed_provider_credits: null,
      },
      checkpoint_write_failures: [],
      manual_reconciliation_required: false,
      compacted: false,
    };
    await writeTwoRoundCheckpoint(CORRELATION.batchId, intruder, store.client, {
      now: () => '2026-08-03T00:00:00.000Z',
    });

    const result = await runApolloTwoRoundWizardDiscovery(
      runInput(),
      processDeps({ world, store, staleFirstLoad: true }),
    );

    assert.equal(world.providerCalls, 1, 'la búsqueda se ejecutó una vez');
    assert.equal(recordedCredits(world), 1, 'y se cobró una vez');

    // El ganador no contenía la operación ⇒ opción A: se fusionó sobre él y se
    // reintentó el CAS. El resultado conserva las dos aportaciones.
    const stored = store.storedCheckpoint();
    assert.ok(stored !== null);
    assert.equal(stored.completed_operation_keys.length, 1, 'la operación quedó durable');
    assert.equal(stored.recorded_operation_credits.length, 1);
    assert.equal(stored.spend_accounting.recorded_usage_credits, 1);
    assert.ok(stored.checkpoint_version > 5, 'la fusión avanzó sobre el ganador');
    assert.deepEqual(result.budgetAnomalies, undefined);
  });
});

// ─── § 4 · ambigüedad ⇒ indeterminada, nunca una segunda llamada ──────────────

describe('CAS-CLOSE § 4 · lo que no se puede probar se degrada, no se reintenta', () => {
  test('un ganador ilegible deja la operación INDETERMINADA y detiene lo dependiente', async () => {
    const world = externalWorld();
    const store = sharedBatchStore();
    const base = processDeps({ world, store });

    let loadsServed = 0;
    const result = await runApolloTwoRoundWizardDiscovery(runInput(), {
      ...base,
      loadCheckpoint: async () => {
        loadsServed++;
        // La lectura de arranque va bien; la RELECTURA que prueba la contención no.
        if (loadsServed === 1) return null;
        throw new Error('checkpoint unreadable');
      },
      // El CAS siempre lo gana otro proceso.
      saveCheckpoint: async () => ({ kind: 'stale_rejected', storedCheckpointVersion: 9 }),
    });

    assert.equal(world.providerCalls, 1, 'la búsqueda NO se repite tras la ambigüedad');
    assert.equal(recordedCredits(world), 1, 'y no se gasta un segundo crédito');
    assert.ok(
      result.budgetAnomalies?.includes('apollo_operation_indeterminate'),
      'la corrida no puede declararse conciliada',
    );
    assert.ok(
      result.warnings?.some((warning) =>
        warning.includes('two_round_checkpoint_persist_failed') &&
        warning.includes('durable_checkpoint_unreadable'),
      ),
      'y deja rastro de POR QUÉ no se pudo probar',
    );
    assert.ok(
      !result.warnings?.some((warning) =>
        warning.startsWith('concurrent_checkpoint_already_contains_operation'),
      ),
      'nada se dio por durable sin probarlo',
    );
  });

  test('un ganador que la fusión rechaza también degrada, sin volver a llamar a Apollo', async () => {
    const world = externalWorld();
    const store = sharedBatchStore();
    const base = processDeps({ world, store });

    // Misma identidad pero OTRA configuración: no hay fusión inequívoca posible.
    const ambiguous: ApolloTwoRoundCheckpointV1 = {
      version: 1,
      checkpoint_version: 9,
      checkpoint_updated_at: null,
      checkpoint_reason: 'search_round_completed',
      idempotency_key: CORRELATION.idempotencyKey,
      request_fingerprint: CORRELATION.requestFingerprint,
      wizard_run_id: CORRELATION.wizardRunId,
      config: { ...defaultApolloTwoRoundConfig(), maxRounds: 1 },
      completed_operation_keys: [],
      indeterminate_operation_keys: [],
      seen_organization_keys: [],
      round_summaries: [],
      candidate_snapshots: [],
      pending_organizations: [],
      enrichment_snapshots: [],
      recorded_operation_credits: [],
      persisted_candidate_ids: [],
      candidates_persisted: false,
      observed_rejection_reasons: [],
      second_round_skipped_reason: null,
      totals: { raw_results: 0, search_credits: 0, enrichment_credits: 0, enrichments_executed: 0 },
      spend_accounting: {
        estimated_credits: 12,
        reserved_credits: 12,
        recorded_usage_credits: 0,
        confirmed_provider_credits: null,
      },
      checkpoint_write_failures: [],
      manual_reconciliation_required: false,
      compacted: false,
    };

    let loadsServed = 0;
    const result = await runApolloTwoRoundWizardDiscovery(runInput(), {
      ...base,
      loadCheckpoint: async () => {
        loadsServed++;
        return loadsServed === 1 ? null : ambiguous;
      },
      saveCheckpoint: async () => ({ kind: 'stale_rejected', storedCheckpointVersion: 9 }),
    });

    assert.equal(world.providerCalls, 1);
    assert.equal(recordedCredits(world), 1);
    assert.ok(result.budgetAnomalies?.includes('apollo_operation_indeterminate'));
    assert.ok(
      result.warnings?.some((warning) => warning.includes('merge_refused_config_mismatch')),
      'el motivo del rechazo es legible sin interpretar un mensaje libre',
    );
  });
});

// ─── § 2 · dos operaciones distintas persistidas a la vez ─────────────────────

describe('CAS-CLOSE § 2 · dos operaciones concurrentes distintas se conservan ambas', () => {
  test('A persiste la búsqueda de la ronda 1 y B un enrichment: el final lleva las dos', async () => {
    const store = sharedBatchStore();

    const base: ApolloTwoRoundCheckpointV1 = {
      version: 1,
      checkpoint_version: 1,
      checkpoint_updated_at: null,
      checkpoint_reason: 'search_round_completed',
      idempotency_key: CORRELATION.idempotencyKey,
      request_fingerprint: CORRELATION.requestFingerprint,
      wizard_run_id: CORRELATION.wizardRunId,
      config: defaultApolloTwoRoundConfig(),
      completed_operation_keys: ['op-search-round-1'],
      indeterminate_operation_keys: [],
      seen_organization_keys: ['dom:supermercado1.com.co'],
      round_summaries: [],
      candidate_snapshots: [],
      pending_organizations: [],
      enrichment_snapshots: [],
      recorded_operation_credits: [
        {
          operation_id: 'op-search-round-1',
          operation_key: 'organizations_search',
          round_number: 1,
          usage_key: 'organizations_search:op-search-round-1',
          credits: 1,
          billing_unknown: false,
        },
      ],
      persisted_candidate_ids: [],
      candidates_persisted: false,
      observed_rejection_reasons: [],
      second_round_skipped_reason: null,
      totals: { raw_results: 5, search_credits: 1, enrichment_credits: 0, enrichments_executed: 0 },
      spend_accounting: {
        estimated_credits: 12,
        reserved_credits: 12,
        recorded_usage_credits: 1,
        confirmed_provider_credits: null,
      },
      checkpoint_write_failures: [],
      manual_reconciliation_required: false,
      compacted: false,
    };

    // A escribe la búsqueda.
    const writtenA = await writeTwoRoundCheckpoint(CORRELATION.batchId, base, store.client, {
      now: () => '2026-08-03T00:00:00.000Z',
    });
    assert.equal(writtenA.kind, 'written');

    // B, que arrancó de la MISMA versión, cierra un enrichment distinto. Su
    // documento no conoce la búsqueda de A.
    const fromB: ApolloTwoRoundCheckpointV1 = {
      ...base,
      checkpoint_version: 1,
      checkpoint_reason: 'enrichment_completed',
      completed_operation_keys: ['op-enrichment-a'],
      seen_organization_keys: ['dom:supermercado2.com.co'],
      recorded_operation_credits: [
        {
          operation_id: 'op-enrichment-a',
          operation_key: 'organization_enrichment',
          round_number: 1,
          usage_key: 'organization_enrichment:batch:op-enrichment-a',
          credits: 1,
          billing_unknown: false,
        },
      ],
      enrichment_snapshots: [
        {
          candidate_key: 'cand-a',
          round_number: 1,
          operation_id: 'op-enrichment-a',
          operation_subject: 'domain:supermercado2.com.co',
          status: 'executed',
          recorded_credits: 1,
          sector_evidence_state: 'sector_evidence_confirmed',
        },
      ],
      totals: { raw_results: 0, search_credits: 0, enrichment_credits: 1, enrichments_executed: 1 },
      spend_accounting: { ...base.spend_accounting, recorded_usage_credits: 1 },
    };

    const staleB = await writeTwoRoundCheckpoint(CORRELATION.batchId, fromB, store.client, {
      now: () => '2026-08-03T00:00:01.000Z',
    });
    assert.equal(staleB.kind, 'stale_rejected', 'B pierde el CAS');

    // La fusión que la resolución aplica: unión de las dos operaciones y de su
    // gasto, sin sumar dos veces ninguna.
    const { mergeApolloTwoRoundCheckpoints } = await import('../checkpoint-merge');
    const durable = store.storedCheckpoint();
    assert.ok(durable !== null);
    const merged = mergeApolloTwoRoundCheckpoints(durable, fromB);
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;

    assert.deepEqual(
      merged.checkpoint.completed_operation_keys,
      ['op-enrichment-a', 'op-search-round-1'],
      'ninguna operación desaparece',
    );
    assert.deepEqual(merged.checkpoint.seen_organization_keys, [
      'dom:supermercado1.com.co',
      'dom:supermercado2.com.co',
    ]);
    assert.equal(merged.checkpoint.recorded_operation_credits.length, 2);
    assert.equal(
      merged.checkpoint.spend_accounting.recorded_usage_credits,
      2,
      'un crédito por operación, ninguno duplicado',
    );
    assert.equal(merged.checkpoint.enrichment_snapshots.length, 1);

    // Y una segunda fusión del mismo par no vuelve a sumar: la operación es
    // idempotente, que es lo que permite reintentar el CAS sin inflar el gasto.
    const again = mergeApolloTwoRoundCheckpoints(merged.checkpoint, fromB);
    assert.equal(again.kind, 'merged');
    if (again.kind !== 'merged') return;
    assert.equal(again.checkpoint.spend_accounting.recorded_usage_credits, 2);
    assert.equal(again.checkpoint.recorded_operation_credits.length, 2);
  });
});
