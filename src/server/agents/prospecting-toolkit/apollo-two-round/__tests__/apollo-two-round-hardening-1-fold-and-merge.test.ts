/**
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 · §§ 1 y 3.
 *
 * Dos piezas pequeñas de las que depende todo lo demás:
 *
 *   § 3 — el pliegue del veredicto de subindustria sobre el de sector, que es lo
 *         que impide que «confirmado por el gate sectorial» siga bastando.
 *   § 1 — el desempate de la fusión de checkpoints. Con el mismo
 *         `enrichment_status` en ambos lados, el ganador era SIEMPRE el suelo
 *         durable (más antiguo), así que la reevaluación posterior al enrichment
 *         no llegaba nunca al documento: en la corrida `be181d2d` las empresas
 *         confirmadas quedaron almacenadas como `eligible: false`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { foldSubindustryPrecisionIntoSectorState } from '../production-runner.server';
import { assessApolloSubindustryPrecision } from '../../apollo-subindustry-precision';
import { mergeApolloTwoRoundCheckpoints } from '../checkpoint-merge';
import type {
  ApolloTwoRoundCandidateSnapshot,
  ApolloTwoRoundCheckpointV1,
} from '../checkpoint';
import { defaultApolloTwoRoundConfig } from '../config';
import type { WebSearchResult } from '../../types';

const SUBINDUSTRY = 'Supermercados e Hipermercados';

function result(metadata: Record<string, unknown>, title = 'Empresa'): WebSearchResult {
  return {
    title,
    url: 'https://ejemplo.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata,
  } as unknown as WebSearchResult;
}

// ─── § 3 · el pliegue ─────────────────────────────────────────────────────────

describe('§ 3 · la subindustria degrada al sector, nunca lo rescata', () => {
  test('sector confirmado + subindustria ambigua ⇒ vuelve a competir por enrichment', () => {
    const precision = assessApolloSubindustryPrecision(
      result({ industry: 'retail' }),
      SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMatch, 'ambiguous');

    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', precision),
      'sector_evidence_missing_needs_enrichment',
    );
  });

  test('sector confirmado + subindustria rechazada ⇒ contradictorio', () => {
    const precision = assessApolloSubindustryPrecision(
      result({
        industry: 'food and beverages',
        keywords: ['wholesale distribution', 'food distribution'],
      }),
      SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMatch, 'rejected');

    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', precision),
      'sector_evidence_contradictory',
    );
  });

  test('sector confirmado + subindustria confirmada ⇒ se conserva confirmado', () => {
    const precision = assessApolloSubindustryPrecision(
      result({ short_description: 'Opera hipermercados en el país.' }),
      SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMatch, 'confirmed');

    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_confirmed', precision),
      'sector_evidence_confirmed',
    );
  });

  test('una subindustria confirmada NO rescata un sector contradicho', () => {
    const precision = assessApolloSubindustryPrecision(
      result({ short_description: 'Opera hipermercados.' }),
      SUBINDUSTRY,
    );
    assert.equal(precision.subindustryMatch, 'confirmed');

    // La contradicción es evidencia en contra y no se compensa con una
    // coincidencia de palabra: el pliegue sólo puede degradar.
    assert.equal(
      foldSubindustryPrecisionIntoSectorState('sector_evidence_contradictory', precision),
      'sector_evidence_contradictory',
    );
  });

  test('sin subindustria mapeada el pliegue es la identidad', () => {
    const precision = assessApolloSubindustryPrecision(result({ industry: 'retail' }), null);
    assert.equal(precision.subindustryMapped, false);

    for (const base of [
      'sector_evidence_confirmed',
      'sector_evidence_missing_needs_enrichment',
      'sector_evidence_contradictory',
      'sector_not_mapped',
    ] as const) {
      assert.equal(foldSubindustryPrecisionIntoSectorState(base, precision), base);
    }
  });
});

// ─── § 1 · el desempate de la fusión ──────────────────────────────────────────

function snapshot(
  overrides: Partial<ApolloTwoRoundCandidateSnapshot> = {},
): ApolloTwoRoundCandidateSnapshot {
  return {
    candidate_key: 'apollo:enr1',
    round_number: 1,
    provider_rank: 1,
    provider_organization_id: 'enr1',
    normalized_name: 'enr1',
    normalized_domain: 'enr1.com',
    normalized_linkedin_url: null,
    sector_evidence_state: 'sector_evidence_missing_needs_enrichment',
    rejection_reason: null,
    eligible: false,
    became_eligible_after_enrichment: false,
    finally_rejected_or_duplicated: false,
    no_prior_suggestion: true,
    enrichment_status: 'executed',
    ranking_signals: {},
    evidence: null,
    ...overrides,
  } as ApolloTwoRoundCandidateSnapshot;
}

function checkpoint(
  candidates: ApolloTwoRoundCandidateSnapshot[],
  version: number,
): ApolloTwoRoundCheckpointV1 {
  return {
    version: 1,
    checkpoint_version: version,
    checkpoint_updated_at: null,
    checkpoint_reason: 'run_completed',
    idempotency_key: 'idempotency-hardening-1',
    request_fingerprint: 'fingerprint-hardening-1',
    wizard_run_id: 'run-hardening-1',
    config: defaultApolloTwoRoundConfig(),
    completed_operation_keys: [],
    indeterminate_operation_keys: [],
    seen_organization_keys: [],
    round_summaries: [],
    candidate_snapshots: candidates,
    pending_organizations: [],
    enrichment_snapshots: [],
    recorded_operation_credits: [],
    persisted_candidate_ids: [],
    candidates_persisted: false,
    observed_rejection_reasons: [],
    second_round_skipped_reason: null,
    totals: { raw_results: 0, search_credits: 0, enrichment_credits: 0, enrichments_executed: 0 },
    spend_accounting: {
      estimated_credits: 12,
      reserved_credits: 12,
      recorded_usage_credits: 0,
      confirmed_provider_credits: null,
    },
    checkpoint_write_failures: [],
    manual_reconciliation_required: false,
    compacted: false,
  } as unknown as ApolloTwoRoundCheckpointV1;
}

describe('§ 1 · la fusión conserva el veredicto MÁS resuelto', () => {
  test('a igual enrichment_status, gana el candidato con veredicto final', () => {
    // Suelo durable: enriquecido pero todavía en evaluación.
    const base = checkpoint([snapshot()], 10);
    // Documento nuevo: el mismo enrichment, ya evaluado y elegible.
    const incoming = checkpoint(
      [
        snapshot({
          eligible: true,
          became_eligible_after_enrichment: true,
          sector_evidence_state: 'sector_evidence_confirmed',
        }),
      ],
      11,
    );

    const merged = mergeApolloTwoRoundCheckpoints(base, incoming);
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;

    const [candidate] = merged.checkpoint.candidate_snapshots;
    assert.equal(candidate.eligible, true, 'la reevaluación posterior debe sobrevivir');
    assert.equal(candidate.sector_evidence_state, 'sector_evidence_confirmed');
    assert.equal(candidate.became_eligible_after_enrichment, true);
  });

  test('un descarte definitivo también gana a «todavía en evaluación»', () => {
    const base = checkpoint([snapshot()], 10);
    const incoming = checkpoint(
      [snapshot({ finally_rejected_or_duplicated: true, rejection_reason: 'ownership_mismatch' })],
      11,
    );

    const merged = mergeApolloTwoRoundCheckpoints(base, incoming);
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;

    const [candidate] = merged.checkpoint.candidate_snapshots;
    assert.equal(candidate.finally_rejected_or_duplicated, true);
    assert.equal(candidate.rejection_reason, 'ownership_mismatch');
  });

  test('un veredicto resuelto NUNCA retrocede a sin resolver', () => {
    const base = checkpoint([snapshot({ eligible: true })], 11);
    const incoming = checkpoint([snapshot({ eligible: false })], 12);

    const merged = mergeApolloTwoRoundCheckpoints(base, incoming);
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;

    // Monotonía: la fusión concurrente sólo puede avanzar hacia «resuelto».
    assert.equal(merged.checkpoint.candidate_snapshots[0].eligible, true);
  });

  test('el progreso de enrichment sigue mandando sobre el de evaluación', () => {
    const base = checkpoint(
      [snapshot({ enrichment_status: 'not_attempted', eligible: true })],
      10,
    );
    const incoming = checkpoint(
      [snapshot({ enrichment_status: 'executed', eligible: false })],
      11,
    );

    const merged = mergeApolloTwoRoundCheckpoints(base, incoming);
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;

    assert.equal(merged.checkpoint.candidate_snapshots[0].enrichment_status, 'executed');
  });

  test('la fusión es idempotente: fusionar dos veces no cambia nada', () => {
    const base = checkpoint([snapshot()], 10);
    const incoming = checkpoint([snapshot({ eligible: true })], 11);

    const once = mergeApolloTwoRoundCheckpoints(base, incoming);
    assert.equal(once.kind, 'merged');
    if (once.kind !== 'merged') return;

    const twice = mergeApolloTwoRoundCheckpoints(once.checkpoint, incoming);
    assert.equal(twice.kind, 'merged');
    if (twice.kind !== 'merged') return;

    assert.deepEqual(twice.checkpoint.candidate_snapshots, once.checkpoint.candidate_snapshots);
  });
});
