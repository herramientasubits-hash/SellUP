/**
 * BR-COMPACT-POST-MERGE-CORRECTIONS — the two defects found after #368 merged.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 NO Production. NO remote database. NO apply_migration. NO provider. NO
 * credit. NO flag. Migration 134 is applied to an EPHEMERAL embedded
 * PostgreSQL and to nothing else. Every CNPJ here is synthetic.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── A. The provenance was declared, and then went nowhere ───────────────────
 *
 * #368 removed `parser_version` / `source_file_name` / `source_downloaded_at` / `import_batch_id`
 * from the compact row on the grounds that they describe the IMPORT and therefore belong on
 * `source_snapshot_runs.metadata`, once per publication. `brReceitaRunProvenanceMetadata` was
 * written to build exactly that object — and nothing called it on the write path. The run INSERT
 * bound six values, none of them `metadata`, so the fields left the row and arrived nowhere. The
 * suite below reads them back OUT of a real `source_snapshot_runs` after a real publication,
 * which is the only assertion that can tell "moved" apart from "dropped".
 *
 * ── B. A failed begin could leave a run with no storage ─────────────────────
 *
 * `beginPeriodRun` committed the run INSERT on its own and created the detached partition after
 * it. Anything that failed in between threw BEFORE the executor received the run id — so the
 * executor's `snapshotRunId` was still `null`, its `failPeriod` cleanup was skipped by
 * construction, and a `running` / `preparing` run row with no partition stayed behind: invisible
 * to readers, but a row an operator has to explain and one the same-period republish preflight
 * would eventually count against a legitimate load.
 *
 * 🔴 The regression below does NOT simulate the window. It drives the REAL gateway against the
 * REAL database and makes the real `CREATE TABLE` happen inside the transaction, then fails the
 * step immediately after it. Proving zero residue therefore proves the ROLLBACK covers both the
 * INSERT and the DDL — which is the fact the fix rests on, and the reason migration 134 needs no
 * change.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyRealChain,
  bootstrapPlatform,
  BR_RECEITA_COMPACT_CHAIN,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../__tests__/support/source-snapshot-identity-real-migration-chain';

import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import { sampleParserInput } from '../br-receita-cnpj-fixtures';
import {
  BR_RECEITA_COMPACT_PERSISTED_COLUMNS,
  BR_RECEITA_COMPACT_STORAGE_CONTRACT,
  BR_RECEITA_COMPACT_TABLE,
  BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS,
  brReceitaRunProvenanceForRun,
} from '../br-receita-cnpj-compact-storage';
import { BR_RECEITA_CNPJ_PARSER_VERSION } from '../br-receita-cnpj-types';
import { toBrReceitaPersistedSnapshot } from '../br-receita-cnpj-monthly-snapshot-identity';
import {
  planBrReceitaMonthlySnapshotWrite,
  type BrReceitaSnapshotWritePlanInput,
} from '../br-receita-cnpj-monthly-snapshot-write-plan';
import {
  BR_RECEITA_BEGIN_PARTITION_FUNCTION,
  createBrReceitaSqlWriteGateway,
  type BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import { executeBrReceitaMonthlySnapshotWrite } from '../br-receita-cnpj-monthly-snapshot-executor';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const { ctor: EmbeddedPostgresCtor, skip: harnessSkip } = resolveEmbeddedPostgres(import.meta.url);

/** The provenance a caller declares for a single-file local import. */
const DECLARED_PROVENANCE = {
  parser_version: 'br-receita-cnpj-postmerge@1',
  source_file_name: 'estabelecimentos0.csv',
  source_downloaded_at: '2026-07-12T09:18:00.000Z',
  import_batch_id: '33333333-3333-4333-8333-333333333333',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// PURE — no database. What the planner declares before anything is executed.
// ═══════════════════════════════════════════════════════════════════════════
describe('BR-COMPACT-POST-MERGE — the planner builds run provenance without consuming a record', () => {
  const records = () =>
    buildBrReceitaCnpjSnapshotRows(sampleParserInput()).snapshots.map(toBrReceitaPersistedSnapshot);

  /**
   * A producer that COUNTS every attempt to iterate it and refuses to yield.
   *
   * 🔴 Counting is not enough on its own — a planner could take one record and put it back. This
   * one throws on the first `next()`, so a planner that touched it would fail loudly rather than
   * quietly cost the national load its O(BATCH_SIZE) bound.
   */
  const tripwireProducer = () => {
    const state = { iteratorRequests: 0, recordsPulled: 0 };
    const records: Iterable<never> = {
      [Symbol.iterator]() {
        state.iteratorRequests += 1;
        return {
          next(): IteratorResult<never> {
            state.recordsPulled += 1;
            throw new Error('the planner pulled a record');
          },
        };
      },
    };
    return { state, records };
  };

  it('🔴 planning consumes ZERO records, with or without declared provenance', () => {
    for (const runProvenance of [undefined, DECLARED_PROVENANCE]) {
      const { state, records } = tripwireProducer();
      const planned = planBrReceitaMonthlySnapshotWrite({
        sourcePeriod: '2026-07',
        records: records as unknown as BrReceitaSnapshotWritePlanInput['records'],
        runProvenance,
      });
      assert.equal(planned.status, 'planned');
      assert.equal(state.iteratorRequests, 0, 'the producer was not even asked for an iterator');
      assert.equal(state.recordsPulled, 0, 'PLANNER_ZERO_RECORD_CONSUMPTION');
      if (planned.status !== 'planned') throw new Error('unreachable');
      // And the metadata exists ALREADY, so it cannot have been derived from a row.
      assert.equal(typeof planned.plan.runMetadata.parser_version, 'string');
      assert.equal(planned.plan.plannerMemoryBound, 'O(BATCH_SIZE)');
    }
  });

  it('parser_version is ALWAYS present, and defaults to the one authoritative constant', () => {
    // No second literal: the default is the constant the parser already stamps rows with.
    assert.equal(
      brReceitaRunProvenanceForRun(undefined).parser_version,
      BR_RECEITA_CNPJ_PARSER_VERSION,
    );
    // A caller that supplies nothing useful still gets a real version rather than an empty string.
    for (const blank of ['', '   ']) {
      assert.equal(
        brReceitaRunProvenanceForRun({ parser_version: blank }).parser_version,
        BR_RECEITA_CNPJ_PARSER_VERSION,
      );
    }
    assert.equal(
      brReceitaRunProvenanceForRun({ parser_version: 'v9' }).parser_version,
      'v9',
    );
  });

  it('🔴 only the four allowed keys can reach the run row', () => {
    const built = brReceitaRunProvenanceForRun({
      ...DECLARED_PROVENANCE,
      // A caller reaching for something it must never persist. There is no key for it on the
      // typed surface; this cast is the test asking "and if one got past the compiler?".
      normalized_tax_id: '11222333000181',
      legal_name: 'RAIZ TECNOLOGIA LTDA',
      raw_row: 'a,b,c',
      local_path: '/Users/somebody/Downloads/estabelecimentos0.csv',
    } as never);
    assert.deepEqual(Object.keys(built).sort(), [...BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS].sort());
    for (const forbidden of ['normalized_tax_id', 'legal_name', 'raw_row', 'local_path']) {
      assert.equal(forbidden in built, false, `${forbidden} must never reach run metadata`);
    }
  });

  it('the NATIONAL producer may omit source_file_name; the key is absent, never invented', () => {
    // Ten multipart establishment files. Naming one of them would claim it represents the nation.
    const national = brReceitaRunProvenanceForRun({ import_batch_id: 'national-2026-07' });
    assert.equal('source_file_name' in national, false);
    assert.equal(national.parser_version, BR_RECEITA_CNPJ_PARSER_VERSION);
    assert.equal(national.import_batch_id, 'national-2026-07');
  });

  it('the operation carries the metadata, so a write path cannot be built without it', async () => {
    const planned = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: '2026-07',
      records: records(),
      runProvenance: DECLARED_PROVENANCE,
    });
    assert.equal(planned.status, 'planned');
    if (planned.status !== 'planned') throw new Error('unreachable');

    const operations = planned.plan.operations();
    const first = await operations.next();
    assert.equal(first.done, false);
    if (first.done !== false) throw new Error('unreachable');
    assert.equal(first.value.kind, 'begin_period');
    if (first.value.kind !== 'begin_period') throw new Error('unreachable');
    assert.deepEqual(first.value.metadata, { ...DECLARED_PROVENANCE });
    assert.equal(first.value.persistsRunProvenance, true);
    await operations.return(undefined);
  });

  it('the storage contract now claims persistence, which the PostgreSQL suite below proves', () => {
    const c = BR_RECEITA_COMPACT_STORAGE_CONTRACT;
    assert.equal(c.runLevelProvenanceLivesOn, 'source_snapshot_runs.metadata');
    assert.equal(c.runLevelProvenanceIsPersistedByTheWriter, true);
    assert.equal(c.runLevelProvenanceParserVersionIsMandatory, true);
    assert.equal(c.runLevelProvenanceAcceptsArbitraryCallerKeys, false);
    assert.equal(c.persistsImportProvenancePerRow, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REAL PostgreSQL.
// ═══════════════════════════════════════════════════════════════════════════
describe('BR-COMPACT-POST-MERGE — against a REAL PostgreSQL', () => {
  let postgres: EmbeddedPostgresLike | null = null;
  let client: PgLikeClient;
  let dataDir = '';

  const realSql = (): BrReceitaSqlExecutor => ({
    query: (statement, params) => client.query(statement, params ? [...params] : undefined),
  });

  const snapshotsFor = (period: string) =>
    buildBrReceitaCnpjSnapshotRows({
      ...sampleParserInput(),
      sourceYear: Number.parseInt(period.slice(0, 4), 10),
      sourcePeriod: period,
    }).snapshots.map(toBrReceitaPersistedSnapshot);

  const publish = async (
    period: string,
    runProvenance?: BrReceitaSnapshotWritePlanInput['runProvenance'],
  ): Promise<string> => {
    const planned = planBrReceitaMonthlySnapshotWrite({
      sourcePeriod: period,
      records: snapshotsFor(period),
      runProvenance,
    });
    assert.equal(planned.status, 'planned');
    if (planned.status !== 'planned') throw new Error('unreachable');
    const execution = await executeBrReceitaMonthlySnapshotWrite({
      plan: planned.plan,
      gateway: createBrReceitaSqlWriteGateway(realSql()),
    });
    assert.equal(execution.status, 'published', execution.failure?.reason);
    return execution.snapshotRunId!;
  };

  const runMetadataOf = async (runId: string): Promise<Record<string, unknown>> => {
    const { rows } = await client.query(
      'SELECT metadata FROM public.source_snapshot_runs WHERE id = $1',
      [runId],
    );
    assert.equal(rows.length, 1);
    return rows[0].metadata as Record<string, unknown>;
  };

  /** Every BR run row, so "no new run" is a difference rather than an impression. */
  const brRunIds = async (): Promise<string[]> => {
    const { rows } = await client.query(
      `SELECT id::text AS id FROM public.source_snapshot_runs
        WHERE source_key = 'br_receita_cnpj_dados_abertos' ORDER BY id`,
    );
    return rows.map((r) => String(r.id));
  };

  const preparingBrRunCount = async (): Promise<number> => {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.source_snapshot_runs
        WHERE source_key = 'br_receita_cnpj_dados_abertos'
          AND (publish_state = 'preparing' OR status = 'running')`,
    );
    return Number(rows[0].n);
  };

  /** Detached children: a BR partition-shaped table that no parent claims. */
  const detachedPartitionNames = async (): Promise<string[]> => {
    const { rows } = await client.query(
      `SELECT c.relname::text AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname LIKE 'br_receita_snapshots_p%'
          AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
        ORDER BY c.relname`,
    );
    return rows.map((r) => String(r.name));
  };

  const attachedPartitionNames = async (): Promise<string[]> => {
    const { rows } = await client.query(
      `SELECT c.relname::text AS name
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'public.br_receita_snapshots'::regclass
        ORDER BY c.relname`,
    );
    return rows.map((r) => String(r.name));
  };

  const publishedRunRow = async (runId: string): Promise<Record<string, unknown>> => {
    const { rows } = await client.query(
      `SELECT publish_state, status, source_period, metadata
         FROM public.source_snapshot_runs WHERE id = $1`,
      [runId],
    );
    assert.equal(rows.length, 1);
    return rows[0];
  };

  const publishedRowCount = async (): Promise<number> => {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.${BR_RECEITA_COMPACT_TABLE}`,
    );
    return Number(rows[0].n);
  };

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-postmerge-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54937,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();
    await bootstrapPlatform(client);
    await applyRealChain(client, repoRoot, BR_RECEITA_COMPACT_CHAIN);
  });

  after(async () => {
    await client?.end().catch(() => {});
    await postgres?.stop().catch(() => {});
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  const maybe = harnessSkip === false ? it : it.skip;

  // ── A ─────────────────────────────────────────────────────────────────────

  maybe('🔴 declared run provenance SURVIVES a real publication, on the run row', async () => {
    const runId = await publish('2026-03', DECLARED_PROVENANCE);
    const metadata = await runMetadataOf(runId);

    // Exactly what the caller declared. Not a subset, not a superset.
    assert.deepEqual(metadata, { ...DECLARED_PROVENANCE });
  });

  maybe('a publication with NO declared provenance still carries a parser version', async () => {
    const runId = await publish('2026-04');
    assert.deepEqual(await runMetadataOf(runId), {
      parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
    });
  });

  maybe('the NATIONAL shape — no source_file_name — is persisted as declared', async () => {
    const runId = await publish('2026-05', { import_batch_id: 'national-2026-05' });
    const metadata = await runMetadataOf(runId);
    assert.deepEqual(metadata, {
      parser_version: BR_RECEITA_CNPJ_PARSER_VERSION,
      import_batch_id: 'national-2026-05',
    });
    assert.equal('source_file_name' in metadata, false);
  });

  maybe('🔴 and the ROW still carries none of it — no metadata, no raw_data column', async () => {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [BR_RECEITA_COMPACT_TABLE],
    );
    const names = rows.map((r) => String(r.column_name));
    assert.deepEqual(names.slice().sort(), [...BR_RECEITA_COMPACT_PERSISTED_COLUMNS].sort());
    for (const forbidden of ['metadata', 'raw_data', 'signals', 'tax_id', 'record_identity_key']) {
      assert.equal(names.includes(forbidden), false, `${forbidden} is not a column of the row`);
    }
    // The four provenance keys are absent from the row and present on the run. Both halves.
    for (const key of BR_RECEITA_RUN_LEVEL_PROVENANCE_KEYS) {
      assert.equal(names.includes(key), false, `${key} belongs to the run, not the establishment`);
    }
  });

  // ── B ─────────────────────────────────────────────────────────────────────

  /**
   * The REAL executor, with ONE surgical alteration at the partition step.
   *
   * 🔴 Every statement — `BEGIN`, the run INSERT, the partition call itself, `ROLLBACK` — is
   * executed by the real database. The partition function REALLY runs, so its `CREATE TABLE`
   * really happens inside the transaction; only the returned NAME is replaced afterwards. That is
   * what makes the residue assertions meaningful: the rollback has to undo a real DDL, not a
   * mocked one.
   */
  const executorReturningMalformedPartitionName = (): BrReceitaSqlExecutor => ({
    async query(statement, params) {
      const result = await client.query(statement, params ? [...params] : undefined);
      if (statement.includes(BR_RECEITA_BEGIN_PARTITION_FUNCTION)) {
        return { rows: [{ name: 'public.br_receita_snapshots; DROP TABLE x' }] };
      }
      return result;
    },
  });

  /** The cheap variant: the partition call itself fails, raised by the real function. */
  const executorWhosePartitionCallFails = (): BrReceitaSqlExecutor => ({
    async query(statement, params) {
      if (statement.includes(BR_RECEITA_BEGIN_PARTITION_FUNCTION)) {
        // The function's own guard: a NULL run id is refused. A REAL exception, inside the REAL
        // transaction, from the REAL migration-134 function.
        return await client.query(
          `SELECT public.${BR_RECEITA_BEGIN_PARTITION_FUNCTION}(NULL::uuid) AS name`,
        );
      }
      return await client.query(statement, params ? [...params] : undefined);
    },
  });

  const beginOperationFor = (period: string) =>
    ({
      kind: 'begin_period',
      table: 'source_snapshot_runs',
      source_key: 'br_receita_cnpj_dados_abertos',
      country_code: 'BR',
      source_period: period,
      publish_state: 'preparing',
      metadata: brReceitaRunProvenanceForRun(DECLARED_PROVENANCE),
      returnsRunId: true,
      resolvesRunHandle: true,
      persistsRunProvenance: true,
    }) as const;

  /**
   * The publication both failure cases must leave alone. Published ONCE and reused, so the second
   * case also proves the first case's rollback did not quietly damage it.
   */
  let protectedRunId: string | null = null;
  const protectedRun = async (): Promise<string> => {
    if (protectedRunId === null) {
      protectedRunId = await publish('2026-08', DECLARED_PROVENANCE);
    }
    return protectedRunId;
  };

  const provesNoResidue = async (
    label: string,
    period: string,
    executor: BrReceitaSqlExecutor,
    expectedReason: string,
  ): Promise<void> => {
    // A published run to protect, so "unchanged" is a comparison and not an absence of evidence.
    const publishedRunId = await protectedRun();
    const publishedBefore = await publishedRunRow(publishedRunId);
    const attachedBefore = await attachedPartitionNames();
    const rowsBefore = await publishedRowCount();

    const runsBefore = await brRunIds();
    const detachedBefore = await detachedPartitionNames();
    const preparingBefore = await preparingBrRunCount();

    const gateway = createBrReceitaSqlWriteGateway(executor);
    await assert.rejects(
      () => gateway.beginPeriodRun(beginOperationFor(period)),
      (error: unknown) => (error as { reason?: string }).reason === expectedReason,
      label,
    );

    // ── The orphan window, closed ──
    const runsAfter = await brRunIds();
    assert.deepEqual(runsAfter, runsBefore, `${label}: ORPHAN_RUN_ROWS_AFTER_FAILURE = 0`);
    assert.equal(
      runsAfter.length - runsBefore.length,
      0,
      `${label}: the run INSERT rolled back with the DDL`,
    );
    assert.equal(
      await preparingBrRunCount(),
      preparingBefore,
      `${label}: ORPHAN_PREPARING_RUNS_AFTER_FAILURE = 0`,
    );
    assert.deepEqual(
      await detachedPartitionNames(),
      detachedBefore,
      `${label}: ORPHAN_PARTITIONS_AFTER_FAILURE = 0 — the CREATE TABLE rolled back too`,
    );

    // ── The existing publication, untouched ──
    assert.deepEqual(
      await publishedRunRow(publishedRunId),
      publishedBefore,
      `${label}: the published run is byte-identical`,
    );
    assert.deepEqual(
      await attachedPartitionNames(),
      attachedBefore,
      `${label}: every published partition is still attached`,
    );
    assert.equal(await publishedRowCount(), rowsBefore, `${label}: no published row moved`);
  };

  maybe(
    '🔴 a MALFORMED partition name rolls back the run row AND the table it just created',
    async () => {
      await provesNoResidue(
        'malformed partition name',
        '2026-10',
        executorReturningMalformedPartitionName(),
        'begin_period_returned_malformed_partition_name',
      );
    },
  );

  maybe('🔴 a FAILING partition call leaves the same nothing behind', async () => {
    await provesNoResidue(
      'failing partition call',
      '2026-11',
      executorWhosePartitionCallFails(),
      'begin_period_partition_failed',
    );
  });

  maybe('after a rolled-back begin, the very next begin for that period still works', async () => {
    // 🔴 The failure must not poison the gateway or the session: a rollback that left the
    // connection in an aborted transaction would turn one bad DDL into a dead worker.
    const gateway = createBrReceitaSqlWriteGateway(realSql());
    const started = await gateway.beginPeriodRun(beginOperationFor('2026-10'));
    assert.match(started.partitionTable, /^br_receita_snapshots_p[0-9a-f]{32}$/);

    // The run row it DID create carries the provenance, in the same transaction that made it.
    assert.deepEqual(await runMetadataOf(started.snapshotRunId), { ...DECLARED_PROVENANCE });

    // Leave nothing behind for the assertions of a later run of this suite.
    await client.query('SELECT public.br_receita_drop_run_partition($1::uuid)', [
      started.snapshotRunId,
    ]);
    await client.query('DELETE FROM public.source_snapshot_runs WHERE id = $1', [
      started.snapshotRunId,
    ]);
  });
});
