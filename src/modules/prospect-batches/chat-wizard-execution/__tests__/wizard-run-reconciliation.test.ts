/**
 * Tests — wizard-run-reconciliation.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The defect: reconciliation filtered on Tavily's operation only, so an Apollo
 * run always reconciled as "no rows" and confirmed its whole reservation. The
 * QA batch's real 4 credits never surfaced against its 3-credit reservation.
 *
 * Pure module: no network, no DB, no clock.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWizardRunCorrelation,
  toRunCorrelationMetadata,
  withResolvedIds,
  RUN_CORRELATION_METADATA_KEY,
} from '../wizard-run-correlation';
import {
  reconcileWizardRunSpend,
  resolveReconciledOperations,
  resolveUsageProviderKey,
  toWizardRunReconciliationMetadata,
  type ReconcilableUsageRow,
} from '../wizard-run-reconciliation';

const CORRELATION = withResolvedIds(
  buildWizardRunCorrelation({
    userId: 'user-1',
    clientRequestId: 'req-abc',
    reservationId: 'res-1',
    providerKey: 'apollo_organizations',
    requestSignature: 'CO|v1|ind|sub|4',
  }),
  { batchId: 'batch-1' },
);

function apolloRow(over: Partial<ReconcilableUsageRow> = {}): ReconcilableUsageRow {
  return {
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    credits_used: 3,
    usage_key: 'k-search',
    batch_id: 'batch-1',
    reservation_id: 'res-1',
    client_request_id: 'req-abc',
    ...over,
  };
}

function reconcile(rows: ReconcilableUsageRow[], over: Record<string, unknown> = {}) {
  return reconcileWizardRunSpend({
    correlation: CORRELATION,
    discoveryProvider: 'apollo_organizations',
    estimatedCredits: 4,
    reservedCredits: 4,
    rows,
    ...over,
  });
}

describe('A. Both Apollo operations are reconciled', () => {
  it('includes organizations_search AND organization_enrichment', () => {
    assert.deepEqual([...resolveReconciledOperations('apollo')], [
      'organizations_search',
      'organization_enrichment',
    ]);
    assert.deepEqual([...resolveReconciledOperations('tavily')], ['multi_query_web_search']);
  });

  it('maps the wizard provider key to the usage provider key', () => {
    assert.equal(resolveUsageProviderKey('apollo_organizations'), 'apollo');
    assert.equal(resolveUsageProviderKey('tavily'), 'tavily');
    assert.equal(resolveUsageProviderKey('unknown_provider'), null);
  });

  it('reproduces the QA batch: 3 search + 1 enrichment = 4 recorded', () => {
    const result = reconcile([
      apolloRow({ operation_key: 'organizations_search', credits_used: 3, usage_key: 'k1' }),
      apolloRow({ operation_key: 'organization_enrichment', credits_used: 1, usage_key: 'k2' }),
    ]);

    assert.equal(result.recordedUsageCredits, 4);
    assert.equal(result.matchedRowCount, 2);
    assert.deepEqual(result.perOperationCredits, {
      organizations_search: 3,
      organization_enrichment: 1,
    });
    assert.equal(result.billingState, 'recorded');
  });

  it('flags recorded spend above the reservation instead of clamping it', () => {
    // The exact defect: 4 charged against 3 reserved.
    const result = reconcile(
      [
        apolloRow({ credits_used: 3, usage_key: 'k1' }),
        apolloRow({ operation_key: 'organization_enrichment', credits_used: 1, usage_key: 'k2' }),
      ],
      { reservedCredits: 3, estimatedCredits: 3 },
    );

    assert.equal(result.recordedUsageCredits, 4);
    assert.equal(result.creditsToConfirm, 4, 'confirm the real spend, not the reservation');
    assert.ok(result.anomalies.includes('recorded_usage_exceeds_reservation'));
  });
});

describe('B. The three quantities stay separate', () => {
  it('confirmedProviderCredits stays null without external evidence', () => {
    const result = reconcile([apolloRow()]);

    assert.equal(result.estimatedCredits, 4);
    assert.equal(result.recordedUsageCredits, 3);
    assert.equal(result.confirmedProviderCredits, null, 'our logs are not an Apollo invoice');
    assert.notEqual(result.billingState, 'provider_confirmed');
  });

  it('never promotes recorded to provider_confirmed on its own', () => {
    const result = reconcile([apolloRow({ credits_used: 3 })]);
    assert.equal(result.billingState, 'recorded');
    assert.equal(result.confirmedProviderCredits, null);
  });

  it('accepts external confirmation and lets it outrank the recorded total', () => {
    const result = reconcile([apolloRow({ credits_used: 3 })], { providerConfirmedCredits: 5 });

    assert.equal(result.recordedUsageCredits, 3, 'internal record unchanged');
    assert.equal(result.confirmedProviderCredits, 5);
    assert.equal(result.creditsToConfirm, 5);
    assert.equal(result.billingState, 'provider_confirmed');
  });
});

describe('C. Conservative fallbacks', () => {
  it('zero rows confirms the full reservation and reports the anomaly', () => {
    // Zero rows is not proof of zero spend: logging can fail after a real call.
    const result = reconcile([]);

    assert.equal(result.recordedUsageCredits, null);
    assert.equal(result.creditsToConfirm, 4, 'confirm the reservation, never less');
    assert.equal(result.billingState, 'estimated');
    assert.ok(result.anomalies.includes('no_usage_rows_found'));
  });

  it('reconciles a run that produced zero candidates but did spend', () => {
    // Candidates and credits are unrelated quantities.
    const result = reconcile([apolloRow({ credits_used: 3 })]);
    assert.equal(result.recordedUsageCredits, 3);
    assert.equal(result.billingState, 'recorded');
  });

  it('unknown credits confirm the reservation and report billing as unknown', () => {
    const result = reconcile([
      apolloRow({ credits_used: 3, usage_key: 'k1' }),
      apolloRow({ credits_used: null, usage_key: 'k2' }),
    ]);

    assert.equal(result.recordedUsageCredits, null, 'a partial sum would understate spend');
    assert.equal(result.creditsToConfirm, 4);
    assert.equal(result.billingState, 'unknown');
    assert.ok(result.anomalies.includes('usage_credits_unknown'));
  });
});

describe('D. Idempotency', () => {
  it('reconciling the same rows twice yields the same verdict', () => {
    const rows = [
      apolloRow({ credits_used: 3, usage_key: 'k1' }),
      apolloRow({ operation_key: 'organization_enrichment', credits_used: 1, usage_key: 'k2' }),
    ];

    assert.deepEqual(reconcile(rows), reconcile(rows));
  });

  it('duplicate rows of the same logged call are counted once', () => {
    const row = apolloRow({ credits_used: 3, usage_key: 'same-key' });
    const result = reconcile([row, { ...row }, { ...row }]);

    assert.equal(result.recordedUsageCredits, 3, 'usage_key collapses duplicates');
    assert.equal(result.matchedRowCount, 1);
  });

  it('rows without a usage_key are not silently collapsed', () => {
    // They cannot be proven duplicates, so dropping them would understate spend.
    const result = reconcile([
      apolloRow({ credits_used: 1, usage_key: null }),
      apolloRow({ credits_used: 1, usage_key: null }),
    ]);
    assert.equal(result.recordedUsageCredits, 2);
  });

  it('the idempotency key identifies the reconciliation of this reservation', () => {
    assert.equal(reconcile([apolloRow()]).idempotencyKey, CORRELATION.idempotencyKey);
  });
});

describe('E. Concurrency and foreign rows', () => {
  it('excludes rows paid by a different reservation and flags them', () => {
    const result = reconcile([
      apolloRow({ credits_used: 3, usage_key: 'mine' }),
      apolloRow({ credits_used: 99, usage_key: 'theirs', reservation_id: 'res-OTHER', client_request_id: 'req-OTHER' }),
    ]);

    assert.equal(result.recordedUsageCredits, 3, 'the other run credits are not ours');
    assert.equal(result.foreignRowCount, 1);
    assert.ok(result.anomalies.includes('foreign_usage_rows_present'));
  });

  it('two simultaneous runs reconcile independently', () => {
    const other = withResolvedIds(
      buildWizardRunCorrelation({
        userId: 'user-1',
        clientRequestId: 'req-OTHER',
        reservationId: 'res-OTHER',
        providerKey: 'apollo_organizations',
        requestSignature: 'CO|v1|ind|sub|4',
      }),
      { batchId: 'batch-1' },
    );

    const rows = [
      apolloRow({ credits_used: 3, usage_key: 'mine' }),
      apolloRow({ credits_used: 7, usage_key: 'theirs', reservation_id: 'res-OTHER', client_request_id: 'req-OTHER' }),
    ];

    const mine = reconcile(rows);
    const theirs = reconcileWizardRunSpend({
      correlation: other,
      discoveryProvider: 'apollo_organizations',
      estimatedCredits: 4,
      reservedCredits: 4,
      rows,
    });

    assert.equal(mine.recordedUsageCredits, 3);
    assert.equal(theirs.recordedUsageCredits, 7);
  });

  it('ignores rows of another provider entirely', () => {
    const result = reconcile([
      apolloRow({ credits_used: 3, usage_key: 'k1' }),
      { provider_key: 'tavily', operation_key: 'multi_query_web_search', credits_used: 20, batch_id: 'batch-1', usage_key: 'tv' },
    ]);

    assert.equal(result.recordedUsageCredits, 3);
    assert.equal(result.matchedRowCount, 1);
  });

  it('flags an Apollo operation outside the reconciled set without counting it', () => {
    const result = reconcile([
      apolloRow({ credits_used: 3, usage_key: 'k1' }),
      apolloRow({ operation_key: 'people_search', credits_used: 50, usage_key: 'k2' }),
    ]);

    assert.equal(result.recordedUsageCredits, 3);
    assert.equal(result.ignoredOperationRowCount, 1);
    assert.ok(result.anomalies.includes('unexpected_operation_for_provider'));
  });
});

describe('F. Works without the migration-100 columns', () => {
  it('correlates through metadata when the columns are absent', () => {
    // The shipping state: migration unapplied, columns flag OFF.
    const metadata = { [RUN_CORRELATION_METADATA_KEY]: toRunCorrelationMetadata(CORRELATION) };
    const result = reconcile([
      {
        provider_key: 'apollo',
        operation_key: 'organizations_search',
        credits_used: 3,
        usage_key: 'k1',
        batch_id: 'batch-1',
        metadata,
      },
      {
        provider_key: 'apollo',
        operation_key: 'organization_enrichment',
        credits_used: 1,
        usage_key: 'k2',
        batch_id: 'batch-1',
        metadata,
      },
    ]);

    assert.equal(result.recordedUsageCredits, 4);
    assert.equal(result.matchedRowCount, 2);
  });

  it('reconciles rows written before the correlation existed, via batch_id', () => {
    const result = reconcile([
      { provider_key: 'apollo', operation_key: 'organizations_search', credits_used: 3, usage_key: 'legacy', batch_id: 'batch-1' },
    ]);
    assert.equal(result.recordedUsageCredits, 3);
  });

  it('agent_run_id null does not prevent reconciliation', () => {
    const result = reconcile([apolloRow({ credits_used: 3 })]);
    assert.equal(CORRELATION.agentRunId, null);
    assert.equal(result.recordedUsageCredits, 3);
  });
});

describe('G. Audit projection', () => {
  it('carries the three quantities and the anomalies, with no secrets', () => {
    const meta = toWizardRunReconciliationMetadata(
      reconcile(
        [
          apolloRow({ credits_used: 3, usage_key: 'k1' }),
          apolloRow({ operation_key: 'organization_enrichment', credits_used: 1, usage_key: 'k2' }),
        ],
        { reservedCredits: 3 },
      ),
    );

    assert.equal(meta.recorded_usage_credits, 4);
    assert.equal(meta.confirmed_provider_credits, null);
    assert.equal(meta.reserved_credits, 3);
    assert.ok(meta.anomalies.includes('recorded_usage_exceeds_reservation'));

    const serialized = JSON.stringify(meta).toLowerCase();
    for (const forbidden of ['api_key', 'authorization', 'bearer', 'token', 'secret', 'password']) {
      assert.ok(!serialized.includes(forbidden), `must not contain ${forbidden}`);
    }
  });
});
