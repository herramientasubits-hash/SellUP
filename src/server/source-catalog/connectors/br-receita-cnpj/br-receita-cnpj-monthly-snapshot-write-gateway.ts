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
import { parseSnapshotRunId } from './br-receita-cnpj-monthly-snapshot-run-handle';

/** The run table CUT A's operations name. Re-declared nowhere else in CUT B. */
export const BR_RECEITA_SNAPSHOT_RUNS_TABLE = 'source_snapshot_runs' as const;

/**
 * The columns a Brazil snapshot row is written with — an ALLOWLIST, exactly like the EC SCVS
 * writer's `EC_SCVS_PERSISTABLE_COLUMNS` and for the same reason: the payload is built from this
 * list, so a column that is not on it cannot be written even if a future row shape grows one.
 *
 * 🔴 `tax_id` and `record_identity_key` are ABSENT, deliberately. Omitting them from the INSERT
 * leaves them NULL, which is what migration 127's Brazil CHECK requires — "exactly ONE persisted
 * representation" is enforced by the statement's shape here, by the CHECK in the database, and by
 * the persisted projection's shape in CUT A. Three independent barriers, none of them a comment.
 */
export const BR_RECEITA_PERSISTABLE_COLUMNS = [
  'source_key',
  'country_code',
  'source_year',
  'source_period',
  'snapshot_run_id',
  'normalized_tax_id',
  'legal_name',
  'raw_data',
] as const;

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
 */
function rowBindings(row: BrReceitaRunScopedSnapshotRow): unknown[] {
  return [
    row.identity.source_key,
    row.identity.country_code,
    row.identity.source_year,
    row.identity.source_period,
    row.snapshot_run_id,
    row.identity.normalized_tax_id,
    row.payload.legal_name,
    JSON.stringify(row.payload.raw_data),
  ];
}

/**
 * The upsert statement for one batch, built FROM the operation.
 *
 * The conflict target and its index predicate are read off `operation`, not re-derived here, so
 * the arbiter Postgres infers is the one CUT A recorded and the one migration 127 created. The
 * predicate is mandatory: `source_company_snapshots_br_period_identity_uidx` is PARTIAL, and a
 * bare `ON CONFLICT (…)` does not match a partial index — Postgres raises 42P10 rather than
 * silently inserting duplicates, which is safe but broken.
 */
export function buildUpsertBatchStatement(operation: UpsertBatchOperation): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  assertSafeIdentifiers(operation.conflictColumns);

  const columns = BR_RECEITA_PERSISTABLE_COLUMNS;
  const params: unknown[] = [];
  for (const row of operation.rows) {
    params.push(...rowBindings(row));
  }

  // Only the payload is refreshed on conflict. The five identity columns are the conflict target
  // itself, so re-assigning them would be a no-op that reads as if a row could change identity.
  const sql = `
    INSERT INTO public.${BR_RECEITA_SNAPSHOT_TABLE} (${columns.join(', ')})
    VALUES ${valuesPlaceholders(operation.rows.length, columns.length)}
    ON CONFLICT (${operation.conflictColumns.join(', ')})
      WHERE ${operation.conflictIndexPredicate}
    DO UPDATE SET
      source_year = EXCLUDED.source_year,
      legal_name  = EXCLUDED.legal_name,
      raw_data    = EXCLUDED.raw_data
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
export function buildDiscardRunRowsStatement(operation: DiscardRunRowsOperation): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  const sql = `
    DELETE FROM public.${BR_RECEITA_SNAPSHOT_TABLE} AS snapshots
     WHERE snapshots.source_key      = $1
       AND snapshots.country_code    = $2
       AND snapshots.source_period   = $3
       AND snapshots.snapshot_run_id = $4
       AND EXISTS (
             SELECT 1
               FROM public.${BR_RECEITA_SNAPSHOT_RUNS_TABLE} AS runs
              WHERE runs.id = snapshots.snapshot_run_id
                AND runs.publish_state = ANY($5::text[])
           )
    RETURNING 1 AS deleted
  `;
  return {
    sql,
    params: [
      operation.source_key,
      operation.country_code,
      operation.source_period,
      operation.snapshot_run_id,
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
export function createBrReceitaSqlWriteGateway(
  sql: BrReceitaSqlExecutor,
): BrReceitaSnapshotWriteGateway {
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
      return { snapshotRunId: parsed.runId };
    },

    async discardRunRows(operation: DiscardRunRowsOperation): Promise<BrReceitaDiscardResult> {
      const statement = buildDiscardRunRowsStatement(operation);
      const result = await run(statement.sql, statement.params);
      return { deletedRows: result.rows.length };
    },

    async upsertBatch(operation: UpsertBatchOperation): Promise<BrReceitaUpsertResult> {
      if (operation.rows.length === 0) {
        return { writtenRows: 0 };
      }
      const statement = buildUpsertBatchStatement(operation);
      const result = await run(statement.sql, statement.params);
      return { writtenRows: result.rows.length };
    },

    async commitFinalBatchAndPublish(
      finalBatch: UpsertBatchOperation | null,
      publish: PublishPeriodOperation,
    ): Promise<BrReceitaPublishResult> {
      await run('BEGIN', []);
      inTransaction = true;
      try {
        let finalBatchRows = 0;
        if (finalBatch !== null && finalBatch.rows.length > 0) {
          const statement = buildUpsertBatchStatement(finalBatch);
          const written = await run(statement.sql, statement.params);
          finalBatchRows = written.rows.length;
        }

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
      const statement = buildDiscardRunRowsStatement({
        kind: 'discard_run_rows',
        table: BR_RECEITA_SNAPSHOT_TABLE,
        source_key: operation.source_key,
        country_code: operation.country_code,
        source_period: operation.source_period,
        snapshot_run_id: snapshotRunId,
        onlyWhenRunPublishStateIn: BR_RECEITA_DISCARDABLE_PUBLISH_STATES,
        canDeletePublishedRun: false,
        canDeleteByPeriodAlone: false,
      });
      const deleted = await run(statement.sql, statement.params);
      return { deletedRows: deleted.rows.length };
    },
  };
}

/** Re-exported so a caller can assert the predicate it will emit without importing the plan. */
export const BR_RECEITA_GATEWAY_CONFLICT_PREDICATE = BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE;
