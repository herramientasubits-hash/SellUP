/**
 * apollo-two-round-accounting.test.ts — Contabilidad, checkpoints e idempotencia
 * de la modalidad Apollo de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX · § 1–§ 9, § 13.
 *
 * Los veinte casos obligatorios del cierre, atravesando las funciones REALES:
 *
 *    1. un enrichment con éxito crea UNA fila económica
 *    2. dos enrichments crean dos filas, no cuatro
 *    3. un no-match conserva correlación y estado de cobro
 *    4. un timeout de enrichment queda indeterminado
 *    5. un reintento tras la ronda 1 no vuelve a buscar
 *    6. un reintento tras un enrichment no vuelve a enriquecer
 *    7. un reintento tras persistir no vuelve a escribir
 *    8. una caída ANTES del checkpoint no puede marcar `completed`
 *    9. ronda 1 y ronda 2 quedan diferenciadas en los logs
 *   10. el sujeto de cada enrichment queda diferenciado
 *   11. metadata y columnas coinciden
 *   12. la reconciliación suma búsqueda + enrichment
 *   13. un cobro desconocido impide una conciliación final falsa
 *   14. el checkpoint conserva metadata ajena
 *   15. una escritura stale no sobrescribe un checkpoint reciente
 *   16. el snapshot no lleva payloads completos ni secretos
 *   17. el snapshot respeta un límite de tamaño
 *   18. no se duplican las comprobaciones de sitio ni de duplicados
 *   19. dos corridas concurrentes quedan completamente aisladas
 *   20. la suite entra en CI (verificado por el propio script del workflow)
 *
 * TODO offline. LIVE_APOLLO_CALLS = 0 y APOLLO_CREDITS_USED = 0 por
 * construcción: el proveedor, el writer, el logger de uso y el almacén del
 * checkpoint entran por inyección, y ninguna de esas dependencias abre un socket
 * ni toca Supabase.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  readSearchIndeterminacy,
  toResumeStateFromCheckpoint,
  TWO_ROUND_INDETERMINATE_ANOMALY,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
} from '../orchestrator';
import {
  APOLLO_TWO_ROUND_CHECKPOINT_KEY,
  APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
  compactCheckpointForSize,
  measureCheckpointSerializedBytes,
  readCheckpoint,
  toCandidateEvidenceSnapshot,
  type ApolloTwoRoundCheckpointV1,
} from '../checkpoint';
import { writeTwoRoundCheckpoint, type CheckpointStoreClient } from '../checkpoint.server';
import {
  buildApolloTwoRoundOperationContext,
  buildApolloTwoRoundEnrichmentSubject,
} from '../idempotency';
import { defaultApolloTwoRoundConfig } from '../index';
import {
  buildApolloEnrichmentUsageLogInput,
  classifyApolloEnrichmentBillingOutcome,
  classifyApolloEnrichmentOutcomeFromCascadeEntry,
  resolveApolloEnrichmentUsageAccounting,
} from '../../apollo-organization-enrichment-usage-log';
import {
  buildCorrelationColumns,
  buildProviderUsageLogRow,
} from '../../apollo-organizations-usage-logging';
import { APOLLO_TWO_ROUND_BILLING_CONTRACT } from '../../apollo-usage-operation-context';
import { reconcileWizardRunSpend } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-reconciliation';
import { RUN_CORRELATION_METADATA_KEY } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type {
  ProspectingPipelineCandidate,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CORRELATION = {
  wizardRunId: 'run-1',
  clientRequestId: 'client-1',
  batchId: 'batch-1',
  reservationId: 'reservation-1',
  requestFingerprint: 'fingerprint-1',
  idempotencyKey: 'idempotency-1',
};

const RUN_CORRELATION_METADATA = {
  wizard_run_id: CORRELATION.wizardRunId,
  client_request_id: CORRELATION.clientRequestId,
  batch_id: CORRELATION.batchId,
  reservation_id: CORRELATION.reservationId,
  agent_run_id: null,
  provider_key: 'apollo_organizations',
  request_fingerprint: CORRELATION.requestFingerprint,
  idempotency_key: CORRELATION.idempotencyKey,
  billing_state: null,
};

/**
 * Una organización con evidencia sectorial AUSENTE: es la única clase de
 * candidato que puede competir por un enrichment, así que es la que hay que usar
 * para ejercitar la contabilidad del enrichment.
 */
function ambiguousOrganization(index: number): WebSearchResult {
  return {
    title: `Empresa Ambigua ${index}`,
    url: `https://ambigua${index}.com.co`,
    snippet: null,
    source: 'apollo_organizations',
    rank: index,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `org-ambigua-${index}`,
      domain: `ambigua${index}.com.co`,
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 400,
      estimated_num_employees: 400,
      apollo_profile: {},
    },
  };
}

/** Una organización que las señales gratuitas ya confirman como del sector. */
function confirmedSupermarket(index: number): WebSearchResult {
  return {
    title: `Supermercado Confirmado ${index}`,
    url: `https://super${index}.com.co`,
    snippet: 'cadena de supermercados y autoservicio con tiendas de abarrotes',
    source: 'apollo_organizations',
    rank: index,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `org-super-${index}`,
      domain: `super${index}.com.co`,
      industry: 'retail',
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 900,
      estimated_num_employees: 900,
      apollo_profile: { industry: 'retail', industries: [] },
    },
  };
}

function searchOutput(
  results: WebSearchResult[],
  credits: number,
  extraMetadata: Record<string, unknown> = {},
): WebSearchOutput {
  return {
    provider: 'apollo_organizations',
    query: 'supermercados',
    results,
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: { usage: { credits_used: credits }, ...extraMetadata },
  };
}

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

type Recorder = {
  searchCalls: number;
  /** Ronda de cada búsqueda emitida. Distingue "no repitió" de "no buscó". */
  searchRounds: number[];
  buildCandidateCalls: number;
  enrichTransportCalls: number;
  usageLogs: LogProviderUsageInput[];
  checkpoints: ApolloTwoRoundCheckpointV1[];
  writes: number;
  writtenCandidateNames: string[];
};

type HarnessOptions = {
  rounds: WebSearchOutput[];
  /** Desenlace del transporte del enrichment, por dominio. */
  enrichment?: (domain: string) => {
    outcome: 'match' | 'no_match' | 'timeout' | 'http_error';
    /** Señales sectoriales que el enrichment aporta cuando hay match. */
    confirms?: boolean;
    statusCode?: number;
  };
  loadCheckpoint?: ApolloTwoRoundProductionDeps['loadCheckpoint'];
  /** Falla la escritura del checkpoint cuyo motivo coincida. */
  failCheckpointReason?: string;
  unitCostUsd?: number | null;
};

function buildHarness(options: HarnessOptions): {
  deps: Partial<ApolloTwoRoundProductionDeps>;
  recorder: Recorder;
} {
  const recorder: Recorder = {
    searchCalls: 0,
    searchRounds: [],
    buildCandidateCalls: 0,
    enrichTransportCalls: 0,
    usageLogs: [],
    checkpoints: [],
    writes: 0,
    writtenCandidateNames: [],
  };

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo: (async (
      _input: unknown,
      _maxResults: number,
      usageContext?: { operationContext?: { round_number?: number } | null },
    ) => {
      const round = usageContext?.operationContext?.round_number ?? recorder.searchCalls + 1;
      recorder.searchRounds.push(round);
      const output = options.rounds[round - 1] ?? searchOutput([], 0);
      recorder.searchCalls++;
      return output;
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => {
      recorder.buildCandidateCalls++;
      return { candidate: pipelineCandidate(result), nameQualityFiltered: false };
    }) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    // El cascade REAL, con el transporte inyectado: así se ejercita la
    // clasificación del cobro a partir del desenlace observado del transporte, no
    // a partir de un mensaje de error.
    enrichOrganization: (async (params: { domain: string }) => {
      recorder.enrichTransportCalls++;
      const behaviour = options.enrichment?.(params.domain) ?? { outcome: 'match' as const };
      if (behaviour.outcome === 'timeout') {
        const error = new Error('socket hang up');
        error.name = 'AbortError';
        throw error;
      }
      if (behaviour.outcome === 'http_error') {
        return {
          success: false,
          error: {
            error: `HTTP_${behaviour.statusCode ?? 401}`,
            message: 'denied',
            statusCode: behaviour.statusCode ?? 401,
          },
        };
      }
      if (behaviour.outcome === 'no_match') return { success: true, data: undefined };
      return {
        success: true,
        data: {
          id: `enriched-${params.domain}`,
          name: params.domain,
          website_url: `https://${params.domain}`,
          primary_domain: params.domain,
          linkedin_url: null,
          industry: behaviour.confirms === false ? 'banking' : 'retail',
          industry_tag_ids: [],
          employee_count: 400,
          estimated_num_employees: 400,
          city: 'Bogotá',
          country: 'Colombia',
          phone: null,
          annual_revenue: null,
          technologies: [],
          short_description:
            behaviour.confirms === false
              ? 'retail banking services'
              : 'cadena de supermercados y autoservicio con tiendas de abarrotes',
          seo_description: null,
          keywords: behaviour.confirms === false ? ['banking'] : ['supermercado', 'abarrotes'],
        },
      };
    }) as unknown as ApolloTwoRoundProductionDeps['enrichOrganization'],

    logEnrichmentUsage: (async (usageInput: Parameters<
      ApolloTwoRoundProductionDeps['logEnrichmentUsage']
    >[0]) => {
      recorder.usageLogs.push(buildApolloEnrichmentUsageLogInput(usageInput));
      return { kind: 'logged' as const };
    }) as unknown as ApolloTwoRoundProductionDeps['logEnrichmentUsage'],

    loadEnrichmentUnitCostUsd: async () =>
      options.unitCostUsd === undefined ? 0.02 : options.unitCostUsd,

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
    }) => {
      recorder.writes++;
      recorder.writtenCandidateNames = writerInput.pipelineOutput.candidates.map((c) => c.name);
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

    loadCheckpoint: options.loadCheckpoint ?? (async () => null),
    saveCheckpoint: async (_batchId, checkpoint) => {
      if (
        options.failCheckpointReason !== undefined &&
        checkpoint.checkpoint_reason === options.failCheckpointReason
      ) {
        return { kind: 'failed', reason: 'injected_failure' };
      }
      recorder.checkpoints.push(checkpoint);
      return {
        kind: 'written',
        checkpointVersion: checkpoint.checkpoint_version,
        serializedBytes: measureCheckpointSerializedBytes(checkpoint),
        compacted: checkpoint.compacted,
      };
    },
    resolveConfig: () => defaultApolloTwoRoundConfig(),
  };

  return { deps, recorder };
}

function runInput(
  overrides: Partial<ApolloTwoRoundWizardRunInput> = {},
): ApolloTwoRoundWizardRunInput {
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
    runCorrelationMetadata: RUN_CORRELATION_METADATA,
    extraBatchMetadata: null,
    reservedCredits: 12,
    ...overrides,
  };
}

// ─── 1-3 · una fila económica por enrichment (§ 1) ────────────────────────────

describe('§ 1 · el enrichment de la modalidad SÍ deja fila en provider_usage_logs', () => {
  test('caso 1 — un enrichment con éxito crea exactamente UNA fila', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [searchOutput([ambiguousOrganization(1)], 1), searchOutput([], 0)],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.enrichTransportCalls, 1, 'una sola llamada real al proveedor');
    assert.equal(recorder.usageLogs.length, 1, 'una sola fila económica');
    const row = recorder.usageLogs[0];
    assert.equal(row.provider_key, 'apollo');
    assert.equal(row.operation_key, 'organization_enrichment');
    assert.equal(row.batch_id, CORRELATION.batchId);
    assert.equal(row.credits_used, 1);
    assert.equal(row.status, 'success');
  });

  test('caso 2 — dos enrichments crean DOS filas, no cuatro', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [
        searchOutput([ambiguousOrganization(1), ambiguousOrganization(2)], 2),
        searchOutput([], 0),
      ],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.enrichTransportCalls, 2);
    assert.equal(recorder.usageLogs.length, 2, 'dos operaciones ⇒ dos filas');
    const keys = new Set(recorder.usageLogs.map((row) => row.usage_key));
    assert.equal(keys.size, 2, 'cada fila con su propia usage_key');
    const credits = recorder.usageLogs.reduce((sum, row) => sum + (row.credits_used ?? 0), 0);
    assert.equal(credits, 2, 'dos créditos, nunca cuatro');
  });

  test('caso 3 — un no-match conserva correlación y su estado de cobro', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [searchOutput([ambiguousOrganization(1)], 1), searchOutput([], 0)],
      enrichment: () => ({ outcome: 'no_match' }),
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.usageLogs.length, 1, 'un no-match también deja su fila');
    const row = recorder.usageLogs[0];
    const correlation = (row.metadata ?? {})[RUN_CORRELATION_METADATA_KEY] as Record<
      string,
      unknown
    >;
    assert.equal(correlation['reservation_id'], CORRELATION.reservationId);
    assert.equal(correlation['idempotency_key'], CORRELATION.idempotencyKey);
    assert.equal(correlation['billing_state'], 'estimated');
    assert.equal(
      row.credits_used,
      0,
      'un match inexistente NO se registra como crédito confirmado',
    );
    assert.equal(row.error_code, 'organization_enrichment_no_match');
  });
});

// ─── 4 · operación indeterminada (§ 4) ────────────────────────────────────────

describe('§ 4 · una operación cuyo cobro no se confirma queda indeterminada', () => {
  test('caso 4 — un timeout de enrichment: billing_state=unknown, sin reintento', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [
        searchOutput([ambiguousOrganization(1), ambiguousOrganization(2)], 2),
        searchOutput([], 0),
      ],
      enrichment: () => ({ outcome: 'timeout' }),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.enrichTransportCalls, 1, 'una sola llamada: no se reintenta');
    assert.equal(recorder.usageLogs.length, 1);
    const row = recorder.usageLogs[0];
    // El constructor deja `credits_used` ausente y `buildProviderUsageLogRow` lo
    // proyecta a SQL NULL: cobro desconocido, nunca un 0 fabricado.
    assert.equal(row.credits_used, undefined);
    assert.equal(buildProviderUsageLogRow(row)['credits_used'], null);
    assert.equal(row.error_code, 'apollo_operation_indeterminate');
    const correlation = (row.metadata ?? {})[RUN_CORRELATION_METADATA_KEY] as Record<
      string,
      unknown
    >;
    assert.equal(correlation['billing_state'], 'unknown');

    assert.deepEqual(output.budgetAnomalies, [TWO_ROUND_INDETERMINATE_ANOMALY]);
    const checkpoint = recorder.checkpoints.at(-1) as ApolloTwoRoundCheckpointV1;
    assert.equal(checkpoint.manual_reconciliation_required, true);
    assert.equal(checkpoint.indeterminate_operation_keys.length, 1);
  });

  test('una búsqueda con páginas indeterminadas detiene la corrida y no ejecuta la ronda 2', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [
        searchOutput([ambiguousOrganization(1)], 1, {
          apollo_pagination: { indeterminate_pages: [1] },
        }),
        searchOutput([confirmedSupermarket(2)], 1),
      ],
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.searchCalls, 1, 'la ronda 2 depende de la 1: no se ejecuta a ciegas');
    assert.equal(recorder.enrichTransportCalls, 0, 'ningún enrichment tras una operación ambigua');
    assert.deepEqual(output.budgetAnomalies, [TWO_ROUND_INDETERMINATE_ANOMALY]);
  });

  test('la indeterminación de la búsqueda se LEE de señales que el provider ya produce', () => {
    assert.equal(readSearchIndeterminacy(searchOutput([], 0)), false);
    assert.equal(
      readSearchIndeterminacy(
        searchOutput([], 0, { apollo_pagination: { indeterminate_pages: [] } }),
      ),
      false,
    );
    assert.equal(
      readSearchIndeterminacy(
        searchOutput([], 0, { apollo_pagination: { indeterminate_pages: [2] } }),
      ),
      true,
    );
    assert.equal(
      readSearchIndeterminacy(searchOutput([], 0, { apollo_error: { billing_state: 'unknown' } })),
      true,
    );
    assert.equal(
      readSearchIndeterminacy(
        searchOutput([], 0, { apollo_error: { billing_state: 'not_charged' } }),
      ),
      false,
    );
  });

  test('la clasificación del cobro es conservadora ante la duda', () => {
    assert.equal(classifyApolloEnrichmentBillingOutcome({ threw: true }), 'indeterminate');
    assert.equal(classifyApolloEnrichmentBillingOutcome({ timedOut: true }), 'indeterminate');
    assert.equal(
      classifyApolloEnrichmentBillingOutcome({ success: true, matched: true }),
      'charged',
    );
    assert.equal(
      classifyApolloEnrichmentBillingOutcome({ success: true, matched: false }),
      'no_match',
    );
    assert.equal(
      classifyApolloEnrichmentBillingOutcome({ success: false, statusCode: 401 }),
      'not_charged',
    );
    assert.equal(
      classifyApolloEnrichmentBillingOutcome({ success: false, statusCode: 500 }),
      'indeterminate',
    );
    assert.equal(
      classifyApolloEnrichmentBillingOutcome({ success: false, statusCode: 429 }),
      'indeterminate',
    );
    assert.equal(
      classifyApolloEnrichmentBillingOutcome({ success: false, statusCode: null }),
      'indeterminate',
    );
    // Sin transporte observable, el literal del cascade distingue el no-match.
    assert.equal(
      classifyApolloEnrichmentOutcomeFromCascadeEntry({
        skip_reason: 'enrichment_failed',
        error: 'enrichment_returned_no_data',
      }),
      'no_match',
    );
    assert.equal(
      classifyApolloEnrichmentOutcomeFromCascadeEntry({
        skip_reason: 'enrichment_failed',
        error: 'timeout',
      }),
      'indeterminate',
    );
    assert.equal(
      classifyApolloEnrichmentOutcomeFromCascadeEntry({ skip_reason: 'cap_reached' }),
      'not_charged',
    );
  });
});

// ─── 5-8 · recuperación por checkpoint (§ 3, § 5) ─────────────────────────────

describe('§ 5 · un reintento recupera y no repite ninguna operación pagada', () => {
  /** Corre un primer intento y devuelve su último checkpoint. */
  async function firstAttempt(options: HarnessOptions): Promise<{
    checkpoint: ApolloTwoRoundCheckpointV1;
    recorder: Recorder;
  }> {
    const { deps, recorder } = buildHarness(options);
    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const checkpoint = recorder.checkpoints.at(-1);
    assert.ok(checkpoint, 'el primer intento tiene que dejar al menos un checkpoint');
    return { checkpoint, recorder };
  }

  test('caso 5 — tras la ronda 1 el reintento no vuelve a buscar', async () => {
    // El checkpoint de la evaluación de la ronda 1: la ronda ya está registrada.
    const { deps, recorder } = buildHarness({
      rounds: [searchOutput([confirmedSupermarket(1)], 1), searchOutput([], 0)],
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const afterRound1 = recorder.checkpoints.find(
      (checkpoint) => checkpoint.checkpoint_reason === 'round_assessment_completed',
    );
    assert.ok(afterRound1, 'la evaluación de la ronda 1 deja su propio checkpoint');
    assert.equal(afterRound1.candidates_persisted, false);
    assert.equal(afterRound1.candidate_snapshots.length, 1);

    const retry = buildHarness({
      rounds: [searchOutput([confirmedSupermarket(1)], 1), searchOutput([], 0)],
      loadCheckpoint: async () => afterRound1,
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), retry.deps);

    assert.ok(
      !retry.recorder.searchRounds.includes(1),
      `la ronda 1 no se repite; se emitieron las rondas ${retry.recorder.searchRounds.join(',')}`,
    );
    assert.ok(
      retry.recorder.writtenCandidateNames.length >= 1,
      'el candidato de la ronda 1 se persiste sin volver a buscarlo',
    );
  });

  test('caso 5-bis — una ronda pagada cuya evaluación no se registró NO se da por vacía', async () => {
    // La ventana entre "búsqueda completada" y "evaluación de la ronda
    // completada": el checkpoint de la búsqueda ya marca la operación como
    // completada, así que un reintento no puede volver a buscar. Sin las
    // organizaciones recuperadas la ronda se registraría con CERO candidatos y la
    // corrida terminaría vacía después de haber pagado.
    const { deps, recorder } = buildHarness({
      rounds: [searchOutput([confirmedSupermarket(1), confirmedSupermarket(2)], 2), searchOutput([], 0)],
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    const afterSearch = recorder.checkpoints.find(
      (checkpoint) => checkpoint.checkpoint_reason === 'search_round_completed',
    );
    assert.ok(afterSearch, 'la búsqueda deja su propio checkpoint');
    assert.equal(afterSearch.completed_operation_keys.length, 1, 'la búsqueda ya está completada');
    assert.equal(afterSearch.candidate_snapshots.length, 0, 'y todavía no hay candidatos');
    assert.equal(
      afterSearch.pending_organizations.length,
      2,
      'las organizaciones pagadas viajan en el checkpoint',
    );

    const retry = buildHarness({
      rounds: [searchOutput([], 0), searchOutput([], 0)],
      loadCheckpoint: async () => afterSearch,
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), retry.deps);

    assert.ok(
      !retry.recorder.searchRounds.includes(1),
      'la ronda 1 ya se pagó: no se repite',
    );
    assert.equal(
      retry.recorder.writtenCandidateNames.length,
      2,
      'las dos organizaciones se recuperan y se persisten, no se dan por cero',
    );
  });

  test('caso 6 — tras un enrichment el reintento no vuelve a enriquecer', async () => {
    const { checkpoint } = await firstAttempt({
      rounds: [searchOutput([ambiguousOrganization(1)], 1), searchOutput([], 0)],
    });
    assert.equal(checkpoint.enrichment_snapshots.length, 1);

    const retry = buildHarness({
      rounds: [searchOutput([ambiguousOrganization(1)], 1), searchOutput([], 0)],
      loadCheckpoint: async () => checkpoint,
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), retry.deps);

    assert.equal(retry.recorder.searchCalls, 0, 'no se vuelve a buscar');
    assert.equal(retry.recorder.enrichTransportCalls, 0, 'no se vuelve a enriquecer');
    assert.equal(retry.recorder.usageLogs.length, 0, 'ni se duplica la fila económica');
  });

  test('caso 7 — tras persistir, el reintento no vuelve a escribir candidatos', async () => {
    const { checkpoint } = await firstAttempt({
      rounds: [searchOutput([confirmedSupermarket(1), confirmedSupermarket(2)], 2), searchOutput([], 0)],
    });
    assert.equal(checkpoint.candidates_persisted, true);
    assert.equal(checkpoint.persisted_candidate_ids.length, 2);

    const retry = buildHarness({
      rounds: [searchOutput([], 0), searchOutput([], 0)],
      loadCheckpoint: async () => checkpoint,
    });
    const output = await runApolloTwoRoundWizardDiscovery(runInput(), retry.deps);

    assert.equal(retry.recorder.writes, 0, 'cero escrituras de candidatos');
    assert.equal(retry.recorder.buildCandidateCalls, 0, 'ni se reconstruyen: ya están en la base');
    assert.equal(output.candidatesCreated, 2, 'se devuelve el resultado ya persistido');
  });

  test('caso 8 — una caída ANTES del checkpoint no puede marcar la operación completada', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [searchOutput([confirmedSupermarket(1)], 1), searchOutput([], 0)],
      failCheckpointReason: 'search_round_completed',
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    // La búsqueda se ejecutó, pero su resultado no quedó recuperable: la operación
    // se degrada a indeterminada. Ni `completed` (un reintento la saltaría sin
    // poder recuperar nada) ni olvidada (un reintento la pagaría dos veces).
    const checkpoint = recorder.checkpoints.at(-1) as ApolloTwoRoundCheckpointV1;
    assert.equal(checkpoint.completed_operation_keys.length, 0);
    assert.equal(checkpoint.indeterminate_operation_keys.length, 1);
    assert.equal(checkpoint.manual_reconciliation_required, true);
    assert.deepEqual(output.budgetAnomalies, [TWO_ROUND_INDETERMINATE_ANOMALY]);
    assert.ok(
      output.warnings.some((warning) => warning.startsWith('two_round_checkpoint_persist_failed')),
      'el fallo de checkpoint queda visible en los avisos',
    );
  });

  test('un checkpoint de otra corrida no se acepta: nunca se saltan operaciones ajenas', () => {
    const foreign = {
      version: 1,
      idempotency_key: 'otra-corrida',
      request_fingerprint: 'otra-huella',
      completed_operation_keys: ['clave-ajena'],
      candidate_snapshots: [],
      round_summaries: [],
    };
    assert.equal(
      readCheckpoint(foreign, {
        idempotencyKey: CORRELATION.idempotencyKey,
        requestFingerprint: CORRELATION.requestFingerprint,
      }),
      null,
    );
    // Misma clave pero otra huella tampoco: no es el mismo trabajo.
    assert.equal(
      readCheckpoint(
        { ...foreign, idempotency_key: CORRELATION.idempotencyKey },
        {
          idempotencyKey: CORRELATION.idempotencyKey,
          requestFingerprint: CORRELATION.requestFingerprint,
        },
      ),
      null,
    );
    // Una versión de contrato desconocida se ignora en vez de adivinarse.
    assert.equal(
      readCheckpoint(
        { ...foreign, version: 99, idempotency_key: CORRELATION.idempotencyKey },
        {
          idempotencyKey: CORRELATION.idempotencyKey,
          requestFingerprint: CORRELATION.requestFingerprint,
        },
      ),
      null,
    );
  });
});

// ─── 9-11 · correlación por ronda y operación (§ 2) ───────────────────────────

describe('§ 2 · ronda, operación y sujeto quedan diferenciados', () => {
  const buildContext = (roundNumber: number, subject: string) =>
    buildApolloTwoRoundOperationContext({
      correlation: CORRELATION,
      roundNumber,
      operationKey: 'organizations_search',
      subject,
    });

  test('caso 9 — la búsqueda de la ronda 1 y la de la ronda 2 no comparten identidad', () => {
    const round1 = buildContext(1, '{"keywordTags":["supermercado"]}');
    const round2 = buildContext(2, '{"keywordTags":["autoservicio"]}');
    assert.notEqual(round1.operationId, round2.operationId);
    assert.equal(round1.roundNumber, 1);
    assert.equal(round2.roundNumber, 2);

    // Incluso con el MISMO sujeto, la ronda basta para diferenciarlas: es lo que
    // impide que la segunda búsqueda se lea como `already_logged`.
    const sameSubject1 = buildContext(1, 'identico');
    const sameSubject2 = buildContext(2, 'identico');
    assert.notEqual(sameSubject1.operationId, sameSubject2.operationId);

    // Y es estable: dos reintentos producen la misma identidad.
    assert.equal(buildContext(1, 'identico').operationId, sameSubject1.operationId);
  });

  test('caso 10 — el sujeto del enrichment identifica la organización, nunca un reloj', () => {
    const byProviderId = buildApolloTwoRoundEnrichmentSubject({
      providerOrganizationId: 'org-1',
      normalizedDomain: 'uno.com',
      candidateKey: 'apollo:org-1',
    });
    const byDomain = buildApolloTwoRoundEnrichmentSubject({
      providerOrganizationId: null,
      normalizedDomain: 'dos.com',
      candidateKey: 'domain:dos.com',
    });
    const byCandidateKey = buildApolloTwoRoundEnrichmentSubject({
      providerOrganizationId: null,
      normalizedDomain: null,
      candidateKey: 'name:tres',
    });

    assert.equal(byProviderId, 'apollo_org:org-1');
    assert.equal(byDomain, 'domain:dos.com');
    assert.equal(byCandidateKey, 'candidate:name:tres');
    assert.equal(new Set([byProviderId, byDomain, byCandidateKey]).size, 3);
    // Estable entre reintentos: ningún timestamp participa.
    assert.equal(
      buildApolloTwoRoundEnrichmentSubject({
        providerOrganizationId: 'org-1',
        normalizedDomain: 'uno.com',
        candidateKey: 'apollo:org-1',
      }),
      byProviderId,
    );
  });

  test('caso 10-bis — dos enrichments de la misma corrida producen sujetos distintos', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [
        searchOutput([ambiguousOrganization(1), ambiguousOrganization(2)], 2),
        searchOutput([], 0),
      ],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    const subjects = recorder.usageLogs.map(
      (row) => (row.metadata ?? {})['operation_subject'] as string,
    );
    assert.equal(subjects.length, 2);
    assert.equal(new Set(subjects).size, 2, 'un sujeto por organización');
    assert.ok(subjects.every((subject) => subject.startsWith('apollo_org:')));
  });

  test('caso 11 — metadata y columnas de correlación coinciden', () => {
    process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS = 'true';
    try {
      const row = buildApolloEnrichmentUsageLogInput({
        usageKey: 'organization_enrichment:batch-1:op-1',
        batchId: CORRELATION.batchId,
        domain: 'uno.com',
        runCorrelation: RUN_CORRELATION_METADATA,
        stampOperationBillingState: true,
        operationContext: {
          round_number: 2,
          operation_key: 'organization_enrichment',
          operation_subject: 'apollo_org:org-1',
          operation_id: 'op-1',
          provider_request_id: null,
        },
        accounting: resolveApolloEnrichmentUsageAccounting('charged'),
      });

      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const block = metadata[RUN_CORRELATION_METADATA_KEY] as Record<string, unknown>;
      const columns = buildCorrelationColumns(row.metadata);

      for (const field of [
        'reservation_id',
        'client_request_id',
        'wizard_run_id',
        'request_fingerprint',
        'idempotency_key',
        'billing_state',
      ]) {
        assert.equal(
          columns[field],
          block[field],
          `la columna ${field} tiene que coincidir con la metadata`,
        );
      }
      assert.equal(columns['billing_state'], 'recorded');
      assert.equal(metadata['round_number'], 2);
      assert.equal(metadata['operation_subject'], 'apollo_org:org-1');
      assert.equal(metadata['operation_id'], 'op-1');
      assert.equal(metadata['provider_request_id'], null);
    } finally {
      delete process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS;
    }
  });

  // ── CAS-CLOSE § 5 · el contrato económico, explícito en la fila ────────────

  test('CAS-CLOSE § 5 — la fila de dos rondas declara su contrato económico', () => {
    const row = buildApolloEnrichmentUsageLogInput({
      usageKey: 'organization_enrichment:batch-1:op-1',
      batchId: CORRELATION.batchId,
      domain: 'uno.com',
      billingContract: APOLLO_TWO_ROUND_BILLING_CONTRACT,
      accounting: resolveApolloEnrichmentUsageAccounting('charged'),
    });
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    assert.equal(metadata['execution_mode'], 'apollo_two_round');
    assert.equal(metadata['billing_contract_version'], 'apollo_two_round_v1');
  });

  test('CAS-CLOSE § 5 — la fila legacy declara el suyo sin que nadie lo pida', () => {
    // Omitir el contrato es lo que hace la ruta legacy: su criterio no cambia, y
    // la fila queda igual salvo por las dos claves aditivas.
    const row = buildApolloEnrichmentUsageLogInput({
      usageKey: 'organization_enrichment:batch-1:uno.com',
      batchId: CORRELATION.batchId,
      domain: 'uno.com',
      accounting: resolveApolloEnrichmentUsageAccounting('charged'),
    });
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    assert.equal(metadata['execution_mode'], 'apollo_legacy');
    assert.equal(metadata['billing_contract_version'], 'apollo_legacy_v1');
  });

  test('CAS-CLOSE § 5 — el contrato NO reescribe el veredicto de cobro', () => {
    // Los cuatro desenlaces del criterio de dos rondas siguen intactos: el
    // discriminador dice bajo qué contrato se leyó el cobro, no cuál fue.
    const outcomes = [
      ['charged', 1, 'recorded'],
      ['no_match', 0, 'estimated'],
      ['not_charged', 0, 'estimated'],
      ['indeterminate', undefined, 'unknown'],
    ] as const;
    for (const [outcome, credits, billingState] of outcomes) {
      const row = buildApolloEnrichmentUsageLogInput({
        usageKey: `organization_enrichment:batch-1:${outcome}`,
        batchId: CORRELATION.batchId,
        domain: 'uno.com',
        billingContract: APOLLO_TWO_ROUND_BILLING_CONTRACT,
        accounting: resolveApolloEnrichmentUsageAccounting(outcome),
      });
      assert.equal(row.credits_used, credits, `${outcome}: créditos`);
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      assert.equal(metadata['billing_outcome_billing_state'], billingState, `${outcome}: estado`);
      assert.equal(metadata['billing_contract_version'], 'apollo_two_round_v1');
    }
  });

  test('CAS-CLOSE § 5 — `indeterminate` deja `credits_used` en NULL, jamás en cero', () => {
    const row = buildApolloEnrichmentUsageLogInput({
      usageKey: 'organization_enrichment:batch-1:op-indeterminate',
      batchId: CORRELATION.batchId,
      domain: 'uno.com',
      billingContract: APOLLO_TWO_ROUND_BILLING_CONTRACT,
      accounting: resolveApolloEnrichmentUsageAccounting('indeterminate'),
    });
    assert.equal(row.credits_used, undefined, 'undefined ⇒ columna NULL');
    assert.notEqual(row.credits_used, 0, 'un cero se leería como cobro confirmado en cero');
  });
});

// ─── 12-13 · reconciliación (§ 9) ─────────────────────────────────────────────

describe('§ 9 · la reconciliación suma búsqueda y enrichment de las dos rondas', () => {
  const reconcilableRow = (
    operation: 'organizations_search' | 'organization_enrichment',
    credits: number | null,
    usageKey: string,
  ) => ({
    provider_key: 'apollo',
    operation_key: operation,
    credits_used: credits,
    usage_key: usageKey,
    batch_id: CORRELATION.batchId,
    metadata: { [RUN_CORRELATION_METADATA_KEY]: RUN_CORRELATION_METADATA },
  });

  const correlation = {
    wizardRunId: CORRELATION.wizardRunId,
    clientRequestId: CORRELATION.clientRequestId,
    batchId: CORRELATION.batchId,
    reservationId: CORRELATION.reservationId,
    agentRunId: null,
    providerKey: 'apollo_organizations',
    requestFingerprint: CORRELATION.requestFingerprint,
    idempotencyKey: CORRELATION.idempotencyKey,
  };

  test('caso 12 — dos búsquedas y dos enrichments suman 12, una sola vez', () => {
    const rows = [
      reconcilableRow('organizations_search', 5, 'search:r1'),
      reconcilableRow('organizations_search', 5, 'search:r2'),
      reconcilableRow('organization_enrichment', 1, 'enrich:org-1'),
      reconcilableRow('organization_enrichment', 1, 'enrich:org-2'),
    ];

    const result = reconcileWizardRunSpend({
      correlation,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 12,
      reservedCredits: 12,
      rows,
    });

    assert.equal(result.matchedRowCount, 4, 'cuatro operaciones diferenciadas');
    assert.equal(result.recordedUsageCredits, 12);
    assert.equal(result.perOperationCredits['organizations_search'], 10);
    assert.equal(result.perOperationCredits['organization_enrichment'], 2);
    assert.equal(result.confirmedProviderCredits, null, 'nunca se infiere de nuestro ledger');
    assert.equal(result.billingState, 'recorded');

    // Repetir la reconciliación con las MISMAS filas duplicadas no duplica créditos.
    const repeated = reconcileWizardRunSpend({
      correlation,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 12,
      reservedCredits: 12,
      rows: [...rows, ...rows],
    });
    assert.equal(repeated.recordedUsageCredits, 12);
    assert.equal(repeated.matchedRowCount, 4);
  });

  test('caso 13 — un crédito desconocido impide declarar la conciliación cerrada', () => {
    const result = reconcileWizardRunSpend({
      correlation,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 12,
      reservedCredits: 12,
      rows: [
        reconcilableRow('organizations_search', 5, 'search:r1'),
        // La fila del enrichment indeterminado: crédito NULL.
        reconcilableRow('organization_enrichment', null, 'enrich:org-1'),
      ],
    });

    assert.equal(result.billingState, 'unknown');
    assert.equal(result.recordedUsageCredits, null);
    assert.ok(result.anomalies.includes('usage_credits_unknown'));
    assert.equal(
      result.creditsToConfirm,
      12,
      'ante gasto no verificable se confirma la reserva entera, nunca menos',
    );
  });

  test('dos corridas del mismo lote no se reclaman las filas entre sí', () => {
    const otherRun = {
      ...reconcilableRow('organizations_search', 5, 'search:other'),
      metadata: {
        [RUN_CORRELATION_METADATA_KEY]: {
          ...RUN_CORRELATION_METADATA,
          reservation_id: 'reservation-2',
          client_request_id: 'client-2',
          wizard_run_id: 'run-2',
        },
      },
    };

    const result = reconcileWizardRunSpend({
      correlation,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 12,
      reservedCredits: 12,
      rows: [reconcilableRow('organizations_search', 5, 'search:r1'), otherRun],
    });

    assert.equal(result.matchedRowCount, 1);
    assert.equal(result.recordedUsageCredits, 5);
    assert.equal(result.foreignRowCount, 1);
    assert.ok(result.anomalies.includes('foreign_usage_rows_present'));
  });
});

// ─── 14-15 · escritura segura del checkpoint (§ 7) ────────────────────────────

describe('§ 7 · el checkpoint no pisa metadata ajena ni se sobrescribe con una versión vieja', () => {
  /** Almacén en memoria con la misma forma que el cliente admin real. */
  function memoryStore(initial: Record<string, unknown>): {
    client: CheckpointStoreClient;
    read: () => Record<string, unknown>;
    updates: number;
  } {
    let document: Record<string, unknown> = { ...initial };
    const store = {
      updates: 0,
      read: () => document,
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
                return { data: [{ id: 'batch-1' }], error: null };
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

  const baseCheckpoint = (version: number): ApolloTwoRoundCheckpointV1 => ({
    version: 1,
    checkpoint_version: version,
    checkpoint_updated_at: null,
    checkpoint_reason: 'run_completed',
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
  });

  test('caso 14 — la metadata de otros autores se conserva', async () => {
    const store = memoryStore({
      provider_routing: { intended: 'default_ai' },
      writer_summary: { actual_persisted_count: 5 },
    });

    const outcome = await writeTwoRoundCheckpoint(
      CORRELATION.batchId,
      baseCheckpoint(1),
      store.client,
      { now: () => '2026-08-03T00:00:00.000Z' },
    );

    assert.equal(outcome.kind, 'written');
    const document = store.read();
    assert.deepEqual(document['provider_routing'], { intended: 'default_ai' });
    assert.deepEqual(document['writer_summary'], { actual_persisted_count: 5 });
    assert.ok(document[APOLLO_TWO_ROUND_CHECKPOINT_KEY]);
  });

  test('caso 14-bis — un autor posterior conserva el checkpoint, y el checkpoint su metadata', async () => {
    const store = memoryStore({});
    await writeTwoRoundCheckpoint(CORRELATION.batchId, baseCheckpoint(1), store.client, {
      now: () => '2026-08-03T00:00:00.000Z',
    });

    // El writer de candidatos lee el documento y le añade SU metadata.
    const afterWriter = { ...store.read(), writer_summary: { actual_persisted_count: 5 } };
    const storeAfterWriter = memoryStore(afterWriter);

    // El checkpoint siguiente relee, así que conserva lo que el writer dejó.
    const outcome = await writeTwoRoundCheckpoint(
      CORRELATION.batchId,
      { ...baseCheckpoint(2), checkpoint_reason: 'candidates_persisted' },
      storeAfterWriter.client,
      { now: () => '2026-08-03T00:00:01.000Z' },
    );

    assert.equal(outcome.kind, 'written');
    const document = storeAfterWriter.read();
    assert.deepEqual(document['writer_summary'], { actual_persisted_count: 5 });
    const stored = document[APOLLO_TWO_ROUND_CHECKPOINT_KEY] as ApolloTwoRoundCheckpointV1;
    assert.equal(stored.checkpoint_reason, 'candidates_persisted');
  });

  test('caso 15 — una escritura stale se rechaza y no pierde el checkpoint reciente', async () => {
    const store = memoryStore({});
    await writeTwoRoundCheckpoint(CORRELATION.batchId, baseCheckpoint(1), store.client, {
      now: () => '2026-08-03T00:00:00.000Z',
    });
    await writeTwoRoundCheckpoint(
      CORRELATION.batchId,
      { ...baseCheckpoint(2), candidates_persisted: true },
      store.client,
      { now: () => '2026-08-03T00:00:01.000Z' },
    );

    const stale = await writeTwoRoundCheckpoint(
      CORRELATION.batchId,
      { ...baseCheckpoint(1), candidates_persisted: false },
      store.client,
      { now: () => '2026-08-03T00:00:02.000Z' },
    );

    assert.equal(stale.kind, 'stale_rejected');
    const stored = store.read()[APOLLO_TWO_ROUND_CHECKPOINT_KEY] as ApolloTwoRoundCheckpointV1;
    assert.equal(stored.checkpoint_version, 2, 'gana el más nuevo');
    assert.equal(stored.candidates_persisted, true, 'y su contenido no se revierte');
  });

  test('dos checkpoints secuenciales conservan el más nuevo', async () => {
    const store = memoryStore({});
    await writeTwoRoundCheckpoint(CORRELATION.batchId, baseCheckpoint(1), store.client, {
      now: () => '2026-08-03T00:00:00.000Z',
    });
    const second = await writeTwoRoundCheckpoint(
      CORRELATION.batchId,
      { ...baseCheckpoint(2), checkpoint_reason: 'enrichment_completed' },
      store.client,
      { now: () => '2026-08-03T00:00:01.000Z' },
    );

    assert.equal(second.kind, 'written');
    const stored = store.read()[APOLLO_TWO_ROUND_CHECKPOINT_KEY] as ApolloTwoRoundCheckpointV1;
    assert.equal(stored.checkpoint_version, 2);
    assert.equal(stored.checkpoint_reason, 'enrichment_completed');
    assert.equal(store.updates, 2);
  });
});

// ─── 16-17 · snapshot sanitizado y acotado (§ 6) ──────────────────────────────

describe('§ 6 · el snapshot es mínimo, sanitizado y acotado', () => {
  test('caso 16 — no lleva payloads completos, headers, secretos ni datos personales', () => {
    const polluted: WebSearchResult = {
      title: 'Empresa Con Ruido',
      url: 'https://ruido.com.co',
      snippet: 'supermercado',
      source: 'apollo_organizations',
      rank: 1,
      provider: 'apollo_organizations',
      metadata: {
        apollo_organization_id: 'org-ruido',
        domain: 'ruido.com.co',
        industry: 'retail',
        // Nada de esto puede aparecer en el snapshot.
        phone: '+57 300 000 0000',
        raw_payload: { organizations: [{ id: 'x', phone: '+57 1 000 0000' }] },
        headers: { authorization: 'Bearer super-secreto' },
        api_key: 'apollo-api-key-secreta',
        people: [{ email: 'persona@ruido.com.co', name: 'Persona Real' }],
        contact_email: 'persona@ruido.com.co',
        apollo_profile: { industry: 'retail', primary_domain: 'ruido.com.co' },
      },
    };

    const snapshot = toCandidateEvidenceSnapshot(polluted);
    const serialized = JSON.stringify(snapshot);

    for (const forbidden of [
      'raw_payload',
      'headers',
      'authorization',
      'Bearer',
      'api_key',
      'apollo-api-key-secreta',
      'people',
      'persona@ruido.com.co',
      'Persona Real',
      '+57 300 000 0000',
      '+57 1 000 0000',
    ]) {
      assert.ok(
        !serialized.includes(forbidden),
        `el snapshot no puede contener ${forbidden}`,
      );
    }
    // Y sí conserva lo que hace falta para continuar sin volver a buscar.
    assert.equal(snapshot.provider_organization_id, 'org-ruido');
    assert.equal(snapshot.domain, 'ruido.com.co');
    assert.equal(snapshot.industry, 'retail');
    assert.equal(snapshot.title, 'Empresa Con Ruido');
  });

  test('caso 17 — el checkpoint del peor caso cabe bajo el techo declarado', () => {
    const longText = 'x'.repeat(5_000);
    const longArray = Array.from({ length: 50 }, (_, index) => `keyword-${index}-${longText}`);
    const worstCaseEvidence = toCandidateEvidenceSnapshot({
      title: longText,
      url: `https://${longText}.com`,
      snippet: longText,
      source: 'apollo_organizations',
      rank: 1,
      provider: 'apollo_organizations',
      metadata: {
        apollo_organization_id: longText,
        domain: `${longText}.com`,
        industry: longText,
        industries: longArray,
        keywords: longArray,
        organization_keywords: longArray,
        short_description: longText,
        seo_description: longText,
        description: longText,
        city: longText,
        country: longText,
        country_code: longText,
        employee_count: 1_000_000,
      },
    } as WebSearchResult);

    // Diez organizaciones es el tope de resultados crudos de la corrida.
    const checkpoint: ApolloTwoRoundCheckpointV1 = {
      version: 1,
      checkpoint_version: 1,
      checkpoint_updated_at: '2026-08-03T00:00:00.000Z',
      checkpoint_reason: 'run_completed',
      idempotency_key: CORRELATION.idempotencyKey,
      request_fingerprint: CORRELATION.requestFingerprint,
      wizard_run_id: CORRELATION.wizardRunId,
      config: defaultApolloTwoRoundConfig(),
      completed_operation_keys: ['a', 'b', 'c', 'd'],
      indeterminate_operation_keys: [],
      seen_organization_keys: Array.from({ length: 40 }, (_, i) => `dom:empresa-${i}.com.co`),
      round_summaries: [],
      pending_organizations: [],
      candidate_snapshots: Array.from({ length: 10 }, (_, index) => ({
        candidate_key: `apollo:org-${index}`,
        round_number: (index % 2) + 1,
        provider_rank: index + 1,
        provider_organization_id: `org-${index}`,
        normalized_name: `empresa ${index}`,
        normalized_domain: `empresa${index}.com.co`,
        normalized_linkedin_url: `linkedin.com/company/empresa-${index}`,
        sector_evidence_state: 'sector_evidence_confirmed' as const,
        rejection_reason: null,
        eligible: true,
        became_eligible_after_enrichment: false,
        finally_rejected_or_duplicated: false,
        no_prior_suggestion: true,
        enrichment_status: 'not_attempted' as const,
        ranking_signals: {
          countryCompatible: true,
          domainConfident: true,
          ownershipConfident: true,
          sectorKeywordMatchCount: 3,
          novel: true,
          hasCompanySizeSignal: true,
          hasLocationSignal: true,
          hasLinkedInUrl: true,
          freeOfContradictoryEvidence: true,
          knownDuplicate: false,
          cooldownActive: false,
        },
        evidence: worstCaseEvidence,
      })),
      enrichment_snapshots: [],
      recorded_operation_credits: [],
      persisted_candidate_ids: Array.from({ length: 5 }, (_, i) => `candidate-${i}`),
      candidates_persisted: true,
      observed_rejection_reasons: [],
      second_round_skipped_reason: null,
      totals: {
        raw_results: 10,
        search_credits: 10,
        enrichment_credits: 2,
        enrichments_executed: 2,
      },
      spend_accounting: {
        estimated_credits: 12,
        reserved_credits: 12,
        recorded_usage_credits: 12,
        confirmed_provider_credits: null,
      },
      checkpoint_write_failures: [],
      manual_reconciliation_required: false,
      compacted: false,
    };

    const bytes = measureCheckpointSerializedBytes(checkpoint);
    assert.ok(
      bytes <= APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
      `el peor caso ocupa ${bytes} bytes; el techo es ${APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES}`,
    );
  });

  test('la compactación suelta primero la evidencia de los ya rechazados', () => {
    const evidence = toCandidateEvidenceSnapshot(confirmedSupermarket(1));
    const snapshot = (key: string, eligible: boolean) => ({
      candidate_key: key,
      round_number: 1,
      provider_rank: 1,
      provider_organization_id: key,
      normalized_name: key,
      normalized_domain: `${key}.com`,
      normalized_linkedin_url: null,
      sector_evidence_state: 'sector_evidence_confirmed' as const,
      rejection_reason: null,
      eligible,
      became_eligible_after_enrichment: false,
      finally_rejected_or_duplicated: !eligible,
      no_prior_suggestion: true,
      enrichment_status: 'not_attempted' as const,
      ranking_signals: {
        countryCompatible: true,
        domainConfident: true,
        ownershipConfident: true,
        sectorKeywordMatchCount: 1,
        novel: true,
        hasCompanySizeSignal: true,
        hasLocationSignal: true,
        hasLinkedInUrl: false,
        freeOfContradictoryEvidence: true,
        knownDuplicate: false,
        cooldownActive: false,
      },
      evidence,
    });

    const checkpoint = {
      version: 1 as const,
      checkpoint_version: 1,
      checkpoint_updated_at: null,
      checkpoint_reason: 'run_completed' as const,
      idempotency_key: CORRELATION.idempotencyKey,
      request_fingerprint: CORRELATION.requestFingerprint,
      wizard_run_id: CORRELATION.wizardRunId,
      config: defaultApolloTwoRoundConfig(),
      completed_operation_keys: [],
      indeterminate_operation_keys: [],
      seen_organization_keys: [],
      round_summaries: [],
      pending_organizations: [],
      candidate_snapshots: [snapshot('vivo', true), snapshot('rechazado', false)],
      enrichment_snapshots: [],
      recorded_operation_credits: [],
      persisted_candidate_ids: [],
      candidates_persisted: false,
      observed_rejection_reasons: [],
      second_round_skipped_reason: null,
      totals: { raw_results: 2, search_credits: 2, enrichment_credits: 0, enrichments_executed: 0 },
      spend_accounting: {
        estimated_credits: 12,
        reserved_credits: 12,
        recorded_usage_credits: 2,
        confirmed_provider_credits: null,
      },
      checkpoint_write_failures: [],
      manual_reconciliation_required: false,
      compacted: false,
    };

    // Techo artificialmente pequeño para forzar la compactación.
    const compacted = compactCheckpointForSize(checkpoint, 1_800);
    const byKey = new Map(compacted.checkpoint.candidate_snapshots.map((s) => [s.candidate_key, s]));
    assert.equal(byKey.get('rechazado')?.evidence, null, 'la del rechazado se suelta primero');
    assert.ok(
      byKey.get('vivo')?.evidence !== null,
      'la de un candidato vivo se conserva: sin ella el reintento no podría persistirlo',
    );
    assert.deepEqual(compacted.droppedEvidenceFor, ['rechazado']);
  });
});

// ─── 18 · sin comprobaciones externas duplicadas (§ 8) ────────────────────────

describe('§ 8 · el enrichment no repite la verificación de sitio ni la de duplicados', () => {
  test('caso 18 — diez organizaciones y dos enrichments: como máximo diez comprobaciones', async () => {
    // Todas ambiguas: así el objetivo NO se alcanza con señales gratuitas y la
    // fase de enrichment sí se ejecuta, que es lo que esta prueba mide.
    const organizations = Array.from({ length: 10 }, (_, index) =>
      ambiguousOrganization(index + 1),
    );
    const { deps, recorder } = buildHarness({
      rounds: [searchOutput(organizations.slice(0, 5), 5), searchOutput(organizations.slice(5), 5)],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    // `buildProspectingPipelineCandidate` ejecuta verifyWebsite Y
    // checkCompanyDuplicate: un único contador cubre las dos comprobaciones.
    assert.ok(
      recorder.buildCandidateCalls <= 10,
      `se construyeron ${recorder.buildCandidateCalls} candidatos; el techo es 10`,
    );
    assert.ok(
      recorder.enrichTransportCalls > 0,
      'la prueba tiene que ejercitar al menos un enrichment para ser significativa',
    );
  });

  test('un enrichment que NO cambia el dominio no vuelve a construir el candidato', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [searchOutput([ambiguousOrganization(1)], 1), searchOutput([], 0)],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.enrichTransportCalls, 1);
    assert.equal(
      recorder.buildCandidateCalls,
      1,
      'una organización ⇒ una construcción, aunque se haya enriquecido',
    );
  });
});

// ─── 19 · aislamiento entre corridas concurrentes ─────────────────────────────

describe('§ 2 · dos corridas concurrentes quedan completamente aisladas', () => {
  test('caso 19 — ni claves de operación, ni checkpoints, ni filas económicas se mezclan', async () => {
    const otherCorrelation = {
      ...CORRELATION,
      wizardRunId: 'run-2',
      clientRequestId: 'client-2',
      reservationId: 'reservation-2',
      requestFingerprint: 'fingerprint-2',
      idempotencyKey: 'idempotency-2',
    };

    const runA = buildHarness({
      rounds: [searchOutput([ambiguousOrganization(1)], 1), searchOutput([], 0)],
    });
    const runB = buildHarness({
      rounds: [searchOutput([ambiguousOrganization(1)], 1), searchOutput([], 0)],
    });

    const [, ] = await Promise.all([
      runApolloTwoRoundWizardDiscovery(runInput(), runA.deps),
      runApolloTwoRoundWizardDiscovery(
        runInput({ correlation: otherCorrelation, reservedBatchId: 'batch-2' }),
        runB.deps,
      ),
    ]);

    const keysA = new Set(runA.recorder.checkpoints.at(-1)!.completed_operation_keys);
    const keysB = new Set(runB.recorder.checkpoints.at(-1)!.completed_operation_keys);
    assert.ok(keysA.size > 0 && keysB.size > 0);
    for (const key of keysA) {
      assert.ok(!keysB.has(key), 'ninguna clave de operación se comparte entre corridas');
    }

    // Y el checkpoint de cada una declara SU identidad, así que la otra no lo
    // aceptaría ni por error.
    assert.equal(runA.recorder.checkpoints.at(-1)!.idempotency_key, CORRELATION.idempotencyKey);
    assert.equal(
      runB.recorder.checkpoints.at(-1)!.idempotency_key,
      otherCorrelation.idempotencyKey,
    );
    assert.notEqual(
      runA.recorder.usageLogs[0].usage_key,
      runB.recorder.usageLogs[0].usage_key,
    );
  });

  test('el estado recuperado y el checkpoint hablan del mismo hecho', async () => {
    const { deps, recorder } = buildHarness({
      rounds: [searchOutput([confirmedSupermarket(1)], 1), searchOutput([], 0)],
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    const checkpoint = recorder.checkpoints.at(-1) as ApolloTwoRoundCheckpointV1;
    const resume = toResumeStateFromCheckpoint(checkpoint);

    assert.equal(resume.candidates.length, checkpoint.candidate_snapshots.length);
    assert.equal(resume.candidatesPersisted, checkpoint.candidates_persisted);
    assert.deepEqual(
      [...(resume.completedOperationKeys ?? [])],
      checkpoint.completed_operation_keys,
    );
    assert.equal(resume.totalSearchCredits, checkpoint.totals.search_credits);
  });
});

// ─── Contabilidad sin proveedor: el orquestador puro ──────────────────────────

describe('§ 3 · sin escritor de checkpoint el orquestador sigue siendo puro', () => {
  test('una corrida sin `saveCheckpoint` no falla y no inventa durabilidad', async () => {
    const passing: CheapAssessment = {
      rejection: null,
      sectorEvidenceState: 'sector_evidence_confirmed',
      signals: {
        countryCompatible: true,
        domainConfident: true,
        ownershipConfident: true,
        sectorKeywordMatchCount: 2,
        novel: true,
        hasCompanySizeSignal: true,
        hasLocationSignal: true,
        hasLinkedInUrl: false,
        freeOfContradictoryEvidence: true,
        knownDuplicate: false,
        cooldownActive: false,
      },
      noPriorSuggestion: true,
    };

    const deps: ApolloTwoRoundDeps = {
      searchRound: async () => ({
        organizations: [
          { providerOrganizationId: 'org-1', name: 'Uno', domain: 'uno.com', providerRank: 1 },
        ],
        providerRequestCount: 1,
        internalRecordedCredits: 1,
      }),
      assessCandidate: () => passing,
      enrichCandidate: async () => ({
        executed: false,
        sectorEvidenceState: 'sector_evidence_confirmed',
        internalRecordedCredits: 0,
      }),
    };

    const result = await runApolloTwoRoundDiscovery(
      {
        config: defaultApolloTwoRoundConfig(),
        queryContext: {
          country: 'Colombia',
          countryCode: 'CO',
          sector: 'Supermercados e Hipermercados',
          subindustry: null,
        },
        correlation: CORRELATION,
      },
      deps,
    );

    assert.equal(result.checkpointWriteFailures.length, 0);
    assert.equal(result.manualReconciliationRequired, false);
    assert.equal(result.indeterminateOperationKeys.length, 0);
    assert.ok(result.completedOperationKeys.length > 0);
  });
});
