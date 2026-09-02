import { parseSourcePeriod } from '../../source-period';
import { parseSnapshotRunId } from './br-receita-cnpj-monthly-snapshot-run-handle';
import { BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT } from './br-receita-cnpj-existing-run-chunk-writer';
import type { BrReceitaNationalChunkLoadedResult } from './br-receita-cnpj-national-chunk-loader';

export const BR_RECEITA_NATIONAL_CHUNK_CHECKPOINT_VERSION = 2 as const;
const INVENTORY_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface BrReceitaNationalCompletedOrdinalRange {
  readonly start: number;
  readonly endExclusive: number;
}

/**
 * Serializable control-plane checkpoint: publication coordinates, inventory fingerprint and
 * ORDINAL ranges only. No CNPJ, legal name, path, raw row, source-file name or row reference can be
 * represented here.
 */
export interface BrReceitaNationalChunkCheckpoint {
  readonly version: typeof BR_RECEITA_NATIONAL_CHUNK_CHECKPOINT_VERSION;
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly inventoryFingerprint: string;
  readonly expectedPartitionCount: typeof BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT;
  readonly completedRanges: readonly BrReceitaNationalCompletedOrdinalRange[];
}

export type BrReceitaNationalChunkCheckpointFailureReason =
  | 'run_id_malformed'
  | 'source_period_malformed'
  | 'checkpoint_version_mismatch'
  | 'checkpoint_inventory_fingerprint_invalid'
  | 'checkpoint_partition_count_mismatch'
  | 'checkpoint_range_invalid'
  | 'chunk_not_successfully_loaded'
  | 'chunk_run_mismatch'
  | 'chunk_period_mismatch'
  | 'chunk_inventory_mismatch'
  | 'chunk_range_invalid'
  | 'chunk_accounting_invalid';

export class BrReceitaNationalChunkCheckpointError extends Error {
  readonly reason: BrReceitaNationalChunkCheckpointFailureReason;

  constructor(reason: BrReceitaNationalChunkCheckpointFailureReason) {
    super(`br receita national chunk checkpoint refused (${reason})`);
    this.name = 'BrReceitaNationalChunkCheckpointError';
    this.reason = reason;
  }
}

type MutableRange = { start: number; endExclusive: number };

function assertInventoryFingerprint(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !INVENTORY_FINGERPRINT_PATTERN.test(value)) {
    throw new BrReceitaNationalChunkCheckpointError('checkpoint_inventory_fingerprint_invalid');
  }
}

function canonicalRange(range: BrReceitaNationalCompletedOrdinalRange): MutableRange {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.endExclusive) ||
    range.start < 0 ||
    range.endExclusive <= range.start ||
    range.endExclusive > BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT
  ) {
    throw new BrReceitaNationalChunkCheckpointError('checkpoint_range_invalid');
  }
  return { start: range.start, endExclusive: range.endExclusive };
}

function normalizeRanges(
  ranges: readonly BrReceitaNationalCompletedOrdinalRange[],
): readonly BrReceitaNationalCompletedOrdinalRange[] {
  const ordered = ranges
    .map(canonicalRange)
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged: MutableRange[] = [];
  for (const current of ordered) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || current.start > previous.endExclusive) {
      merged.push({ ...current });
      continue;
    }
    previous.endExclusive = Math.max(previous.endExclusive, current.endExclusive);
  }
  return merged.map((range) => Object.freeze({ ...range }));
}

export function createBrReceitaNationalChunkCheckpoint(args: {
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly inventoryFingerprint: string;
}): BrReceitaNationalChunkCheckpoint {
  const run = parseSnapshotRunId(args.snapshotRunId);
  if (!run.valid) throw new BrReceitaNationalChunkCheckpointError('run_id_malformed');
  const period = parseSourcePeriod(args.sourcePeriod);
  if (!period.valid) throw new BrReceitaNationalChunkCheckpointError('source_period_malformed');
  assertInventoryFingerprint(args.inventoryFingerprint);

  return Object.freeze({
    version: BR_RECEITA_NATIONAL_CHUNK_CHECKPOINT_VERSION,
    snapshotRunId: run.runId,
    sourcePeriod: period.sourcePeriod,
    inventoryFingerprint: args.inventoryFingerprint,
    expectedPartitionCount: BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT,
    completedRanges: Object.freeze([]),
  });
}

/** Narrows untrusted JSON before a resumed operator process trusts it. */
export function parseBrReceitaNationalChunkCheckpoint(
  value: unknown,
): BrReceitaNationalChunkCheckpoint {
  if (typeof value !== 'object' || value === null) {
    throw new BrReceitaNationalChunkCheckpointError('checkpoint_version_mismatch');
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== BR_RECEITA_NATIONAL_CHUNK_CHECKPOINT_VERSION) {
    throw new BrReceitaNationalChunkCheckpointError('checkpoint_version_mismatch');
  }
  const run = parseSnapshotRunId(raw.snapshotRunId);
  if (!run.valid) throw new BrReceitaNationalChunkCheckpointError('run_id_malformed');
  const period = parseSourcePeriod(raw.sourcePeriod);
  if (!period.valid) throw new BrReceitaNationalChunkCheckpointError('source_period_malformed');
  assertInventoryFingerprint(raw.inventoryFingerprint);
  if (raw.expectedPartitionCount !== BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT) {
    throw new BrReceitaNationalChunkCheckpointError('checkpoint_partition_count_mismatch');
  }
  if (!Array.isArray(raw.completedRanges)) {
    throw new BrReceitaNationalChunkCheckpointError('checkpoint_range_invalid');
  }

  const completedRanges = normalizeRanges(
    raw.completedRanges.map((range) => {
      if (typeof range !== 'object' || range === null) {
        throw new BrReceitaNationalChunkCheckpointError('checkpoint_range_invalid');
      }
      const record = range as Record<string, unknown>;
      return {
        start: record.start as number,
        endExclusive: record.endExclusive as number,
      };
    }),
  );

  return Object.freeze({
    version: BR_RECEITA_NATIONAL_CHUNK_CHECKPOINT_VERSION,
    snapshotRunId: run.runId,
    sourcePeriod: period.sourcePeriod,
    inventoryFingerprint: raw.inventoryFingerprint,
    expectedPartitionCount: BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT,
    completedRanges: Object.freeze([...completedRanges]),
  });
}

function assertLoadedChunkAccounting(chunk: BrReceitaNationalChunkLoadedResult): void {
  const summaryMatches = chunk.engine.partitionSummaries.reduce(
    (total, summary) => total + summary.matchesEmitted,
    0,
  );
  if (
    chunk.engine.exitStatus !== 'completed' ||
    chunk.engine.exact.partitionsCreated !== BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT ||
    chunk.engine.exact.partitionDepthReached !== 0 ||
    !chunk.projector.finalized ||
    chunk.projector.materializationBreach !== null ||
    summaryMatches !== chunk.projector.matchesReceived ||
    chunk.projector.matchesReceived !==
      chunk.projector.parserAcceptedRows + chunk.projector.parserRejectedRows ||
    chunk.writer.acceptedRows !== chunk.projector.parserAcceptedRows ||
    !chunk.writer.finalized ||
    chunk.writer.pendingRows !== 0 ||
    chunk.writer.writtenRows + chunk.writer.collapsedInBatchCount !== chunk.writer.acceptedRows
  ) {
    throw new BrReceitaNationalChunkCheckpointError('chunk_accounting_invalid');
  }

  const executed = chunk.engine.executedPartitionOrdinalRange;
  if (
    executed === null ||
    executed.start !== chunk.partitionOrdinalStart ||
    executed.endExclusive !== chunk.partitionOrdinalEndExclusive
  ) {
    throw new BrReceitaNationalChunkCheckpointError('chunk_accounting_invalid');
  }
}

/**
 * Records one successfully loaded, still-detached chunk. Overlap/replay merge idempotently; gaps
 * remain gaps. Run, period and inventory fingerprint must match the checkpoint exactly before any
 * range is credited. The checkpoint revalidates the loader accounting instead of trusting the type
 * alone.
 */
export function recordBrReceitaLoadedNationalChunk(args: {
  readonly checkpoint: BrReceitaNationalChunkCheckpoint;
  readonly chunk: BrReceitaNationalChunkLoadedResult;
}): BrReceitaNationalChunkCheckpoint {
  const checkpoint = parseBrReceitaNationalChunkCheckpoint(args.checkpoint);
  const chunk = args.chunk;
  if (chunk.status !== 'loaded_not_published' || chunk.published !== false) {
    throw new BrReceitaNationalChunkCheckpointError('chunk_not_successfully_loaded');
  }
  if (chunk.snapshotRunId !== checkpoint.snapshotRunId) {
    throw new BrReceitaNationalChunkCheckpointError('chunk_run_mismatch');
  }
  if (chunk.sourcePeriod !== checkpoint.sourcePeriod) {
    throw new BrReceitaNationalChunkCheckpointError('chunk_period_mismatch');
  }
  if (chunk.inventoryFingerprint !== checkpoint.inventoryFingerprint) {
    throw new BrReceitaNationalChunkCheckpointError('chunk_inventory_mismatch');
  }
  if (
    !Number.isSafeInteger(chunk.partitionOrdinalStart) ||
    !Number.isSafeInteger(chunk.partitionOrdinalCount) ||
    !Number.isSafeInteger(chunk.partitionOrdinalEndExclusive) ||
    chunk.partitionOrdinalStart < 0 ||
    chunk.partitionOrdinalCount <= 0 ||
    chunk.partitionOrdinalEndExclusive <= chunk.partitionOrdinalStart ||
    chunk.partitionOrdinalEndExclusive > BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT ||
    chunk.partitionOrdinalEndExclusive - chunk.partitionOrdinalStart !== chunk.partitionOrdinalCount
  ) {
    throw new BrReceitaNationalChunkCheckpointError('chunk_range_invalid');
  }
  assertLoadedChunkAccounting(chunk);

  const completedRanges = normalizeRanges([
    ...checkpoint.completedRanges,
    {
      start: chunk.partitionOrdinalStart,
      endExclusive: chunk.partitionOrdinalEndExclusive,
    },
  ]);

  return Object.freeze({
    ...checkpoint,
    completedRanges: Object.freeze([...completedRanges]),
  });
}

export function brReceitaNationalChunkCheckpointComplete(
  checkpoint: BrReceitaNationalChunkCheckpoint,
): boolean {
  const parsed = parseBrReceitaNationalChunkCheckpoint(checkpoint);
  return (
    parsed.completedRanges.length === 1 &&
    parsed.completedRanges[0]!.start === 0 &&
    parsed.completedRanges[0]!.endExclusive === BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT
  );
}

export function brReceitaNationalChunkCheckpointNextGap(
  checkpoint: BrReceitaNationalChunkCheckpoint,
): BrReceitaNationalCompletedOrdinalRange | null {
  const parsed = parseBrReceitaNationalChunkCheckpoint(checkpoint);
  let cursor = 0;
  for (const range of parsed.completedRanges) {
    if (range.start > cursor) return { start: cursor, endExclusive: range.start };
    cursor = Math.max(cursor, range.endExclusive);
  }
  return cursor < BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT
    ? { start: cursor, endExclusive: BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT }
    : null;
}
