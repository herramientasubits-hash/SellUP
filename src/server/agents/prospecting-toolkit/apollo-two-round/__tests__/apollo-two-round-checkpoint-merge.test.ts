/**
 * apollo-two-round-checkpoint-merge.test.ts — Invariantes de la fusión y de la
 * prueba de contención.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-CAS-CLOSE · § 1, § 2, § 4.
 *
 * Suite PURA: sin I/O, sin reloj, sin proveedor.
 *   LIVE_APOLLO_CALLS = 0
 *   APOLLO_CREDITS_USED = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeApolloTwoRoundCheckpoints,
  sumRecordedOperationCredits,
  hasUnknownOperationBilling,
  verifyDurableCheckpointContainsOperation,
} from '../checkpoint-merge';
import type { ApolloTwoRoundCheckpointV1 } from '../checkpoint';
import { defaultApolloTwoRoundConfig } from '../config';
import { buildEmptyRoundMetrics } from '../observability';

const IDENTITY = {
  idempotencyKey: 'idempotency-merge-1',
  requestFingerprint: 'fingerprint-merge-1',
  wizardRunId: 'run-merge-1',
};

function checkpoint(
  overrides: Partial<ApolloTwoRoundCheckpointV1> = {},
): ApolloTwoRoundCheckpointV1 {
  return {
    version: 1,
    checkpoint_version: 1,
    checkpoint_updated_at: null,
    checkpoint_reason: 'search_round_completed',
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

function credit(
  operationId: string,
  credits: number,
  billingUnknown = false,
): ApolloTwoRoundCheckpointV1['recorded_operation_credits'][number] {
  return {
    operation_id: operationId,
    operation_key: 'organization_enrichment',
    round_number: 1,
    usage_key: `organization_enrichment:batch:${operationId}`,
    credits,
    billing_unknown: billingUnknown,
  };
}

function candidateSnapshot(
  key: string,
  overrides: Partial<ApolloTwoRoundCheckpointV1['candidate_snapshots'][number]> = {},
): ApolloTwoRoundCheckpointV1['candidate_snapshots'][number] {
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
    eligible: true,
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

// ─── § 2 · invariantes de la fusión ───────────────────────────────────────────

describe('CAS-CLOSE § 2 · la fusión no pierde nada y no suma dos veces', () => {
  test('ninguna operación desaparece: las claves se unen', () => {
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({ completed_operation_keys: ['op-a'] }),
      checkpoint({ completed_operation_keys: ['op-b'] }),
    );
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;
    assert.deepEqual(merged.checkpoint.completed_operation_keys, ['op-a', 'op-b']);
  });

  test('`indeterminate` prevalece sobre `completed` para la misma operación', () => {
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({ completed_operation_keys: ['op-a'] }),
      checkpoint({ indeterminate_operation_keys: ['op-a'] }),
    );
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;
    assert.deepEqual(merged.checkpoint.completed_operation_keys, [], 'ya no es completada');
    assert.deepEqual(merged.checkpoint.indeterminate_operation_keys, ['op-a']);
    assert.equal(
      merged.checkpoint.manual_reconciliation_required,
      true,
      'y exige conciliación manual',
    );
  });

  test('`candidates_persisted` nunca vuelve a false', () => {
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({ candidates_persisted: true, persisted_candidate_ids: ['c-1'] }),
      checkpoint({ candidates_persisted: false }),
    );
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;
    assert.equal(merged.checkpoint.candidates_persisted, true);
    assert.deepEqual(merged.checkpoint.persisted_candidate_ids, ['c-1']);
  });

  test('los créditos se deduplican por operación: el mismo gasto no se suma dos veces', () => {
    const shared = credit('op-shared', 1);
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({
        recorded_operation_credits: [shared],
        spend_accounting: {
          estimated_credits: 12,
          reserved_credits: 12,
          recorded_usage_credits: 1,
          confirmed_provider_credits: null,
        },
      }),
      checkpoint({
        recorded_operation_credits: [shared, credit('op-otra', 1)],
        spend_accounting: {
          estimated_credits: 12,
          reserved_credits: 12,
          recorded_usage_credits: 2,
          confirmed_provider_credits: null,
        },
      }),
    );
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;
    assert.equal(merged.checkpoint.recorded_operation_credits.length, 2);
    assert.equal(
      merged.checkpoint.spend_accounting.recorded_usage_credits,
      2,
      'dos operaciones, dos créditos — no tres',
    );
  });

  test('un gasto ya declarado no se pierde aunque el desglose no lo explique', () => {
    // Documento antiguo, sin desglose por operación pero con un escalar > 0.
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({
        recorded_operation_credits: [],
        spend_accounting: {
          estimated_credits: 12,
          reserved_credits: 12,
          recorded_usage_credits: 4,
          confirmed_provider_credits: null,
        },
      }),
      checkpoint({ recorded_operation_credits: [credit('op-a', 1)] }),
    );
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;
    assert.equal(
      merged.checkpoint.spend_accounting.recorded_usage_credits,
      4,
      'la fusión nunca ESCONDE gasto ya declarado',
    );
  });

  test('un cobro desconocido gana sobre uno conocido para la misma operación', () => {
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({ recorded_operation_credits: [credit('op-a', 1, false)] }),
      checkpoint({ recorded_operation_credits: [credit('op-a', 1, true)] }),
    );
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;
    assert.equal(merged.checkpoint.recorded_operation_credits[0]?.billing_unknown, true);
    assert.equal(hasUnknownOperationBilling(merged.checkpoint.recorded_operation_credits), true);
    assert.equal(
      merged.checkpoint.spend_accounting.recorded_usage_credits,
      1,
      'y el crédito registrado NO se descuenta: la operación pudo cobrarse',
    );
  });

  test('un resultado durable no se reemplaza por ausencia: gana el candidato más avanzado', () => {
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({
        candidate_snapshots: [candidateSnapshot('uno', { enrichment_status: 'executed' })],
      }),
      checkpoint({
        candidate_snapshots: [candidateSnapshot('uno', { enrichment_status: 'not_attempted' })],
      }),
    );
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;
    assert.equal(merged.checkpoint.candidate_snapshots.length, 1);
    assert.equal(merged.checkpoint.candidate_snapshots[0]?.enrichment_status, 'executed');
  });

  test('una ronda ya registrada deja de tener organizaciones pendientes', () => {
    const pending = {
      round_number: 1,
      provider_rank: 1,
      provider_organization_id: 'org-1',
      name: 'Uno',
      domain: 'uno.com.co',
      linkedin_url: null,
      declared_industry: 'retail',
      evidence: {
        title: 'Uno',
        url: 'https://uno.com.co',
        snippet: null,
        rank: 1,
        source: 'apollo_organizations',
        origin_query: null,
        provider_organization_id: 'org-1',
        domain: 'uno.com.co',
        linkedin_url: null,
        industry: 'retail',
        industries: [],
        keywords: [],
        organization_keywords: [],
        short_description: null,
        seo_description: null,
        description: null,
        city: null,
        country: null,
        country_code: 'CO',
        employee_count: null,
      },
    };
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({ round_summaries: [buildEmptyRoundMetrics(1, 'supermercados')] }),
      checkpoint({ pending_organizations: [pending] }),
    );
    assert.equal(merged.kind, 'merged');
    if (merged.kind !== 'merged') return;
    assert.deepEqual(
      merged.checkpoint.pending_organizations,
      [],
      'evaluadas ⇒ ya no son pendientes; resucitarlas las reevaluaría',
    );
  });

  test('la fusión es idempotente: aplicarla dos veces no cambia el gasto', () => {
    const base = checkpoint({ recorded_operation_credits: [credit('op-a', 1)] });
    const incoming = checkpoint({ recorded_operation_credits: [credit('op-b', 1)] });
    const once = mergeApolloTwoRoundCheckpoints(base, incoming);
    assert.equal(once.kind, 'merged');
    if (once.kind !== 'merged') return;
    const twice = mergeApolloTwoRoundCheckpoints(once.checkpoint, incoming);
    assert.equal(twice.kind, 'merged');
    if (twice.kind !== 'merged') return;
    assert.equal(
      twice.checkpoint.spend_accounting.recorded_usage_credits,
      once.checkpoint.spend_accounting.recorded_usage_credits,
    );
    assert.equal(sumRecordedOperationCredits(twice.checkpoint.recorded_operation_credits), 2);
  });
});

// ─── § 4 · ambigüedad ⇒ no se fusiona ─────────────────────────────────────────

describe('CAS-CLOSE § 4 · dos corridas distintas NO se mezclan', () => {
  test('otro `wizard_run_id` se rechaza', () => {
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint(),
      checkpoint({ wizard_run_id: 'run-otra' }),
    );
    assert.equal(merged.kind, 'refused');
    if (merged.kind !== 'refused') return;
    assert.equal(merged.reason, 'wizard_run_id_mismatch');
  });

  test('un `wizard_run_id` ausente (documento legacy) NO bloquea la fusión', () => {
    const merged = mergeApolloTwoRoundCheckpoints(
      checkpoint({ wizard_run_id: null }),
      checkpoint(),
    );
    assert.equal(merged.kind, 'merged');
  });

  test('otra clave de idempotencia, otra huella u otra config se rechazan', () => {
    for (const [label, incoming] of [
      ['idempotency_key_mismatch', checkpoint({ idempotency_key: 'otra' })],
      ['request_fingerprint_mismatch', checkpoint({ request_fingerprint: 'otra' })],
      [
        'config_mismatch',
        checkpoint({ config: { ...defaultApolloTwoRoundConfig(), maxRounds: 1 } }),
      ],
    ] as const) {
      const merged = mergeApolloTwoRoundCheckpoints(checkpoint(), incoming);
      assert.equal(merged.kind, 'refused', label);
      if (merged.kind !== 'refused') continue;
      assert.equal(merged.reason, label);
    }
  });
});

// ─── § 1 · la prueba de contención ────────────────────────────────────────────

describe('CAS-CLOSE § 1 · `stale_rejected` sólo es durable si el ganador contiene la operación', () => {
  const attempted = checkpoint({
    checkpoint_version: 1,
    completed_operation_keys: ['op-enrich'],
    enrichment_snapshots: [
      {
        candidate_key: 'uno',
        round_number: 1,
        operation_id: 'op-enrich',
        operation_subject: 'domain:uno.com.co',
        status: 'executed',
        recorded_credits: 1,
        sector_evidence_state: 'sector_evidence_confirmed',
      },
    ],
    recorded_operation_credits: [credit('op-enrich', 1)],
  });

  const durable = checkpoint({
    ...attempted,
    checkpoint_version: 4,
    checkpoint_reason: 'enrichment_completed',
  });

  const probe = {
    operationId: 'op-enrich',
    operationKey: 'organization_enrichment' as const,
    roundNumber: 1,
    expectedStatus: 'completed' as const,
  };

  test('el caso que SÍ prueba durabilidad', () => {
    const verdict = verifyDurableCheckpointContainsOperation(durable, attempted, probe);
    assert.equal(verdict.durable, true);
    if (!verdict.durable) return;
    assert.equal(verdict.source, 'concurrent_checkpoint_already_contains_operation');
  });

  test('el ganador no menciona la operación', () => {
    const verdict = verifyDurableCheckpointContainsOperation(
      checkpoint({ ...durable, completed_operation_keys: [] }),
      attempted,
      probe,
    );
    assert.equal(verdict.durable, false);
    if (verdict.durable) return;
    assert.equal(verdict.gap, 'operation_absent');
  });

  test('el ganador la tiene con OTRO estado', () => {
    const verdict = verifyDurableCheckpointContainsOperation(
      checkpoint({
        ...durable,
        completed_operation_keys: [],
        indeterminate_operation_keys: ['op-enrich'],
      }),
      attempted,
      probe,
    );
    assert.equal(verdict.durable, false);
    if (verdict.durable) return;
    assert.equal(verdict.gap, 'operation_status_mismatch');
  });

  test('el ganador la declara completada sin su resultado recuperable', () => {
    const verdict = verifyDurableCheckpointContainsOperation(
      checkpoint({ ...durable, enrichment_snapshots: [] }),
      attempted,
      probe,
    );
    assert.equal(verdict.durable, false);
    if (verdict.durable) return;
    assert.equal(verdict.gap, 'recoverable_result_absent');
  });

  test('el resultado del ganador difiere del observado', () => {
    const verdict = verifyDurableCheckpointContainsOperation(
      checkpoint({
        ...durable,
        enrichment_snapshots: [
          { ...durable.enrichment_snapshots[0]!, status: 'no_match', recorded_credits: 0 },
        ],
      }),
      attempted,
      probe,
    );
    assert.equal(verdict.durable, false);
    if (verdict.durable) return;
    assert.equal(verdict.gap, 'recoverable_result_mismatch');
  });

  test('el ganador no ata la operación a su identidad económica', () => {
    const verdict = verifyDurableCheckpointContainsOperation(
      checkpoint({ ...durable, recorded_operation_credits: [] }),
      attempted,
      probe,
    );
    assert.equal(verdict.durable, false);
    if (verdict.durable) return;
    assert.equal(verdict.gap, 'usage_identity_absent');
  });

  test('la identidad económica del ganador declara otro gasto', () => {
    const verdict = verifyDurableCheckpointContainsOperation(
      checkpoint({ ...durable, recorded_operation_credits: [credit('op-enrich', 2)] }),
      attempted,
      probe,
    );
    assert.equal(verdict.durable, false);
    if (verdict.durable) return;
    assert.equal(verdict.gap, 'usage_identity_mismatch');
  });

  test('el ganador no es más nuevo: no hay nada que reconocer', () => {
    const verdict = verifyDurableCheckpointContainsOperation(
      checkpoint({ ...durable, checkpoint_version: 0 }),
      attempted,
      probe,
    );
    assert.equal(verdict.durable, false);
    if (verdict.durable) return;
    assert.equal(verdict.gap, 'checkpoint_version_not_superior');
  });

  test('una búsqueda cuya ronda el ganador conserva pendiente sí está contenida', () => {
    const searchAttempted = checkpoint({
      checkpoint_version: 1,
      completed_operation_keys: ['op-search'],
      pending_organizations: [],
      recorded_operation_credits: [
        {
          operation_id: 'op-search',
          operation_key: 'organizations_search',
          round_number: 1,
          usage_key: null,
          credits: 1,
          billing_unknown: false,
        },
      ],
    });
    const searchDurable = checkpoint({
      ...searchAttempted,
      checkpoint_version: 3,
      round_summaries: [buildEmptyRoundMetrics(1, 'supermercados')],
    });
    const verdict = verifyDurableCheckpointContainsOperation(searchDurable, searchAttempted, {
      operationId: 'op-search',
      operationKey: 'organizations_search',
      roundNumber: 1,
      expectedStatus: 'completed',
    });
    assert.equal(verdict.durable, true, 'el ganador va MÁS adelantado, no menos');
  });

  test('una búsqueda que el ganador dio por completada sin nada que recuperar se rechaza', () => {
    const searchAttempted = checkpoint({
      checkpoint_version: 1,
      completed_operation_keys: ['op-search'],
      recorded_operation_credits: [
        {
          operation_id: 'op-search',
          operation_key: 'organizations_search',
          round_number: 1,
          usage_key: null,
          credits: 1,
          billing_unknown: false,
        },
      ],
    });
    const verdict = verifyDurableCheckpointContainsOperation(
      checkpoint({ ...searchAttempted, checkpoint_version: 3 }),
      searchAttempted,
      {
        operationId: 'op-search',
        operationKey: 'organizations_search',
        roundNumber: 1,
        expectedStatus: 'completed',
      },
    );
    assert.equal(verdict.durable, false);
    if (verdict.durable) return;
    assert.equal(verdict.gap, 'recoverable_result_absent');
  });
});
