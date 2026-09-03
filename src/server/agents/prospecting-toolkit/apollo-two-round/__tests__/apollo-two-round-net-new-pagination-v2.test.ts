/**
 * apollo-two-round-net-new-pagination-v2.test.ts — la PÁGINA DE ARRANQUE de la
 * ronda 2 sale del cursor del PLAN DE BÚSQUEDA, no de un literal.
 *
 * A1-APOLLO-NET-NEW-PAGINATION-V2.
 *
 * La auditoría de la última corrida real dejó esto:
 *
 *   ronda 1 · page 1  page 2  page 3  page 4
 *   ronda 2 · page 2  page 3  page 4  page 5     ← tres páginas ya pagadas
 *
 * El motor de paginación no repite página DENTRO de una invocación; el defecto
 * está en dónde ARRANCA la segunda: era el literal `2`, bajo el supuesto de que
 * una ronda nueva estrena universo de páginas. Con la paginación net-new
 * conectada, la ronda 1 ya no consume una página sino varias, así que ese
 * literal aterriza en mitad de lo ya comprado.
 *
 * Lo que este hito NO cambia, y esta suite vuelve a medir: el techo de páginas,
 * el de créditos, el de rondas, `per_page`, y el modelo de facturación de #380
 * (1 crédito por página NO VACÍA, 0 por página vacía).
 *
 * Las secciones A-G entran por el punto de entrada REAL de producción
 * (`runApolloTwoRoundWizardDiscovery`), con el proveedor doblado en la frontera
 * exacta en que producción lo llama: la hipótesis, el constructor del request
 * efectivo, la decisión de página, los gates, el checkpoint y la observabilidad
 * son los de verdad.
 *
 * La entrada es la de la corrida auditada —Colombia · Gobierno, sin
 * subindustrias—, y no por color local: es la combinación en la que el catálogo
 * de señales no aporta sinónimos, así que la ronda 2 no tiene variante de
 * términos ni de región y `buildRound2Hypothesis` cae en `same_query_next_page`.
 * Ése es exactamente el camino del defecto: MISMO plan de búsqueda, página fijada
 * a 2 por literal. Las organizaciones del doble las rechaza el gate sectorial
 * (no hay política para «Gobierno»), lo que mantiene el objetivo sin alcanzar y
 * hace que la decisión de la ronda 2 dependa SÓLO del criterio de página.
 *
 * Las dos últimas secciones bajan una capa —al orquestador y al lector de
 * metadata— para poder declarar los planes y separar sin ambigüedad «mismo plan»
 * de «plan distinto», y para ejercitar la reanudación desde checkpoint.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  readApolloSearchPlanPageConsumption,
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type RoundProviderRequestPreview,
} from '../orchestrator';
import {
  APOLLO_TWO_ROUND_OBSERVABILITY_KEY,
  buildEmptyRoundMetrics,
  type ApolloTwoRoundRoundMetrics,
} from '../observability';
import { orgs, rejectedAssessment, testConfig, testCorrelation, testQueryContext } from './fixtures';
import { defaultApolloTwoRoundConfig } from '../index';
import {
  createApolloPaginationBudget,
  WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
  APOLLO_CONTRACT_MAX_PER_PAGE,
} from '../../apollo-organizations-pagination-budget';
import { creditsForApolloNonEmptyPages } from '../../apollo-operation-pricing';
import { resolveApolloPaidResultsVolume } from '../../apollo-organizations-paid-volume';
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
  wizardRunId: 'run-netnew-v2',
  clientRequestId: 'client-netnew-v2',
  batchId: 'batch-netnew-v2',
  reservationId: 'reservation-netnew-v2',
  requestFingerprint: 'fingerprint-netnew-v2',
  idempotencyKey: 'idempotency-netnew-v2',
};

/** Organización cruda del proveedor. Su sector es irrelevante aquí: el gate la
 *  rechaza en todos los casos y este hito sólo mide páginas. */
function organization(id: string): WebSearchResult {
  return {
    title: `Entidad ${id}`,
    url: `https://entidad-${id}.com.co`,
    snippet: 'entidad con presencia en Colombia',
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: {
      apollo_organization_id: `org-${id}`,
      domain: `entidad-${id}.com.co`,
      industry: 'retail',
      country_code: 'CO',
      country: 'Colombia',
      city: 'Bogotá',
      employee_count: 800,
      estimated_num_employees: 800,
      keywords: ['entidad'],
      apollo_profile: { industry: 'retail', industries: [] },
    },
  };
}

type PageOutcomeFixture = {
  page: number;
  status?: 'success' | 'error' | 'rate_limited' | 'indeterminate';
  billingState?: 'charged' | 'not_charged' | 'unknown';
  resultsReturned?: number;
};

/**
 * Desenlaces por página tal como los publica la búsqueda paginada en
 * `apollo_pagination.page_outcomes` — la MISMA forma (`ApolloPageOutcome`), sin
 * renombrar campos: es el contrato que el lector de producción consume.
 */
function pageOutcomes(fixtures: readonly PageOutcomeFixture[]) {
  return fixtures.map((fixture) => {
    const status = fixture.status ?? 'success';
    const billingState =
      fixture.billingState ?? (status === 'success' ? 'charged' : 'unknown');
    return {
      page: fixture.page,
      status,
      resultsReturned: fixture.resultsReturned ?? (status === 'success' ? 25 : 0),
      estimatedCredits: billingState === 'charged' ? 1 : 0,
      attempt: 1,
      errorCode: status === 'success' ? null : 'test_error',
      billingState,
    };
  });
}

/**
 * Salida del proveedor con el bloque `apollo_pagination` COMPLETO: `total_pages`
 * (lo único que autoriza pedir una página posterior) y `page_outcomes` (lo que
 * dice qué páginas quedaron consumidas). El `request_fingerprint` se omite a
 * propósito en el caso base: producción lo publica, pero el cursor no puede
 * depender de que dos capas calculen la misma cadena — atribuye las páginas al
 * plan que la propia ronda construyó.
 */
function searchOutput(
  results: WebSearchResult[],
  options: {
    totalPages: number | null;
    pages?: readonly PageOutcomeFixture[];
    requestFingerprint?: string;
    creditsUsed?: number;
  },
): WebSearchOutput {
  const outcomes = options.pages ? pageOutcomes(options.pages) : null;
  const chargedPages = (outcomes ?? []).filter(
    (outcome) => outcome.billingState === 'charged',
  ).length;
  return {
    provider: 'apollo_organizations',
    query: 'entidades en Colombia',
    results,
    resultsCount: results.length,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: 0,
    metadata: {
      // #380 — 1 crédito por página NO VACÍA. Nunca por resultado devuelto.
      usage: { credits_used: options.creditsUsed ?? chargedPages },
      ...(options.totalPages === null && outcomes === null
        ? {}
        : {
            apollo_pagination: {
              per_page: APOLLO_CONTRACT_MAX_PER_PAGE,
              total_entries: 5_200,
              total_pages: options.totalPages,
              ...(outcomes === null ? {} : { page_outcomes: outcomes }),
              ...(options.requestFingerprint === undefined
                ? {}
                : { request_fingerprint: options.requestFingerprint }),
            },
          }),
    },
  };
}

function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const domain = (result.metadata?.['domain'] as string) ?? null;
  // Las empresas de la ronda 1 llegan duplicadas en HubSpot: si dejaran cinco
  // elegibles, el objetivo se alcanzaría y no habría ronda 2 que medir.
  const hubSpotDuplicate = (domain ?? '').includes('-r1-');
  return {
    name: result.title,
    website: result.url,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Gobierno',
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

type SearchCall = { startPage: number | undefined; maxResults: number };

type Recorder = {
  searchCalls: SearchCall[];
  savedCheckpoints: ApolloTwoRoundCheckpointV1[];
};

function buildDeps(
  roundOutputs: WebSearchOutput[],
  overrides: Partial<ApolloTwoRoundProductionDeps> = {},
): { deps: Partial<ApolloTwoRoundProductionDeps>; recorder: Recorder } {
  const recorder: Recorder = { searchCalls: [], savedCheckpoints: [] };

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo: (async (
      _input: WebSearchInput,
      maxResults: number,
      _usageContext: unknown,
      _providerDeps: unknown,
      searchOptions: ApolloOrgsSearchOptions | undefined,
    ) => {
      const index = recorder.searchCalls.length;
      recorder.searchCalls.push({ startPage: searchOptions?.startPage, maxResults });
      return roundOutputs[index] ?? searchOutput([], { totalPages: null });
    }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'],

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    enrichCascade: (async (results: WebSearchResult[]) => ({
      results: [results[0]],
      meta: { enabled: true, cascade_version: 'test', entries: [] },
    })) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
    }) => {
      const names = writerInput.pipelineOutput.candidates.map((candidate) => candidate.name);
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
    ...overrides,
  };

  return { deps, recorder };
}

function runInput(
  overrides: Partial<ApolloTwoRoundWizardRunInput> = {},
): ApolloTwoRoundWizardRunInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Gobierno',
    subindustries: [],
    additionalCriteria: null,
    reservedBatchId: CORRELATION.batchId,
    triggeredByUserId: 'user-v2',
    ownerId: 'user-v2',
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

function readPageDecision(
  observability: Record<string, unknown>,
): Record<string, unknown> | null {
  return (observability['round_2_page_decision'] ?? null) as Record<string, unknown> | null;
}

const FIVE_ROUND_1 = ['r1-a', 'r1-b', 'r1-c', 'r1-d', 'r1-e'].map(organization);
const FIVE_ROUND_2 = ['r2-a', 'r2-b', 'r2-c', 'r2-d', 'r2-e'].map(organization);

// ─── TEST A · mismo plan · R1 = 1,2,3,4 ⇒ R2 arranca en 5 ─────────────────────

describe('A · el defecto de la corrida real: R2 arrancaba en 2 sobre páginas ya compradas', () => {
  test('R1 consume 1,2,3,4 ⇒ R2 pide la página 5, no la 2', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, pages: [1, 2, 3, 4].map((page) => ({ page })) }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [5, 6, 7, 8].map((page) => ({ page })) }),
    ]);

    const outcome = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const observability = readObservability(outcome);

    assert.equal(recorder.searchCalls.length, 2, 'exactamente dos búsquedas, ni una más');
    assert.equal(recorder.searchCalls[0].startPage, 1, 'la ronda 1 sigue arrancando en la 1');
    assert.equal(
      recorder.searchCalls[1].startPage,
      5,
      'la ronda 2 arranca donde la ronda 1 dejó el plan: 4 + 1',
    );
    assert.equal(observability['round_2_page'], 5);
    assert.equal(readRound(observability, 2)?.['page'], 5);
  });

  test('la decisión de página declara el cursor y el plan sobre el que se calculó', async () => {
    const { deps } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, pages: [1, 2, 3, 4].map((page) => ({ page })) }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [5].map((page) => ({ page })) }),
    ]);

    const decision = readPageDecision(
      readObservability(await runApolloTwoRoundWizardDiscovery(runInput(), deps)),
    );
    assert.ok(decision, 'la decisión de página tiene que quedar registrada');
    assert.equal(decision['requested_page'], 5);
    assert.equal(decision['net_new_cursor_page'], 5);
    assert.equal(
      decision['advanced_by_net_new_cursor'],
      true,
      'la página la eligió el cursor, no la hipótesis ni el suelo de solapamiento',
    );
    // La hipótesis SÍ eligió la variante «página siguiente de la misma búsqueda»;
    // lo que el cursor hizo fue reubicarla fuera de lo ya comprado.
    assert.equal(decision['page_source'], 'hypothesis_variant');
    assert.equal(decision['escalation_blocked_reason'], null);
    assert.equal(
      typeof decision['net_new_cursor_plan_fingerprint'],
      'string',
      'el plan sobre el que se leyó el cursor queda nombrado, no implícito',
    );
  });

  test('la ronda 1 deja en el checkpoint el plan y hasta dónde lo consumió', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, pages: [1, 2, 3, 4].map((page) => ({ page })) }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [5].map((page) => ({ page })) }),
    ]);

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    const withRound1 = recorder.savedCheckpoints
      .map((checkpoint) => checkpoint.round_summaries.find((round) => round.roundNumber === 1))
      .filter((round): round is NonNullable<typeof round> => round !== undefined);
    assert.ok(withRound1.length > 0, 'la ronda 1 tiene que dejar checkpoint');

    const round1 = withRound1[withRound1.length - 1];
    assert.equal(round1.lastConsumedPage, 4, 'un reintento debe poder leer que el plan va por la 4');
    assert.equal(
      typeof round1.searchPlanFingerprint,
      'string',
      'sin el plan, la página consumida no se puede atribuir a nada',
    );
  });
});

// ─── TEST B · ronda 1 parcial ─────────────────────────────────────────────────

describe('B · ronda 1 parcial: R1 = 1,2 ⇒ R2 arranca en 3', () => {
  test('el cursor sigue el consumo REAL, no el techo de páginas', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, pages: [{ page: 1 }, { page: 2 }] }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [{ page: 3 }] }),
    ]);

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(recorder.searchCalls[1].startPage, 3);
  });

  test('con una sola página consumida el arranque sigue siendo la 2, como antes del corte', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, pages: [{ page: 1 }] }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [{ page: 2 }] }),
    ]);

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(recorder.searchCalls[1].startPage, 2);
  });
});

// ─── TEST C · plan distinto ───────────────────────────────────────────────────

describe('C · un plan distinto NO hereda el cursor de otro', () => {
  test('sin evidencia de consumo del plan de la ronda 2, el suelo del solapamiento sigue siendo 2', async () => {
    // La ronda 1 informa páginas 1..4, pero de un plan que la ronda 2 no comparte:
    // el `request_fingerprint` declarado no es el que la ronda construyó, así que
    // esas páginas no se atribuyen a ningún cursor.
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, {
        totalPages: 52,
        pages: [1, 2, 3, 4].map((page) => ({ page })),
        requestFingerprint: 'plan-de-otra-busqueda',
      }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [{ page: 2 }] }),
    ]);

    const outcome = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const decision = readPageDecision(readObservability(outcome));

    assert.equal(recorder.searchCalls[1].startPage, 2, 'sin cursor propio, el remedio previo manda');
    assert.equal(decision?.['net_new_cursor_page'], 1, 'ese plan no consta consumido');
  });

  test('una búsqueda que no informa desenlaces por página no mueve el cursor', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, creditsUsed: 4 }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, creditsUsed: 1 }),
    ]);

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(
      recorder.searchCalls[1].startPage,
      2,
      'sin evidencia no se adivina una página: se conserva el comportamiento previo',
    );
  });
});

// ─── TEST D · fail-closed ─────────────────────────────────────────────────────

describe('D · una página sin desenlace confirmado NO se libera', () => {
  test('R1 = 1,2,3 + página 4 indeterminada ⇒ R2 arranca en 5, nunca en 4', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, {
        totalPages: 52,
        pages: [
          { page: 1 },
          { page: 2 },
          { page: 3 },
          { page: 4, status: 'indeterminate', billingState: 'unknown' },
        ],
      }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [{ page: 5 }] }),
    ]);

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(
      recorder.searchCalls[1].startPage,
      5,
      'la página 4 pudo cobrarse: no vuelve a pedirse por no aparecer como charged',
    );
  });

  test('una página que nunca salió ni se cobró SÍ sigue disponible', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, {
        totalPages: 52,
        pages: [
          { page: 1 },
          { page: 2 },
          // Fallo de la valla durable ANTES del envío: Apollo nunca la vio.
          { page: 3, status: 'error', billingState: 'not_charged' },
        ],
      }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [{ page: 3 }] }),
    ]);

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(recorder.searchCalls[1].startPage, 3);
  });

  test('la valla durable de página sigue gobernando el bloqueo, y este hito no la toca', async () => {
    // El bloqueo fail-closed vive en la valla (`page-fence.ts` →
    // `toApolloDurableResumeState`), no en el cursor. Se comprueba aquí que la
    // ruta de producción siga leyéndola por ronda y que una lectura fallida
    // impida CUALQUIER búsqueda, con o sin cursor.
    const { deps, recorder } = buildDeps(
      [
        searchOutput(FIVE_ROUND_1, { totalPages: 52, pages: [1, 2, 3, 4].map((page) => ({ page })) }),
      ],
      {
        readPageFenceEntries: async () => ({
          kind: 'failed' as const,
          reason: 'storage_unavailable',
        }),
      } as Partial<ApolloTwoRoundProductionDeps>,
    );

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    assert.equal(
      recorder.searchCalls.length,
      0,
      'una valla que no se puede leer impide pedir páginas, cursor o no',
    );
  });
});

// ─── TEST E · varias páginas por ronda, sin parche para «la 5» ────────────────

describe('E · la regla es general', () => {
  for (const [lastConsumed, expectedStart] of [
    [2, 3],
    [4, 5],
    [7, 8],
    [11, 12],
  ] as const) {
    test(`R1 termina en la página ${lastConsumed} ⇒ R2 arranca en la ${expectedStart}`, async () => {
      const pages = Array.from({ length: lastConsumed }, (_v, index) => ({ page: index + 1 }));
      const { deps, recorder } = buildDeps([
        searchOutput(FIVE_ROUND_1, { totalPages: 52, pages }),
        searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [{ page: expectedStart }] }),
      ]);

      await runApolloTwoRoundWizardDiscovery(runInput(), deps);
      assert.equal(recorder.searchCalls[1].startPage, expectedStart);
    });
  }

  test('cuando el plan ya se recorrió entero, la ronda 2 NO retrocede: se bloquea y lo dice', async () => {
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, {
        totalPages: 4,
        pages: [1, 2, 3, 4].map((page) => ({ page })),
      }),
      searchOutput(FIVE_ROUND_2, { totalPages: 4, pages: [] }),
    ]);

    const outcome = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const decision = readPageDecision(readObservability(outcome));

    assert.equal(decision?.['net_new_cursor_page'], 5);
    assert.equal(decision?.['escalated_to_page_2'], false);
    assert.equal(decision?.['escalation_blocked_reason'], 'provider_page_range_exhausted');
    assert.equal(
      readObservability(outcome)['second_round_skipped_reason'],
      'net_new_pages_exhausted',
      'sin páginas nuevas de este plan la ronda 2 no se emite',
    );
    assert.equal(
      recorder.searchCalls.length,
      1,
      'retroceder a la 2 sería volver a comprar lo que la ronda 1 acaba de pagar',
    );
  });
});

// ─── TEST F · ninguna página consumida vuelve al planificador ─────────────────

describe('F · una página ya consumida no vuelve a entrar al plan de peticiones', () => {
  test('los rangos de las dos rondas son disjuntos para el MISMO plan', async () => {
    const round1Pages = [1, 2, 3, 4];
    const { deps, recorder } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, pages: round1Pages.map((page) => ({ page })) }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [5, 6, 7, 8].map((page) => ({ page })) }),
    ]);

    await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    const round2Start = recorder.searchCalls[1].startPage;
    assert.equal(typeof round2Start, 'number');
    // El motor pide `start, start+1, …` dentro del techo de páginas de la
    // invocación; con `start = 5` ninguna de ellas puede caer en 1..4.
    const round2Range = Array.from(
      { length: WIZARD_APOLLO_MAX_PAGES_HARD_CAP },
      (_v, index) => (round2Start as number) + index,
    );
    for (const page of round2Range) {
      assert.ok(
        !round1Pages.includes(page),
        `la página ${page} ya la consumió la ronda 1 y no puede volver a pedirse`,
      );
    }
  });
});

// ─── TEST G · el modelo de facturación de #380 sigue intacto ──────────────────

describe('G · facturación: 1 crédito por página NO VACÍA, 0 por página vacía', () => {
  test('la conversión de páginas a créditos no se movió', () => {
    assert.equal(creditsForApolloNonEmptyPages(0), 0);
    assert.equal(creditsForApolloNonEmptyPages(1), 1);
    assert.equal(creditsForApolloNonEmptyPages(4), 4);
  });

  test('una página vacía suma 0 créditos y una no vacía suma 1', () => {
    const volume = resolveApolloPaidResultsVolume([
      { status: 'success', resultsReturned: 25, estimatedCredits: 1 },
      // Página entregada VACÍA: 0 resultados, 0 créditos.
      { status: 'success', resultsReturned: 0, estimatedCredits: 0 },
      { status: 'success', resultsReturned: 12, estimatedCredits: 1 },
    ]);

    assert.equal(volume.creditsCharged, 2, 'dos páginas no vacías = dos créditos');
    assert.equal(volume.pagesCounted, 3);
    assert.equal(creditsForApolloNonEmptyPages(volume.creditsCharged), 2);
  });

  test('el presupuesto de paginación conserva sus topes: este hito no sube ninguno', () => {
    const budget = createApolloPaginationBudget();
    assert.equal(budget.maxPages, WIZARD_APOLLO_MAX_PAGES_HARD_CAP);
    assert.equal(budget.maxCredits, budget.maxPages);
    assert.equal(budget.perPage, APOLLO_CONTRACT_MAX_PER_PAGE);
    assert.equal(budget.maxCandidates, budget.maxPages * budget.perPage);
  });

  test('mover el arranque de la ronda 2 no cambia cuántas páginas se pagan', async () => {
    const { deps } = buildDeps([
      searchOutput(FIVE_ROUND_1, { totalPages: 52, pages: [1, 2, 3, 4].map((page) => ({ page })) }),
      searchOutput(FIVE_ROUND_2, { totalPages: 52, pages: [5, 6, 7, 8].map((page) => ({ page })) }),
    ]);

    const observability = readObservability(
      await runApolloTwoRoundWizardDiscovery(runInput(), deps),
    );
    const runMetrics = (observability['run_metrics'] ?? {}) as Record<string, unknown>;

    // Cuatro páginas no vacías por ronda, ocho en total. El mismo gasto que la
    // corrida defectuosa — la diferencia es que ahora las ocho son distintas.
    assert.equal(runMetrics['total_search_credits'], 8);
  });
});

// ─── Capa de orquestador · planes de búsqueda CONTROLADOS ─────────────────────
//
// Las secciones de arriba entran por producción y por eso heredan los planes que
// el mapper real redacta. Aquí el plan se declara, para poder separar sin
// ambigüedad «mismo plan» de «plan distinto» y para ejercitar la reanudación
// desde checkpoint, que es la única vía por la que la ronda 2 puede correr en un
// proceso donde la ronda 1 nunca se ejecutó.

type PlannedRound = {
  /** Plan del que esta ronda formará parte. */
  plan: string;
  /** Páginas que su búsqueda deja consumidas. `null` ⇒ no informa desenlaces. */
  consumed: number[] | null;
};

function planDrivenDeps(input: {
  planByRound: Record<number, PlannedRound>;
  providerTotalPages: number | null;
}): { deps: ApolloTwoRoundDeps; searchCalls: Array<{ roundNumber: number; page: number }> } {
  const searchCalls: Array<{ roundNumber: number; page: number }> = [];
  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: ({ hypothesis, roundNumber, requestedResultLimit }) => {
      const page = hypothesis.queryParameters.page;
      const plan = input.planByRound[roundNumber]?.plan ?? `plan-${roundNumber}`;
      const preview: RoundProviderRequestPreview = {
        // La huella EFECTIVA incluye la página; la del PLAN no. Es la misma
        // relación que sostiene el contrato real.
        effectiveRequestFingerprint: `${plan}|page=${page}`,
        searchPlanFingerprint: plan,
        page,
        perPage: requestedResultLimit,
        effectiveKeywordTags: [plan],
      };
      return preview;
    },
    searchRound: async ({ roundNumber, hypothesis }) => {
      const page = hypothesis.queryParameters.page;
      searchCalls.push({ roundNumber, page });
      const planned = input.planByRound[roundNumber];
      const consumed = planned?.consumed ?? null;
      return {
        organizations: orgs(`r${roundNumber}-`, 3),
        providerRequestCount: 1,
        internalRecordedCredits: consumed?.length ?? 1,
        providerTotalPages: input.providerTotalPages,
        consumedPages:
          consumed === null
            ? null
            : {
                searchPlanFingerprint: planned!.plan,
                consumedPages: [...consumed],
                lastConsumedPage: consumed.length === 0 ? null : Math.max(...consumed),
              },
      };
    },
    // Todos los candidatos se descartan: así el objetivo nunca se alcanza y la
    // ronda 2 se decide siempre por el criterio de página, no por el de objetivo.
    assessCandidate: () => rejectedAssessment('sector_not_mapped'),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      internalRecordedCredits: 0,
    }),
  };
  return { deps, searchCalls };
}

describe('orquestador · el cursor distingue «mismo plan» de «plan distinto»', () => {
  test('MISMO plan: R1 consume 1,2,3,4 ⇒ R2 pide la 5', async () => {
    const { deps, searchCalls } = planDrivenDeps({
      providerTotalPages: 52,
      planByRound: {
        1: { plan: 'ABC', consumed: [1, 2, 3, 4] },
        2: { plan: 'ABC', consumed: [5] },
      },
    });

    const result = await runApolloTwoRoundDiscovery(
      { config: testConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );

    assert.deepEqual(searchCalls, [
      { roundNumber: 1, page: 1 },
      { roundNumber: 2, page: 5 },
    ]);
    assert.equal(result.round2PageDecision?.netNewCursorPage, 5);
    assert.equal(result.round2PageDecision?.advancedByNetNewCursor, true);
  });

  test('MISMO plan parcial: R1 consume 1,2 ⇒ R2 pide la 3', async () => {
    const { deps, searchCalls } = planDrivenDeps({
      providerTotalPages: 52,
      planByRound: {
        1: { plan: 'ABC', consumed: [1, 2] },
        2: { plan: 'ABC', consumed: [3] },
      },
    });

    await runApolloTwoRoundDiscovery(
      { config: testConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );
    assert.equal(searchCalls[1]?.page, 3);
  });

  test('plan DISTINTO: XYZ no hereda el cursor de ABC y mantiene su propio espacio', async () => {
    const { deps, searchCalls } = planDrivenDeps({
      providerTotalPages: 52,
      planByRound: {
        1: { plan: 'ABC', consumed: [1, 2, 3, 4] },
        2: { plan: 'XYZ', consumed: [1] },
      },
    });

    const result = await runApolloTwoRoundDiscovery(
      { config: testConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );

    assert.equal(
      result.round2PageDecision?.netNewCursorPage,
      1,
      'de XYZ no consta consumo: su universo de páginas empieza en 1',
    );
    assert.notEqual(searchCalls[1]?.page, 5, 'XYZ no puede saltar a la 5 por lo que hizo ABC');
  });

  test('la ronda 2 sí hereda el cursor cuando la ronda 1 llegó de un CHECKPOINT', async () => {
    const { deps, searchCalls } = planDrivenDeps({
      providerTotalPages: 52,
      planByRound: { 2: { plan: 'ABC', consumed: [7] } },
    });

    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig(),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
        resume: {
          rounds: [
            {
              ...buildEmptyRoundMetrics(1, 'ronda 1 recuperada', null, {
                effectiveRequestFingerprint: 'ABC|page=1',
                page: 1,
                searchPlanFingerprint: 'ABC',
              }),
              providerRequestCount: 1,
              providerTotalPages: 52,
              lastConsumedPage: 6,
            },
          ],
          seenIdentities: [],
          candidates: [],
          totalRawResults: 0,
          totalSearchCredits: 6,
          totalEnrichmentCredits: 0,
          enrichmentsExecuted: 0,
          observedRejectionReasons: [],
          secondRoundSkippedReason: null,
        },
      },
      deps,
    );

    assert.equal(
      searchCalls[0]?.page,
      7,
      'la única ronda de este proceso es la 2, y arranca donde el checkpoint dejó el plan',
    );
    assert.equal(result.round2PageDecision?.netNewCursorPage, 7);
  });

  test('un checkpoint ANTERIOR a este hito no aporta cursor y nada cambia', async () => {
    const { deps, searchCalls } = planDrivenDeps({
      providerTotalPages: 52,
      planByRound: { 2: { plan: 'ABC', consumed: [2] } },
    });

    const legacyRound1 = buildEmptyRoundMetrics(1, 'ronda 1 legacy', null, {
      effectiveRequestFingerprint: 'ABC|page=1',
      page: 1,
    }) as Partial<ApolloTwoRoundRoundMetrics>;
    // Un checkpoint escrito antes de este hito simplemente NO trae los dos campos.
    delete legacyRound1.searchPlanFingerprint;
    delete legacyRound1.lastConsumedPage;

    await runApolloTwoRoundDiscovery(
      {
        config: testConfig(),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
        resume: {
          rounds: [
            {
              ...legacyRound1,
              providerRequestCount: 1,
              providerTotalPages: 52,
            } as ApolloTwoRoundRoundMetrics,
          ],
          seenIdentities: [],
          candidates: [],
          totalRawResults: 0,
          totalSearchCredits: 1,
          totalEnrichmentCredits: 0,
          enrichmentsExecuted: 0,
          observedRejectionReasons: [],
          secondRoundSkippedReason: null,
        },
      },
      deps,
    );

    assert.equal(searchCalls[0]?.page, 2, 'sin cursor durable rige el comportamiento previo');
  });
});

// ─── Lectura del metadata que la búsqueda paginada ya publica ─────────────────

describe('lector de consumo · cruza `page_outcomes` con el plan declarado', () => {
  function outputWith(pagination: Record<string, unknown> | null): WebSearchOutput {
    return {
      provider: 'apollo_organizations',
      query: 'q',
      results: [],
      resultsCount: 0,
      skipped: false,
      skipReason: null,
      estimatedCostUsd: 0,
      metadata: pagination === null ? {} : { apollo_pagination: pagination },
    };
  }

  test('lee las páginas consumidas y la huella del plan que la búsqueda declaró', () => {
    const consumption = readApolloSearchPlanPageConsumption(
      outputWith({
        request_fingerprint: 'plan-abc',
        page_outcomes: pageOutcomes([{ page: 1 }, { page: 2 }, { page: 3 }]),
      }),
    );
    assert.deepEqual(consumption?.consumedPages, [1, 2, 3]);
    assert.equal(consumption?.lastConsumedPage, 3);
    assert.equal(consumption?.searchPlanFingerprint, 'plan-abc');
  });

  test('sin `page_outcomes` no hay consumo que leer', () => {
    assert.equal(readApolloSearchPlanPageConsumption(outputWith({ total_pages: 9 })), null);
    assert.equal(readApolloSearchPlanPageConsumption(outputWith(null)), null);
  });

  test('sin huella declarada el consumo se lee igual: la atribuye el llamador', () => {
    const consumption = readApolloSearchPlanPageConsumption(
      outputWith({ page_outcomes: pageOutcomes([{ page: 4 }]) }),
    );
    assert.equal(consumption?.searchPlanFingerprint, null);
    assert.equal(consumption?.lastConsumedPage, 4);
  });

  test('un desenlace sin estado de cobro legible se lee como `unknown`, no como gratis', () => {
    const consumption = readApolloSearchPlanPageConsumption(
      outputWith({
        page_outcomes: [{ page: 6, status: 'error' }],
      }),
    );
    assert.equal(
      consumption?.lastConsumedPage,
      6,
      'sin poder leer el cobro, la página queda consumida: nunca se libera por omisión',
    );
  });
});
