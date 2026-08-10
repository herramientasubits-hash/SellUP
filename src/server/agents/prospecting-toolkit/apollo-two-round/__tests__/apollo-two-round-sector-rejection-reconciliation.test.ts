/**
 * apollo-two-round-sector-rejection-reconciliation.test.ts
 *
 * AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § B.5 / § B.6.
 *
 * Defecto: cuando el enrichment revelaba una contradicción sectorial SIN que el
 * proveedor emitiera un `postEnrichmentRejection`, el orquestador marcaba el
 * rechazo definitivo pero NO lo contabilizaba en el desglose de la ronda. La
 * empresa desaparecía del desglose: en la corrida `7d92773b` la ronda 2 cerró
 * con 7 duplicados + 2 ownership = 9 sobre 10 empresas únicas, y `run_metrics`
 * decía `sector_rejected_after_enrichment: 1`.
 *
 * TODO offline: proveedor, evaluación y enrichment entran por inyección.
 * LIVE_APOLLO_CALLS = 0, APOLLO_CREDITS_USED = 0.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runApolloTwoRoundDiscovery } from '../orchestrator';
import type { ApolloTwoRoundRoundMetrics } from '../observability';
import { computeUniqueResultReconciliation } from '@/modules/prospect-batches/chat-wizard-execution/wizard-no-new-candidates-copy';
import {
  ambiguousAssessment,
  org,
  passingAssessment,
  rejectedAssessment,
  simulatedEffectiveRequestBuilder,
  testConfig,
  testCorrelation,
  testQueryContext,
} from './fixtures';

/** Suma las disposiciones finales de una ronda, tal como las lee la UI. */
function roundDispositions(round: ApolloTwoRoundRoundMetrics): number {
  return (
    round.knownCompanyDuplicates +
    round.countryRejected +
    round.sectorRejected +
    round.ownershipRejected
  );
}

describe('§ B.5 — el rechazo sectorial posterior al enrichment se contabiliza', () => {
  test('una contradicción revelada por el enrichment incrementa sector_rejected de su ronda', async () => {
    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig({ targetEligibleCompanies: 5, maxRounds: 1 }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      {
        searchRound: async () => ({
          organizations: [org('contradictoria', { providerRank: 1 })],
          providerRequestCount: 1,
          internalRecordedCredits: 1,
        }),
        assessCandidate: () => ambiguousAssessment(),
        // Sin `postEnrichmentRejection`: es EXACTAMENTE el camino que no se
        // contabilizaba. La contradicción llega sólo en el estado de evidencia.
        enrichCandidate: async () => ({
          executed: true,
          sectorEvidenceState: 'sector_evidence_contradictory',
          internalRecordedCredits: 1,
        }),
      },
    );

    const round1 = result.rounds.find((round) => round.roundNumber === 1);
    assert.equal(round1?.sectorRejected, 1);
    assert.equal(result.runMetrics.sectorRejectedAfterEnrichment, 1);
    assert.equal(result.eligibleCompaniesFound, 0);
    // El desglose de la ronda cierra contra su única empresa.
    assert.equal(roundDispositions(round1!), round1!.newUniqueResults);
  });

  test('no hay doble conteo cuando el proveedor YA emitió el rechazo sectorial', async () => {
    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig({ targetEligibleCompanies: 5, maxRounds: 1 }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      {
        searchRound: async () => ({
          organizations: [org('contradictoria', { providerRank: 1 })],
          providerRequestCount: 1,
          internalRecordedCredits: 1,
        }),
        assessCandidate: () => ambiguousAssessment(),
        enrichCandidate: async () => ({
          executed: true,
          sectorEvidenceState: 'sector_evidence_contradictory',
          postEnrichmentRejection: 'sector_evidence_contradictory',
          internalRecordedCredits: 1,
        }),
      },
    );

    // UNA vez, no dos: la rama de `postEnrichmentRejection` tallya y corta.
    assert.equal(result.rounds[0]?.sectorRejected, 1);
  });

  test('un candidato que sigue ambiguo tras el enrichment NO se cuenta como rechazo sectorial', async () => {
    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig({ targetEligibleCompanies: 5, maxRounds: 1 }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      {
        searchRound: async () => ({
          organizations: [org('ambigua', { providerRank: 1 })],
          providerRequestCount: 1,
          internalRecordedCredits: 1,
        }),
        assessCandidate: () => ambiguousAssessment(),
        enrichCandidate: async () => ({
          executed: true,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          internalRecordedCredits: 1,
        }),
      },
    );

    assert.equal(result.rounds[0]?.sectorRejected, 0);
    assert.equal(result.runMetrics.sectorRejectedAfterEnrichment, 0);
    // Sigue siendo cohorte de revisión: ni elegible ni rechazado definitivo.
    assert.equal(result.reviewOnly.length, 1);
  });
});

describe('§ C — un reintento posterior a la escritura no compra otra ronda', () => {
  /**
   * Garantía de GASTO. Antes se sostenía por accidente: el checkpoint conservaba
   * un `eligible` previo a los gates finales, así que un reintento creía el
   * objetivo alcanzado y paraba solo. Con el estado final ya autoritativo
   * (§ C.8) esa creencia desaparece, y la garantía es ahora explícita.
   */
  test('con `candidatesPersisted` recuperado, ninguna ronda nueva llega al proveedor', async () => {
    let searchCalls = 0;
    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig({ targetEligibleCompanies: 5, maxRounds: 2 }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
        resume: {
          seenIdentities: [],
          candidates: [],
          rounds: [],
          totalRawResults: 0,
          totalSearchCredits: 0,
          totalEnrichmentCredits: 0,
          enrichmentsExecuted: 0,
          observedRejectionReasons: [],
          candidatesPersisted: true,
        },
      },
      {
        buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
        searchRound: async () => {
          searchCalls++;
          return {
            organizations: [org('nueva', { providerRank: 1 })],
            providerRequestCount: 1,
            internalRecordedCredits: 10,
          };
        },
        assessCandidate: () => passingAssessment(),
        enrichCandidate: async () => {
          throw new Error('no debe enriquecerse');
        },
      },
    );

    assert.equal(searchCalls, 0, 'cero llamadas al proveedor en el reintento');
    assert.equal(result.rounds.length, 0);
    assert.equal(result.runMetrics.totalSearchCredits, 0);
  });
});

describe('§ B.6 — el desglose reconcilia contra el total de empresas únicas', () => {
  /**
   * Reproducción de la corrida `7d92773b`, con sus cifras exactas:
   *
   *   20 únicas · 8 HubSpot · 7 cooldown · 1 país · 3 ownership · 1 sector · 0 persistidas
   *
   * Ronda 1 (10): 4 HubSpot, 4 cooldown, 1 país, 1 ownership.
   * Ronda 2 (10): 4 HubSpot, 3 cooldown, 2 ownership, 1 contradictoria tras enrichment.
   */
  test('la corrida de referencia cierra en 20/20 y deja 0 sin clasificar', async () => {
    const roundOne = [
      ...Array.from({ length: 4 }, (_u, i) => org(`r1hs${i}`, { providerRank: i + 1 })),
      ...Array.from({ length: 4 }, (_u, i) => org(`r1cd${i}`, { providerRank: i + 5 })),
      org('r1country', { providerRank: 9 }),
      org('r1own', { providerRank: 10 }),
    ];
    const roundTwo = [
      ...Array.from({ length: 4 }, (_u, i) => org(`r2hs${i}`, { providerRank: i + 1 })),
      ...Array.from({ length: 3 }, (_u, i) => org(`r2cd${i}`, { providerRank: i + 5 })),
      org('r2own1', { providerRank: 8 }),
      org('r2own2', { providerRank: 9 }),
      org('r2sector', { providerRank: 10 }),
    ];

    const result = await runApolloTwoRoundDiscovery(
      {
        config: testConfig({
          targetEligibleCompanies: 10,
          maxRounds: 2,
          maxResultsPerRound: 10,
          maxRawResultsPerRun: 20,
          maxEnrichmentsPerRun: 5,
        }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      {
        buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
        searchRound: async ({ roundNumber }) => ({
          organizations: roundNumber === 1 ? roundOne : roundTwo,
          providerRequestCount: 1,
          internalRecordedCredits: 10,
        }),
        assessCandidate: ({ organization }) => {
          const id = organization.providerOrganizationId ?? '';
          if (id.includes('hs')) return rejectedAssessment('duplicate_in_hubspot');
          if (id.includes('cd')) return rejectedAssessment('cooldown_or_prior_suggestion');
          if (id.includes('country')) return rejectedAssessment('country_incompatible');
          if (id.includes('own')) return rejectedAssessment('ownership_mismatch');
          if (id.includes('sector')) return ambiguousAssessment();
          return passingAssessment();
        },
        enrichCandidate: async () => ({
          executed: true,
          sectorEvidenceState: 'sector_evidence_contradictory',
          internalRecordedCredits: 1,
        }),
      },
    );

    assert.equal(result.runMetrics.totalUniqueOrganizations, 20);
    assert.equal(result.persisted.length, 0);
    assert.equal(result.reviewOnly.length, 0);

    const totals = result.rounds.reduce(
      (acc, round) => ({
        hubspot: acc.hubspot + round.duplicateInHubSpot,
        cooldown: acc.cooldown + round.cooldownOrPriorSuggestion,
        country: acc.country + round.countryRejected,
        ownership: acc.ownership + round.ownershipRejected,
        sector: acc.sector + round.sectorRejected,
      }),
      { hubspot: 0, cooldown: 0, country: 0, ownership: 0, sector: 0 },
    );

    assert.deepEqual(totals, {
      hubspot: 8,
      cooldown: 7,
      country: 1,
      ownership: 3,
      sector: 1,
    });

    const reconciliation = computeUniqueResultReconciliation({
      uniqueResultsCount: result.runMetrics.totalUniqueOrganizations,
      hubspotDuplicateCount: totals.hubspot,
      sellupDuplicateCount: 0,
      cooldownCount: totals.cooldown,
      countryRejectedCount: totals.country,
      sectorRejectedCount: totals.sector,
      ownershipRejectedCount: totals.ownership,
      candidatesCreatedCount: 0,
    });

    assert.equal(reconciliation.classifiedUniqueResults, 20);
    assert.equal(reconciliation.unclassifiedUniqueResults, 0);
    assert.equal(reconciliation.overCountedUniqueResults, 0);
  });
});
