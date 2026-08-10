/**
 * apollo-two-round-final-state-consistency.test.ts
 *
 * AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § D.10.
 *
 * Las fuentes del desenlace de una corrida —desglose por ronda,
 * `candidate_snapshots` y `run_metrics`— no pueden contradecirse en disposición
 * final, elegibles, persistidos ni objetivo alcanzado. Cuando lo hacen, el
 * conflicto se NOMBRA.
 *
 * Suite PURA. LIVE_APOLLO_CALLS = 0, APOLLO_CREDITS_USED = 0.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateApolloTwoRoundFinalStateConsistency,
  toFinalStateConsistencyMetadata,
  type FinalStateCandidateView,
  type FinalStateRoundView,
} from '../run-final-state-consistency';

function round(overrides: Partial<FinalStateRoundView> = {}): FinalStateRoundView {
  return {
    roundNumber: 1,
    knownCompanyDuplicates: 0,
    countryRejected: 0,
    sectorRejected: 0,
    ownershipRejected: 0,
    ...overrides,
  };
}

function candidate(
  key: string,
  overrides: Partial<FinalStateCandidateView> = {},
): FinalStateCandidateView {
  return {
    candidate_key: key,
    eligible: false,
    finally_rejected_or_duplicated: true,
    ...overrides,
  };
}

/** Las dos rondas de la corrida `7d92773b`, ya con el sector contabilizado. */
const REFERENCE_ROUNDS: FinalStateRoundView[] = [
  round({ roundNumber: 1, knownCompanyDuplicates: 8, countryRejected: 1, ownershipRejected: 1 }),
  round({
    roundNumber: 2,
    knownCompanyDuplicates: 7,
    ownershipRejected: 2,
    sectorRejected: 1,
  }),
];

const REFERENCE_CANDIDATES = Array.from({ length: 20 }, (_unused, index) =>
  candidate(`apollo:${index}`),
);

describe('§ D.10 — la corrida de referencia queda consistente', () => {
  test('sin conflictos cuando el desglose cierra y los snapshots coinciden', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: REFERENCE_ROUNDS,
      candidates: REFERENCE_CANDIDATES,
      runMetrics: {
        totalUniqueOrganizations: 20,
        totalEligibleCompanies: 0,
        persistedCandidates: 0,
      },
      targetEligibleCompanies: 10,
      targetReached: false,
    });

    assert.equal(consistency.ok, true);
    assert.deepEqual(consistency.conflicts, []);
    assert.equal(consistency.unclassifiedUniqueResults, 0);
    assert.equal(consistency.eligibleFromCandidateSnapshots, 0);
  });

  test('el estado ANTERIOR al arreglo se detecta: 1 empresa sin clasificar', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [
        REFERENCE_ROUNDS[0],
        round({ roundNumber: 2, knownCompanyDuplicates: 7, ownershipRejected: 2 }),
      ],
      candidates: REFERENCE_CANDIDATES,
      runMetrics: {
        totalUniqueOrganizations: 20,
        totalEligibleCompanies: 0,
        persistedCandidates: 0,
      },
      targetEligibleCompanies: 10,
      targetReached: false,
    });

    assert.equal(consistency.ok, false);
    assert.equal(consistency.unclassifiedUniqueResults, 1);
    assert.equal(
      consistency.conflicts.some(
        (conflict) => conflict.code === 'round_breakdown_leaves_unique_results_unclassified',
      ),
      true,
    );
  });
});

describe('§ D.10 — contradicciones entre fuentes', () => {
  test('un snapshot eligible que run_metrics no reconoce (el caso La Vaquita)', () => {
    const candidates = [
      ...REFERENCE_CANDIDATES.slice(0, 19),
      candidate('apollo:vaquita', { eligible: true, finally_rejected_or_duplicated: false }),
    ];

    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: REFERENCE_ROUNDS,
      candidates,
      runMetrics: {
        totalUniqueOrganizations: 20,
        totalEligibleCompanies: 0,
        persistedCandidates: 0,
      },
      targetEligibleCompanies: 10,
      targetReached: false,
    });

    assert.equal(consistency.ok, false);
    assert.equal(consistency.eligibleFromCandidateSnapshots, 1);
    assert.equal(
      consistency.conflicts.some(
        (conflict) => conflict.code === 'eligible_count_disagrees_with_run_metrics',
      ),
      true,
    );
  });

  test('un snapshot que se contradice a sí mismo se nombra', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [round({ knownCompanyDuplicates: 1 })],
      candidates: [
        candidate('apollo:uno', { eligible: true, finally_rejected_or_duplicated: true }),
      ],
      runMetrics: {
        totalUniqueOrganizations: 1,
        totalEligibleCompanies: 0,
        persistedCandidates: 0,
      },
      targetEligibleCompanies: 1,
      targetReached: false,
    });

    assert.equal(
      consistency.conflicts.some(
        (conflict) => conflict.code === 'candidate_snapshot_contradicts_itself',
      ),
      true,
    );
  });

  test('persistir más de lo elegible se nombra', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [round()],
      candidates: [candidate('apollo:uno', { eligible: true, finally_rejected_or_duplicated: false })],
      runMetrics: {
        totalUniqueOrganizations: 1,
        totalEligibleCompanies: 1,
        persistedCandidates: 3,
      },
      targetEligibleCompanies: 1,
      targetReached: true,
    });

    assert.equal(
      consistency.conflicts.some((conflict) => conflict.code === 'persisted_exceeds_eligible'),
      true,
    );
  });

  test('`target_reached` tiene que derivarse de los elegibles declarados', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [round({ knownCompanyDuplicates: 1 })],
      candidates: [candidate('apollo:uno')],
      runMetrics: {
        totalUniqueOrganizations: 1,
        totalEligibleCompanies: 0,
        persistedCandidates: 0,
      },
      targetEligibleCompanies: 5,
      targetReached: true, // ← mentira
    });

    assert.equal(
      consistency.conflicts.some(
        (conflict) => conflict.code === 'target_reached_disagrees_with_eligible_count',
      ),
      true,
    );
  });

  test('un estado final sin snapshots (checkpoint compactado) no inventa conflicto de universo', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [round({ knownCompanyDuplicates: 4 })],
      candidates: [],
      runMetrics: {
        totalUniqueOrganizations: 4,
        totalEligibleCompanies: 0,
        persistedCandidates: 0,
      },
      targetEligibleCompanies: 5,
      targetReached: false,
    });

    assert.equal(
      consistency.conflicts.some(
        (conflict) => conflict.code === 'candidate_snapshot_count_disagrees_with_run_metrics',
      ),
      false,
    );
    assert.equal(consistency.ok, true);
  });
});

describe('§ D.10 — proyección a metadata', () => {
  test('sólo códigos y detalles cortos: ningún nombre de empresa ni dominio', () => {
    const metadata = toFinalStateConsistencyMetadata(
      evaluateApolloTwoRoundFinalStateConsistency({
        rounds: [round()],
        candidates: [candidate('apollo:uno', { eligible: true, finally_rejected_or_duplicated: true })],
        runMetrics: {
          totalUniqueOrganizations: 1,
          totalEligibleCompanies: 0,
          persistedCandidates: 0,
        },
        targetEligibleCompanies: 1,
        targetReached: false,
      }),
    );

    const serialized = JSON.stringify(metadata);
    assert.equal(serialized.includes('apollo:uno'), false);
    assert.equal(typeof (metadata as { ok: boolean }).ok, 'boolean');
    assert.ok(Array.isArray((metadata as { conflicts: unknown[] }).conflicts));
  });
});
