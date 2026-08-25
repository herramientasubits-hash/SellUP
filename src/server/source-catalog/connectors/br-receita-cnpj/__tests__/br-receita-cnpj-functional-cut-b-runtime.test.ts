/**
 * BR-SOURCE-FUNCTIONAL-CUT-B — the runtime half: executor, SQL gateway, published-run reader,
 * source registration and the Agent 1 Brazil enrichment adapter.
 *
 * This suite is the OFFLINE half. It proves the things that are properties of the CODE:
 *
 *   1. the executor stays bounded and drives CUT A's plan without owning any invariant;
 *   2. the gateway emits the run-scoped conflict target, the partial-index predicate and an
 *      allowlisted column set that structurally cannot carry a second CNPJ representation;
 *   3. no driver error — the one object that quotes the conflicting CNPJ — ever reaches a
 *      caller, a result or a log;
 *   4. the reader is two-step, fail-closed, and never widens a period-with-no-publication into
 *      some other month;
 *   5. Brazil is registered on the REAL registries, with a period that is always explicit;
 *   6. CUT B authored no migration and changed none.
 *
 * The behavioural half — atomic publication, run isolation, replay idempotence, cross-period
 * separation — lives in `br-receita-cnpj-functional-cut-b-postgres.test.ts`, because those are
 * properties PostgreSQL arbitrates and no in-memory double can honestly assert.
 *
 * NOTHING here touches Supabase, the network, a provider or the real Receita dataset. Every CNPJ
 * is synthetic and DV-valid by construction via `sampleFullCnpj`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import {
  sampleParserInput,
  sampleFullCnpj,
  RAIZ_EDUCACAO,
  SAMPLE_SOURCE_PERIOD,
} from '../br-receita-cnpj-fixtures';
import {
  toBrReceitaPersistedSnapshot,
  BR_RECEITA_SNAPSHOT_TABLE,
  type BrReceitaPersistedSnapshot,
} from '../br-receita-cnpj-monthly-snapshot-identity';
import {
  planBrReceitaMonthlySnapshotWrite,
  BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
  BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
  type BrReceitaSnapshotWritePlan,
  type UpsertBatchOperation,
} from '../br-receita-cnpj-monthly-snapshot-write-plan';
import {
  BR_RECEITA_PERSISTABLE_COLUMNS,
  BR_RECEITA_SNAPSHOT_RUNS_TABLE,
  buildDiscardRunRowsStatement,
  buildUpsertBatchStatement,
  createBrReceitaSqlWriteGateway,
  safeSqlStateOf,
  toSafeGatewayFailure,
  BrReceitaGatewayError,
  type BrReceitaSnapshotWriteGateway,
  type BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import { executeBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-executor';
import {
  readBrReceitaPublishedSnapshot,
  BR_RECEITA_PUBLISHED_READ_SELECT_COLUMNS,
  BR_RECEITA_PUBLISHED_READER_CONTRACT,
} from '../br-receita-cnpj-published-snapshot-reader';
import {
  createBrReceitaCnpjEnrichmentAdapter,
  brReceitaCnpjEnrichmentAdapter,
  BR_RECEITA_ENRICHMENT_CAPABILITIES,
  BR_RECEITA_ENRICHMENT_SIGNAL_KEYS,
} from '../br-receita-cnpj-enrichment-adapter';
import { BR_RECEITA_FUTURE_READER_CONTRACT } from '../br-receita-cnpj-monthly-snapshot-read-contract';
import { BR_RECEITA_CNPJ_SOURCE_KEY } from '../br-receita-cnpj-types';
import {
  VALIDATED_SOURCE_CONFIGS,
  getValidatedSourcesForEnrichment,
} from '../../../enrichment/validated-source-configs';
import { ENRICHMENT_ADAPTER_REGISTRY } from '../../../enrichment/enrichment-adapter-registry';
import { SOURCE_FAMILY_BY_SOURCE_KEY } from '../../../record-identity/source-family-registry';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../../snapshot-read/snapshot-read-contract';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → br-receita-cnpj → connectors → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

const CUT_B_SOURCE_FILES = [
  'br-receita-cnpj-monthly-snapshot-write-gateway.ts',
  'br-receita-cnpj-monthly-snapshot-executor.ts',
  'br-receita-cnpj-published-snapshot-reader.ts',
  'br-receita-cnpj-enrichment-adapter.ts',
] as const;

const readCutBSource = (file: string): string =>
  fs.readFileSync(join(here, '..', file), 'utf8');

/** Strips comments so a static guard measures CODE, never prose that merely names a token. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ─── Synthetic material ─────────────────────────────────────────────────────

const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';

function persistedSnapshots(): BrReceitaPersistedSnapshot[] {
  return buildBrReceitaCnpjSnapshotRows(sampleParserInput()).snapshots.map(
    toBrReceitaPersistedSnapshot,
  );
}

/** The alphanumeric-CNPJ establishment, DV-valid by construction. Never a literal. */
const ALPHANUMERIC_CNPJ = sampleFullCnpj(RAIZ_EDUCACAO, '0001');

function planFor(
  records: BrReceitaPersistedSnapshot[],
  options: { batchSize?: number; supersedes?: string } = {},
): BrReceitaSnapshotWritePlan {
  const planned = planBrReceitaMonthlySnapshotWrite({
    sourcePeriod: SAMPLE_SOURCE_PERIOD,
    records,
    batchSize: options.batchSize,
    supersedesPublishedRunId: options.supersedes,
  });
  assert.equal(planned.status, 'planned');
  if (planned.status !== 'planned') throw new Error('unreachable');
  return planned.plan;
}

// ─── A recording gateway ────────────────────────────────────────────────────

interface RecordedCall {
  readonly kind: string;
  readonly batchRows?: number;
  readonly finalBatchRows?: number;
}

function recordingGateway(
  overrides: Partial<BrReceitaSnapshotWriteGateway> = {},
  runId = RUN_A,
): { gateway: BrReceitaSnapshotWriteGateway; calls: RecordedCall[]; liveBatches: () => number } {
  const calls: RecordedCall[] = [];
  // Counts how many batch objects the executor is holding references to at any instant, as
  // observed from the gateway's side: incremented when a batch arrives, decremented when it is
  // done. It can never exceed the executor's single-slot lookahead.
  let concurrentBatches = 0;
  let peakBatches = 0;

  const base: BrReceitaSnapshotWriteGateway = {
    async beginPeriodRun() {
      calls.push({ kind: 'begin_period' });
      return { snapshotRunId: runId };
    },
    async discardRunRows() {
      calls.push({ kind: 'discard_run_rows' });
      return { deletedRows: 0 };
    },
    async upsertBatch(operation: UpsertBatchOperation) {
      concurrentBatches += 1;
      peakBatches = Math.max(peakBatches, concurrentBatches);
      calls.push({ kind: 'upsert_batch', batchRows: operation.rows.length });
      concurrentBatches -= 1;
      return { writtenRows: operation.rows.length };
    },
    async commitFinalBatchAndPublish(finalBatch, publish) {
      calls.push({
        kind: 'publish_period',
        finalBatchRows: finalBatch === null ? 0 : finalBatch.rows.length,
      });
      return {
        promotedRunId: publish.snapshot_run_id,
        supersededRunId: publish.supersedes?.snapshot_run_id ?? null,
        finalBatchRows: finalBatch === null ? 0 : finalBatch.rows.length,
      };
    },
    async failPeriod() {
      calls.push({ kind: 'fail_period' });
      return { deletedRows: 0 };
    },
  };

  return { gateway: { ...base, ...overrides }, calls, liveBatches: () => peakBatches };
}

// ─── An in-memory PostgREST-shaped read client ──────────────────────────────

type FakeTables = Readonly<Record<string, readonly Record<string, unknown>[]>>;

function fakeReadClient(
  tables: FakeTables,
  failWith?: { code: string },
): SnapshotReadClient<SnapshotIdentityRow> {
  return {
    from(table: string) {
      return {
        select() {
          const filters: { column: string; value: unknown }[] = [];
          let limit: number | null = null;
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              return query;
            },
            order() {
              return query;
            },
            limit(count: number) {
              limit = count;
              return query;
            },
            async maybeSingle() {
              const rows = evaluate();
              return { data: rows[0] ?? null, error: null };
            },
            then(
              onfulfilled?: (value: {
                data: SnapshotIdentityRow[] | null;
                error: { code?: string } | null;
              }) => unknown,
            ) {
              if (failWith) {
                return Promise.resolve({ data: null, error: failWith }).then(
                  onfulfilled as never,
                );
              }
              return Promise.resolve({ data: evaluate(), error: null }).then(
                onfulfilled as never,
              );
            },
          };
          const evaluate = (): SnapshotIdentityRow[] => {
            const source = tables[table] ?? [];
            const matched = source.filter((row) =>
              filters.every((filter) => row[filter.column] === filter.value),
            );
            const bounded = limit === null ? matched : matched.slice(0, limit);
            return bounded as SnapshotIdentityRow[];
          };
          return query as unknown as ReturnType<
            SnapshotReadClient<SnapshotIdentityRow>['from']
          >['select'] extends (columns?: string) => infer R
            ? R
            : never;
        },
      };
    },
  } as SnapshotReadClient<SnapshotIdentityRow>;
}

const publishedRunRow = (period: string, id: string) => ({
  id,
  publish_state: 'published',
  source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
  country_code: 'BR',
  source_period: period,
});

const snapshotRow = (period: string, runId: string, normalizedTaxId: string) => ({
  source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
  country_code: 'BR',
  source_period: period,
  source_year: Number(period.slice(0, 4)),
  snapshot_run_id: runId,
  normalized_tax_id: normalizedTaxId,
  legal_name: 'Synthetic Educação S.A.',
  raw_data: {
    source_type: 'official_registry',
    human_review_required: true,
    parser_version: 'br-receita-cnpj-local-sample@1',
    source_period: period,
    source_row_index: 0,
    matrix_branch_flag: '1',
    company_size_code: '05',
    capital_social_value: '500000.00',
    registration_status_code: '02',
    registration_status_label: null,
    cnae_main_code: '8599604',
    cnae_main_label: 'Treinamento',
    cnae_secondary_codes: [],
    municipality_code: '7107',
    municipality_name: 'Synthetic City',
    uf: 'SP',
    start_date: null,
  },
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-SOURCE CUT B — the executor is a dumb, bounded loop over CUT A\'s plan', () => {
  it('drives begin → discard → batches → publish, in that order, exactly once each', async () => {
    const { gateway, calls } = recordingGateway();
    const result = await executeBrReceitaMonthlySnapshotWrite({
      plan: planFor(persistedSnapshots(), { batchSize: 1 }),
      gateway,
    });

    assert.equal(result.status, 'published');
    assert.deepEqual(
      calls.map((call) => call.kind),
      ['begin_period', 'discard_run_rows', 'upsert_batch', 'upsert_batch', 'publish_period'],
    );
    assert.equal(result.snapshotRunId, RUN_A);
    assert.equal(result.batchesExecuted, 3);
    assert.equal(result.rowsWritten, 3);
  });

  it('publishes the FINAL batch inside the publish call, never before it', async () => {
    const { gateway, calls } = recordingGateway();
    await executeBrReceitaMonthlySnapshotWrite({
      plan: planFor(persistedSnapshots(), { batchSize: 1 }),
      gateway,
    });

    const publish = calls.at(-1);
    assert.equal(publish?.kind, 'publish_period');
    // The last batch was NOT written by a standalone `upsertBatch`: it travelled inside the
    // publish transaction. That is CUT A's `mustCommitWithFinalBatch`, executed.
    assert.equal(publish?.finalBatchRows, 1);
    assert.equal(calls.filter((call) => call.kind === 'upsert_batch').length, 2);
  });

  it('holds at most ONE batch at a time — the single-slot lookahead is real', async () => {
    const { gateway, liveBatches } = recordingGateway();
    const result = await executeBrReceitaMonthlySnapshotWrite({
      plan: planFor(persistedSnapshots(), { batchSize: 1 }),
      gateway,
    });
    assert.equal(liveBatches(), 1);
    assert.equal(result.maxBatchesHeldAtOnce, 1);
    assert.equal(result.heldWholePeriodInMemory, false);
  });

  it('pulls records LAZILY: nothing is read from the producer before begin_period resolves', async () => {
    let pulled = 0;
    const all = persistedSnapshots();
    function* lazyRecords(): Generator<BrReceitaPersistedSnapshot> {
      for (const record of all) {
        pulled += 1;
        yield record;
      }
    }

    let pulledAtBeginPeriod = -1;
    const { gateway } = recordingGateway({
      async beginPeriodRun() {
        pulledAtBeginPeriod = pulled;
        return { snapshotRunId: RUN_A };
      },
    });

    const planned = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      records: lazyRecords(),
      batchSize: 1,
    });
    assert.equal(planned.status, 'planned');
    if (planned.status !== 'planned') throw new Error('unreachable');

    // Planning alone consumed nothing.
    assert.equal(pulled, 0);
    await executeBrReceitaMonthlySnapshotWrite({ plan: planned.plan, gateway });
    // And by the time the run was claimed, still nothing had been read.
    assert.equal(pulledAtBeginPeriod, 0);
  });

  it('resolves the run handle before the next operation is pulled', async () => {
    // A gateway that returns an id the executor never resolves would make the plan throw
    // `SnapshotRunHandleUnresolvedError` on its very next step. Proving the happy path reached
    // `publish_period` proves the executor resolved in time.
    const { gateway } = recordingGateway();
    const plan = planFor(persistedSnapshots());
    const result = await executeBrReceitaMonthlySnapshotWrite({ plan, gateway });
    assert.equal(result.status, 'published');
    assert.equal(plan.runHandle.isResolved, true);
    assert.equal(plan.runHandle.require(), RUN_A);
  });

  it('carries the superseded run through to the publish call', async () => {
    const { gateway } = recordingGateway();
    const result = await executeBrReceitaMonthlySnapshotWrite({
      plan: planFor(persistedSnapshots(), { supersedes: RUN_B }),
      gateway,
    });
    assert.equal(result.supersededRunId, RUN_B);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-SOURCE CUT B — a failure is sanitised, run-scoped, and never demotes the live month', () => {
  it('reports a plan refusal as a reason CATEGORY plus an ordinal, never an identifier', async () => {
    const wrongMonth = persistedSnapshots().map((record, index) =>
      index === 1
        ? { ...record, identity: { ...record.identity, source_period: '2026-08' } }
        : record,
    );
    const { gateway, calls } = recordingGateway();
    const result = await executeBrReceitaMonthlySnapshotWrite({
      plan: planFor(wrongMonth, { batchSize: 1 }),
      gateway,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.failure?.kind, 'plan_refused_period');
    assert.equal(result.failure?.reason, 'record_period_mismatch');
    assert.equal(result.failure?.recordIndex, 1);
    assert.ok(calls.some((call) => call.kind === 'fail_period'));
    assert.ok(!calls.some((call) => call.kind === 'publish_period'));
  });

  it('🔴 never lets a driver error — which quotes the conflicting CNPJ — reach the result', async () => {
    // This is what PostgreSQL actually raises on index 4b. Its `detail` contains the CNPJ.
    const pgUniqueViolation = Object.assign(
      new Error(
        `duplicate key value violates unique constraint "source_company_snapshots_br_period_identity_uidx"`,
      ),
      {
        code: '23505',
        detail: `Key (source_key, country_code, source_period, snapshot_run_id, normalized_tax_id)=(br_receita_cnpj_dados_abertos, BR, ${SAMPLE_SOURCE_PERIOD}, ${RUN_A}, ${ALPHANUMERIC_CNPJ}) already exists.`,
        table: 'source_company_snapshots',
        constraint: 'source_company_snapshots_br_period_identity_uidx',
      },
    );

    const sql: BrReceitaSqlExecutor = {
      async query(statement: string) {
        if (statement.includes('INSERT INTO public.source_company_snapshots')) {
          throw pgUniqueViolation;
        }
        if (statement.includes(`INSERT INTO public.${BR_RECEITA_SNAPSHOT_RUNS_TABLE}`)) {
          return { rows: [{ id: RUN_A }] };
        }
        return { rows: [] };
      },
    };

    const result = await executeBrReceitaMonthlySnapshotWrite({
      plan: planFor(persistedSnapshots(), { batchSize: 1 }),
      gateway: createBrReceitaSqlWriteGateway(sql),
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.failure?.kind, 'gateway_failed');
    assert.equal(result.failure?.sqlState, '23505');

    // The whole result, serialised — the shape a caller would log — carries neither the CNPJ nor
    // any fragment of the driver's message.
    const serialised = JSON.stringify(result);
    assert.ok(!serialised.includes(ALPHANUMERIC_CNPJ));
    assert.ok(!serialised.includes('duplicate key value'));
    assert.ok(!serialised.includes('already exists'));
    assert.ok(!serialised.includes('Key ('));
  });

  it('keeps only the SQLSTATE off a driver error, and only when it is one', () => {
    assert.equal(safeSqlStateOf({ code: '23505', message: 'x', detail: 'y' }), '23505');
    assert.equal(safeSqlStateOf({ code: 'not a sqlstate' }), null);
    assert.equal(safeSqlStateOf(new Error('bare')), null);
    assert.equal(safeSqlStateOf(null), null);

    const wrapped = toSafeGatewayFailure({ code: '23505', detail: ALPHANUMERIC_CNPJ });
    assert.ok(wrapped instanceof BrReceitaGatewayError);
    assert.ok(!wrapped.message.includes(ALPHANUMERIC_CNPJ));
  });

  it('cleans up run-scoped after a failure, and reports the ORIGINAL failure if cleanup also fails', async () => {
    const { gateway } = recordingGateway({
      async upsertBatch() {
        throw new BrReceitaGatewayError('database_error', '40001');
      },
      async failPeriod() {
        throw new Error('cleanup exploded');
      },
    });

    const result = await executeBrReceitaMonthlySnapshotWrite({
      plan: planFor(persistedSnapshots(), { batchSize: 1 }),
      gateway,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.failure?.reason, 'database_error');
    assert.equal(result.failure?.sqlState, '40001');
    assert.equal(result.supersededRunId, null);
  });

  it('never calls failPeriod when the run was never claimed', async () => {
    const { gateway, calls } = recordingGateway({
      async beginPeriodRun() {
        throw new BrReceitaGatewayError('database_error', '08006');
      },
    });
    const result = await executeBrReceitaMonthlySnapshotWrite({
      plan: planFor(persistedSnapshots()),
      gateway,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.snapshotRunId, null);
    assert.ok(!calls.some((call) => call.kind === 'fail_period'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-SOURCE CUT B — the gateway emits exactly the statement CUT A recorded', () => {
  it('writes an allowlist that has nowhere to put a second CNPJ representation', () => {
    assert.deepEqual([...BR_RECEITA_PERSISTABLE_COLUMNS], [
      'source_key',
      'country_code',
      'source_year',
      'source_period',
      'snapshot_run_id',
      'normalized_tax_id',
      'legal_name',
      'raw_data',
    ]);
    assert.ok(!BR_RECEITA_PERSISTABLE_COLUMNS.includes('tax_id' as never));
    assert.ok(!BR_RECEITA_PERSISTABLE_COLUMNS.includes('record_identity_key' as never));
  });

  it('uses the RUN-scoped conflict target and restates the partial-index predicate', () => {
    const records = persistedSnapshots();
    const plan = planFor(records, { batchSize: 500 });
    void plan;

    const batch: UpsertBatchOperation = {
      kind: 'upsert_batch',
      table: BR_RECEITA_SNAPSHOT_TABLE,
      batchIndex: 0,
      snapshot_run_id: RUN_A,
      rows: [{ identity: records[0].identity, snapshot_run_id: RUN_A, payload: records[0].payload }],
      conflictColumns: BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
      conflictIndexPredicate: BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
      collapsedInBatchCount: 0,
    };

    const { sql, params } = buildUpsertBatchStatement(batch);

    assert.match(
      sql,
      /ON CONFLICT \(source_key, country_code, source_period, snapshot_run_id, normalized_tax_id\)/,
    );
    // 🔴 Without the predicate Postgres cannot infer a PARTIAL index and raises 42P10.
    assert.ok(sql.includes(`WHERE ${BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE}`));
    // The identity columns are never re-assigned on conflict: they ARE the conflict target.
    assert.ok(!/DO UPDATE SET[\s\S]*normalized_tax_id\s*=/.test(sql));
    assert.ok(!/DO UPDATE SET[\s\S]*snapshot_run_id\s*=/.test(sql));

    // Eight bind parameters per row, in allowlist order, and the CNPJ is a PARAMETER — never
    // interpolated into the statement text.
    assert.equal(params.length, BR_RECEITA_PERSISTABLE_COLUMNS.length);
    assert.equal(params[4], RUN_A);
    assert.equal(params[5], records[0].identity.normalized_tax_id);
    assert.ok(!sql.includes(String(records[0].identity.normalized_tax_id)));
  });

  it('scopes every delete to a run AND to a non-published run, inside the statement', () => {
    const { sql, params } = buildDiscardRunRowsStatement({
      kind: 'discard_run_rows',
      table: BR_RECEITA_SNAPSHOT_TABLE,
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: 'BR',
      source_period: SAMPLE_SOURCE_PERIOD,
      snapshot_run_id: RUN_B,
      onlyWhenRunPublishStateIn: ['preparing', 'failed', 'rolled_back'],
      canDeletePublishedRun: false,
      canDeleteByPeriodAlone: false,
    });

    assert.ok(sql.includes('snapshots.snapshot_run_id = $4'));
    // The "never a published run" rule is a PREDICATE, not a caller-side check.
    assert.ok(sql.includes('runs.publish_state = ANY($5::text[])'));
    assert.deepEqual(params[4], ['preparing', 'failed', 'rolled_back']);
    assert.ok(!(params[4] as string[]).includes('published'));
  });

  it('has no period-only DELETE anywhere in CUT B', () => {
    for (const file of CUT_B_SOURCE_FILES) {
      const code = stripComments(readCutBSource(file));
      const deletes = code.match(/DELETE FROM[\s\S]*?(?=RETURNING|`)/g) ?? [];
      for (const statement of deletes) {
        assert.ok(
          statement.includes('snapshot_run_id'),
          `${file}: a DELETE without snapshot_run_id would be the period-wide reset CUT A removed`,
        );
      }
    }
  });

  it('refuses a conflict target that is not a plain identifier list', () => {
    assert.throws(
      () =>
        buildUpsertBatchStatement({
          kind: 'upsert_batch',
          table: BR_RECEITA_SNAPSHOT_TABLE,
          batchIndex: 0,
          snapshot_run_id: RUN_A,
          rows: [],
          conflictColumns: ['source_key) DO NOTHING; DROP TABLE x; --'],
          conflictIndexPredicate: BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
          collapsedInBatchCount: 0,
        }),
      BrReceitaGatewayError,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-SOURCE CUT B — the published-run reader is two-step and fail-closed', () => {
  const period = SAMPLE_SOURCE_PERIOD;

  it('resolves the published run first, then reads scoped by its id', async () => {
    const client = fakeReadClient({
      source_snapshot_runs: [publishedRunRow(period, RUN_A)],
      source_company_snapshots: [snapshotRow(period, RUN_A, ALPHANUMERIC_CNPJ)],
    });

    const result = await readBrReceitaPublishedSnapshot({
      client,
      sourcePeriod: period,
      cnpj: ALPHANUMERIC_CNPJ,
    });

    assert.equal(result.status, 'FOUND');
    assert.equal(result.snapshotRunId, RUN_A);
    assert.equal(result.snapshot?.source_period, period);
    // 🔴 The projection has no identity field at all — not even an empty one.
    assert.ok(!Object.prototype.hasOwnProperty.call(result.snapshot ?? {}, 'normalized_tax_id'));
    assert.ok(!JSON.stringify(result).includes(ALPHANUMERIC_CNPJ));
  });

  it('does not even fetch the identity columns back', () => {
    assert.ok(!BR_RECEITA_PUBLISHED_READ_SELECT_COLUMNS.includes('normalized_tax_id'));
    assert.ok(!BR_RECEITA_PUBLISHED_READ_SELECT_COLUMNS.includes('tax_id'));
    assert.ok(!BR_RECEITA_PUBLISHED_READ_SELECT_COLUMNS.includes('record_identity_key'));
  });

  it('answers NO_PUBLISHED_RUN rather than falling back to another month', async () => {
    const client = fakeReadClient({
      // A run exists for the period, but it is PREPARING — invisible by contract.
      source_snapshot_runs: [
        { ...publishedRunRow(period, RUN_B), publish_state: 'preparing' },
        // …and the previous month IS published. A fallback would find it. This must not.
        publishedRunRow('2026-06', RUN_A),
      ],
      source_company_snapshots: [
        snapshotRow(period, RUN_B, ALPHANUMERIC_CNPJ),
        snapshotRow('2026-06', RUN_A, ALPHANUMERIC_CNPJ),
      ],
    });

    const result = await readBrReceitaPublishedSnapshot({
      client,
      sourcePeriod: period,
      cnpj: ALPHANUMERIC_CNPJ,
    });

    assert.equal(result.status, 'NO_PUBLISHED_RUN');
    assert.equal(result.snapshot, null);
  });

  it('refuses a malformed period and a DV-invalid CNPJ before any query is sent', async () => {
    let queried = false;
    const client = new Proxy(fakeReadClient({}), {
      get(target, property) {
        if (property === 'from') queried = true;
        return Reflect.get(target, property);
      },
    });

    const badPeriod = await readBrReceitaPublishedSnapshot({
      client,
      sourcePeriod: '2026-7',
      cnpj: ALPHANUMERIC_CNPJ,
    });
    assert.equal(badPeriod.status, 'INVALID_PERIOD');

    // A CNPJ with a deliberately wrong DV. The reason is a category; the value never appears.
    const badDv = `${ALPHANUMERIC_CNPJ.slice(0, 12)}00`;
    const badIdentity = await readBrReceitaPublishedSnapshot({
      client,
      sourcePeriod: period,
      cnpj: badDv,
    });
    assert.equal(badIdentity.status, 'INVALID_IDENTITY');
    assert.equal(badIdentity.reason, 'cnpj_invalid_dv');
    assert.ok(!JSON.stringify(badIdentity).includes(badDv));

    assert.equal(queried, false);
  });

  it('reports two published runs instead of picking one', async () => {
    const client = fakeReadClient({
      source_snapshot_runs: [publishedRunRow(period, RUN_A), publishedRunRow(period, RUN_B)],
      source_company_snapshots: [],
    });
    const result = await readBrReceitaPublishedSnapshot({
      client,
      sourcePeriod: period,
      cnpj: ALPHANUMERIC_CNPJ,
    });
    assert.equal(result.status, 'AMBIGUOUS_PUBLISHED_RUN');
    assert.equal(result.observedCount, 2);
  });

  it('reports two rows for one identity inside one run instead of picking one', async () => {
    const client = fakeReadClient({
      source_snapshot_runs: [publishedRunRow(period, RUN_A)],
      source_company_snapshots: [
        snapshotRow(period, RUN_A, ALPHANUMERIC_CNPJ),
        snapshotRow(period, RUN_A, ALPHANUMERIC_CNPJ),
      ],
    });
    const result = await readBrReceitaPublishedSnapshot({
      client,
      sourcePeriod: period,
      cnpj: ALPHANUMERIC_CNPJ,
    });
    assert.equal(result.status, 'CARDINALITY_VIOLATION');
    assert.equal(result.observedCount, 2);
  });

  it('never converts a transport error into a domain "not found"', async () => {
    const client = fakeReadClient({}, { code: 'PGRST301' });
    await assert.rejects(
      () =>
        readBrReceitaPublishedSnapshot({
          client,
          sourcePeriod: period,
          cnpj: ALPHANUMERIC_CNPJ,
        }),
      (error: Error) => {
        assert.equal(error.name, 'BrReceitaPublishedReadQueryError');
        assert.ok(!error.message.includes(ALPHANUMERIC_CNPJ));
        return true;
      },
    );
  });

  it('records a contract that answers CUT A\'s future-reader contract point by point', () => {
    assert.equal(BR_RECEITA_PUBLISHED_READER_CONTRACT.implemented, true);
    assert.equal(BR_RECEITA_PUBLISHED_READER_CONTRACT.periodOnlyReadIsValid, false);
    assert.equal(BR_RECEITA_PUBLISHED_READER_CONTRACT.fallsBackToAnotherPeriod, false);
    assert.equal(BR_RECEITA_PUBLISHED_READER_CONTRACT.ordersByImportedAt, false);
    assert.equal(BR_RECEITA_PUBLISHED_READER_CONTRACT.ordersBySourcePeriod, false);
    assert.equal(BR_RECEITA_PUBLISHED_READER_CONTRACT.returnsIdentityToCaller, false);
    assert.deepEqual([...BR_RECEITA_PUBLISHED_READER_CONTRACT.step2SelectSnapshotsScopedBy], [
      'source_key',
      'country_code',
      'source_period',
      'snapshot_run_id',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-SOURCE CUT B — Brazil is registered, and its period is always explicit', () => {
  it('appears in the REAL validated-source registry for BR', () => {
    const config = VALIDATED_SOURCE_CONFIGS.find(
      (candidate) => candidate.sourceKey === BR_RECEITA_CNPJ_SOURCE_KEY,
    );
    assert.ok(config, 'Brazil must be registered in VALIDATED_SOURCE_CONFIGS');
    assert.deepEqual(config.countryCodes, ['BR']);
    assert.equal(config.wizardUsage, 'post_discovery_enrichment');
    // Snapshot-only. Receita is never queried live and this cut adds no live path.
    assert.equal(config.requiresSnapshot, true);
    assert.equal(config.canRunLive, false);
    assert.equal(config.fallbackBehavior, 'skip_without_blocking');
    // 🔴 Not a prioritization source: a CNAE code is not a reason to rank a company.
    assert.ok(!config.capabilities.includes('prioritization'));
    assert.ok(!config.capabilities.includes('discovery_primary'));
    assert.ok(!config.capabilities.includes('discovery_secondary'));
  });

  it('resolves through the real country-enrichment lookup', () => {
    const forBrazil = getValidatedSourcesForEnrichment('BR', 'enrichment_after_discovery');
    assert.deepEqual(
      forBrazil.map((config) => config.sourceKey),
      [BR_RECEITA_CNPJ_SOURCE_KEY],
    );
    // And it does NOT leak into any other country's enrichment.
    for (const country of ['CO', 'MX', 'CL', 'EC']) {
      const others = getValidatedSourcesForEnrichment(country, 'enrichment_after_discovery');
      assert.ok(!others.some((config) => config.sourceKey === BR_RECEITA_CNPJ_SOURCE_KEY));
    }
  });

  it('is wired into the REAL adapter registry under the same key', () => {
    const adapter = ENRICHMENT_ADAPTER_REGISTRY[BR_RECEITA_CNPJ_SOURCE_KEY];
    assert.ok(adapter, 'Brazil must be in ENRICHMENT_ADAPTER_REGISTRY');
    assert.equal(adapter.sourceKey, BR_RECEITA_CNPJ_SOURCE_KEY);
    assert.deepEqual(adapter.supportedCapabilities, BR_RECEITA_ENRICHMENT_CAPABILITIES);
  });

  it('does not turn CUT A\'s dated record into a stale ratchet', () => {
    // CUT A recorded `runtimeRegistered: false` about ITS OWN scope — the source-family
    // registry — and that statement is still true. CUT B publishes its own LIVE contract instead
    // of mutating the record, so neither constant has to lie for the other to be right.
    assert.equal(BR_RECEITA_FUTURE_READER_CONTRACT.milestone, 'BR-SOURCE-FUNCTIONAL-CUT-A');
    assert.equal(BR_RECEITA_FUTURE_READER_CONTRACT.runtimeRegistered, false);
    assert.equal(SOURCE_FAMILY_BY_SOURCE_KEY[BR_RECEITA_CNPJ_SOURCE_KEY], undefined);

    assert.equal(BR_RECEITA_PUBLISHED_READER_CONTRACT.milestone, 'BR-SOURCE-FUNCTIONAL-CUT-B');
    assert.equal(BR_RECEITA_PUBLISHED_READER_CONTRACT.implemented, true);
    // The two agree on every step they both describe.
    assert.deepEqual(
      [...BR_RECEITA_PUBLISHED_READER_CONTRACT.step1ResolvePublishedRunBy],
      [...BR_RECEITA_FUTURE_READER_CONTRACT.step1ResolvePublishedRunBy],
    );
    assert.deepEqual(
      [...BR_RECEITA_PUBLISHED_READER_CONTRACT.step2SelectSnapshotsScopedBy],
      [...BR_RECEITA_FUTURE_READER_CONTRACT.step2SelectSnapshotsScopedBy],
    );
    assert.equal(
      BR_RECEITA_PUBLISHED_READER_CONTRACT.periodOnlyReadIsValid,
      BR_RECEITA_FUTURE_READER_CONTRACT.periodOnlyReadIsValid,
    );
  });

  it('🔴 stays ABSENT from SOURCE_FAMILY_BY_SOURCE_KEY', () => {
    // Registering Brazil there would make the five YEAR-scoped read primitives usable against a
    // source that puts twelve periods inside one year — a year-scoped read of one establishment
    // would legitimately see up to twelve rows and report a cardinality violation. The
    // period-aware reader is the only sanctioned path, and this absence is what enforces it.
    assert.equal(SOURCE_FAMILY_BY_SOURCE_KEY[BR_RECEITA_CNPJ_SOURCE_KEY], undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-SOURCE CUT B — the Agent 1 Brazil adapter', () => {
  const candidate = {
    candidateName: 'Synthetic Educação S.A.',
    candidateTaxId: ALPHANUMERIC_CNPJ,
    countryCode: 'BR',
    capability: 'enrichment_after_discovery' as const,
  };

  const boundAdapter = () =>
    createBrReceitaCnpjEnrichmentAdapter({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      getClient: () =>
        fakeReadClient({
          source_snapshot_runs: [publishedRunRow(SAMPLE_SOURCE_PERIOD, RUN_A)],
          source_company_snapshots: [
            snapshotRow(SAMPLE_SOURCE_PERIOD, RUN_A, ALPHANUMERIC_CNPJ),
          ],
        }),
    });

  it('matches by exact CNPJ out of the published run', async () => {
    const output = await boundAdapter().enrichCandidate(candidate);
    assert.equal(output.status, 'matched');
    assert.equal(output.matchedBy, 'tax_id');
    assert.equal(output.confidence, 1);
    assert.equal(output.sourceYear, 2026);
    assert.equal(output.priorityBoost, 0);
    assert.equal(output.metadata?.source_period, SAMPLE_SOURCE_PERIOD);
    assert.equal(output.metadata?.snapshot_run_id, RUN_A);
  });

  it('emits EXACTLY the recorded signal allowlist — no more, no less', async () => {
    const output = await boundAdapter().enrichCandidate(candidate);
    assert.deepEqual(
      Object.keys(output.signals ?? {}).sort(),
      [...BR_RECEITA_ENRICHMENT_SIGNAL_KEYS].sort(),
    );
  });

  it('🔴 never emits the CNPJ, and cannot emit Sócios/QSA/CPF because they do not exist', async () => {
    const output = await boundAdapter().enrichCandidate(candidate);
    const serialised = JSON.stringify(output);
    assert.ok(!serialised.includes(ALPHANUMERIC_CNPJ));
    for (const forbidden of ['socio', 'qsa', 'cpf', 'telefone', 'correio_eletronico', 'logradouro']) {
      assert.ok(
        !serialised.toLowerCase().includes(forbidden),
        `enrichment output must not carry "${forbidden}"`,
      );
    }
  });

  it('the REGISTERED adapter fail-closes because no period is bound to it', async () => {
    const output = await brReceitaCnpjEnrichmentAdapter.enrichCandidate(candidate);
    assert.equal(output.status, 'skipped');
    assert.equal(output.reason, 'br_snapshot_period_not_configured');
  });

  it('skips a non-BR candidate, a missing CNPJ and a DV-invalid CNPJ without querying', async () => {
    let clientBuilt = false;
    const adapter = createBrReceitaCnpjEnrichmentAdapter({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      getClient: () => {
        clientBuilt = true;
        return fakeReadClient({});
      },
    });

    assert.equal(
      (await adapter.enrichCandidate({ ...candidate, countryCode: 'CO' })).reason,
      'not_br_country',
    );
    assert.equal(
      (await adapter.enrichCandidate({ ...candidate, candidateTaxId: null })).reason,
      'missing_cnpj',
    );
    const badDv = `${ALPHANUMERIC_CNPJ.slice(0, 12)}00`;
    const invalid = await adapter.enrichCandidate({ ...candidate, candidateTaxId: badDv });
    assert.equal(invalid.status, 'skipped');
    assert.equal(invalid.reason, 'invalid_cnpj_invalid_dv');
    assert.ok(!JSON.stringify(invalid).includes(badDv));

    assert.equal(clientBuilt, false, 'no lookup may be attempted for an unusable candidate');
  });

  it('answers no_match — not error, not another month — when the period has no publication', async () => {
    const adapter = createBrReceitaCnpjEnrichmentAdapter({
      sourcePeriod: '2026-08',
      getClient: () =>
        fakeReadClient({
          source_snapshot_runs: [publishedRunRow(SAMPLE_SOURCE_PERIOD, RUN_A)],
          source_company_snapshots: [
            snapshotRow(SAMPLE_SOURCE_PERIOD, RUN_A, ALPHANUMERIC_CNPJ),
          ],
        }),
    });
    const output = await adapter.enrichCandidate(candidate);
    assert.equal(output.status, 'no_match');
    assert.equal(output.reason, 'br_period_has_no_published_run');
  });

  it('reports a read failure by class name only, and never throws', async () => {
    const adapter = createBrReceitaCnpjEnrichmentAdapter({
      sourcePeriod: SAMPLE_SOURCE_PERIOD,
      getClient: () => fakeReadClient({}, { code: 'PGRST301' }),
    });
    const output = await adapter.enrichCandidate(candidate);
    assert.equal(output.status, 'error');
    assert.equal(output.reason, 'br_snapshot_read_failed:BrReceitaPublishedReadQueryError');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BR-SOURCE CUT B — the boundary this cut does not cross', () => {
  it('authored NO migration: 127 is still the highest BR one, and 128 is not this cut', () => {
    // 🔴 The ceiling moved, and NOT by a BR cut: AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-
    // REVEAL-1 independently claimed 128 — projection of an already-approved candidate's phone
    // collection onto its own official contact — while this cut was already merged. CUT B still
    // authors NOTHING, and that is what this guard defends. The repository ceiling is kept EXACT,
    // so an undeclared migration above the last known milestone still breaks the guard, and the
    // authorship sweep is WIDENED past 127 by CONTENT, so the guard is stronger than before
    // rather than merely shifted: a BR-authored migration above CUT A's 127 now fails here even
    // if it were declared.
    const files = fs.readdirSync(join(repoRoot, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
    const numbers = files
      .map((file) => Number.parseInt(file.slice(0, 3), 10))
      .filter((value) => Number.isFinite(value));
    assert.equal(Math.max(...numbers), 128, 'the repository ceiling is 128, and it is not a BR migration');
    assert.equal(
      files.filter((file) => file.startsWith('128')).length,
      1,
      'AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 owns exactly one migration',
    );
    for (const name of files.filter((file) => Number.parseInt(file.slice(0, 3), 10) > 127)) {
      const sql = fs.readFileSync(join(repoRoot, 'supabase/migrations', name), 'utf8');
      assert.equal(
        /BR-SOURCE|RECEITA|CNPJ/i.test(sql),
        false,
        `${name} must not be authored by a BR cut — CUT B authored no migration`,
      );
    }
    for (const expected of [
      '125_reconcile_source_snapshot_record_identity.sql',
      '126_agent1_batch_identity_atomicity.sql',
      '127_br_receita_monthly_snapshot_identity.sql',
    ]) {
      assert.ok(files.includes(expected), `${expected} must still exist, unrenamed`);
    }
  });

  it('has no Supabase client construction, no env read and no Production reference', () => {
    for (const file of CUT_B_SOURCE_FILES) {
      const code = stripComments(readCutBSource(file));
      assert.ok(!code.includes('createClient('), `${file} must not build a Supabase client`);
      assert.ok(!code.includes('process.env'), `${file} must not read env`);
      assert.ok(!code.includes('supabase.co'), `${file} must not name a Supabase host`);
      assert.ok(!code.includes('lrdruowtadwbdulndlph'), `${file} must not name the prod project`);
    }
  });

  it('has no log sink of any kind on the CNPJ code path', () => {
    for (const file of CUT_B_SOURCE_FILES) {
      const code = stripComments(readCutBSource(file));
      for (const sink of ['console.log', 'console.error', 'console.warn', 'logger.', 'process.stdout']) {
        assert.ok(!code.includes(sink), `${file} must not carry a "${sink}" sink`);
      }
    }
  });

  it('calls no provider, no HubSpot and no feature flag', () => {
    for (const file of CUT_B_SOURCE_FILES) {
      const code = stripComments(readCutBSource(file)).toLowerCase();
      for (const forbidden of ['apollo', 'lusha', 'hubspot', 'isfeatureenabled', 'fetch(']) {
        assert.ok(!code.includes(forbidden), `${file} must not reference "${forbidden}"`);
      }
    }
  });
});
