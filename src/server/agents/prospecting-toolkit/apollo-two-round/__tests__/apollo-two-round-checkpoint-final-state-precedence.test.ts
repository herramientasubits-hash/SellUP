/**
 * apollo-two-round-checkpoint-final-state-precedence.test.ts
 *
 * AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § C.8 / § C.9.
 *
 * Defecto: `candidateEvaluationProgress` valoraba IGUAL `eligible` y
 * `finally_rejected_or_duplicated`. Con el mismo `enrichment_status` a ambos
 * lados eso es un empate, y un empate conserva `existing`, así que un snapshot
 * ANTERIOR con `eligible: true` bloqueaba al posterior que ya traía el rechazo
 * de los gates finales.
 *
 * Ocurrió en la corrida `7d92773b`: «Supermercado Vaquita» quedó archivada como
 * `eligible: true` / `finally_rejected_or_duplicated: false` mientras
 * `run_metrics` declaraba 0 elegibles y 0 persistidos.
 *
 * Suite PURA: sin I/O, sin reloj, sin proveedor.
 *   LIVE_APOLLO_CALLS = 0
 *   APOLLO_CREDITS_USED = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mergeApolloTwoRoundCheckpoints } from '../checkpoint-merge';
import type { ApolloTwoRoundCheckpointV1 } from '../checkpoint';
import { defaultApolloTwoRoundConfig } from '../config';

const IDENTITY = {
  idempotencyKey: 'idempotency-final-state-1',
  requestFingerprint: 'fingerprint-final-state-1',
  wizardRunId: 'run-final-state-1',
};

type Snapshot = ApolloTwoRoundCheckpointV1['candidate_snapshots'][number];

function checkpoint(
  overrides: Partial<ApolloTwoRoundCheckpointV1> = {},
): ApolloTwoRoundCheckpointV1 {
  return {
    version: 1,
    checkpoint_version: 1,
    checkpoint_updated_at: null,
    checkpoint_reason: 'run_completed',
    idempotency_key: IDENTITY.idempotencyKey,
    request_fingerprint: IDENTITY.requestFingerprint,
    wizard_run_id: IDENTITY.wizardRunId,
    config: defaultApolloTwoRoundConfig(),
    completed_operation_keys: [],
    indeterminate_operation_keys: [],
    seen_organization_keys: [],
    round_summaries: [],
    candidate_snapshots: [],
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
    ...overrides,
  };
}

function snapshot(key: string, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    candidate_key: key,
    round_number: 1,
    provider_rank: 1,
    provider_organization_id: `org-${key}`,
    normalized_name: key,
    normalized_domain: `${key}.com.co`,
    normalized_linkedin_url: null,
    sector_evidence_state: 'sector_evidence_confirmed',
    rejection_reason: null,
    eligible: false,
    became_eligible_after_enrichment: false,
    finally_rejected_or_duplicated: false,
    no_prior_suggestion: true,
    enrichment_status: 'not_attempted',
    ranking_signals: {
      countryCompatible: true,
      domainConfident: true,
      ownershipConfident: true,
      sectorKeywordMatchCount: 2,
      novel: true,
      hasCompanySizeSignal: true,
      hasLocationSignal: true,
      hasLinkedInUrl: false,
      freeOfContradictoryEvidence: true,
      knownDuplicate: false,
      cooldownActive: false,
    },
    evidence: null,
    ...overrides,
  };
}

/** Fusiona un candidato base con su versión entrante y devuelve el ganador. */
function mergeOne(existing: Snapshot, incoming: Snapshot): Snapshot {
  const merged = mergeApolloTwoRoundCheckpoints(
    checkpoint({ candidate_snapshots: [existing] }),
    checkpoint({ candidate_snapshots: [incoming] }),
  );
  assert.notEqual(merged.kind, 'refused', 'la fusión no debía rehusarse');
  const resolved = merged as Extract<typeof merged, { checkpoint: unknown }>;
  assert.equal(resolved.checkpoint.candidate_snapshots.length, 1);
  return resolved.checkpoint.candidate_snapshots[0]!;
}

const ELIGIBLE: Partial<Snapshot> = { eligible: true, finally_rejected_or_duplicated: false };
const FINALLY_REJECTED: Partial<Snapshot> = {
  eligible: false,
  finally_rejected_or_duplicated: true,
};
const INTERMEDIATE: Partial<Snapshot> = {
  eligible: false,
  finally_rejected_or_duplicated: false,
  sector_evidence_state: 'sector_evidence_missing_needs_enrichment',
};

describe('§ C.8 — el estado FINAL manda sobre un eligible anterior', () => {
  test('existing eligible + incoming rechazo final ⇒ gana el rechazo', () => {
    const winner = mergeOne(
      snapshot('vaquita', ELIGIBLE),
      snapshot('vaquita', { ...FINALLY_REJECTED, rejection_reason: 'ownership_mismatch' }),
    );

    assert.equal(winner.eligible, false);
    assert.equal(winner.finally_rejected_or_duplicated, true);
    assert.equal(winner.rejection_reason, 'ownership_mismatch');
  });

  test('existing rechazo final + incoming eligible ⇒ el rechazo permanece', () => {
    const winner = mergeOne(
      snapshot('vaquita', { ...FINALLY_REJECTED, rejection_reason: 'ownership_mismatch' }),
      snapshot('vaquita', ELIGIBLE),
    );

    assert.equal(winner.finally_rejected_or_duplicated, true);
    assert.equal(winner.eligible, false);
  });

  test('existing rechazo por ownership + incoming intermedio ⇒ el rechazo permanece', () => {
    const winner = mergeOne(
      snapshot('vaquita', { ...FINALLY_REJECTED, rejection_reason: 'ownership_mismatch' }),
      snapshot('vaquita', INTERMEDIATE),
    );

    assert.equal(winner.finally_rejected_or_duplicated, true);
    assert.equal(winner.rejection_reason, 'ownership_mismatch');
  });

  test('existing intermedio + incoming eligible ⇒ gana el eligible (resuelto > sin resolver)', () => {
    const winner = mergeOne(snapshot('otra', INTERMEDIATE), snapshot('otra', ELIGIBLE));

    assert.equal(winner.eligible, true);
    assert.equal(winner.finally_rejected_or_duplicated, false);
  });

  test('dos eligible ⇒ manda el mayor progreso de enrichment (regla existente intacta)', () => {
    const winner = mergeOne(
      snapshot('otra', { ...ELIGIBLE, enrichment_status: 'not_attempted' }),
      snapshot('otra', { ...ELIGIBLE, enrichment_status: 'executed' }),
    );

    assert.equal(winner.enrichment_status, 'executed');
    assert.equal(winner.eligible, true);
  });

  test('`indeterminate` sigue siendo la señal más restrictiva y no se degrada', () => {
    const winner = mergeOne(
      snapshot('otra', { ...ELIGIBLE, enrichment_status: 'indeterminate' }),
      snapshot('otra', { ...FINALLY_REJECTED, enrichment_status: 'executed' }),
    );

    // El estado de gasto pesa por encima del veredicto: perder `indeterminate`
    // sería perder la señal que exige conciliación manual y detiene el gasto.
    assert.equal(winner.enrichment_status, 'indeterminate');
  });

  test('la fusión sigue siendo idempotente y estable', () => {
    const existing = snapshot('vaquita', ELIGIBLE);
    const incoming = snapshot('vaquita', FINALLY_REJECTED);

    const once = mergeOne(existing, incoming);
    const twice = mergeOne(once, incoming);

    assert.deepEqual(twice, once);
  });
});

describe('§ C.9 — La Vaquita: el checkpoint final coincide con run_metrics', () => {
  test('el snapshot final queda rechazado por ownership, no elegible', () => {
    // Secuencia real: `enrichment_completed` la vio elegible; los gates finales
    // la rechazaron por ownership y `run_completed` trajo ese veredicto.
    const preFinal = snapshot('apollo:623fc7bc96c7770001c40616', {
      ...ELIGIBLE,
      normalized_name: 'supermercado vaquita',
      enrichment_status: 'not_attempted',
    });
    const final = snapshot('apollo:623fc7bc96c7770001c40616', {
      ...FINALLY_REJECTED,
      normalized_name: 'supermercado vaquita',
      enrichment_status: 'not_attempted',
      rejection_reason: 'ownership_mismatch',
    });

    const winner = mergeOne(preFinal, final);

    assert.equal(winner.eligible, false);
    assert.equal(winner.finally_rejected_or_duplicated, true);
    assert.equal(winner.rejection_reason, 'ownership_mismatch');

    // Y esto es lo que run_metrics declaraba para esa corrida.
    const eligibleFromSnapshots = [winner].filter(
      (s) => s.eligible && !s.finally_rejected_or_duplicated,
    ).length;
    assert.equal(eligibleFromSnapshots, 0);
  });
});
