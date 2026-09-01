import {
  runBrazilReceitaFullJoinStreamingEngineOnce,
  type BrazilReceitaFullJoinEngineRequest,
  type BrazilReceitaFullJoinEngineResult,
} from './br-receita-cnpj-full-join-engine';
import {
  BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT,
  createBrReceitaExistingRunChunkWriter,
  preflightBrReceitaExistingRunForChunkLoad,
  type BrReceitaExistingRunWriterStats,
} from './br-receita-cnpj-existing-run-chunk-writer';
import {
  createBrReceitaNationalMatchProjectorSink,
  type BrReceitaNationalProjectorStats,
  type BrReceitaNationalReferenceCatalogs,
} from './br-receita-cnpj-national-match-projector';
import {
  createBrReceitaNationalMaterializationGuard,
  resolveBrReceitaNationalMaterializationCaps,
  type BrReceitaNationalMaterializationCapKey,
} from './br-receita-cnpj-national-materialization-envelope';
import type {
  BrReceitaSnapshotWriteGateway,
  BrReceitaSqlExecutor,
} from './br-receita-cnpj-monthly-snapshot-write-gateway';

const INVENTORY_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;

export type BrReceitaNationalChunkLoaderRefusalReason =
  | 'partition_range_invalid'
  | 'partition_map_not_pinned_to_1024'
  | 'duplicate_policy_not_reject'
  | 'reader_caps_invalid'
  | 'inventory_fingerprint_invalid'
  | 'materialization_caps_invalid'
  | 'existing_run_not_ready'
  | 'effective_partition_map_changed'
  | 'partition_depth_changed'
  | 'executed_range_mismatch'
  | 'projector_not_finalized'
  | 'materialization_breach_on_completed_engine'
  | 'partition_summary_match_mismatch'
  | 'projector_accounting_mismatch'
  | 'writer_accounting_mismatch'
  | 'writer_post_commit_accounting_mismatch';

export class BrReceitaNationalChunkLoaderError extends Error {
  readonly reason: BrReceitaNationalChunkLoaderRefusalReason;

  constructor(reason: BrReceitaNationalChunkLoaderRefusalReason) {
    super(`br receita national chunk loader refused (${reason})`);
    this.name = 'BrReceitaNationalChunkLoaderError';
    this.reason = reason;
  }
}

export type BrReceitaNationalChunkEngineBaseRequest = Omit<
  BrazilReceitaFullJoinEngineRequest,
  'sink' | 'sinkMaterializesRows' | 'partitionOrdinalStart' | 'partitionOrdinalCount'
>;

interface BrReceitaNationalChunkCoordinates {
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly inventoryFingerprint: string;
}

export interface BrReceitaNationalChunkLoadedResult extends BrReceitaNationalChunkCoordinates {
  readonly status: 'loaded_not_published';
  readonly partitionOrdinalStart: number;
  readonly partitionOrdinalCount: number;
  readonly partitionOrdinalEndExclusive: number;
  readonly engine: BrazilReceitaFullJoinEngineResult;
  readonly projector: BrReceitaNationalProjectorStats;
  readonly writer: BrReceitaExistingRunWriterStats;
  readonly published: false;
}

export interface BrReceitaNationalChunkAbortedResult extends BrReceitaNationalChunkCoordinates {
  readonly status: 'engine_aborted';
  readonly partitionOrdinalStart: number;
  readonly partitionOrdinalCount: number;
  readonly engine: BrazilReceitaFullJoinEngineResult;
  readonly projector: BrReceitaNationalProjectorStats;
  readonly writer: BrReceitaExistingRunWriterStats;
  readonly published: false;
}

export type BrReceitaNationalChunkLoadResult =
  | BrReceitaNationalChunkLoadedResult
  | BrReceitaNationalChunkAbortedResult;

export type BrReceitaNationalChunkEngineRunner = (
  request: BrazilReceitaFullJoinEngineRequest,
) => Promise<BrazilReceitaFullJoinEngineResult>;

function assertRange(start: number, count: number): void {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    start >= BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT ||
    start + count > BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT
  ) {
    throw new BrReceitaNationalChunkLoaderError('partition_range_invalid');
  }
}

function assertPinnedMap(request: BrReceitaNationalChunkEngineBaseRequest): void {
  const declared = request.partitioningCaps;
  if (
    declared === null ||
    declared.partitionCount !== BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT ||
    declared.maxPartitionCount !== BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT
  ) {
    throw new BrReceitaNationalChunkLoaderError('partition_map_not_pinned_to_1024');
  }
}

function assertNationalDuplicatePolicy(request: BrReceitaNationalChunkEngineBaseRequest): void {
  if (request.duplicateKeyPolicy !== 'reject') {
    throw new BrReceitaNationalChunkLoaderError('duplicate_policy_not_reject');
  }
}

function resolveMaxRowBytes(request: BrReceitaNationalChunkEngineBaseRequest): number {
  const raw = request.readerCaps?.maxRowBytes;
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    !Number.isSafeInteger(raw) ||
    raw <= 0
  ) {
    throw new BrReceitaNationalChunkLoaderError('reader_caps_invalid');
  }
  return raw;
}

function assertInventoryFingerprint(value: string): void {
  if (!INVENTORY_FINGERPRINT_PATTERN.test(value)) {
    throw new BrReceitaNationalChunkLoaderError('inventory_fingerprint_invalid');
  }
}

function assertCompletedChunkAccounting(args: {
  readonly engine: BrazilReceitaFullJoinEngineResult;
  readonly projector: BrReceitaNationalProjectorStats;
  readonly writer: BrReceitaExistingRunWriterStats;
}): void {
  if (!args.projector.finalized) {
    throw new BrReceitaNationalChunkLoaderError('projector_not_finalized');
  }
  if (args.projector.materializationBreach !== null) {
    throw new BrReceitaNationalChunkLoaderError('materialization_breach_on_completed_engine');
  }

  const summaryMatches = args.engine.partitionSummaries.reduce(
    (total, summary) => total + summary.matchesEmitted,
    0,
  );
  if (summaryMatches !== args.projector.matchesReceived) {
    throw new BrReceitaNationalChunkLoaderError('partition_summary_match_mismatch');
  }
  if (
    args.projector.matchesReceived !==
    args.projector.parserAcceptedRows + args.projector.parserRejectedRows
  ) {
    throw new BrReceitaNationalChunkLoaderError('projector_accounting_mismatch');
  }
  if (args.writer.acceptedRows !== args.projector.parserAcceptedRows) {
    throw new BrReceitaNationalChunkLoaderError('writer_accounting_mismatch');
  }
}

function assertCommittedWriterAccounting(writer: BrReceitaExistingRunWriterStats): void {
  if (
    !writer.finalized ||
    writer.pendingRows !== 0 ||
    writer.writtenRows + writer.collapsedInBatchCount !== writer.acceptedRows
  ) {
    throw new BrReceitaNationalChunkLoaderError('writer_post_commit_accounting_mismatch');
  }
}

/**
 * Loads one Stage-3 ordinal window into an ALREADY-EXISTING detached run. It cannot publish.
 * Materialization caps cover the extra full-row reads performed after key matching; no defaults.
 */
export async function loadBrReceitaNationalChunk(args: {
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly sourceYear: number;
  readonly inventoryFingerprint: string;
  readonly partitionOrdinalStart: number;
  readonly partitionOrdinalCount: number;
  readonly materializationCaps:
    | Readonly<Partial<Record<BrReceitaNationalMaterializationCapKey, unknown>>>
    | null;
  readonly sql: BrReceitaSqlExecutor;
  readonly gateway: BrReceitaSnapshotWriteGateway;
  readonly catalogs: BrReceitaNationalReferenceCatalogs;
  readonly engineRequest: BrReceitaNationalChunkEngineBaseRequest;
  readonly runEngine?: BrReceitaNationalChunkEngineRunner;
}): Promise<BrReceitaNationalChunkLoadResult> {
  assertRange(args.partitionOrdinalStart, args.partitionOrdinalCount);
  assertPinnedMap(args.engineRequest);
  assertNationalDuplicatePolicy(args.engineRequest);
  assertInventoryFingerprint(args.inventoryFingerprint);
  const maxRowBytes = resolveMaxRowBytes(args.engineRequest);

  const materializationCaps = resolveBrReceitaNationalMaterializationCaps(args.materializationCaps);
  if (!materializationCaps.ok) {
    throw new BrReceitaNationalChunkLoaderError('materialization_caps_invalid');
  }
  const materializationGuard = createBrReceitaNationalMaterializationGuard(materializationCaps.caps);

  const preflight = await preflightBrReceitaExistingRunForChunkLoad({
    sql: args.sql,
    snapshotRunId: args.snapshotRunId,
    sourcePeriod: args.sourcePeriod,
  });
  if (!preflight.ready) throw new BrReceitaNationalChunkLoaderError('existing_run_not_ready');

  const writer = createBrReceitaExistingRunChunkWriter({
    gateway: args.gateway,
    snapshotRunId: args.snapshotRunId,
    sourcePeriod: args.sourcePeriod,
  });
  const projector = createBrReceitaNationalMatchProjectorSink({
    sourcePeriod: args.sourcePeriod,
    sourceYear: args.sourceYear,
    descriptors: args.engineRequest.sources,
    fileSystem: args.engineRequest.readerFileSystem,
    openHandleLedger: args.engineRequest.openHandleLedger,
    materializationGuard,
    maxRowBytes,
    catalogs: args.catalogs,
    writer,
  });

  const runEngine = args.runEngine ?? runBrazilReceitaFullJoinStreamingEngineOnce;
  let engine: BrazilReceitaFullJoinEngineResult;
  try {
    engine = await runEngine({
      ...args.engineRequest,
      duplicateKeyPolicy: 'reject',
      sink: projector,
      sinkMaterializesRows: true,
      partitionOrdinalStart: args.partitionOrdinalStart,
      partitionOrdinalCount: args.partitionOrdinalCount,
    });
  } finally {
    projector.dispose();
  }

  if (engine.exitStatus !== 'completed') {
    return {
      status: 'engine_aborted',
      snapshotRunId: args.snapshotRunId,
      sourcePeriod: args.sourcePeriod,
      inventoryFingerprint: args.inventoryFingerprint,
      partitionOrdinalStart: args.partitionOrdinalStart,
      partitionOrdinalCount: args.partitionOrdinalCount,
      engine,
      projector: projector.stats(),
      writer: writer.stats(),
      published: false,
    };
  }

  if (engine.exact.partitionsCreated !== BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT) {
    throw new BrReceitaNationalChunkLoaderError('effective_partition_map_changed');
  }
  if (engine.exact.partitionDepthReached !== 0) {
    throw new BrReceitaNationalChunkLoaderError('partition_depth_changed');
  }

  const expectedEnd = args.partitionOrdinalStart + args.partitionOrdinalCount;
  const executed = engine.executedPartitionOrdinalRange;
  if (
    executed === null ||
    executed.start !== args.partitionOrdinalStart ||
    executed.endExclusive !== expectedEnd
  ) {
    throw new BrReceitaNationalChunkLoaderError('executed_range_mismatch');
  }

  const projectorStats = projector.stats();
  const writerBeforeCommit = writer.stats();
  assertCompletedChunkAccounting({
    engine,
    projector: projectorStats,
    writer: writerBeforeCommit,
  });

  const writerStats = await writer.commitChunk();
  assertCommittedWriterAccounting(writerStats);
  return {
    status: 'loaded_not_published',
    snapshotRunId: args.snapshotRunId,
    sourcePeriod: args.sourcePeriod,
    inventoryFingerprint: args.inventoryFingerprint,
    partitionOrdinalStart: args.partitionOrdinalStart,
    partitionOrdinalCount: args.partitionOrdinalCount,
    partitionOrdinalEndExclusive: expectedEnd,
    engine,
    projector: projectorStats,
    writer: writerStats,
    published: false,
  };
}
