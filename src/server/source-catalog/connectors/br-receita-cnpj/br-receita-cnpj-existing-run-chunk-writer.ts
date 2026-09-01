import { parseSourcePeriod } from '../../source-period';
import {
  BR_RECEITA_SNAPSHOT_TABLE,
  brReceitaLogicalSnapshotIdentity,
  type BrReceitaPersistedSnapshot,
} from './br-receita-cnpj-monthly-snapshot-identity';
import {
  BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
  BR_RECEITA_RUN_SCOPED_CONFLICT_IS_PARTIAL,
  BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
  BR_RECEITA_SNAPSHOT_BATCH_ROWS,
  type BrReceitaRunScopedSnapshotRow,
  type PublishPeriodOperation,
  type UpsertBatchOperation,
} from './br-receita-cnpj-monthly-snapshot-write-plan';
import type {
  BrReceitaSnapshotWriteGateway,
  BrReceitaSqlExecutor,
} from './br-receita-cnpj-monthly-snapshot-write-gateway';
import { parseSnapshotRunId } from './br-receita-cnpj-monthly-snapshot-run-handle';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from './br-receita-cnpj-types';

/**
 * National chunking pins this value deliberately. If the join engine reports any other effective
 * partition count, ordinal checkpoints no longer mean the same thing and the operator must stop.
 */
export const BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT = 1_024 as const;

export type BrReceitaExistingRunWriterRefusalReason =
  | 'run_id_malformed'
  | 'source_period_malformed'
  | 'record_coordinates_mismatch'
  | 'writer_already_finalized'
  | 'final_chunk_empty'
  | 'superseded_run_id_malformed'
  | 'existing_run_not_ready';

/**
 * Fixed-code failure. It never carries a CNPJ, legal name, path, raw row or database message.
 */
export class BrReceitaExistingRunWriterError extends Error {
  readonly reason: BrReceitaExistingRunWriterRefusalReason;

  constructor(reason: BrReceitaExistingRunWriterRefusalReason) {
    super(`br receita existing-run writer refused (${reason})`);
    this.name = 'BrReceitaExistingRunWriterError';
    this.reason = reason;
  }
}

export interface BrReceitaExistingRunPreflightResult {
  readonly ready: boolean;
  readonly reason: 'ready' | 'existing_run_not_ready';
}

/**
 * Read-only preflight for a run that was already created by the approved publication lifecycle.
 *
 * This intentionally returns one boolean fact only. It does not return the partition name, row data,
 * identifiers from the source, metadata, or a database error message.
 */
export async function preflightBrReceitaExistingRunForChunkLoad(args: {
  readonly sql: BrReceitaSqlExecutor;
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
}): Promise<BrReceitaExistingRunPreflightResult> {
  const parsedRun = parseSnapshotRunId(args.snapshotRunId);
  if (!parsedRun.valid) {
    throw new BrReceitaExistingRunWriterError('run_id_malformed');
  }
  const parsedPeriod = parseSourcePeriod(args.sourcePeriod);
  if (!parsedPeriod.valid) {
    throw new BrReceitaExistingRunWriterError('source_period_malformed');
  }

  const result = await args.sql.query(
    `
      SELECT EXISTS (
        SELECT 1
          FROM public.source_snapshot_runs AS r
         WHERE r.id = $1::uuid
           AND r.source_key = $2
           AND r.country_code = $3
           AND r.source_period = $4
           AND r.status = 'running'
           AND r.publish_state = 'preparing'
           AND to_regclass(
                 format('public.%I', public.br_receita_run_partition_name(r.id))
               ) IS NOT NULL
      ) AS ready
    `,
    [
      parsedRun.runId,
      BR_RECEITA_CNPJ_SOURCE_KEY,
      BR_RECEITA_CNPJ_COUNTRY_CODE,
      parsedPeriod.sourcePeriod,
    ],
  );

  const ready = result.rows.length === 1 && result.rows[0]?.ready === true;
  return {
    ready,
    reason: ready ? 'ready' : 'existing_run_not_ready',
  };
}

export interface BrReceitaExistingRunWriterStats {
  readonly acceptedRows: number;
  readonly writtenRows: number;
  readonly batchWrites: number;
  readonly collapsedInBatchCount: number;
  readonly pendingRows: number;
  readonly finalized: boolean;
}

export interface BrReceitaExistingRunChunkWriter {
  /** Adds one already-sanitized persisted snapshot. Holds at most one batch in memory. */
  push(snapshot: BrReceitaPersistedSnapshot): Promise<void>;
  /**
   * Completes a NON-FINAL ordinal chunk. Replays are safe because the gateway upserts on the
   * run-scoped primary key.
   */
  commitChunk(): Promise<BrReceitaExistingRunWriterStats>;
  /**
   * Completes the FINAL ordinal chunk and performs the only publication transition. The last batch
   * is handed to `commitFinalBatchAndPublish`, preserving CUT A/B's atomic final-batch contract.
   */
  publishFinalChunk(args?: {
    readonly supersedesPublishedRunId?: string;
  }): Promise<BrReceitaExistingRunWriterStats>;
  stats(): BrReceitaExistingRunWriterStats;
}

function stampSnapshot(
  snapshot: BrReceitaPersistedSnapshot,
  snapshotRunId: string,
): BrReceitaRunScopedSnapshotRow {
  return {
    identity: snapshot.identity,
    snapshot_run_id: snapshotRunId,
    payload: snapshot.payload,
  };
}

function upsertOperation(args: {
  readonly batchIndex: number;
  readonly snapshotRunId: string;
  readonly rows: readonly BrReceitaRunScopedSnapshotRow[];
  readonly collapsedInBatchCount: number;
}): UpsertBatchOperation {
  return {
    kind: 'upsert_batch',
    table: BR_RECEITA_SNAPSHOT_TABLE,
    batchIndex: args.batchIndex,
    snapshot_run_id: args.snapshotRunId,
    rows: args.rows,
    conflictColumns: BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
    conflictIndexPredicate: BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
    conflictTargetIsPartial: BR_RECEITA_RUN_SCOPED_CONFLICT_IS_PARTIAL,
    collapsedInBatchCount: args.collapsedInBatchCount,
  };
}

function publishOperation(args: {
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly supersedesPublishedRunId?: string;
}): PublishPeriodOperation {
  let supersedes: PublishPeriodOperation['supersedes'] = null;
  if (args.supersedesPublishedRunId !== undefined) {
    const parsed = parseSnapshotRunId(args.supersedesPublishedRunId);
    if (!parsed.valid) {
      throw new BrReceitaExistingRunWriterError('superseded_run_id_malformed');
    }
    supersedes = {
      snapshot_run_id: parsed.runId,
      from: 'published',
      to: 'superseded',
    };
  }

  return {
    kind: 'publish_period',
    table: 'source_snapshot_runs',
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
    source_period: args.sourcePeriod,
    snapshot_run_id: args.snapshotRunId,
    from: 'preparing',
    to: 'published',
    supersedes,
    transitionOrder: ['demote_superseded_run', 'promote_preparing_run'],
    mustCommitWithFinalBatch: true,
    readerSeesPreviousRunUntilCommit: true,
  };
}

/**
 * Writer for an ALREADY-EXISTING detached run.
 *
 * There is deliberately no `beginPeriodRun` call in this module. The gateway is accepted as a
 * capability, but the only gateway methods reachable below are `upsertBatch` and
 * `commitFinalBatchAndPublish`. This is what allows a national import to resume the run an operator
 * already opened instead of accidentally minting a second publication.
 *
 * The buffer is flushed only when the NEXT unique row would exceed 500. That leaves 1..500 rows held
 * at the end of a non-empty final chunk, so the actual final batch can commit atomically with publish.
 */
export function createBrReceitaExistingRunChunkWriter(args: {
  readonly gateway: BrReceitaSnapshotWriteGateway;
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly batchIndexStart?: number;
}): BrReceitaExistingRunChunkWriter {
  const parsedRun = parseSnapshotRunId(args.snapshotRunId);
  if (!parsedRun.valid) {
    throw new BrReceitaExistingRunWriterError('run_id_malformed');
  }
  const parsedPeriod = parseSourcePeriod(args.sourcePeriod);
  if (!parsedPeriod.valid) {
    throw new BrReceitaExistingRunWriterError('source_period_malformed');
  }

  const snapshotRunId = parsedRun.runId;
  const sourcePeriod = parsedPeriod.sourcePeriod;
  let batchIndex =
    args.batchIndexStart !== undefined &&
    Number.isSafeInteger(args.batchIndexStart) &&
    args.batchIndexStart >= 0
      ? args.batchIndexStart
      : 0;
  let buffer: BrReceitaRunScopedSnapshotRow[] = [];
  let positionByIdentity = new Map<string, number>();
  let collapsedInCurrentBatch = 0;
  let totalCollapsed = 0;
  let acceptedRows = 0;
  let writtenRows = 0;
  let batchWrites = 0;
  let finalized = false;

  const currentStats = (): BrReceitaExistingRunWriterStats => ({
    acceptedRows,
    writtenRows,
    batchWrites,
    collapsedInBatchCount: totalCollapsed + collapsedInCurrentBatch,
    pendingRows: buffer.length,
    finalized,
  });

  const assertOpen = (): void => {
    if (finalized) {
      throw new BrReceitaExistingRunWriterError('writer_already_finalized');
    }
  };

  const resetBuffer = (): void => {
    totalCollapsed += collapsedInCurrentBatch;
    buffer = [];
    positionByIdentity = new Map<string, number>();
    collapsedInCurrentBatch = 0;
  };

  const flushHeldBatch = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const operation = upsertOperation({
      batchIndex,
      snapshotRunId,
      rows: buffer,
      collapsedInBatchCount: collapsedInCurrentBatch,
    });
    const result = await args.gateway.upsertBatch(operation);
    writtenRows += result.writtenRows;
    batchWrites += 1;
    batchIndex += 1;
    resetBuffer();
  };

  return {
    async push(snapshot: BrReceitaPersistedSnapshot): Promise<void> {
      assertOpen();
      if (
        snapshot.identity.source_key !== BR_RECEITA_CNPJ_SOURCE_KEY ||
        snapshot.identity.country_code !== BR_RECEITA_CNPJ_COUNTRY_CODE ||
        snapshot.identity.source_period !== sourcePeriod
      ) {
        throw new BrReceitaExistingRunWriterError('record_coordinates_mismatch');
      }

      acceptedRows += 1;
      const logicalIdentity = brReceitaLogicalSnapshotIdentity(snapshot.identity);
      const seenAt = positionByIdentity.get(logicalIdentity);
      if (seenAt !== undefined) {
        buffer[seenAt] = stampSnapshot(snapshot, snapshotRunId);
        collapsedInCurrentBatch += 1;
        return;
      }

      // Preserve one complete batch as the possible FINAL batch. Flush only when another unique row
      // is about to exceed the cap.
      if (buffer.length >= BR_RECEITA_SNAPSHOT_BATCH_ROWS) {
        await flushHeldBatch();
      }

      positionByIdentity.set(logicalIdentity, buffer.length);
      buffer.push(stampSnapshot(snapshot, snapshotRunId));
    },

    async commitChunk(): Promise<BrReceitaExistingRunWriterStats> {
      assertOpen();
      await flushHeldBatch();
      finalized = true;
      return currentStats();
    },

    async publishFinalChunk(publishArgs = {}): Promise<BrReceitaExistingRunWriterStats> {
      assertOpen();
      if (buffer.length === 0) {
        throw new BrReceitaExistingRunWriterError('final_chunk_empty');
      }

      const finalBatch = upsertOperation({
        batchIndex,
        snapshotRunId,
        rows: buffer,
        collapsedInBatchCount: collapsedInCurrentBatch,
      });
      const publish = publishOperation({
        snapshotRunId,
        sourcePeriod,
        supersedesPublishedRunId: publishArgs.supersedesPublishedRunId,
      });
      const result = await args.gateway.commitFinalBatchAndPublish(finalBatch, publish);
      writtenRows += result.finalBatchRows;
      batchWrites += 1;
      batchIndex += 1;
      resetBuffer();
      finalized = true;
      return currentStats();
    },

    stats(): BrReceitaExistingRunWriterStats {
      return currentStats();
    },
  };
}
