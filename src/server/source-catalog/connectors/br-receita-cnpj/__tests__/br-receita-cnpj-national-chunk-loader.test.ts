import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrReceitaNationalChunkLoaderError,
  loadBrReceitaNationalChunk,
  type BrReceitaNationalChunkEngineBaseRequest,
} from '../br-receita-cnpj-national-chunk-loader';
import type { BrazilReceitaFullJoinEngineResult } from '../br-receita-cnpj-full-join-engine';
import type {
  BrReceitaSnapshotWriteGateway,
  BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';

const RUN_ID = '22222222-2222-4222-8222-222222222222';

function sqlReady(): BrReceitaSqlExecutor {
  return {
    async query() {
      return { rows: [{ ready: true }] };
    },
  };
}

function gatewayNoPublish(): BrReceitaSnapshotWriteGateway {
  return {
    async beginPeriodRun() {
      throw new Error('beginPeriodRun must never be called');
    },
    async discardRunRows() {
      throw new Error('discardRunRows must never be called');
    },
    async upsertBatch(operation) {
      return { writtenRows: operation.rows.length };
    },
    async commitFinalBatchAndPublish() {
      throw new Error('publication must never be reachable from chunk loader');
    },
    async failPeriod() {
      throw new Error('failPeriod must never be called');
    },
  };
}

function engineRequest(partitionCount = 1024, maxPartitionCount = 1024) {
  const readerFileSystem = {
    size: () => 0,
    open: () => {
      throw new Error('no source read expected in stub');
    },
    read: () => 0,
    close: () => undefined,
  };

  return {
    sources: [],
    readerCaps: {
      maxChunkBytes: 4_194_304,
      maxCarryBytes: 65_536,
      maxRowBytes: 65_536,
      maxColumnsPerRow: 64,
    },
    partitioningCaps: {
      partitionCount,
      maxPartitionCount,
      maxPartitionDepth: 1,
      maxReferencesPerPartition: 131_072,
      maxReferenceBytesPerPartition: 2_097_152,
    },
    resourceCaps: {},
    duplicateKeyPolicy: 'pair_with_every_duplicate',
    readerFileSystem,
    workspaceFileSystem: {},
    workspaceParentDirectory: '/opaque',
    workspaceBoundaries: {},
    resourceDependencies: {},
    openHandleLedger: {},
    maxOpenPartitionFiles: 32,
    minimumFreeDiskBeforeStart: 1,
    minimumFreeDiskReserve: 1,
    freeDiskProbe: {},
    realDataRun: true,
    invocationTemporaryStorageApproval: null,
  } as unknown as BrReceitaNationalChunkEngineBaseRequest;
}

function result(args: {
  readonly status?: 'completed' | 'aborted';
  readonly partitions?: number;
  readonly depth?: number;
  readonly start?: number;
  readonly endExclusive?: number;
}): BrazilReceitaFullJoinEngineResult {
  return {
    exitStatus: args.status ?? 'completed',
    abortCode: args.status === 'aborted' ? 'resource_envelope_breached' : null,
    abortStage: args.status === 'aborted' ? 'during_join' : null,
    resourceBreach: null,
    readerCapRejections: [],
    partitioningCapRejections: [],
    partitionOrdinalRangeRejections: [],
    resourceCapRejections: [],
    workspaceRejections: [],
    exact: {
      partitionsCreated: args.partitions ?? 1024,
      partitionDepthReached: args.depth ?? 0,
    },
    publicReport: {},
    partitionSummaries: [],
    executedPartitionOrdinalRange:
      args.start === undefined
        ? null
        : { start: args.start, endExclusive: args.endExclusive ?? args.start + 1 },
    firstFileOffsetProgression: [],
    cleanupOutcome: null,
  } as unknown as BrazilReceitaFullJoinEngineResult;
}

const catalogs = { cnaesRows: [], municipiosRows: [], naturezasRows: [] } as const;

test('successful chunk is loaded but structurally cannot publish', async () => {
  let engineSawMaterializingSink = false;
  const loaded = await loadBrReceitaNationalChunk({
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
    sourceYear: 2026,
    partitionOrdinalStart: 64,
    partitionOrdinalCount: 64,
    sql: sqlReady(),
    gateway: gatewayNoPublish(),
    catalogs,
    engineRequest: engineRequest(),
    runEngine: async (request) => {
      engineSawMaterializingSink = request.sinkMaterializesRows;
      await request.sink.finalize();
      return result({ start: 64, endExclusive: 128 });
    },
  });

  assert.equal(engineSawMaterializingSink, true);
  assert.equal(loaded.status, 'loaded_not_published');
  assert.equal(loaded.partitionOrdinalStart, 64);
  assert.equal(loaded.partitionOrdinalEndExclusive, 128);
  assert.equal(loaded.published, false);
  assert.equal(loaded.writer.finalized, true);
});

test('partition map must be pinned to 1024 before preflight or engine execution', async () => {
  let sqlCalls = 0;
  let engineCalls = 0;
  await assert.rejects(
    () =>
      loadBrReceitaNationalChunk({
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        sourceYear: 2026,
        partitionOrdinalStart: 0,
        partitionOrdinalCount: 64,
        sql: {
          async query() {
            sqlCalls += 1;
            return { rows: [{ ready: true }] };
          },
        },
        gateway: gatewayNoPublish(),
        catalogs,
        engineRequest: engineRequest(1024, 2048),
        runEngine: async () => {
          engineCalls += 1;
          return result({ start: 0, endExclusive: 64 });
        },
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkLoaderError &&
      error.reason === 'partition_map_not_pinned_to_1024',
  );
  assert.equal(sqlCalls, 0);
  assert.equal(engineCalls, 0);
});

test('aborted engine never reports a completed chunk and never publishes', async () => {
  const loaded = await loadBrReceitaNationalChunk({
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
    sourceYear: 2026,
    partitionOrdinalStart: 0,
    partitionOrdinalCount: 32,
    sql: sqlReady(),
    gateway: gatewayNoPublish(),
    catalogs,
    engineRequest: engineRequest(),
    runEngine: async () => result({ status: 'aborted' }),
  });

  assert.equal(loaded.status, 'engine_aborted');
  assert.equal(loaded.published, false);
  assert.equal(loaded.writer.finalized, false);
});

test('effective repartition after execution refuses the checkpoint', async () => {
  await assert.rejects(
    () =>
      loadBrReceitaNationalChunk({
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        sourceYear: 2026,
        partitionOrdinalStart: 0,
        partitionOrdinalCount: 64,
        sql: sqlReady(),
        gateway: gatewayNoPublish(),
        catalogs,
        engineRequest: engineRequest(),
        runEngine: async (request) => {
          await request.sink.finalize();
          return result({ partitions: 2048, depth: 1, start: 0, endExclusive: 64 });
        },
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkLoaderError &&
      error.reason === 'effective_partition_map_changed',
  );
});

test('executed ordinal range must equal the requested checkpoint exactly', async () => {
  await assert.rejects(
    () =>
      loadBrReceitaNationalChunk({
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        sourceYear: 2026,
        partitionOrdinalStart: 128,
        partitionOrdinalCount: 64,
        sql: sqlReady(),
        gateway: gatewayNoPublish(),
        catalogs,
        engineRequest: engineRequest(),
        runEngine: async (request) => {
          await request.sink.finalize();
          return result({ start: 128, endExclusive: 191 });
        },
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkLoaderError &&
      error.reason === 'executed_range_mismatch',
  );
});
