import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrReceitaNationalMatchProjectorError,
  createBrReceitaNationalMatchProjectorSink,
  createBrReceitaReferencedRowReader,
} from '../br-receita-cnpj-national-match-projector';
import type { BrReceitaExistingRunChunkWriter } from '../br-receita-cnpj-existing-run-chunk-writer';
import type { BrReceitaPersistedSnapshot } from '../br-receita-cnpj-monthly-snapshot-identity';
import type { BrazilReceitaFullJoinReaderFileSystem } from '../br-receita-cnpj-full-join-streaming-reader';
import type { BrazilReceitaFullJoinSourceFileDescriptor } from '../br-receita-cnpj-full-join-engine-contract';
import { createBrazilReceitaFullJoinOpenHandleLedger } from '../br-receita-cnpj-full-join-open-handle-ledger';
import { createBrReceitaNationalMaterializationGuard } from '../br-receita-cnpj-national-materialization-envelope';

function quotedRow(columns: readonly string[]): string {
  return columns.map((value) => `"${value.replace(/"/g, '""')}"`).join(';');
}

const empresaLine = quotedRow([
  '11222333',
  'ACME BRASIL LTDA',
  '2062',
  '49',
  '100000,00',
  '03',
  '',
]);

const estabelecimentoColumns = Array.from({ length: 30 }, () => '');
estabelecimentoColumns[0] = '11222333';
estabelecimentoColumns[1] = '0001';
estabelecimentoColumns[2] = '81';
estabelecimentoColumns[3] = '1';
estabelecimentoColumns[4] = 'NOME FANTASIA QUE NAO PODE PERSISTIR';
estabelecimentoColumns[5] = '02';
estabelecimentoColumns[10] = '20200101';
estabelecimentoColumns[11] = '6201501';
estabelecimentoColumns[12] = '6202300,6203100';
estabelecimentoColumns[13] = 'RUA';
estabelecimentoColumns[14] = 'SEGREDO';
estabelecimentoColumns[15] = '123';
estabelecimentoColumns[18] = '01001000';
estabelecimentoColumns[19] = 'SP';
estabelecimentoColumns[20] = '7107';
estabelecimentoColumns[21] = '11';
estabelecimentoColumns[22] = '99999999';
estabelecimentoColumns[27] = 'nao-persistir@example.com';
const estabelecimentoLine = quotedRow(estabelecimentoColumns);

function materializationGuard(maxAdditionalBytesRead = 10_000_000, maxRowsRehydrated = 10_000) {
  return createBrReceitaNationalMaterializationGuard({
    maxAdditionalBytesRead,
    maxRowsRehydrated,
  });
}

interface InstrumentedFileSystem {
  readonly fileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly openCalls: () => number;
  readonly closeCalls: () => number;
}

function fsFor(files: Readonly<Record<string, string>>): InstrumentedFileSystem {
  let nextHandle = 1;
  let opens = 0;
  let closes = 0;
  const pathByHandle = new Map<number, string>();
  return {
    openCalls: () => opens,
    closeCalls: () => closes,
    fileSystem: {
      size(path) {
        return Buffer.byteLength(files[path] ?? '', 'latin1');
      },
      open(path) {
        if (!(path in files)) throw new Error('missing');
        opens += 1;
        const handle = nextHandle;
        nextHandle += 1;
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
        closes += 1;
      },
    },
  };
}

const descriptors: readonly BrazilReceitaFullJoinSourceFileDescriptor[] = [
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
];

function writerRecorder(): {
  readonly writer: BrReceitaExistingRunChunkWriter;
  readonly snapshots: BrReceitaPersistedSnapshot[];
} {
  const snapshots: BrReceitaPersistedSnapshot[] = [];
  return {
    snapshots,
    writer: {
      async push(snapshot) {
        snapshots.push(snapshot);
      },
      async commitChunk() {
        return {
          acceptedRows: snapshots.length,
          writtenRows: snapshots.length,
          batchWrites: 0,
          collapsedInBatchCount: 0,
          pendingRows: snapshots.length,
          finalized: true,
        };
      },
      async publishFinalChunk() {
        return {
          acceptedRows: snapshots.length,
          writtenRows: snapshots.length,
          batchWrites: 0,
          collapsedInBatchCount: 0,
          pendingRows: snapshots.length,
          finalized: true,
        };
      },
      stats() {
        return {
          acceptedRows: snapshots.length,
          writtenRows: snapshots.length,
          batchWrites: 0,
          collapsedInBatchCount: 0,
          pendingRows: snapshots.length,
          finalized: false,
        };
      },
    },
  };
}

test('referenced row reader reads only the declared byte slice and reuses its handle', () => {
  const prefix = 'ignored-prefix';
  const source = `${prefix}${empresaLine}ignored-suffix`;
  const fs = fsFor({ '/opaque/empresa': source });
  const ledger = createBrazilReceitaFullJoinOpenHandleLedger(64);
  const budget = materializationGuard();
  const reader = createBrReceitaReferencedRowReader({
    descriptors: [descriptors[0]!],
    fileSystem: fs.fileSystem,
    openHandleLedger: ledger,
    materializationGuard: budget,
    maxRowBytes: 64 * 1024,
  });

  const reference = {
    sourceFileOrdinal: 0,
    family: 'empresas' as const,
    byteOffset: Buffer.byteLength(prefix, 'latin1'),
    byteLength: Buffer.byteLength(empresaLine, 'latin1'),
  };
  assert.equal(reader.read(reference), empresaLine);
  assert.equal(reader.read(reference), empresaLine);
  assert.equal(reader.read(reference), empresaLine);

  assert.equal(fs.openCalls(), 1, 'one descriptor must serve repeated random-access reads');
  assert.deepEqual(budget.observations(), {
    additionalBytesRead: reference.byteLength * 3,
    rowsRehydrated: 3,
  });
  assert.equal(ledger.openNow(), 1);
  reader.closeAll();
  assert.equal(fs.closeCalls(), 1);
  assert.equal(ledger.openNow(), 0);
});

test('materialization bytes are refused before the filesystem read that would exceed the cap', () => {
  const fs = fsFor({ '/opaque/empresa': empresaLine });
  const ledger = createBrazilReceitaFullJoinOpenHandleLedger(64);
  const exactBytes = Buffer.byteLength(empresaLine, 'latin1');
  const budget = materializationGuard(exactBytes, 2);
  const reader = createBrReceitaReferencedRowReader({
    descriptors: [descriptors[0]!],
    fileSystem: fs.fileSystem,
    openHandleLedger: ledger,
    materializationGuard: budget,
    maxRowBytes: 64 * 1024,
  });
  const reference = {
    sourceFileOrdinal: 0,
    family: 'empresas' as const,
    byteOffset: 0,
    byteLength: exactBytes,
  };

  assert.equal(reader.read(reference), empresaLine);
  assert.throws(
    () => reader.read(reference),
    (error: unknown) =>
      error instanceof BrReceitaNationalMatchProjectorError &&
      error.reason === 'materialization_resource_cap_exceeded',
  );
  assert.equal(fs.openCalls(), 1);
  assert.equal(fs.closeCalls(), 1);
  assert.equal(ledger.openNow(), 0);
  assert.equal(budget.breach()?.cap, 'maxAdditionalBytesRead');
});

test('national match is projected through the approved parser and sensitive source fields disappear', async () => {
  const recorder = writerRecorder();
  const fs = fsFor({
    '/opaque/empresa': empresaLine,
    '/opaque/estabelecimento': estabelecimentoLine,
  });
  const ledger = createBrazilReceitaFullJoinOpenHandleLedger(64);
  const budget = materializationGuard();
  const sink = createBrReceitaNationalMatchProjectorSink({
    sourcePeriod: '2026-07',
    sourceYear: 2026,
    descriptors,
    fileSystem: fs.fileSystem,
    openHandleLedger: ledger,
    materializationGuard: budget,
    maxRowBytes: 64 * 1024,
    catalogs: {
      cnaesRows: [
        { codigo: '6201501', descricao: 'Desenvolvimento de programas' },
        { codigo: '6202300', descricao: 'Customizacao' },
      ],
      municipiosRows: [{ codigo: '7107', descricao: 'SAO PAULO' }],
      naturezasRows: [{ codigo: '2062', descricao: 'Sociedade Empresaria Limitada' }],
    },
    writer: recorder.writer,
  });

  await sink.onMatch({
    partitionOrdinal: 7,
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
  await sink.finalize();

  assert.equal(recorder.snapshots.length, 1);
  const persisted = recorder.snapshots[0]!;
  assert.equal(persisted.identity.normalized_tax_id, '11222333000181');
  assert.equal(persisted.payload.legal_name, 'ACME BRASIL LTDA');
  assert.equal(persisted.payload.signals.matrix_branch_flag, '1');
  assert.equal(persisted.payload.signals.cnae_main_code, '6201501');
  assert.equal(persisted.payload.signals.cnae_main_label, 'Desenvolvimento de programas');
  assert.deepEqual(persisted.payload.signals.cnae_secondary_codes, ['6202300', '6203100']);
  assert.equal(persisted.payload.signals.municipality_code, '7107');
  assert.equal(persisted.payload.signals.municipality_name, 'SAO PAULO');
  assert.equal(persisted.payload.signals.uf, 'SP');

  const serialized = JSON.stringify(persisted);
  assert.equal(serialized.includes('99999999'), false);
  assert.equal(serialized.includes('nao-persistir@example.com'), false);
  assert.equal(serialized.includes('SEGREDO'), false);
  assert.equal(serialized.includes('NOME FANTASIA QUE NAO PODE PERSISTIR'), false);
  assert.equal(fs.openCalls(), 2, 'one cached handle per descriptor, not per match');
  assert.equal(fs.closeCalls(), 2);
  assert.equal(ledger.openNow(), 0, 'finalize must release every source descriptor');
  assert.deepEqual(sink.stats(), {
    matchesReceived: 1,
    parserAcceptedRows: 1,
    parserRejectedRows: 0,
    rejectionCounts: {},
    batchesParsed: 1,
    materialization: {
      additionalBytesRead:
        Buffer.byteLength(empresaLine, 'latin1') + Buffer.byteLength(estabelecimentoLine, 'latin1'),
      rowsRehydrated: 2,
    },
    materializationBreach: null,
    finalized: true,
  });
});

test('layout mismatch refuses before a malformed row reaches the approved parser and closes handles', async () => {
  const recorder = writerRecorder();
  const badEmpresa = '"11222333";"ONLY_TWO"';
  const fs = fsFor({
    '/opaque/empresa': badEmpresa,
    '/opaque/estabelecimento': estabelecimentoLine,
  });
  const ledger = createBrazilReceitaFullJoinOpenHandleLedger(64);
  const sink = createBrReceitaNationalMatchProjectorSink({
    sourcePeriod: '2026-07',
    sourceYear: 2026,
    descriptors,
    fileSystem: fs.fileSystem,
    openHandleLedger: ledger,
    materializationGuard: materializationGuard(),
    maxRowBytes: 64 * 1024,
    catalogs: { cnaesRows: [], municipiosRows: [], naturezasRows: [] },
    writer: recorder.writer,
  });

  await assert.rejects(
    async () => {
      await sink.onMatch({
        partitionOrdinal: 0,
        empresaReference: {
          sourceFileOrdinal: 0,
          family: 'empresas',
          byteOffset: 0,
          byteLength: Buffer.byteLength(badEmpresa, 'latin1'),
        },
        estabelecimentoReference: {
          sourceFileOrdinal: 1,
          family: 'estabelecimentos',
          byteOffset: 0,
          byteLength: Buffer.byteLength(estabelecimentoLine, 'latin1'),
        },
      });
    },
    (error: unknown) =>
      error instanceof BrReceitaNationalMatchProjectorError &&
      error.reason === 'empresa_layout_mismatch',
  );
  assert.equal(recorder.snapshots.length, 0);
  assert.equal(ledger.openNow(), 0);
});

test('reference family mismatch fails closed without exposing source data', () => {
  const fs = fsFor({ '/opaque/empresa': empresaLine });
  const ledger = createBrazilReceitaFullJoinOpenHandleLedger(64);
  const reader = createBrReceitaReferencedRowReader({
    descriptors: [descriptors[0]!],
    fileSystem: fs.fileSystem,
    openHandleLedger: ledger,
    materializationGuard: materializationGuard(),
    maxRowBytes: 64 * 1024,
  });
  assert.throws(
    () =>
      reader.read({
        sourceFileOrdinal: 0,
        family: 'estabelecimentos',
        byteOffset: 0,
        byteLength: Buffer.byteLength(empresaLine, 'latin1'),
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalMatchProjectorError &&
      error.reason === 'reference_family_mismatch',
  );
  assert.equal(ledger.openNow(), 0);
});
