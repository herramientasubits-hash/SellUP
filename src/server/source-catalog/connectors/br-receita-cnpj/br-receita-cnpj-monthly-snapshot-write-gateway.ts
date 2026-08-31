/**
 * BR Receita CNPJ — the WRITE GATEWAY: the only place CUT B turns a planned operation into SQL.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B — runtime snapshot → published reader → Agent 1 adapter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO Supabase client is created here, no env is read, no secret is resolved,
 * no network address is known. The executor is handed a SQL port and nothing
 * else. CUT B never touches Production.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a SQL port and not the PostgREST client every other source uses ─────
 *
 * CUT A's `publish_period` carries `mustCommitWithFinalBatch: true`. That is not a preference:
 * a crash between the last batch and the promotion must leave the run INVISIBLE (recoverable),
 * never VISIBLE-and-incomplete. PostgREST has no multi-statement transaction, so a PostgREST
 * writer could not honour that contract — it could only pretend to. The write side therefore
 * speaks SQL, and the READ side (`br-receita-cnpj-published-snapshot-reader.ts`) stays on the
 * PostgREST-shaped client every other enrichment adapter already uses, because a two-step read
 * needs no transaction.
 *
 * ── 🔴 The publish API has the final batch INSIDE it ────────────────────────
 *
 * There is deliberately no `publishPeriod(op)` method. The only way to publish is
 * `commitFinalBatchAndPublish(finalBatch, publish)`, which opens ONE transaction, writes the
 * last batch, demotes the outgoing run, promotes the incoming one and commits. An executor
 * cannot publish without handing over the batch it is publishing, so
 * `mustCommitWithFinalBatch` is a property of the SHAPE rather than a rule to remember — the
 * same technique CUT A used for the run handle and the persisted projection.
 *
 * ── 🔴 Privacy: SQL is parameterised, and errors are NEVER echoed ───────────
 *
 * Every CNPJ reaches PostgreSQL as a BIND PARAMETER, never interpolated into a statement, so a
 * statement string is safe to hold. The reverse direction is the dangerous one and is handled
 * in the executor: PostgreSQL's own `23505` message embeds the conflicting KEY VALUES — that is
 * to say, the CNPJ — so a driver error object may NEVER be forwarded to a caller, a log or a
 * report. See `toSafeGatewayFailure`.
 */

import {
  BR_RECEITA_DISCARDABLE_PUBLISH_STATES,
  BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
  type BeginPeriodOperation,
  type BrReceitaRunScopedSnapshotRow,
  type DiscardRunRowsOperation,
  type FailPeriodOperation,
  type PublishPeriodOperation,
  type UpsertBatchOperation,
} from './br-receita-cnpj-monthly-snapshot-write-plan';
import { BR_RECEITA_SNAPSHOT_TABLE } from './br-receita-cnpj-monthly-snapshot-identity';
import {
  BR_RECEITA_COMPACT_PERSISTED_COLUMNS,
  BR_RECEITA_SNAPSHOT_RUNS_TABLE as COMPACT_RUNS_TABLE,
  brReceitaCompactRowBindings,
  brReceitaCompactUpdateAssignments,
} from './br-receita-cnpj-compact-storage';
import {
  BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE,
  checkBrReceitaRepublishStorage,
} from './br-receita-cnpj-republish-storage-preflight';
import { normalizeBrCompanyLegalName } from './br-receita-cnpj-name-normalization';
import { parseSnapshotRunId } from './br-receita-cnpj-monthly-snapshot-run-handle';

/** The run table CUT A's operations name. Re-declared nowhere else in CUT B. */
export const BR_RECEITA_SNAPSHOT_RUNS_TABLE = COMPACT_RUNS_TABLE;

/**
 * The partition-lifecycle functions the LOCAL compact migration defines.
 *
 * 🔴 The gateway calls them with a uuid bind parameter and NEVER assembles a table identifier
 * itself. A writer that could build `br_receita_snapshots_p<hex>` from a string is a writer that
 * can be talked into naming someone else's table; this one can only pass a run id, and the
 * function decides what that id is allowed to touch.
 */
export const BR_RECEITA_BEGIN_PARTITION_FUNCTION = 'br_receita_begin_run_partition' as const;
export const BR_RECEITA_BUILD_PARTITION_INDEXES_FUNCTION =
  'br_receita_build_run_partition_indexes' as const;
export const BR_RECEITA_ATTACH_PARTITION_FUNCTION = 'br_receita_attach_run_partition' as const;
export const BR_RECEITA_DROP_PARTITION_FUNCTION = 'br_receita_drop_run_partition' as const;
export const BR_RECEITA_PARTITION_NAME_FUNCTION = 'br_receita_run_partition_name' as const;

/**
 * The only shape a partition name is allowed to have.
 *
 * 🔴 The name is MINTED BY THE DATABASE and returned by `br_receita_begin_run_partition`; this
 * pattern is the gateway refusing to interpolate anything else into a statement. The gateway never
 * builds the name itself, and a value that does not match this is a bug loud enough to stop the
 * run rather than an identifier to try.
 */
export const BR_RECEITA_PARTITION_NAME_PATTERN = /^br_receita_snapshots_p[0-9a-f]{32}$/;

/**
 * The columns a Brazil snapshot row is written with — an ALLOWLIST, exactly like the EC SCVS
 * writer's `EC_SCVS_PERSISTABLE_COLUMNS` and for the same reason: the payload is built from this
 * list, so a column that is not on it cannot be written even if a future row shape grows one.
 *
 * 🔴 Re-exported from `br-receita-cnpj-compact-storage.ts` rather than re-declared. The list, the
 * bind values and the read-time reassembly are derived from ONE table of column descriptors there,
 * so a column cannot be written without being readable and cannot be renamed in one direction only.
 *
 * 🔴 `tax_id` and `record_identity_key` are ABSENT, deliberately — and now unrepresentable: the
 * dedicated table has no such columns at all. "Exactly ONE persisted representation" (GATE-4A) is
 * enforced by the statement's shape, by the table's shape, and by the persisted projection's shape.
 * Three independent barriers, none of them a comment.
 *
 * 🔴 `normalized_legal_name` is NOT a second identity candidate: it is the canonical form of
 * `legal_name`, which is already an `INCLUDED_OUTPUT` field of GATE-3's allowlist and already
 * travels in the public projection. It carries no tax material and is not derived from any.
 */
export const BR_RECEITA_PERSISTABLE_COLUMNS = BR_RECEITA_COMPACT_PERSISTED_COLUMNS;

/** Columns 065's `status` lifecycle uses. Kept coherent; never repurposed as `publish_state`. */
const RUN_STATUS_RUNNING = 'running' as const;
const RUN_STATUS_COMPLETED = 'completed' as const;
const RUN_STATUS_FAILED = 'failed' as const;

// ─── The SQL port ───────────────────────────────────────────────────────────

export interface BrReceitaSqlResult {
  readonly rows: readonly Record<string, unknown>[];
}

/**
 * The minimal transactional SQL surface CUT B needs. Structurally satisfied by `pg`'s `Client`
 * and by the ephemeral-Postgres harness the CUT-B suite drives, without importing either.
 *
 * 🔴 One method. A port that could also "create a client" or "read a URL" would be a place for
 * Production to leak in.
 */
export interface BrReceitaSqlExecutor {
  query(sql: string, params?: readonly unknown[]): Promise<BrReceitaSqlResult>;
}

// ─── Failures ───────────────────────────────────────────────────────────────

export type BrReceitaGatewayFailureReason =
  | 'begin_period_returned_no_run_id'
  | 'begin_period_returned_malformed_run_id'
  | 'begin_period_partition_failed'
  | 'repeated_same_period_republish_requires_storage_review'
  | 'begin_period_returned_malformed_partition_name'
  | 'publish_partition_index_build_failed'
  | 'publish_partition_attach_failed'
  | 'publish_promote_affected_no_run'
  | 'publish_demote_affected_no_run'
  | 'conflict_target_rejected'
  | 'database_error';

/**
 * A gateway failure, SANITISED.
 *
 * 🔴 It carries a SQLSTATE and a category — never the driver's message, never `detail`, never
 * `hint`, and never a row. PostgreSQL's unique-violation message quotes the conflicting key,
 * which for a Brazil row IS the CNPJ; forwarding it would turn the error path into the leak the
 * whole GATE-1 R4 line of work exists to prevent.
 */
export class BrReceitaGatewayError extends Error {
  readonly reason: BrReceitaGatewayFailureReason;
  /** Five-character SQLSTATE when the driver reported one; `null` otherwise. Never a message. */
  readonly sqlState: string | null;

  constructor(reason: BrReceitaGatewayFailureReason, sqlState: string | null = null) {
    super(
      `br receita snapshot write gateway failed (${reason})${
        sqlState === null ? '' : ` [SQLSTATE ${sqlState}]`
      }`,
    );
    this.name = 'BrReceitaGatewayError';
    this.reason = reason;
    this.sqlState = sqlState;
  }
}

/** Canonical SQLSTATE shape. Anything else is discarded rather than echoed. */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * Extracts the ONLY safe fact from a driver error: its SQLSTATE.
 *
 * 🔴 `message`, `detail`, `hint`, `where`, `table` and `constraint` are all deliberately dropped.
 * `detail` in particular reads `Key (source_key, country_code, source_period, snapshot_run_id,
 * normalized_tax_id)=(…, …, …, …, <THE CNPJ>) already exists.`
 */
export function safeSqlStateOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && SQLSTATE_PATTERN.test(code) ? code : null;
}

/** Wraps any thrown driver error as a sanitised gateway error. Never rethrows the original. */
export function toSafeGatewayFailure(
  error: unknown,
  reason: BrReceitaGatewayFailureReason = 'database_error',
): BrReceitaGatewayError {
  if (error instanceof BrReceitaGatewayError) {
    return error;
  }
  return new BrReceitaGatewayError(reason, safeSqlStateOf(error));
}

// ─── The gateway contract ───────────────────────────────────────────────────

export interface BrReceitaBeginPeriodResult {
  readonly snapshotRunId: string;
  /**
   * The DETACHED child the run's rows are loaded into, as the database named it.
   *
   * 🔴 Batches are written HERE, not into the parent. Until `commitFinalBatchAndPublish` attaches
   * it, this table is not part of `br_receita_snapshots` at all — which is what makes a partial
   * month unreadable structurally rather than by a `publish_state` filter a reader might forget.
   */
  readonly partitionTable: string;
}

export interface BrReceitaDiscardResult {
  readonly deletedRows: number;
}

export interface BrReceitaUpsertResult {
  readonly writtenRows: number;
}

export interface BrReceitaPublishResult {
  readonly promotedRunId: string;
  readonly supersededRunId: string | null;
  readonly finalBatchRows: number;
}

/**
 * What the executor is allowed to do. Deliberately NOT "run arbitrary SQL": each method
 * corresponds to exactly one CUT-A operation, so an executor cannot invent a fifth thing —
 * a period-wide DELETE, for instance.
 */
export interface BrReceitaSnapshotWriteGateway {
  beginPeriodRun(operation: BeginPeriodOperation): Promise<BrReceitaBeginPeriodResult>;
  discardRunRows(operation: DiscardRunRowsOperation): Promise<BrReceitaDiscardResult>;
  upsertBatch(operation: UpsertBatchOperation): Promise<BrReceitaUpsertResult>;
  /**
   * The ONE atomic cutover. Writes `finalBatch`, demotes `publish.supersedes` and promotes
   * `publish.snapshot_run_id` inside a single transaction, in that order.
   *
   * 🔴 There is no way to publish without the final batch: that is what makes CUT A's
   * `mustCommitWithFinalBatch` structural rather than advisory.
   */
  commitFinalBatchAndPublish(
    finalBatch: UpsertBatchOperation | null,
    publish: PublishPeriodOperation,
  ): Promise<BrReceitaPublishResult>;
  /**
   * Terminal failure for ONE run: marks it unpublishable and then discards ITS rows.
   *
   * 🔴 Order is load-bearing. The run is marked `failed` FIRST, so that if the row cleanup
   * itself fails the run is already outside every publishable state. The reverse order would
   * leave a `preparing` run with no rows — which a retry could publish as an empty month.
   */
  failPeriod(
    operation: FailPeriodOperation,
    snapshotRunId: string,
  ): Promise<BrReceitaDiscardResult>;
}

// ─── SQL construction ───────────────────────────────────────────────────────

/**
 * Identifiers that may appear in a generated statement. The conflict target comes from the
 * PLAN, so it is data, and data that reaches a statement as an identifier is validated rather
 * than trusted — even though CUT A's constant is the only value that ever arrives.
 */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifiers(columns: readonly string[]): void {
  for (const column of columns) {
    if (!SAFE_IDENTIFIER.test(column)) {
      throw new BrReceitaGatewayError('conflict_target_rejected');
    }
  }
}

/** Builds `($1,$2,…),($9,…)` for a multi-row INSERT of `columnCount` columns. */
function valuesPlaceholders(rowCount: number, columnCount: number): string {
  const groups: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const placeholders: string[] = [];
    for (let column = 0; column < columnCount; column += 1) {
      placeholders.push(`$${row * columnCount + column + 1}`);
    }
    groups.push(`(${placeholders.join(', ')})`);
  }
  return groups.join(', ');
}

/**
 * Flattens one run-scoped row into bind parameters, in `BR_RECEITA_PERSISTABLE_COLUMNS` order.
 *
 * 🔴 Built field by field from the persisted projection rather than by spreading the row: a
 * spread is how an unexpected key reaches a column list, and an unexpected key here would be a
 * second CNPJ representation.
 *
 * 🔴 CUT C: `normalized_legal_name` is DERIVED here, from `legal_name`, and is deliberately NOT a
 * field on the payload a caller hands over. That is what makes writer/resolver symmetry
 * structural rather than remembered:
 *
 *   · there is no way to persist a canonical name that disagrees with the `legal_name` beside it,
 *     because nobody supplies it — a caller that spread a payload and overrode `legal_name` would
 *     otherwise leave a stale canonical form behind;
 *   · there is exactly ONE derivation in the codebase, `normalizeBrCompanyLegalName`, and the
 *     resolver filters on the value that same function produces. A change to the normalizer moves
 *     both sides or neither.
 *
 * A name that cannot be canonicalized (absent, blank, punctuation-only) binds NULL. NULL is the
 * honest value — the column is nullable, migration 127's Brazil CHECK does not require it, and a
 * row with no canonical name is simply unreachable BY NAME while staying perfectly reachable by
 * CNPJ. Inventing a placeholder would make it reachable by the wrong name.
 */
function rowBindings(row: BrReceitaRunScopedSnapshotRow): unknown[] {
  const canonicalName = normalizeBrCompanyLegalName(row.payload.legal_name);
  return brReceitaCompactRowBindings({
    snapshot_run_id: row.snapshot_run_id,
    source_period: row.identity.source_period,
    normalized_tax_id: row.identity.normalized_tax_id,
    legal_name: row.payload.legal_name,
    normalized_legal_name: canonicalName.status === 'valid' ? canonicalName.normalized : null,
    signals: row.payload.signals,
  });
}

/**
 * The upsert statement for one batch, built FROM the operation.
 *
 * The conflict target is read off `operation`, not re-derived here, so the arbiter Postgres infers
 * is the one the plan recorded and the one the LOCAL compact migration created.
 *
 * 🔴 No `WHERE` predicate any more, and that is a decision rather than an omission.
 * `operation.conflictTargetIsPartial` is `false` because the dedicated table's arbiter is its
 * PRIMARY KEY. On the shared generic table the arbiter had to be partial
 * (`source_key = 'br_receita_cnpj_dados_abertos'`) so it would not collide with ten other tenants,
 * and a bare `ON CONFLICT (…)` against a partial index raises 42P10. Emitting a predicate against
 * a NON-partial index raises 42P10 just as loudly, so the flag is checked rather than assumed.
 */
export function buildUpsertBatchStatement(
  operation: UpsertBatchOperation,
  /**
   * The physical table to write into. Defaults to the operation's logical table (the partitioned
   * parent), which is what a pure unit test asserts against. The SQL gateway overrides it with the
   * DETACHED child the database named at `begin_period`, because the parent has no partition for a
   * preparing run and would reject the row — correctly.
   */
  targetTable: string = operation.table,
): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  assertSafeIdentifiers(operation.conflictColumns);
  assertSafeIdentifiers([targetTable]);

  const columns = BR_RECEITA_PERSISTABLE_COLUMNS;
  const params: unknown[] = [];
  for (const row of operation.rows) {
    params.push(...rowBindings(row));
  }

  // Only the payload is refreshed on conflict. The conflict columns ARE the identity, so
  // re-assigning them would be a no-op that reads as if a row could change identity.
  const arbiterPredicate =
    operation.conflictTargetIsPartial === true && operation.conflictIndexPredicate !== null
      ? `\n      WHERE ${String(operation.conflictIndexPredicate)}`
      : '';

  const sql = `
    INSERT INTO public.${targetTable} (${columns.join(', ')})
    VALUES ${valuesPlaceholders(operation.rows.length, columns.length)}
    ON CONFLICT (${operation.conflictColumns.join(', ')})${arbiterPredicate}
    DO UPDATE SET
      ${brReceitaCompactUpdateAssignments().join(',\n      ')}
    RETURNING 1 AS written
  `;

  return { sql, params };
}

/**
 * The run-scoped DELETE.
 *
 * 🔴 The "never a published run" rule is inside the STATEMENT, as an `EXISTS` over the run's
 * `publish_state`, not in a caller-side check. A caller-side check protects only the callers
 * that remember it; this predicate protects the statement itself, so a future caller that
 * passed a published run's id would delete zero rows rather than the live month.
 */
export function buildDiscardRunRowsStatement(
  operation: DiscardRunRowsOperation,
  targetTable: string = operation.table,
): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  assertSafeIdentifiers([targetTable]);
  // 🔴 The statement targets the run's PARTITION, by name, through the parent's partition key.
  // `source_key` and `country_code` are gone from the predicate because they are gone from the
  // table: on a dedicated Brazil table they were a constant repeated 31 B × 72M times, and a
  // predicate on a constant filters nothing. What replaces them is stronger, not weaker — the run
  // id IS the partition key, so a DELETE scoped to it cannot physically touch another run's
  // storage, and `source_period` is still restated so a caller that paired the wrong period with
  // the right run deletes nothing.
  const sql = `
    DELETE FROM public.${targetTable} AS snapshots
     WHERE snapshots.snapshot_run_id = $1
       AND snapshots.source_period   = $2
       AND EXISTS (
             SELECT 1
               FROM public.${BR_RECEITA_SNAPSHOT_RUNS_TABLE} AS runs
              WHERE runs.id = snapshots.snapshot_run_id
                AND runs.source_key    = $3
                AND runs.country_code  = $4
                AND runs.publish_state = ANY($5::text[])
           )
    RETURNING 1 AS deleted
  `;
  return {
    sql,
    params: [
      operation.snapshot_run_id,
      operation.source_period,
      operation.source_key,
      operation.country_code,
      [...operation.onlyWhenRunPublishStateIn],
    ],
  };
}

// ─── The SQL-backed gateway ─────────────────────────────────────────────────

/**
 * Creates the gateway over an injected SQL executor.
 *
 * 🔴 It never creates the executor. A writer that could build its own connection is a writer
 * that can reach Production from a test; this one physically cannot.
 */
export interface BrReceitaWriteGatewayOptions {
  /**
   * Periods whose REPEATED same-period republish a human has already reviewed for storage.
   *
   * 🔴 Empty by default, which is what makes the preflight fail closed: a caller that has not
   * looked at the disk cannot start the second same-period national load by simply not knowing
   * the check exists. Naming a period here is the storage review, recorded as an argument.
   *
   * It is a list of PERIODS, not a boolean. A blanket `storageReviewed: true` would carry over to
   * the next month, which is precisely the month nobody reviewed.
   */
  readonly repeatedSamePeriodRepublishStorageReviewedFor?: readonly string[];
}

export function createBrReceitaSqlWriteGateway(
  sql: BrReceitaSqlExecutor,
  options: BrReceitaWriteGatewayOptions = {},
): BrReceitaSnapshotWriteGateway {
  const storageReviewedPeriods = new Set(
    options.repeatedSamePeriodRepublishStorageReviewedFor ?? [],
  );
  // Owned by this gateway because it is the only thing that issues BEGIN. `failPeriod` consults
  // it so a failure inside the cutover cannot leave the session in an aborted-transaction state
  // that would poison the cleanup running right after it.
  let inTransaction = false;

  const run = async (
    statement: string,
    params: readonly unknown[],
    reason: BrReceitaGatewayFailureReason = 'database_error',
  ): Promise<BrReceitaSqlResult> => {
    try {
      return await sql.query(statement, params);
    } catch (error) {
      throw toSafeGatewayFailure(error, reason);
    }
  };

  /**
   * Which DETACHED child each run's batches go into, as the DATABASE named it.
   *
   * 🔴 Populated only from `br_receita_begin_run_partition`'s return value or from
   * `br_receita_run_partition_name`, and validated against `BR_RECEITA_PARTITION_NAME_PATTERN`
   * before it can reach a statement. The gateway never assembles a table identifier.
   */
  const partitionByRun = new Map<string, string>();

  const rememberPartition = (snapshotRunId: string, name: unknown): string => {
    const value = typeof name === 'string' ? name : '';
    if (!BR_RECEITA_PARTITION_NAME_PATTERN.test(value)) {
      throw new BrReceitaGatewayError('begin_period_returned_malformed_partition_name');
    }
    partitionByRun.set(snapshotRunId, value);
    return value;
  };

  const partitionFor = async (snapshotRunId: string): Promise<string> => {
    const known = partitionByRun.get(snapshotRunId);
    if (known !== undefined) {
      return known;
    }
    // A gateway instance that did not begin this run asks the database what the child is called,
    // rather than reconstructing the name from the uuid.
    const resolved = await run(
      `SELECT public.${BR_RECEITA_PARTITION_NAME_FUNCTION}($1::uuid) AS name`,
      [snapshotRunId],
    );
    return rememberPartition(snapshotRunId, resolved.rows[0]?.name);
  };

  const rollbackIfActive = async (): Promise<void> => {
    if (!inTransaction) {
      return;
    }
    inTransaction = false;
    // A rollback that itself fails must not mask the original failure.
    await sql.query('ROLLBACK').catch(() => undefined);
  };

  const promoteAndDemote = async (
    publish: PublishPeriodOperation,
  ): Promise<{ promotedRunId: string; supersededRunId: string | null }> => {
    // 1 — DEMOTE FIRST. `source_snapshot_runs_published_period_uidx` is an ordinary (immediate)
    // unique index, so promoting first would hold two published runs at a statement boundary and
    // be rejected. Readers keep seeing the outgoing run until this transaction COMMITs.
    let supersededRunId: string | null = null;
    if (publish.supersedes !== null) {
      const demoted = await run(
        `
        UPDATE public.${BR_RECEITA_SNAPSHOT_RUNS_TABLE}
           SET publish_state = $2
         WHERE id = $1
           AND publish_state = $3
        RETURNING id
        `,
        [publish.supersedes.snapshot_run_id, publish.supersedes.to, publish.supersedes.from],
      );
      if (demoted.rows.length !== 1) {
        throw new BrReceitaGatewayError('publish_demote_affected_no_run');
      }
      supersededRunId = publish.supersedes.snapshot_run_id;
    }

    // 2 — THEN PROMOTE. Guarded on `from` so a run that is not `preparing` (already published,
    // already failed, belonging to another period) can never be promoted by a stale plan.
    const promoted = await run(
      `
      UPDATE public.${BR_RECEITA_SNAPSHOT_RUNS_TABLE}
         SET publish_state = $2,
             status        = $4,
             completed_at  = now()
       WHERE id = $1
         AND publish_state = $3
         AND source_key    = $5
         AND country_code  = $6
         AND source_period = $7
      RETURNING id
      `,
      [
        publish.snapshot_run_id,
        publish.to,
        publish.from,
        RUN_STATUS_COMPLETED,
        publish.source_key,
        publish.country_code,
        publish.source_period,
      ],
    );
    if (promoted.rows.length !== 1) {
      throw new BrReceitaGatewayError('publish_promote_affected_no_run');
    }

    return { promotedRunId: publish.snapshot_run_id, supersededRunId };
  };

  return {
    async beginPeriodRun(operation: BeginPeriodOperation): Promise<BrReceitaBeginPeriodResult> {
      // 🔴 The REPEATED same-period republish storage preflight, before a single row is written.
      //
      // It runs HERE rather than in an operator script because a check a caller has to remember
      // is a check that protects only the callers who remember it. `beginPeriodRun` is the one
      // door a national load must pass through, so the guard sits in the doorway.
      //
      // It withholds the AUTOMATIC start and nothing else: a period whose repeated republish a
      // human has reviewed is named in `repeatedSamePeriodRepublishStorageReviewedFor`, and the
      // load proceeds. It never deletes a retained superseded run to make room, and it never
      // guesses whether a batch is actively pinned.
      if (!storageReviewedPeriods.has(operation.source_period)) {
        const storage = await checkBrReceitaRepublishStorage(sql, operation.source_period);
        if (storage.code === BR_RECEITA_REPEATED_SAME_PERIOD_REPUBLISH_REVIEW_CODE) {
          throw new BrReceitaGatewayError(
            'repeated_same_period_republish_requires_storage_review',
          );
        }
      }

      // `source_year` is left NULL on the run row: 065 declares it nullable there, and the
      // period is the authority. `status` follows 065's own lifecycle so the pre-existing column
      // keeps meaning what it always meant; `publish_state` is the separate, Brazil-facing one.
      const inserted = await run(
        `
        INSERT INTO public.${BR_RECEITA_SNAPSHOT_RUNS_TABLE}
          (source_key, country_code, source_period, publish_state, status, started_at)
        VALUES ($1, $2, $3, $4, $5, now())
        RETURNING id
        `,
        [
          operation.source_key,
          operation.country_code,
          operation.source_period,
          operation.publish_state,
          RUN_STATUS_RUNNING,
        ],
      );

      const returned = inserted.rows[0]?.id;
      if (returned === undefined || returned === null) {
        throw new BrReceitaGatewayError('begin_period_returned_no_run_id');
      }
      const parsed = parseSnapshotRunId(String(returned));
      if (!parsed.valid) {
        throw new BrReceitaGatewayError('begin_period_returned_malformed_run_id');
      }

      // 🔴 The run's storage is minted here, DETACHED. Until `commitFinalBatchAndPublish` attaches
      // it, its rows are not reachable through the parent at all — a partial month is unreadable
      // because it is not part of the table, not merely because a `publish_state` filter says so.
      // The DDL lives in the migration, in a function; this call passes a uuid and no identifier.
      const partition = await run(
        `SELECT public.${BR_RECEITA_BEGIN_PARTITION_FUNCTION}($1::uuid) AS name`,
        [parsed.runId],
        'begin_period_partition_failed',
      );

      return {
        snapshotRunId: parsed.runId,
        partitionTable: rememberPartition(parsed.runId, partition.rows[0]?.name),
      };
    },

    async discardRunRows(operation: DiscardRunRowsOperation): Promise<BrReceitaDiscardResult> {
      const statement = buildDiscardRunRowsStatement(
        operation,
        await partitionFor(operation.snapshot_run_id),
      );
      const result = await run(statement.sql, statement.params);
      return { deletedRows: result.rows.length };
    },

    async upsertBatch(operation: UpsertBatchOperation): Promise<BrReceitaUpsertResult> {
      if (operation.rows.length === 0) {
        return { writtenRows: 0 };
      }
      const statement = buildUpsertBatchStatement(
        operation,
        await partitionFor(operation.snapshot_run_id),
      );
      const result = await run(statement.sql, statement.params);
      return { writtenRows: result.rows.length };
    },

    async commitFinalBatchAndPublish(
      finalBatch: UpsertBatchOperation | null,
      publish: PublishPeriodOperation,
    ): Promise<BrReceitaPublishResult> {
      const finalBatchPartition = await partitionFor(publish.snapshot_run_id);

      // 🔴 OUTSIDE the transaction, on purpose. Building the read-path index on 72 million rows is
      // the slow step of a national publish, and it touches a DETACHED table no reader can see —
      // so it costs nothing to do it before the transaction and would cost a long-held lock to do
      // it inside. Building it once, by sort, also packs the index at ~78 B/row instead of the
      // ~127 B/row it reaches when grown row-by-row under random-order inserts.
      await run(
        `SELECT public.${BR_RECEITA_BUILD_PARTITION_INDEXES_FUNCTION}($1::uuid)`,
        [publish.snapshot_run_id],
        'publish_partition_index_build_failed',
      );

      await run('BEGIN', []);
      inTransaction = true;
      try {
        let finalBatchRows = 0;
        if (finalBatch !== null && finalBatch.rows.length > 0) {
          const statement = buildUpsertBatchStatement(finalBatch, finalBatchPartition);
          const written = await run(statement.sql, statement.params);
          finalBatchRows = written.rows.length;
        }

        // 🔴 INSIDE the transaction: the month becomes reachable in the same commit that promotes
        // the run. Visibility and publication are one event, so there is no window in which the
        // rows are attached but the run is not published, or the reverse.
        await run(
          `SELECT public.${BR_RECEITA_ATTACH_PARTITION_FUNCTION}($1::uuid)`,
          [publish.snapshot_run_id],
          'publish_partition_attach_failed',
        );

        const { promotedRunId, supersededRunId } = await promoteAndDemote(publish);

        await run('COMMIT', []);
        inTransaction = false;
        return { promotedRunId, supersededRunId, finalBatchRows };
      } catch (error) {
        await rollbackIfActive();
        throw toSafeGatewayFailure(error);
      }
    },

    async failPeriod(
      operation: FailPeriodOperation,
      snapshotRunId: string,
    ): Promise<BrReceitaDiscardResult> {
      await rollbackIfActive();

      // Mark unpublishable FIRST — see the contract note on the interface.
      await run(
        `
        UPDATE public.${BR_RECEITA_SNAPSHOT_RUNS_TABLE}
           SET publish_state = $2,
               status        = $3,
               completed_at  = now()
         WHERE id = $1
           AND publish_state <> 'published'
        `,
        [snapshotRunId, operation.to, RUN_STATUS_FAILED],
      );

      // Then discard ITS rows, run-scoped, through the same statement builder the planned
      // discard uses — there is no second, looser deletion path.
      const statement = buildDiscardRunRowsStatement(
        {
          kind: 'discard_run_rows',
          table: BR_RECEITA_SNAPSHOT_TABLE,
          source_key: operation.source_key,
          country_code: operation.country_code,
          source_period: operation.source_period,
          snapshot_run_id: snapshotRunId,
          onlyWhenRunPublishStateIn: BR_RECEITA_DISCARDABLE_PUBLISH_STATES,
          canDeletePublishedRun: false,
          canDeleteByPeriodAlone: false,
        },
        await partitionFor(snapshotRunId),
      );
      const deleted = await run(statement.sql, statement.params);

      // 🔴 Then remove the storage itself. The DELETE above is what makes `deletedRows` an honest
      // count; this is what stops an abandoned run leaving 27 GB of dead tuples and an orphan
      // partition behind. The guard is in the function: it refuses any run whose period is still a
      // retained publication generation, so a wrong id here removes nothing.
      await run(
        `SELECT public.${BR_RECEITA_DROP_PARTITION_FUNCTION}($1::uuid)`,
        [snapshotRunId],
      ).catch(() => undefined);

      return { deletedRows: deleted.rows.length };
    },
  };
}

/** Re-exported so a caller can assert the predicate it will emit without importing the plan. */
export const BR_RECEITA_GATEWAY_CONFLICT_PREDICATE = BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE;
