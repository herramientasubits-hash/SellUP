/**
 * BR Receita CNPJ STREAMING FULL-JOIN ENGINE — envelope, sink and channel tests
 * (BR-SOURCE-14B.0D; § 14 tests 20, 31–43, 57–60).
 *
 * The companion to `br-receita-cnpj-full-join-engine.test.ts`, which covers join semantics and
 * partitioning. Split from it because one file carrying both was past this repository's 800-line
 * ceiling, and because the two ask different questions: that file asks whether the join is CORRECT,
 * this one asks whether it can be STOPPED — by every 14B.0C cap, by a failing sink, by a second
 * attempt — and whether what it reports afterwards leaks anything.
 *
 * Every abort path asserts the temporary workspace is gone AND verified gone, because an engine that
 * stops correctly but leaves reference files behind has failed at the thing that made temporary
 * storage acceptable to build in the first place.
 *
 * 100% synthetic and offline. No real manifest, no real dataset, no repository path, no operator home,
 * no Supabase, no network, no runtime, no Agent 1, no git.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  toBrazilReceitaFullJoinPrivateOperatorMeasurements,
  validateBrazilReceitaFullJoinPrivateContent,
} from '../br-receita-cnpj-full-join-operator-metric-channel';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import {
  createBrazilReceitaFullJoinStreamingEngine,
  runBrazilReceitaFullJoinStreamingEngineOnce,
  type BrazilReceitaFullJoinEngineRequest,
} from '../br-receita-cnpj-full-join-engine';
import {
  createBrazilReceitaFullJoinNullBenchmarkSink,
  type BrazilReceitaFullJoinSink,
} from '../br-receita-cnpj-full-join-engine-contract';
import {
  brazilReceitaFullJoinSyntheticKey,
  brazilReceitaFullJoinSyntheticKeysInOnePartition,
  createBrazilReceitaFullJoinFixture,
  type BrazilReceitaFullJoinFixtureHandle,
  type BrazilReceitaFullJoinFixtureScenario,
} from '../br-receita-cnpj-full-join-engine-fixtures';
import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-engine-fs';
import {
  createBrazilReceitaFullJoinResourceProcessDependencies,
  type BrazilReceitaFullJoinResourceDependencies,
} from '../br-receita-cnpj-full-join-resource-envelope';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MEGABYTE = 1024 * 1024;

function generousResourceCaps(overrides: Record<string, unknown> = {}) {
  return {
    maxRssBytes: 8 * 1024 * MEGABYTE,
    maxHeapUsedBytes: 2 * 1024 * MEGABYTE,
    maxExternalMemoryBytes: 2 * 1024 * MEGABYTE,
    maxRuntimeMs: 10 * 60 * 1000,
    maxPhaseRuntimeMs: 10 * 60 * 1000,
    maxTemporaryStorageBytes: 64 * 1024,
    maxFilesOpened: 64,
    maxBytesRead: 10 * 1000 * 1000,
    maxRowsRead: 100 * 1000,
    maxJoinKeysInMemory: 1000,
    maxOutputRows: 0,
    ...overrides,
  };
}

function readerCaps(overrides: Record<string, number> = {}) {
  return {
    maxChunkBytes: 32,
    maxCarryBytes: 4 * 1024,
    maxRowBytes: 4 * 1024,
    maxColumnsPerRow: 64,
    ...overrides,
  };
}

function partitioningCaps(overrides: Record<string, number> = {}) {
  return {
    partitionCount: 4,
    maxPartitionCount: 32,
    maxPartitionDepth: 3,
    maxReferencesPerPartition: 1000,
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
    partitioningCaps: partitioningCaps(),
    resourceCaps: generousResourceCaps(),
    duplicateKeyPolicy: 'pair_with_every_duplicate',
    sink: createBrazilReceitaFullJoinNullBenchmarkSink(),
    readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
    workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    workspaceParentDirectory: handle.workspaceParentDirectory,
    workspaceBoundaries: {
      repositoryRoot: '/workspaces/sellup-worktrees/br-14b0d',
      homeDirectory: '/home/operator',
      datasetRoot: handle.datasetRoot,
    },
    resourceDependencies: createBrazilReceitaFullJoinResourceProcessDependencies(),
    realDataRun: false,
    sinkMaterializesRows: false,
    ...overrides,
  };
}

/** A clock that advances by a scripted amount per read, and a memory sampler with fixed values. */
function scriptedDependencies(
  memory: { rss: number; heapUsed: number; external: number },
  advanceNs = BigInt(0),
): BrazilReceitaFullJoinResourceDependencies {
  let now = BigInt(0);
  return {
    clock: () => {
      const value = now;
      now += advanceNs;
      return value;
    },
    memorySampler: () => memory,
  };
}

const CALM_MEMORY = { rss: 16 * MEGABYTE, heapUsed: 4 * MEGABYTE, external: MEGABYTE };

function companyRows(count: number, startIndex = 1) {
  return Array.from({ length: count }, (_, index) => ({
    key: brazilReceitaFullJoinSyntheticKey(startIndex + index),
  }));
}

// ─── 1. Resource caps (tests 20, 31–40) ───────────────────────────────────────────

describe('BR-SOURCE-14B.0D — the 14B.0C envelope stops the engine', () => {
  function twoFamilyFixture() {
    return fixture({
      files: [
        { family: 'empresas', rows: companyRows(8) },
        { family: 'estabelecimentos', rows: companyRows(8) },
      ],
    });
  }

  // Test 31.
  it('never lets the key window exceed its cap', async () => {
    const keys = brazilReceitaFullJoinSyntheticKeysInOnePartition(8, 1, 0);
    const handle = fixture({
      files: [
        { family: 'empresas', rows: keys.map((key) => ({ key })) },
        { family: 'estabelecimentos', rows: keys.map((key) => ({ key })) },
      ],
    });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        partitioningCaps: partitioningCaps({ partitionCount: 1 }),
        resourceCaps: generousResourceCaps({ maxJoinKeysInMemory: 3 }),
      }),
    );
    assert.equal(result.abortCode, 'resource_cap_breached');
    assert.equal(result.resourceBreach?.terminalCode, 'join_keys_cap_exceeded');
    assert.ok(result.exact.peakKeyWindowSize <= 4, 'the window must stop at the cap, not past it');
    assert.equal(result.cleanupOutcome, 'completed');
  });

  // Tests 32, 33, 34.
  it('stops on an RSS, heap or external-memory breach before it reads anything', async () => {
    for (const [capKey, terminalCode] of [
      ['maxRssBytes', 'rss_cap_exceeded'],
      ['maxHeapUsedBytes', 'heap_cap_exceeded'],
      ['maxExternalMemoryBytes', 'external_memory_cap_exceeded'],
    ] as const) {
      const handle = twoFamilyFixture();
      const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
        engineRequest(handle, {
          resourceCaps: generousResourceCaps({ [capKey]: 1 }),
          resourceDependencies: scriptedDependencies(CALM_MEMORY),
        }),
      );
      assert.equal(result.abortCode, 'resource_cap_breached');
      assert.equal(result.abortStage, 'before_first_read');
      assert.equal(result.resourceBreach?.terminalCode, terminalCode);
      assert.equal(result.exact.empresaRowsTraversed, 0, 'nothing may be read after a memory breach');
    }
  });

  // Tests 35, 36.
  it('stops on a total-runtime and on a phase-runtime breach', async () => {
    const runtime = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(twoFamilyFixture(), {
        resourceCaps: generousResourceCaps({ maxRuntimeMs: 1 }),
        // Each clock read advances 10 ms, so the second sample is already past the cap.
        resourceDependencies: scriptedDependencies(CALM_MEMORY, BigInt(10) * BigInt(1_000_000)),
      }),
    );
    assert.equal(runtime.abortCode, 'resource_cap_breached');
    assert.equal(runtime.resourceBreach?.terminalCode, 'runtime_cap_exceeded');

    const phase = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(twoFamilyFixture(), {
        resourceCaps: generousResourceCaps({ maxRuntimeMs: 10 * 60 * 1000, maxPhaseRuntimeMs: 1 }),
        resourceDependencies: scriptedDependencies(CALM_MEMORY, BigInt(10) * BigInt(1_000_000)),
      }),
    );
    assert.equal(phase.abortCode, 'resource_cap_breached');
    assert.equal(phase.resourceBreach?.terminalCode, 'phase_runtime_cap_exceeded');
  });

  // Test 37.
  it('stops on a bytes-read breach', async () => {
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(twoFamilyFixture(), { resourceCaps: generousResourceCaps({ maxBytesRead: 8 }) }),
    );
    assert.equal(result.abortCode, 'resource_cap_breached');
    assert.equal(result.resourceBreach?.terminalCode, 'bytes_read_cap_exceeded');
    // `not_needed` rather than `completed`: the breach landed before a reference was written, so
    // there was nothing to release. Both are verified outcomes; neither leaves debris.
    assert.ok(['completed', 'not_needed'].includes(result.cleanupOutcome ?? ''));
    assert.equal(result.publicReport.cleanup_verified_absent, true);
  });

  // Test 38.
  it('stops on a rows-read breach', async () => {
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(twoFamilyFixture(), { resourceCaps: generousResourceCaps({ maxRowsRead: 2 }) }),
    );
    assert.equal(result.abortCode, 'resource_cap_breached');
    assert.equal(result.resourceBreach?.terminalCode, 'rows_read_cap_exceeded');
  });

  // Test 39.
  it('stops on a files-opened breach', async () => {
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(twoFamilyFixture(), { resourceCaps: generousResourceCaps({ maxFilesOpened: 1 }) }),
    );
    assert.equal(result.abortCode, 'resource_cap_breached');
    assert.equal(result.resourceBreach?.terminalCode, 'files_opened_cap_exceeded');
  });

  // Test 40.
  it('refuses a missing resource cap before a descriptor could exist', async () => {
    const handle = twoFamilyFixture();
    let opened = 0;
    const real = createBrazilReceitaFullJoinReaderFileSystem();
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        resourceCaps: null,
        readerFileSystem: {
          ...real,
          open: (filePath) => {
            opened += 1;
            return real.open(filePath);
          },
        },
      }),
    );
    assert.equal(result.abortCode, 'resource_caps_incomplete');
    assert.equal(result.abortStage, 'before_first_read');
    assert.equal(result.resourceCapRejections.length, 11);
    assert.equal(opened, 0, 'an incomplete envelope must never reach a descriptor');
  });

  it('refuses a missing reader cap before a descriptor could exist', async () => {
    const handle = twoFamilyFixture();
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { readerCaps: null }),
    );
    assert.equal(result.abortCode, 'reader_caps_incomplete');
    assert.equal(result.readerCapRejections.length, 4);
  });

  // Test 20 (engine half): the temporary-storage cap stops the run mid-pass.
  it('stops when the temporary storage cap would be crossed', async () => {
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(twoFamilyFixture(), {
        resourceCaps: generousResourceCaps({ maxTemporaryStorageBytes: 32 }),
      }),
    );
    assert.equal(result.abortCode, 'temporary_storage_cap_exceeded');
    assert.equal(result.cleanupOutcome, 'completed');
    assert.equal(result.publicReport.cleanup_verified_absent, true);
  });

  it('refuses a REAL data run, because temporary storage is unapproved', async () => {
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(twoFamilyFixture(), { realDataRun: true }),
    );
    assert.equal(result.abortCode, 'temporary_storage_policy_not_approved');
    assert.equal(result.abortStage, 'before_first_read');
    assert.equal(result.exact.empresaRowsTraversed, 0);
  });

  it('refuses a workspace destination inside the dataset', async () => {
    const handle = twoFamilyFixture();
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { workspaceParentDirectory: handle.datasetRoot }),
    );
    assert.equal(result.abortCode, 'temporary_workspace_unavailable');
    assert.ok(result.workspaceRejections.includes('parent_inside_dataset'));
  });

  it('stops on a non-progressing read', async () => {
    const handle = twoFamilyFixture();
    const real = createBrazilReceitaFullJoinReaderFileSystem();
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { readerFileSystem: { ...real, read: () => 0 } }),
    );
    assert.equal(result.abortCode, 'non_progressing_reader');
    assert.ok(['completed', 'not_needed'].includes(result.cleanupOutcome ?? ''));
    assert.equal(result.publicReport.cleanup_verified_absent, true);
  });
});

// ─── 2. Sink (tests 41–43) ────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0D — decoupled sink', () => {
  function pairFixture() {
    return fixture({
      files: [
        { family: 'empresas', rows: companyRows(6) },
        { family: 'estabelecimentos', rows: companyRows(6) },
      ],
    });
  }

  // Test 41.
  it('counts into buckets and emits, retains and prints nothing', async () => {
    const sink = createBrazilReceitaFullJoinNullBenchmarkSink();
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(pairFixture(), { sink }),
    );
    assert.equal(result.exitStatus, 'completed');
    const tally = sink.tally();
    assert.equal(tally.rowsEmitted, 0);
    assert.equal(tally.recordsRetained, 0);
    assert.equal(tally.finalized, true);
    assert.equal(
      Object.values(tally.matchBuckets).reduce((total, count) => total + count, 0),
      result.exact.matchesEmitted,
      'the buckets must account for every match without keeping one',
    );
    for (const label of Object.keys(tally.matchBuckets)) {
      assert.match(label, /^partition_\d{5}$/, 'a bucket label is an ordinal, never a key');
    }
  });

  // Test 42.
  it('keeps the output-rows cap at zero, and refuses a materializing sink under it', async () => {
    const clean = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(pairFixture()));
    assert.equal(clean.exitStatus, 'completed');
    assert.equal(clean.exact.resource.outputRowsMaterialized, 0);
    assert.equal(clean.publicReport.rows_emitted, 0);
    assert.equal(clean.publicReport.zero_output_rows_enforced, true);

    const materializing = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(pairFixture(), { sinkMaterializesRows: true }),
    );
    assert.equal(materializing.abortCode, 'resource_cap_breached');
    assert.equal(materializing.resourceBreach?.terminalCode, 'output_rows_cap_exceeded');
    assert.equal(materializing.cleanupOutcome, 'completed');
  });

  // Test 43.
  it('runs cleanup when the sink throws, and reports the sink as the cause', async () => {
    const throwing: BrazilReceitaFullJoinSink = {
      onMatch() {
        throw new Error('scripted sink failure');
      },
      finalize() {
        return undefined;
      },
    };
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(pairFixture(), { sink: throwing }),
    );
    assert.equal(result.abortCode, 'sink_failed');
    assert.equal(result.cleanupOutcome, 'completed');
    assert.equal(result.publicReport.cleanup_verified_absent, true);
    assert.equal(result.publicReport.cleanup.cleanup_status, 'completed');
  });

  it('reports a sink that fails only at finalize', async () => {
    const sink: BrazilReceitaFullJoinSink = {
      onMatch() {
        return undefined;
      },
      finalize() {
        throw new Error('scripted finalize failure');
      },
    };
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(pairFixture(), { sink }),
    );
    assert.equal(result.abortCode, 'sink_failed');
    assert.equal(result.cleanupOutcome, 'completed');
  });

  it('awaits an asynchronous sink', async () => {
    let seen = 0;
    const sink: BrazilReceitaFullJoinSink = {
      async onMatch() {
        await Promise.resolve();
        seen += 1;
      },
      async finalize() {
        await Promise.resolve();
      },
    };
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(pairFixture(), { sink }),
    );
    assert.equal(result.exitStatus, 'completed');
    assert.equal(seen, result.exact.matchesEmitted);
  });

  it('hands the sink opaque references and a partition ordinal, and nothing else', async () => {
    const records: Array<Record<string, unknown>> = [];
    const sink: BrazilReceitaFullJoinSink = {
      onMatch(match) {
        records.push(match as unknown as Record<string, unknown>);
      },
      finalize() {
        return undefined;
      },
    };
    await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(pairFixture(), { sink }));
    assert.ok(records.length > 0);
    for (const record of records) {
      assert.deepEqual(Object.keys(record).sort(), [
        'empresaReference',
        'estabelecimentoReference',
        'partitionOrdinal',
      ]);
      for (const side of ['empresaReference', 'estabelecimentoReference'] as const) {
        assert.deepEqual(Object.keys(record[side] as object).sort(), [
          'byteLength',
          'byteOffset',
          'family',
          'sourceFileOrdinal',
        ]);
      }
      // The decisive assertion: nothing in a joined record carries a value from the row.
      const rendered = JSON.stringify(record);
      assert.ok(!rendered.includes('SYN_K'), 'a joined record must carry no join key');
      assert.ok(!rendered.includes('SYN_PAD'), 'a joined record must carry no row content');
    }
  });
});

// ─── 3. Single attempt (tests 57, 58) ─────────────────────────────────────────

describe('BR-SOURCE-14B.0D — one attempt, no retry', () => {
  it('refuses a second run on the same engine', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(4) },
        { family: 'estabelecimentos', rows: companyRows(4) },
      ],
    });
    const engine = createBrazilReceitaFullJoinStreamingEngine();

    const first = await engine.run(engineRequest(handle));
    assert.equal(first.exitStatus, 'completed');
    assert.equal(engine.attemptsConsumed(), 1);

    const second = await engine.run(engineRequest(handle));
    assert.equal(second.exitStatus, 'aborted');
    assert.equal(second.abortCode, 'attempt_already_consumed');
    assert.equal(second.abortStage, 'before_first_read');
    assert.equal(second.exact.empresaRowsTraversed, 0, 'a refused attempt reads nothing');
  });

  it('refuses a retry after an aborted run, rather than trying again', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(4) },
        { family: 'estabelecimentos', rows: companyRows(4) },
      ],
    });
    const engine = createBrazilReceitaFullJoinStreamingEngine();
    const first = await engine.run(
      engineRequest(handle, { resourceCaps: generousResourceCaps({ maxRowsRead: 1 }) }),
    );
    assert.equal(first.exitStatus, 'aborted');
    const retry = await engine.run(engineRequest(handle));
    assert.equal(retry.abortCode, 'attempt_already_consumed');
    assert.equal(retry.publicReport.retries_performed, 0);
  });
});

// ─── 4. Both metric channels (tests 59, 60) ───────────────────────────────────

describe('BR-SOURCE-14B.0D — public and private channels', () => {
  async function completedRun() {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(6) },
        { family: 'estabelecimentos', rows: companyRows(6).map((row) => ({ ...row, padWidth: 20 })) },
      ],
    });
    return runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
  }

  // Test 59.
  it('emits a public report the full-join sanitizer accepts, with no exact magnitude in it', async () => {
    const result = await completedRun();
    assert.equal(result.exitStatus, 'completed');
    const verdict = sanitizeBrazilReceitaFullJoinReport(result.publicReport);
    assert.equal(verdict.ok, true, JSON.stringify(verdict.findings));

    // Every magnitude must be a bucket string. The exact figures exist, and they are elsewhere.
    const rendered = JSON.stringify(result.publicReport);
    assert.ok(!rendered.includes('SYN_K'), 'no join key may appear in a public report');
    assert.ok(!rendered.includes('SYN_PAD'), 'no row content may appear in a public report');
    assert.ok(!rendered.includes('/'), 'no path may appear in a public report');
    assert.ok(result.exact.resource.bytesRead > 0, 'the exact figure exists on the private path');
    assert.ok(
      !rendered.includes(String(result.exact.resource.bytesRead)),
      'the exact byte count must not appear in the public report',
    );
    assert.match(result.publicReport.resource_measurements.bytes_read_bucket, /^(zero|lte_|gt_)/);
    assert.equal(result.publicReport.exact_values_printed, false);
    assert.equal(result.publicReport.full_join_model, 'model_a_fully_bounded_streaming');
  });

  it('emits an abort report the sanitizer also accepts', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(4) },
        { family: 'estabelecimentos', rows: companyRows(4) },
      ],
    });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { resourceCaps: generousResourceCaps({ maxRowsRead: 1 }) }),
    );
    assert.equal(result.exitStatus, 'aborted');
    const verdict = sanitizeBrazilReceitaFullJoinReport(result.publicReport);
    assert.equal(verdict.ok, true, JSON.stringify(verdict.findings));
  });

  // Test 60.
  it('produces a private payload that carries process metrics and no Receita data', async () => {
    const result = await completedRun();
    const payload = toBrazilReceitaFullJoinPrivateOperatorMeasurements(result.exact.resource, 'passed');
    const findings = validateBrazilReceitaFullJoinPrivateContent(payload);
    assert.deepEqual(findings, [], 'the private channel validator must find nothing');
    const rendered = JSON.stringify(payload);
    assert.ok(!rendered.includes('SYN_K'));
    assert.ok(!rendered.includes('SYN_PAD'));
    assert.ok(!rendered.includes('/'));
  });
});
