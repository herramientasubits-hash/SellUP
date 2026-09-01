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
import type {
  BrReceitaSnapshotWriteGateway,
  BrReceitaSqlExecutor,
} from './br-receita-cnpj-monthly-snapshot-write-gateway';

export type BrReceitaNationalChunkLoaderRefusalReason =
  | 'partition_range_invalid'
  | 'partition_map_not_pinned_to_1024'
  | 'existing_run_not_ready'
  | 'engine_aborted'
  | 'effective_partition_map_changed'
  | 'partition_depth_changed'
  | 'executed_range_mismatch';

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
  /** Publication-version identifier. Never CNPJ-derived. */
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
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

/**
 * Loads exactly one Stage-3 ordinal window into an ALREADY-EXISTING detached run.
 * It cannot publish: successful completion calls `commitChunk`, never the gateway cutover API.
 */
export async function loadBrReceitaNationalChunk(args: {
  readonly snapshotRunId: string;
  readonly sourcePeriod: string;
  readonly sourceYear: number;
  readonly partitionOrdinalStart: number;
  readonly partitionOrdinalCount: number;
  readonly sql: BrReceitaSqlExecutor;
  readonly gateway: BrReceitaSnapshotWriteGateway;
  readonly catalogs: BrReceitaNationalReferenceCatalogs;
  readonly engineRequest: BrReceitaNationalChunkEngineBaseRequest;
  readonly runEngine?: BrReceitaNationalChunkEngineRunner;
}): Promise<BrReceitaNationalChunkLoadResult> {
  assertRange(args.partitionOrdinalStart, args.partitionOrdinalCount);
  assertPinnedMap(args.engineRequest);

  const preflight = await preflightBrReceitaExistingRunForChunkLoad({
    sql: args.sql,
    snapshotRunId: args.snapshotRunId,
    sourcePeriod: args.sourcePeriod,
  });
  if (!preflight.ready) {
    throw new BrReceitaNationalChunkLoaderError('existing_run_not_ready');
  }

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
    maxRowBytes: Number(args.engineRequest.readerCaps?.maxRowBytes ?? 0),
    catalogs: args.catalogs,
    writer,
  });

  const runEngine = args.runEngine ?? runBrazilReceitaFullJoinStreamingEngineOnce;
  const engine = await runEngine({
    ...args.engineRequest,
    sink: projector,
    sinkMaterializesRows: true,
    partitionOrdinalStart: args.partitionOrdinalStart,
    partitionOrdinalCount: args.partitionOrdinalCount,
  });

  if (engine.exitStatus !== 'completed') {
    return {
      status: 'engine_aborted',
      snapshotRunId: args.snapshotRunId,
      sourcePeriod: args.sourcePeriod,
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

  const writerStats = await writer.commitChunk();
  return {
    status: 'loaded_not_published',
    snapshotRunId: args.snapshotRunId,
    sourcePeriod: args.sourcePeriod,
    partitionOrdinalStart: args.partitionOrdinalStart,
    partitionOrdinalCount: args.partitionOrdinalCount,
    partitionOrdinalEndExclusive: expectedEnd,
    engine,
    projector: projector.stats(),
    writer: writerStats,
    published: false,
  };
}
