/**
 * apollo-linkedin-quality-integration-1.test.ts
 *
 * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 · §§ D, E, F y G.
 *
 * Fixture INTEGRADO de la corrida: reúne lo que hasta ahora se probaba por
 * separado —el mapeo de LinkedIn y empleados (#234) y la verdad de la
 * persistencia (#235)— y demuestra la única pregunta que ninguna de las dos
 * podía responder sola:
 *
 *   ¿cuántas empresas fueron GUARDADAS para revisión?
 *   ¿cuántas empresas COMPLETAS Y VÁLIDAS cuentan hacia el objetivo de cinco?
 *
 * Composición del § F, con los topes autorizados 5 / 2 / 10 / 20 / 5:
 *
 *   20 empresas únicas · 5 enrichments · 25 créditos
 *    2 subindustrias confirmadas y completas
 *    3 subindustrias ambiguas
 *    1 rechazo de ownership ANTES del writer
 *    0 fallos técnicos de persistencia
 *
 * Resultado exigido:
 *
 *   persisted_candidates       5
 *   complete_valid_candidates  2
 *   review_only_candidates     3
 *   target_count               2
 *   target_reached             false
 *
 * Sin red, sin Apollo, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
} from '../orchestrator';
import { toRunMetricsMetadata } from '../observability';
import { reconcileApolloTwoRoundPersistedTruth } from '../../apollo-persisted-candidate-truth';
import { buildCandidateSkipBreakdown } from '../../candidate-skip-reason-taxonomy';
import {
  evaluateCandidateTargetEligibility,
  buildCandidateCompletenessCounters,
  resolveCandidateStatusForCompleteness,
  toSubindustryMatchVerdict,
  REVIEW_ONLY_CANDIDATE_STATUS,
} from '../../candidate-completeness-contract';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  simulatedEffectiveRequestBuilder,
  org,
  passingAssessment,
  ambiguousAssessment,
  rejectedAssessment,
} from './fixtures';

// ─── § F · composición ────────────────────────────────────────────────────────

function fixtureConfig() {
  return testConfig({
    targetEligibleCompanies: 5,
    maxRounds: 2,
    maxResultsPerRound: 10,
    maxRawResultsPerRun: 20,
    maxEnrichmentsPerRun: 5,
  });
}

const ROUND_1: readonly { id: string; role: string }[] = [
  { id: 'hs1', role: 'duplicate_in_hubspot' },
  { id: 'hs2', role: 'duplicate_in_hubspot' },
  { id: 'hs3', role: 'duplicate_in_hubspot' },
  { id: 'hs4', role: 'duplicate_in_hubspot' },
  { id: 'cool1', role: 'cooldown_or_prior_suggestion' },
  { id: 'ctry1', role: 'country_incompatible' },
  { id: 'enr1', role: 'enrichment_candidate' },
  { id: 'enr2', role: 'enrichment_candidate' },
  { id: 'contra1', role: 'sector_evidence_contradictory' },
  { id: 'contra2', role: 'sector_evidence_contradictory' },
];

const ROUND_2: readonly { id: string; role: string }[] = [
  { id: 'hs5', role: 'duplicate_in_hubspot' },
  { id: 'hs6', role: 'duplicate_in_hubspot' },
  { id: 'hs7', role: 'duplicate_in_hubspot' },
  { id: 'hs8', role: 'duplicate_in_hubspot' },
  { id: 'enr3', role: 'enrichment_candidate' },
  { id: 'enr4', role: 'enrichment_candidate' },
  { id: 'enr5', role: 'enrichment_candidate' },
  { id: 'ownership', role: 'ownership_rejected_by_final_gate' },
  { id: 'contra3', role: 'sector_evidence_contradictory' },
  { id: 'contra4', role: 'sector_evidence_contradictory' },
];

/** Los dos enrichments que SÍ confirman la subindustria. */
const CONFIRMED_BY_ENRICHMENT = new Set(['enr1', 'enr2']);
/** Las tres que siguen ambiguas después de pagar por resolverlas. */
const AMBIGUOUS_AFTER_ENRICHMENT = ['enr3', 'enr4', 'enr5'] as const;

const ROLE_BY_ID = new Map(
  [...ROUND_1, ...ROUND_2].map((entry) => [entry.id, entry.role] as const),
);

function organizationsFor(round: readonly { id: string }[]): RawDiscoveredOrganization[] {
  return round.map((entry, index) => org(entry.id, { providerRank: index + 1 }));
}

function assessmentFor(id: string): CheapAssessment {
  switch (ROLE_BY_ID.get(id)) {
    case 'duplicate_in_hubspot':
      return rejectedAssessment('duplicate_in_hubspot', {
        signals: { ...passingAssessment().signals, knownDuplicate: true },
      });
    case 'cooldown_or_prior_suggestion':
      return rejectedAssessment('cooldown_or_prior_suggestion', {
        noPriorSuggestion: false,
        signals: { ...passingAssessment().signals, cooldownActive: true },
      });
    case 'country_incompatible':
      return rejectedAssessment('country_incompatible', {
        signals: { ...passingAssessment().signals, countryCompatible: false },
      });
    case 'sector_evidence_contradictory':
      return rejectedAssessment('sector_evidence_contradictory', {
        sectorEvidenceState: 'sector_evidence_contradictory',
        signals: {
          ...passingAssessment().signals,
          freeOfContradictoryEvidence: false,
          declaredSectorContradiction: true,
        },
      });
    case 'enrichment_candidate':
      return ambiguousAssessment();
    case 'ownership_rejected_by_final_gate':
      return passingAssessment();
    default:
      return rejectedAssessment('sector_not_mapped');
  }
}

function enrichmentFor(candidateKey: string): EnrichmentResult {
  const id = candidateKey.replace('apollo:', '');
  return {
    executed: true,
    internalRecordedCredits: 1,
    sectorEvidenceState: CONFIRMED_BY_ENRICHMENT.has(id)
      ? 'sector_evidence_confirmed'
      : 'sector_evidence_missing_needs_enrichment',
  };
}

function buildFixtureDeps(): { deps: ApolloTwoRoundDeps; finalGateCalls: string[] } {
  const finalGateCalls: string[] = [];
  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }) => {
      const organizations = organizationsFor(roundNumber === 1 ? ROUND_1 : ROUND_2);
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
        providerTotalPages: 5,
      };
    },
    assessCandidate: ({ organization }) =>
      assessmentFor(organization.providerOrganizationId ?? ''),
    enrichCandidate: async ({ candidateKey }) => enrichmentFor(candidateKey),
    applyFinalGates: ({ candidateKey }) => {
      finalGateCalls.push(candidateKey);
      return {
        rejection: candidateKey === 'apollo:ownership' ? ('ownership_mismatch' as const) : null,
      };
    },
  };
  return { deps, finalGateCalls };
}

async function runFixture() {
  const { deps, finalGateCalls } = buildFixtureDeps();
  const result = await runApolloTwoRoundDiscovery(
    {
      config: fixtureConfig(),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
    },
    deps,
  );
  return { result, finalGateCalls };
}

// ─── Puente writer: qué escribiría el writer con lo que el orquestador entrega ─

/**
 * Reproduce la decisión de completitud del writer para cada fila que escribiría.
 *
 * NO reimplementa la regla: llama a las MISMAS funciones del contrato que usa
 * `candidate-writer.ts`. Un fixture que copiara la regla sólo probaría su copia.
 *
 * Los dos confirmados llegan con LinkedIn y empleados; los tres ambiguos, con
 * LinkedIn confirmado y sin número de empleados —es exactamente lo que Apollo
 * devuelve cuando el enrichment no resuelve la organización—.
 */
function writerCompletenessForFixture(result: Awaited<ReturnType<typeof runFixture>>['result']) {
  const rows = [
    ...result.persisted.map((entry) => ({ entry, complete: true })),
    ...result.reviewOnly.map((entry) => ({ entry, complete: false })),
  ];

  return rows.map(({ entry, complete }) =>
    evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: toSubindustryMatchVerdict(entry.sectorEvidenceState),
      employeeCountStatus: complete ? 'confirmed' : 'not_returned',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    }),
  );
}

// ─── § F · las cifras del contrato ────────────────────────────────────────────

describe('INTEGRATION-1 § F · fixture integrado de la corrida', () => {
  test('20 únicas, 5 enrichments, 25 créditos y 0 fallos técnicos', async () => {
    const { result } = await runFixture();
    const metrics = result.runMetrics;

    assert.equal(metrics.totalUniqueOrganizations, 20);
    assert.equal(metrics.enrichmentsExecuted, 5);
    assert.equal(metrics.totalSearchCredits + metrics.totalEnrichmentCredits, 25);
    assert.equal(metrics.enrichmentFailedCount, 0, '0 fallos técnicos de persistencia');
    assert.equal(metrics.sectorConfirmedByEnrichment, 2);
    assert.equal(metrics.sectorStillUnconfirmedAfterEnrichment, 3);
  });

  test('las tres ambiguas se persisten: 5 filas, no 2', async () => {
    const { result } = await runFixture();

    assert.equal(result.persisted.length, 2, '2 completas');
    assert.equal(result.reviewOnly.length, 3, '3 para revisión');

    const reviewKeys = result.reviewOnly.map((entry) => entry.candidateKey).sort();
    assert.deepEqual(
      reviewKeys,
      AMBIGUOUS_AFTER_ENRICHMENT.map((id) => `apollo:${id}`).sort(),
    );
    for (const entry of result.reviewOnly) {
      assert.equal(entry.reviewReason, 'subindustry_ambiguous_after_enrichment');
    }
  });

  test('el rechazo de ownership NO se persiste, ni siquiera para revisión', async () => {
    const { result } = await runFixture();

    const allPersistedKeys = [
      ...result.persisted.map((e) => e.candidateKey),
      ...result.reviewOnly.map((e) => e.candidateKey),
    ];
    assert.ok(
      !allPersistedKeys.includes('apollo:ownership'),
      'una empresa rechazada por ownership no puede entrar disfrazada de duda',
    );
    assert.ok(result.observedRejectionReasons.includes('ownership_mismatch'));
  });

  test('un sector contradictorio tampoco entra en la cohorte de revisión', async () => {
    const { result } = await runFixture();

    const reviewKeys = new Set(result.reviewOnly.map((e) => e.candidateKey));
    for (const id of ['contra1', 'contra2', 'contra3', 'contra4']) {
      assert.ok(!reviewKeys.has(`apollo:${id}`), `${id} tiene rechazo con causa`);
    }
  });

  test('identity_keys_present = 5/5 sobre TODAS las filas persistidas', async () => {
    const { result } = await runFixture();

    const all = [...result.persisted, ...result.reviewOnly];
    assert.equal(all.length, 5);
    assert.equal(all.filter((e) => e.identity.normalizedDomain !== null).length, 5);
  });
});

// ─── § E · las tres métricas separadas ────────────────────────────────────────

describe('INTEGRATION-1 § E · persistidos, completos y objetivo son tres cifras', () => {
  test('5 persistidos · 2 completos · 3 revisión · target_count 2 · no alcanzado', async () => {
    const { result } = await runFixture();
    const counters = buildCandidateCompletenessCounters(writerCompletenessForFixture(result));

    assert.equal(counters.persisted_candidates, 5);
    assert.equal(counters.complete_valid_candidates, 2);
    assert.equal(counters.review_only_candidates, 3);
    assert.equal(counters.target_count, 2);
    assert.equal(counters.target_count < fixtureConfig().targetEligibleCompanies, true);
  });

  test('el desglose nombra la condición que falló en cada ambigua', async () => {
    const { result } = await runFixture();
    const counters = buildCandidateCompletenessCounters(writerCompletenessForFixture(result));

    assert.equal(counters.failed_condition_counts['subindustry_match'], 3);
    assert.equal(counters.failed_condition_counts['employee_count_status'], 3);
    assert.equal(counters.failed_condition_counts['linkedin_status'], undefined);
  });

  test('target_reached se decide sobre los completos, no sobre las filas', async () => {
    const { result } = await runFixture();
    const counters = buildCandidateCompletenessCounters(writerCompletenessForFixture(result));

    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      {
        modality: 'two_round_adaptive',
        target_reached: result.targetReached,
        run_metrics: toRunMetricsMetadata(result.runMetrics),
      },
      {
        eligibleBeforePersistence: 5,
        persistedCandidates: 5,
        completeValidCandidates: counters.complete_valid_candidates,
        gapCauses: buildCandidateSkipBreakdown([]),
        targetEligibleCompanies: 5,
      },
    );

    assert.ok(reconciled !== null);
    const metrics = reconciled.observability['run_metrics'] as Record<string, unknown>;

    assert.equal(metrics['persisted_candidates'], 5);
    assert.equal(metrics['complete_valid_candidates'], 2);
    assert.equal(metrics['review_only_candidates'], 3);
    assert.equal(metrics['target_count'], 2);
    assert.equal(metrics['projected_persistable_candidates'], 5);
    assert.equal(metrics['persistence_gap'], 0);
    assert.equal(reconciled.observability['target_reached'], false);
    assert.equal(reconciled.reconciliation.target_reached, false);
  });

  test('cinco filas NO se publican como cinco válidas', async () => {
    const { result } = await runFixture();
    const counters = buildCandidateCompletenessCounters(writerCompletenessForFixture(result));

    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      {
        modality: 'two_round_adaptive',
        target_reached: result.targetReached,
        run_metrics: toRunMetricsMetadata(result.runMetrics),
      },
      {
        eligibleBeforePersistence: 5,
        persistedCandidates: 5,
        completeValidCandidates: counters.complete_valid_candidates,
        gapCauses: {},
        targetEligibleCompanies: 5,
      },
    );

    assert.ok(reconciled !== null);
    // El defecto que esto cierra: con `target_reached = persisted >= target`,
    // estas cinco filas —tres de ellas sólo para revisión— habrían declarado el
    // objetivo alcanzado.
    assert.notEqual(reconciled.reconciliation.target_count, 5);
    assert.equal(reconciled.reconciliation.target_reached, false);
  });

  test('los dos costos son distintos y ninguno divide por cero', async () => {
    const { result } = await runFixture();
    const counters = buildCandidateCompletenessCounters(writerCompletenessForFixture(result));

    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      {
        modality: 'two_round_adaptive',
        target_reached: result.targetReached,
        run_metrics: toRunMetricsMetadata(result.runMetrics),
      },
      {
        eligibleBeforePersistence: 5,
        persistedCandidates: 5,
        completeValidCandidates: counters.complete_valid_candidates,
        gapCauses: {},
        targetEligibleCompanies: 5,
      },
    );

    assert.ok(reconciled !== null);
    // 25 créditos: 5 por fila escrita, 12.5 por empresa realmente útil.
    assert.equal(reconciled.reconciliation.credits_per_persisted_candidate, 5);
    assert.equal(reconciled.reconciliation.credits_per_complete_valid_candidate, 12.5);
  });

  test('sin completas, el costo por completa es null y nunca cero', () => {
    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      {
        modality: 'two_round_adaptive',
        target_reached: false,
        run_metrics: { total_search_credits: 20, total_enrichment_credits: 5 },
      },
      {
        eligibleBeforePersistence: 3,
        persistedCandidates: 3,
        completeValidCandidates: 0,
        gapCauses: {},
        targetEligibleCompanies: 5,
      },
    );

    assert.ok(reconciled !== null);
    assert.equal(reconciled.reconciliation.credits_per_complete_valid_candidate, null);
    assert.equal(reconciled.reconciliation.credits_per_persisted_candidate, 8.3333);
    assert.equal(reconciled.reconciliation.review_only_candidates, 3);
  });

  test('sin medición de completitud el objetivo NO se da por alcanzado', () => {
    const reconciled = reconcileApolloTwoRoundPersistedTruth(
      {
        modality: 'two_round_adaptive',
        target_reached: true,
        run_metrics: { total_search_credits: 20, total_enrichment_credits: 5 },
      },
      {
        eligibleBeforePersistence: 5,
        persistedCandidates: 5,
        completeValidCandidates: null,
        gapCauses: {},
        targetEligibleCompanies: 5,
      },
    );

    assert.ok(reconciled !== null);
    // Fail-closed: la ausencia de medición no se sustituye por las filas.
    assert.equal(reconciled.reconciliation.target_reached, false);
    assert.equal(reconciled.reconciliation.target_count, null);
    assert.equal(reconciled.reconciliation.review_only_candidates, null);
  });
});

// ─── § D · el estado con el que se persiste cada cohorte ──────────────────────

describe('INTEGRATION-1 § D · ambiguo se persiste como needs_review', () => {
  test('la ambigua se persiste, y su estado es needs_review', async () => {
    const { result } = await runFixture();
    const eligibilities = writerCompletenessForFixture(result);

    const reviewEligibilities = eligibilities.slice(result.persisted.length);
    assert.equal(reviewEligibilities.length, 3);

    for (const eligibility of reviewEligibilities) {
      assert.equal(eligibility.countsTowardTarget, false);
      assert.equal(
        resolveCandidateStatusForCompleteness('high_quality_new', eligibility),
        REVIEW_ONLY_CANDIDATE_STATUS,
      );
      // Aunque el estado base fuese otro, sigue siendo revisión: lo que decide
      // es no contar hacia el objetivo, no la etiqueta de calidad previa.
      assert.equal(
        resolveCandidateStatusForCompleteness('needs_review', eligibility),
        REVIEW_ONLY_CANDIDATE_STATUS,
      );
    }
  });

  test('la completa conserva su estado y sí cuenta', async () => {
    const { result } = await runFixture();
    const eligibilities = writerCompletenessForFixture(result);

    const completeEligibilities = eligibilities.slice(0, result.persisted.length);
    assert.equal(completeEligibilities.length, 2);
    for (const eligibility of completeEligibilities) {
      assert.equal(eligibility.countsTowardTarget, true);
      assert.deepEqual(eligibility.failedConditions, []);
      assert.equal(
        resolveCandidateStatusForCompleteness('high_quality_new', eligibility),
        'high_quality_new',
      );
    }
  });

  test('`duplicate` no se degrada: ya nombra una causa más precisa', async () => {
    const { result } = await runFixture();
    const eligibilities = writerCompletenessForFixture(result);

    assert.equal(
      resolveCandidateStatusForCompleteness('duplicate', eligibilities[eligibilities.length - 1]),
      'duplicate',
    );
  });
});
