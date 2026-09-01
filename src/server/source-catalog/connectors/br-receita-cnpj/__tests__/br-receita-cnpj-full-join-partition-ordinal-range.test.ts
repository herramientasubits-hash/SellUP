/**
 * BR Receita CNPJ — STAGE-3 PARTITION ORDINAL RANGE (BR-RECEITA-CHUNKED-JOIN-RANGE) — tests.
 *
 * The capability under test is one optional window over Stage 3, so a national join can be completed
 * by several sequential executions from one Mac instead of one execution that has to survive from end
 * to end. Everything that could be wrong about it is wrong in a way that would still look green:
 *
 *   1. THE DEFAULT DRIFTED. A run with no range must traverse the whole map exactly as before. Every
 *      ranged assertion below is paired with the same scenario run WITHOUT a range, and the ranged
 *      results are checked against THAT, not against a number written by hand.
 *   2. THE FILTER IS AT THE SINK. A range that only suppressed emission would pass every count-based
 *      assertion while paying the full Stage-3 cost. Proved false with a real read counter: the
 *      instrumented reader port counts ROW RE-READS, which happen only in Stage 3, and a 4-of-16
 *      window must perform exactly a quarter of the full run's.
 *   3. A CHUNK BOUNDARY WAS INVENTED. Every malformed range — half-declared, negative, fractional,
 *      zero, beyond the map — must refuse at `before_first_read` and leave no workspace behind.
 *   4. CHUNKING LOSES OR DUPLICATES MATCHES. The union of 0-3, 4-7, 8-11 and 12-15 is compared to the
 *      full run as a MULTISET of joined-record identities and as a per-partition summary list, so a
 *      missing match and a double-counted match both fail.
 *
 * 100% synthetic and offline. No real manifest, no real dataset, no operator home, no Supabase, no
 * network, no runtime, no Agent 1, no migration, no national load. Every key is an opaque `SYN_K`
 * marker, so this file contains no identifier-shaped digit run.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  runBrazilReceitaFullJoinStreamingEngineOnce,
  type BrazilReceitaFullJoinEngineRequest,
  type BrazilReceitaFullJoinEngineResult,
} from '../br-receita-cnpj-full-join-engine';
import {
  brazilReceitaFullJoinPartitionOrdinalBounds,
  createBrazilReceitaFullJoinNullBenchmarkSink,
  resolveBrazilReceitaFullJoinPartitionOrdinalRange,
  type BrazilReceitaFullJoinBoundedJoinedRecord,
  type BrazilReceitaFullJoinSink,
} from '../br-receita-cnpj-full-join-engine-contract';
import {
  brazilReceitaFullJoinFixtureRunDefaults,
  brazilReceitaFullJoinSyntheticKey,
  brazilReceitaFullJoinSyntheticKeysInOnePartition,
  computeBrazilReceitaFullJoinSyntheticOracle,
  createBrazilReceitaFullJoinFixture,
  type BrazilReceitaFullJoinFixtureHandle,
  type BrazilReceitaFullJoinFixtureScenario,
} from '../br-receita-cnpj-full-join-engine-fixtures';
import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-engine-fs';
import { createBrazilReceitaFullJoinOpenHandleLedger } from '../br-receita-cnpj-full-join-open-handle-ledger';
import { createBrazilReceitaFullJoinResourceProcessDependencies } from '../br-receita-cnpj-full-join-resource-envelope';
import type { BrazilReceitaFullJoinReaderFileSystem } from '../br-receita-cnpj-full-join-streaming-reader';

// ─── Harness ──────────────────────────────────────────────────────────────────

const MEGABYTE = 1024 * 1024;

/** The map every engine test in this file joins over. Sixteen, so 4-of-16 is exactly a quarter. */
const PARTITION_COUNT = 16;

/**
 * The chunk size the sequential reader is given.
 *
 * Doubles as the DISCRIMINATOR for the read counter below: the reference passes always ask for
 * exactly `maxChunkBytes`, while a Stage-3 row re-read asks for that one row's byte length. Synthetic
 * rows here are two orders of magnitude shorter, so `length === CHUNK_BYTES` identifies a sequential
 * read and anything else identifies a row re-read. It is an equality on a constant, not a heuristic.
 */
const CHUNK_BYTES = 4096;

function generousResourceCaps(overrides: Record<string, unknown> = {}) {
  return {
    maxRssBytes: 8 * 1024 * MEGABYTE,
    maxHeapUsedBytes: 2 * 1024 * MEGABYTE,
    maxExternalMemoryBytes: 2 * 1024 * MEGABYTE,
    maxRuntimeMs: 10 * 60 * 1000,
    maxPhaseRuntimeMs: 10 * 60 * 1000,
    maxTemporaryStorageBytes: 256 * 1024,
    maxFilesOpened: 256,
    maxBytesRead: 10 * 1000 * 1000,
    maxRowsRead: 100 * 1000,
    maxJoinKeysInMemory: 1000,
    maxOutputRows: 0,
    ...overrides,
  };
}

function readerCaps() {
  return {
    maxChunkBytes: CHUNK_BYTES,
    maxCarryBytes: 4 * 1024,
    maxRowBytes: 4 * 1024,
    maxColumnsPerRow: 64,
  };
}

/**
 * Caps that PIN the map at sixteen.
 *
 * `maxPartitionCount` equals `partitionCount`, so the controlled repartition can never fire and every
 * assertion about ordinal 4 is an assertion about the same ordinal 4 in every run of this file. That
 * is the same invariant the operator holds for the national import, at test scale.
 */
function pinnedPartitioningCaps(overrides: Record<string, number> = {}) {
  return {
    partitionCount: PARTITION_COUNT,
    maxPartitionCount: PARTITION_COUNT,
    maxPartitionDepth: 1,
    maxReferencesPerPartition: 4000,
    maxReferenceBytesPerPartition: 64 * 1024,
    ...overrides,
  };
}

let handles: BrazilReceitaFullJoinFixtureHandle[] = [];

function fixture(scenario: BrazilReceitaFullJoinFixtureScenario): BrazilReceitaFullJoinFixtureHandle {
  const handle = createBrazilReceitaFullJoinFixture(scenario);
  handles.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of handles) handle.dispose();
  handles = [];
});

function engineRequest(
  handle: BrazilReceitaFullJoinFixtureHandle,
  overrides: Partial<BrazilReceitaFullJoinEngineRequest> = {},
): BrazilReceitaFullJoinEngineRequest {
  return {
    sources: handle.sources,
    readerCaps: readerCaps(),
    partitioningCaps: pinnedPartitioningCaps(),
    resourceCaps: generousResourceCaps(),
    duplicateKeyPolicy: 'pair_with_every_duplicate',
    sink: createBrazilReceitaFullJoinNullBenchmarkSink(),
    readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
    workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    workspaceParentDirectory: handle.workspaceParentDirectory,
    workspaceBoundaries: {
      repositoryRoot: '/workspaces/sellup-worktrees/br-partition-range',
      homeDirectory: '/home/operator',
      datasetRoot: handle.datasetRoot,
    },
    resourceDependencies: createBrazilReceitaFullJoinResourceProcessDependencies(),
    ...brazilReceitaFullJoinFixtureRunDefaults({
      openHandleLedger: createBrazilReceitaFullJoinOpenHandleLedger(256),
    }),
    realDataRun: false,
    sinkMaterializesRows: false,
    ...overrides,
  };
}

/**
 * A reader port that counts, wrapping the REAL one.
 *
 * The counter is the whole performance proof: `rowReads` are the positional single-row reads Stage 3
 * performs through `keyOf`, and nothing else in the engine performs one. Instrumentation only — every
 * call is forwarded to the real filesystem, so the run under measurement is the real run.
 */
interface CountingReader {
  readonly port: BrazilReceitaFullJoinReaderFileSystem;
  sequentialReads(): number;
  rowReads(): number;
}

function countingReader(): CountingReader {
  const real = createBrazilReceitaFullJoinReaderFileSystem();
  let sequential = 0;
  let rows = 0;
  return {
    port: {
      size: (filePath) => real.size(filePath),
      open: (filePath) => real.open(filePath),
      read: (handle, buffer, bufferOffset, length, position) => {
        if (length === CHUNK_BYTES) sequential += 1;
        else rows += 1;
        return real.read(handle, buffer, bufferOffset, length, position);
      },
      close: (handle) => real.close(handle),
    },
    sequentialReads: () => sequential,
    rowReads: () => rows,
  };
}

/** A sink that records the IDENTITY of every joined record, so two runs can be compared exactly. */
interface RecordingSink {
  readonly sink: BrazilReceitaFullJoinSink;
  identities(): readonly string[];
  ordinals(): readonly number[];
}

function joinedRecordIdentity(record: BrazilReceitaFullJoinBoundedJoinedRecord): string {
  const side = (reference: BrazilReceitaFullJoinBoundedJoinedRecord['empresaReference']): string =>
    `${reference.family}#${reference.sourceFileOrdinal}@${reference.byteOffset}+${reference.byteLength}`;
  return `${side(record.empresaReference)}::${side(record.estabelecimentoReference)}::p${record.partitionOrdinal}`;
}

function recordingSink(): RecordingSink {
  const seen: string[] = [];
  const ordinals: number[] = [];
  return {
    sink: {
      onMatch(record) {
        seen.push(joinedRecordIdentity(record));
        ordinals.push(record.partitionOrdinal);
      },
      finalize() {
        return undefined;
      },
    },
    identities: () => [...seen],
    ordinals: () => [...ordinals],
  };
}

function summaryOrdinals(result: BrazilReceitaFullJoinEngineResult): readonly number[] {
  return result.partitionSummaries.map((summary) => summary.partitionOrdinal);
}

function ascending(values: readonly number[]): readonly number[] {
  return [...values].sort((left, right) => left - right);
}

/** One empresa row and one estabelecimento row in EVERY ordinal of the pinned map. */
function uniformScenario(): BrazilReceitaFullJoinFixtureScenario {
  const keys = Array.from({ length: PARTITION_COUNT }, (_, ordinal) => {
    const [key] = brazilReceitaFullJoinSyntheticKeysInOnePartition(1, PARTITION_COUNT, ordinal);
    assert.ok(key !== undefined, `no synthetic key lands in ordinal ${ordinal}`);
    return key;
  });
  const rows = keys.map((key) => ({ key }));
  return {
    files: [
      { family: 'empresas', rows },
      { family: 'estabelecimentos', rows },
    ],
  };
}

/**
 * A scenario with everything the join has to get right, spread across the map: matches, an
 * establishment with no company, a company with no establishment, duplicate company keys, an invalid
 * key and a malformed row.
 */
function mixedScenario(): BrazilReceitaFullJoinFixtureScenario {
  const companyKeys = Array.from({ length: 40 }, (_, index) =>
    brazilReceitaFullJoinSyntheticKey(index + 1),
  );
  return {
    files: [
      {
        family: 'empresas',
        rows: [
          ...companyKeys.map((key) => ({ key })),
          // Duplicates, paired rather than dropped by the declared policy.
          { key: companyKeys[3]! },
          { key: companyKeys[17]! },
          { key: '' },
          { key: brazilReceitaFullJoinSyntheticKey(900), columnCount: 3 },
        ],
      },
      {
        family: 'estabelecimentos',
        rows: [
          // Every company except the last four: those become companies without an establishment.
          ...companyKeys.slice(0, 36).map((key) => ({ key })),
          // Two establishments for one company.
          { key: companyKeys[5]! },
          // Orphans: no company carries these.
          { key: brazilReceitaFullJoinSyntheticKey(700) },
          { key: brazilReceitaFullJoinSyntheticKey(701) },
          { key: '' },
        ],
      },
    ],
  };
}

// ─── 1 · The pure range contract ──────────────────────────────────────────────

describe('BR-RECEITA-CHUNKED-JOIN-RANGE — range resolution refuses rather than repairs', () => {
  const declaredPartitionCount = 1024;

  it('resolves to NO range when neither field is supplied, which is the pre-existing behaviour', () => {
    for (const input of [
      { start: undefined, count: undefined },
      { start: null, count: null },
    ]) {
      const resolution = resolveBrazilReceitaFullJoinPartitionOrdinalRange({
        ...input,
        declaredPartitionCount,
      });
      assert.equal(resolution.ok, true);
      assert.equal(resolution.ok && resolution.range, null);
    }
  });

  it('accepts a well-formed range and returns it verbatim', () => {
    const resolution = resolveBrazilReceitaFullJoinPartitionOrdinalRange({
      start: 256,
      count: 256,
      declaredPartitionCount,
    });
    assert.equal(resolution.ok, true);
    assert.deepEqual(resolution.ok ? resolution.range : null, { start: 256, count: 256 });
  });

  it('refuses a HALF-declared range instead of inventing the missing half', () => {
    const startOnly = resolveBrazilReceitaFullJoinPartitionOrdinalRange({
      start: 4,
      count: undefined,
      declaredPartitionCount,
    });
    assert.equal(startOnly.ok, false);
    assert.deepEqual(startOnly.ok ? [] : startOnly.rejections, [
      { field: 'partitionOrdinalCount', reason: 'range_partially_declared' },
    ]);

    const countOnly = resolveBrazilReceitaFullJoinPartitionOrdinalRange({
      start: undefined,
      count: 4,
      declaredPartitionCount,
    });
    assert.equal(countOnly.ok, false);
    assert.deepEqual(countOnly.ok ? [] : countOnly.rejections, [
      { field: 'partitionOrdinalStart', reason: 'range_partially_declared' },
    ]);
  });

  it('refuses every malformed value, naming the field and the reason', () => {
    const cases: ReadonlyArray<{
      readonly start: unknown;
      readonly count: unknown;
      readonly expected: { readonly field: string; readonly reason: string };
    }> = [
      { start: -1, count: 4, expected: { field: 'partitionOrdinalStart', reason: 'range_start_negative' } },
      { start: 4, count: 0, expected: { field: 'partitionOrdinalCount', reason: 'range_count_not_positive' } },
      { start: 4, count: -3, expected: { field: 'partitionOrdinalCount', reason: 'range_count_not_positive' } },
      { start: 1.5, count: 4, expected: { field: 'partitionOrdinalStart', reason: 'range_start_not_an_integer' } },
      { start: 4, count: 2.5, expected: { field: 'partitionOrdinalCount', reason: 'range_count_not_an_integer' } },
      { start: '4', count: 4, expected: { field: 'partitionOrdinalStart', reason: 'range_start_not_a_number' } },
      { start: 4, count: '4', expected: { field: 'partitionOrdinalCount', reason: 'range_count_not_a_number' } },
      { start: Number.NaN, count: 4, expected: { field: 'partitionOrdinalStart', reason: 'range_start_not_finite' } },
      { start: 4, count: Number.POSITIVE_INFINITY, expected: { field: 'partitionOrdinalCount', reason: 'range_count_not_finite' } },
      {
        start: declaredPartitionCount,
        count: 1,
        expected: { field: 'partitionOrdinalStart', reason: 'range_start_above_declared_partition_count' },
      },
      {
        // `start + count` past the safe-integer range: the Stage-3 clamp would stop being arithmetic.
        start: 1,
        count: Number.MAX_SAFE_INTEGER,
        expected: { field: 'partitionOrdinalCount', reason: 'range_count_not_safely_clampable' },
      },
    ];

    for (const testCase of cases) {
      const resolution = resolveBrazilReceitaFullJoinPartitionOrdinalRange({
        start: testCase.start,
        count: testCase.count,
        declaredPartitionCount,
      });
      assert.equal(resolution.ok, false, JSON.stringify(testCase));
      assert.deepEqual(
        resolution.ok ? [] : resolution.rejections,
        [testCase.expected],
        JSON.stringify(testCase),
      );
    }
  });

  it('accepts a count whose sum with start is exactly the largest safe integer', () => {
    const resolution = resolveBrazilReceitaFullJoinPartitionOrdinalRange({
      start: 0,
      count: Number.MAX_SAFE_INTEGER,
      declaredPartitionCount,
    });
    assert.equal(resolution.ok, true);
    // Representable, therefore clampable: the Stage-3 end becomes the map itself.
    assert.deepEqual(
      brazilReceitaFullJoinPartitionOrdinalBounds(
        resolution.ok ? resolution.range : null,
        declaredPartitionCount,
      ),
      { start: 0, endExclusive: declaredPartitionCount },
    );
  });

  it('clamps the END down to the map and never up, and leaves the absent case as the whole map', () => {
    assert.deepEqual(brazilReceitaFullJoinPartitionOrdinalBounds(null, 16), {
      start: 0,
      endExclusive: 16,
    });
    assert.deepEqual(brazilReceitaFullJoinPartitionOrdinalBounds({ start: 4, count: 3 }, 16), {
      start: 4,
      endExclusive: 7,
    });
    assert.deepEqual(brazilReceitaFullJoinPartitionOrdinalBounds({ start: 12, count: 4 }, 16), {
      start: 12,
      endExclusive: 16,
    });
    // Asking for more than the map holds gets the map, not a walk off the end.
    assert.deepEqual(brazilReceitaFullJoinPartitionOrdinalBounds({ start: 12, count: 99 }, 16), {
      start: 12,
      endExclusive: 16,
    });
  });
});

// ─── 2 · The default must be the old behaviour ────────────────────────────────

describe('BR-RECEITA-CHUNKED-JOIN-RANGE — default regression', () => {
  it('a run with NO range traverses every ordinal and agrees with the independent oracle', async () => {
    const scenario = mixedScenario();
    const sink = recordingSink();
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), { sink: sink.sink }),
    );

    const oracle = computeBrazilReceitaFullJoinSyntheticOracle(scenario);
    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    assert.equal(result.exact.partitionsCreated, PARTITION_COUNT);
    assert.equal(result.exact.partitionDepthReached, 0);
    assert.deepEqual(
      summaryOrdinals(result),
      Array.from({ length: PARTITION_COUNT }, (_, ordinal) => ordinal),
      'the default must visit every ordinal of the map, in order',
    );
    assert.deepEqual(result.executedPartitionOrdinalRange, { start: 0, endExclusive: PARTITION_COUNT });
    assert.deepEqual(result.partitionOrdinalRangeRejections, []);

    assert.equal(result.exact.matchesEmitted, oracle.expectedMatches);
    assert.equal(sink.identities().length, oracle.expectedMatches);
    assert.equal(result.exact.orphanEstabelecimentoCount, oracle.expectedOrphanEstablishments);
    assert.equal(
      result.exact.empresaKeysWithoutEstabelecimento,
      oracle.expectedCompaniesWithoutEstablishment,
    );
    assert.equal(result.exact.duplicateEmpresaKeyCount, oracle.expectedDuplicateCompanyKeys);
    assert.equal(result.exact.invalidKeyCount > 0, true);
    assert.equal(result.exact.malformedRowCount, oracle.expectedMalformedRows);
    assert.equal(result.publicReport.every_source_traversed_to_end_of_file, true);
    assert.equal(result.cleanupOutcome, 'completed');
  });
});

// ─── 3 · Ranged execution ─────────────────────────────────────────────────────

describe('BR-RECEITA-CHUNKED-JOIN-RANGE — a range selects ordinals, at the loop', () => {
  it('start=4 count=3 does Stage-3 work for ordinals 4, 5 and 6 and for no others', async () => {
    const scenario = mixedScenario();
    const handle = fixture(scenario);
    const sink = recordingSink();
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { sink: sink.sink, partitionOrdinalStart: 4, partitionOrdinalCount: 3 }),
    );

    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    assert.deepEqual(result.executedPartitionOrdinalRange, { start: 4, endExclusive: 7 });
    assert.deepEqual(summaryOrdinals(result), [4, 5, 6]);
    // The sink is downstream of the work, so this is a consequence and not the proof; the proof is
    // the read counter in § 5.
    assert.deepEqual([...new Set(sink.ordinals())].sort(), [4, 5, 6].filter((ordinal) =>
      sink.ordinals().includes(ordinal),
    ));
    for (const ordinal of sink.ordinals()) {
      assert.ok(ordinal >= 4 && ordinal < 7, `ordinal ${ordinal} is outside the declared range`);
    }
    // The input is still scanned in full: chunking saves Stage-3 work, and claiming otherwise would
    // be the one dishonest thing this capability could say.
    assert.equal(result.publicReport.every_source_traversed_to_end_of_file, true);
    assert.equal(result.exact.partitionsCreated, PARTITION_COUNT);
    assert.equal(result.cleanupOutcome, 'completed');
  });

  it('the FIRST range starts at zero and stops before the rest of the map', async () => {
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(mixedScenario()), {
        partitionOrdinalStart: 0,
        partitionOrdinalCount: 4,
      }),
    );
    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    assert.deepEqual(result.executedPartitionOrdinalRange, { start: 0, endExclusive: 4 });
    assert.deepEqual(summaryOrdinals(result), [0, 1, 2, 3]);
  });

  it('the LAST range reaches the final ordinal and is clamped to the map', async () => {
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(mixedScenario()), {
        partitionOrdinalStart: 12,
        partitionOrdinalCount: 4,
      }),
    );
    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    assert.deepEqual(result.executedPartitionOrdinalRange, { start: 12, endExclusive: 16 });
    assert.deepEqual(summaryOrdinals(result), [12, 13, 14, 15]);
  });

  it('a count that overruns the map is clamped DOWN rather than refused or walked off the end', async () => {
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(mixedScenario()), {
        partitionOrdinalStart: 14,
        partitionOrdinalCount: 64,
      }),
    );
    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    assert.deepEqual(result.executedPartitionOrdinalRange, { start: 14, endExclusive: 16 });
    assert.deepEqual(summaryOrdinals(result), [14, 15]);
  });
});

// ─── 4 · Malformed ranges fail closed ─────────────────────────────────────────

describe('BR-RECEITA-CHUNKED-JOIN-RANGE — an invalid range refuses before the first read', () => {
  const invalid: ReadonlyArray<{
    readonly label: string;
    readonly overrides: Partial<BrazilReceitaFullJoinEngineRequest>;
    readonly reason: string;
  }> = [
    {
      label: 'negative start',
      overrides: { partitionOrdinalStart: -1, partitionOrdinalCount: 4 },
      reason: 'range_start_negative',
    },
    {
      label: 'zero count',
      overrides: { partitionOrdinalStart: 0, partitionOrdinalCount: 0 },
      reason: 'range_count_not_positive',
    },
    {
      label: 'negative count',
      overrides: { partitionOrdinalStart: 0, partitionOrdinalCount: -4 },
      reason: 'range_count_not_positive',
    },
    {
      label: 'fractional start',
      overrides: { partitionOrdinalStart: 2.5, partitionOrdinalCount: 4 },
      reason: 'range_start_not_an_integer',
    },
    {
      label: 'fractional count',
      overrides: { partitionOrdinalStart: 2, partitionOrdinalCount: 1.5 },
      reason: 'range_count_not_an_integer',
    },
    {
      label: 'start at the map size',
      overrides: { partitionOrdinalStart: PARTITION_COUNT, partitionOrdinalCount: 1 },
      reason: 'range_start_above_declared_partition_count',
    },
    {
      label: 'start beyond the map size',
      overrides: { partitionOrdinalStart: PARTITION_COUNT + 8, partitionOrdinalCount: 1 },
      reason: 'range_start_above_declared_partition_count',
    },
    {
      label: 'start without a count',
      overrides: { partitionOrdinalStart: 4 },
      reason: 'range_partially_declared',
    },
    {
      label: 'count without a start',
      overrides: { partitionOrdinalCount: 4 },
      reason: 'range_partially_declared',
    },
  ];

  for (const testCase of invalid) {
    it(`refuses ${testCase.label} at before_first_read, with no workspace and no rows read`, async () => {
      const reader = countingReader();
      const sink = recordingSink();
      const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
        engineRequest(fixture(mixedScenario()), {
          ...testCase.overrides,
          readerFileSystem: reader.port,
          sink: sink.sink,
        }),
      );

      assert.equal(result.exitStatus, 'aborted');
      assert.equal(result.abortCode, 'partition_ordinal_range_invalid');
      assert.equal(result.abortStage, 'before_first_read');
      assert.deepEqual(
        result.partitionOrdinalRangeRejections.map((rejection) => rejection.reason),
        [testCase.reason],
      );
      // Fail-closed means nothing happened: no ordinal was executed, no byte was read, no match was
      // emitted, and no temporary workspace was created to have to clean up.
      assert.equal(result.executedPartitionOrdinalRange, null);
      assert.deepEqual(result.partitionSummaries, []);
      assert.equal(reader.sequentialReads(), 0);
      assert.equal(reader.rowReads(), 0);
      assert.equal(sink.identities().length, 0);
      assert.equal(result.exact.matchesEmitted, 0);
      assert.equal(result.publicReport.cleanup.cleanup_required, false);
    });
  }
});

// ─── 5 · The performance proof ────────────────────────────────────────────────

describe('BR-RECEITA-CHUNKED-JOIN-RANGE — a 4-of-16 window does a quarter of the Stage-3 work', () => {
  /**
   * Counters, not timings.
   *
   * The uniform scenario puts exactly one empresa row and one estabelecimento row in every ordinal,
   * so the full run's Stage-3 row re-reads are exactly `2 × 16` and a four-ordinal window's are
   * exactly `2 × 4`. Any row re-read outside the window would push the ranged figure ABOVE eight, so
   * the equality is simultaneously the ratio proof and the "no out-of-range work" proof.
   */
  it('counts row re-reads, and the ratio is 4/16 rather than 16/16', async () => {
    const scenario = uniformScenario();

    const fullReader = countingReader();
    const full = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), { readerFileSystem: fullReader.port }),
    );
    assert.equal(full.exitStatus, 'completed', JSON.stringify(full.abortCode));
    assert.equal(full.exact.partitionsCreated, PARTITION_COUNT);
    assert.equal(fullReader.rowReads(), 2 * PARTITION_COUNT);

    const rangedReader = countingReader();
    const ranged = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), {
        readerFileSystem: rangedReader.port,
        partitionOrdinalStart: 4,
        partitionOrdinalCount: 4,
      }),
    );
    assert.equal(ranged.exitStatus, 'completed', JSON.stringify(ranged.abortCode));
    assert.deepEqual(ranged.executedPartitionOrdinalRange, { start: 4, endExclusive: 8 });
    assert.equal(rangedReader.rowReads(), 2 * 4);

    // Stated as the ratio the capability claims, so a future change that halves the saving fails here
    // rather than passing on an absolute number nobody re-derives.
    assert.equal(rangedReader.rowReads() * (PARTITION_COUNT / 4), fullReader.rowReads());

    // And the honest other half: the sequential passes are NOT reduced, because they cannot be.
    assert.equal(rangedReader.sequentialReads(), fullReader.sequentialReads());
    assert.equal(ranged.exact.empresaRowsTraversed, full.exact.empresaRowsTraversed);
    assert.equal(ranged.exact.estabelecimentoRowsTraversed, full.exact.estabelecimentoRowsTraversed);
  });
});

// ─── 6 · Range + failure ──────────────────────────────────────────────────────

describe('BR-RECEITA-CHUNKED-JOIN-RANGE — failure semantics inside a range are unchanged', () => {
  it('a throwing sink still aborts the ranged run as sink_failed, and cleanup still runs', async () => {
    const throwing: BrazilReceitaFullJoinSink = {
      onMatch() {
        throw new Error('scripted sink failure');
      },
      finalize() {
        return undefined;
      },
    };
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(uniformScenario()), {
        sink: throwing,
        partitionOrdinalStart: 4,
        partitionOrdinalCount: 4,
      }),
    );
    assert.equal(result.abortCode, 'sink_failed');
    assert.equal(result.abortStage, 'partitioned_join');
    assert.equal(result.cleanupOutcome, 'completed');
    assert.equal(result.publicReport.cleanup_verified_absent, true);
  });

  it('a duplicate under the reject policy aborts when it is INSIDE the range', async () => {
    // Two empresa rows with the same key, in a known ordinal, and a range that contains it.
    const [key] = brazilReceitaFullJoinSyntheticKeysInOnePartition(1, PARTITION_COUNT, 5);
    assert.ok(key !== undefined);
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: [{ key }, { key }] },
        { family: 'estabelecimentos', rows: [{ key }] },
      ],
    };
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), {
        duplicateKeyPolicy: 'reject',
        partitionOrdinalStart: 4,
        partitionOrdinalCount: 4,
      }),
    );
    assert.equal(result.abortCode, 'duplicate_empresa_key_rejected');
    assert.equal(result.abortStage, 'partitioned_join');
    assert.equal(result.cleanupOutcome, 'completed');
  });

  it('the same duplicate OUTSIDE the range is never loaded, so that execution completes', async () => {
    const [key] = brazilReceitaFullJoinSyntheticKeysInOnePartition(1, PARTITION_COUNT, 5);
    assert.ok(key !== undefined);
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: [{ key }, { key }] },
        { family: 'estabelecimentos', rows: [{ key }] },
      ],
    };
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), {
        duplicateKeyPolicy: 'reject',
        partitionOrdinalStart: 8,
        partitionOrdinalCount: 4,
      }),
    );
    // Not a softened policy: the rows for ordinal 5 are still on disk and still a rejection — this
    // execution simply does not own that ordinal, and the execution that does will refuse.
    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    assert.deepEqual(summaryOrdinals(result), [8, 9, 10, 11]);
    assert.equal(result.exact.duplicateEmpresaKeyCount, 0);
  });
});

// ─── 7 · Multi-range equivalence ──────────────────────────────────────────────

describe('BR-RECEITA-CHUNKED-JOIN-RANGE — four chunks equal one full run', () => {
  it('the union of 0-3, 4-7, 8-11 and 12-15 is the full join, with nothing missing or duplicated', async () => {
    const scenario = mixedScenario();

    const fullSink = recordingSink();
    const full = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), { sink: fullSink.sink }),
    );
    assert.equal(full.exitStatus, 'completed', JSON.stringify(full.abortCode));

    const chunkStarts = [0, 4, 8, 12] as const;
    const chunkIdentities: string[] = [];
    const chunkSummaries: BrazilReceitaFullJoinEngineResult['partitionSummaries'][number][] = [];
    let chunkMatches = 0;
    let chunkOrphans = 0;
    let chunkCompaniesWithoutEstablishment = 0;

    for (const start of chunkStarts) {
      const sink = recordingSink();
      const chunk = await runBrazilReceitaFullJoinStreamingEngineOnce(
        engineRequest(fixture(scenario), {
          sink: sink.sink,
          partitionOrdinalStart: start,
          partitionOrdinalCount: 4,
        }),
      );
      assert.equal(chunk.exitStatus, 'completed', JSON.stringify(chunk.abortCode));
      assert.deepEqual(chunk.executedPartitionOrdinalRange, { start, endExclusive: start + 4 });
      assert.deepEqual(summaryOrdinals(chunk), [start, start + 1, start + 2, start + 3]);
      // The map must be the same one in every chunk, or the ordinals do not mean the same thing.
      assert.equal(chunk.exact.partitionsCreated, PARTITION_COUNT);
      assert.equal(chunk.exact.partitionDepthReached, 0);

      chunkIdentities.push(...sink.identities());
      chunkSummaries.push(...chunk.partitionSummaries);
      chunkMatches += chunk.exact.matchesEmitted;
      chunkOrphans += chunk.exact.orphanEstabelecimentoCount;
      chunkCompaniesWithoutEstablishment += chunk.exact.empresaKeysWithoutEstabelecimento;
    }

    // MULTISET equality, not set equality: a duplicated match would survive a set comparison.
    assert.deepEqual(
      [...chunkIdentities].sort(),
      [...fullSink.identities()].sort(),
      'the chunked union must be exactly the full join — no missing rows, no extra rows',
    );
    assert.equal(new Set(chunkIdentities).size, chunkIdentities.length, 'no chunk may re-emit a match');

    // Every per-partition observation agrees too, which covers the counts the sink never sees.
    assert.deepEqual(
      [...chunkSummaries].sort((left, right) => left.partitionOrdinal - right.partitionOrdinal),
      [...full.partitionSummaries].sort((left, right) => left.partitionOrdinal - right.partitionOrdinal),
    );
    assert.equal(chunkMatches, full.exact.matchesEmitted);
    assert.equal(chunkOrphans, full.exact.orphanEstabelecimentoCount);
    assert.equal(
      chunkCompaniesWithoutEstablishment,
      full.exact.empresaKeysWithoutEstabelecimento,
    );

    const oracle = computeBrazilReceitaFullJoinSyntheticOracle(scenario);
    assert.equal(chunkMatches, oracle.expectedMatches);
    assert.equal(chunkOrphans, oracle.expectedOrphanEstablishments);
    assert.equal(
      chunkCompaniesWithoutEstablishment,
      oracle.expectedCompaniesWithoutEstablishment,
    );

    // And the ordinals covered by the four chunks are the map, exactly once each.
    assert.deepEqual(
      ascending(chunkSummaries.map((summary) => summary.partitionOrdinal)),
      Array.from({ length: PARTITION_COUNT }, (_, ordinal) => ordinal),
    );
  });
});
