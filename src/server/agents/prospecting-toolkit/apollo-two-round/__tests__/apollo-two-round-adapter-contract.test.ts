/**
 * apollo-two-round-adapter-contract.test.ts — El contrato que el ADAPTADOR de
 * producción pasa al proveedor, y el `per_page` que el proveedor envía de verdad.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2-FIX · § 5, § 6, § 7.
 *
 * Entra por los puntos de entrada REALES:
 *
 *   runApolloTwoRoundWizardDiscovery  (adaptador de producción)
 *   runApolloTwoRoundDiscovery        (orquestador, invocado por el adaptador)
 *   buildApolloOrganizationsEffectiveRequest (constructor real del request)
 *   runApolloOrganizationsSearch      (provider real, con transporte inyectado)
 *
 * Ningún test inyecta `searchRound` al orquestador: la costura es siempre la del
 * adaptador. El transporte HTTP se inyecta donde se ejercita el provider real, así
 * que ninguna prueba abre un socket.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../observability';
import {
  APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS,
  APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS,
} from '../../apollo-pre-writer-target-conditions';
import { defaultApolloTwoRoundConfig } from '../index';
import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
  type ApolloOrgsSearchOptions,
} from '../../web-search-providers/apollo-organizations-search-provider';
import type { ApolloPageFetchResult } from '../../apollo-organizations-paginated-search';
import type {
  ProspectingPipelineCandidate,
  WebSearchInput,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';
import type { ApolloTwoRoundCheckpointV1 } from '../checkpoint';
import { captureApolloCompanyFields } from '../../apollo-company-fields-mapping';
import {
  buildPublishedCatalogTermsResolution,
  CATALOG_VERSION,
} from '../../__tests__/fixtures/sellup-published-catalog-search-terms';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CORRELATION = {
  wizardRunId: 'run-adapter-1',
  clientRequestId: 'client-adapter-1',
  batchId: 'batch-adapter-1',
  reservationId: 'reservation-adapter-1',
  requestFingerprint: 'fingerprint-adapter-1',
  idempotencyKey: 'idempotency-adapter-1',
};

/** Reloj fijo: estas pruebas no pueden depender del real. */
const FIXTURE_OBSERVED_AT = '2026-08-10T00:00:00.000Z';

/** Un supermercado que las señales GRATUITAS ya confirman: no necesita enrichment. */
function supermarket(index: number): WebSearchResult {
  return {
    title: `Cadena de Supermercados ${index}`,
    url: `https://cadenadesupermercados${index}.com.co`,
    snippet: 'cadena de supermercados y autoservicio con tiendas de abarrotes',
    source: 'apollo_organizations',
    rank: index,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `org-super-${index}`,
      domain: `cadenadesupermercados${index}.com.co`,
      industry: 'retail',
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 800,
      estimated_num_employees: 800,
      // STABLE-TARGET-WRITER-PARITY § 6 — el contrato de completitud exige el
      // LinkedIn empresarial para contar hacia el objetivo. Estas cinco son
      // candidatas COMPLETAS, así que lo traen.
      linkedin_url: `https://www.linkedin.com/company/org-super-${index}`,
      apollo_profile: { industry: 'retail', industries: [] },
    },
  };
}

/**
 * Una organización de OTRO negocio: industria declarada contradictoria y ninguna
 * señal positiva de supermercado en el nombre ni en las keywords.
 *
 * El nombre importa: `evaluateApolloFreeSectorContradiction` desactiva la
 * contradicción cuando encuentra una señal positiva en la identidad declarada, y
 * llamar «Cadena de Supermercados» a un banco la desactivaría.
 */
function otherBusiness(index: number, industry: string, name: string): WebSearchResult {
  return {
    title: name,
    url: `https://empresa${index}.com.co`,
    snippet: `${industry} para grandes empresas`,
    source: 'apollo_organizations',
    rank: index,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `org-other-${index}`,
      domain: `empresa${index}.com.co`,
      industry,
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 900,
      estimated_num_employees: 900,
      keywords: [industry],
      linkedin_url: `https://www.linkedin.com/company/org-other-${index}`,
      apollo_profile: { industry, industries: [industry] },
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

function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const domain = (result.metadata?.['domain'] as string) ?? null;
  // § 1 — el doble reproduce lo que `buildCandidateFromResult` produce: la
  // captura de LinkedIn y `employee_count` viaja CON el candidato, que es de
  // donde el contrato canónico las lee.
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

type SearchCall = {
  input: WebSearchInput;
  maxResults: number;
  options: ApolloOrgsSearchOptions | undefined;
};

type Recorder = {
  searchCalls: SearchCall[];
  enrichCalls: number;
  writerCalls: number;
  writtenCandidateNames: string[][];
  savedCheckpoints: ApolloTwoRoundCheckpointV1[];
  /**
   * ADAPTIVE-EARLY-STOP § 2 — cuántas veces el runner pidió el prefetch de
   * admisión. El contrato es UNA por corrida: ni una por ronda, ni una por
   * candidato, ni una por evaluación de finalizabilidad (que ocurren varias).
   */
  admissionPrefetchCalls: number;
};

/**
 * Dependencias del adaptador con el proveedor DOBLADO en la frontera exacta en que
 * producción lo llama: se capturan `input`, `maxResults` y `options`, que es el
 * contrato que el § 5 fija. Todo lo demás (orquestador, gates, ranking, decisión de
 * la ronda 2, constructor de request efectivo) es el real.
 */
function buildDeps(options: {
  roundOutputs: WebSearchOutput[];
}): { deps: Partial<ApolloTwoRoundProductionDeps>; recorder: Recorder } {
  const recorder: Recorder = {
    searchCalls: [],
    enrichCalls: 0,
    writerCalls: 0,
    writtenCandidateNames: [],
    savedCheckpoints: [],
    admissionPrefetchCalls: 0,
  };

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo: (async (
      input: WebSearchInput,
      maxResults: number,
      _usageContext: unknown,
      _providerDeps: unknown,
      searchOptions: ApolloOrgsSearchOptions | undefined,
    ) => {
      const index = recorder.searchCalls.length;
      recorder.searchCalls.push({ input, maxResults, options: searchOptions });
      return options.roundOutputs[index] ?? searchOutput([], 0);
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    enrichCascade: (async (results: WebSearchResult[]) => {
      recorder.enrichCalls++;
      const result = results[0];
      const domain = (result.metadata?.['domain'] as string) ?? '';
      return {
        results: [result],
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
      recorder.writerCalls++;
      const names = writerInput.pipelineOutput.candidates.map((candidate) => candidate.name);
      recorder.writtenCandidateNames.push(names);
      return {
        dryRun: false,
        batchId: CORRELATION.batchId,
        candidatesCreated: names.length,
        candidatesSkipped: 0,
        createdCandidateIds: names.map((_name, index) => `candidate-${index + 1}`),
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

    loadCheckpoint: async () => null,
    saveCheckpoint: async (_batchId, checkpoint) => {
      recorder.savedCheckpoints.push(checkpoint);
      return {
        kind: 'written',
        checkpointVersion: checkpoint.checkpoint_version,
        serializedBytes: 0,
        compacted: false,
      };
    },
    loadEnrichmentUnitCostUsd: async () => 0.02,
    enrichOrganization: (async () => ({ success: true, data: undefined })) as never,
    logEnrichmentUsage: (async () => ({ kind: 'logged' as const })) as never,
    resolveConfig: () => defaultApolloTwoRoundConfig(),
    // ADAPTIVE-EARLY-STOP § 2 — el prefetch de admisión, contado y DEGRADADO.
    //
    // Degradado a propósito: esta suite no simula la base, y el contrato dice que
    // sin datos las tres comprobaciones respaldadas por base quedan PENDIENTES.
    // Lo que sí se mide aquí es cuántas veces se pidió.
    loadAdmissionPrefetch: async () => {
      recorder.admissionPrefetchCalls++;
      return {
        coveredDomains: new Set<string>(),
        noveltyIndex: new Map(),
        recentIdentityKeys: new Set<string>(),
        activeCandidates: [],
        degraded: true,
      };
    },
  };

  return { deps, recorder };
}

function runInput(
  overrides: Partial<ApolloTwoRoundWizardRunInput> = {},
): ApolloTwoRoundWizardRunInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Retail y Consumo',
    subindustries: ['Supermercados e Hipermercados'],
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

function readObservability(outcome: { metadata?: Record<string, unknown> | null }): Record<string, unknown> {
  const metadata = (outcome.metadata ?? {}) as Record<string, unknown>;
  return (metadata[APOLLO_TWO_ROUND_OBSERVABILITY_KEY] ?? {}) as Record<string, unknown>;
}

// ─── § 5: qué pasa el adaptador al proveedor ──────────────────────────────────

describe('§ 5 · el adaptador declara el límite de dos rondas en cada llamada', () => {
  test('5-6. resultLimitMode = two_round y twoRoundMaxResultsPerRound = 5', async () => {
    const { deps, recorder } = buildDeps({
      roundOutputs: [
        searchOutput([supermarket(1), supermarket(2), supermarket(3)], 3),
        searchOutput([supermarket(4), supermarket(5)], 2),
      ],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.ok(recorder.searchCalls.length >= 1, 'el adaptador debe llamar al proveedor');
    for (const call of recorder.searchCalls) {
      assert.equal(call.options?.resultLimitMode, 'two_round');
      assert.equal(call.options?.twoRoundMaxResultsPerRound, 5);
      assert.equal(call.options?.sectorGateMode, 'annotate');
      assert.equal(call.maxResults, 5, 'la ronda pide su límite propio, no el legacy');
    }
  });

  test('la primera ronda pide la página 1', async () => {
    const { deps, recorder } = buildDeps({
      roundOutputs: [searchOutput([supermarket(1)], 1)],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.searchCalls[0].options?.startPage, 1);
  });

  test('la subindustria seleccionada viaja aparte de los términos de la hipótesis', async () => {
    const { deps, recorder } = buildDeps({
      roundOutputs: [searchOutput([supermarket(1)], 1)],
    });

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    const [first] = recorder.searchCalls;
    assert.deepEqual(first.input.subindustries, ['Supermercados e Hipermercados']);
    assert.ok(
      (first.input.additionalCriteriaTokens ?? []).length > 0,
      'los términos de la hipótesis entran como criterio adicional',
    );
  });

  test('la ronda registra su huella EFECTIVA: el adaptador inyecta el constructor', async () => {
    const { deps } = buildDeps({
      roundOutputs: [
        searchOutput([supermarket(1), supermarket(2), supermarket(3)], 3),
        searchOutput([supermarket(4), supermarket(5)], 2),
      ],
    });

    const outcome = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const observability = readObservability(outcome);
    const rounds = observability['rounds'] as Array<Record<string, unknown>>;

    assert.ok(rounds.length >= 1);
    for (const round of rounds) {
      assert.ok(
        typeof round['effective_provider_fingerprint'] === 'string' &&
          (round['effective_provider_fingerprint'] as string).length > 0,
        `la ronda ${String(round['round_number'])} debe llevar huella efectiva: si el adaptador no inyectara el constructor, sería null`,
      );
      // AGENT1-APOLLO-NET-NEW-PAGINATION § 9 — per_page es siempre el techo del
      // contrato (100), no el límite por ronda de dos rondas.
      assert.equal(round['per_page'], 100);
      assert.notEqual(
        round['effective_provider_fingerprint'],
        round['hypothesis_fingerprint'],
        'las dos huellas no pueden ser la misma cosa',
      );
    }

    assert.equal(observability['effective_fingerprints_are_distinct'], true);
  });
});

// ─── § 6: el objetivo de cinco atraviesa adaptador y writer ───────────────────

describe('§ 6 · objetivo 5 end-to-end por el adaptador y el writer', () => {
  test('9. 5 crudas + 5 crudas ⇒ 5 elegibles, 5 persistidas, 2 llamadas', async () => {
    const { deps, recorder } = buildDeps({
      roundOutputs: [
        // Ronda 1: 5 crudas, 3 elegibles (dos pertenecen a otro negocio).
        searchOutput(
          [
            supermarket(1),
            supermarket(2),
            supermarket(3),
            otherBusiness(11, 'retail banking', 'Banco Nacional de Crédito'),
            otherBusiness(12, 'software', 'Consultora Tecnológica Andina'),
          ],
          5,
        ),
        // Ronda 2: 5 crudas, 2 elegibles nuevas.
        searchOutput(
          [
            supermarket(4),
            supermarket(5),
            otherBusiness(13, 'insurance', 'Aseguradora Riesgos Andinos'),
            otherBusiness(14, 'marketplace', 'Plataforma Comercial Digital'),
            otherBusiness(15, 'investment banking', 'Banca Corporativa del Norte'),
          ],
          5,
        ),
      ],
    });

    const outcome = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const observability = readObservability(outcome);
    const runMetrics = observability['run_metrics'] as Record<string, unknown>;
    const rounds = observability['rounds'] as Array<Record<string, unknown>>;

    assert.equal(observability['rounds_executed'], 2);
    assert.equal(recorder.searchCalls.length, 2, 'exactamente dos llamadas al proveedor');
    // AGENT1-APOLLO-NET-NEW-PAGINATION § 9 — per_page es siempre 100.
    assert.equal(rounds[0]['per_page'], 100);
    assert.equal(rounds[1]['per_page'], 100);
    assert.equal(runMetrics['total_raw_results'], 10);
    assert.equal(runMetrics['total_unique_organizations'], 10);
    assert.equal(observability['eligible_companies_found'], 5);

    // WRITER-ONLY-ADMISSION-PENDING §§ 7, 8 y 11 — las dos lecturas del objetivo
    // están SEPARADAS, y ésta es la PRE-writer.
    //
    // `observability.target_reached` y `result_status` los emite el orquestador
    // ANTES de escribir, con la cuenta estable: el adaptador de producción declara
    // pendientes las admisiones que sólo el writer resuelve, así que la cuenta
    // estable es 0 y la proyección no puede declarar el objetivo alcanzado. Eso es
    // exactamente lo que se busca — la proyección no miente hacia arriba.
    assert.equal(observability['target_reached'], false, 'proyección PRE-writer');
    assert.equal(observability['result_status'], 'partial_target_not_reached');
    const preWriterMetrics = runMetrics as Record<string, unknown>;
    assert.equal(preWriterMetrics['stable_finalizable_count'], 0);
    assert.equal(preWriterMetrics['writer_only_pending_count'], 5, 'las cinco proyectadas');
    assert.equal(preWriterMetrics['projected_finalizable_count'], 5);
    // ADAPTIVE-EARLY-STOP §§ 2, 3, 4 y 5 — de las trece, ocho deterministas y las
    // dos de lote ya se resuelven aquí; sólo quedan pendientes las TRES que
    // dependen del prefetch de base, que esta suite no inyecta (el runner cae al
    // contexto degradado, y degradado ⇒ pendiente, nunca pase).
    assert.deepEqual(
      preWriterMetrics['writer_only_pending_reasons'],
      APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS,
      'el motivo viaja por nombre, no como un booleano',
    );
    for (const resolved of APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS.filter(
      (check) => !APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS.includes(check),
    )) {
      assert.ok(
        !(preWriterMetrics['writer_only_pending_reasons'] as string[]).includes(resolved),
        `${resolved} ya no puede quedar pendiente: se resuelve antes del writer`,
      );
    }
    // § 11 — y las resueltas se CUENTAN, para que «viva» y «muerta» sean legibles.
    assert.ok((preWriterMetrics['pre_writer_admission_pass_count'] as number) > 0);
    assert.equal(
      preWriterMetrics['pre_writer_admission_pending_count'],
      5 * APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS.length,
    );

    // § 2 — el prefetch de admisión ocurre UNA vez en toda la corrida, con DIEZ
    // organizaciones evaluadas, DOS rondas y varias evaluaciones de
    // finalizabilidad por medio. Ni una consulta por ronda, ni una por candidato.
    assert.equal(
      recorder.admissionPrefetchCalls,
      1,
      `prefetch de admisión = ${recorder.admissionPrefetchCalls}: el contrato es UNA por corrida`,
    );

    // § 7 — la cifra AUTORITATIVA es la de después del writer, y sí alcanza el
    // objetivo: cinco filas completas contra un objetivo de cinco.
    assert.equal(outcome.candidatesCreated, 5);
    assert.equal(outcome.targetReached, true, 'autoritativa POST-writer');

    // El writer se invoca UNA vez y recibe exactamente cinco candidatos distintos.
    assert.equal(recorder.writerCalls, 1);
    assert.equal(recorder.writtenCandidateNames[0].length, 5);
    assert.equal(new Set(recorder.writtenCandidateNames[0]).size, 5);

    // Presupuesto: como mucho dos enrichments y doce créditos registrados.
    assert.ok(recorder.enrichCalls <= 2, `enrichments = ${recorder.enrichCalls}`);
    const spend = observability['spend_accounting'] as Record<string, unknown>;
    assert.ok(
      (spend['recorded_usage_credits'] as number) <= 12,
      `créditos registrados = ${String(spend['recorded_usage_credits'])}`,
    );
  });
});

// ─── § 7: ronda idéntica vista desde el adaptador ─────────────────────────────

describe('§ 7 · una ronda 2 sin variante real no se ejecuta ni se contabiliza', () => {
  test('10. una sola llamada, una sola contabilidad, ronda 2 declarada omitida', async () => {
    const { deps, recorder } = buildDeps({
      roundOutputs: [
        // Ronda 1: una organización de otro negocio ⇒ 0 elegibles.
        searchOutput([otherBusiness(21, 'retail banking', 'Banco Minorista Andino')], 1),
        // Si la ronda 2 llegara a ejecutarse, este resultado la delataría.
        searchOutput([supermarket(22)], 1),
      ],
    });

    // Sector fuera del catálogo de señales: la ronda 2 no tiene con qué variar, y el
    // proveedor no declara una segunda página.
    const outcome = await runApolloTwoRoundWizardDiscovery(
      runInput({ industry: 'Sector Inexistente', subindustries: [] }),
      deps,
    );
    const observability = readObservability(outcome);
    const rounds = observability['rounds'] as Array<Record<string, unknown>>;
    const runMetrics = observability['run_metrics'] as Record<string, unknown>;

    assert.equal(recorder.searchCalls.length, 1, 'la segunda búsqueda no debe emitirse');
    assert.equal(observability['rounds_executed'], 1);
    assert.equal(rounds.length, 1, 'no puede aparecer una ronda 2 en la observabilidad');
    assert.equal(rounds[0]['round_number'], 1);
    assert.equal(observability['second_round_skipped_reason'], 'identical_provider_request');
    assert.equal(observability['round_2_skipped_reason'], 'identical_provider_request');

    // Contabilidad: sólo la ronda 1.
    assert.equal(runMetrics['total_search_credits'], 1);
    assert.equal(runMetrics['rounds_executed'], 1);
    assert.equal(observability['eligible_companies_found'], 0);
    // El writer se invoca una sola vez —también sella la metadata del lote— y recibe
    // CERO candidatos: sin elegibles no se persiste ninguna empresa.
    assert.equal(recorder.writerCalls, 1);
    assert.deepEqual(recorder.writtenCandidateNames, [[]]);

    // Nada de la ronda 2 puede presentarse como ejecutado.
    assert.equal(observability['round_2_effective_provider_fingerprint'], null);
    assert.equal(observability['round_2_page'], null);
    assert.equal(observability['effective_fingerprints_are_distinct'], null);
  });
});

// ─── § 5: el `per_page` que el PROVIDER envía de verdad ───────────────────────

const TOUCHED_ENV = [
  'ENABLE_APOLLO_COMPANY_SEARCH',
  'AGENT1_APOLLO_MAX_RESULTS_PER_QUERY',
] as const;

afterEach(() => {
  for (const key of TOUCHED_ENV) delete process.env[key];
});

/**
 * CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 3 — la resolución de términos de la versión
 * publicada viaja en el input, y su versión tiene que ser la de la selección.
 *
 * Sin ella el provider bloquea ANTES del transporte (cero créditos), que es
 * precisamente el contrato nuevo: una consulta cuya procedencia de catálogo no se puede
 * afirmar no se paga. Estos casos miden `per_page`, páginas y huellas, así que
 * necesitan una corrida COHERENTE; la incoherencia se prueba en su propia suite.
 */
const PUBLISHED_CATALOG_TERMS = buildPublishedCatalogTermsResolution();

const PROVIDER_INPUT: WebSearchInput = {
  query: 'supermercados en Colombia',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  intent: 'company_discovery',
  maxResults: 5,
  provider: 'apollo_organizations',
  subindustries: ['Supermercados e Hipermercados'],
  additionalCriteriaTokens: ['grocery store'],
  subindustryCatalogTerms: PUBLISHED_CATALOG_TERMS,
  selectionCatalogVersion: CATALOG_VERSION,
};

function pagePayload(page: number, perPage: number): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: Array.from({ length: perPage }, (_unused, index) => ({
        id: `org-p${page}-${index}`,
        name: `Supermercado ${page}-${index}`,
        primary_domain: `supermercado-${page}-${index}.com.co`,
        industry: 'retail',
        keywords: ['supermercado', 'autoservicio'],
        short_description: 'cadena de supermercados',
        estimated_num_employees: 800,
        country: 'Colombia',
      })),
      pagination: { page, per_page: perPage, total_entries: 500, total_pages: 20 },
    },
    headers: null,
  };
}

/**
 * Ejecuta el provider REAL con el transporte inyectado.
 *
 * Devuelve los bodies que salieron y el diagnóstico de límites tal como llega a
 * `provider_usage_logs` — que es el canal donde el § 5 exige verlo, no el
 * `WebSearchOutput`.
 */
async function runProvider(
  options: ApolloOrgsSearchOptions | undefined,
  legacyMaxResultsPerQuery: string,
): Promise<{
  bodies: Array<Record<string, unknown>>;
  output: WebSearchOutput;
  limitDiagnostics: Record<string, unknown>;
}> {
  const bodies: Array<Record<string, unknown>> = [];
  const usageRows: Array<Record<string, unknown>> = [];
  const deps: ApolloOrgsSearchDeps = {
    fetchPage: async (body) => {
      bodies.push(body);
      return pagePayload(Number(body['page'] ?? 1), Number(body['per_page'] ?? 0));
    },
    logUsage: (async (row: Record<string, unknown>) => {
      usageRows.push(row);
      return { kind: 'ok' };
    }) as never,
    now: () => 0,
    random: () => 0,
    sleep: async () => undefined,
  };

  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  process.env.AGENT1_APOLLO_MAX_RESULTS_PER_QUERY = legacyMaxResultsPerQuery;
  const output = await runApolloOrganizationsSearch(PROVIDER_INPUT, 5, undefined, deps, options);

  const lastRow = usageRows[usageRows.length - 1] ?? {};
  const rowMetadata = (lastRow['metadata'] ?? {}) as Record<string, unknown>;
  const limitDiagnostics = (rowMetadata['apollo_params_sanitized'] ?? {}) as Record<
    string,
    unknown
  >;
  return { bodies, output, limitDiagnostics };
}

describe('§ 5 · el provider envía per_page=100 (techo del contrato), no el conteo de resultados de ningún modo', () => {
  // AGENT1-APOLLO-NET-NEW-PAGINATION § 9 — Apollo cobra 1 crédito por página no
  // vacía, sin importar cuántos resultados traiga: pedir menos de 100 sólo
  // obliga a pagar más páginas por el mismo objetivo. `per_page` deja de
  // derivarse de `AGENT1_APOLLO_MAX_RESULTS_PER_QUERY`, del límite por ronda de
  // dos rondas o de `remainingTarget` — SIEMPRE es el techo del contrato. Esos
  // límites siguen gobernando la REDACCIÓN de la consulta (diagnóstico
  // `apollo_max_results_per_*_resolved`), un concepto de negocio distinto.
  test('7. two_round ⇒ per_page = 100 aunque el límite por ronda sea 5', async () => {
    const { bodies, limitDiagnostics } = await runProvider(
      { resultLimitMode: 'two_round', twoRoundMaxResultsPerRound: 5, sectorGateMode: 'annotate' },
      '3',
    );

    assert.equal(bodies.length, 1, 'una invocación = una página');
    assert.equal(bodies[0]['per_page'], 100);
    assert.equal(bodies[0]['page'], 1);

    // § 5 — los DOS límites quedan visibles en la fila económica: un diagnóstico
    // puede decir cuál gobernó la REDACCIÓN de la consulta, aunque ya no
    // gobiernen `per_page`.
    assert.equal(limitDiagnostics['apollo_result_limit_mode'], 'two_round');
    assert.equal(limitDiagnostics['apollo_max_results_per_query_resolved'], 3);
    assert.equal(limitDiagnostics['apollo_max_results_per_round_resolved'], 5);
    assert.equal(limitDiagnostics['apollo_per_page_sent'], 100);
    assert.equal(limitDiagnostics['apollo_page_sent'], 1);
    assert.deepEqual(
      limitDiagnostics['apollo_effective_keywords_sent'],
      bodies[0]['q_organization_keyword_tags'],
      'lo que el diagnóstico declara enviado es lo que salió',
    );
  });

  test('8. la ruta legacy también envía per_page = 100, no el guardrail legacy', async () => {
    const { bodies, limitDiagnostics } = await runProvider(undefined, '3');

    assert.equal(bodies[0]['per_page'], 100, 'per_page es el techo del contrato, no el conteo de resultados legacy');
    assert.equal(limitDiagnostics['apollo_result_limit_mode'], 'legacy');
    assert.equal(limitDiagnostics['apollo_max_results_per_round_resolved'], null);
    assert.equal(limitDiagnostics['apollo_per_page_sent'], 100);
  });

  test('el startPage del modo de dos rondas llega al body', async () => {
    const { bodies } = await runProvider(
      {
        resultLimitMode: 'two_round',
        twoRoundMaxResultsPerRound: 5,
        startPage: 2,
        sectorGateMode: 'annotate',
      },
      '3',
    );

    assert.equal(bodies[0]['page'], 2);
    assert.equal(bodies[0]['per_page'], 100);
  });

  test('la huella calculada antes de ejecutar es la del body que se envió', async () => {
    const { output } = await runProvider(
      { resultLimitMode: 'two_round', twoRoundMaxResultsPerRound: 5, sectorGateMode: 'annotate' },
      '3',
    );

    const metadata = (output.metadata ?? {}) as Record<string, unknown>;
    const pagination = metadata['apollo_pagination'] as Record<string, unknown>;
    assert.equal(
      pagination['effective_request_fingerprint_matches_sent'],
      true,
      'si dejaran de coincidir, la decisión de la ronda 2 mira un request que no salió',
    );
    assert.ok(
      typeof pagination['effective_request_fingerprint'] === 'string' &&
        (pagination['effective_request_fingerprint'] as string).includes('page=1'),
      'la huella efectiva lleva la página',
    );
    // HARDENING-3 § 2 — la huella declarada como ENVIADA se recalcula desde el body
    // que salió, no desde el ancla idempotente con `page=1`.
    assert.ok(
      typeof pagination['effective_request_fingerprint_sent'] === 'string' &&
        (pagination['effective_request_fingerprint_sent'] as string).includes('page=1'),
    );
  });

  test('pidiendo la página 2, la invariante sigue cierta y AMBAS huellas dicen página 2', async () => {
    /**
     * HARDENING-3 § 2 — la prueba que el criterio anterior no podía dar.
     *
     * Con la comparación vieja (`filtersFingerprint`, que excluye la página) este
     * caso también salía `true`, pero por la razón equivocada: la huella comparada
     * no sabía en qué página estaba. Ahora las dos son página-inclusivas, así que un
     * `true` aquí significa de verdad «se envió la página que se construyó».
     */
    const { output } = await runProvider(
      {
        resultLimitMode: 'two_round',
        twoRoundMaxResultsPerRound: 5,
        startPage: 2,
        sectorGateMode: 'annotate',
      },
      '3',
    );

    const metadata = (output.metadata ?? {}) as Record<string, unknown>;
    const pagination = metadata['apollo_pagination'] as Record<string, unknown>;

    assert.equal(pagination['effective_request_fingerprint_matches_sent'], true);
    for (const key of ['effective_request_fingerprint', 'effective_request_fingerprint_sent']) {
      const value = pagination[key];
      assert.ok(typeof value === 'string' && value.includes('page=2'), `${key} debe llevar page=2`);
    }
  });

  test('el tope duro del proveedor manda sobre el límite de dos rondas', async () => {
    const { bodies } = await runProvider(
      { resultLimitMode: 'two_round', twoRoundMaxResultsPerRound: 50, sectorGateMode: 'annotate' },
      '3',
    );

    // Ninguna modalidad supera el techo del contrato (100), pida lo que pida.
    assert.equal(bodies[0]['per_page'], 100, 'ninguna modalidad supera el tope de 100');
  });
});
