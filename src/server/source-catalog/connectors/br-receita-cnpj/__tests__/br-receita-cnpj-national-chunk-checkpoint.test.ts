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

function loaded(
  start: number,
  count: number,
  snapshotRunId = RUN_ID,
  sourcePeriod = '2026-07',
): BrReceitaNationalChunkLoadedResult {
  return {
    status: 'loaded_not_published',
    snapshotRunId,
    sourcePeriod,
    partitionOrdinalStart: start,
    partitionOrdinalCount: count,
    partitionOrdinalEndExclusive: start + count,
    engine: {} as BrReceitaNationalChunkLoadedResult['engine'],
    projector: {
      matchesReceived: 0,
      parserAcceptedRows: 0,
      parserRejectedRows: 0,
      rejectionCounts: {},
      batchesParsed: 0,
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

test('checkpoint starts empty and points to the whole national gap', () => {
  const checkpoint = createBrReceitaNationalChunkCheckpoint({
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
  });
  assert.equal(brReceitaNationalChunkCheckpointComplete(checkpoint), false);
  assert.deepEqual(brReceitaNationalChunkCheckpointNextGap(checkpoint), {
    start: 0,
    endExclusive: 1024,
  });
});

test('out-of-order chunks merge only when coverage is contiguous', () => {
  let checkpoint = createBrReceitaNationalChunkCheckpoint({
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
  });
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
  let checkpoint = createBrReceitaNationalChunkCheckpoint({
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
  });
  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(0, 256) });
  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(0, 256) });
  checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(128, 256) });

  assert.deepEqual(checkpoint.completedRanges, [{ start: 0, endExclusive: 384 }]);
  assert.equal(brReceitaNationalChunkCheckpointComplete(checkpoint), false);
});

test('only exact 0..1024 coverage becomes complete', () => {
  let checkpoint = createBrReceitaNationalChunkCheckpoint({
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
  });
  for (const start of [768, 0, 512, 256]) {
    checkpoint = recordBrReceitaLoadedNationalChunk({ checkpoint, chunk: loaded(start, 256) });
  }

  assert.deepEqual(checkpoint.completedRanges, [{ start: 0, endExclusive: 1024 }]);
  assert.equal(brReceitaNationalChunkCheckpointComplete(checkpoint), true);
  assert.equal(brReceitaNationalChunkCheckpointNextGap(checkpoint), null);
});

test('a chunk from another run or period cannot be credited', () => {
  const checkpoint = createBrReceitaNationalChunkCheckpoint({
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
  });

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
});

test('serialized checkpoint is revalidated and canonicalized on resume', () => {
  const parsed = parseBrReceitaNationalChunkCheckpoint(
    JSON.parse(
      JSON.stringify({
        version: 1,
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        expectedPartitionCount: 1024,
        completedRanges: [
          { start: 256, endExclusive: 512 },
          { start: 0, endExclusive: 256 },
          { start: 256, endExclusive: 512 },
        ],
      }),
    ),
  );
  assert.deepEqual(parsed.completedRanges, [{ start: 0, endExclusive: 512 }]);
});

test('a checkpoint claiming another partition map is refused', () => {
  assert.throws(
    () =>
      parseBrReceitaNationalChunkCheckpoint({
        version: 1,
        snapshotRunId: RUN_ID,
        sourcePeriod: '2026-07',
        expectedPartitionCount: 2048,
        completedRanges: [],
      }),
    (error: unknown) =>
      error instanceof BrReceitaNationalChunkCheckpointError &&
      error.reason === 'checkpoint_partition_count_mismatch',
  );
});
