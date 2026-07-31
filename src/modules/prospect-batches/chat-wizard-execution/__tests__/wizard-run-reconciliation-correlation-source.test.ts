/**
 * Tests — reconciliation reads the correlation columns, with metadata as fallback.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 · COND-3.
 *
 * The gap this closes: the writer projected the migration-100 columns but
 * `RECONCILIATION_SELECT_COLUMNS` never selected them, so they were write-only —
 * applying the migration alone would not have made reconciliation any more
 * accurate. Here the reader selects them, prefers them over metadata, reports
 * which source answered, and flags a disagreement between the two instead of
 * silently mixing fields from two different runs.
 *
 * Because migration 100 is deliberately NOT applied, the reader must also
 * survive selecting columns that do not exist yet: an undefined-column error
 * downgrades to the pre-migration column list, and nothing else does.
 *
 * Pure: rows in, verdict out. No DB, no clock, no provider, no credits.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWizardRunCorrelation,
  toRunCorrelationMetadata,
  withResolvedIds,
  readRowCorrelationKeys,
  PROVIDER_USAGE_CORRELATION_COLUMN_NAMES,
  RUN_CORRELATION_METADATA_KEY,
  type WizardRunCorrelation,
} from '../wizard-run-correlation';
import {
  reconcileWizardRunSpend,
  readWizardRunUsageRows,
  toWizardRunReconciliationMetadata,
  RECONCILIATION_BASE_SELECT_COLUMNS,
  RECONCILIATION_SELECT_COLUMNS,
  type ReconcilableUsageRow,
  type WizardRunUsageRowsClient,
} from '../wizard-run-reconciliation';

const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESERVATION_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RESERVATION_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeCorrelation(overrides: {
  clientRequestId?: string;
  reservationId?: string | null;
  agentRunId?: string | null;
} = {}): WizardRunCorrelation {
  return withResolvedIds(
    buildWizardRunCorrelation({
      userId: 'user-cond-3',
      clientRequestId: overrides.clientRequestId ?? 'client-request-A',
      reservationId: overrides.reservationId ?? RESERVATION_A,
      agentRunId: overrides.agentRunId ?? null,
      providerKey: 'apollo_organizations',
      requestSignature: 'CO|v1|retail|supermercados|3',
    }),
    { batchId: BATCH_ID },
  );
}

/** Row whose correlation lives in the migration-100 columns. */
function columnRow(
  correlation: WizardRunCorrelation,
  overrides: Partial<ReconcilableUsageRow> = {},
): ReconcilableUsageRow {
  return {
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    credits_used: 3,
    usage_key: 'apollo_organizations:batch:search',
    status: 'success',
    batch_id: correlation.batchId,
    reservation_id: correlation.reservationId,
    client_request_id: correlation.clientRequestId,
    wizard_run_id: correlation.wizardRunId,
    request_fingerprint: correlation.requestFingerprint,
    idempotency_key: correlation.idempotencyKey,
    billing_state: 'recorded',
    metadata: {},
    ...overrides,
  };
}

/** Row whose correlation lives only in metadata — a pre-migration writer. */
function metadataRow(
  correlation: WizardRunCorrelation,
  overrides: Partial<ReconcilableUsageRow> = {},
): ReconcilableUsageRow {
  return {
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    credits_used: 3,
    usage_key: 'apollo_organizations:batch:search',
    status: 'success',
    batch_id: correlation.batchId,
    metadata: {
      [RUN_CORRELATION_METADATA_KEY]: toRunCorrelationMetadata(correlation, 'recorded'),
    },
    ...overrides,
  };
}

function reconcile(
  correlation: WizardRunCorrelation,
  rows: readonly ReconcilableUsageRow[],
  overrides: { estimatedCredits?: number; reservedCredits?: number } = {},
) {
  return reconcileWizardRunSpend({
    correlation,
    discoveryProvider: 'apollo_organizations',
    estimatedCredits: overrides.estimatedCredits ?? 3,
    reservedCredits: overrides.reservedCredits ?? 3,
    rows,
  });
}

// ─── The select contract ──────────────────────────────────────────────────────

describe('COND-3 · RECONCILIATION_SELECT_COLUMNS', () => {
  it('selects every migration-100 column', () => {
    const selected = RECONCILIATION_SELECT_COLUMNS.split(',').map((c) => c.trim());
    for (const column of PROVIDER_USAGE_CORRELATION_COLUMN_NAMES) {
      assert.ok(selected.includes(column), `${column} must be selected, not write-only`);
    }
  });

  it('keeps selecting metadata and the pre-existing columns', () => {
    const selected = RECONCILIATION_SELECT_COLUMNS.split(',').map((c) => c.trim());
    for (const column of ['provider_key', 'operation_key', 'credits_used', 'usage_key', 'status', 'batch_id', 'metadata']) {
      assert.ok(selected.includes(column), `${column} must stay selected`);
    }
  });

  it('never selects a timestamp — timestamps are not a correlation key', () => {
    for (const columns of [RECONCILIATION_SELECT_COLUMNS, RECONCILIATION_BASE_SELECT_COLUMNS]) {
      assert.ok(!columns.includes('created_at'));
      assert.ok(!columns.includes('logged_at'));
      assert.ok(!columns.includes('timestamp'));
    }
  });

  it('base list has no migration-100 column, so it is safe pre-migration', () => {
    for (const column of PROVIDER_USAGE_CORRELATION_COLUMN_NAMES) {
      assert.ok(
        !RECONCILIATION_BASE_SELECT_COLUMNS.split(',').map((c) => c.trim()).includes(column),
        `${column} must be absent from the pre-migration list`,
      );
    }
  });
});

// ─── The reader's schema fallback ─────────────────────────────────────────────

type QueryLog = { columns: string; filters: string[] };

function makeRowsClient(
  responses: { data?: ReconcilableUsageRow[] | null; error?: { message: string; code?: string } | null }[],
) {
  const queries: QueryLog[] = [];
  const client: WizardRunUsageRowsClient = {
    from() {
      return {
        select(columns: string) {
          const log: QueryLog = { columns, filters: [] };
          queries.push(log);
          const response = responses[queries.length - 1] ?? { data: [] };
          const query = {
            eq(col: string, val: string) { log.filters.push(`eq:${col}=${val}`); return query; },
            in(col: string, vals: readonly string[]) { log.filters.push(`in:${col}=${vals.join('|')}`); return query; },
            then<R>(resolve: (v: { data: ReconcilableUsageRow[] | null; error: { message: string; code?: string } | null }) => R) {
              return Promise.resolve(resolve({
                data: response.data ?? null,
                error: response.error ?? null,
              }));
            },
          };
          return query as unknown as ReturnType<WizardRunUsageRowsClient['from']>['select'] extends (c: string) => infer Q ? Q : never;
        },
      };
    },
  };
  return { client, queries };
}

describe('COND-3 · readWizardRunUsageRows survives an unapplied migration 100', () => {
  it('reads with the correlation columns first', async () => {
    const correlation = makeCorrelation();
    const { client, queries } = makeRowsClient([{ data: [columnRow(correlation)] }]);

    const rows = await readWizardRunUsageRows(BATCH_ID, 'apollo_organizations', client);

    assert.equal(rows?.length, 1);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].columns, RECONCILIATION_SELECT_COLUMNS);
    assert.ok(queries[0].filters.includes(`eq:batch_id=${BATCH_ID}`));
    assert.ok(queries[0].filters.includes('eq:provider_key=apollo'));
  });

  it('retries with the base columns when a correlation column does not exist', async () => {
    const correlation = makeCorrelation();
    const { client, queries } = makeRowsClient([
      { error: { code: '42703', message: 'column provider_usage_logs.reservation_id does not exist' } },
      { data: [metadataRow(correlation)] },
    ]);

    const rows = await readWizardRunUsageRows(BATCH_ID, 'apollo_organizations', client);

    assert.equal(rows?.length, 1, 'the pre-migration read must still return the rows');
    assert.equal(queries.length, 2);
    assert.equal(queries[1].columns, RECONCILIATION_BASE_SELECT_COLUMNS);
    // Same predicate both times — the fallback narrows columns, never filters.
    assert.deepEqual(queries[0].filters, queries[1].filters);
  });

  it('returns null on any other read error, without a second read', async () => {
    for (const error of [
      { code: '42501', message: 'permission denied for table provider_usage_logs' },
      { code: '42703', message: 'column provider_usage_logs.some_other_column does not exist' },
      { message: 'fetch failed' },
    ]) {
      const { client, queries } = makeRowsClient([{ error }]);

      const rows = await readWizardRunUsageRows(BATCH_ID, 'apollo_organizations', client);

      assert.equal(rows, null, `${error.message} must not be absorbed`);
      assert.equal(queries.length, 1, `${error.message} must not be retried`);
    }
  });

  it('distinguishes "query failed" (null) from "no rows" (empty array)', async () => {
    const { client } = makeRowsClient([{ data: [] }]);
    const rows = await readWizardRunUsageRows(BATCH_ID, 'apollo_organizations', client);
    assert.deepEqual(rows, [], 'an empty result is a fact, not a failure');
  });
});

// ─── The nine required precedence scenarios ──────────────────────────────────

describe('COND-3 · columns/metadata precedence', () => {
  // 1
  it('1. complete columns → correlationSource = columns', () => {
    const correlation = makeCorrelation();
    const keys = readRowCorrelationKeys(columnRow(correlation));

    assert.equal(keys.correlationSource, 'columns');
    assert.equal(keys.columnMetadataMismatch, false);
    assert.equal(keys.reservationId, RESERVATION_A);
    assert.equal(keys.clientRequestId, 'client-request-A');
    assert.equal(keys.wizardRunId, correlation.wizardRunId);

    const result = reconcile(correlation, [columnRow(correlation)]);
    assert.deepEqual(result.correlationSources, { columns: 1, metadata: 0, none: 0 });
    assert.equal(result.recordedUsageCredits, 3);
    assert.equal(result.billingState, 'recorded');
    assert.deepEqual(result.anomalies, []);
  });

  // 2
  it('2. metadata only → correlationSource = metadata', () => {
    const correlation = makeCorrelation();
    const keys = readRowCorrelationKeys(metadataRow(correlation));

    assert.equal(keys.correlationSource, 'metadata');
    assert.equal(keys.columnMetadataMismatch, false);
    assert.equal(keys.reservationId, RESERVATION_A);

    const result = reconcile(correlation, [metadataRow(correlation)]);
    assert.deepEqual(result.correlationSources, { columns: 0, metadata: 1, none: 0 });
    assert.equal(result.recordedUsageCredits, 3);
    assert.deepEqual(result.anomalies, []);
  });

  // 3
  it('3. null columns with valid metadata → falls back to metadata', () => {
    const correlation = makeCorrelation();
    const row = metadataRow(correlation, {
      reservation_id: null,
      client_request_id: null,
      wizard_run_id: null,
      request_fingerprint: null,
      idempotency_key: null,
      billing_state: null,
    });

    const keys = readRowCorrelationKeys(row);
    assert.equal(keys.correlationSource, 'metadata', 'a NULL column is not an answer');
    assert.equal(keys.reservationId, RESERVATION_A);
    assert.equal(keys.wizardRunId, correlation.wizardRunId);

    const result = reconcile(correlation, [row]);
    assert.deepEqual(result.correlationSources, { columns: 0, metadata: 1, none: 0 });
    assert.equal(result.matchedRowCount, 1);
    assert.deepEqual(result.anomalies, []);
  });

  // 4
  it('4. columns and metadata contradict → columns win and the anomaly is reported', () => {
    const correlation = makeCorrelation();
    const otherRun = makeCorrelation({ clientRequestId: 'client-request-OTHER', reservationId: RESERVATION_B });

    // Columns say run A; metadata says run B. Same row.
    const row: ReconcilableUsageRow = {
      ...columnRow(correlation),
      metadata: {
        [RUN_CORRELATION_METADATA_KEY]: toRunCorrelationMetadata(otherRun, 'recorded'),
      },
    };

    const keys = readRowCorrelationKeys(row);
    assert.equal(keys.correlationSource, 'columns');
    assert.equal(keys.columnMetadataMismatch, true);
    // Columns have priority — and no field is taken from the other run.
    assert.equal(keys.reservationId, RESERVATION_A);
    assert.equal(keys.clientRequestId, 'client-request-A');
    assert.equal(keys.wizardRunId, correlation.wizardRunId);
    assert.notEqual(keys.wizardRunId, otherRun.wizardRunId);

    const result = reconcile(correlation, [row]);
    assert.ok(
      result.anomalies.includes('column_metadata_correlation_mismatch'),
      'the disagreement must be observable, not silently resolved',
    );
    assert.equal(result.matchedRowCount, 1);
    assert.deepEqual(result.correlationSources, { columns: 1, metadata: 0, none: 0 });
    // It is reported, not fatal: the credits were really spent on this run.
    assert.equal(result.recordedUsageCredits, 3);
  });

  it('4b. no mismatch is reported when columns and metadata agree', () => {
    const correlation = makeCorrelation();
    const row: ReconcilableUsageRow = {
      ...columnRow(correlation),
      metadata: {
        [RUN_CORRELATION_METADATA_KEY]: toRunCorrelationMetadata(correlation, 'recorded'),
      },
    };

    const keys = readRowCorrelationKeys(row);
    assert.equal(keys.columnMetadataMismatch, false);
    assert.deepEqual(reconcile(correlation, [row]).anomalies, []);
  });

  // 5
  it('5. two reservations in the same batch never claim each other rows', () => {
    const runA = makeCorrelation({ clientRequestId: 'client-request-A', reservationId: RESERVATION_A });
    const runB = makeCorrelation({ clientRequestId: 'client-request-B', reservationId: RESERVATION_B });

    const rows = [
      columnRow(runA, { credits_used: 3, usage_key: 'search:A' }),
      columnRow(runB, { credits_used: 5, usage_key: 'search:B' }),
    ];

    const resultA = reconcile(runA, rows);
    const resultB = reconcile(runB, rows, { reservedCredits: 5, estimatedCredits: 5 });

    assert.equal(resultA.matchedRowCount, 1);
    assert.equal(resultA.recordedUsageCredits, 3, 'run A must not absorb run B spend');
    assert.equal(resultA.foreignRowCount, 1);
    assert.ok(resultA.anomalies.includes('foreign_usage_rows_present'));

    assert.equal(resultB.matchedRowCount, 1);
    assert.equal(resultB.recordedUsageCredits, 5);
    assert.equal(resultB.foreignRowCount, 1);
  });

  // 6
  it('6. two simultaneous client requests stay separated', () => {
    // Same batch, same reservation absent, distinguished only by client request.
    const runA = makeCorrelation({ clientRequestId: 'press-1', reservationId: null });
    const runB = makeCorrelation({ clientRequestId: 'press-2', reservationId: null });

    const rows = [
      metadataRow(runA, { credits_used: 2, usage_key: 'search:press-1' }),
      metadataRow(runB, { credits_used: 4, usage_key: 'search:press-2' }),
    ];

    const resultA = reconcile(runA, rows, { reservedCredits: 2, estimatedCredits: 2 });
    const resultB = reconcile(runB, rows, { reservedCredits: 4, estimatedCredits: 4 });

    assert.equal(resultA.recordedUsageCredits, 2);
    assert.equal(resultB.recordedUsageCredits, 4);
    assert.equal(resultA.foreignRowCount, 1);
    assert.equal(resultB.foreignRowCount, 1);
    // Distinct runs produce distinct idempotency keys even without reservations.
    assert.notEqual(resultA.idempotencyKey, resultB.idempotencyKey);
  });

  // 7
  it('7. agent_run_id = null reconciles normally', () => {
    const correlation = makeCorrelation({ agentRunId: null });
    assert.equal(correlation.agentRunId, null);

    const metadata = toRunCorrelationMetadata(correlation, 'recorded');
    assert.equal(metadata.agent_run_id, null, 'absence is recorded as null, never invented');

    const result = reconcile(correlation, [
      columnRow(correlation),
      metadataRow(correlation, { operation_key: 'organization_enrichment', credits_used: 1, usage_key: 'enrich:1' }),
    ]);

    assert.equal(result.matchedRowCount, 2);
    assert.equal(result.recordedUsageCredits, 4);
    assert.deepEqual(result.perOperationCredits, {
      organizations_search: 3,
      organization_enrichment: 1,
    });
    // The QA defect itself: 4 charged against 3 reserved, surfaced not clamped.
    assert.ok(result.anomalies.includes('recorded_usage_exceeds_reservation'));
    assert.equal(result.creditsToConfirm, 4);
  });

  // 8
  it('8. zero candidates still reconciles — candidates and credits are unrelated', () => {
    const correlation = makeCorrelation();

    const withRows = reconcile(correlation, [columnRow(correlation, { credits_used: 3 })]);
    assert.equal(withRows.recordedUsageCredits, 3, 'spend exists even with zero candidates');

    const withoutRows = reconcile(correlation, []);
    assert.equal(withoutRows.matchedRowCount, 0);
    assert.equal(withoutRows.recordedUsageCredits, null, 'no rows is not proof of zero spend');
    assert.equal(withoutRows.billingState, 'estimated');
    assert.equal(withoutRows.creditsToConfirm, 3, 'conservative: confirm the reservation');
    assert.ok(withoutRows.anomalies.includes('no_usage_rows_found'));
    assert.deepEqual(withoutRows.correlationSources, { columns: 0, metadata: 0, none: 0 });
  });

  // 9
  it('9. reconciliation is idempotent', () => {
    const correlation = makeCorrelation();
    const rows = [
      columnRow(correlation, { usage_key: 'search:1', credits_used: 3 }),
      metadataRow(correlation, { operation_key: 'organization_enrichment', usage_key: 'enrich:1', credits_used: 1 }),
    ];

    const first = reconcile(correlation, rows);
    const second = reconcile(correlation, rows);
    assert.deepEqual(second, first, 'same input, same verdict');

    // The same rows handed over twice — a retry re-reading the table — must not
    // double the spend, because usage_key identifies the logged call.
    const doubled = reconcile(correlation, [...rows, ...rows]);
    assert.equal(doubled.recordedUsageCredits, 4);
    assert.equal(doubled.matchedRowCount, 2);
    assert.equal(doubled.idempotencyKey, first.idempotencyKey);

    // And the audit projection is stable too.
    assert.deepEqual(
      toWizardRunReconciliationMetadata(second),
      toWizardRunReconciliationMetadata(first),
    );
  });
});

// ─── Mixed-era batches and the audit projection ──────────────────────────────

describe('COND-3 · mixed sources and audit projection', () => {
  it('counts each matched row under the source that answered for it', () => {
    const correlation = makeCorrelation();
    const result = reconcile(correlation, [
      columnRow(correlation, { usage_key: 'search:1', credits_used: 2 }),
      metadataRow(correlation, {
        operation_key: 'organization_enrichment',
        usage_key: 'enrich:1',
        credits_used: 1,
      }),
    ]);

    assert.deepEqual(result.correlationSources, { columns: 1, metadata: 1, none: 0 });
    assert.equal(result.recordedUsageCredits, 3);
  });

  it('exposes correlation_sources in the persisted audit record', () => {
    const correlation = makeCorrelation();
    const metadata = toWizardRunReconciliationMetadata(
      reconcile(correlation, [columnRow(correlation)]),
    );

    assert.deepEqual(metadata.correlation_sources, { columns: 1, metadata: 0, none: 0 });
    assert.equal(metadata.billing_state, 'recorded');
    assert.equal(
      metadata.confirmed_provider_credits,
      null,
      'our own logs never confirm what the provider billed',
    );
  });

  it('a row with neither columns nor metadata still matches on batch_id', () => {
    const correlation = makeCorrelation();
    const bare: ReconcilableUsageRow = {
      provider_key: 'apollo',
      operation_key: 'organizations_search',
      credits_used: 3,
      usage_key: 'legacy:1',
      batch_id: BATCH_ID,
    };

    const keys = readRowCorrelationKeys(bare);
    assert.equal(keys.correlationSource, 'none');
    assert.equal(keys.batchId, BATCH_ID);

    const result = reconcile(correlation, [bare]);
    assert.equal(result.matchedRowCount, 1, 'a legacy row is reconciled, not dropped');
    assert.deepEqual(result.correlationSources, { columns: 0, metadata: 0, none: 1 });
  });
});
