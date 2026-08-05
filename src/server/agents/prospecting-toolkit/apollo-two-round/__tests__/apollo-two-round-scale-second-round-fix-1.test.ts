/**
 * apollo-two-round-scale-second-round-fix-1.test.ts
 *
 * AGENT1-APOLLO-SCALE-AND-SECOND-ROUND-FIX-1.
 *
 * Cubre lo que las suites existentes de dos rondas NO ejercitaban todavía:
 *
 *   § 1 — el reintento página 1 → página 2 cuando la hipótesis de la ronda 2
 *         DIFIERE de la de la ronda 1, pero el request EFECTIVO (después de
 *         prioridad, dedupe y truncamiento) colapsa al mismo body. Es el defecto
 *         comprobado: dos hipótesis distintas que Apollo recibe como la misma
 *         petición, cobrada dos veces sin aportar nada nuevo.
 *   § 2 — los nuevos topes absolutos (10/20/5) y que, SIN variables de entorno
 *         nuevas, el comportamiento por defecto no cambia.
 *   § 4 — el desglose granular de duplicados (SellUp / HubSpot / cooldown) y las
 *         tres cubetas del desenlace de enrichment (confirmado / aún sin
 *         confirmar / fallido).
 *
 * Offline: sin red, sin Apollo, sin Supabase, sin créditos reales.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type RoundProviderRequestPreview,
} from '../orchestrator';
import {
  resolveApolloTwoRoundConfig,
  defaultApolloTwoRoundConfig,
  MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX,
  MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX,
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
  TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
} from '../config';
import { estimateApolloTwoRoundBudget } from '../budget';
import { buildRunMetrics, type EnrichmentOutcome } from '../observability';
import { testConfig, testCorrelation, testQueryContext, org, rejectedAssessment } from './fixtures';

// ─── § 1 · colapso de truncamiento: la única variante que queda es la página ──

/**
 * Constructor simulado cuyo "mapper" converge SIEMPRE a los mismos tres
 * términos canónicos, sin importar qué proponga la hipótesis — exactamente lo
 * que hace un mapper real con prioridad y truncamiento cuando los sinónimos de
 * la ronda 2 no sobreviven al tope de términos. Así se puede demostrar que la
 * hipótesis difiere (`differsFromRound1 === true`) y el body efectivo, aun así,
 * es idéntico.
 */
function collapsingEffectiveRequestBuilder(): NonNullable<
  ApolloTwoRoundDeps['buildRoundProviderRequest']
> {
  const CANONICAL_TAGS = ['grocery', 'hipermercado', 'supermercado'];
  return ({ hypothesis, requestedResultLimit }) => {
    const page = hypothesis.queryParameters.page;
    const preview: RoundProviderRequestPreview = {
      effectiveRequestFingerprint: `q_organization_keyword_tags=${CANONICAL_TAGS.join(',')}|page=${page}|per_page=${requestedResultLimit}`,
      page,
      perPage: requestedResultLimit,
      effectiveKeywordTags: CANONICAL_TAGS,
    };
    return preview;
  };
}

function buildDeps(input: {
  providerTotalPages: number | null;
  organizationsByRound: Record<number, ReturnType<typeof org>[]>;
}): { deps: ApolloTwoRoundDeps; searchCalls: Array<{ roundNumber: number; page: number }> } {
  const searchCalls: Array<{ roundNumber: number; page: number }> = [];
  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: collapsingEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber, hypothesis }) => {
      searchCalls.push({ roundNumber, page: hypothesis.queryParameters.page });
      const organizations = input.organizationsByRound[roundNumber] ?? [];
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
        providerTotalPages: input.providerTotalPages,
      };
    },
    assessCandidate: () => rejectedAssessment('sector_not_mapped'),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      internalRecordedCredits: 0,
    }),
  };
  return { deps, searchCalls };
}

describe('§ 1 · hipótesis distinta + truncamiento idéntico ⇒ decide el proveedor, no el texto', () => {
  test('total_pages >= 2 ⇒ la ronda 2 reintenta como página 2, exactamente una llamada nueva', async () => {
    const { deps, searchCalls } = buildDeps({
      providerTotalPages: 3,
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
    });

    const result = await runApolloTwoRoundDiscovery(
      { config: testConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );

    assert.equal(searchCalls.length, 2, 'nunca más de dos búsquedas');
    assert.equal(searchCalls[0].page, 1);
    assert.equal(searchCalls[1].page, 2, 'la ronda 2 debe reintentar como página 2');
    assert.equal(result.secondRoundSkippedReason, null);
    assert.equal(result.effectiveFingerprintsAreDistinct, true);
    assert.equal(result.rounds[1].page, 2);
  });

  test('total_pages = 1 ⇒ no hay llamada de ronda 2, motivo explícito, cero gasto extra', async () => {
    const { deps, searchCalls } = buildDeps({
      providerTotalPages: 1,
      organizationsByRound: { 1: [org('uno')] },
    });

    const result = await runApolloTwoRoundDiscovery(
      { config: testConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );

    assert.equal(searchCalls.length, 1, 'pedir una página que no existe no está permitido');
    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
    assert.equal(result.effectiveFingerprintsAreDistinct, false);
    assert.equal(result.runMetrics.totalSearchCredits, 1);
  });

  test('total_pages ausente ⇒ tampoco se intenta la página 2', async () => {
    const { deps, searchCalls } = buildDeps({
      providerTotalPages: null,
      organizationsByRound: { 1: [org('uno')] },
    });

    const result = await runApolloTwoRoundDiscovery(
      { config: testConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );

    assert.equal(searchCalls.length, 1);
    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
  });

  test('la ronda 2 en página 2 que trae duplicados reales no crea candidatos ni enrichments repetidos', async () => {
    // La organización 'uno' reaparece en la página 2: debe filtrarse localmente
    // una sola vez, sin volver a evaluarse ni a competir por un enrichment.
    const { deps, searchCalls } = buildDeps({
      providerTotalPages: 3,
      organizationsByRound: {
        1: [org('uno')],
        2: [org('uno'), org('dos')],
      },
    });

    const result = await runApolloTwoRoundDiscovery(
      { config: testConfig(), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );

    assert.equal(searchCalls.length, 2);
    const trackedKeys = result.evaluatedCandidates.map((c) => c.candidateKey);
    const unoOccurrences = trackedKeys.filter((key) => key.includes('uno')).length;
    assert.equal(unoOccurrences, 1, "'uno' sólo debe evaluarse una vez en toda la corrida");
    assert.equal(result.rounds[1].seenDuplicates, 1, 'la repetición se cuenta, no se descarta en silencio');
  });
});

// ─── § 2 · topes absolutos elevados, comportamiento por defecto intacto ───────

describe('§ 2 · topes absolutos 10/20/5, sin cambiar el comportamiento por defecto', () => {
  test('los topes absolutos son los del hito', () => {
    assert.equal(MAX_RESULTS_PER_ROUND_ABSOLUTE_MAX, 10);
    assert.equal(MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX, 20);
    assert.equal(MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX, 5);
    assert.equal(TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX, 5);
    assert.equal(MAX_SEARCH_ROUNDS_ABSOLUTE_MAX, 2);
  });

  test('sin overrides de entorno la config resuelta sigue siendo 5/2/5/10/2', () => {
    const resolved = defaultApolloTwoRoundConfig();
    assert.deepEqual(resolved, {
      targetEligibleCompanies: 5,
      maxRounds: 2,
      maxResultsPerRound: 5,
      maxRawResultsPerRun: 10,
      maxEnrichmentsPerRun: 2,
    });
    assert.equal(estimateApolloTwoRoundBudget(resolved).maximumInternalRecordedCredits, 12);
  });

  test('con overrides al nuevo techo, la config resuelve 5/2/10/20/5 y el máximo son 25 créditos', () => {
    const { config } = resolveApolloTwoRoundConfig({
      targetEligibleCompanies: '5',
      maxRounds: '2',
      maxResultsPerRound: '10',
      maxRawResultsPerRun: '20',
      maxEnrichmentsPerRun: '5',
    });

    assert.deepEqual(config, {
      targetEligibleCompanies: 5,
      maxRounds: 2,
      maxResultsPerRound: 10,
      maxRawResultsPerRun: 20,
      maxEnrichmentsPerRun: 5,
    });

    const budget = estimateApolloTwoRoundBudget(config);
    assert.equal(budget.searchRound1Maximum, 10);
    assert.equal(budget.searchRound2Maximum, 10);
    assert.equal(budget.enrichmentMaximum, 5);
    assert.equal(budget.maximumInternalRecordedCredits, 25);
  });

  test('un override que exceda el nuevo techo se acota a él, nunca lo supera', () => {
    const { config, sources } = resolveApolloTwoRoundConfig({
      maxResultsPerRound: '999',
      maxRawResultsPerRun: '999',
      maxEnrichmentsPerRun: '999',
    });

    assert.equal(config.maxResultsPerRound, 10);
    assert.equal(config.maxRawResultsPerRun, 20);
    assert.equal(config.maxEnrichmentsPerRun, 5);
    assert.equal(sources.maxResultsPerRound, 'env_clamped_to_absolute_max');
  });
});

// ─── § 4 · granularidad de duplicados y desenlace de enrichment ───────────────

describe('§ 4 · duplicados por fuente, separados', () => {
  test('SellUp, HubSpot y cooldown se cuentan por separado y suman al agregado', async () => {
    const deps: ApolloTwoRoundDeps = {
      buildRoundProviderRequest: collapsingEffectiveRequestBuilder(),
      searchRound: async ({ roundNumber }) => ({
        organizations: roundNumber === 1 ? [org('a'), org('b'), org('c')] : [],
        providerRequestCount: 1,
        internalRecordedCredits: roundNumber === 1 ? 3 : 0,
        providerTotalPages: 1,
      }),
      assessCandidate: async ({ organization }) => {
        if (organization.providerOrganizationId === 'a') {
          return rejectedAssessment('duplicate_in_sellup');
        }
        if (organization.providerOrganizationId === 'b') {
          return rejectedAssessment('duplicate_in_hubspot');
        }
        return rejectedAssessment('cooldown_or_prior_suggestion');
      },
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

    const round1 = result.rounds[0];
    assert.equal(round1.duplicateInSellUp, 1);
    assert.equal(round1.duplicateInHubSpot, 1);
    assert.equal(round1.cooldownOrPriorSuggestion, 1);
    assert.equal(
      round1.knownCompanyDuplicates,
      round1.duplicateInSellUp + round1.duplicateInHubSpot + round1.cooldownOrPriorSuggestion,
      'el agregado sigue siendo la suma de los tres',
    );
  });
});

describe('§ 4 · el desenlace de enrichment se registra en tres cubetas mutuamente excluyentes', () => {
  function outcomesFixture(): EnrichmentOutcome[] {
    return [
      { candidateKey: 'confirmed', enrichmentExecuted: true, finallyRejectedOrDuplicated: false },
      { candidateKey: 'still-unconfirmed', enrichmentExecuted: true, finallyRejectedOrDuplicated: true },
    ];
  }

  test('las tres cifras viajan en runMetrics y en su metadata, sin mezclarse', () => {
    const metrics = buildRunMetrics({
      rounds: [],
      totalUniqueOrganizations: 3,
      totalEligibleCompanies: 1,
      persistedCandidates: 1,
      totalSearchCredits: 5,
      totalEnrichmentCredits: 3,
      enrichmentOutcomes: outcomesFixture(),
      sectorConfirmedByEnrichment: 1,
      sectorStillUnconfirmedAfterEnrichment: 1,
      enrichmentFailedCount: 1,
    });

    assert.equal(metrics.sectorConfirmedByEnrichment, 1);
    assert.equal(metrics.sectorStillUnconfirmedAfterEnrichment, 1);
    assert.equal(metrics.enrichmentFailedCount, 1);
  });

  test('ausentes ⇒ cero, nunca undefined', () => {
    const metrics = buildRunMetrics({
      rounds: [],
      totalUniqueOrganizations: 0,
      totalEligibleCompanies: 0,
      persistedCandidates: 0,
      totalSearchCredits: 0,
      totalEnrichmentCredits: 0,
      enrichmentOutcomes: [],
    });

    assert.equal(metrics.sectorConfirmedByEnrichment, 0);
    assert.equal(metrics.sectorStillUnconfirmedAfterEnrichment, 0);
    assert.equal(metrics.enrichmentFailedCount, 0);
  });

  test('el orquestador clasifica confirmado / aún sin confirmar / fallido, sin doble conteo', async () => {
    // Tres candidatos ambiguos compiten por enrichment: uno confirma sector, uno
    // sigue sin confirmarse, y uno no devuelve evidencia utilizable (no_match).
    const deps: ApolloTwoRoundDeps = {
      buildRoundProviderRequest: collapsingEffectiveRequestBuilder(),
      searchRound: async ({ roundNumber }) => ({
        organizations: roundNumber === 1 ? [org('confirma'), org('sigue-sin'), org('sin-match')] : [],
        providerRequestCount: 1,
        internalRecordedCredits: roundNumber === 1 ? 3 : 0,
        providerTotalPages: 1,
      }),
      assessCandidate: async () => ({
        rejection: null,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
        noPriorSuggestion: true,
        signals: {
          countryCompatible: true,
          domainConfident: true,
          ownershipConfident: true,
          sectorKeywordMatchCount: 0,
          novel: true,
          hasCompanySizeSignal: false,
          hasLocationSignal: false,
          hasLinkedInUrl: false,
          freeOfContradictoryEvidence: true,
          knownDuplicate: false,
          cooldownActive: false,
        },
      }),
      enrichCandidate: async ({ candidateKey }) => {
        if (candidateKey.includes('confirma')) {
          return {
            executed: true,
            sectorEvidenceState: 'sector_evidence_confirmed',
            internalRecordedCredits: 1,
          };
        }
        if (candidateKey.includes('sigue-sin')) {
          return {
            executed: true,
            sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
            internalRecordedCredits: 1,
          };
        }
        return {
          executed: false,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          internalRecordedCredits: 1,
          noMatch: true,
        };
      },
    };

    const result = await runApolloTwoRoundDiscovery(
      { config: testConfig({ maxEnrichmentsPerRun: 3 }), queryContext: testQueryContext(), correlation: testCorrelation() },
      deps,
    );

    assert.equal(result.runMetrics.sectorConfirmedByEnrichment, 1);
    assert.equal(result.runMetrics.sectorStillUnconfirmedAfterEnrichment, 1);
    assert.equal(result.runMetrics.enrichmentFailedCount, 1);
  });
});
