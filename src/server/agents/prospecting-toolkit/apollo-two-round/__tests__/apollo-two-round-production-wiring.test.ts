/**
 * apollo-two-round-production-wiring.test.ts — La modalidad, atravesada por sus
 * puntos de entrada REALES.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FIX · § 10.
 *
 * A diferencia de la suite pura, aquí se ejecuta:
 *
 *   runWizardApolloSearch            (el executor del wizard)
 *   runApolloTwoRoundWizardDiscovery (el adaptador de producción)
 *   runApolloTwoRoundDiscovery       (el orquestador, invocado por el adaptador)
 *   evaluateApolloEnrichmentEligibility / evaluateApolloSectorRelevanceForPaidOperation
 *                                    (los gates reales, sin dobles)
 *
 * Todo offline: el proveedor, el writer y las consultas de duplicados entran por
 * inyección. LIVE_APOLLO_CALLS = 0 y APOLLO_CREDITS_USED = 0 por construcción —
 * ninguna de las dependencias inyectadas abre un socket.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  toCheapRejectionReason,
  toSectorEvidenceState,
  readDuplicateVerdict,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import type { ApolloTwoRoundCheckpointV1 } from '../checkpoint';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../observability';
import { estimateApolloTwoRoundBudget, defaultApolloTwoRoundConfig } from '../index';
import { runWizardApolloSearch } from '@/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor';
import { estimateCreditsForProvider } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-estimate';
import { captureApolloCompanyFields } from '../../apollo-company-fields-mapping';
import type {
  ProspectingPipelineCandidate,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';

// ─── Fixtures de producción ───────────────────────────────────────────────────

/** Reloj fijo: el orquestador es puro y estas pruebas no pueden depender del real. */
const FIXTURE_OBSERVED_AT = '2026-08-10T00:00:00.000Z';

const CORRELATION = {
  wizardRunId: 'run-1',
  clientRequestId: 'client-1',
  batchId: 'batch-1',
  reservationId: 'reservation-1',
  requestFingerprint: 'fingerprint-1',
  idempotencyKey: 'idempotency-1',
};

/** Una organización tal como el provider Apollo la entrega ya normalizada. */
function apolloResult(options: {
  id: string;
  name: string;
  domain: string;
  industry?: string;
  snippet?: string;
  rank?: number;
  employees?: number;
  /**
   * STABLE-TARGET-WRITER-PARITY § 6 — `null` reproduce a una empresa SIN
   * LinkedIn, que el contrato de completitud deja fuera del objetivo. Por
   * omisión el fixture lo trae: estos casos describen candidatas COMPLETAS.
   */
  linkedinUrl?: string | null;
}): WebSearchResult {
  const linkedinUrl =
    options.linkedinUrl === undefined
      ? `https://www.linkedin.com/company/${options.id}`
      : options.linkedinUrl;
  return {
    title: options.name,
    url: `https://${options.domain}`,
    snippet: options.snippet ?? null,
    source: 'apollo_organizations',
    rank: options.rank ?? 1,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: options.id,
      domain: options.domain,
      industry: options.industry ?? null,
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: options.employees ?? 500,
      estimated_num_employees: options.employees ?? 500,
      ...(linkedinUrl === null ? {} : { linkedin_url: linkedinUrl }),
      apollo_profile: { industry: options.industry ?? null, industries: [] },
    },
  };
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

/** Candidato del pipeline con el veredicto de duplicado que el test necesita. */
function pipelineCandidate(
  result: WebSearchResult,
  duplicate: 'none' | 'sellup' | 'hubspot',
): ProspectingPipelineCandidate {
  const domain = (result.metadata?.['domain'] as string) ?? null;
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
      status: duplicate === 'none' ? 'new_candidate' : `existing_in_${duplicate}`,
      confidence: duplicate === 'none' ? 0 : 95,
      input: { name: result.title, domain },
      matches:
        duplicate === 'none'
          ? []
          : [
              {
                source: duplicate,
                status: `existing_in_${duplicate}`,
                confidence: 95,
                matchedDomain: domain,
                reason: 'test fixture',
              },
            ],
      summary: 'test',
      checkedSources: ['sellup', 'hubspot'],
    } as ProspectingPipelineCandidate['duplicateCheck'],
    scoring: {
      qualityLabel: 'high_quality_new',
    } as ProspectingPipelineCandidate['scoring'],
    // STABLE-TARGET-WRITER-PARITY § 1 — el doble tiene que producir lo MISMO que
    // `buildCandidateFromResult`: la captura de LinkedIn y `employee_count` viaja
    // con el candidato. Sin ella, el contrato canónico lee `mapping_failed` —
    // correcto y fail-closed, pero convierte a estos fixtures en candidatas
    // incompletas y ninguna prueba de «objetivo alcanzado» podría alcanzarlo.
    providerCompanyFields,
    companyLinkedInUrl: providerCompanyFields.linkedin.companyLinkedInUrl,
    ...(providerCompanyFields.employeeCount.status === 'confirmed'
      ? { employeeCount: providerCompanyFields.employeeCount.employeeCount }
      : {}),
  };
}

type Recorder = {
  searchCalls: number;
  enrichCalls: number;
  requestedLimits: number[];
  persistedCandidateNames: string[];
  savedCheckpoints: ApolloTwoRoundCheckpointV1[];
};

function buildDeps(options: {
  rounds: WebSearchOutput[];
  duplicates?: Record<string, 'sellup' | 'hubspot'>;
  /** Dominios que el enrichment confirma como del sector. */
  enrichmentConfirms?: string[];
  loadCheckpoint?: ApolloTwoRoundProductionDeps['loadCheckpoint'];
}): { deps: Partial<ApolloTwoRoundProductionDeps>; recorder: Recorder } {
  const recorder: Recorder = {
    searchCalls: 0,
    enrichCalls: 0,
    requestedLimits: [],
    persistedCandidateNames: [],
    savedCheckpoints: [],
  };

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo: (async (_input: unknown, maxResults: number) => {
      recorder.requestedLimits.push(maxResults);
      const output = options.rounds[recorder.searchCalls] ?? searchOutput([], 0);
      recorder.searchCalls++;
      return output;
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => {
      const domain = (result.metadata?.['domain'] as string) ?? '';
      const duplicate = options.duplicates?.[domain] ?? 'none';
      return { candidate: pipelineCandidate(result, duplicate), nameQualityFiltered: false };
    }) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    enrichCascade: (async (results: WebSearchResult[]) => {
      recorder.enrichCalls++;
      const result = results[0];
      const domain = (result.metadata?.['domain'] as string) ?? '';
      const confirms = options.enrichmentConfirms?.includes(domain) ?? false;
      const enriched: WebSearchResult = confirms
        ? {
            ...result,
            snippet: `${result.snippet ?? ''} supermercado autoservicio grocery`,
          }
        : result;
      return {
        results: [enriched],
        meta: {
          enabled: true,
          cascade_version: 'test',
          entries: [{ domain, enriched: true, fields_added: [] }],
        },
      };
    }) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
    }) => {
      recorder.persistedCandidateNames = writerInput.pipelineOutput.candidates.map((c) => c.name);
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
      recorder.savedCheckpoints.push(checkpoint);
      return {
        kind: 'written',
        checkpointVersion: checkpoint.checkpoint_version,
        serializedBytes: 0,
        compacted: false,
      };
    },
    // Pricing vivo inyectado: sin él el enrichment quedaría prohibido y las
    // pruebas de enrichment no podrían ejercitarlo.
    loadEnrichmentUnitCostUsd: async () => 0.02,
    enrichOrganization: (async () => ({ success: true, data: undefined })) as never,
    logEnrichmentUsage: (async () => ({ kind: 'logged' as const })) as never,
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
    runCorrelationMetadata: null,
    extraBatchMetadata: null,
    reservedCredits: 12,
    ...overrides,
  };
}

/** Un supermercado que las señales gratuitas ya confirman. */
function confirmedSupermarket(index: number): WebSearchResult {
  return apolloResult({
    id: `org-confirmed-${index}`,
    name: `Supermercado Uno ${index}`,
    // § 5 — el dominio acredita al nombre. Con `supermercado${index}.com.co` el
    // gate de ownership —el mismo que aplica el writer— rechazaba al candidato,
    // así que la corrida no podía persistirlo de verdad.
    domain: `supermercadouno${index}.com.co`,
    industry: 'retail',
    snippet: 'cadena de supermercados y autoservicio con tiendas de abarrotes',
    rank: index,
  });
}

// ─── 1-2 · qué runner elige el executor ───────────────────────────────────────

describe('§ 10 · el executor enruta según el flag', () => {
  const previous = process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
  afterEach(() => {
    if (previous === undefined) delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    else process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = previous;
  });

  const executorInput = {
    resolved: {
      userId: 'user-1',
      clientRequestId: 'client-1',
      mode: 'exploratory' as const,
      country: { code: 'CO', name: 'Colombia' },
      catalog: { version: 'v1' },
      industry: { id: 'i1', slug: 'supermercados', name: 'Supermercados e Hipermercados' },
      subindustries: [],
      additionalCriteria: null,
      systemControls: { targetCount: 10, minimumEmployees: 200, employeeThresholdMode: 'soft' },
    },
    reservedBatchId: CORRELATION.batchId,
    correlation: CORRELATION,
    reservedCredits: 12,
  } as unknown as Parameters<typeof runWizardApolloSearch>[0];

  test('caso 1 — flag OFF: se ejecuta el runner incremental legacy, no el orquestador', async () => {
    process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'false';
    let legacyCalls = 0;
    let twoRoundCalls = 0;

    await runWizardApolloSearch(
      executorInput,
      (async (legacyInput: { maxRounds: number; targetInternal: number }) => {
        legacyCalls++;
        // Los controles legacy siguen gobernando la ruta legacy.
        assert.equal(legacyInput.maxRounds, 4);
        assert.equal(legacyInput.targetInternal, 25);
        return { batchId: CORRELATION.batchId, candidates: [] };
      }) as never,
      (async () => {
        twoRoundCalls++;
        return {} as never;
      }) as never,
    );

    assert.equal(legacyCalls, 1);
    assert.equal(twoRoundCalls, 0);
  });

  test('caso 2 — flag ON: se ejecuta runApolloTwoRoundDiscovery, no el runner legacy', async () => {
    process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'true';
    let legacyCalls = 0;
    let twoRoundCalls = 0;

    await runWizardApolloSearch(
      executorInput,
      (async () => {
        legacyCalls++;
        return {} as never;
      }) as never,
      (async (twoRoundInput: ApolloTwoRoundWizardRunInput) => {
        twoRoundCalls++;
        assert.equal(twoRoundInput.reservedBatchId, CORRELATION.batchId);
        assert.equal(twoRoundInput.correlation.idempotencyKey, CORRELATION.idempotencyKey);
        assert.equal(twoRoundInput.reservedCredits, 12);
        return {} as never;
      }) as never,
    );

    assert.equal(twoRoundCalls, 1);
    assert.equal(legacyCalls, 0);
  });

  test('sin correlación la modalidad no se ejecuta: fail-closed, nunca degrada a legacy', async () => {
    process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'true';
    let legacyCalls = 0;
    await assert.rejects(
      () =>
        runWizardApolloSearch(
          { ...executorInput, correlation: null } as never,
          (async () => {
            legacyCalls++;
            return {} as never;
          }) as never,
        ),
      /apollo_two_round_requires_run_correlation/,
    );
    assert.equal(legacyCalls, 0);
  });
});

// ─── 3-4 · rondas efectivas ───────────────────────────────────────────────────

describe('§ 10 · rondas reales a través del adaptador de producción', () => {
  test('caso 3 — la ronda 1 reúne cinco: una sola petición al proveedor', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([1, 2, 3, 4, 5].map(confirmedSupermarket), 5),
        searchOutput([], 0),
      ],
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.searchCalls, 1);
    assert.equal(output.candidatesCreated, 5);
    assert.equal(output.targetReached, true);
  });

  test('caso 4 — tres en la ronda 1 y dos en la ronda 2 completan las cinco', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([1, 2, 3].map(confirmedSupermarket), 3),
        searchOutput([4, 5].map(confirmedSupermarket), 2),
      ],
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.searchCalls, 2);
    assert.equal(output.candidatesCreated, 5);
    assert.equal(output.targetReached, true);
    assert.equal(recorder.persistedCandidateNames.length, 5);
  });

  test('caso 15 — nunca hay una tercera ronda, aunque el objetivo no se alcance', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([confirmedSupermarket(1)], 1),
        searchOutput([confirmedSupermarket(2)], 1),
        searchOutput([confirmedSupermarket(3)], 1),
      ],
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.searchCalls, 2);
    assert.equal(output.targetReached, false);
  });

  test('caso 13 — las dos rondas aparecen en la observabilidad real del lote', async () => {
    const { deps } = buildDeps({
      rounds: [
        searchOutput([1, 2].map(confirmedSupermarket), 2),
        searchOutput([3, 4].map(confirmedSupermarket), 2),
      ],
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const observability = (output.metadata as Record<string, unknown>)[
      APOLLO_TWO_ROUND_OBSERVABILITY_KEY
    ] as Record<string, unknown>;
    const rounds = observability['rounds'] as Array<Record<string, unknown>>;

    assert.equal(rounds.length, 2);
    for (const round of rounds) {
      for (const field of [
        'round_number',
        'query_hypothesis',
        'adaptation_reason',
        'raw_results',
        'new_unique_results',
        'eligible_results',
        'credits',
      ]) {
        assert.ok(field in round, `falta ${field} en la observabilidad de la ronda`);
      }
    }
    // La ronda 1 no adapta nada; la 2 declara por qué difiere.
    assert.equal(rounds[0]['adaptation_reason'], null);
    assert.notEqual(rounds[1]['adaptation_reason'], null);

    const runMetrics = observability['run_metrics'] as Record<string, unknown>;
    assert.equal(runMetrics['total_search_credits'], 4);
  });
});

// ─── 5-6 · dedupe y cap de enrichment ─────────────────────────────────────────

describe('§ 10 · duplicados y enrichment', () => {
  test('caso 5 — citi.com ya conocido se descarta antes del enrichment: 0 llamadas, 0 créditos', async () => {
    const citi = apolloResult({
      id: 'org-citi',
      name: 'Citigroup',
      domain: 'citi.com',
      industry: 'retail banking',
      snippet: 'banca minorista',
    });
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput([citi], 1), searchOutput([], 0)],
      duplicates: { 'citi.com': 'sellup' },
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.enrichCalls, 0);
    assert.equal(output.candidatesCreated, 0);

    const observability = (output.metadata as Record<string, unknown>)[
      APOLLO_TWO_ROUND_OBSERVABILITY_KEY
    ] as Record<string, unknown>;
    const runMetrics = observability['run_metrics'] as Record<string, unknown>;
    assert.equal(runMetrics['total_enrichment_credits'], 0);
    assert.equal(runMetrics['enrichments_executed'], 0);
  });

  test('un duplicado en HubSpot tampoco llega a competir por un enrichment', async () => {
    const ambiguous = apolloResult({
      id: 'org-hs',
      name: 'Cadena Ambigua',
      domain: 'ambigua.com.co',
      industry: 'retail',
    });
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput([ambiguous], 1), searchOutput([], 0)],
      duplicates: { 'ambigua.com.co': 'hubspot' },
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(recorder.enrichCalls, 0);
  });

  test('caso 6 — el cap de dos enrichments es GLOBAL para las dos rondas', async () => {
    const ambiguous = (index: number) =>
      apolloResult({
        id: `org-amb-${index}`,
        name: `Cadena ${index}`,
        domain: `cadena${index}.com.co`,
        industry: 'retail',
        rank: index,
      });

    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([1, 2, 3].map(ambiguous), 3),
        searchOutput([4, 5].map(ambiguous), 2),
      ],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(recorder.enrichCalls, 2);
  });

  test('la misma organización repetida entre rondas no se procesa ni se enriquece dos veces', async () => {
    const repeated = apolloResult({
      id: 'org-repeat',
      name: 'Cadena Repetida',
      domain: 'repetida.com.co',
      industry: 'retail',
    });
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput([repeated], 1), searchOutput([repeated], 1)],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    // Un solo enrichment aunque la organización llegó dos veces.
    assert.equal(recorder.enrichCalls, 1);
  });

  test('el enrichment que confirma el sector convierte al candidato en elegible', async () => {
    const ambiguous = apolloResult({
      id: 'org-amb',
      name: 'Cadena Por Confirmar',
      domain: 'porconfirmar.com.co',
      industry: 'retail',
    });
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput([ambiguous], 1), searchOutput([], 0)],
      enrichmentConfirms: ['porconfirmar.com.co'],
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(recorder.enrichCalls, 1);
    assert.equal(output.candidatesCreated, 1);
  });
});

// ─── 7-8 · presupuesto y límites ──────────────────────────────────────────────

describe('§ 10 · presupuesto y ejecución comparten límites', () => {
  const previousFlag = process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
  const legacyEnvKeys = [
    'AGENT1_APOLLO_MAX_QUERIES_PER_RUN',
    'AGENT1_APOLLO_MAX_RESULTS_PER_QUERY',
  ];
  const previousLegacy: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of legacyEnvKeys) previousLegacy[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of legacyEnvKeys) {
      if (previousLegacy[key] === undefined) delete process.env[key];
      else process.env[key] = previousLegacy[key];
    }
    if (previousFlag === undefined) delete process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY;
    else process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = previousFlag;
  });

  test('caso 7 — la reserva y la ejecución salen de la MISMA configuración', async () => {
    process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'true';
    const reserved = estimateCreditsForProvider('apollo_organizations');
    assert.equal(reserved, estimateApolloTwoRoundBudget(defaultApolloTwoRoundConfig())
      .maximumInternalRecordedCredits);
    assert.equal(reserved, 12);

    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([1, 2].map(confirmedSupermarket), 2),
        searchOutput([3].map(confirmedSupermarket), 1),
      ],
    });
    await runApolloTwoRoundWizardDiscovery(runInput({ reservedCredits: reserved }), deps);

    // Cada ronda pidió exactamente `maxResultsPerRound`, no el cap legacy.
    assert.deepEqual(recorder.requestedLimits, [5, 5]);
  });

  test('caso 8 — una configuración legacy alta NO amplía la modalidad de dos rondas', async () => {
    process.env.ENABLE_APOLLO_TWO_ROUND_DISCOVERY = 'true';
    process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = '3';
    process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = '5';

    // El estimado sigue siendo el de dos rondas, no el legacy (3 × 5 = 15).
    assert.equal(estimateCreditsForProvider('apollo_organizations'), 12);

    const { deps, recorder } = buildDeps({
      rounds: [
        searchOutput([confirmedSupermarket(1)], 1),
        searchOutput([confirmedSupermarket(2)], 1),
        searchOutput([confirmedSupermarket(3)], 1),
      ],
    });
    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.searchCalls, 2, 'tres rondas legacy no habilitan una tercera ronda');
    assert.deepEqual(recorder.requestedLimits, [5, 5]);
  });

  test('§ 2 — el gasto registrado por encima de la reserva levanta anomalía y detiene el gasto', async () => {
    const { deps, recorder } = buildDeps({
      rounds: [
        // La primera ronda ya registra más de lo reservado.
        searchOutput([1, 2, 3].map(confirmedSupermarket), 9),
        searchOutput([4, 5].map(confirmedSupermarket), 5),
      ],
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput({ reservedCredits: 3 }), deps);

    assert.deepEqual(output.budgetAnomalies, ['recorded_usage_exceeds_reservation']);
    const observability = (output.metadata as Record<string, unknown>)[
      APOLLO_TWO_ROUND_OBSERVABILITY_KEY
    ] as Record<string, unknown>;
    assert.deepEqual(observability['budget_anomalies'], ['recorded_usage_exceeds_reservation']);
    // La segunda búsqueda se emitió pero devolvió vacío sin llamar al proveedor.
    assert.equal(recorder.enrichCalls, 0);
  });

  test('el techo absoluto de organizaciones evaluadas es diez', async () => {
    const many = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        apolloResult({
          id: `org-${start + i}`,
          name: `Cadena ${start + i}`,
          domain: `cadena${start + i}.com.co`,
          industry: 'financial services',
          rank: i + 1,
        }),
      );

    let evaluated = 0;
    const { deps } = buildDeps({
      rounds: [searchOutput(many(1, 8), 8), searchOutput(many(9, 8), 8)],
    });
    const wrapped: Partial<ApolloTwoRoundProductionDeps> = {
      ...deps,
      buildCandidate: (async (...args: Parameters<NonNullable<typeof deps.buildCandidate>>) => {
        evaluated++;
        return deps.buildCandidate!(...args);
      }) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],
    };

    await runApolloTwoRoundWizardDiscovery(runInput(), wrapped);
    assert.ok(evaluated <= 10, `se evaluaron ${evaluated} organizaciones; el techo es 10`);
  });
});

// ─── 12 · recuperación de reintentos ──────────────────────────────────────────

describe('§ 10 · un reintento recupera lo que la ronda anterior produjo', () => {
  test('caso 12 — tras la ronda 1, el reintento no repite la búsqueda ni pierde candidatos', async () => {
    // Primer intento: la ronda 1 produce tres y se persisten.
    const first = buildDeps({
      rounds: [searchOutput([1, 2, 3].map(confirmedSupermarket), 3), searchOutput([], 0)],
    });
    const firstOutput = await runApolloTwoRoundWizardDiscovery(runInput(), first.deps);
    assert.equal(first.recorder.searchCalls, 2);
    assert.equal(firstOutput.candidatesCreated, 3);

    // El último checkpoint es el que un reintento leería.
    const savedCheckpoint = first.recorder.savedCheckpoints.at(-1) as ApolloTwoRoundCheckpointV1;
    assert.ok(savedCheckpoint.completed_operation_keys.length > 0);
    assert.equal(savedCheckpoint.candidate_snapshots.length, 3);
    assert.equal(savedCheckpoint.candidates_persisted, true);

    // Reintento con el mismo checkpoint: ninguna búsqueda nueva, mismos candidatos.
    const retry = buildDeps({
      rounds: [searchOutput([], 0), searchOutput([], 0)],
      loadCheckpoint: async () => savedCheckpoint,
    });
    const retryOutput = await runApolloTwoRoundWizardDiscovery(runInput(), retry.deps);

    assert.equal(retry.recorder.searchCalls, 0, 'un reintento no vuelve a buscar');
    assert.equal(retry.recorder.enrichCalls, 0, 'un reintento no vuelve a enriquecer');
    assert.equal(
      retry.recorder.persistedCandidateNames.length,
      0,
      'los candidatos ya persistidos no se vuelven a escribir',
    );
    assert.equal(
      retryOutput.candidatesCreated,
      3,
      'el reintento reporta los candidatos ya persistidos, no cero',
    );
  });

  test('un checkpoint de OTRA corrida se ignora: nunca se saltan operaciones ajenas', async () => {
    // `loadCheckpoint` recibe la identidad de la corrida y devuelve null cuando no
    // coincide — eso lo garantiza `readCheckpoint`, probado aparte. Aquí se
    // comprueba el efecto: la corrida arranca de cero.
    const { deps, recorder } = buildDeps({
      rounds: [searchOutput([1, 2].map(confirmedSupermarket), 2), searchOutput([], 0)],
      loadCheckpoint: async (_batchId, identity) =>
        identity.idempotencyKey === 'otra-corrida' ? ({} as ApolloTwoRoundCheckpointV1) : null,
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(recorder.searchCalls, 2, 'la corrida empieza de cero, no reutiliza estado ajeno');
  });
});

// ─── Traducciones ─────────────────────────────────────────────────────────────

describe('§ 10 · traducción de vocabularios del adaptador', () => {
  test('cada motivo del gate de elegibilidad tiene un destino y ninguno se inventa', () => {
    assert.equal(toCheapRejectionReason('country_mismatch'), 'country_incompatible');
    assert.equal(toCheapRejectionReason('tld_country_mismatch'), 'country_incompatible');
    assert.equal(toCheapRejectionReason('invalid_domain'), 'invalid_domain');
    assert.equal(toCheapRejectionReason('generic_or_mail_provider_domain'), 'invalid_domain');
    assert.equal(toCheapRejectionReason('inferred_domain_ownership_mismatch'), 'ownership_mismatch');
    assert.equal(toCheapRejectionReason('external_platform_domain'), 'external_platform_domain');
    assert.equal(toCheapRejectionReason('cooldown_active'), 'cooldown_or_prior_suggestion');
    assert.equal(
      toCheapRejectionReason('organization_already_processed'),
      'cooldown_or_prior_suggestion',
    );
    assert.equal(toCheapRejectionReason('sector_not_mapped'), 'sector_not_mapped');
    assert.equal(
      toCheapRejectionReason('sector_relevance_contradicted'),
      'sector_evidence_contradictory',
    );
  });

  test('el veredicto sectorial pagado se traduce a los cuatro estados del § 5', () => {
    assert.equal(toSectorEvidenceState('relevant'), 'sector_evidence_confirmed');
    assert.equal(
      toSectorEvidenceState('sector_evidence_missing_needs_enrichment'),
      'sector_evidence_missing_needs_enrichment',
    );
    assert.equal(
      toSectorEvidenceState('sector_relevance_contradicted'),
      'sector_evidence_contradictory',
    );
    assert.equal(toSectorEvidenceState('sector_not_mapped'), 'sector_not_mapped');
  });

  test('el duplicado se LEE del pipeline: no se consulta una segunda vez', () => {
    const result = apolloResult({ id: 'x', name: 'X', domain: 'x.com' });
    assert.deepEqual(readDuplicateVerdict(pipelineCandidate(result, 'none')), {
      sellUpDuplicate: false,
      hubSpotDuplicate: false,
    });
    assert.deepEqual(readDuplicateVerdict(pipelineCandidate(result, 'sellup')), {
      sellUpDuplicate: true,
      hubSpotDuplicate: false,
    });
    assert.deepEqual(readDuplicateVerdict(pipelineCandidate(result, 'hubspot')), {
      sellUpDuplicate: false,
      hubSpotDuplicate: true,
    });
  });
});
