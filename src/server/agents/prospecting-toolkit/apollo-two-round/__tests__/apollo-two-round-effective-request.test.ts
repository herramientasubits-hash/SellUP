/**
 * apollo-two-round-effective-request.test.ts — La decisión de la ronda 2 se toma
 * sobre el request EFECTIVO, no sobre la hipótesis.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2-FIX · § 1, § 2, § 3, § 4, § 10.
 *
 * El defecto que estas pruebas fijan: la modalidad comparaba los términos ANTES de
 * priorizarlos, deduplicarlos y truncarlos a `MAX_KEYWORDS`. Dos hipótesis
 * distintas pueden colapsar al mismo body, y una segunda búsqueda con el mismo body
 * no puede traer un solo resultado nuevo — sólo un segundo cargo.
 *
 * Todo offline y sin dobles del mapper: el request efectivo lo construye la MISMA
 * función que gobierna la llamada real.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloOrganizationsEffectiveRequest,
  type ApolloEffectiveRequest,
} from '../../apollo-organizations-effective-request';
import type { WebSearchInput } from '../../types';
import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type RoundProviderRequestPreview,
} from '../orchestrator';
import {
  buildRound1Hypothesis,
  buildRound2Hypothesis,
  withRequestedPage,
} from '../query-hypothesis';
import { toRoundMetricsMetadata } from '../observability';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  org,
  passingAssessment,
  rejectedAssessment,
} from './fixtures';

// ─── Ayudas ───────────────────────────────────────────────────────────────────

/** El wizard real: supermercados en Colombia, con la subindustria del catálogo. */
const WIZARD_SELECTION = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  subindustries: ['Supermercados e Hipermercados'],
} as const;

/**
 * Construye el request efectivo exactamente como lo hace el adaptador de
 * producción: los términos de la hipótesis entran como `additionalCriteriaTokens` y
 * la subindustria seleccionada por el wizard viaja aparte.
 */
function effectiveRequestFor(options: {
  hypothesisKeywordTags: readonly string[];
  page?: number;
  legacyMaxResultsPerQuery?: number;
  twoRoundMaxResultsPerRound?: number;
  subindustries?: readonly string[];
}): ApolloEffectiveRequest {
  const input: WebSearchInput = {
    query: 'hipótesis legible que nunca viaja al proveedor',
    country: WIZARD_SELECTION.country,
    countryCode: WIZARD_SELECTION.countryCode,
    industry: WIZARD_SELECTION.industry,
    intent: 'company_discovery',
    maxResults: 5,
    provider: 'apollo_organizations',
    subindustries: [...(options.subindustries ?? WIZARD_SELECTION.subindustries)],
    additionalCriteriaTokens: [...options.hypothesisKeywordTags],
  };

  return buildApolloOrganizationsEffectiveRequest({
    input,
    requestedMaxResults: 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: options.twoRoundMaxResultsPerRound ?? 5,
    startPage: options.page ?? 1,
    legacyMaxResultsPerQuery: options.legacyMaxResultsPerQuery ?? 3,
  });
}

// ─── § 1: hipótesis distinta, request efectivo idéntico ───────────────────────

describe('§ 1 · la hipótesis puede diferir y el request efectivo ser el mismo', () => {
  /**
   * El falso negativo exacto del § 3 del encargo.
   *
   * Dos rondas con tres términos cada una, distintas en el tercero. Tras combinarlas
   * con el mapping prioritario de la subindustria y truncar a cinco, las dos envían
   * los MISMOS cinco términos: el tercer término de cada ronda cae fuera del cupo.
   * Comparar hipótesis las declara distintas; comparar el body prueba que no lo son.
   */
  test('1. R1 y R2 difieren en un término que el truncamiento descarta', () => {
    const round1Tags = ['grocery store', 'food retail', 'almacen de cadena'];
    const round2Tags = ['grocery store', 'food retail', 'tienda de descuento'];

    // Las hipótesis SÍ difieren: el tercer término no es el mismo.
    assert.notDeepEqual(round1Tags, round2Tags);

    const round1 = effectiveRequestFor({ hypothesisKeywordTags: round1Tags });
    const round2 = effectiveRequestFor({ hypothesisKeywordTags: round2Tags });

    assert.deepEqual(round1.effectiveKeywordTags, [
      'supermercado',
      'hipermercado',
      'grocery',
      'grocery store',
      'food retail',
    ]);
    assert.deepEqual(round2.effectiveKeywordTags, round1.effectiveKeywordTags);
    assert.equal(round1.page, 1);
    assert.equal(round2.page, 1);
    assert.equal(round1.perPage, 5);
    assert.equal(round2.perPage, 5);

    assert.equal(
      round2.effectiveRequestFingerprint,
      round1.effectiveRequestFingerprint,
      'el body efectivo de las dos rondas es el mismo: no hay nada nuevo que traer',
    );
  });

  test('la huella efectiva incluye los filtros que cambian la respuesta', () => {
    const { effectiveRequestFingerprint } = effectiveRequestFor({
      hypothesisKeywordTags: ['grocery store'],
    });

    for (const expected of [
      'q_organization_keyword_tags=',
      'organization_locations=',
      'page=',
      'per_page=',
    ]) {
      assert.ok(
        effectiveRequestFingerprint.includes(expected),
        `la huella debe incluir ${expected}: ${effectiveRequestFingerprint}`,
      );
    }
  });

  test('la huella efectiva NO incluye el texto humano de la hipótesis', () => {
    const withOneQuery = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'] });
    const other: WebSearchInput = {
      query: 'OTRA descripción legible, completamente distinta',
      country: WIZARD_SELECTION.country,
      countryCode: WIZARD_SELECTION.countryCode,
      industry: WIZARD_SELECTION.industry,
      intent: 'company_discovery',
      maxResults: 5,
      provider: 'apollo_organizations',
      subindustries: [...WIZARD_SELECTION.subindustries],
      additionalCriteriaTokens: ['grocery store'],
    };
    const withAnotherQuery = buildApolloOrganizationsEffectiveRequest({
      input: other,
      requestedMaxResults: 5,
      resultLimitMode: 'two_round',
      twoRoundMaxResultsPerRound: 5,
      startPage: 1,
      legacyMaxResultsPerQuery: 3,
    });

    assert.equal(
      withAnotherQuery.effectiveRequestFingerprint,
      withOneQuery.effectiveRequestFingerprint,
      'el texto de la hipótesis no viaja al proveedor y no puede declarar una ronda distinta',
    );
  });

  test('3. el mismo body con otra página SÍ es otra petición', () => {
    const page1 = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'], page: 1 });
    const page2 = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'], page: 2 });

    assert.equal(page2.page, 2);
    assert.notEqual(page1.effectiveRequestFingerprint, page2.effectiveRequestFingerprint);
    // El ancla idempotente de la búsqueda paginada, en cambio, NO lleva página: la
    // página 2 de los mismos filtros comparte ancla con la 1 a propósito.
    assert.equal(page1.filtersFingerprint, page2.filtersFingerprint);
  });
});

// ─── § 2: construir sin ejecutar ──────────────────────────────────────────────

describe('§ 2 · construir el request no ejecuta nada', () => {
  test('el constructor es puro: no toca el proveedor ni pide créditos', () => {
    // Si construir emitiera una llamada, esta prueba no podría existir sin un
    // transporte inyectado. No lo tiene: el constructor no conoce el transporte.
    const built = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'] });
    assert.ok(built.body.per_page > 0);
    assert.equal(typeof built.effectiveRequestFingerprint, 'string');
  });

  test('dos construcciones con la misma entrada dan la misma huella', () => {
    const a = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store', 'food retail'] });
    const b = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store', 'food retail'] });
    assert.equal(a.effectiveRequestFingerprint, b.effectiveRequestFingerprint);
  });

  test('el orden y la caja de los términos no crean una ronda distinta', () => {
    const a = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store', 'food retail'] });
    const b = effectiveRequestFor({ hypothesisKeywordTags: ['FOOD RETAIL', 'Grocery Store'] });
    assert.equal(a.effectiveRequestFingerprint, b.effectiveRequestFingerprint);
  });
});

// ─── § 3: la ronda 2 se omite cuando enviaría el mismo body ───────────────────

/**
 * Corrida con el orquestador real y un constructor de request efectivo inyectado.
 *
 * `previewByRound` decide qué huella efectiva ve el orquestador en cada ronda. Es la
 * costura que permite fijar el contrato: con huellas efectivas iguales la ronda 2 NO
 * se ejecuta, aunque las hipótesis difieran. Con la implementación anterior —que
 * comparaba hipótesis— esta corrida emitía la segunda búsqueda y la cobraba.
 */
async function runWithPreviews(input: {
  previewByRound: Record<number, RoundProviderRequestPreview | null>;
  organizationsByRound?: Record<number, ReturnType<typeof org>[]>;
  providerTotalPages?: number | null;
  queryContext?: Parameters<typeof testQueryContext>[0];
}) {
  const searchCalls: Array<{ roundNumber: number; page: number }> = [];

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: ({ roundNumber }) => input.previewByRound[roundNumber] ?? null,
    searchRound: async ({ roundNumber, hypothesis }) => {
      searchCalls.push({ roundNumber, page: hypothesis.queryParameters.page });
      const organizations = input.organizationsByRound?.[roundNumber] ?? [];
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
        providerTotalPages: input.providerTotalPages ?? null,
      };
    },
    assessCandidate: () => rejectedAssessment('sector_not_mapped'),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      internalRecordedCredits: 0,
    }),
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig(),
      queryContext: testQueryContext(input.queryContext),
      correlation: testCorrelation(),
    },
    deps,
  );

  return { result, searchCalls };
}

describe('§ 3 · body efectivo igual ⇒ ronda 2 omitida', () => {
  const identical: RoundProviderRequestPreview = {
    effectiveRequestFingerprint: 'organization_locations=colombia|page=1|per_page=5|q_organization_keyword_tags=food retail,grocery,grocery store,hipermercado,supermercado',
    page: 1,
    perPage: 5,
    effectiveKeywordTags: [
      'supermercado',
      'hipermercado',
      'grocery',
      'grocery store',
      'food retail',
    ],
  };

  test('2. ni llamada, ni fila de uso, ni crédito de la ronda 2', async () => {
    const { result, searchCalls } = await runWithPreviews({
      previewByRound: { 1: identical, 2: identical },
      organizationsByRound: { 1: [org('uno'), org('dos'), org('tres')] },
    });

    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
    assert.equal(searchCalls.length, 1, 'la segunda búsqueda no debe emitirse');
    assert.equal(result.roundsExecuted, 1);
    assert.equal(result.rounds.length, 1);
    assert.equal(
      result.runMetrics.totalSearchCredits,
      3,
      'sólo el gasto de la ronda 1 queda registrado',
    );
    // La ronda 2 no puede aparecer como ejecutada en ninguna métrica.
    assert.equal(result.rounds.some((round) => round.roundNumber === 2), false);
  });

  test('la hipótesis de la ronda 2 difiere y aun así se omite', async () => {
    const round1 = buildRound1Hypothesis(testQueryContext(), 5);
    const round2 = buildRound2Hypothesis(
      testQueryContext(),
      { remainingTarget: 5, excludedSeenOrganizationCount: 3, observedRejectionReasons: [] },
      5,
    );

    // Las hipótesis difieren de verdad: el criterio anterior habría ejecutado.
    assert.notEqual(round2.providerRequestFingerprint, round1.providerRequestFingerprint);
    assert.equal(round2.differsFromRound1, true);

    const { result, searchCalls } = await runWithPreviews({
      previewByRound: { 1: identical, 2: identical },
      organizationsByRound: { 1: [org('uno')] },
    });

    assert.equal(searchCalls.length, 1);
    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
  });

  test('con huellas efectivas distintas la ronda 2 SÍ se ejecuta', async () => {
    const { result, searchCalls } = await runWithPreviews({
      previewByRound: {
        1: identical,
        2: { ...identical, effectiveRequestFingerprint: `${identical.effectiveRequestFingerprint}|variante` },
      },
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
    });

    assert.equal(searchCalls.length, 2);
    assert.equal(result.secondRoundSkippedReason, null);
  });

  test('sin constructor de request efectivo la ronda 2 NO se ejecuta y se nombra la causa', async () => {
    /**
     * HARDENING-3 § 3 — el respaldo silencioso a la huella de HIPÓTESIS desapareció.
     *
     * Antes, sin constructor efectivo la corrida caía a comparar hipótesis y podía
     * autorizar una segunda llamada pagada cuya diversidad nadie había demostrado.
     * Ahora la ronda 1 se conserva íntegra y la ronda 2 se omite con su causa
     * propia: `effective_request_fingerprint_unavailable`, NUNCA
     * `identical_provider_request` —que afirmaría que los dos bodies son iguales— ni
     * «las hipótesis difieren», que autorizaría el gasto.
     */
    const { result, searchCalls } = await runWithPreviews({
      previewByRound: {},
      queryContext: { sector: 'Sector Inexistente', subindustry: null, targetLocations: [] },
      organizationsByRound: { 1: [org('uno')] },
    });

    assert.equal(searchCalls.length, 1, 'ni una llamada de la ronda 2');
    assert.equal(
      result.secondRoundSkippedReason,
      'effective_request_fingerprint_unavailable',
    );
    assert.equal(
      result.effectiveFingerprintsAreDistinct,
      null,
      'desconocido se reporta null, no false',
    );
    // La ronda 1 y su gasto siguen intactos.
    assert.equal(result.roundsExecuted, 1);
    assert.equal(result.runMetrics.totalSearchCredits, 1);
  });
});

// ─── § 4: página 2 sólo cuando el proveedor la declara ────────────────────────

/**
 * Corrida con el orquestador real y el constructor de request efectivo REAL.
 *
 * Sin dobles: la huella de cada ronda sale de `buildApolloOrganizationsEffectiveRequest`,
 * la misma función que gobierna la llamada. Con un sector sin señales las dos rondas
 * proponen los mismos términos, así que la única variante posible es la página.
 */
async function runWithRealBuilder(input: {
  providerTotalPages?: number | null;
  organizationsByRound?: Record<number, ReturnType<typeof org>[]>;
}) {
  const searchCalls: Array<{ roundNumber: number; page: number; fingerprint: string }> = [];
  const previews = new Map<number, RoundProviderRequestPreview>();

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: ({ roundNumber, hypothesis, requestedResultLimit }) => {
      const effective = effectiveRequestFor({
        hypothesisKeywordTags: hypothesis.queryParameters.keywordTags,
        page: hypothesis.queryParameters.page,
        twoRoundMaxResultsPerRound: requestedResultLimit,
        // Sin subindustria del catálogo: la consulta queda gobernada por el sector,
        // que en este escenario no aporta señales. Es el caso en que la única
        // variante que puede quedar es otra página.
        subindustries: [],
      });
      const preview: RoundProviderRequestPreview = {
        effectiveRequestFingerprint: effective.effectiveRequestFingerprint,
        page: effective.page,
        perPage: effective.perPage,
        effectiveKeywordTags: effective.effectiveKeywordTags,
      };
      previews.set(roundNumber, preview);
      return preview;
    },
    searchRound: async ({ roundNumber, hypothesis }) => {
      searchCalls.push({
        roundNumber,
        page: hypothesis.queryParameters.page,
        fingerprint: previews.get(roundNumber)?.effectiveRequestFingerprint ?? '',
      });
      const organizations = input.organizationsByRound?.[roundNumber] ?? [];
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
        providerTotalPages: input.providerTotalPages ?? null,
      };
    },
    assessCandidate: () => rejectedAssessment('sector_not_mapped'),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      internalRecordedCredits: 0,
    }),
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig(),
      // Sector fuera del catálogo de señales: ninguna ronda aporta términos propios.
      queryContext: testQueryContext({
        sector: 'Sector Inexistente',
        subindustry: null,
        targetLocations: [],
      }),
      correlation: testCorrelation(),
    },
    deps,
  );

  return { result, searchCalls };
}

describe('§ 4 · la página 2 es variante válida sólo si el proveedor la declara', () => {
  test('4. con total_pages >= 2 la ronda 2 pide la página 2 y las huellas difieren', async () => {
    const { result, searchCalls } = await runWithRealBuilder({
      providerTotalPages: 3,
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
    });

    assert.equal(searchCalls.length, 2);
    assert.equal(searchCalls[0].page, 1);
    assert.equal(searchCalls[1].page, 2, 'la ronda 2 debe pedir otra página, no repetir la 1');
    assert.notEqual(searchCalls[1].fingerprint, searchCalls[0].fingerprint);
    assert.equal(result.secondRoundSkippedReason, null);

    const round2 = result.rounds.find((round) => round.roundNumber === 2);
    assert.ok(round2);
    assert.equal(round2.page, 2);
  });

  test('con total_pages = 1 no se pide una página que no existe', async () => {
    const { result, searchCalls } = await runWithRealBuilder({
      providerTotalPages: 1,
      organizationsByRound: { 1: [org('uno')] },
    });

    assert.equal(searchCalls.length, 1);
    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
  });

  test('sin total_pages declarado tampoco se intenta la página 2', async () => {
    const { result, searchCalls } = await runWithRealBuilder({
      providerTotalPages: null,
      organizationsByRound: { 1: [org('uno')] },
    });

    assert.equal(searchCalls.length, 1);
    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
  });

  test('withRequestedPage es inmutable y recalcula la huella', () => {
    const round2 = buildRound2Hypothesis(
      testQueryContext(),
      { remainingTarget: 5, excludedSeenOrganizationCount: 0, observedRejectionReasons: [] },
      5,
    );
    const onPage2 = withRequestedPage(round2, 2, round2.providerRequestFingerprint);

    assert.equal(round2.queryParameters.page, 1, 'el original no se muta');
    assert.equal(onPage2.queryParameters.page, 2);
    assert.notEqual(onPage2.providerRequestFingerprint, round2.providerRequestFingerprint);
    assert.equal(onPage2.variantStrategy, 'same_query_next_page');
    assert.ok(onPage2.queryAdaptationReason?.includes('pagina_2_de_la_misma_busqueda'));
    assert.equal(onPage2.differsFromRound1, true);
  });
});

// ─── § 10: observabilidad de las dos huellas ──────────────────────────────────

describe('§ 10 · la observabilidad distingue hipótesis de request efectivo', () => {
  test('14. cada ronda registra su huella de hipótesis y su huella efectiva', async () => {
    const { result } = await runWithRealBuilder({
      providerTotalPages: 4,
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
    });

    for (const round of result.rounds) {
      assert.ok(
        typeof round.providerRequestFingerprint === 'string' &&
          round.providerRequestFingerprint.length > 0,
        `la ronda ${round.roundNumber} debe registrar su huella de hipótesis`,
      );
      assert.ok(
        typeof round.effectiveProviderFingerprint === 'string' &&
          round.effectiveProviderFingerprint.length > 0,
        `la ronda ${round.roundNumber} debe registrar su huella efectiva`,
      );
      assert.notEqual(
        round.effectiveProviderFingerprint,
        round.providerRequestFingerprint,
        'las dos huellas miden cosas distintas y no pueden confundirse',
      );
      assert.equal(round.perPage, 5);
      assert.ok(Array.isArray(round.effectiveKeywordsSent));
    }

    const [round1, round2] = result.rounds;
    assert.notEqual(round1.effectiveProviderFingerprint, round2.effectiveProviderFingerprint);
  });

  test('la metadata nombra las dos huellas por separado', async () => {
    const { result } = await runWithRealBuilder({
      providerTotalPages: 4,
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
    });

    const metadata = toRoundMetricsMetadata(result.rounds[0]);
    assert.equal(metadata['hypothesis_fingerprint'], result.rounds[0].providerRequestFingerprint);
    assert.equal(
      metadata['effective_provider_fingerprint'],
      result.rounds[0].effectiveProviderFingerprint,
    );
    assert.equal(metadata['per_page'], 5);
    assert.ok(Array.isArray(metadata['effective_keywords_sent']));
  });

  test('una ronda sin request efectivo declara null, no la huella de hipótesis', async () => {
    const { result } = await runWithPreviews({
      previewByRound: {},
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
    });

    const round1 = result.rounds.find((round) => round.roundNumber === 1);
    assert.ok(round1);
    assert.equal(
      round1.effectiveProviderFingerprint,
      null,
      'ausencia de dato no puede leerse como igualdad',
    );
  });

  test('la invariante de métricas se mantiene con la ronda 2 omitida', async () => {
    const identical: RoundProviderRequestPreview = {
      effectiveRequestFingerprint: 'misma-huella',
      page: 1,
      perPage: 5,
      effectiveKeywordTags: ['supermercado'],
    };
    const { result } = await runWithPreviews({
      previewByRound: { 1: identical, 2: identical },
      organizationsByRound: { 1: [org('uno'), org('dos')] },
    });

    for (const round of result.rounds) {
      assert.ok(
        round.newUniqueResults + round.seenDuplicates <= round.normalizedResults,
        `ronda ${round.roundNumber}: ${round.newUniqueResults}+${round.seenDuplicates} > ${round.normalizedResults}`,
      );
    }
  });

  test('el objetivo sigue alcanzable cuando la ronda 2 sí aporta', async () => {
    const supermarkets = (prefix: string, count: number) =>
      Array.from({ length: count }, (_unused, index) =>
        org(`${prefix}${index + 1}`, { providerRank: index + 1 }),
      );

    const searchCalls: number[] = [];
    const deps: ApolloTwoRoundDeps = {
      buildRoundProviderRequest: ({ roundNumber }) => ({
        effectiveRequestFingerprint: `huella-ronda-${roundNumber}`,
        page: 1,
        perPage: 5,
        effectiveKeywordTags: ['supermercado'],
      }),
      searchRound: async ({ roundNumber }) => {
        searchCalls.push(roundNumber);
        const organizations =
          roundNumber === 1 ? supermarkets('r1-', 3) : supermarkets('r2-', 2);
        return {
          organizations,
          providerRequestCount: 1,
          internalRecordedCredits: organizations.length,
          providerTotalPages: 2,
        };
      },
      assessCandidate: () => passingAssessment(),
      enrichCandidate: async () => ({
        executed: false,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
        internalRecordedCredits: 0,
      }),
    };

    const result = await runApolloTwoRoundDiscovery(
      { config: testConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );

    assert.deepEqual(searchCalls, [1, 2]);
    assert.equal(result.eligibleCompaniesFound, 5);
    assert.equal(result.targetReached, true);
    assert.equal(result.persistedCandidates, 5);
  });
});
