/**
 * apollo-two-round-second-round-page-1b.test.ts — la PÁGINA que la ronda 2 pide de
 * verdad, medida en la llamada que sale hacia el adaptador de Apollo.
 *
 * AGENT1-APOLLO-SCALE-SECOND-ROUND-FIX-1B · § 1 y § 2.
 *
 * Reconstruye la corrida live `eae6d47f` (2026-08-05T17:59Z, `wizard_run`
 * `37f2b088…`), que gastó 11 créditos y dejó CERO empresas nuevas:
 *
 *   ronda 1 · efectivos [supermercado, hipermercado, grocery, grocery store, food retail] · page=1
 *   ronda 2 · efectivos [supermercado, hipermercado, grocery, grocery chain, grocery retail] · page=1
 *
 * Las huellas efectivas DIFERÍAN —así que el salto de página de HARDENING-3 no se
 * disparaba— pero compartían tres términos, y con `per_page=5` la página 1 devolvió
 * las mismas cinco empresas: `seen_duplicates=5`, `round_2_novel_provider_results=0`.
 *
 * Entra por el punto de entrada REAL de producción (`runApolloTwoRoundWizardDiscovery`)
 * con el proveedor doblado en la frontera exacta en que producción lo llama: la
 * hipótesis, el constructor del request efectivo, la decisión de la ronda 2, los
 * gates, el ranking, el checkpoint y la observabilidad son los de verdad.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../observability';
import { defaultApolloTwoRoundConfig } from '../index';
import type { ApolloOrgsSearchOptions } from '../../web-search-providers/apollo-organizations-search-provider';
import type {
  ProspectingPipelineCandidate,
  WebSearchInput,
  WebSearchOutput,
  WebSearchResult,
} from '../../types';
import type { ApolloTwoRoundCheckpointV1 } from '../checkpoint';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CORRELATION = {
  wizardRunId: 'run-page-1b',
  clientRequestId: 'client-page-1b',
  batchId: 'batch-page-1b',
  reservationId: 'reservation-page-1b',
  requestFingerprint: 'fingerprint-page-1b',
  idempotencyKey: 'idempotency-page-1b',
};

/** Un supermercado real, confirmado por señales GRATUITAS (no pide enrichment). */
function supermarket(id: string): WebSearchResult {
  return {
    title: `Cadena de Supermercados ${id}`,
    url: `https://supermercado-${id}.com.co`,
    snippet: 'cadena de supermercados y autoservicio de alimentos',
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `org-${id}`,
      domain: `supermercado-${id}.com.co`,
      industry: 'retail',
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 800,
      estimated_num_employees: 800,
      keywords: ['supermercado', 'autoservicio'],
      apollo_profile: { industry: 'retail', industries: [] },
    },
  };
}

/**
 * Salida del proveedor CON paginación declarada: `total_pages` es la única
 * condición que autoriza pedir la página 2, y la corrida live la traía (52 y 44).
 */
function searchOutput(
  results: WebSearchResult[],
  options: { totalPages: number | null; page?: number },
): WebSearchOutput {
  return {
    provider: 'apollo_organizations',
    query: 'supermercados en Colombia',
    results,
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: {
      usage: { credits_used: results.length },
      ...(options.totalPages === null
        ? {}
        : {
            apollo_pagination: {
              page: options.page ?? 1,
              per_page: 5,
              total_entries: 260,
              total_pages: options.totalPages,
            },
          }),
    },
  };
}

/**
 * Candidato del pipeline. Las empresas de la RONDA 1 se declaran duplicadas en
 * HubSpot, igual que en la corrida live (`known_company_duplicates = 4`): si la
 * ronda 1 dejara cinco elegibles, el objetivo se alcanzaría y NO habría ronda 2 que
 * medir. Las de la ronda 2 entran limpias.
 */
function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const domain = (result.metadata?.['domain'] as string) ?? null;
  const hubSpotDuplicate = (domain ?? '').includes('-r1-');
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
      status: hubSpotDuplicate ? 'existing_in_hubspot' : 'new_candidate',
      confidence: hubSpotDuplicate ? 1 : 0,
      input: { name: result.title, domain },
      matches: hubSpotDuplicate
        ? [{ source: 'hubspot', status: 'existing_in_hubspot', confidence: 1 }]
        : [],
      summary: 'test',
      checkedSources: ['sellup', 'hubspot'],
    } as ProspectingPipelineCandidate['duplicateCheck'],
    scoring: { qualityLabel: 'high_quality_new' } as ProspectingPipelineCandidate['scoring'],
  };
}

type SearchCall = {
  startPage: number | undefined;
  additionalCriteriaTokens: readonly string[];
  maxResults: number;
};

type Recorder = {
  searchCalls: SearchCall[];
  enrichCalls: string[];
  savedCheckpoints: ApolloTwoRoundCheckpointV1[];
  writtenCandidateNames: string[][];
};

function buildDeps(roundOutputs: WebSearchOutput[]): {
  deps: Partial<ApolloTwoRoundProductionDeps>;
  recorder: Recorder;
} {
  const recorder: Recorder = {
    searchCalls: [],
    enrichCalls: [],
    savedCheckpoints: [],
    writtenCandidateNames: [],
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
      recorder.searchCalls.push({
        // § 1 — la página que REALMENTE viaja al adaptador de Apollo. Es el único
        // dato que prueba que la ronda 2 pidió otra ventana.
        startPage: searchOptions?.startPage,
        additionalCriteriaTokens: input.additionalCriteriaTokens ?? [],
        maxResults,
      });
      return roundOutputs[index] ?? searchOutput([], { totalPages: null });
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    enrichCascade: (async (results: WebSearchResult[]) => {
      const result = results[0];
      recorder.enrichCalls.push((result.metadata?.['domain'] as string) ?? '');
      return {
        results: [result],
        meta: { enabled: true, cascade_version: 'test', entries: [] },
      };
    }) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
    }) => {
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
  };

  return { deps, recorder };
}

/**
 * Entrada de la corrida live: Colombia, `Retail y Consumo` con la subindustria
 * `Supermercados e Hipermercados`. Es la combinación que produce los dos conjuntos
 * de términos efectivos SOLAPADOS —no idénticos— del defecto.
 */
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
    triggeredByUserId: 'user-1b',
    ownerId: 'user-1b',
    correlation: CORRELATION,
    runCorrelationMetadata: null,
    extraBatchMetadata: null,
    reservedCredits: 12,
    ...overrides,
  };
}

function readObservability(outcome: {
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const metadata = (outcome.metadata ?? {}) as Record<string, unknown>;
  return (metadata[APOLLO_TWO_ROUND_OBSERVABILITY_KEY] ?? {}) as Record<string, unknown>;
}

function readRound(
  observability: Record<string, unknown>,
  roundNumber: number,
): Record<string, unknown> | null {
  const rounds = (observability['rounds'] ?? []) as Array<Record<string, unknown>>;
  return rounds.find((round) => round['round_number'] === roundNumber) ?? null;
}

const FIVE_ROUND_1 = ['r1-a', 'r1-b', 'r1-c', 'r1-d', 'r1-e'].map(supermarket);
const FIVE_ROUND_2 = ['r2-a', 'r2-b', 'r2-c', 'r2-d', 'r2-e'].map(supermarket);

// ─── § 1 · la página que sale al adaptador ────────────────────────────────────

describe('§ 1 · keywords efectivos solapados ⇒ la ronda 2 pide la página 2', () => {
  test('ronda 1 page=1 · ronda 2 page=2, capturado en la llamada al adaptador', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, page: 1 }),
      searchOutput(FIVE_ROUND_2, { totalPages: 44, page: 2 }),
    ]);

    const outcome = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const observability = readObservability(outcome);

    assert.equal(recorder.searchCalls.length, 2, 'exactamente dos búsquedas, ni una más');
    assert.equal(recorder.searchCalls[0].startPage, 1, 'la ronda 1 pide la página 1');
    assert.equal(
      recorder.searchCalls[1].startPage,
      2,
      'la ronda 2 DEBE pedir la página 2: con términos solapados la página 1 repite empresas',
    );

    // La observabilidad tiene que decir lo mismo que salió al proveedor.
    assert.equal(observability['round_1_page'], 1);
    assert.equal(observability['round_2_page'], 2);
    assert.equal(readRound(observability, 2)?.['page'], 2);
  });

  test('el solapamiento REAL de la corrida live es el que dispara el salto', async () => {
    const { deps } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, page: 1 }),
      searchOutput(FIVE_ROUND_2, { totalPages: 44, page: 2 }),
    ]);

    const observability = readObservability(
      await runApolloTwoRoundWizardDiscovery(runInput(), deps),
    );

    const decision = observability['round_2_page_decision'] as Record<string, unknown> | null;
    assert.ok(decision, 'la decisión de página tiene que quedar registrada');
    assert.equal(decision['requested_page'], 2);
    assert.equal(decision['escalated_to_page_2'], true);
    assert.equal(decision['escalation_reason'], 'overlapping_effective_keywords');
    assert.equal(decision['provider_total_pages'], 52);
    assert.equal(decision['escalation_blocked_reason'], null);

    // Los términos compartidos son los de la corrida live, no una lista inventada.
    const shared = decision['shared_effective_keywords'] as string[];
    assert.ok(shared.length > 0, 'sin términos compartidos no habría motivo de salto');
    const round1Keywords = observability['round_1_effective_keywords_sent'] as string[];
    const round2Keywords = observability['round_2_effective_keywords_sent'] as string[];
    for (const keyword of shared) {
      assert.ok(round1Keywords.includes(keyword) && round2Keywords.includes(keyword));
    }
    // Y las huellas efectivas SÍ difieren: el criterio viejo no habría saltado.
    assert.notEqual(
      observability['round_1_effective_provider_fingerprint'],
      observability['round_2_effective_provider_fingerprint'],
    );
  });

  test('el checkpoint durable registra round_2_page = 2', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, page: 1 }),
      searchOutput(FIVE_ROUND_2, { totalPages: 44, page: 2 }),
    ]);

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    const withRound2 = recorder.savedCheckpoints.filter((checkpoint) =>
      checkpoint.round_summaries.some((round) => round.roundNumber === 2),
    );
    assert.ok(withRound2.length > 0, 'la ronda 2 tiene que dejar checkpoint');
    for (const checkpoint of withRound2) {
      const round2 = checkpoint.round_summaries.find((round) => round.roundNumber === 2);
      assert.equal(round2?.page, 2, 'un reintento debe recuperar la página 2, no la 1');
    }
    const last = recorder.savedCheckpoints[recorder.savedCheckpoints.length - 1];
    assert.equal(
      last.round_summaries.find((round) => round.roundNumber === 1)?.page,
      1,
      'la ronda 1 sigue siendo la página 1',
    );
  });

  test('la segunda ronda aporta empresas DISTINTAS y ninguna se cobra dos veces', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, page: 1 }),
      searchOutput(FIVE_ROUND_2, { totalPages: 44, page: 2 }),
    ]);

    const outcome = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const observability = readObservability(outcome);
    const runMetrics = observability['run_metrics'] as Record<string, unknown>;
    const round2 = readRound(observability, 2);

    assert.equal(round2?.['new_unique_results'], 5, 'las cinco de la ronda 2 son nuevas');
    assert.equal(round2?.['seen_duplicates'], 0, 'ninguna repetición entre rondas');
    assert.equal(runMetrics['total_unique_organizations'], 10);
    assert.equal(runMetrics['total_seen_duplicates'], 0);
    // Cero doble cobro: cinco resultados por ronda, un crédito por resultado, y
    // ningún enrichment sobre una empresa que ya se había evaluado.
    assert.equal(runMetrics['total_search_credits'], 10);
    assert.equal(new Set(recorder.enrichCalls).size, recorder.enrichCalls.length);
  });

  test('una página 2 elegida por la propia hipótesis no se declara como salto', async () => {
    // Sector fuera del catálogo: la ronda 2 no tiene sinónimos ni regiones con que
    // variar, así que la HIPÓTESIS ya pide la página 2 (`same_query_next_page`). La
    // decisión debe distinguir ese origen del salto que hace esta corrección: son
    // dos caminos distintos hacia la misma página, y confundirlos haría ilegible el
    // próximo QA.
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, page: 1 }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, page: 2 }),
    ]);

    const observability = readObservability(
      await runApolloTwoRoundWizardDiscovery(
        runInput({ industry: 'Sector Inexistente', subindustries: [] }),
        deps,
      ),
    );

    const decision = observability['round_2_page_decision'] as Record<string, unknown> | null;
    assert.ok(decision);
    assert.equal(decision['requested_page'], 2);
    assert.equal(decision['page_source'], 'hypothesis_variant');
    assert.equal(decision['escalated_to_page_2'], false);
    assert.equal(recorder.searchCalls[1].startPage, 2);
  });
});

// ─── § 2 · la página 2 sigue necesitando que el proveedor la declare ──────────

describe('§ 2 · el salto de página nunca se inventa una página', () => {
  test('sin total_pages declarado la ronda 2 no pide la página 2, y se dice por qué', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: null }),
      searchOutput(FIVE_ROUND_2, { totalPages: null }),
    ]);

    const observability = readObservability(
      await runApolloTwoRoundWizardDiscovery(runInput(), deps),
    );

    assert.equal(recorder.searchCalls[1]?.startPage, 1, 'pedir una página no declarada sería pagar por vacío');
    assert.equal(observability['round_2_page'], 1);

    const decision = observability['round_2_page_decision'] as Record<string, unknown>;
    assert.equal(decision['escalated_to_page_2'], false);
    assert.equal(decision['escalation_reason'], 'overlapping_effective_keywords');
    assert.equal(decision['escalation_blocked_reason'], 'provider_total_pages_unknown');
  });

  test('total_pages = 1 tampoco autoriza la página 2', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 1, page: 1 }),
      searchOutput(FIVE_ROUND_2, { totalPages: 1, page: 1 }),
    ]);

    const observability = readObservability(
      await runApolloTwoRoundWizardDiscovery(runInput(), deps),
    );

    assert.equal(recorder.searchCalls[1]?.startPage, 1);
    const decision = observability['round_2_page_decision'] as Record<string, unknown>;
    assert.equal(decision['escalation_blocked_reason'], 'provider_declared_single_page');
  });

  test('una ronda 2 en la página 2 que repite las mismas cinco no vuelve a cobrarlas', async () => {
    // El peor caso: el salto de página se da, y aun así el proveedor devuelve las
    // mismas empresas. Se cuentan como repeticiones, no como nuevas, y ninguna se
    // vuelve a evaluar ni a enriquecer.
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, page: 1 }),
      searchOutput(FIVE_ROUND_1, { totalPages: 52, page: 2 }),
    ]);

    const observability = readObservability(
      await runApolloTwoRoundWizardDiscovery(runInput(), deps),
    );
    const runMetrics = observability['run_metrics'] as Record<string, unknown>;
    const round2 = readRound(observability, 2);

    assert.equal(recorder.searchCalls[1].startPage, 2);
    assert.equal(round2?.['seen_duplicates'], 5, 'las repeticiones se cuentan como tales');
    assert.equal(round2?.['new_unique_results'], 0, 'ninguna repetición cuenta como nueva');
    assert.equal(runMetrics['total_unique_organizations'], 5);
    assert.equal(new Set(recorder.enrichCalls).size, recorder.enrichCalls.length);
  });
});
