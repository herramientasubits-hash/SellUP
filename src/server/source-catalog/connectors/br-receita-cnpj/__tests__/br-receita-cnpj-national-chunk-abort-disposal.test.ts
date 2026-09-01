import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadBrReceitaNationalChunk,
  type BrReceitaNationalChunkEngineBaseRequest,
} from '../br-receita-cnpj-national-chunk-loader';
import type { BrazilReceitaFullJoinEngineResult } from '../br-receita-cnpj-full-join-engine';
import type { BrazilReceitaFullJoinReaderFileSystem } from '../br-receita-cnpj-full-join-streaming-reader';
import { createBrazilReceitaFullJoinOpenHandleLedger } from '../br-receita-cnpj-full-join-open-handle-ledger';
import type { BrReceitaSnapshotWriteGateway } from '../br-receita-cnpj-monthly-snapshot-write-gateway';

const RUN_ID = '66666666-6666-4666-8666-666666666666';

function quotedRow(columns: readonly string[]): string {
  return columns.map((value) => `"${value.replace(/"/g, '""')}"`).join(';');
}

const empresaLine = quotedRow(['11222333', 'ACME BRASIL LTDA', '2062', '49', '100000,00', '03', '']);
const estabelecimentoColumns = Array.from({ length: 30 }, () => '');
estabelecimentoColumns[0] = '11222333';
estabelecimentoColumns[1] = '0001';
estabelecimentoColumns[2] = '81';
estabelecimentoColumns[3] = '1';
estabelecimentoColumns[5] = '02';
estabelecimentoColumns[10] = '20200101';
estabelecimentoColumns[11] = '6201501';
estabelecimentoColumns[19] = 'SP';
estabelecimentoColumns[20] = '7107';
const estabelecimentoLine = quotedRow(estabelecimentoColumns);

function readerFileSystem(files: Readonly<Record<string, string>>): BrazilReceitaFullJoinReaderFileSystem {
  let nextHandle = 1;
  const pathByHandle = new Map<number, string>();
  return {
    size(path) {
      return Buffer.byteLength(files[path] ?? '', 'latin1');
    },
    open(path) {
      if (!(path in files)) throw new Error('missing');
      const handle = nextHandle++;
      pathByHandle.set(handle, path);
      return handle;
    },
    read(handle, target, targetOffset, length, position) {
      const path = pathByHandle.get(handle);
      if (path === undefined) throw new Error('closed');
      const source = Buffer.from(files[path]!, 'latin1');
      const available = Math.max(0, Math.min(length, source.length - position));
      if (available > 0) source.copy(target, targetOffset, position, position + available);
      return available;
    },
    close(handle) {
      if (!pathByHandle.delete(handle)) throw new Error('closed');
    },
  };
}

function gatewayNoPublish(writes: { count: number }): BrReceitaSnapshotWriteGateway {
  return {
    async beginPeriodRun() {
      throw new Error('beginPeriodRun must never be called');
    },
    async discardRunRows() {
      throw new Error('discardRunRows must never be called');
    },
    async upsertBatch(operation) {
      writes.count += operation.rows.length;
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

test('engine abort disposes projector handles without flushing buffered rows', async () => {
  const files = {
    '/opaque/empresa': empresaLine,
    '/opaque/estabelecimento': estabelecimentoLine,
  } as const;
  const ledger = createBrazilReceitaFullJoinOpenHandleLedger(64);
  const writes = { count: 0 };
  const request = {
    sources: [
      {
        filePath: '/opaque/empresa',
        family: 'empresas',
        sourceFileOrdinal: 0,
        encoding: 'latin1',
      },
      {
        filePath: '/opaque/estabelecimento',
        family: 'estabelecimentos',
        sourceFileOrdinal: 1,
        encoding: 'latin1',
      },
    ],
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
    readerFileSystem: readerFileSystem(files),
    workspaceFileSystem: {},
    workspaceParentDirectory: '/opaque',
    workspaceBoundaries: {},
    resourceDependencies: {},
    openHandleLedger: ledger,
    maxOpenPartitionFiles: 32,
    minimumFreeDiskBeforeStart: 1,
    minimumFreeDiskReserve: 1,
    freeDiskProbe: {},
    realDataRun: true,
    invocationTemporaryStorageApproval: null,
  } as unknown as BrReceitaNationalChunkEngineBaseRequest;

  const loaded = await loadBrReceitaNationalChunk({
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
    gateway: gatewayNoPublish(writes),
    catalogs: { cnaesRows: [], municipiosRows: [], naturezasRows: [] },
    engineRequest: request,
    runEngine: async (engineRequest) => {
      await engineRequest.sink.onMatch({
        partitionOrdinal: 0,
        empresaReference: {
          sourceFileOrdinal: 0,
          family: 'empresas',
          byteOffset: 0,
          byteLength: Buffer.byteLength(empresaLine, 'latin1'),
        },
        estabelecimentoReference: {
          sourceFileOrdinal: 1,
          family: 'estabelecimentos',
          byteOffset: 0,
          byteLength: Buffer.byteLength(estabelecimentoLine, 'latin1'),
        },
      });
      assert.equal(ledger.openNow(), 2, 'projector must have both source descriptors open before abort');
      return {
        exitStatus: 'aborted',
        exact: { partitionsCreated: 1024, partitionDepthReached: 0 },
        partitionSummaries: [],
        executedPartitionOrdinalRange: null,
      } as unknown as BrazilReceitaFullJoinEngineResult;
    },
  });

  assert.equal(loaded.status, 'engine_aborted');
  assert.equal(loaded.projector.finalized, false);
  assert.equal(ledger.openNow(), 0, 'loader finally must release projector source handles');
  assert.equal(writes.count, 0, 'dispose must never parse or flush the buffered raw pair');
  assert.equal(loaded.writer.acceptedRows, 0);
});
