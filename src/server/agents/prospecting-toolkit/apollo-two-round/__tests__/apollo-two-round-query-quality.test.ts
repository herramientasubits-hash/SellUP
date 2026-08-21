/**
 * apollo-two-round-query-quality.test.ts — Diversidad real de la ronda 2 y
 * coherencia de las métricas.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 · § 3, § 4, § 7, § 10, § 11, § 12.
 *
 * Reproduce la corrida QA `edb6f40c`: dos rondas, tres resultados crudos por
 * ronda, tres únicas, cero elegibles, un enrichment gastado en Citigroup y una
 * métrica imposible (`new_unique_results = 3` junto a `seen_duplicates = 3`).
 *
 * Todo offline y por inyección de dependencias:
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type RawDiscoveredOrganization,
  type RoundSearchOutcome,
} from '../orchestrator';
import {
  buildApolloRoundProviderFingerprint,
  buildRound1Hypothesis,
  buildRound2Hypothesis,
} from '../query-hypothesis';
import { selectCandidatesForEnrichment } from '../enrichment-ranking';
import { buildRunMetrics, buildEmptyRoundMetrics } from '../observability';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  passingAssessment,
  ambiguousAssessment,
  rejectedAssessment,
  simulatedEffectiveRequestBuilder,
} from './fixtures';

// ─── Ayudas ───────────────────────────────────────────────────────────────────

type RoundCall = {
  roundNumber: number;
  fingerprint: string;
  page: number;
  keywordTags: string[];
};

/**
 * Corrida con proveedor inyectado. Registra qué parámetros habría enviado cada
 * ronda: es lo único que decide si la segunda podía traer algo nuevo.
 */
async function runWithProvider(input: {
  organizationsByRound: Record<number, readonly RawDiscoveredOrganization[]>;
  assess: (organization: RawDiscoveredOrganization, roundNumber: number) => CheapAssessment;
  providerTotalPages?: number | null;
  queryContext?: Parameters<typeof testQueryContext>[0];
  config?: Parameters<typeof testConfig>[0];
}) {
  const calls: RoundCall[] = [];

  const deps: ApolloTwoRoundDeps = {
    // HARDENING-3 § 6 — dependencia SIMULADA y explícita: sin ella el orquestador es
    // fail-closed y la ronda 2 de estos escenarios no llegaría a emitirse.
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber, hypothesis }): Promise<RoundSearchOutcome> => {
      calls.push({
        roundNumber,
        fingerprint: hypothesis.providerRequestFingerprint,
        page: hypothesis.queryParameters.page,
        keywordTags: [...hypothesis.queryParameters.keywordTags],
      });
      const organizations = input.organizationsByRound[roundNumber] ?? [];
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
        providerTotalPages: input.providerTotalPages ?? null,
      };
    },
    assessCandidate: ({ organization, roundNumber }) => input.assess(organization, roundNumber),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      internalRecordedCredits: 0,
    }),
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig(input.config),
      queryContext: testQueryContext(input.queryContext),
      correlation: testCorrelation(),
    },
    deps,
  );

  return { result, calls };
}

/** Las tres organizaciones observadas en la corrida QA, con su identidad. */
function qaOrganizations(): RawDiscoveredOrganization[] {
  return [
    {
      providerOrganizationId: '5f2a1b3c4d5e6f7a8b9c0d11',
      name: 'Falabella Retail Colombia',
      domain: 'falabella.com.pe',
      linkedinUrl: 'https://www.linkedin.com/company/falabella',
      providerRank: 1,
      declaredIndustry: 'retail',
    },
    {
      providerOrganizationId: '5f2a1b3c4d5e6f7a8b9c0d22',
      name: 'Citigroup',
      domain: 'citi.com',
      linkedinUrl: 'https://www.linkedin.com/company/citi',
      providerRank: 2,
      declaredIndustry: 'retail banking',
    },
    {
      providerOrganizationId: '5f2a1b3c4d5e6f7a8b9c0d33',
      name: 'gmail.com.co',
      domain: 'google.com',
      linkedinUrl: 'https://www.linkedin.com/company/google',
      providerRank: 3,
      declaredIndustry: 'internet',
    },
  ];
}

function supermarket(id: string, rank: number): RawDiscoveredOrganization {
  return {
    providerOrganizationId: id,
    name: `Cadena de Supermercados ${id.toUpperCase()}`,
    domain: `${id}.com.co`,
    linkedinUrl: `https://www.linkedin.com/company/${id}`,
    providerRank: rank,
    declaredIndustry: 'supermarkets',
  };
}

// ─── § 3: la ronda 2 debe ser realmente distinta ──────────────────────────────

describe('§ 3 · la ronda 2 sólo corre si envía algo distinto', () => {
  test('5. la huella normalizada de la ronda 2 difiere de la de la ronda 1', () => {
    const round1 = buildRound1Hypothesis(testQueryContext(), 5);
    const round2 = buildRound2Hypothesis(
      testQueryContext(),
      { remainingTarget: 5, excludedSeenOrganizationCount: 3, observedRejectionReasons: [] },
      5,
    );

    assert.notEqual(round2.providerRequestFingerprint, round1.providerRequestFingerprint);
    assert.equal(round2.differsFromRound1, true);
    assert.equal(round2.variantStrategy, 'alternative_specific_terms');
  });

  test('el texto humano de la hipótesis NO basta para declararla distinta', () => {
    const parameters = {
      locations: ['Colombia'],
      keywordTags: ['supermercado', 'grocery'],
      employeeRanges: ['201,500'],
      page: 1,
    };
    const same = {
      ...parameters,
      // Mismos valores, otro orden y otra caja: la huella debe colapsarlos.
      keywordTags: ['GROCERY', 'Supermercado'],
    };

    assert.equal(
      buildApolloRoundProviderFingerprint(parameters),
      buildApolloRoundProviderFingerprint(same),
    );
  });

  test('la página forma parte de la huella: la página 2 SÍ es otra petición', () => {
    const page1 = {
      locations: ['Colombia'],
      keywordTags: ['supermercado'],
      employeeRanges: [],
      page: 1,
    };

    assert.notEqual(
      buildApolloRoundProviderFingerprint(page1),
      buildApolloRoundProviderFingerprint({ ...page1, page: 2 }),
    );
  });

  test('6. una ronda 2 idéntica se omite: ni llamada, ni crédito', async () => {
    const { result, calls } = await runWithProvider({
      // Sin catálogo sectorial no hay sinónimos ni región alternativa con que
      // diferenciar la segunda ronda.
      queryContext: { sector: 'Sector Inexistente', subindustries: [], targetLocations: [] },
      organizationsByRound: { 1: qaOrganizations() },
      assess: () => rejectedAssessment('sector_not_mapped'),
    });

    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
    assert.equal(calls.length, 1, 'la segunda búsqueda no debe emitirse');
    assert.equal(result.roundsExecuted, 1);
    assert.equal(result.runMetrics.totalSearchCredits, 3, 'sólo el gasto de la ronda 1');
  });

  test('7. la página 2 es la variante válida cuando no hay otra', async () => {
    const { result, calls } = await runWithProvider({
      queryContext: { sector: 'Sector Inexistente', subindustries: [], targetLocations: [] },
      providerTotalPages: 3,
      organizationsByRound: {
        1: qaOrganizations(),
        2: [supermarket('nuevo1', 1), supermarket('nuevo2', 2)],
      },
      assess: () => rejectedAssessment('sector_not_mapped'),
    });

    assert.equal(result.secondRoundSkippedReason, null);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].page, 1);
    assert.equal(calls[1].page, 2, 'la ronda 2 debe pedir otra página, no repetir la 1');
    assert.notEqual(calls[1].fingerprint, calls[0].fingerprint);
  });

  test('sin total_pages declarado no se pide una página que puede no existir', () => {
    const round2 = buildRound2Hypothesis(
      testQueryContext({ sector: 'Sector Inexistente', subindustries: [], targetLocations: [] }),
      { remainingTarget: 5, excludedSeenOrganizationCount: 0, observedRejectionReasons: [] },
      5,
    );

    assert.equal(round2.variantStrategy, 'no_real_variant');
    assert.equal(round2.differsFromRound1, false);
    assert.equal(round2.queryParameters.page, 1);
  });

  test('total_pages = 1 tampoco autoriza la página 2', () => {
    const round2 = buildRound2Hypothesis(
      testQueryContext({ sector: 'Sector Inexistente', subindustries: [], targetLocations: [] }),
      {
        remainingTarget: 5,
        excludedSeenOrganizationCount: 0,
        observedRejectionReasons: [],
        providerTotalPages: 1,
      },
      5,
    );

    assert.equal(round2.variantStrategy, 'no_real_variant');
  });
});

// ─── § 4 y § 10: métricas coherentes ──────────────────────────────────────────

describe('§ 4 y § 10 · nuevos y repetidos no pueden ser el mismo resultado', () => {
  test('10. tres resultados totalmente repetidos ⇒ nuevos = 0, repetidos = 3', async () => {
    const { result } = await runWithProvider({
      // Con sinónimos disponibles la ronda 2 SÍ se ejecuta; el proveedor
      // devuelve exactamente las mismas tres organizaciones.
      organizationsByRound: { 1: qaOrganizations(), 2: qaOrganizations() },
      assess: () => rejectedAssessment('sector_not_mapped'),
    });

    const round1 = result.rounds.find((round) => round.roundNumber === 1);
    const round2 = result.rounds.find((round) => round.roundNumber === 2);
    assert.ok(round1 && round2);

    assert.equal(round1.newUniqueResults, 3);
    assert.equal(round1.seenDuplicates, 0);

    assert.equal(round2.newUniqueResults, 0, 'nada nuevo: son las mismas tres');
    assert.equal(round2.seenDuplicates, 3);
  });

  test('la invariante newUnique + seenDuplicates <= normalized se cumple por ronda', async () => {
    const { result } = await runWithProvider({
      organizationsByRound: { 1: qaOrganizations(), 2: qaOrganizations() },
      assess: () => rejectedAssessment('sector_not_mapped'),
    });

    for (const round of result.rounds) {
      assert.ok(
        round.newUniqueResults + round.seenDuplicates <= round.normalizedResults,
        `ronda ${round.roundNumber}: ${round.newUniqueResults}+${round.seenDuplicates} > ${round.normalizedResults}`,
      );
    }
  });

  test('las organizaciones únicas nunca superan los resultados crudos', async () => {
    const { result } = await runWithProvider({
      organizationsByRound: { 1: qaOrganizations(), 2: qaOrganizations() },
      assess: () => rejectedAssessment('sector_not_mapped'),
    });

    assert.ok(
      result.runMetrics.totalUniqueOrganizations <= result.runMetrics.totalRawResults,
      `${result.runMetrics.totalUniqueOrganizations} > ${result.runMetrics.totalRawResults}`,
    );
    assert.equal(result.runMetrics.totalUniqueOrganizations, 3);
    assert.equal(result.runMetrics.totalRawResults, 6);
  });

  test('la tasa de duplicados se mide sobre los resultados crudos', () => {
    const round = buildEmptyRoundMetrics(1, 'hipótesis');
    round.rawResultsReturned = 4;
    round.normalizedResults = 4;
    round.newUniqueResults = 1;
    round.seenDuplicates = 2;
    round.knownCompanyDuplicates = 1;

    const metrics = buildRunMetrics({
      rounds: [round],
      totalUniqueOrganizations: 1,
      totalEligibleCompanies: 0,
      persistedCandidates: 0,
      totalSearchCredits: 4,
      totalEnrichmentCredits: 0,
      enrichmentOutcomes: [],
    });

    assert.equal(metrics.duplicateRate, 0.75);
    assert.equal(metrics.totalNewUniqueResults, 1);
    assert.equal(metrics.totalSeenDuplicates, 2);
    assert.equal(metrics.totalNormalizedResults, 4);
  });

  test('un denominador en cero devuelve null, nunca un 0.0 fabricado', () => {
    const metrics = buildRunMetrics({
      rounds: [],
      totalUniqueOrganizations: 0,
      totalEligibleCompanies: 0,
      persistedCandidates: 0,
      totalSearchCredits: 0,
      totalEnrichmentCredits: 0,
      enrichmentOutcomes: [],
    });

    assert.equal(metrics.duplicateRate, null);
    assert.equal(metrics.enrichmentWasteRate, null);
  });
});

// ─── § 7: el enrichment no se gasta en un contradicho ─────────────────────────

describe('§ 7 · el ranking no compra evidencia de un candidato contradicho', () => {
  test('11. Citigroup, con contradicción declarada, no recibe enrichment', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [
        {
          candidateKey: 'apollo:citigroup',
          roundNumber: 1,
          providerRank: 1,
          countryCompatible: true,
          domainConfident: true,
          ownershipConfident: true,
          sectorKeywordMatchCount: 1,
          novel: true,
          hasCompanySizeSignal: true,
          hasLocationSignal: true,
          hasLinkedInUrl: true,
          freeOfContradictoryEvidence: false,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          knownDuplicate: false,
          cooldownActive: false,
          declaredSectorContradiction: true,
        },
      ],
      remainingEnrichmentBudget: 2,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.deepEqual(selection.selected, []);
    assert.equal(selection.skipped[0]?.skippedReason, 'sector_evidence_contradictory');
    assert.equal(selection.remainingEnrichmentBudget, 2, 'el presupuesto queda intacto');
  });

  test('un candidato sin contradicción y con evidencia ausente SÍ compite', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [
        {
          candidateKey: 'apollo:supermercado',
          roundNumber: 1,
          providerRank: 1,
          countryCompatible: true,
          domainConfident: true,
          ownershipConfident: true,
          sectorKeywordMatchCount: 1,
          novel: true,
          hasCompanySizeSignal: true,
          hasLocationSignal: true,
          hasLinkedInUrl: true,
          freeOfContradictoryEvidence: true,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          knownDuplicate: false,
          cooldownActive: false,
          declaredSectorContradiction: false,
        },
      ],
      remainingEnrichmentBudget: 2,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.equal(selection.selected.length, 1);
    assert.equal(selection.selected[0].candidateKey, 'apollo:supermercado');
  });

  test('una señal ausente (checkpoint antiguo) no se lee como contradicción', () => {
    const selection = selectCandidatesForEnrichment({
      candidates: [
        {
          candidateKey: 'apollo:antiguo',
          roundNumber: 1,
          providerRank: 1,
          countryCompatible: true,
          domainConfident: true,
          ownershipConfident: true,
          sectorKeywordMatchCount: 1,
          novel: true,
          hasCompanySizeSignal: true,
          hasLocationSignal: true,
          hasLinkedInUrl: true,
          freeOfContradictoryEvidence: true,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          knownDuplicate: false,
          cooldownActive: false,
        },
      ],
      remainingEnrichmentBudget: 1,
      eligibleCompaniesSoFar: 0,
      targetEligibleCompanies: 5,
    });

    assert.equal(selection.selected.length, 1);
  });
});

// ─── § 11 y § 15: cinco empresas alcanzables en dos rondas ────────────────────

describe('§ 11 · con la consulta correcta el objetivo es alcanzable', () => {
  test('15. ronda 1 = 3 elegibles, ronda 2 = 2 nuevas ⇒ objetivo alcanzado y 5 persistidas', async () => {
    const { result, calls } = await runWithProvider({
      organizationsByRound: {
        1: [supermarket('andina', 1), supermarket('caribe', 2), supermarket('valle', 3)],
        2: [supermarket('cafeteros', 1), supermarket('oriente', 2)],
      },
      assess: () => passingAssessment(),
    });

    assert.equal(calls.length, 2);
    assert.notEqual(calls[1].fingerprint, calls[0].fingerprint);
    assert.equal(result.eligibleCompaniesFound, 5);
    assert.equal(result.targetReached, true);
    assert.equal(result.persistedCandidates, 5);
    assert.equal(result.resultStatus, 'target_reached');
  });

  test('la ronda 2 aporta SOLO lo nuevo cuando repite parte de la ronda 1', async () => {
    const shared = supermarket('andina', 1);
    const { result } = await runWithProvider({
      organizationsByRound: {
        1: [shared, supermarket('caribe', 2)],
        2: [{ ...shared, providerRank: 1 }, supermarket('oriente', 2)],
      },
      assess: () => passingAssessment(),
    });

    const round2 = result.rounds.find((round) => round.roundNumber === 2);
    assert.ok(round2);
    assert.equal(round2.newUniqueResults, 1);
    assert.equal(round2.seenDuplicates, 1);
    assert.equal(result.eligibleCompaniesFound, 3);
  });

  test('la corrida QA reproducida termina en cero elegibles y sin persistir nada', async () => {
    const { result } = await runWithProvider({
      organizationsByRound: { 1: qaOrganizations(), 2: qaOrganizations() },
      assess: (organization) =>
        organization.domain === 'citi.com'
          ? ambiguousAssessment()
          : rejectedAssessment('sector_not_mapped'),
    });

    assert.equal(result.eligibleCompaniesFound, 0);
    assert.equal(result.persistedCandidates, 0);
  });
});

// ─── § 12: observabilidad del próximo QA ──────────────────────────────────────

describe('§ 12 · la observabilidad no depende del texto humano', () => {
  test('cada ronda registra su huella, su página y los términos que envió', async () => {
    const { result } = await runWithProvider({
      organizationsByRound: {
        1: [supermarket('andina', 1)],
        2: [supermarket('oriente', 1)],
      },
      assess: () => passingAssessment(),
    });

    for (const round of result.rounds) {
      assert.ok(
        typeof round.providerRequestFingerprint === 'string' &&
          round.providerRequestFingerprint.length > 0,
        `la ronda ${round.roundNumber} debe registrar su huella`,
      );
      assert.equal(typeof round.page, 'number');
      assert.ok(Array.isArray(round.specificTermsSent));
    }

    const [round1, round2] = result.rounds;
    assert.notEqual(round1.providerRequestFingerprint, round2.providerRequestFingerprint);
  });

  test('total_pages del proveedor queda registrado tal como llegó', async () => {
    const { result } = await runWithProvider({
      providerTotalPages: 4,
      organizationsByRound: { 1: [supermarket('andina', 1)] },
      assess: () => passingAssessment(),
      config: { maxRounds: 1 },
    });

    assert.equal(result.rounds[0].providerTotalPages, 4);
  });
});
