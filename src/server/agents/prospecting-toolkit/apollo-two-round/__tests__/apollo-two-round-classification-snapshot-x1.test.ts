/**
 * apollo-two-round-classification-snapshot-x1.test.ts
 *
 * AGENT1-CLASSIFICATION-RECONCILIATION-X1 — el snapshot del checkpoint publica
 * el veredicto DEFINITIVO, no sólo el barato.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `toCandidateSnapshot` llenaba `rejection_reason` con `assessment.rejection`,
 * que es el veredicto de los gates GRATUITOS. Un candidato que muere en el gate
 * FINAL de ownership tiene ahí `null`, así que su snapshot decía a la vez
 * «rechazado definitivamente» (`finally_rejected_or_duplicated: true`) y «sin
 * motivo» (`rejection_reason: null`).
 *
 * En el lote `c7c28980-772b-425a-b548-581cfecb32f7` los SIETE
 * `ownership_mismatch` viajaron así. Se puede comprobar contra Producción: los
 * ocho snapshots con motivo son exactamente los ocho `invalid_domain`, y son los
 * ocho que NO tienen dominio.
 *
 * Consecuencia práctica, y no sólo de lectura: `toResumeStateFromCheckpoint`
 * rehidrata `assessment.rejection` DESDE este campo. Con `null`, un reintento
 * recuperaba al candidato sin su rechazo y lo devolvía a la cohorte de revisión
 * para volver a pasarlo por el gate que ya lo había rechazado.
 *
 * Offline: `toCandidateSnapshot` y `toResumeStateFromCheckpoint` son puras.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  toCandidateSnapshot,
  toResumeStateFromCheckpoint,
  type ApolloTwoRoundCheckpointV1,
} from '../production-runner.server';
import type { ResumedCandidate } from '../orchestrator';
import { passingAssessment, rejectedAssessment, ambiguousAssessment } from './fixtures';

function resumed(overrides: Partial<ResumedCandidate> = {}): ResumedCandidate {
  return {
    candidateKey: 'apollo:copadpharma',
    roundNumber: 1,
    providerRank: 7,
    identity: {
      providerOrganizationId: '5e5638784636bd0001e050c2',
      normalizedDomain: 'copadeg.com',
      normalizedLinkedInUrl: 'linkedin.com/company/copadpharma',
      canonicalName: 'copadpharma',
    },
    assessment: ambiguousAssessment(),
    sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    eligible: false,
    becameEligibleAfterEnrichment: false,
    enrichmentExecuted: true,
    finallyRejectedOrDuplicated: true,
    definitivelyRejected: true,
    definitiveRejectionReason: 'ownership_mismatch',
    ...overrides,
  };
}

describe('§ snapshot · rejection_reason refleja el veredicto definitivo', () => {
  test('🔴 un rechazo del gate FINAL deja de publicarse como «sin motivo»', () => {
    const snapshot = toCandidateSnapshot(resumed(), null, 'not_attempted');

    // Antes de X1: null.
    assert.equal(snapshot.rejection_reason, 'ownership_mismatch');
    assert.equal(snapshot.finally_rejected_or_duplicated, true);
    assert.equal(snapshot.eligible, false);
  });

  test('un rechazo BARATO no cambia de valor: el `??` sólo rellena huecos', () => {
    const candidate = resumed({
      candidateKey: 'apollo:sin_dominio_1',
      assessment: rejectedAssessment('invalid_domain'),
      // Se siembra con el barato, como hace el orquestador.
      definitiveRejectionReason: 'invalid_domain',
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      enrichmentExecuted: false,
    });

    const snapshot = toCandidateSnapshot(candidate, null, 'not_attempted');
    assert.equal(snapshot.rejection_reason, 'invalid_domain');
    assert.equal(snapshot.rejection_reason, candidate.assessment.rejection);
  });

  test('un candidato SIN rechazo sigue publicando null', () => {
    const snapshot = toCandidateSnapshot(
      resumed({
        candidateKey: 'apollo:vivo',
        assessment: passingAssessment(),
        sectorEvidenceState: 'sector_evidence_confirmed',
        eligible: true,
        finallyRejectedOrDuplicated: false,
        definitivelyRejected: false,
        definitiveRejectionReason: null,
      }),
      null,
      'not_attempted',
    );

    assert.equal(snapshot.rejection_reason, null);
  });

  test('el rechazo definitivo SOBREVIVE al viaje de ida y vuelta por el checkpoint', () => {
    const snapshot = toCandidateSnapshot(resumed(), null, 'executed');
    const checkpoint = {
      version: 1,
      checkpoint_version: 1,
      candidate_snapshots: [snapshot],
      totals: {
        raw_results: 1,
        search_credits: 1,
        enrichment_credits: 1,
        enrichments_executed: 1,
      },
      second_round_skipped_reason: null,
      round_summaries: [],
      seen_organization_keys: [],
      enrichment_snapshots: [],
      recorded_operation_credits: [],
      completed_operation_keys: [],
      indeterminate_operation_keys: [],
      indeterminate_operations: [],
      pending_organizations: [],
      persisted_candidate_ids: [],
      checkpoint_write_failures: [],
      observed_rejection_reasons: [],
      candidates_persisted: false,
      compacted: false,
    } as unknown as ApolloTwoRoundCheckpointV1;

    const resume = toResumeStateFromCheckpoint(checkpoint);
    const recovered = resume.candidates[0];
    assert.ok(recovered);

    // 🔴 Antes de X1 esto era `null`, y con él el reintento perdía el rechazo:
    // `definitivelyRejected` se deriva de aquí, y sin él el candidato volvía a la
    // cohorte de revisión a que el gate lo rechazara otra vez.
    assert.equal(recovered.assessment.rejection, 'ownership_mismatch');
    assert.equal(recovered.finallyRejectedOrDuplicated, true);
    assert.equal(recovered.enrichmentExecuted, true);
  });
});
