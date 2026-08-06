/**
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 1 — fuente de verdad de persistidos.
 *
 * El caso que gobierna todo este archivo es el de la corrida `be181d2d…` / lote
 * `e1622574…`: la observabilidad publicó tres persistidos y la base tenía dos.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_PERSISTED_SOURCE,
  buildApolloPersistenceReconciliation,
  reconcileApolloTwoRoundPersistedTruth,
} from '../apollo-persisted-candidate-truth';

/** La observabilidad tal como el orquestador la dejó en la corrida live. */
function liveObservability(): Record<string, unknown> {
  return {
    modality: 'two_round_adaptive',
    target_reached: false,
    run_metrics: {
      rounds_executed: 2,
      total_search_credits: 20,
      total_enrichment_credits: 5,
      total_unique_organizations: 20,
      total_eligible_companies: 3,
      // La proyección del ranking, que es lo que se publicaba como hecho.
      persisted_candidates: 3,
      credits_per_persisted_company: 8.3333,
    },
  };
}

describe('§ 1 · la verdad es el writer, no la proyección', () => {
  test('persisted_candidates pasa a ser el recuento de filas', () => {
    const out = reconcileApolloTwoRoundPersistedTruth(liveObservability(), {
      eligibleBeforePersistence: 3,
      persistedCandidates: 2,
      completeValidCandidates: 2,
      gapCauses: { ownership_rejected: 1 },
      targetEligibleCompanies: 5,
    });

    assert.ok(out !== null);
    const metrics = out.observability['run_metrics'] as Record<string, unknown>;
    assert.equal(metrics['persisted_candidates'], 2);
    assert.equal(metrics['eligible_before_persistence'], 3);
    assert.equal(metrics['persistence_gap'], 1);
    // La proyección no se borra: se guarda con su propio nombre para poder
    // comparar las dos sin volver a confundirlas.
    assert.equal(metrics['projected_persistable_candidates'], 3);
    assert.equal(metrics['canonical_persisted_source'], CANONICAL_PERSISTED_SOURCE);
  });

  test('el costo por candidato se recalcula sobre las filas: 25 / 2 = 12.5', () => {
    const out = reconcileApolloTwoRoundPersistedTruth(liveObservability(), {
      eligibleBeforePersistence: 3,
      persistedCandidates: 2,
      completeValidCandidates: 2,
      gapCauses: { ownership_rejected: 1 },
      targetEligibleCompanies: 5,
    });

    assert.ok(out !== null);
    const metrics = out.observability['run_metrics'] as Record<string, unknown>;
    assert.equal(metrics['credits_per_persisted_company'], 12.5);
    assert.equal(out.reconciliation.total_credits, 25);
  });

  test('target_reached se decide sobre persistidos, no sobre elegibles', () => {
    const out = reconcileApolloTwoRoundPersistedTruth(liveObservability(), {
      eligibleBeforePersistence: 3,
      persistedCandidates: 2,
      completeValidCandidates: 2,
      gapCauses: { ownership_rejected: 1 },
      targetEligibleCompanies: 5,
    });

    assert.ok(out !== null);
    assert.equal(out.observability['target_reached'], false);
    assert.equal(out.reconciliation.target_reached, false);
  });

  test('nunca se infieren tres persistidos cuando hay dos filas', () => {
    const out = reconcileApolloTwoRoundPersistedTruth(liveObservability(), {
      eligibleBeforePersistence: 3,
      persistedCandidates: 2,
      completeValidCandidates: 2,
      gapCauses: { ownership_rejected: 1 },
      targetEligibleCompanies: 5,
    });

    assert.ok(out !== null);
    const serialized = JSON.stringify(out.observability['run_metrics']);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    assert.notEqual(parsed['persisted_candidates'], 3);
  });

  test('con el objetivo alcanzado sobre filas reales, target_reached es true', () => {
    const out = reconcileApolloTwoRoundPersistedTruth(liveObservability(), {
      eligibleBeforePersistence: 5,
      persistedCandidates: 5,
      completeValidCandidates: 5,
      gapCauses: {},
      targetEligibleCompanies: 5,
    });

    assert.ok(out !== null);
    assert.equal(out.observability['target_reached'], true);
    assert.equal(out.reconciliation.persistence_gap, 0);
  });
});

describe('§ 1 · el hueco lleva causa explícita', () => {
  test('la causa declarada explica el hueco completo', () => {
    const reconciliation = buildApolloPersistenceReconciliation(
      {
        eligibleBeforePersistence: 3,
        persistedCandidates: 2,
        completeValidCandidates: 2,
        gapCauses: { ownership_rejected: 1 },
        targetEligibleCompanies: 5,
      },
      25,
    );

    assert.equal(reconciliation.persistence_gap, 1);
    assert.equal(reconciliation.gap_causes.ownership_rejected, 1);
    assert.equal(reconciliation.unexplained_gap, 0);
  });

  test('un hueco sin causa queda declarado como inexplicado, no repartido', () => {
    const reconciliation = buildApolloPersistenceReconciliation(
      {
        eligibleBeforePersistence: 4,
        persistedCandidates: 2,
        completeValidCandidates: 2,
        gapCauses: { ownership_rejected: 1 },
        targetEligibleCompanies: 5,
      },
      25,
    );

    assert.equal(reconciliation.persistence_gap, 2);
    assert.equal(reconciliation.unexplained_gap, 1);
  });

  test('sin filas, el costo por candidato es null y nunca cero', () => {
    const reconciliation = buildApolloPersistenceReconciliation(
      {
        eligibleBeforePersistence: 2,
        persistedCandidates: 0,
        completeValidCandidates: 0,
        gapCauses: { ownership_rejected: 2 },
        targetEligibleCompanies: 5,
      },
      25,
    );

    assert.equal(reconciliation.credits_per_persisted_company, null);
    assert.equal(reconciliation.target_reached, false);
  });

  test('los elegibles nunca quedan por debajo de los persistidos', () => {
    // Un llamador que declarara menos elegibles que filas produciría un hueco
    // negativo. Se corrige hacia arriba en vez de publicar un imposible.
    const reconciliation = buildApolloPersistenceReconciliation(
      {
        eligibleBeforePersistence: 1,
        persistedCandidates: 3,
        completeValidCandidates: 3,
        gapCauses: {},
        targetEligibleCompanies: 5,
      },
      25,
    );

    assert.equal(reconciliation.eligible_before_persistence, 3);
    assert.equal(reconciliation.persistence_gap, 0);
  });
});

describe('§ 1 · alcance de la reconciliación', () => {
  test('un lote sin bloque de dos rondas no se toca', () => {
    assert.equal(
      reconcileApolloTwoRoundPersistedTruth(undefined, {
        eligibleBeforePersistence: 1,
        persistedCandidates: 1,
        completeValidCandidates: 1,
        gapCauses: {},
        targetEligibleCompanies: 5,
      }),
      null,
    );
    assert.equal(
      reconcileApolloTwoRoundPersistedTruth(
        { modality: 'otra_cosa' },
        {
          eligibleBeforePersistence: 1,
          persistedCandidates: 1,
          completeValidCandidates: 1,
          gapCauses: {},
          targetEligibleCompanies: 5,
        },
      ),
      null,
    );
  });

  test('no muta el objeto recibido y conserva lo que no le compete', () => {
    const original = liveObservability();
    original['rounds'] = [{ round_number: 1 }];
    const snapshot = JSON.parse(JSON.stringify(original));

    const out = reconcileApolloTwoRoundPersistedTruth(original, {
      eligibleBeforePersistence: 3,
      persistedCandidates: 2,
      completeValidCandidates: 2,
      gapCauses: { ownership_rejected: 1 },
      targetEligibleCompanies: 5,
    });

    assert.ok(out !== null);
    assert.deepEqual(original, snapshot);
    assert.deepEqual(out.observability['rounds'], [{ round_number: 1 }]);
    const metrics = out.observability['run_metrics'] as Record<string, unknown>;
    assert.equal(metrics['total_search_credits'], 20);
    assert.equal(metrics['total_unique_organizations'], 20);
  });
});
