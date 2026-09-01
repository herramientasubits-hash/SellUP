import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrReceitaNationalChunkCheckpointError,
  brReceitaNationalChunkCheckpointComplete,
  brReceitaNationalChunkCheckpointNextGap,
  createBrReceitaNationalChunkCheckpoint,
  parseBrReceitaNationalChunkCheckpoint,
  recordBrReceitaLoadedNationalChunk,
} from '../br-receita-cnpj-national-chunk-checkpoint';
import type { BrReceitaNationalChunkLoadedResult } from '../br-receita-cnpj-national-chunk-loader';

const RUN_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_RUN_ID = '44444444-4444-4444-8444-444444444444';
const INVENTORY_FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const OTHER_INVENTORY_FINGERPRINT = `sha256:${'b'.repeat(64)}`;

function loaded(
  start: number,
  count: number,
  snapshotRunId = RUN_ID,
  sourcePeriod = '2026-07',
  inventoryFingerprint = INVENTORY_FINGERPRINT,
): BrReceitaNationalChunkLoadedResult {
  return {
    status: 'loaded_not_published',
    snapshotRunId,
    sourcePeriod,
    inventoryFingerprint,
    partitionOrdinalStart: start,
    partitionOrdinalCount: count,
    partitionOrdinalEndExclusive: start + count,
    engine: {
      exitStatus: 'completed',
      exact: { partitionsCreated: 1024, partitionDepthReached: 0 },
      partitionSummaries: [],
      executedPartitionOrdinalRange: { start, endExclusive: start + count },
    } as BrReceitaNationalChunkLoadedResult['engine'],
    projector: {
      matchesReceived: 0,
      parserAcceptedRows: 0,
      parserRejectedRows: 0,
      rejectionCounts: {},
      batchesParsed: 0,
      materialization: { additionalBytesRead: 0, rowsRehydrated: 0 },
      materializationBreach: null,
      finalized: true,
    },
    writer: {
      acceptedRows: 0,
      writtenRows: 0,
      batchWrites: 0,
      collapsedInBatchCount: 0,
      pendingRows: 0,
      finalized: true,
    },
    published: false,
  };
}

function createCheckpoint() {
  return createBrReceitaNationalChunkCheckpoint({
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
    inventoryFingerprint: INVENTORY_FINGERPRINT,
  });
}

test('checkpoint starts empty and points to the whole national gap', () => {
  const checkpoint = createCheckpoint();
  assert.equal(checkpoint.inventoryFingerprint, INVENTORY_FINGERPRINT);
  assert.equal(brReceitaNationalChunkCheckpointComplete(checkpoint), false);
  assert.deepEqual(brReceitaNationalChunkCheckpointNextGap(checkpoint), {
    start: 0,
    endExclusive: 1024,
  });
});

test('out-of-order chunks merge only when coverage is contiguous', () => {
  let checkpoint = createCheckpoint();
  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(512, 256) });
  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(0, 256) });

  assert.deepEqual(checkpoint.completedRanges, [
    { start: 0, endExclusive: 256 },
    { start: 512, endExclusive: 768 },
  ]);
  assert.deepEqual(brReceitaNationalChunkCheckpointNextGap(checkpoint), {
    start: 256,
    endExclusive: 512,
  });
  assert.equal(brReceitaNationalChunkCheckpointComplete(checkpoint), false);

  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(256, 256) });
  assert.deepEqual(checkpoint.completedRanges, [{ start: 0, endExclusive: 768 }]);
  assert.deepEqual(brReceitaNationalChunkCheckpointNextGap(checkpoint), {
    start: 768,
    endExclusive: 1024,
  });
});

test('exact replay and overlap are idempotent and cannot create fake coverage', () => {
  let checkpoint = createCheckpoint();
  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(0, 256) });
  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(0, 256) });
  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(128, 256) });

  assert.deepEqual(checkpoint.completedRanges, [{ start: 0, endExclusive: 384 }]);
  assert.equal(brReceitaNationalChunkCheckpointComplete(checkpoint), false);
});

test('only exact 0..1024 coverage becomes complete', () => {
  let checkpoint = createCheckpoint();
  for (const start of [768, 0, 512, 256]) {
    checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(start, 256) });
  }

  assert.deepEqual(checkpoint.completedRanges, [{ start: 0, endExclusive: 1024 }]);
  assert.equal(brReceitaNationalChunkCheckpointComplete(checkpoint), true);
  assert.equal(brReceitaNationalChunkCheckpointNextGap(checkpoint), null);
});

test('a chunk from another run, period or inventory cannot be credited', () => {
  const checkpoint = createCheckpoint();

  assert.throws(
    () =>
      recordBrReceitaLoadedNationalChunk({
        checkpoint,
        chunk: loaded(0, 64, OTHER_RUN_ID),
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkCheckpointError && error.reason === 'chunk_run_mismatch',
  );
  assert.throws(
    () =>
      recordBrReceitaLoadedNationalChunk({
        checkpoint,
        chunk: loaded(0, 64, RUN_ID, '2026-06'),
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkCheckpointError && error.reason === 'chunk_period_mismatch',
  );
  assert.throws(
    () =>
      recordBrReceitaLoadedNationalChunk({
        checkpoint,
        chunk: loaded(0, 64, RUN_ID, '2026-07', OTHER_INVENTORY_FINGERPRINT),
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkCheckpointError &&
      error.reason === 'chunk_inventory_mismatch',
  );
});

test('checkpoint refuses a loaded-shaped chunk whose accounting is internally inconsistent', () => {
  const checkpoint = createCheckpoint();
  const bad = loaded(0, 64);
  const inconsistent = {
    ...bad,
    writer: { ...bad.writer, finalized: false },
  } as BrReceitaNationalChunkLoadedResult;

  assert.throws(
    () => recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: inconsistent }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkCheckpointError &&
      error.reason === 'chunk_accounting_invalid',
  );
});

test('serialized checkpoint is revalidated and canonicalized on resume', () => {
  const parsed = parseBrReceitaNationalChunkCheckpoint(
    JSON.parse(
      JSON.stringify({
        version: 2,
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        inventoryFingerprint: INVENTORY_FINGERPRINT,
        expectedPartitionCount: 1024,
        completedRanges: [
          { start: 256, endExclusive: 512 },
          { start: 0, endExclusive: 256 },
          { start: 256, endExclusive: 512 },
        ],
      }),
    ),
  );
  assert.equal(parsed.inventoryFingerprint, INVENTORY_FINGERPRINT);
  assert.deepEqual(parsed.completedRanges, [{ start: 0, endExclusive: 512 }]);
});

test('a checkpoint claiming another partition map is refused', () => {
  assert.throws(
    () =>
      parseBrReceitaNationalChunkCheckpoint({
        version: 2,
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        inventoryFingerprint: INVENTORY_FINGERPRINT,
        expectedPartitionCount: 2048,
        completedRanges: [],
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkCheckpointError &&
      error.reason === 'checkpoint_partition_count_mismatch',
  );
});

test('checkpoint refuses an absent or malformed inventory fingerprint', () => {
  assert.throws(
    () =>
      parseBrReceitaNationalChunkCheckpoint({
        version: 2,
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        inventoryFingerprint: 'bad',
        expectedPartitionCount: 1024,
        completedRanges: [],
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkCheckpointError &&
      error.reason === 'checkpoint_inventory_fingerprint_invalid',
  );
});
