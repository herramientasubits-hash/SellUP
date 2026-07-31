/**
 * Tests — provider_usage_logs correlation columns: write path and fallback.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 · COND-1 + COND-2.
 *
 * COND-1 — the columns-ON route was implemented but never exercised. These tests
 * cover it: with ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS on, both billable
 * Apollo operations must persist the full correlation as columns, under names
 * that match migration 100 exactly, while metadata.run_correlation stays intact.
 *
 * COND-2 — the flag can be on while migration 100 is not applied. The insert
 * then fails on an unknown column and the usage log is lost: the spend record
 * this milestone exists to reconcile, gone after the credits were charged. The
 * writer must strip the optional columns and persist anyway — and must NOT do
 * that for any other database error.
 *
 * No Apollo. No Supabase. No credits. No environment flag is mutated outside
 * these tests' own process.env, which is restored after each block.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildCorrelationColumns,
  buildProviderUsageLogRow,
  realLogApolloOrgsUsage,
  CORRELATION_COLUMNS_FALLBACK_SIGNAL,
  type ProviderUsageInsertClient,
  type ProviderUsageInsertError,
} from '../apollo-organizations-usage-logging';
import {
  buildWizardRunCorrelation,
  toRunCorrelationMetadata,
  withResolvedIds,
  PROVIDER_USAGE_CORRELATION_COLUMN_NAMES,
  RUN_CORRELATION_METADATA_KEY,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

const COLUMNS_FLAG = 'ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS';

const BATCH_ID = '11111111-1111-4111-8111-111111111111';
const RESERVATION_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_RUN_ID = '33333333-3333-4333-8333-333333333333';

// ─── Fake DB client ───────────────────────────────────────────────────────────

type InsertAttempt = { table: string; row: Record<string, unknown> };

/**
 * Records every insert attempt and replies with a scripted error per attempt.
 *
 * `errors[i]` is the error returned for the i-th attempt; `null`/absent means
 * success. This is how "the first insert fails on an unknown column, the second
 * succeeds" is expressed without a database.
 */
function makeClient(errors: (ProviderUsageInsertError | null)[] = []) {
  const attempts: InsertAttempt[] = [];
  const client: ProviderUsageInsertClient = {
    from(table) {
      return {
        async insert(row) {
          attempts.push({ table, row });
          return { error: errors[attempts.length - 1] ?? null };
        },
      };
    },
  };
  return { client, attempts };
}

function makeWarnSpy() {
  const calls: { signal: string; detail: Record<string, unknown> }[] = [];
  return {
    calls,
    warn: (signal: string, detail: Record<string, unknown>) => {
      calls.push({ signal, detail });
    },
  };
}

// ─── Run correlation fixtures ─────────────────────────────────────────────────

function makeCorrelation() {
  return withResolvedIds(
    buildWizardRunCorrelation({
      userId: 'user-cond-1',
      clientRequestId: 'client-request-cond-1',
      reservationId: RESERVATION_ID,
      providerKey: 'apollo_organizations',
      requestSignature: 'CO|v1|industry-1|sub-1|3',
    }),
    { batchId: BATCH_ID },
  );
}

/** Search usage log input, carrying the run correlation in metadata. */
function makeSearchInput(overrides: Partial<LogProviderUsageInput> = {}): LogProviderUsageInput {
  const correlation = makeCorrelation();
  return {
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    batch_id: BATCH_ID,
    agent_run_id: AGENT_RUN_ID,
    usage_key: `apollo_organizations:${BATCH_ID}:supermercados`,
    credits_used: 3,
    results_returned: 3,
    estimated_cost_usd: 0.03,
    metadata: {
      [RUN_CORRELATION_METADATA_KEY]: toRunCorrelationMetadata(correlation, 'recorded'),
    },
    ...overrides,
  };
}

/** Enrichment usage log input — same run, second billable operation. */
function makeEnrichmentInput(
  overrides: Partial<LogProviderUsageInput> = {},
): LogProviderUsageInput {
  return makeSearchInput({
    operation_key: 'organization_enrichment',
    usage_key: `apollo_organization_enrichment:${BATCH_ID}:org-1`,
    credits_used: 1,
    results_returned: 1,
    ...overrides,
  });
}

// ─── COND-1: columns ON ───────────────────────────────────────────────────────

describe('COND-1 · columns ON — both Apollo usage logs persist the correlation', () => {
  const previous = process.env[COLUMNS_FLAG];

  beforeEach(() => { process.env[COLUMNS_FLAG] = 'true'; });
  afterEach(() => {
    if (previous === undefined) delete process.env[COLUMNS_FLAG];
    else process.env[COLUMNS_FLAG] = previous;
  });

  it('search log persists all eight correlation fields as columns', async () => {
    const { client, attempts } = makeClient();
    const input = makeSearchInput();

    const result = await realLogApolloOrgsUsage(input, { client });

    assert.deepEqual(result, { kind: 'logged' });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].table, 'provider_usage_logs');

    const row = attempts[0].row;
    const correlation = makeCorrelation();

    // Native columns, already present before migration 100.
    assert.equal(row.batch_id, BATCH_ID);
    assert.equal(row.agent_run_id, AGENT_RUN_ID);
    // Columns added by migration 100.
    assert.equal(row.reservation_id, RESERVATION_ID);
    assert.equal(row.client_request_id, 'client-request-cond-1');
    assert.equal(row.wizard_run_id, correlation.wizardRunId);
    assert.equal(row.request_fingerprint, correlation.requestFingerprint);
    assert.equal(row.idempotency_key, correlation.idempotencyKey);
    assert.equal(row.billing_state, 'recorded');
  });

  it('enrichment log persists the same run context as the search log', async () => {
    const { client: searchClient, attempts: searchAttempts } = makeClient();
    const { client: enrichClient, attempts: enrichAttempts } = makeClient();

    await realLogApolloOrgsUsage(makeSearchInput(), { client: searchClient });
    await realLogApolloOrgsUsage(makeEnrichmentInput(), { client: enrichClient });

    const search = searchAttempts[0].row;
    const enrichment = enrichAttempts[0].row;

    // The whole point of the correlation: two operations, one reservation.
    for (const column of ['reservation_id', 'client_request_id', 'wizard_run_id', 'idempotency_key', 'batch_id'] as const) {
      assert.equal(
        enrichment[column],
        search[column],
        `${column} must be identical across search and enrichment`,
      );
    }
    // Different operations, and different credit counts, on the same run.
    assert.equal(search.operation_key, 'organizations_search');
    assert.equal(enrichment.operation_key, 'organization_enrichment');
    assert.equal(search.credits_used, 3);
    assert.equal(enrichment.credits_used, 1);
  });

  it('keeps metadata.run_correlation intact alongside the columns', async () => {
    const { client, attempts } = makeClient();

    await realLogApolloOrgsUsage(makeSearchInput(), { client });

    const metadata = attempts[0].row.metadata as Record<string, unknown>;
    const block = metadata[RUN_CORRELATION_METADATA_KEY] as Record<string, unknown>;
    assert.ok(block, 'metadata.run_correlation must survive the column projection');
    assert.equal(block.reservation_id, RESERVATION_ID);
    assert.equal(block.client_request_id, 'client-request-cond-1');
    assert.equal(block.billing_state, 'recorded');
  });

  it('column names match migration 100 exactly', () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/100_provider_usage_logs_spend_correlation.sql',
      ),
      'utf8',
    );

    const declared = [...migration.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map(
      (m) => m[1],
    );

    assert.deepEqual(
      declared,
      [...PROVIDER_USAGE_CORRELATION_COLUMN_NAMES],
      'the writer/reader column contract must match the migration, in order',
    );

    // And the projection writes exactly those names — no extra, none missing.
    const projected = Object.keys(
      buildCorrelationColumns(makeSearchInput().metadata),
    ).sort();
    assert.deepEqual(projected, [...PROVIDER_USAGE_CORRELATION_COLUMN_NAMES].sort());
  });

  it('does not duplicate batch_id as a correlation column', () => {
    const projected = Object.keys(buildCorrelationColumns(makeSearchInput().metadata));
    assert.ok(
      !projected.includes('batch_id'),
      'batch_id is a pre-existing column and must not be projected twice',
    );
  });

  it('accepts absent run context — Tavily, Lusha and Agent 2A shaped writers', async () => {
    // None of these writers sets metadata.run_correlation. With the flag ON they
    // must still insert exactly the row they inserted before this milestone.
    const inputs: LogProviderUsageInput[] = [
      { provider_key: 'tavily', operation_key: 'multi_query_web_search', results_returned: 5 },
      { provider_key: 'lusha', operation_key: 'company_search', credits_used: 1 },
      { provider_key: 'apollo', operation_key: 'people_match_phone_reveal', metadata: { source: 'agent_2a' } },
    ];

    for (const input of inputs) {
      const { client, attempts } = makeClient();
      const result = await realLogApolloOrgsUsage(input, { client });

      assert.deepEqual(result, { kind: 'logged' }, `${input.provider_key} must log`);
      assert.equal(attempts.length, 1);
      for (const column of PROVIDER_USAGE_CORRELATION_COLUMN_NAMES) {
        assert.ok(
          !(column in attempts[0].row),
          `${input.provider_key}: ${column} must be absent without a run correlation`,
        );
      }
    }
  });
});

// ─── COND-1b: columns OFF is still the default ────────────────────────────────

describe('COND-1 · columns OFF — default stays metadata-only', () => {
  const previous = process.env[COLUMNS_FLAG];

  beforeEach(() => { delete process.env[COLUMNS_FLAG]; });
  afterEach(() => {
    if (previous === undefined) delete process.env[COLUMNS_FLAG];
    else process.env[COLUMNS_FLAG] = previous;
  });

  it('writes no correlation column but keeps the full correlation in metadata', async () => {
    const { client, attempts } = makeClient();

    await realLogApolloOrgsUsage(makeSearchInput(), { client });

    const row = attempts[0].row;
    for (const column of PROVIDER_USAGE_CORRELATION_COLUMN_NAMES) {
      assert.ok(!(column in row), `${column} must not be written while the flag is off`);
    }
    const metadata = row.metadata as Record<string, unknown>;
    assert.ok(metadata[RUN_CORRELATION_METADATA_KEY], 'correlation still travels in metadata');
    // batch_id is native and must keep working regardless of the flag.
    assert.equal(row.batch_id, BATCH_ID);
  });
});

// ─── COND-2: fallback when the columns do not exist ───────────────────────────

describe('COND-2 · missing columns — the usage log is never lost', () => {
  const previous = process.env[COLUMNS_FLAG];

  beforeEach(() => { process.env[COLUMNS_FLAG] = 'true'; });
  afterEach(() => {
    if (previous === undefined) delete process.env[COLUMNS_FLAG];
    else process.env[COLUMNS_FLAG] = previous;
  });

  const postgrestMissingColumn: ProviderUsageInsertError = {
    code: 'PGRST204',
    message: "Could not find the 'reservation_id' column of 'provider_usage_logs' in the schema cache",
  };
  const postgresMissingColumn: ProviderUsageInsertError = {
    code: '42703',
    message: 'column "wizard_run_id" of relation "provider_usage_logs" does not exist',
  };

  for (const [label, error] of [
    ['PostgREST schema cache', postgrestMissingColumn],
    ['Postgres undefined_column', postgresMissingColumn],
  ] as const) {
    it(`${label}: retries without the optional columns and persists the row`, async () => {
      const { client, attempts } = makeClient([error]);
      const spy = makeWarnSpy();

      const result = await realLogApolloOrgsUsage(makeSearchInput(), {
        client,
        warn: spy.warn,
      });

      assert.deepEqual(result, { kind: 'logged', correlationColumnsFallback: true });

      // Exactly two attempts: the failed one wrote nothing, the retry wrote one row.
      assert.equal(attempts.length, 2, 'exactly one retry');
      const retried = attempts[1].row;
      for (const column of PROVIDER_USAGE_CORRELATION_COLUMN_NAMES) {
        assert.ok(!(column in retried), `${column} must be stripped from the retry`);
      }

      // The correlation survives — in metadata, which needs no migration.
      const metadata = retried.metadata as Record<string, unknown>;
      const block = metadata[RUN_CORRELATION_METADATA_KEY] as Record<string, unknown>;
      assert.equal(block.reservation_id, RESERVATION_ID);
      assert.equal(block.client_request_id, 'client-request-cond-1');
      assert.equal(block.wizard_run_id, makeCorrelation().wizardRunId);
      assert.equal(block.idempotency_key, makeCorrelation().idempotencyKey);

      // And the spend itself is intact: same credits, same batch, same operation.
      assert.equal(retried.credits_used, 3);
      assert.equal(retried.batch_id, BATCH_ID);
      assert.equal(retried.operation_key, 'organizations_search');
    });
  }

  it('emits one sanitized, observable fallback signal', async () => {
    const { client } = makeClient([postgrestMissingColumn]);
    const spy = makeWarnSpy();

    await realLogApolloOrgsUsage(makeSearchInput(), { client, warn: spy.warn });

    assert.equal(spy.calls.length, 1, 'exactly one signal');
    assert.equal(spy.calls[0].signal, CORRELATION_COLUMNS_FALLBACK_SIGNAL);

    const detail = spy.calls[0].detail;
    assert.equal(detail.provider_key, 'apollo');
    assert.equal(detail.operation_key, 'organizations_search');
    assert.equal(detail.error_code, 'PGRST204');
    assert.deepEqual(detail.stripped_columns, [...PROVIDER_USAGE_CORRELATION_COLUMN_NAMES]);
    assert.equal(detail.correlation_preserved_in, 'metadata.run_correlation');

    // Sanitized: schema-level facts only. No query text, no organization
    // payload, no credentials, no raw provider error body.
    const serialized = JSON.stringify(detail);
    for (const forbidden of ['api_key', 'apikey', 'Authorization', 'Bearer', 'supermercados']) {
      assert.ok(!serialized.includes(forbidden), `signal must not contain ${forbidden}`);
    }
  });

  it('covers the enrichment operation as well as search', async () => {
    const { client, attempts } = makeClient([postgresMissingColumn]);
    const spy = makeWarnSpy();

    const result = await realLogApolloOrgsUsage(makeEnrichmentInput(), {
      client,
      warn: spy.warn,
    });

    assert.deepEqual(result, { kind: 'logged', correlationColumnsFallback: true });
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].row.operation_key, 'organization_enrichment');
    assert.equal(attempts[1].row.credits_used, 1);
    assert.equal(spy.calls[0].detail.operation_key, 'organization_enrichment');
  });

  it('persists exactly one row and never duplicates credits', async () => {
    const { client, attempts } = makeClient([postgrestMissingColumn]);

    await realLogApolloOrgsUsage(makeSearchInput(), { client, warn: () => {} });

    // Two attempts, one persisted row: the first insert errored, so it wrote
    // nothing. Both attempts carry the same usage_key, so even a partially
    // applied first write would collapse into already_logged rather than a
    // second charge.
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].row.usage_key, attempts[1].row.usage_key);
    const totalCreditsWritten = attempts
      .slice(1)
      .reduce((sum, a) => sum + Number(a.row.credits_used ?? 0), 0);
    assert.equal(totalCreditsWritten, 3, 'the retry must not double the credits');
  });

  it('makes zero additional provider calls — it has no provider transport', async () => {
    const { client, attempts } = makeClient([postgrestMissingColumn]);

    await realLogApolloOrgsUsage(makeSearchInput(), { client, warn: () => {} });

    // Every effect of this module goes through the injected DB client, and both
    // attempts are inserts into provider_usage_logs. There is no code path from
    // here to Apollo, so the retry cannot re-spend a credit.
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((a) => a.table === 'provider_usage_logs'));
  });

  it('treats a duplicate usage_key as already_logged, without retrying', async () => {
    const { client, attempts } = makeClient([
      { code: '23505', message: 'duplicate key value violates unique constraint' },
    ]);
    const spy = makeWarnSpy();

    const result = await realLogApolloOrgsUsage(makeSearchInput(), {
      client,
      warn: spy.warn,
    });

    assert.deepEqual(result, { kind: 'already_logged' });
    assert.equal(attempts.length, 1, 'idempotency is not a schema problem');
    assert.equal(spy.calls.length, 0);
  });

  // ── Fail-loud: everything that is NOT a missing correlation column ─────────

  const nonSchemaErrors: [string, ProviderUsageInsertError][] = [
    ['permission denied', { code: '42501', message: 'permission denied for table provider_usage_logs' }],
    ['check constraint', { code: '23514', message: 'new row violates check constraint "provider_usage_logs_billing_state_check"' }],
    ['foreign key', { code: '23503', message: 'insert or update on table "provider_usage_logs" violates foreign key constraint' }],
    ['connection failure', { message: 'fetch failed' }],
    ['not-null violation', { code: '23502', message: 'null value in column "provider_key" violates not-null constraint' }],
    ['a different missing column', { code: '42703', message: 'column "totally_unrelated_column" of relation "provider_usage_logs" does not exist' }],
  ];

  for (const [label, error] of nonSchemaErrors) {
    it(`fails loudly on ${label} — no schema fallback, no retry`, async () => {
      const { client, attempts } = makeClient([error]);
      const spy = makeWarnSpy();

      const result = await realLogApolloOrgsUsage(makeSearchInput(), {
        client,
        warn: spy.warn,
      });

      assert.equal(result.kind, 'failed', `${label} must surface as a failure`);
      assert.equal(
        (result as { kind: 'failed'; error: string }).error,
        error.message,
        'the real error must not be masked',
      );
      assert.equal(attempts.length, 1, `${label} must not be retried`);
      assert.equal(spy.calls.length, 0, `${label} must not emit the fallback signal`);
    });
  }

  it('does not retry when there were no optional columns to strip', async () => {
    // A missing-column error with the flag effectively inert (no run
    // correlation): nothing to strip, so retrying would be pointless noise.
    const { client, attempts } = makeClient([postgrestMissingColumn]);
    const spy = makeWarnSpy();

    const result = await realLogApolloOrgsUsage(
      { provider_key: 'tavily', operation_key: 'multi_query_web_search' },
      { client, warn: spy.warn },
    );

    assert.equal(result.kind, 'failed');
    assert.equal(attempts.length, 1);
    assert.equal(spy.calls.length, 0);
  });

  it('a failing retry surfaces the retry error rather than claiming success', async () => {
    const { client, attempts } = makeClient([
      postgrestMissingColumn,
      { code: '42501', message: 'permission denied for table provider_usage_logs' },
    ]);

    const result = await realLogApolloOrgsUsage(makeSearchInput(), {
      client,
      warn: () => {},
    });

    assert.equal(result.kind, 'failed');
    assert.equal(
      (result as { kind: 'failed'; error: string }).error,
      'permission denied for table provider_usage_logs',
    );
    assert.equal(attempts.length, 2, 'still exactly one retry');
  });
});

// ─── Row builder invariants ───────────────────────────────────────────────────

describe('buildProviderUsageLogRow — always insertable', () => {
  it('never contains a migration-100 column', () => {
    const row = buildProviderUsageLogRow(makeSearchInput());
    for (const column of PROVIDER_USAGE_CORRELATION_COLUMN_NAMES) {
      assert.ok(!(column in row), `${column} must never be in the base row`);
    }
  });

  it('never writes real_cost_usd', () => {
    const row = buildProviderUsageLogRow(
      makeSearchInput({ real_cost_usd: 99 } as Partial<LogProviderUsageInput>),
    );
    assert.equal(row.real_cost_usd, null, 'real cost stays NULL until reconciliation');
  });

  it('truncates error_message to 500 characters', () => {
    const row = buildProviderUsageLogRow(
      makeSearchInput({ error_message: 'x'.repeat(900) }),
    );
    assert.equal((row.error_message as string).length, 500);
  });
});
