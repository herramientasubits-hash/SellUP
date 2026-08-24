/**
 * BR Receita CNPJ — monthly snapshot write/publish PLAN.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-A — monthly Receita snapshot identity foundation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE WRITES NOTHING. It is a pure function from records to a bounded
 * plan. No Supabase client, no filesystem, no network, no provider, no env.
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
 * ── The publish state machine ───────────────────────────────────────────────
 *
 *   preparing ──► published        the whole period becomes visible, atomically
 *       │
 *       └──────► failed / rolled_back
 *
 * Reusing the EXISTING `source_snapshot_runs` table (migration 065) rather than inventing a second
 * publication system. `publish_state` is a separate column from the pre-existing `status`, so no
 * other source's run lifecycle changes meaning.
 *
 * The visibility rule is one sentence: a period is readable only while a run for it is
 * `published`, and migration 125's partial unique index allows at most ONE published run per
 * (source, country, period). So:
 *
 *   · a period under construction is `preparing`  → invisible (§ E, § 19)
 *   · a failed build stays `failed`               → can never become published (§ 20)
 *   · publishing month N+1 does not touch month N → the previous period survives (§ D, § 21)
 *   · cross-period overwrite is impossible        → identity includes the period (§ F)
 *
 * ── Bounded batches, never a national array ─────────────────────────────────
 *
 * 🔴 The plan NEVER holds the nation in one array. `planBrReceitaMonthlySnapshotWrite` accepts an
 * ITERABLE and emits fixed-size batch operations, so a streaming producer works unchanged. The cap
 * is `BR_RECEITA_SNAPSHOT_BATCH_ROWS`, reused from the sibling EC SCVS writer's
 * `DEFAULT_BATCH_SIZE` rather than invented here. CUT A's tests use synthetic arrays because an
 * array is also an iterable — that is a test convenience, not the contract.
 */

import {
  brReceitaLogicalSnapshotIdentity,
  BR_RECEITA_PERIOD_EXACT_LOOKUP_COLUMNS,
  BR_RECEITA_SNAPSHOT_TABLE,
  type BrReceitaPersistedSnapshot,
} from './br-receita-cnpj-monthly-snapshot-identity';
import { BR_RECEITA_CNPJ_SOURCE_KEY, BR_RECEITA_CNPJ_COUNTRY_CODE } from './br-receita-cnpj-types';
import { parseSourcePeriod } from '../../source-period';

/**
 * Rows per write operation. Reused from the EC SCVS snapshot writer's `DEFAULT_BATCH_SIZE`, which
 * is the established cap for this table. 🔴 Not a new resource cap and not a raised one.
 */
export const BR_RECEITA_SNAPSHOT_BATCH_ROWS = 500 as const;

/**
 * The period-aware conflict target, matching migration 125's
 * `source_company_snapshots_br_period_identity_uidx`.
 *
 * 🔴 An ALIAS of the identity module's lookup columns, not a copy. The columns that resolve a write
 * conflict and the columns that resolve an exact read are the same four by definition — if they
 * ever diverged, a row would be findable by one key and overwritten by another.
 */
export const BR_RECEITA_PERIOD_CONFLICT_COLUMNS = BR_RECEITA_PERIOD_EXACT_LOOKUP_COLUMNS;

/** The publish lifecycle of one period. Mirrors migration 125's CHECK constraint exactly. */
export const BR_RECEITA_SNAPSHOT_PUBLISH_STATES = [
  'preparing',
  'published',
  'failed',
  'rolled_back',
] as const;

export type BrReceitaSnapshotPublishState = (typeof BR_RECEITA_SNAPSHOT_PUBLISH_STATES)[number];

// ─── The operations CUT B will execute ──────────────────────────────────────

/**
 * Claims the period and marks it `preparing`. Nothing about this period is readable from here on
 * until `publish_period` succeeds.
 */
export interface BeginPeriodOperation {
  readonly kind: 'begin_period';
  readonly table: 'source_snapshot_runs';
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  readonly publish_state: 'preparing';
}

/**
 * Clears rows left behind by an earlier UNPUBLISHED attempt at this same period, before rebuilding
 * it.
 *
 * 🔴 Why this operation has to exist. A period is superseded AS A WHOLE, never row by row. If a
 * previous attempt at period P died halfway, its rows are still there; the retry is idempotent per
 * identity, so it would update the ones it produces again — but a row the earlier attempt wrote and
 * the retry no longer produces (an establishment dropped from that month's file) would survive and
 * be published as part of a month it is not in. Deleting the unpublished remnant first is what makes
 * "the period is the unit of replacement" true rather than aspirational.
 *
 * 🔴 It is scoped to an UNPUBLISHED period, and only ever the period being built. It can never
 * touch a published period, which is what makes cross-period overwrite structurally impossible.
 */
export interface ResetUnpublishedPeriodOperation {
  readonly kind: 'reset_unpublished_period';
  readonly table: typeof BR_RECEITA_SNAPSHOT_TABLE;
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  readonly onlyWhenPeriodIsUnpublished: true;
}

/** One bounded batch of rows for the period being built. */
export interface UpsertBatchOperation {
  readonly kind: 'upsert_batch';
  readonly table: typeof BR_RECEITA_SNAPSHOT_TABLE;
  readonly batchIndex: number;
  readonly rows: readonly BrReceitaPersistedSnapshot[];
  /**
   * The identity columns that resolve a conflict. Period-aware, matching migration 125's
   * `source_company_snapshots_br_period_identity_uidx`.
   *
   * 🔴 Deliberately NOT `RECORD_IDENTITY_ON_CONFLICT` nor `OLD_TAX_GRAIN_ON_CONFLICT`: both are
   * `source_year`-scoped, and a year-scoped conflict target is exactly how month N+1 would
   * overwrite month N.
   */
  readonly conflictColumns: readonly string[];
}

/** Makes the whole period visible. The single atomic transition. */
export interface PublishPeriodOperation {
  readonly kind: 'publish_period';
  readonly table: 'source_snapshot_runs';
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  readonly from: 'preparing';
  readonly to: 'published';
  /**
   * 🔴 The transition and the last batch must commit together, or a crash between them leaves a
   * complete-but-invisible period (recoverable) or an incomplete-but-visible one (not). Only the
   * second is a correctness failure, so the contract requires the publish to be the final statement
   * of the same transaction.
   */
  readonly mustCommitWithFinalBatch: true;
}

/** Terminal failure. The period stays unreadable and the previous published period is untouched. */
export interface FailPeriodOperation {
  readonly kind: 'fail_period';
  readonly table: 'source_snapshot_runs';
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  readonly to: 'failed' | 'rolled_back';
  readonly leavesPreviousPublishedPeriodIntact: true;
}

export type BrReceitaSnapshotWriteOperation =
  | BeginPeriodOperation
  | ResetUnpublishedPeriodOperation
  | UpsertBatchOperation
  | PublishPeriodOperation;

// ─── Plan result ────────────────────────────────────────────────────────────

export type BrReceitaSnapshotPlanRejectionReason =
  | 'source_period_missing_or_malformed'
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
 * What the caller gets back on success.
 *
 * 🔴 Non-sensitive internal control facts only. Counts, an ordinal, a period, a state — no CNPJ,
 * no legal name, no row payload. GATE-5's projection stays unimplemented and this summary is not a
 * back door into it.
 */
export interface BrReceitaSnapshotWritePlan {
  readonly source_key: typeof BR_RECEITA_CNPJ_SOURCE_KEY;
  readonly country_code: typeof BR_RECEITA_CNPJ_COUNTRY_CODE;
  readonly source_period: string;
  readonly operations: readonly BrReceitaSnapshotWriteOperation[];
  readonly onFailure: FailPeriodOperation;
  readonly acceptedRecordCount: number;
  readonly collapsedDuplicateCount: number;
  readonly batchCount: number;
  readonly batchSize: number;
  /** Invariants this plan asserts about itself, so a caller can assert on them too. */
  readonly writesNothing: true;
  readonly partialPeriodVisible: false;
  readonly crossPeriodOverwritePossible: false;
}

export type BrReceitaSnapshotWritePlanResult =
  | { readonly status: 'planned'; readonly plan: BrReceitaSnapshotWritePlan }
  | {
      readonly status: 'rejected';
      readonly rejections: readonly BrReceitaSnapshotPlanRejection[];
    };

export interface BrReceitaSnapshotWritePlanInput {
  readonly sourcePeriod: string;
  /** An ITERABLE, so a streaming producer needs no change. */
  readonly records: Iterable<BrReceitaPersistedSnapshot>;
  /**
   * Duplicate policy for the SAME identity appearing twice in one incoming period.
   *
   * `'collapse_last_wins'` keeps the last occurrence, which is what an upsert against the
   * period-aware unique index would do anyway — so the plan states it instead of letting the
   * database decide silently. `'reject'` refuses the period. Either way two logical snapshots are
   * never created; the default is the explicit, deterministic collapse.
   */
  readonly onDuplicateIdentity?: 'collapse_last_wins' | 'reject';
  readonly batchSize?: number;
}

// ─── The planner ────────────────────────────────────────────────────────────

/**
 * Builds the bounded write/publish plan for ONE period. PURE.
 *
 * Order is load-bearing and is asserted by the CUT-A suite:
 *   begin_period → reset_unpublished_period → upsert_batch* → publish_period
 *
 * `publish_period` is unconditionally LAST. There is no code path that emits it before the final
 * batch, which is what makes "a partial period is never marked complete" a property of the plan
 * rather than a promise about the executor.
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

  const duplicatePolicy = input.onDuplicateIdentity ?? 'collapse_last_wins';
  const batchSize =
    input.batchSize !== undefined && Number.isInteger(input.batchSize) && input.batchSize > 0
      ? Math.min(input.batchSize, BR_RECEITA_SNAPSHOT_BATCH_ROWS)
      : BR_RECEITA_SNAPSHOT_BATCH_ROWS;

  const rejections: BrReceitaSnapshotPlanRejection[] = [];
  // Insertion-ordered, so `collapse_last_wins` keeps the position of the FIRST sighting while
  // carrying the LAST payload — a stable order makes the plan deterministic across replays.
  const byIdentity = new Map<string, BrReceitaPersistedSnapshot>();
  let collapsedDuplicateCount = 0;
  let index = -1;

  for (const record of input.records) {
    index += 1;

    if (record.identity.source_period !== sourcePeriod) {
      // A record from another month inside this period's build. Never silently re-labelled: that
      // would be the cross-period overwrite the identity model exists to prevent.
      rejections.push({ reason: 'record_period_mismatch', recordIndex: index });
      continue;
    }

    const logicalIdentity = brReceitaLogicalSnapshotIdentity(record.identity);
    if (byIdentity.has(logicalIdentity)) {
      if (duplicatePolicy === 'reject') {
        rejections.push({ reason: 'duplicate_identity_in_batch', recordIndex: index });
        continue;
      }
      collapsedDuplicateCount += 1;
    }
    byIdentity.set(logicalIdentity, record);
  }

  if (rejections.length > 0) {
    return { status: 'rejected', rejections };
  }

  const accepted = [...byIdentity.values()];
  if (accepted.length === 0) {
    // An empty period is refused rather than published as an empty month: publishing it would make
    // the period visible as complete while containing nothing, which is the same class of lie as
    // publishing a partial one.
    return { status: 'rejected', rejections: [{ reason: 'empty_period', recordIndex: null }] };
  }

  const periodCoordinates = {
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
    source_period: sourcePeriod,
  } as const;

  const operations: BrReceitaSnapshotWriteOperation[] = [
    { kind: 'begin_period', table: 'source_snapshot_runs', ...periodCoordinates, publish_state: 'preparing' },
    {
      kind: 'reset_unpublished_period',
      table: BR_RECEITA_SNAPSHOT_TABLE,
      ...periodCoordinates,
      onlyWhenPeriodIsUnpublished: true,
    },
  ];

  for (let offset = 0, batchIndex = 0; offset < accepted.length; offset += batchSize, batchIndex += 1) {
    operations.push({
      kind: 'upsert_batch',
      table: BR_RECEITA_SNAPSHOT_TABLE,
      batchIndex,
      rows: accepted.slice(offset, offset + batchSize),
      conflictColumns: BR_RECEITA_PERIOD_CONFLICT_COLUMNS,
    });
  }

  operations.push({
    kind: 'publish_period',
    table: 'source_snapshot_runs',
    ...periodCoordinates,
    from: 'preparing',
    to: 'published',
    mustCommitWithFinalBatch: true,
  });

  return {
    status: 'planned',
    plan: {
      ...periodCoordinates,
      operations,
      onFailure: {
        kind: 'fail_period',
        table: 'source_snapshot_runs',
        ...periodCoordinates,
        to: 'failed',
        leavesPreviousPublishedPeriodIntact: true,
      },
      acceptedRecordCount: accepted.length,
      collapsedDuplicateCount,
      batchCount: operations.filter((op) => op.kind === 'upsert_batch').length,
      batchSize,
      writesNothing: true,
      partialPeriodVisible: false,
      crossPeriodOverwritePossible: false,
    },
  };
}
