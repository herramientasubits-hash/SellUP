/**
 * apollo-two-round-classification-reconciliation-x1.test.ts
 *
 * AGENT1-CLASSIFICATION-RECONCILIATION-X1 — el desglose por ronda tiene que
 * cubrir TODAS las empresas únicas.
 *
 * ── El defecto que cierra, medido en Producción ──────────────────────────────
 *
 * Certificación `wizard_run 5bfb5ff8ab52723e2dac881a41237c3b`, lote
 * `c7c28980-772b-425a-b548-581cfecb32f7` (CO × retail × target 5, Apollo
 * forzado por override, waterfall apagado):
 *
 *   34 empresas únicas
 *   ├─  8 invalid_domain          (gate barato: Apollo no devolvió dominio)
 *   ├─  7 ownership_mismatch      (gate FINAL de ownership)
 *   ├─  1 sector_rejected         (enrichment contradijo el sector)
 *   └─ 18 enrichment_budget_exhausted (cap de 5 enrichments)
 *
 *   prospect_discarded_dispositions ......... 34 filas, unclassified_count = 0
 *   rounds[1].ownership_rejected ............ 13   ← DEBERÍA SER 15
 *   pre_writer_state_consistency.ok ......... false
 *   pre_writer_state_consistency.unclassified 2
 *
 * Los dos que faltaban son los DOS únicos candidatos que el gate final rechazó
 * mientras NO eran elegibles: `copadpharma` y el InterContinental de Cartagena,
 * ambos enriquecidos y ambos con el sector aún ambiguo después de pagar. La
 * cohorte de revisión.
 *
 * `ensureFinalGateEvaluated` los marcaba como rechazados definitivos —así
 * llegaron enteros a la tabla de disposiciones— y salía con un `return` por
 * `!candidate.eligible` ANTES de llamar a `tallyRejection`. Y tampoco caben en
 * el otro cubo del evaluador de consistencia, el de «ni elegible ni rechazado»,
 * porque rechazados sí están. Ningún cubo los reclamaba.
 *
 * ── Lo que este corte NO toca ────────────────────────────────────────────────
 *
 * El veredicto del gate de ownership, sus reglas, la paginación, la selección de
 * enrichment y los créditos quedan exactamente igual. La prueba de que las 34
 * disposiciones finales no se mueven vive aquí abajo, en el fixture: se comparan
 * una por una contra las 34 de la corrida real.
 *
 * Offline: sin red, sin Apollo, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  toApolloTwoRoundResumeState,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundRunResult,
  type CheapAssessment,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
} from '../orchestrator';
import { evaluateApolloTwoRoundFinalStateConsistency } from '../run-final-state-consistency';
import {
  evaluateApolloCandidateFinalDispositions,
  countUnclassifiedFinalDispositions,
} from '../candidate-final-disposition';
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

// ─── Utilidades compartidas ───────────────────────────────────────────────────

/** Proyección que la capa de producción pasa al evaluador de consistencia. */
function consistencyOf(result: ApolloTwoRoundRunResult) {
  return evaluateApolloTwoRoundFinalStateConsistency({
    rounds: result.rounds,
    candidates: toApolloTwoRoundResumeState(result).candidates.map((candidate) => ({
      candidate_key: candidate.candidateKey,
      eligible: candidate.eligible,
      finally_rejected_or_duplicated: candidate.finallyRejectedOrDuplicated,
    })),
    runMetrics: {
      totalUniqueOrganizations: result.runMetrics.totalUniqueOrganizations,
      totalEligibleCompanies: result.runMetrics.totalEligibleCompanies,
      persistedCandidates: result.runMetrics.persistedCandidates,
    },
    targetEligibleCompanies: result.targetEligibleCompanies,
    targetReached: result.targetReached,
    stableFinalizableCandidateCount: result.stableFinalizableCandidateCount,
  });
}

function ownershipRejectedOfRound(result: ApolloTwoRoundRunResult, roundNumber = 1): number {
  return result.rounds.find((round) => round.roundNumber === roundNumber)?.ownershipRejected ?? -1;
}

/**
 * Enrichment que deja el sector EXACTAMENTE donde se le diga.
 *
 * `sector_evidence_missing_needs_enrichment` como desenlace es lo que crea la
 * cohorte de revisión: se pagó, y el sector sigue sin demostrarse.
 */
function enrichmentTo(
  sectorEvidenceState: EnrichmentResult['sectorEvidenceState'],
): EnrichmentResult {
  return {
    executed: true,
    internalRecordedCredits: 1,
    sectorEvidenceState,
    providerCompanyFields: { employeeCountStatus: 'confirmed', linkedinStatus: 'confirmed' },
  };
}

// ─── T1 · un no-elegible rechazado por el gate final SE CUENTA ────────────────

describe('T1 · el gate final cuenta aunque el candidato no fuera elegible', () => {
  /**
   * La forma mínima de `copadpharma`: una sola empresa, ambigua, enriquecida,
   * sector todavía sin demostrar (⇒ NO elegible) y rechazada por ownership.
   */
  async function runSingleReviewCohortRejection(): Promise<ApolloTwoRoundRunResult> {
    const deps: ApolloTwoRoundDeps = {
      buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
      searchRound: async () => ({
        organizations: [org('copadpharma', { providerRank: 1 })],
        providerRequestCount: 1,
        internalRecordedCredits: 1,
        providerTotalPages: 1,
      }),
      assessCandidate: () => ambiguousAssessment(),
      enrichCandidate: async () =>
        enrichmentTo('sector_evidence_missing_needs_enrichment'),
      applyFinalGates: () => ({ rejection: 'ownership_mismatch' as const }),
    };

    return runApolloTwoRoundDiscovery(
      {
        config: testConfig({
          targetEligibleCompanies: 5,
          maxRounds: 1,
          maxResultsPerRound: 10,
          maxRawResultsPerRun: 10,
          maxEnrichmentsPerRun: 1,
        }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      deps,
    );
  }

  test('el candidato NO era elegible y aun así suma a ownershipRejected', async () => {
    const result = await runSingleReviewCohortRejection();

    const candidate = result.evaluatedCandidates[0];
    assert.ok(candidate, 'la corrida tiene que haber evaluado al candidato');
    assert.equal(candidate.eligible, false, 'sector aún ambiguo ⇒ no elegible');
    assert.equal(candidate.enrichmentExecuted, true, 'se pagó su enrichment');
    assert.equal(candidate.definitivelyRejected, true);
    assert.equal(candidate.definitiveRejectionReason, 'ownership_mismatch');

    // 🔴 El corte. Antes de X1 esto era 0: el rechazo existía en el candidato y
    // no existía en el desglose.
    assert.equal(ownershipRejectedOfRound(result), 1);
  });

  test('y el desglose por ronda cierra: 1 única, 1 clasificada, 0 sin clasificar', async () => {
    const result = await runSingleReviewCohortRejection();
    const consistency = consistencyOf(result);

    assert.equal(consistency.unclassifiedUniqueResults, 0);
    assert.ok(
      !consistency.conflicts.some(
        (conflict) => conflict.code === 'round_breakdown_leaves_unique_results_unclassified',
      ),
      `sin conflicto de clasificación, hubo: ${JSON.stringify(consistency.conflicts)}`,
    );
  });
});

// ─── T2 · elegible y cohorte de revisión SUMAN, no se sustituyen ──────────────

describe('T2 · la cohorte de revisión se cuenta ADEMÁS del elegible', () => {
  /**
   * Dos empresas rechazadas por el MISMO gate final, cada una por un camino:
   *
   *   `confirmada`  sector confirmado gratis ⇒ elegible ⇒ ya se contaba antes
   *   `ambigua`     enriquecida y aún sin sector ⇒ cohorte de revisión ⇒ no se
   *                 contaba
   *
   * Antes de X1 el desglose decía 1. La verdad son 2.
   */
  async function runMixedRejections(): Promise<ApolloTwoRoundRunResult> {
    const deps: ApolloTwoRoundDeps = {
      buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
      searchRound: async () => ({
        organizations: [
          org('confirmada', { providerRank: 1 }),
          org('ambigua', { providerRank: 2 }),
        ],
        providerRequestCount: 1,
        internalRecordedCredits: 1,
        providerTotalPages: 1,
      }),
      assessCandidate: ({ organization }): CheapAssessment =>
        organization.providerOrganizationId === 'confirmada'
          ? passingAssessment()
          : ambiguousAssessment(),
      enrichCandidate: async () =>
        enrichmentTo('sector_evidence_missing_needs_enrichment'),
      applyFinalGates: () => ({ rejection: 'ownership_mismatch' as const }),
    };

    return runApolloTwoRoundDiscovery(
      {
        config: testConfig({
          targetEligibleCompanies: 5,
          maxRounds: 1,
          maxResultsPerRound: 10,
          maxRawResultsPerRun: 10,
          maxEnrichmentsPerRun: 1,
        }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
      },
      deps,
    );
  }

  test('dos rechazos de ownership por dos caminos distintos ⇒ ownershipRejected = 2', async () => {
    const result = await runMixedRejections();

    const byKey = new Map(result.evaluatedCandidates.map((c) => [c.candidateKey, c]));
    const confirmada = byKey.get('apollo:confirmada');
    const ambigua = byKey.get('apollo:ambigua');
    assert.ok(confirmada && ambigua);
    // Caminos distintos, comprobados: uno llegó elegible al gate, el otro no.
    assert.equal(confirmada.enrichmentExecuted, false, 'sector ya confirmado ⇒ nada que comprar');
    assert.equal(ambigua.enrichmentExecuted, true, 'cohorte de revisión ⇒ se pagó');
    assert.equal(confirmada.definitiveRejectionReason, 'ownership_mismatch');
    assert.equal(ambigua.definitiveRejectionReason, 'ownership_mismatch');

    // 🔴 Antes de X1: 1. Contar sólo al elegible no es contar menos: es dejar a
    // una empresa única sin ninguna disposición en el desglose.
    assert.equal(ownershipRejectedOfRound(result), 2);
    assert.equal(consistencyOf(result).unclassifiedUniqueResults, 0);
  });
});

// ─── T3 · fixture de la corrida real: 34 resultados ──────────────────────────

/**
 * Las 34 empresas de `c7c28980…`, reconstruidas por su ROL en la corrida.
 *
 * El orden importa y es el de la corrida: los `invalid_domain` y los confirmados
 * gratis no compiten por enrichment (los primeros están rechazados, los segundos
 * ya tienen su sector), así que los 23 ambiguos son los que se disputan el cap
 * de 5, y el rango del proveedor decide cuáles ganan.
 */
const INVALID_DOMAIN_IDS = Array.from({ length: 8 }, (_u, i) => `sin_dominio_${i + 1}`);
/** Sector confirmado GRATIS ⇒ elegibles ⇒ el gate final los rechaza. */
const FREE_CONFIRMED_IDS = ['vaquita', 'caribe', 'primavera'];
/** Enriquecidos, sector CONFIRMADO por el enrichment ⇒ elegibles ⇒ rechazados. */
const ENRICHED_CONFIRMED_IDS = ['delgado', 'comestibles_ricos'];
/** Enriquecido, el enrichment CONTRADIJO el sector ⇒ sector_rejected. */
const ENRICHED_CONTRADICTORY_ID = 'pqp';
/** 🔴 Los DOS del corte: enriquecidos, sector aún ambiguo, rechazados por ownership. */
const REVIEW_COHORT_IDS = ['copadpharma', 'intercontinental_cartagena'];
/** 18 ambiguos que nunca compitieron: el cap se agotó antes. */
const CAP_REACHED_IDS = Array.from({ length: 18 }, (_u, i) => `sin_enrichment_${i + 1}`);

const ENRICHED_IDS = [
  ...ENRICHED_CONFIRMED_IDS,
  ENRICHED_CONTRADICTORY_ID,
  ...REVIEW_COHORT_IDS,
];

/** Todo el que muere en el gate FINAL de ownership: 3 + 2 + 2 = 7. */
const FINAL_GATE_OWNERSHIP_IDS = new Set([
  ...FREE_CONFIRMED_IDS,
  ...ENRICHED_CONFIRMED_IDS,
  ...REVIEW_COHORT_IDS,
]);

function fixtureOrganizations(): RawDiscoveredOrganization[] {
  const ordered = [
    ...INVALID_DOMAIN_IDS,
    ...FREE_CONFIRMED_IDS,
    ...ENRICHED_IDS,
    ...CAP_REACHED_IDS,
  ];
  return ordered.map((id, index) => org(id, { providerRank: index + 1 }));
}

function fixtureAssessment(id: string): CheapAssessment {
  if (INVALID_DOMAIN_IDS.includes(id)) return rejectedAssessment('invalid_domain');
  if (FREE_CONFIRMED_IDS.includes(id)) return passingAssessment();
  return ambiguousAssessment();
}

function fixtureEnrichment(candidateKey: string): EnrichmentResult {
  const id = candidateKey.replace('apollo:', '');
  if (ENRICHED_CONFIRMED_IDS.includes(id)) return enrichmentTo('sector_evidence_confirmed');
  if (id === ENRICHED_CONTRADICTORY_ID) return enrichmentTo('sector_evidence_contradictory');
  return enrichmentTo('sector_evidence_missing_needs_enrichment');
}

function fixtureDeps(): { deps: ApolloTwoRoundDeps; enrichCalls: string[] } {
  const enrichCalls: string[] = [];
  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async () => ({
      organizations: fixtureOrganizations(),
      providerRequestCount: 1,
      // 5 páginas de la ronda 1, como en la corrida real.
      internalRecordedCredits: 5,
      providerTotalPages: 5,
    }),
    assessCandidate: ({ organization }) =>
      fixtureAssessment(organization.providerOrganizationId ?? ''),
    enrichCandidate: async ({ candidateKey }) => {
      enrichCalls.push(candidateKey);
      return fixtureEnrichment(candidateKey);
    },
    applyFinalGates: ({ candidateKey }) => ({
      rejection: FINAL_GATE_OWNERSHIP_IDS.has(candidateKey.replace('apollo:', ''))
        ? ('ownership_mismatch' as const)
        : null,
    }),
  };
  return { deps, enrichCalls };
}

async function runFixture(): Promise<{
  result: ApolloTwoRoundRunResult;
  enrichCalls: string[];
}> {
  const { deps, enrichCalls } = fixtureDeps();
  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig({
        targetEligibleCompanies: 5,
        maxRounds: 1,
        maxResultsPerRound: 40,
        maxRawResultsPerRun: 40,
        maxEnrichmentsPerRun: 5,
      }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
    },
    deps,
  );
  return { result, enrichCalls };
}

describe('T3 · fixture de la certificación c7c28980 — 34 resultados', () => {
  test('la forma de la corrida se reproduce: 34 únicas, 5 enriquecidas, 2 ambiguas', async () => {
    const { result, enrichCalls } = await runFixture();

    assert.equal(result.runMetrics.totalUniqueOrganizations, 34);
    assert.equal(result.runMetrics.enrichmentsExecuted, 5);
    assert.deepEqual(
      [...enrichCalls].sort(),
      ENRICHED_IDS.map((id) => `apollo:${id}`).sort(),
      'el cap de 5 lo ganan exactamente los cinco de la corrida real',
    );
    assert.equal(result.runMetrics.sectorConfirmedByEnrichment, 2);
    assert.equal(result.runMetrics.sectorRejectedAfterEnrichment, 1);
    assert.equal(
      result.runMetrics.sectorStillUnconfirmedAfterEnrichment,
      2,
      'los dos de la cohorte de revisión',
    );
    assert.equal(result.runMetrics.totalEligibleCompanies, 0);
    assert.equal(result.persisted.length, 0);
  });

  test('🔴 el desglose por ronda publica 15 ownership y 1 sector — no 13', async () => {
    const { result } = await runFixture();
    const round = result.rounds.find((r) => r.roundNumber === 1);
    assert.ok(round);

    // 8 invalid_domain (barato) + 7 ownership_mismatch (gate final) = 15.
    assert.equal(round.ownershipRejected, 15);
    assert.equal(round.sectorRejected, 1);
    assert.equal(round.countryRejected, 0);
    assert.equal(round.knownCompanyDuplicates, 0);
  });

  test('🔴 pre_writer_state_consistency.ok = true y unclassified = 0', async () => {
    const { result } = await runFixture();
    const consistency = consistencyOf(result);

    assert.equal(
      consistency.unclassifiedUniqueResults,
      0,
      `sin clasificar debe ser 0, conflictos: ${JSON.stringify(consistency.conflicts)}`,
    );
    assert.equal(
      consistency.ok,
      true,
      `consistencia limpia, conflictos: ${JSON.stringify(consistency.conflicts)}`,
    );
    // El cubo de los snapshots: los 18 que nunca compitieron por un enrichment.
    assert.equal(consistency.notSelectedForEnrichmentOrInsufficientEvidence, 18);
    assert.equal(consistency.eligibleFromCandidateSnapshots, 0);
  });

  test('la ARITMÉTICA cierra: 15 + 1 + 18 = 34', async () => {
    const { result } = await runFixture();
    const round = result.rounds.find((r) => r.roundNumber === 1);
    assert.ok(round);
    const consistency = consistencyOf(result);

    const classified =
      round.ownershipRejected +
      round.sectorRejected +
      round.countryRejected +
      round.knownCompanyDuplicates +
      result.runMetrics.persistedCandidates +
      consistency.notSelectedForEnrichmentOrInsufficientEvidence;

    assert.equal(classified, 34);
    assert.equal(classified, result.runMetrics.totalUniqueOrganizations);
  });

  /**
   * 🔴 La prueba de que X1 no cambió NADA de lo que la corrida decidió.
   *
   * `evaluateApolloCandidateFinalDispositions` lee `definitivelyRejected` y
   * `definitiveRejectionReason` — campos que este corte no toca — así que las 34
   * disposiciones son, una por una, las mismas 34 filas que
   * `prospect_discarded_dispositions` guardó en Producción.
   */
  test('las 34 disposiciones finales son IDÉNTICAS a las de Producción', async () => {
    const { result } = await runFixture();
    const dispositions = evaluateApolloCandidateFinalDispositions(result);

    assert.equal(dispositions.length, 34);
    assert.equal(countUnclassifiedFinalDispositions(dispositions), 0);

    const breakdown = dispositions.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.finalDisposition] = (acc[entry.finalDisposition] ?? 0) + 1;
      return acc;
    }, {});

    // Exactamente el `candidate_final_dispositions.breakdown` del lote real.
    assert.deepEqual(breakdown, {
      ownership_rejected_final: 15,
      sector_subindustry_rejected_final: 1,
      enrichment_budget_exhausted_final: 18,
    });

    // Y por candidato, no sólo en agregado: los dos del corte siguen siendo
    // rechazos de ownership con su causa, ni más ni menos.
    const byKey = new Map(dispositions.map((entry) => [entry.candidateKey, entry]));
    for (const id of REVIEW_COHORT_IDS) {
      const entry = byKey.get(`apollo:${id}`);
      assert.ok(entry, `falta la disposición de ${id}`);
      assert.equal(entry.finalDisposition, 'ownership_rejected_final');
      assert.equal(entry.finalReason, 'ownership_mismatch');
      assert.equal(entry.terminalStage, 'orchestrator_final');
    }
    for (const id of CAP_REACHED_IDS) {
      const entry = byKey.get(`apollo:${id}`);
      assert.ok(entry);
      assert.equal(entry.finalDisposition, 'enrichment_budget_exhausted_final');
      assert.equal(entry.finalReason, 'enrichment_cap_reached');
    }
    const contradictory = byKey.get(`apollo:${ENRICHED_CONTRADICTORY_ID}`);
    assert.ok(contradictory);
    assert.equal(contradictory.finalDisposition, 'sector_subindustry_rejected_final');
  });

  /**
   * 🔴 El detector tiene que seguir detectando.
   *
   * `ok: true` sobre la corrida arreglada no demuestra nada por sí solo: un
   * evaluador que aceptara cualquier desglose también lo diría. Este test le
   * presenta el estado EXACTO de Producción antes del corte —el mismo universo
   * de 34, los mismos 18 pendientes, y `ownership_rejected` en 13— y exige que
   * lo siga llamando conflicto, con las mismas dos empresas sin clasificar.
   *
   * Es el par negativo del test de arriba: uno fija que la corrida sana cierra,
   * éste fija que la enferma no pasa desapercibida.
   */
  test('🔴 el evaluador SIGUE detectando el estado pre-X1: 13 ⇒ unclassified = 2', async () => {
    const { result } = await runFixture();

    const preX1Rounds = result.rounds.map((round) =>
      round.roundNumber === 1
        ? { ...round, ownershipRejected: round.ownershipRejected - 2 }
        : round,
    );
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: preX1Rounds,
      candidates: toApolloTwoRoundResumeState(result).candidates.map((candidate) => ({
        candidate_key: candidate.candidateKey,
        eligible: candidate.eligible,
        finally_rejected_or_duplicated: candidate.finallyRejectedOrDuplicated,
      })),
      runMetrics: {
        totalUniqueOrganizations: result.runMetrics.totalUniqueOrganizations,
        totalEligibleCompanies: result.runMetrics.totalEligibleCompanies,
        persistedCandidates: result.runMetrics.persistedCandidates,
      },
      targetEligibleCompanies: result.targetEligibleCompanies,
      targetReached: result.targetReached,
      stableFinalizableCandidateCount: result.stableFinalizableCandidateCount,
    });

    assert.equal(consistency.ok, false);
    assert.equal(consistency.unclassifiedUniqueResults, 2);
    const conflict = consistency.conflicts.find(
      (entry) => entry.code === 'round_breakdown_leaves_unique_results_unclassified',
    );
    assert.ok(conflict, 'el conflicto tiene que nombrarse');
    // El texto que publicó el lote real, carácter por carácter.
    assert.equal(conflict.detail, 'unique=34 clasificadas=32 sin_clasificar=2');
  });

  test('el gasto no se mueve: 5 créditos de búsqueda y 5 de enrichment', async () => {
    const { result } = await runFixture();
    assert.equal(result.runMetrics.totalSearchCredits, 5);
    assert.equal(result.runMetrics.totalEnrichmentCredits, 5);
    assert.equal(result.runMetrics.enrichmentsExecuted, 5);
  });
});

// ─── T4 · nadie se cuenta dos veces ──────────────────────────────────────────

describe('T4 · idempotencia del conteo', () => {
  test('un reintento sobre el estado ya evaluado NO vuelve a sumar los rechazos', async () => {
    const { result: first } = await runFixture();
    assert.equal(ownershipRejectedOfRound(first), 15);

    /**
     * El reintento rehidrata las MÉTRICAS DE RONDA con los 15 ya sumados y, a
     * propósito, vuelve a poner `finalGateEvaluated` en false. Si el conteo se
     * guardara con la elegibilidad —o con nada—, este segundo paso publicaría
     * 30 sobre las mismas 34 empresas.
     *
     * La ronda ya está consumida, así que el reintento no compra nada: no hay
     * organizaciones nuevas y ninguna llamada al proveedor debe ocurrir.
     */
    const resume = toApolloTwoRoundResumeState(first);
    let searchCalls = 0;
    let enrichCalls = 0;
    const replay = await runApolloTwoRoundDiscovery(
      {
        config: testConfig({
          targetEligibleCompanies: 5,
          maxRounds: 1,
          maxResultsPerRound: 40,
          maxRawResultsPerRun: 40,
          maxEnrichmentsPerRun: 5,
        }),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
        resume,
      },
      {
        buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
        searchRound: async () => {
          searchCalls += 1;
          return {
            organizations: [],
            providerRequestCount: 1,
            internalRecordedCredits: 0,
            providerTotalPages: 5,
          };
        },
        assessCandidate: ({ organization }) =>
          fixtureAssessment(organization.providerOrganizationId ?? ''),
        enrichCandidate: async ({ candidateKey }) => {
          enrichCalls += 1;
          return fixtureEnrichment(candidateKey);
        },
        applyFinalGates: ({ candidateKey }) => ({
          rejection: FINAL_GATE_OWNERSHIP_IDS.has(candidateKey.replace('apollo:', ''))
            ? ('ownership_mismatch' as const)
            : null,
        }),
      },
    );

    assert.equal(searchCalls, 0, 'la ronda ya estaba consumida: no se vuelve a buscar');
    assert.equal(enrichCalls, 0, 'no se vuelve a pagar ningún enrichment');
    // 🔴 15, no 30.
    assert.equal(ownershipRejectedOfRound(replay), 15);
    assert.equal(replay.runMetrics.totalUniqueOrganizations, 34);
    assert.equal(consistencyOf(replay).unclassifiedUniqueResults, 0);
  });

  test('el flag de conteo viaja con el candidato: quien fue contado queda marcado', async () => {
    const { result } = await runFixture();
    const rejected = result.evaluatedCandidates.filter(
      (candidate) => candidate.definitivelyRejected === true,
    );

    // 8 invalid_domain + 7 ownership_mismatch + 1 sector contradictorio = 16.
    assert.equal(rejected.length, 16);
    for (const candidate of rejected) {
      assert.equal(
        candidate.rejectionTallied,
        true,
        `${candidate.candidateKey} está rechazado y debe constar como contado`,
      );
    }

    // Y nadie más lo lleva: un candidato sin rechazo no puede figurar contado.
    const notRejected = result.evaluatedCandidates.filter(
      (candidate) => candidate.definitivelyRejected !== true,
    );
    assert.equal(notRejected.length, 18);
    for (const candidate of notRejected) {
      assert.equal(candidate.rejectionTallied, false, candidate.candidateKey);
    }
  });
});
