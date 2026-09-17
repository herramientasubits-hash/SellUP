/**
 * apollo-two-round-checkpoint-durability-x67.test.ts — X6.7.
 *
 * El defecto que cierra, observado en la E2E X6.6 (Production):
 *
 *     98 organizations · 0 accounts · 98 organizations_new_in_page
 *     two_round_checkpoint_persist_failed:search_round_completed:too_large
 *     checkpoint_write_failures = ['…:too_large']
 *     result_status = apollo_operation_indeterminate
 *
 * Una página grande hacía que el checkpoint de `search_round_completed` llevara
 * un snapshot con evidencia por CADA organización devuelta. El documento pasaba
 * del techo de 64 KiB, la escritura devolvía `too_large` y el orquestador
 * degradaba a INDETERMINADA una búsqueda que ya se había pagado. Se perdía la
 * corrida entera por no poder guardar un dato de recuperación.
 *
 * ─── La decisión, explícita ──────────────────────────────────────────────────
 *
 * Qué estado NECESITA el checkpoint y por eso se conserva íntegro:
 *
 *   · que la operación de búsqueda quedó COMPLETADA (`completed_operation_keys`);
 *   · la identidad de la corrida (`idempotency_key`, `request_fingerprint`,
 *     `wizard_run_id`) y el gasto por operación;
 *   · la identidad Y la evidencia mínima de cada organización pendiente que la
 *     evaluación barata va a mirar de verdad — las `maxRawResultsPerRun − ya
 *     procesadas` primeras en orden del proveedor.
 *
 * Qué payload NO pertenece al checkpoint:
 *
 *   · el de las organizaciones por encima de ese tope. El bucle de evaluación
 *     las descarta con `raw_result_cap_reached` ANTES de leer su evidencia, así
 *     que no pueden volverse candidatas, ni enriquecerse, ni persistirse, ni
 *     mover una métrica (`tallyRejection` no contabiliza ese motivo). Era
 *     volumen del proveedor, no estado de la corrida.
 *
 * Y no es un truncado silencioso: `pending_organization_tallies` publica, por
 * ronda, cuántas devolvió la búsqueda y cuántas conserva el documento. El
 * registro completo de la página sigue en `provider_usage_logs` (X6.5), intacto.
 *
 * TODO offline. Cero llamadas a Apollo, cero a Lusha, cero Supabase: el
 * proveedor, el writer y el almacén del checkpoint entran por inyección. La
 * escritura SÍ atraviesa el escritor real (`writeTwoRoundCheckpoint`) contra un
 * almacén en memoria, que es lo único que hace que el techo de 64 KiB se
 * ejercite de verdad.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import {
  APOLLO_TWO_ROUND_CHECKPOINT_KEY,
  APOLLO_TWO_ROUND_CHECKPOINT_BYTES_PER_ORGANIZATION,
  APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
  APOLLO_TWO_ROUND_MAX_RECOVERABLE_ORGANIZATIONS_PER_RUN,
  compactCheckpointForSize,
  measureCheckpointSerializedBytes,
  toCandidateEvidenceSnapshot,
  type ApolloTwoRoundCandidateSnapshot,
  type ApolloTwoRoundCheckpointV1,
  type ApolloTwoRoundPendingOrganizationSnapshot,
} from '../checkpoint';
import {
  writeTwoRoundCheckpoint,
  type CheckpointStoreClient,
  type CheckpointWriteOutcome,
} from '../checkpoint.server';
import { defaultApolloTwoRoundConfig } from '../index';
import { MAX_SEARCH_ROUNDS_ABSOLUTE_MAX } from '../config';
import {
  APOLLO_CONTRACT_MAX_PER_PAGE,
  WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
} from '../../apollo-organizations-pagination-budget';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../observability';
import type {
  ProspectingPipelineCandidate,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';

// ─── Correlación ──────────────────────────────────────────────────────────────

const CORRELATION = {
  wizardRunId: 'run-x67',
  clientRequestId: 'client-x67',
  batchId: 'batch-x67',
  reservationId: 'reservation-x67',
  requestFingerprint: 'fingerprint-x67',
  idempotencyKey: 'idempotency-x67',
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

// ─── Fixture de página grande ─────────────────────────────────────────────────

/**
 * Una organización de la página, con campos del tamaño que Apollo devuelve de
 * verdad (~1,2 KiB por snapshot pendiente, medido).
 *
 * `country` decide el desenlace: las colombianas atraviesan los gates y se
 * persisten; las peruanas las rechaza el gate de PAÍS. La mezcla importa —una
 * página donde TODO es elegible no representa ninguna corrida real, y una donde
 * nada lo es no probaría que la corrida sigue produciendo candidatos.
 */
function pageOrganization(index: number, country: 'CO' | 'PE'): WebSearchResult {
  return {
    title: `Supermercado Regional ${index} S.A.S.`,
    url: `https://supermercadoregional${index}.com.co`,
    snippet:
      'Cadena de supermercados y autoservicio con tiendas de abarrotes en varias ciudades del país.',
    source: 'apollo_organizations',
    rank: index,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `6612aa0f9b1c4d00018a${String(index).padStart(4, '0')}`,
      domain: `supermercadoregional${index}.com.co`,
      industry: 'retail',
      country_code: country,
      country: country === 'CO' ? 'Colombia' : 'Perú',
      city: country === 'CO' ? 'Bogotá' : 'Lima',
      employee_count: 900,
      estimated_num_employees: 900,
      short_description:
        'Operador de supermercados y tiendas de abarrotes con red de puntos de venta y distribución propia.',
      seo_description:
        'Supermercados, autoservicio y abarrotes. Compra en línea y domicilios en las principales ciudades.',
      keywords: ['supermercado', 'abarrotes', 'autoservicio', 'retail', 'alimentos', 'domicilios'],
      organization_keywords: ['supermercado', 'retail'],
      industries: ['retail', 'grocery'],
      apollo_profile: { industry: 'retail', industries: ['retail', 'grocery'] },
    },
  };
}

/**
 * Una página de Apollo: `size` organizations, 0 accounts, todas con id.
 *
 * Las seis primeras son colombianas —la parte que la corrida sí puede
 * persistir—; el resto, peruanas, que es la proporción que las corridas reales
 * de este proveedor han mostrado.
 */
const PERSISTIBLE_PER_PAGE = 6;

function largePage(size: number): WebSearchResult[] {
  return Array.from({ length: size }, (_v, index) =>
    pageOrganization(index + 1, index < PERSISTIBLE_PER_PAGE ? 'CO' : 'PE'),
  );
}

function searchOutput(results: WebSearchResult[], credits: number): WebSearchOutput {
  return {
    provider: 'apollo_organizations',
    query: 'supermercados',
    results,
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: { usage: { credits_used: credits } },
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

// ─── Almacén en memoria con la forma del cliente admin real ───────────────────

function memoryStore(initial: Record<string, unknown> = {}): {
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

// ─── Arnés ────────────────────────────────────────────────────────────────────

type Recorder = {
  searchRounds: number[];
  checkpoints: ApolloTwoRoundCheckpointV1[];
  checkpointOutcomes: CheckpointWriteOutcome[];
  writtenCandidateNames: string[];
  observability: Record<string, unknown> | null;
  /** Lo almacenado tras la PRIMERA escritura de cada motivo de checkpoint. */
  storedByReason: Map<string, ApolloTwoRoundCheckpointV1>;
};

function buildHarness(options: {
  rounds: WebSearchOutput[];
  loadCheckpoint?: ApolloTwoRoundProductionDeps['loadCheckpoint'];
}): {
  deps: Partial<ApolloTwoRoundProductionDeps>;
  recorder: Recorder;
  readStored: () => ApolloTwoRoundCheckpointV1 | null;
} {
  const recorder: Recorder = {
    searchRounds: [],
    checkpoints: [],
    checkpointOutcomes: [],
    writtenCandidateNames: [],
    observability: null,
    storedByReason: new Map(),
  };
  const store = memoryStore();

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo: (async (
      _input: unknown,
      _maxResults: number,
      usageContext?: { operationContext?: { round_number?: number } | null },
    ) => {
      const round =
        usageContext?.operationContext?.round_number ?? recorder.searchRounds.length + 1;
      recorder.searchRounds.push(round);
      return options.rounds[round - 1] ?? searchOutput([], 0);
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    enrichOrganization: (async (params: { domain: string }) => ({
      success: true,
      data: {
        id: `enriched-${params.domain}`,
        name: params.domain,
        website_url: `https://${params.domain}`,
        primary_domain: params.domain,
        linkedin_url: null,
        industry: 'retail',
        industry_tag_ids: [],
        employee_count: 900,
        estimated_num_employees: 900,
        city: 'Bogotá',
        country: 'Colombia',
        phone: null,
        annual_revenue: null,
        technologies: [],
        short_description: 'cadena de supermercados y autoservicio',
        seo_description: null,
        keywords: ['supermercado', 'abarrotes'],
      },
    })) as unknown as ApolloTwoRoundProductionDeps['enrichOrganization'],

    logEnrichmentUsage: (async () => ({
      kind: 'logged' as const,
    })) as unknown as ApolloTwoRoundProductionDeps['logEnrichmentUsage'],

    loadEnrichmentUnitCostUsd: async () => 0.02,

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
      extraBatchMetadata?: Record<string, unknown> | null;
    }) => {
      recorder.writtenCandidateNames = writerInput.pipelineOutput.candidates.map((c) => c.name);
      recorder.observability =
        ((writerInput.extraBatchMetadata ?? {})[APOLLO_TWO_ROUND_OBSERVABILITY_KEY] as
          | Record<string, unknown>
          | undefined) ?? null;
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
    // El escritor REAL contra el almacén en memoria: es lo que hace que el techo
    // de 64 KiB se ejercite. Un `saveCheckpoint` simulado devolvería `written`
    // pase lo que pase y el caso de regresión no probaría nada.
    saveCheckpoint: async (batchId, checkpoint) => {
      recorder.checkpoints.push(checkpoint);
      const outcome = await writeTwoRoundCheckpoint(batchId, checkpoint, store.client, {
        now: () => '2026-09-17T00:00:00.000Z',
      });
      recorder.checkpointOutcomes.push(outcome);
      if (outcome.kind === 'written') {
        // Sólo el PRIMERO de cada motivo: la ronda 2 vuelve a cerrar una
        // búsqueda y sobrescribiría el documento que el reintento debe leer.
        if (!recorder.storedByReason.has(checkpoint.checkpoint_reason)) {
          recorder.storedByReason.set(
            checkpoint.checkpoint_reason,
            store.read()[APOLLO_TWO_ROUND_CHECKPOINT_KEY] as ApolloTwoRoundCheckpointV1,
          );
        }
      }
      return outcome;
    },
    resolveConfig: () => defaultApolloTwoRoundConfig(),
  };

  return {
    deps,
    recorder,
    readStored: () =>
      (store.read()[APOLLO_TWO_ROUND_CHECKPOINT_KEY] as ApolloTwoRoundCheckpointV1 | undefined) ??
      null,
  };
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
    triggeredByUserId: 'user-x67',
    ownerId: 'user-x67',
    correlation: CORRELATION,
    runCorrelationMetadata: RUN_CORRELATION_METADATA,
    extraBatchMetadata: null,
    reservedCredits: 12,
    ...overrides,
  };
}

function checkpointFor(
  recorder: Recorder,
  reason: ApolloTwoRoundCheckpointV1['checkpoint_reason'],
): ApolloTwoRoundCheckpointV1 {
  const found = recorder.checkpoints.find(
    (checkpoint) => checkpoint.checkpoint_reason === reason,
  );
  assert.ok(found, `se esperaba un checkpoint de ${reason}`);
  return found;
}

// ─── Checkpoints sintéticos ───────────────────────────────────────────────────

function baseCheckpoint(): ApolloTwoRoundCheckpointV1 {
  return {
    version: 1,
    checkpoint_version: 1,
    checkpoint_updated_at: null,
    checkpoint_reason: 'search_round_completed',
    idempotency_key: CORRELATION.idempotencyKey,
    request_fingerprint: CORRELATION.requestFingerprint,
    wizard_run_id: CORRELATION.wizardRunId,
    config: defaultApolloTwoRoundConfig(),
    completed_operation_keys: ['apollo:organizations_search:round-1'],
    indeterminate_operation_keys: [],
    seen_organization_keys: [],
    round_summaries: [],
    candidate_snapshots: [],
    pending_organizations: [],
    pending_organization_tallies: [],
    enrichment_snapshots: [],
    recorded_operation_credits: [],
    persisted_candidate_ids: [],
    candidates_persisted: false,
    observed_rejection_reasons: [],
    second_round_skipped_reason: null,
    totals: { raw_results: 0, search_credits: 1, enrichment_credits: 0, enrichments_executed: 0 },
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
}

/** El documento que el constructor entrega tras una página de `size`. */
function pendingOnlyCheckpoint(size: number): ApolloTwoRoundCheckpointV1 {
  const pending: ApolloTwoRoundPendingOrganizationSnapshot[] = largePage(size).map(
    (result, index) => ({
      round_number: 1,
      provider_rank: index + 1,
      provider_organization_id:
        (result.metadata?.['apollo_organization_id'] as string) ?? null,
      name: result.title,
      domain: (result.metadata?.['domain'] as string) ?? null,
      linkedin_url: null,
      declared_industry: (result.metadata?.['industry'] as string) ?? null,
      evidence: toCandidateEvidenceSnapshot(result),
    }),
  );
  return {
    ...baseCheckpoint(),
    pending_organizations: pending,
    pending_organization_tallies: [{ round_number: 1, returned: size, retained: size }],
  };
}

/** Un candidato VIVO: elegible, sin enrichment y pendiente de persistir. */
function eligibleCandidateSnapshot(): ApolloTwoRoundCandidateSnapshot {
  const result = pageOrganization(1, 'CO');
  return {
    candidate_key: 'apollo:vivo-1',
    round_number: 1,
    provider_rank: 1,
    provider_organization_id: 'vivo-1',
    normalized_name: 'supermercado regional 1',
    normalized_domain: 'supermercadoregional1.com.co',
    normalized_linkedin_url: null,
    sector_evidence_state: 'sector_evidence_confirmed',
    rejection_reason: null,
    eligible: true,
    became_eligible_after_enrichment: false,
    finally_rejected_or_duplicated: false,
    no_prior_suggestion: true,
    enrichment_status: 'not_attempted',
    ranking_signals: {
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 3,
      novel: true,
      hasCompanySizeSignal: true,
      hasLocationSignal: true,
      hasLinkedInUrl: false,
      freeOfContradictoryEvidence: true,
      knownDuplicate: false,
      cooldownActive: false,
    },
    evidence: toCandidateEvidenceSnapshot(result),
  };
}

/**
 * El techo ANTERIOR a X6.7. No se importa de ninguna parte a propósito: es el
 * número histórico contra el que la E2E X6.6 falló, y queda aquí escrito para
 * que el caso de regresión demuestre que lo supera.
 */
const PRE_X67_CHECKPOINT_CEILING_BYTES = 64 * 1024;

/** Un candidato ya rechazado y SIN evidencia: el estado mínimo irreducible. */
function rejectedCandidateShell(index: number): ApolloTwoRoundCandidateSnapshot {
  return {
    ...eligibleCandidateSnapshot(),
    candidate_key: `apollo:6612aa0f9b1c4d00018a${String(index).padStart(4, '0')}`,
    provider_rank: index,
    provider_organization_id: `6612aa0f9b1c4d00018a${String(index).padStart(4, '0')}`,
    normalized_name: `supermercado regional ${index}`,
    normalized_domain: `supermercadoregional${index}.com.co`,
    rejection_reason: 'country_incompatible',
    eligible: false,
    finally_rejected_or_duplicated: true,
    evidence: null,
  };
}

// ─── 1 · caso de regresión obligatorio: 98 organizations ─────────────────────

describe('X6.7 · una página grande ya no rompe la durabilidad del checkpoint', () => {
  for (const size of [98, 100, 150]) {
    test(`una página de ${size} organizations cierra search_round_completed y persiste`, async () => {
      const page = largePage(size);
      const { deps, recorder, readStored } = buildHarness({
        rounds: [searchOutput(page, 1), searchOutput([], 0)],
      });

      const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

      const attempted = checkpointFor(recorder, 'search_round_completed');

      // (a) El fixture reproduce la condición de la E2E X6.6: con las `size`
      //     organizaciones dentro, el documento supera el techo ANTERIOR. Sin
      //     esta comprobación un fixture ligero dejaría el caso verde sin
      //     ejercitar nada.
      assert.ok(
        measureCheckpointSerializedBytes(attempted) > PRE_X67_CHECKPOINT_CEILING_BYTES,
        `con las ${size} organizaciones dentro el checkpoint superaba el techo anterior`,
      );

      // (b) Y ahora TODAS las escrituras de la corrida son durables. Ésta es la
      //     escritura que la E2E X6.6 vio fallar con
      //     `…:search_round_completed:too_large`.
      assert.deepEqual(
        recorder.checkpointOutcomes.filter((outcome) => outcome.kind !== 'written'),
        [],
        'ninguna escritura de checkpoint falla',
      );

      // (c) La búsqueda pagada queda COMPLETADA, no indeterminada.
      assert.equal(attempted.completed_operation_keys.length, 1);
      assert.deepEqual(attempted.indeterminate_operation_keys, []);
      assert.deepEqual(attempted.checkpoint_write_failures, []);

      // (d) Y la corrida entera tampoco degrada.
      const last = recorder.checkpoints.at(-1) as ApolloTwoRoundCheckpointV1;
      assert.deepEqual(last.checkpoint_write_failures, []);
      assert.equal(last.manual_reconciliation_required, false);
      assert.deepEqual(
        output.warnings.filter((warning) =>
          warning.startsWith('two_round_checkpoint_persist_failed'),
        ),
        [],
        'sin avisos de checkpoint no durable',
      );
      assert.ok(
        !(output.budgetAnomalies ?? []).includes('apollo_operation_indeterminate'),
        'sin anomalía de operación indeterminada',
      );

      assert.ok(recorder.observability, 'la corrida llegó al writer con su observabilidad');
      assert.notEqual(
        recorder.observability['result_status'],
        'apollo_operation_indeterminate',
        'result_status deja de ser apollo_operation_indeterminate',
      );
      assert.deepEqual(recorder.observability['checkpoint_write_failures'], []);

      // (e) La corrida sigue produciendo candidatos.
      assert.equal(
        recorder.writtenCandidateNames.length,
        PERSISTIBLE_PER_PAGE,
        'las organizaciones colombianas de la página se persisten igual',
      );

      // (f) Y lo almacenado cabe bajo el techo vigente.
      const stored = readStored();
      assert.ok(stored, 'hay un checkpoint almacenado');
      assert.ok(
        measureCheckpointSerializedBytes(stored) <=
          APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
      );
    });
  }
});

// ─── 2 · por qué el techo se re-derivó ───────────────────────────────────────

describe('X6.7 · el techo tiene premisa otra vez', () => {
  test('el estado MÍNIMO de 98 candidatos, sin una sola descripción, no cabía en 64 KiB', () => {
    const shells = Array.from({ length: 98 }, (_v, index) => rejectedCandidateShell(index + 1));
    const checkpoint: ApolloTwoRoundCheckpointV1 = {
      ...baseCheckpoint(),
      checkpoint_reason: 'round_assessment_completed',
      candidate_snapshots: shells,
    };
    // Ninguno lleva evidencia: la etapa 1 de § 6 ya la habría soltado. Lo que
    // queda es identidad, veredicto y señales — nada que se pueda soltar sin
    // perder la reanudación. Bajo el techo anterior no cabía.
    assert.ok(
      measureCheckpointSerializedBytes(checkpoint) > PRE_X67_CHECKPOINT_CEILING_BYTES,
      'el techo de 64 KiB no daba ni para el estado mínimo de una página',
    );
    assert.ok(
      measureCheckpointSerializedBytes(checkpoint) <=
        APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
      'y bajo el techo re-derivado sí cabe',
    );
  });

  test('el techo se deriva del contrato de paginación, no de un número suelto', () => {
    assert.equal(
      APOLLO_TWO_ROUND_MAX_RECOVERABLE_ORGANIZATIONS_PER_RUN,
      MAX_SEARCH_ROUNDS_ABSOLUTE_MAX *
        WIZARD_APOLLO_MAX_PAGES_HARD_CAP *
        APOLLO_CONTRACT_MAX_PER_PAGE,
    );
    assert.equal(
      APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
      APOLLO_TWO_ROUND_MAX_RECOVERABLE_ORGANIZATIONS_PER_RUN *
        APOLLO_TWO_ROUND_CHECKPOINT_BYTES_PER_ORGANIZATION,
    );
  });
});

// ─── 3 · reanudación: la operación completada no se repite ───────────────────

describe('X6.7 · el checkpoint sigue sirviendo para reanudar', () => {
  test('un reintento no vuelve a buscar y recupera lo pagado en vez de dar la ronda por vacía', async () => {
    const first = buildHarness({ rounds: [searchOutput(largePage(98), 1), searchOutput([], 0)] });
    await runApolloTwoRoundWizardDiscovery(runInput(), first.deps);

    // Lo que el reintento leería es el documento REALMENTE ALMACENADO tras la
    // búsqueda, no el que el constructor intentó escribir.
    const storedAfterSearch = first.recorder.storedByReason.get('search_round_completed');
    assert.ok(storedAfterSearch, 'la búsqueda dejó un documento almacenado');
    assert.equal(storedAfterSearch.completed_operation_keys.length, 1);
    assert.equal(storedAfterSearch.pending_organizations.length, 98);
    assert.deepEqual(storedAfterSearch.pending_organization_tallies, [
      { round_number: 1, returned: 98, retained: 98 },
    ]);

    const retry = buildHarness({
      rounds: [searchOutput([], 0), searchOutput([], 0)],
      loadCheckpoint: async () => storedAfterSearch,
    });
    const output = await runApolloTwoRoundWizardDiscovery(runInput(), retry.deps);

    assert.ok(
      !retry.recorder.searchRounds.includes(1),
      'la ronda 1 ya se pagó: el reintento no la repite',
    );
    assert.equal(
      retry.recorder.writtenCandidateNames.length,
      PERSISTIBLE_PER_PAGE,
      'las organizaciones se recuperan y se persisten, no se dan por cero',
    );
    assert.deepEqual(
      retry.recorder.checkpointOutcomes.filter((outcome) => outcome.kind !== 'written'),
      [],
      'y el reintento tampoco falla al escribir',
    );
    assert.ok(!(output.budgetAnomalies ?? []).includes('apollo_operation_indeterminate'));
  });
});

// ─── 4 · contrato de la etapa 3 de compactación ──────────────────────────────

describe('X6.7 · compactCheckpointForSize · organizaciones pendientes', () => {
  test('una lista que cabe no se toca, y no se declara una compactación falsa', () => {
    const checkpoint = pendingOnlyCheckpoint(98);
    const result = compactCheckpointForSize(checkpoint);
    assert.equal(result.withinLimit, true);
    assert.equal(result.checkpoint.pending_organizations.length, 98);
    assert.equal(result.checkpoint.compacted, false);
    assert.deepEqual(result.checkpoint.pending_organization_tallies, [
      { round_number: 1, returned: 98, retained: 98 },
    ]);
  });

  test('a escala del contrato de paginación, la etapa 3 acota y lo declara', () => {
    // 1.000 organizaciones es el máximo que el contrato permite recuperar
    // (2 rondas × 5 páginas × 100). Con evidencia completa no caben, y ahí es
    // donde la etapa 3 tiene que actuar.
    const checkpoint = pendingOnlyCheckpoint(1000);
    assert.ok(
      measureCheckpointSerializedBytes(checkpoint) >
        APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
    );

    const result = compactCheckpointForSize(checkpoint);
    assert.equal(result.withinLimit, true);
    assert.ok(result.checkpoint.pending_organizations.length < 1000, 'algo tuvo que soltarse');
    assert.ok(result.checkpoint.pending_organizations.length > 0, 'y algo tuvo que quedarse');
    assert.equal(result.checkpoint.compacted, true, 'la compactación queda declarada');
    assert.deepEqual(result.checkpoint.pending_organization_tallies, [
      {
        round_number: 1,
        returned: 1000,
        retained: result.checkpoint.pending_organizations.length,
      },
    ]);
  });

  test('lo conservado es el PREFIJO del proveedor, con identidad y evidencia juntas', () => {
    const original = pendingOnlyCheckpoint(1000).pending_organizations;
    const kept = compactCheckpointForSize(pendingOnlyCheckpoint(1000)).checkpoint
      .pending_organizations;

    assert.deepEqual(kept, original.slice(0, kept.length), 'nada se suelta del medio');
    for (const pending of kept) {
      // Una identidad sin evidencia haría que el reintento la evaluara como
      // `invalid_domain`: un veredicto que la corrida nunca alcanzó. Preferimos
      // no saber de ella a mentir sobre ella.
      assert.ok(pending.provider_organization_id, 'identidad del proveedor');
      assert.ok(pending.domain, 'dominio');
      assert.ok(pending.evidence, 'evidencia mínima');
      assert.ok(pending.evidence.short_description, 'y la evidencia va completa');
    }
  });

  test('la cota la fija el techo, no el número de organizaciones de la página', () => {
    const tight = compactCheckpointForSize(
      pendingOnlyCheckpoint(150),
      PRE_X67_CHECKPOINT_CEILING_BYTES,
    );
    const roomy = compactCheckpointForSize(
      pendingOnlyCheckpoint(150),
      PRE_X67_CHECKPOINT_CEILING_BYTES * 2,
    );
    assert.equal(tight.withinLimit, true);
    assert.equal(roomy.withinLimit, true);
    assert.ok(
      roomy.checkpoint.pending_organizations.length >
        tight.checkpoint.pending_organizations.length,
      'con más techo se conservan más: la cota no es un número fijo',
    );
    assert.equal(tight.checkpoint.pending_organization_tallies[0].returned, 150);
    assert.equal(roomy.checkpoint.pending_organization_tallies[0].returned, 150);
  });

  test('la evidencia de un candidato elegible pendiente de persistir NO se suelta', () => {
    const checkpoint: ApolloTwoRoundCheckpointV1 = {
      ...pendingOnlyCheckpoint(150),
      candidate_snapshots: [eligibleCandidateSnapshot()],
    };
    const result = compactCheckpointForSize(checkpoint, PRE_X67_CHECKPOINT_CEILING_BYTES);
    assert.equal(result.withinLimit, true);
    assert.ok(
      result.checkpoint.candidate_snapshots[0].evidence,
      'el candidato vivo conserva su evidencia: la etapa 3 sacrifica antes lo pendiente',
    );
  });
});

// ─── 5 · el fail-closed del escritor NO se relaja ────────────────────────────

describe('X6.7 · un documento que no cabe sigue sin declararse durable', () => {
  test('too_large no escribe nada y no se hace pasar por escrito', async () => {
    const store = memoryStore();

    // Techo por debajo del estado operativo mínimo: ni soltando TODAS las
    // pendientes cabe. Es el caso que debe seguir fallando cerrado.
    const outcome = await writeTwoRoundCheckpoint(
      CORRELATION.batchId,
      pendingOnlyCheckpoint(98),
      store.client,
      { now: () => '2026-09-17T00:00:00.000Z', maxBytes: 64 },
    );

    assert.equal(outcome.kind, 'too_large');
    assert.equal(store.updates, 0, 'no se escribe un documento que no cabe');
    assert.equal(store.read()[APOLLO_TWO_ROUND_CHECKPOINT_KEY], undefined);
  });
});
