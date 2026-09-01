import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrReceitaNationalChunkLoaderError,
  loadBrReceitaNationalChunk,
  type BrReceitaNationalChunkEngineBaseRequest,
} from '../br-receita-cnpj-national-chunk-loader';
import type { BrazilReceitaFullJoinEngineResult } from '../br-receita-cnpj-full-join-engine';
import { createBrazilReceitaFullJoinOpenHandleLedger } from '../br-receita-cnpj-full-join-open-handle-ledger';
import type { BrReceitaSnapshotWriteGateway } from '../br-receita-cnpj-monthly-snapshot-write-gateway';

const RUN_ID = '55555555-5555-4555-8555-555555555555';

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

function engineRequest(): BrReceitaNationalChunkEngineBaseRequest {
  return {
    sources: [],
    readerCaps: {
      maxChunkBytes: 4_194_304,
      maxCarryBytes: 65_536,
      maxRowBytes: 65_536,
      maxColumnsPerRow: 64,
    },
    partitioningCaps: {
      partitionCount: 1024,
      maxPartitionCount: 1024,
      maxPartitionDepth: 1,
      maxReferencesPerPartition: 131_072,
      maxReferenceBytesPerPartition: 2_097_152,
    },
    resourceCaps: {},
    duplicateKeyPolicy: 'reject',
    readerFileSystem: {
      size: () => 0,
      open: () => {
        throw new Error('no source read expected in stub');
      },
      read: () => 0,
      close: () => undefined,
    },
    workspaceFileSystem: {},
    workspaceParentDirectory: '/opaque',
    workspaceBoundaries: {},
    resourceDependencies: {},
    openHandleLedger: createBrazilReceitaFullJoinOpenHandleLedger(64),
    maxOpenPartitionFiles: 32,
    minimumFreeDiskBeforeStart: 1,
    minimumFreeDiskReserve: 1,
    freeDiskProbe: {},
    realDataRun: true,
    invocationTemporaryStorageApproval: null,
  } as unknown as BrReceitaNationalChunkEngineBaseRequest;
}

test('completed engine cannot credit a chunk when its summaries claim a match the projector never received', async () => {
  await assert.rejects(
    () =>
      loadBrReceitaNationalChunk({
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        sourceYear: 2026,
        partitionOrdinalStart: 0,
        partitionOrdinalCount: 1,
        materializationCaps: {
          maxAdditionalBytesRead: 1_000_000,
          maxRowsRehydrated: 10_000,
        },
        sql: {
          async query() {
            return { rows: [{ ready: true }] };
          },
        },
        gateway: gatewayNoPublish(),
        catalogs: { cnaesRows: [], municipiosRows: [], naturezasRows: [] },
        engineRequest: engineRequest(),
        runEngine: async (request) => {
          await request.sink.finalize();
          return {
            exitStatus: 'completed',
            exact: { partitionsCreated: 1024, partitionDepthReached: 0 },
            executedPartitionOrdinalRange: { start: 0, endExclusive: 1 },
            partitionSummaries: [
              {
                partitionOrdinal: 0,
                empresaKeysLoaded: 1,
                estabelecimentoReferencesStreamed: 1,
                matchesEmitted: 1,
                empresaKeysWithoutEstabelecimento: 0,
                orphanEstabelecimentoCount: 0,
                invalidKeyCount: 0,
                malformedRowCount: 0,
              },
            ],
          } as unknown as BrazilReceitaFullJoinEngineResult;
        },
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkLoaderError &&
      error.reason === 'partition_summary_match_mismatch',
  );
});
