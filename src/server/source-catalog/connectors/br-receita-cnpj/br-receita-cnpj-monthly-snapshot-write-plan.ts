/**
 * BR Receita CNPJ — monthly snapshot write/publish PLAN.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-A — monthly Receita snapshot identity foundation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE WRITES NOTHING. No Supabase client, no filesystem, no network,
 * no provider, no env, no clock, no randomness.
 * CUT B executes the plan; CUT A only defines it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a plan and not a writer ─────────────────────────────────────────────
 *
 * The hard part of a monthly snapshot is not the INSERT — it is the ordering guarantees around it:
 * a partial month must never be readable, a failed build must never displace the previous month,
 * and a replay must be a no-op. Those are properties of a SEQUENCE. Expressing the sequence as
 * data makes it testable without a database, and makes CUT B's executor a dumb loop over
 * operations rather than the place where the invariants live.
 *
 * ── 🔴 The plan is a STREAM, not a document ─────────────────────────────────
 *
 * Brazil's monthly file is national: tens of millions of establishments. So the planner is not
 * allowed to hold the period, and specifically not allowed to hold anything proportional to it —
 * not an accepted array, not an operations array carrying every row, and above all not a
 * period-wide identity Map. Planner-owned memory is **O(BATCH_SIZE)**, and that is a property of
 * the code rather than an aspiration:
 *
 *   · `planBrReceitaMonthlySnapshotWrite` consumes **ZERO** rows. It validates the period, mints
 *     the run handle, and returns. The input iterable is not touched.
 *   · `plan.operations()` is an async GENERATOR. `begin_period` and the run-scoped reset are
 *     yielded before a single row is pulled.
 *   · each `upsert_batch` is built in a buffer capped at `batchSize` and released when it is
 *     yielded. Two consecutive batches never coexist.
 *   · the only lookup structure is a per-batch dedup Map that is DISCARDED at every batch
 *     boundary, so its size is bounded by `batchSize` and not by the nation.
 *
 * Both a synchronous and an asynchronous producer work unchanged — the generator consumes
 * `Iterable` and `AsyncIterable` through the same `for await`.
 *
 * ── Duplicate collapse is deliberately BOUNDED, and says so ─────────────────
 *
 * Collapsing duplicates across the WHOLE period would require remembering every identity in the
 * nation — precisely the O(NATIONAL_ROWS) structure this cut removes. So the guarantee is stated at
 * the grain it can actually be delivered at:
 *
 *   · WITHIN one batch — exact. The same identity twice in one batch collapses deterministically
 *     (last occurrence wins, at the position of the first sighting), or the period is refused if
 *     the caller asked for `'reject'`.
 *   · ACROSS batches — delegated to the database. Two batches carrying the same identity both
 *     upsert against the run-scoped unique index, so the later batch wins. Deterministic, because
 *     batch order is the producer's order.
 *
 * 🔴 There is NO period-wide `collapsedDuplicateCount` and no period-wide duplicate mode. A count
 * that claimed to be exact for the period would be a lie that only shows up at national scale;
 * `collapsedInBatchCount` is per-batch, exact, and honest about its grain.
 *
 * ── The publish state machine ───────────────────────────────────────────────
 *
 *   preparing ──► published ──► superseded
 *       │
 *       └──────► failed / rolled_back
 *
 * Reusing the EXISTING `source_snapshot_runs` table (migration 065) rather than inventing a second
 * publication system. `publish_state` is a separate column from the pre-existing `status`, so no
 * other source's run lifecycle changes meaning.
 *
 * ── 🔴 Rows belong to a RUN, not to a period ────────────────────────────────
 *
 * The defect the run dimension closes: a rebuild of period P used to write into the SAME rows the
 * readers were reading. There was no way to stage P a second time — the reset deleted the month, and
 * every upsert mutated the live copy. A failure mid-rebuild left the month damaged.
 *
 * With `snapshot_run_id`, run A (published, 2026-07) and run B (preparing, 2026-07) coexist
 * PHYSICALLY. B's upserts cannot touch A's rows, because the conflict target includes the run. While
 * B loads, readers still see 100% of A. The cutover is ONE transaction that demotes A and promotes
 * B — in that order, because migration 125's published-per-period unique index is immediate, so
 * promoting first would collide with A. Before the commit a reader sees A; after it, B; never a
 * mixture. If B fails, A was never touched.
 *
 * 🔴 `snapshot_run_id` is a PUBLICATION identifier. It is never derived from a CNPJ and it is NOT a
 * second identity representation — the one persisted exact CNPJ representation remains
 * `normalized_tax_id`, alone (GATE-4 sub-decision 4A).
 */

import {
  brReceitaLogicalSnapshotIdentity,
  BR_RECEITA_PERIOD_EXACT_LOOKUP_COLUMNS,
  BR_RECEITA_SNAPSHOT_TABLE,
  type BrReceitaPersistedSnapshot,
} from './br-receita-cnpj-monthly-snapshot-identity';
import {
  createSnapshotRunHandle,
  SNAPSHOT_RUN_ID_COLUMN,
  type SnapshotRunHandle,
} from './br-receita-cnpj-monthly-snapshot-run-handle';
import { BR_RECEITA_CNPJ_SOURCE_KEY, BR_RECEITA_CNPJ_COUNTRY_CODE } from './br-receita-cnpj-types';
import { parseSourcePeriod } from '../../source-period';

/**
 * Rows per write operation. Reused from the EC SCVS snapshot writer's `DEFAULT_BATCH_SIZE`, which
 * is the established cap for this table. 🔴 Not a new resource cap and not a raised one.
 *
 * This is now also the planner's MEMORY bound, not merely its statement size.
 */
export const BR_RECEITA_SNAPSHOT_BATCH_ROWS = 500 as const;

/**
 * The RUN-SCOPED conflict target, matching migration 125's
 * `source_company_snapshots_br_period_identity_uidx`.
 *
 * 🔴 Five columns, not four. The run is part of the physical key, which is the whole reason a
 * staging rebuild cannot overwrite the published copy. A four-column (period-only) target would
 * make run B's upserts land on run A's rows — the exact defect this cut closes — so the two lists
 * are deliberately DIFFERENT things and neither is an alias of the other:
 *
 *   · physical write key  → this list, run-scoped
 *   · logical read key    → `BR_RECEITA_PERIOD_EXACT_LOOKUP_COLUMNS`, valid only INSIDE one
 *                           published run
 */
export const BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS: readonly string[] = [
  'source_key',
  'country_code',
  'source_period',
  SNAPSHOT_RUN_ID_COLUMN,
  'normalized_tax_id',
] as const;

/**
 * The `WHERE` clause an upsert must restate for Postgres to infer index 4b as its arbiter.
 *
 * 🔴 Not decoration. `source_company_snapshots_br_period_identity_uidx` is a PARTIAL unique index,
 * and Postgres infers an arbiter from the column list PLUS the predicate. A bare
 * `ON CONFLICT (five, columns)` does not match a partial index and raises "there is no unique or
 * exclusion constraint matching the ON CONFLICT specification" — a hard error rather than a silent
 * insert, which is the safe direction, but still a broken executor. Recorded here so CUT B emits it
 * by construction; the CUT-A suite asserts this string appears verbatim in migration 125.
 */
export const BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE =
  "source_key = 'br_receita_cnpj_dados_abertos'" as const;

/**
 * The logical identity of a snapshot INSIDE one published run. Retained because it is what the
 * period-aware reader resolves an establishment by once the run is fixed.
 *
 * 🔴 Not the write conflict target. See `BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS`.
 */
export const BR_RECEITA_PERIOD_LOGICAL_IDENTITY_COLUMNS = BR_RECEITA_PERIOD_EXACT_LOOKUP_COLUMNS;

/** The publish lifecycle of one run. Mirrors migration 125's CHECK constraint exactly. */
export const BR_RECEITA_SNAPSHOT_PUBLISH_STATES = [
  'preparing',
  'published',
  'superseded',
  'failed',
  'rolled_back',
] as const;

export type BrReceitaSnapshotPublishState = (typeof BR_RECEITA_SNAPSHOT_PUBLISH_STATES)[number];

/** The states a run's rows may be DISCARDED in. Never `published`. */
export const BR_RECEITA_DISCARDABLE_PUBLISH_STATES: readonly BrReceitaSnapshotPublishState[] = [
  'preparing',
  'failed',
  'rolled_back',
] as const;

// ─── The row a batch actually carries ───────────────────────────────────────

/**
 * A persisted snapshot stamped with the run it belongs to.
 *
 * The parser produces `BrReceitaPersistedSnapshot`, which has no run — it cannot, because the run
 * id is minted by the database at `begin_period`. Stamping happens HERE, at the write boundary, from
 * the resolved handle. A row therefore cannot exist in a batch without a run.
 */
export interface BrReceitaRunScopedSnapshotRow {
  readonly identity: BrReceitaPersistedSnapshot['identity'];
  /** 🔴 Publication version. Not identity, never CNPJ-derived. */
  readonly snapshot_run_id: string;
  readonly payload: BrReceitaPersistedSnapshot['payload'];
}

// ─── The operations CUT B will execute ──────────────────────────────────────

/**
 * Claims a NEW run for the period and marks it `preparing`.
 *
 * 🔴 The executor must feed the id the database returned back into `runHandle.resolve(...)`. Until
 * it does, no batch is obtainable — that is enforced at runtime, not documented.
 */
export interface BeginPeriodOperation {
  readonly kind: 'begin_period';
  readonly table: 'source_snapshot_runs';
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  readonly publish_state: 'preparing';
  /** The database mints `source_snapshot_runs.id`; the plan never invents one. */
  readonly returnsRunId: true;
  readonly resolvesRunHandle: true;
}

/**
 * Clears rows belonging to ONE unpublished run, by run id.
 *
 * 🔴 Why this replaced the period-scoped reset. The old operation deleted every row for the
 * PERIOD. Once a published run and a staging run share a period, that predicate deletes the
 * published month in order to rebuild it — destroying exactly what the run dimension exists to
 * protect. Cleanup is now scoped to a run and refuses a published one.
 *
 * 🔴 It can never target a `published` run: `onlyWhenRunPublishStateIn` excludes it, and the
 * operation carries no period-only fallback predicate.
 */
export interface DiscardRunRowsOperation {
  readonly kind: 'discard_run_rows';
  readonly table: typeof BR_RECEITA_SNAPSHOT_TABLE;
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  /** The ONLY scope. There is no period-wide variant of this operation. */
  readonly snapshot_run_id: string;
  readonly onlyWhenRunPublishStateIn: readonly BrReceitaSnapshotPublishState[];
  readonly canDeletePublishedRun: false;
  readonly canDeleteByPeriodAlone: false;
}

/** One bounded batch of rows for the run being built. */
export interface UpsertBatchOperation {
  readonly kind: 'upsert_batch';
  readonly table: typeof BR_RECEITA_SNAPSHOT_TABLE;
  readonly batchIndex: number;
  /** The run every row in this batch belongs to. Never absent. */
  readonly snapshot_run_id: string;
  readonly rows: readonly BrReceitaRunScopedSnapshotRow[];
  /**
   * The identity columns that resolve a conflict. RUN-scoped, matching migration 125's
   * `source_company_snapshots_br_period_identity_uidx`.
   *
   * 🔴 Deliberately NOT `RECORD_IDENTITY_ON_CONFLICT` nor `OLD_TAX_GRAIN_ON_CONFLICT`: both are
   * `source_year`-scoped, and a year-scoped conflict target is exactly how month N+1 would
   * overwrite month N. And deliberately not period-scoped either, which is how staging run B would
   * overwrite published run A.
   */
  readonly conflictColumns: readonly string[];
  /**
   * The predicate the upsert must restate so Postgres can infer the PARTIAL index 4b as arbiter.
   * Omitting it makes the statement fail outright rather than silently insert duplicates.
   */
  readonly conflictIndexPredicate: typeof BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE;
  /** Exact for THIS batch. 🔴 Never a period-wide figure — see the module header. */
  readonly collapsedInBatchCount: number;
}

/** Demotes the previously published run of this period. The first half of the cutover. */
export interface SupersedeRunStep {
  readonly snapshot_run_id: string;
  readonly from: 'published';
  readonly to: 'superseded';
}

/** Makes the new run visible. The single atomic transition. */
export interface PublishPeriodOperation {
  readonly kind: 'publish_period';
  readonly table: 'source_snapshot_runs';
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  /** The run being promoted. */
  readonly snapshot_run_id: string;
  readonly from: 'preparing';
  readonly to: 'published';
  /** The run being retired, when this period already had one. `null` on a first build. */
  readonly supersedes: SupersedeRunStep | null;
  /**
   * 🔴 Demote BEFORE promote, and not as a style preference. Migration 125's
   * `source_snapshot_runs_published_period_uidx` is an ordinary (immediate) unique index, so a
   * transaction that promoted B while A was still `published` would violate it at that statement.
   * Demoting first means the transaction never holds two published runs at a statement boundary,
   * while outside readers still see A until the COMMIT flips both at once.
   */
  readonly transitionOrder: readonly ['demote_superseded_run', 'promote_preparing_run'];
  /**
   * 🔴 The transition and the last batch must commit together, or a crash between them leaves a
   * complete-but-invisible run (recoverable) or an incomplete-but-visible one (not). Only the
   * second is a correctness failure, so the contract requires the publish to be the final statement
   * of the same transaction.
   */
  readonly mustCommitWithFinalBatch: true;
  readonly readerSeesPreviousRunUntilCommit: true;
}

/**
 * Terminal failure. The run stays unreadable and the previously published run is untouched — it was
 * never demoted, because the demotion is inside the publish transaction that did not happen.
 */
export interface FailPeriodOperation {
  readonly kind: 'fail_period';
  readonly table: 'source_snapshot_runs';
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  readonly to: 'failed' | 'rolled_back';
  readonly leavesPreviousPublishedRunIntact: true;
  /** Cleanup of the abandoned run's rows is run-scoped, by construction. */
  readonly cleanupIsRunScoped: true;
}

export type BrReceitaSnapshotWriteOperation =
  | BeginPeriodOperation
  | DiscardRunRowsOperation
  | UpsertBatchOperation
  | PublishPeriodOperation;

// ─── Failures ───────────────────────────────────────────────────────────────

export type BrReceitaSnapshotPlanRejectionReason =
  | 'source_period_missing_or_malformed'
  | 'superseded_run_id_malformed';

export type BrReceitaSnapshotStreamFailureReason =
  | 'record_period_mismatch'
  | 'duplicate_identity_in_batch'
  | 'empty_period';

export interface BrReceitaSnapshotPlanRejection {
  readonly reason: BrReceitaSnapshotPlanRejectionReason;
  /**
   * 🔴 An ORDINAL, never an identifier. `null` when the rejection is about the period as a whole.
   * A rejection that echoed the offending CNPJ would be the leak this whole line of work prevents.
   */
  readonly recordIndex: number | null;
}

/**
 * Thrown DURING iteration, because per-record problems are only discoverable while streaming.
 *
 * 🔴 Throwing rather than yielding a failure operation is load-bearing: an exception aborts the
 * executor's transaction, so `publish_period` becomes unreachable. A yielded failure would leave the
 * executor free to carry on to the publish.
 *
 * 🔴 Carries an ORDINAL only. No CNPJ, no legal name, no row payload.
 */
export class BrReceitaSnapshotStreamError extends Error {
  readonly reason: BrReceitaSnapshotStreamFailureReason;
  readonly recordIndex: number | null;

  constructor(reason: BrReceitaSnapshotStreamFailureReason, recordIndex: number | null) {
    super(
      `br receita monthly snapshot stream refused the period (${reason})${
        recordIndex === null ? '' : ` at record ordinal ${recordIndex}`
      }`,
    );
    this.name = 'BrReceitaSnapshotStreamError';
    this.reason = reason;
    this.recordIndex = recordIndex;
  }
}

// ─── Plan result ────────────────────────────────────────────────────────────

/**
 * What the caller gets back on success.
 *
 * 🔴 Non-sensitive internal control facts only. A period, a batch size, a handle, a set of
 * invariants — no CNPJ, no legal name, no row payload, and no period-wide count (which could not be
 * produced without the memory this cut removes). GATE-5's projection stays unimplemented and this
 * summary is not a back door into it.
 */
export interface BrReceitaSnapshotWritePlan {
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  /**
   * The run token. Unresolved until the executor reports what `begin_period` returned.
   *
   * 🔴 The plan does NOT contain a run id, because at plan time there is none. A plan that carried
   * one would have had to invent it.
   */
  readonly runHandle: SnapshotRunHandle;
  /**
   * The whole ordered sequence, LAZILY:
   *
   *   begin_period → discard_run_rows → upsert_batch* → publish_period
   *
   * `publish_period` is unconditionally LAST and is unreachable on any failure path, because the
   * failure paths throw. Calling this function consumes ZERO rows; rows are pulled only as batches
   * are requested.
   */
  operations(): AsyncGenerator<BrReceitaSnapshotWriteOperation, void, undefined>;
  readonly onFailure: FailPeriodOperation;
  readonly batchSize: number;
  /** Invariants this plan asserts about itself, so a caller can assert on them too. */
  readonly writesNothing: true;
  readonly partialPeriodVisible: false;
  readonly crossPeriodOverwritePossible: false;
  readonly crossRunOverwritePossible: false;
  readonly plannerMemoryBound: 'O(BATCH_SIZE)';
  readonly retainsWholePeriodInMemory: false;
}

export type BrReceitaSnapshotWritePlanResult =
  | { readonly status: 'planned'; readonly plan: BrReceitaSnapshotWritePlan }
  | {
      readonly status: 'rejected';
      readonly rejections: readonly BrReceitaSnapshotPlanRejection[];
    };

export interface BrReceitaSnapshotWritePlanInput {
  readonly sourcePeriod: string;
  /**
   * A lazy producer. Either kind works and neither is materialised: the generator pulls one record
   * at a time.
   */
  readonly records: Iterable<BrReceitaPersistedSnapshot> | AsyncIterable<BrReceitaPersistedSnapshot>;
  /**
   * The run currently published for this period, when there is one, so the publish transaction can
   * demote it in the same commit that promotes this build.
   *
   * 🔴 Supplied EXPLICITLY by a caller that resolved it. Never inferred from ambient state, and
   * never defaulted to "whatever is published" at execution time.
   */
  readonly supersedesPublishedRunId?: string;
  /**
   * Duplicate policy for the same identity appearing twice WITHIN ONE BATCH.
   *
   * 🔴 Scoped to a batch, deliberately. `'collapse_last_wins'` keeps the last occurrence, which is
   * what an upsert against the run-scoped unique index would do anyway — so the plan states it
   * instead of letting the database decide silently. `'reject'` refuses the period. Across batches
   * the database's conflict semantics decide, and later-upsert-wins is deterministic because batch
   * order is the producer's order.
   */
  readonly onDuplicateIdentityInBatch?: 'collapse_last_wins' | 'reject';
  readonly batchSize?: number;
}

// ─── The planner ────────────────────────────────────────────────────────────

/**
 * Builds the bounded, RUN-SCOPED, STREAMING write/publish plan for ONE period. PURE.
 *
 * 🔴 Consumes ZERO records. It validates the period, mints an unresolved run handle and returns.
 * `input.records` is not iterated, not counted and not touched — a caller may hand it a producer
 * that has not opened its file yet.
 */
export function planBrReceitaMonthlySnapshotWrite(
  input: BrReceitaSnapshotWritePlanInput,
): BrReceitaSnapshotWritePlanResult {
  const parsedPeriod = parseSourcePeriod(input.sourcePeriod);
  if (!parsedPeriod.valid) {
    return {
      status: 'rejected',
      rejections: [{ reason: 'source_period_missing_or_malformed', recordIndex: null }],
    };
  }
  const sourcePeriod = parsedPeriod.sourcePeriod;

  const supersedesRunId = input.supersedesPublishedRunId;
  if (supersedesRunId !== undefined && !isCanonicalUuid(supersedesRunId)) {
    return {
      status: 'rejected',
      rejections: [{ reason: 'superseded_run_id_malformed', recordIndex: null }],
    };
  }

  const duplicatePolicy = input.onDuplicateIdentityInBatch ?? 'collapse_last_wins';
  const batchSize =
    input.batchSize !== undefined && Number.isInteger(input.batchSize) && input.batchSize > 0
      ? Math.min(input.batchSize, BR_RECEITA_SNAPSHOT_BATCH_ROWS)
      : BR_RECEITA_SNAPSHOT_BATCH_ROWS;

  const periodCoordinates = {
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
    source_period: sourcePeriod,
  } as const;

  const runHandle = createSnapshotRunHandle();

  return {
    status: 'planned',
    plan: {
      ...periodCoordinates,
      runHandle,
      operations: () =>
        streamOperations({
          periodCoordinates,
          runHandle,
          records: input.records,
          batchSize,
          duplicatePolicy,
          supersedesRunId,
        }),
      onFailure: {
        kind: 'fail_period',
        table: 'source_snapshot_runs',
        ...periodCoordinates,
        to: 'failed',
        leavesPreviousPublishedRunIntact: true,
        cleanupIsRunScoped: true,
      },
      batchSize,
      writesNothing: true,
      partialPeriodVisible: false,
      crossPeriodOverwritePossible: false,
      crossRunOverwritePossible: false,
      plannerMemoryBound: 'O(BATCH_SIZE)',
      retainsWholePeriodInMemory: false,
    },
  };
}

/**
 * Plans the run-scoped cleanup of an abandoned build, independently of any new build.
 *
 * 🔴 Exists so "discard a failed rebuild" is expressible WITHOUT a period-wide delete. It takes a
 * run id and refuses a published run; there is no overload that takes a period.
 */
export function planBrReceitaSnapshotRunDiscard(args: {
  readonly sourcePeriod: string;
  readonly snapshotRunId: string;
}):
  | { readonly status: 'planned'; readonly operation: DiscardRunRowsOperation }
  | { readonly status: 'rejected'; readonly rejections: readonly BrReceitaSnapshotPlanRejection[] } {
  const parsedPeriod = parseSourcePeriod(args.sourcePeriod);
  if (!parsedPeriod.valid) {
    return {
      status: 'rejected',
      rejections: [{ reason: 'source_period_missing_or_malformed', recordIndex: null }],
    };
  }
  if (!isCanonicalUuid(args.snapshotRunId)) {
    return {
      status: 'rejected',
      rejections: [{ reason: 'superseded_run_id_malformed', recordIndex: null }],
    };
  }
  return {
    status: 'planned',
    operation: discardRunRowsOperation(
      {
        source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
        country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
        source_period: parsedPeriod.sourcePeriod,
      },
      args.snapshotRunId,
    ),
  };
}

// ─── The stream ─────────────────────────────────────────────────────────────

interface PeriodCoordinates {
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
}

function discardRunRowsOperation(
  periodCoordinates: PeriodCoordinates,
  snapshotRunId: string,
): DiscardRunRowsOperation {
  return {
    kind: 'discard_run_rows',
    table: BR_RECEITA_SNAPSHOT_TABLE,
    ...periodCoordinates,
    snapshot_run_id: snapshotRunId,
    onlyWhenRunPublishStateIn: BR_RECEITA_DISCARDABLE_PUBLISH_STATES,
    canDeletePublishedRun: false,
    canDeleteByPeriodAlone: false,
  };
}

/**
 * The ordered, lazy operation stream.
 *
 * Memory held by this generator at any instant: the `buffer` array and the `positionByIdentity`
 * Map, both capped at `batchSize`, plus a handful of scalars. Nothing accumulates across batches —
 * both structures are replaced at every boundary, so the previous batch becomes collectable the
 * moment it is yielded.
 */
async function* streamOperations(args: {
  readonly periodCoordinates: PeriodCoordinates;
  readonly runHandle: SnapshotRunHandle;
  readonly records:
    | Iterable<BrReceitaPersistedSnapshot>
    | AsyncIterable<BrReceitaPersistedSnapshot>;
  readonly batchSize: number;
  readonly duplicatePolicy: 'collapse_last_wins' | 'reject';
  readonly supersedesRunId: string | undefined;
}): AsyncGenerator<BrReceitaSnapshotWriteOperation, void, undefined> {
  const { periodCoordinates, runHandle, batchSize, duplicatePolicy, supersedesRunId } = args;

  // ── Header. Zero rows consumed. ──
  yield {
    kind: 'begin_period',
    table: 'source_snapshot_runs',
    ...periodCoordinates,
    publish_state: 'preparing',
    returnsRunId: true,
    resolvesRunHandle: true,
  };

  // 🔴 The first thing after `begin_period` is the demand for its run id. Everything downstream —
  // the reset, every batch, the publish — is scoped by it, so an executor that ignored the id
  // cannot proceed past this line.
  const snapshotRunId = runHandle.require();

  // Idempotent restart of THIS run. Run-scoped: it cannot see, let alone delete, the published run.
  yield discardRunRowsOperation(periodCoordinates, snapshotRunId);

  let batchIndex = 0;
  let emittedRowCount = 0;
  let recordIndex = -1;
  let buffer: BrReceitaRunScopedSnapshotRow[] = [];
  let positionByIdentity = new Map<string, number>();
  let collapsedInBatchCount = 0;

  for await (const record of args.records) {
    recordIndex += 1;

    if (record.identity.source_period !== periodCoordinates.source_period) {
      // A record from another month inside this period's build. Never silently re-labelled: that
      // would be the cross-period overwrite the identity model exists to prevent.
      throw new BrReceitaSnapshotStreamError('record_period_mismatch', recordIndex);
    }

    const logicalIdentity = brReceitaLogicalSnapshotIdentity(record.identity);
    const seenAt = positionByIdentity.get(logicalIdentity);

    if (seenAt !== undefined) {
      if (duplicatePolicy === 'reject') {
        throw new BrReceitaSnapshotStreamError('duplicate_identity_in_batch', recordIndex);
      }
      // Last occurrence wins, at the position of the first sighting: a stable order makes the
      // batch deterministic across replays.
      buffer[seenAt] = stampRow(record, snapshotRunId);
      collapsedInBatchCount += 1;
      continue;
    }

    positionByIdentity.set(logicalIdentity, buffer.length);
    buffer.push(stampRow(record, snapshotRunId));

    if (buffer.length >= batchSize) {
      yield upsertBatchOperation(batchIndex, snapshotRunId, buffer, collapsedInBatchCount);
      emittedRowCount += buffer.length;
      batchIndex += 1;
      // 🔴 Released, not cleared in place: the yielded batch keeps the array it was given, so a new
      // one is allocated and the old becomes collectable. Two batches never coexist here.
      buffer = [];
      positionByIdentity = new Map<string, number>();
      collapsedInBatchCount = 0;
    }
  }

  if (buffer.length > 0) {
    yield upsertBatchOperation(batchIndex, snapshotRunId, buffer, collapsedInBatchCount);
    emittedRowCount += buffer.length;
    buffer = [];
    positionByIdentity = new Map<string, number>();
  }

  if (emittedRowCount === 0) {
    // An empty period is refused rather than published as an empty month: publishing it would make
    // the period visible as complete while containing nothing, which is the same class of lie as
    // publishing a partial one. Throwing here means `publish_period` is never reached.
    throw new BrReceitaSnapshotStreamError('empty_period', null);
  }

  yield {
    kind: 'publish_period',
    table: 'source_snapshot_runs',
    ...periodCoordinates,
    snapshot_run_id: snapshotRunId,
    from: 'preparing',
    to: 'published',
    supersedes:
      supersedesRunId === undefined
        ? null
        : { snapshot_run_id: supersedesRunId, from: 'published', to: 'superseded' },
    transitionOrder: ['demote_superseded_run', 'promote_preparing_run'],
    mustCommitWithFinalBatch: true,
    readerSeesPreviousRunUntilCommit: true,
  };
}

function stampRow(
  record: BrReceitaPersistedSnapshot,
  snapshotRunId: string,
): BrReceitaRunScopedSnapshotRow {
  return {
    identity: record.identity,
    snapshot_run_id: snapshotRunId,
    payload: record.payload,
  };
}

function upsertBatchOperation(
  batchIndex: number,
  snapshotRunId: string,
  rows: readonly BrReceitaRunScopedSnapshotRow[],
  collapsedInBatchCount: number,
): UpsertBatchOperation {
  return {
    kind: 'upsert_batch',
    table: BR_RECEITA_SNAPSHOT_TABLE,
    batchIndex,
    snapshot_run_id: snapshotRunId,
    rows,
    conflictColumns: BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
    conflictIndexPredicate: BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
    collapsedInBatchCount,
  };
}

/**
 * Shape check for a run id supplied by a CALLER (as opposed to one resolved through the handle,
 * which validates on its own). Local and deliberately not re-exported: the handle module owns the
 * pattern.
 */
function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
