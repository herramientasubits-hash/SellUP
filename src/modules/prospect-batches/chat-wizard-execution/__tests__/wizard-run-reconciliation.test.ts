/**
 * Tests — wizard-run-reconciliation.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The defect this module closes: `readWizardConsumedCreditsFromDb` filtered on
 * provider_key='tavily' AND operation_key='multi_query_web_search', so an Apollo
 * run always reconciled as "0 rows" and confirmed its whole reservation. The QA
 * batch's real 4 credits (3 organizations_search + 1 organization_enrichment)
 * never surfaced against its 3-credit reservation.
 *
 * A. Provider / operation mapping
 * B. The QA defect — 4 charged against 3 reserved
 * C. Conservative fallbacks (no rows, unknown credits)
 * D. Foreign rows from a concurrent run
 * E. provider_confirmed is never inferred from our own logs
 * F. Idempotency (duplicate rows)
 * G. Audit projection
 * H. readWizardRunUsageRows — query shape and error handling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileWizardRunSpend,
  resolveUsageProviderKey,
  resolveReconciledOperations,
  readWizardRunUsageRows,
  toWizardRunReconciliationMetadata,
  RECONCILIATION_SELECT_COLUMNS,
  WIZARD_RUN_RECONCILIATION_KEY,
  type ReconcilableUsageRow,
  type WizardRunUsageRowsClient,
} from '../wizard-run-reconciliation';
import { buildWizardRunCorrelation } from '../wizard-run-correlation';

const CORRELATION = buildWizardRunCorrelation({
  userId: 'user-1',
  clientRequestId: 'req-1',
  batchId: 'batch-1',
  reservationId: 'resv-1',
  providerKey: 'apollo_organizations',
  requestSignature: 'CO|3',
});

function apolloRow(overrides: Partial<ReconcilableUsageRow> = {}): ReconcilableUsageRow {
  return {
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    credits_used: 1,
    batch_id: 'batch-1',
    reservation_id: 'resv-1',
    client_request_id: 'req-1',
    ...overrides,
  };
}

function reconcile(
  rows: ReconcilableUsageRow[],
  overrides: {
    estimatedCredits?: number;
    reservedCredits?: number;
    discoveryProvider?: string;
    providerConfirmedCredits?: number | null;
  } = {},
) {
  return reconcileWizardRunSpend({
    correlation: CORRELATION,
    discoveryProvider: overrides.discoveryProvider ?? 'apollo_organizations',
    estimatedCredits: overrides.estimatedCredits ?? 3,
    reservedCredits: overrides.reservedCredits ?? 3,
    rows,
    providerConfirmedCredits: overrides.providerConfirmedCredits,
  });
}

// ── A. Provider / operation mapping ───────────────────────────────────────────

describe('A — provider and operation mapping', () => {
  it('A1: the wizard provider key maps to the usage provider key', () => {
    // The wizard calls the provider `apollo_organizations`; usage rows are
    // written under the account key `apollo`. Conflating them is the bug.
    assert.equal(resolveUsageProviderKey('apollo_organizations'), 'apollo');
    assert.equal(resolveUsageProviderKey('tavily'), 'tavily');
  });

  it('A2: an unknown provider maps to null instead of guessing', () => {
    assert.equal(resolveUsageProviderKey('lusha'), null);
    assert.equal(resolveUsageProviderKey(''), null);
  });

  it('A3: BOTH Apollo billable operations are reconciled', () => {
    const operations = resolveReconciledOperations('apollo');
    assert.deepEqual([...operations].sort(), [
      'organization_enrichment',
      'organizations_search',
    ]);
  });

  it('A4: Tavily keeps its single operation', () => {
    assert.deepEqual([...resolveReconciledOperations('tavily')], ['multi_query_web_search']);
  });

  it('A5: an unknown usage provider reconciles no operation', () => {
    assert.deepEqual([...resolveReconciledOperations('nope')], []);
  });
});

// ── B. The QA defect ──────────────────────────────────────────────────────────

describe('B — 4 credits charged against a 3-credit reservation', () => {
  const QA_ROWS = [
    apolloRow({ operation_key: 'organizations_search', credits_used: 3, usage_key: 'u1' }),
    apolloRow({ operation_key: 'organization_enrichment', credits_used: 1, usage_key: 'u2' }),
  ];

  it('B1: both operations are counted — the total is 4, not 3', () => {
    const result = reconcile(QA_ROWS);
    assert.equal(result.recordedUsageCredits, 4);
    assert.equal(result.matchedRowCount, 2);
  });

  it('B2: the overrun is surfaced, not clamped to the reservation', () => {
    const result = reconcile(QA_ROWS);
    assert.equal(result.creditsToConfirm, 4);
    assert.ok(result.anomalies.includes('recorded_usage_exceeds_reservation'));
  });

  it('B3: the per-operation split is reported', () => {
    assert.deepEqual(reconcile(QA_ROWS).perOperationCredits, {
      organizations_search: 3,
      organization_enrichment: 1,
    });
  });

  it('B4: billing state is `recorded` — our logs, not an Apollo invoice', () => {
    const result = reconcile(QA_ROWS);
    assert.equal(result.billingState, 'recorded');
    assert.equal(result.confirmedProviderCredits, null);
  });

  it('B5: spend within the reservation confirms the real amount with no anomaly', () => {
    const result = reconcile([apolloRow({ credits_used: 2, usage_key: 'u1' })]);
    assert.equal(result.recordedUsageCredits, 2);
    assert.equal(result.creditsToConfirm, 2);
    assert.deepEqual(result.anomalies, []);
  });

  it('B6: the pre-fix Tavily-only filter would have found nothing here', () => {
    // Same rows, reconciled as if the provider were Tavily: zero matches.
    const result = reconcile(QA_ROWS, { discoveryProvider: 'tavily' });
    assert.equal(result.matchedRowCount, 0);
    assert.ok(result.anomalies.includes('no_usage_rows_found'));
  });
});

// ── C. Conservative fallbacks ─────────────────────────────────────────────────

describe('C — unverifiable spend confirms the full reservation', () => {
  it('C1: no rows ⇒ estimated, confirm the reservation, flag the absence', () => {
    const result = reconcile([]);
    assert.equal(result.recordedUsageCredits, null);
    assert.equal(result.billingState, 'estimated');
    assert.equal(result.creditsToConfirm, 3);
    assert.ok(result.anomalies.includes('no_usage_rows_found'));
  });

  it('C2: zero rows is not proof of zero spend', () => {
    // Usage logging can fail after a real Apollo call, so confirming 0 would
    // silently return budget that was already spent.
    assert.notEqual(reconcile([]).creditsToConfirm, 0);
  });

  it('C3: a null credits_used makes the total unknown, not zero', () => {
    const result = reconcile([
      apolloRow({ credits_used: 1, usage_key: 'u1' }),
      apolloRow({ credits_used: null, usage_key: 'u2' }),
    ]);
    assert.equal(result.recordedUsageCredits, null);
    assert.equal(result.billingState, 'unknown');
    assert.equal(result.creditsToConfirm, 3);
    assert.ok(result.anomalies.includes('usage_credits_unknown'));
  });

  it('C4: an undefined or non-finite credits_used is treated the same way', () => {
    for (const credits of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = reconcile([apolloRow({ credits_used: credits, usage_key: 'u1' })]);
      assert.equal(result.billingState, 'unknown', `credits=${String(credits)}`);
      assert.equal(result.creditsToConfirm, 3);
    }
  });

  it('C5: rows of a different provider are ignored, not counted', () => {
    const result = reconcile([
      { provider_key: 'tavily', operation_key: 'multi_query_web_search', credits_used: 9, batch_id: 'batch-1' },
    ]);
    assert.equal(result.matchedRowCount, 0);
    assert.equal(result.creditsToConfirm, 3);
  });

  it('C6: an unreconciled operation of the same provider is flagged, not billed', () => {
    const result = reconcile([
      apolloRow({ operation_key: 'people_search', credits_used: 50, usage_key: 'u1' }),
    ]);
    assert.equal(result.ignoredOperationRowCount, 1);
    assert.equal(result.matchedRowCount, 0);
    assert.ok(result.anomalies.includes('unexpected_operation_for_provider'));
    assert.equal(result.creditsToConfirm, 3);
  });

  it('C7: an unknown discovery provider still reconciles conservatively', () => {
    const result = reconcile([apolloRow()], { discoveryProvider: 'lusha' });
    assert.equal(result.usageProviderKey, null);
    assert.equal(result.matchedRowCount, 0);
    assert.equal(result.creditsToConfirm, 3);
  });
});

// ── D. Foreign rows ───────────────────────────────────────────────────────────

describe('D — a concurrent run cannot spend against our reservation', () => {
  it('D1: same batch, other reservation ⇒ counted as foreign, never billed', () => {
    const result = reconcile([
      apolloRow({ credits_used: 1, usage_key: 'ours' }),
      apolloRow({ reservation_id: 'resv-OTHER', client_request_id: 'req-OTHER', credits_used: 40, usage_key: 'theirs' }),
    ]);
    assert.equal(result.matchedRowCount, 1);
    assert.equal(result.foreignRowCount, 1);
    assert.equal(result.recordedUsageCredits, 1);
    assert.ok(result.anomalies.includes('foreign_usage_rows_present'));
  });

  it('D2: a foreign row does not make the total unknown', () => {
    const result = reconcile([
      apolloRow({ credits_used: 2, usage_key: 'ours' }),
      apolloRow({ reservation_id: 'resv-OTHER', credits_used: null, usage_key: 'theirs' }),
    ]);
    assert.equal(result.recordedUsageCredits, 2);
    assert.equal(result.billingState, 'recorded');
  });

  it('D3: only-foreign rows reconcile as "no rows of ours"', () => {
    const result = reconcile([
      apolloRow({ reservation_id: 'resv-OTHER', credits_used: 5, usage_key: 'theirs' }),
    ]);
    assert.equal(result.matchedRowCount, 0);
    assert.equal(result.foreignRowCount, 1);
    assert.equal(result.creditsToConfirm, 3);
    assert.ok(result.anomalies.includes('no_usage_rows_found'));
  });

  it('D4: a legacy row with only batch_id is ours, not foreign', () => {
    const result = reconcile([
      {
        provider_key: 'apollo',
        operation_key: 'organizations_search',
        credits_used: 3,
        batch_id: 'batch-1',
        usage_key: 'legacy',
      },
    ]);
    assert.equal(result.matchedRowCount, 1);
    assert.equal(result.foreignRowCount, 0);
    assert.equal(result.recordedUsageCredits, 3);
  });
});

// ── E. provider_confirmed ─────────────────────────────────────────────────────

describe('E — external confirmation is never inferred', () => {
  it('E1: recorded is never promoted to provider_confirmed on its own', () => {
    const result = reconcile([apolloRow({ credits_used: 4, usage_key: 'u1' })]);
    assert.equal(result.billingState, 'recorded');
    assert.notEqual(result.billingState, 'provider_confirmed');
  });

  it('E2: an external statement outranks our own logs', () => {
    const result = reconcile([apolloRow({ credits_used: 4, usage_key: 'u1' })], {
      providerConfirmedCredits: 5,
    });
    assert.equal(result.billingState, 'provider_confirmed');
    assert.equal(result.confirmedProviderCredits, 5);
    assert.equal(result.creditsToConfirm, 5);
    // Our own number is still reported — it is evidence, not noise.
    assert.equal(result.recordedUsageCredits, 4);
  });

  it('E3: an external zero is a real fact and is honoured', () => {
    const result = reconcile([], { providerConfirmedCredits: 0 });
    assert.equal(result.billingState, 'provider_confirmed');
    assert.equal(result.creditsToConfirm, 0);
  });

  it('E4: null / undefined / non-finite confirmation is not a confirmation', () => {
    for (const value of [null, undefined, Number.NaN]) {
      const result = reconcile([apolloRow({ credits_used: 1, usage_key: 'u1' })], {
        providerConfirmedCredits: value as number | null,
      });
      assert.equal(result.billingState, 'recorded', `value=${String(value)}`);
      assert.equal(result.confirmedProviderCredits, null);
    }
  });
});

// ── F. Idempotency ────────────────────────────────────────────────────────────

describe('F — repeated reconciliation is idempotent', () => {
  it('F1: the same row handed in twice is counted once', () => {
    const row = apolloRow({ credits_used: 3, usage_key: 'same-call' });
    const result = reconcile([row, { ...row }]);
    assert.equal(result.matchedRowCount, 1);
    assert.equal(result.recordedUsageCredits, 3);
  });

  it('F2: rows without a usage_key cannot be proven duplicate and are all kept', () => {
    // Two genuine calls may legitimately have identical shape; dropping one
    // would under-count real spend.
    const result = reconcile([
      apolloRow({ credits_used: 1 }),
      apolloRow({ credits_used: 1 }),
    ]);
    assert.equal(result.matchedRowCount, 2);
    assert.equal(result.recordedUsageCredits, 2);
  });

  it('F3: an empty usage_key is treated as absent, not as a shared key', () => {
    const result = reconcile([
      apolloRow({ credits_used: 1, usage_key: '' }),
      apolloRow({ credits_used: 1, usage_key: '' }),
    ]);
    assert.equal(result.matchedRowCount, 2);
  });

  it('F4: the result carries the correlation idempotency key', () => {
    assert.equal(reconcile([]).idempotencyKey, CORRELATION.idempotencyKey);
  });

  it('F5: two runs over the same input produce identical results', () => {
    const rows = [apolloRow({ credits_used: 3, usage_key: 'u1' })];
    assert.deepEqual(reconcile(rows), reconcile(rows));
  });
});

// ── G. Audit projection ───────────────────────────────────────────────────────

describe('G — audit metadata', () => {
  it('G1: every field is projected to snake_case', () => {
    const result = reconcile([
      apolloRow({ operation_key: 'organizations_search', credits_used: 3, usage_key: 'u1' }),
      apolloRow({ operation_key: 'organization_enrichment', credits_used: 1, usage_key: 'u2' }),
    ]);
    assert.deepEqual(toWizardRunReconciliationMetadata(result), {
      idempotency_key: result.idempotencyKey,
      discovery_provider: 'apollo_organizations',
      usage_provider_key: 'apollo',
      estimated_credits: 3,
      reserved_credits: 3,
      recorded_usage_credits: 4,
      confirmed_provider_credits: null,
      credits_to_confirm: 4,
      billing_state: 'recorded',
      matched_row_count: 2,
      foreign_row_count: 0,
      ignored_operation_row_count: 0,
      per_operation_credits: { organizations_search: 3, organization_enrichment: 1 },
      anomalies: ['recorded_usage_exceeds_reservation'],
    });
  });

  it('G2: absent quantities are null, never 0', () => {
    const metadata = toWizardRunReconciliationMetadata(reconcile([]));
    assert.equal(metadata.recorded_usage_credits, null);
    assert.equal(metadata.confirmed_provider_credits, null);
  });

  it('G3: the metadata key is stable', () => {
    assert.equal(WIZARD_RUN_RECONCILIATION_KEY, 'wizard_run_reconciliation');
  });

  it('G4: the metadata carries no user id and no secret', () => {
    const serialized = JSON.stringify(toWizardRunReconciliationMetadata(reconcile([])));
    assert.ok(!serialized.includes('user-1'));
    assert.ok(!serialized.toLowerCase().includes('api_key'));
  });
});

// ── H. DB reader ──────────────────────────────────────────────────────────────

type RecordedCall = { method: string; args: unknown[] };

function makeClient(result: {
  data: ReconcilableUsageRow[] | null;
  error: { message: string } | null;
}) {
  const calls: RecordedCall[] = [];
  const query = {
    eq(col: string, val: string) {
      calls.push({ method: 'eq', args: [col, val] });
      return query;
    },
    in(col: string, vals: readonly string[]) {
      calls.push({ method: 'in', args: [col, [...vals]] });
      return query;
    },
    then<T>(onFulfilled: (value: typeof result) => T) {
      return Promise.resolve(result).then(onFulfilled);
    },
  };
  const db = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] });
      return {
        select(columns: string) {
          calls.push({ method: 'select', args: [columns] });
          return query;
        },
      };
    },
  };
  return { db: db as unknown as WizardRunUsageRowsClient, calls };
}

describe('H — readWizardRunUsageRows', () => {
  it('H1: filters by batch, provider and BOTH Apollo operations', () => {
    const { db, calls } = makeClient({ data: [], error: null });
    return readWizardRunUsageRows('batch-1', 'apollo_organizations', db).then(() => {
      assert.deepEqual(calls[0], { method: 'from', args: ['provider_usage_logs'] });
      assert.deepEqual(calls[1], { method: 'select', args: [RECONCILIATION_SELECT_COLUMNS] });
      assert.deepEqual(calls[2], { method: 'eq', args: ['batch_id', 'batch-1'] });
      assert.deepEqual(calls[3], { method: 'eq', args: ['provider_key', 'apollo'] });
      assert.deepEqual(calls[4], {
        method: 'in',
        args: ['operation_key', ['organizations_search', 'organization_enrichment']],
      });
    });
  });

  it('H2: the selected columns include every correlation key', () => {
    for (const column of [
      'batch_id',
      'reservation_id',
      'client_request_id',
      'wizard_run_id',
      'credits_used',
      'operation_key',
    ]) {
      assert.ok(RECONCILIATION_SELECT_COLUMNS.includes(column), column);
    }
  });

  it('H3: the query selects no timestamp column', () => {
    assert.ok(!RECONCILIATION_SELECT_COLUMNS.includes('created_at'));
  });

  it('H4: a DB error returns null — distinct from "no rows"', async () => {
    const { db } = makeClient({ data: null, error: { message: 'boom' } });
    assert.equal(await readWizardRunUsageRows('batch-1', 'apollo_organizations', db), null);
  });

  it('H5: a successful empty query returns an empty array', async () => {
    const { db } = makeClient({ data: [], error: null });
    assert.deepEqual(await readWizardRunUsageRows('batch-1', 'apollo_organizations', db), []);
  });

  it('H6: null data without an error is normalized to an empty array', async () => {
    const { db } = makeClient({ data: null, error: null });
    assert.deepEqual(await readWizardRunUsageRows('batch-1', 'apollo_organizations', db), []);
  });

  it('H7: an unmappable provider never touches the database', async () => {
    const { db, calls } = makeClient({ data: [], error: null });
    assert.equal(await readWizardRunUsageRows('batch-1', 'lusha', db), null);
    assert.deepEqual(calls, []);
  });

  it('H8: Tavily reads its own operation only', async () => {
    const { db, calls } = makeClient({ data: [], error: null });
    await readWizardRunUsageRows('batch-1', 'tavily', db);
    assert.deepEqual(calls[3], { method: 'eq', args: ['provider_key', 'tavily'] });
    assert.deepEqual(calls[4], {
      method: 'in',
      args: ['operation_key', ['multi_query_web_search']],
    });
  });
});
