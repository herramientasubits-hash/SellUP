/**
 * BR Receita CNPJ STREAMING FULL-JOIN ENGINE — tests
 * (BR-SOURCE-14B.0D; § 14 tests 11, 15–19, 21–30, 55, 66).
 *
 * Companion file: `br-receita-cnpj-full-join-engine-envelope.test.ts` carries the resource-cap, sink,
 * single-attempt and metric-channel halves (tests 20, 31–43, 57–60).
 *
 * The engine is exercised END TO END against real synthetic files on a real disk, with a real
 * reference workspace and the real 14B.0C enforcer. The assertions are organized around the four
 * things that could be wrong in a way nobody would notice:
 *
 *   1. THE JOIN IS INCOMPLETE. Every scenario's result is compared against an INDEPENDENT brute-force
 *      oracle computed from the scenario definition, which shares no code with the partitioner, the
 *      reader, the workspace or the join. Agreement is then evidence rather than a tautology.
 *   2. THE PREFIX PROBLEM COMES BACK. Row counts are compared against the scenario's full row count,
 *      and `every_source_traversed_to_end_of_file` must hold — a run that read the first chunk of each
 *      file and joined it would otherwise look successful.
 *   3. MEMORY GROWS WITH THE DATASET. The peak key-window size is compared across partition maps at a
 *      CONSTANT row count, so a window that tracked the dataset instead of the cap would show up.
 *   4. A CAP OR A FAILURE LEAVES DEBRIS. Every abort path asserts the workspace is gone and verified
 *      gone — here for the partitioning aborts, and in the companion file for the rest.
 *
 * 100% synthetic and offline. No real manifest, no real dataset, no repository path, no operator home,
 * no Supabase, no network, no runtime, no Agent 1, no git. Byte magnitudes are arithmetic, so this file
 * contains no identifier-shaped digit run.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  runBrazilReceitaFullJoinStreamingEngineOnce,
  type BrazilReceitaFullJoinEngineRequest,
  type BrazilReceitaFullJoinEngineResult,
} from '../br-receita-cnpj-full-join-engine';
import { createBrazilReceitaFullJoinNullBenchmarkSink } from '../br-receita-cnpj-full-join-engine-contract';
import {
  brazilReceitaFullJoinSyntheticKey,
  brazilReceitaFullJoinSyntheticKeysInOnePartition,
  computeBrazilReceitaFullJoinSyntheticOracle,
  brazilReceitaFullJoinFixtureRunDefaults,
  createBrazilReceitaFullJoinFixture,
  type BrazilReceitaFullJoinFixtureHandle,
  type BrazilReceitaFullJoinFixtureScenario,
} from '../br-receita-cnpj-full-join-engine-fixtures';
import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-engine-fs';
import { createBrazilReceitaFullJoinResourceProcessDependencies } from '../br-receita-cnpj-full-join-resource-envelope';

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
    ...brazilReceitaFullJoinFixtureRunDefaults(),
    realDataRun: false,
    sinkMaterializesRows: false,
    ...overrides,
  };
}

function companyRows(count: number, startIndex = 1) {
  return Array.from({ length: count }, (_, index) => ({
    key: brazilReceitaFullJoinSyntheticKey(startIndex + index),
  }));
}

/** Asserts the run agrees with the independent oracle, on every count the oracle knows. */
function assertMatchesOracle(
  result: BrazilReceitaFullJoinEngineResult,
  scenario: BrazilReceitaFullJoinFixtureScenario,
) {
  const oracle = computeBrazilReceitaFullJoinSyntheticOracle(scenario);
  assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
  assert.equal(result.exact.matchesEmitted, oracle.expectedMatches, 'match count');
  assert.equal(
    result.exact.orphanEstabelecimentoCount,
    oracle.expectedOrphanEstablishments,
    'orphan establishments',
  );
  assert.equal(
    result.exact.empresaKeysWithoutEstabelecimento,
    oracle.expectedCompaniesWithoutEstablishment,
    'companies without an establishment',
  );
  assert.equal(result.exact.malformedRowCount, oracle.expectedMalformedRows, 'malformed rows');
  assert.equal(
    result.exact.empresaRowsTraversed,
    oracle.expectedCompanyRows,
    'every company row must be traversed, not a prefix',
  );
  assert.equal(
    result.exact.estabelecimentoRowsTraversed,
    oracle.expectedEstablishmentRows,
    'every establishment row must be traversed, not a prefix',
  );
  assert.equal(result.publicReport.every_source_traversed_to_end_of_file, true);
  assert.equal(result.cleanupOutcome, 'completed');
}

// ─── 1. Join semantics (tests 21–30) ──────────────────────────────────────────

describe('BR-SOURCE-14B.0D — join semantics against an independent oracle', () => {
  // Tests 21 + 29 + 30.
  it('joins one company to one establishment across every row of every file', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: companyRows(12) },
        { family: 'estabelecimentos', rows: companyRows(12) },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.matchesEmitted, 12);
  });

  // Test 22.
  it('joins one company to many establishments', async () => {
    const key = brazilReceitaFullJoinSyntheticKey(1);
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: [{ key }] },
        { family: 'estabelecimentos', rows: [{ key }, { key }, { key }, { key }] },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.matchesEmitted, 4);
  });

  // Test 23 + the one-company-zero-establishments case from § 9.
  it('reports a company with no establishment, and emits nothing for it', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: companyRows(3) },
        { family: 'estabelecimentos', rows: [{ key: brazilReceitaFullJoinSyntheticKey(1) }] },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.matchesEmitted, 1);
    assert.equal(result.exact.empresaKeysWithoutEstabelecimento, 2);
  });

  // Test 24.
  it('reports an orphan establishment rather than dropping it silently', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: companyRows(2) },
        { family: 'estabelecimentos', rows: companyRows(5) },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.orphanEstabelecimentoCount, 3);
  });

  // Test 25: both explicit policies, and no third behaviour.
  it('handles a duplicate company key under BOTH declared policies, and never de-duplicates silently', async () => {
    const key = brazilReceitaFullJoinSyntheticKey(1);
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: [{ key }, { key }] },
        { family: 'estabelecimentos', rows: [{ key }] },
      ],
    };

    const pairing = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), { duplicateKeyPolicy: 'pair_with_every_duplicate' }),
    );
    assert.equal(pairing.exitStatus, 'completed');
    assert.equal(pairing.exact.duplicateEmpresaKeyCount, 1);
    assert.equal(pairing.exact.matchesEmitted, 2, 'both company rows must be paired, not one');

    const rejecting = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), { duplicateKeyPolicy: 'reject' }),
    );
    assert.equal(rejecting.exitStatus, 'aborted');
    assert.equal(rejecting.abortCode, 'duplicate_empresa_key_rejected');
    // Test 55: cleanup runs on the abort path too.
    assert.equal(rejecting.cleanupOutcome, 'completed');
    assert.equal(rejecting.publicReport.cleanup_verified_absent, true);
  });

  it('refuses to run without a declared duplicate policy', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(1) },
        { family: 'estabelecimentos', rows: companyRows(1) },
      ],
    });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { duplicateKeyPolicy: undefined }),
    );
    assert.equal(result.abortCode, 'duplicate_policy_not_declared');
    assert.equal(result.abortStage, 'before_first_read');
  });

  // Test 26.
  it('counts an invalid key and joins nothing on it', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: [{ key: '' }, { key: '   ' }, ...companyRows(2)] },
        { family: 'estabelecimentos', rows: [{ key: '' }, ...companyRows(2)] },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.ok(result.exact.invalidKeyCount >= 3, 'each blank key must be counted');
    assert.equal(result.exact.matchesEmitted, 2);
  });

  // Test 27.
  it('counts a malformed row and never reads a join key out of it', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        {
          family: 'empresas',
          rows: [
            { key: brazilReceitaFullJoinSyntheticKey(1) },
            { key: brazilReceitaFullJoinSyntheticKey(2), columnCount: 3 },
          ],
        },
        { family: 'estabelecimentos', rows: companyRows(2) },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.malformedRowCount, 1);
    assert.equal(
      result.exact.matchesEmitted,
      1,
      'the malformed row must not contribute a match even though its key looked fine',
    );
  });

  // Test 28.
  it('joins across multiple files per family', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: companyRows(4, 1) },
        { family: 'empresas', rows: companyRows(4, 5) },
        { family: 'estabelecimentos', rows: companyRows(4, 1) },
        { family: 'estabelecimentos', rows: companyRows(4, 5), lineEnding: 'crlf' },
        { family: 'estabelecimentos', rows: companyRows(2, 1), trailingNewline: false },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.filesTraversedToEndOfFile, 5);
    assert.equal(result.exact.sourceFilesDeclared, 5);
  });

  it('refuses a source list that declares only one family', async () => {
    const handle = fixture({ files: [{ family: 'empresas', rows: companyRows(2) }] });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assert.equal(result.abortCode, 'source_descriptors_invalid');
    assert.equal(result.abortStage, 'before_first_read');
  });

  it('reads rows that straddle chunk boundaries without losing or duplicating one', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: companyRows(6).map((row) => ({ ...row, padWidth: 30 })) },
        {
          family: 'estabelecimentos',
          rows: companyRows(6).map((row) => ({ ...row, padWidth: 30 })),
        },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { readerCaps: readerCaps({ maxChunkBytes: 8 }) }),
    );
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.matchesEmitted, 6);
  });
});

// ─── 2. Partitioning (tests 11, 15–18) ────────────────────────────────────────

describe('BR-SOURCE-14B.0D — bounded partitioning', () => {
  // Test 11 + test 15.
  it('partitions every valid row and spreads a uniform distribution across partitions', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: companyRows(24) },
        { family: 'estabelecimentos', rows: companyRows(24) },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.referencesPersisted, 48, 'every valid row contributes one reference');
    const used = result.partitionSummaries.filter(
      (summary) => summary.empresaKeysLoaded > 0 || summary.estabelecimentoReferencesStreamed > 0,
    );
    assert.ok(used.length > 1, 'a uniform distribution must not land in a single partition');
    assert.equal(result.partitionSummaries.length, 4);
  });

  // Test 16: every key in ONE partition, which must still complete correctly.
  it('joins correctly when an adversarial distribution puts every key in one partition', async () => {
    const keys = brazilReceitaFullJoinSyntheticKeysInOnePartition(8, 4, 0);
    assert.equal(keys.length, 8, 'the fixture must find enough same-partition keys');
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: keys.map((key) => ({ key })) },
        { family: 'estabelecimentos', rows: keys.map((key) => ({ key })) },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(handle));
    assertMatchesOracle(result, scenario);
    assert.equal(result.exact.matchesEmitted, 8);
    const loaded = result.partitionSummaries.filter((summary) => summary.empresaKeysLoaded > 0);
    assert.equal(loaded.length, 1, 'the fixture was built so every key lands in one partition');
  });

  // Test 17.
  it('reparts under a controlled depth when a partition would exceed its cap', async () => {
    const keys = brazilReceitaFullJoinSyntheticKeysInOnePartition(8, 4, 0);
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: keys.map((key) => ({ key })) },
        { family: 'estabelecimentos', rows: keys.map((key) => ({ key })) },
      ],
    };
    const handle = fixture(scenario);
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        partitioningCaps: partitioningCaps({ maxReferencesPerPartition: 3, maxPartitionDepth: 4 }),
      }),
    );
    assert.equal(result.exitStatus, 'completed', JSON.stringify(result.abortCode));
    assert.ok(result.exact.partitionDepthReached > 0, 'a repartition must have happened');
    assert.equal(result.publicReport.partition_depth_reached, result.exact.partitionDepthReached);
    // The repartition must not cost correctness: the oracle still holds afterwards.
    assertMatchesOracle(result, scenario);
    // And it must not be a retry: 14B.0C's retry count stays structurally zero.
    assert.equal(result.publicReport.retries_performed, 0);
  });

  // Test 18.
  it('aborts instead of repartitioning past the declared depth', async () => {
    const keys = brazilReceitaFullJoinSyntheticKeysInOnePartition(8, 4, 0);
    const handle = fixture({
      files: [
        { family: 'empresas', rows: keys.map((key) => ({ key })) },
        { family: 'estabelecimentos', rows: keys.map((key) => ({ key })) },
      ],
    });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        partitioningCaps: partitioningCaps({ maxReferencesPerPartition: 1, maxPartitionDepth: 1 }),
      }),
    );
    assert.equal(result.abortCode, 'partition_capacity_exceeded');
    assert.equal(result.cleanupOutcome, 'completed');
    assert.equal(result.publicReport.cleanup_verified_absent, true);
  });

  // Test 19: the partition-count ceiling itself blocks the widening.
  it('aborts rather than widening the partition-count ceiling', async () => {
    const keys = brazilReceitaFullJoinSyntheticKeysInOnePartition(8, 4, 0);
    const handle = fixture({
      files: [
        { family: 'empresas', rows: keys.map((key) => ({ key })) },
        { family: 'estabelecimentos', rows: keys.map((key) => ({ key })) },
      ],
    });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        partitioningCaps: partitioningCaps({
          partitionCount: 4,
          maxPartitionCount: 4,
          maxReferencesPerPartition: 1,
          maxPartitionDepth: 8,
        }),
      }),
    );
    assert.equal(result.abortCode, 'partition_capacity_exceeded');
  });

  it('refuses an incomplete or self-contradictory partitioning cap set before reading', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(1) },
        { family: 'estabelecimentos', rows: companyRows(1) },
      ],
    });
    const missing = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { partitioningCaps: null }),
    );
    assert.equal(missing.abortCode, 'partitioning_caps_incomplete');
    assert.equal(missing.partitioningCapRejections.length, 5);

    const contradictory = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        partitioningCaps: partitioningCaps({ partitionCount: 8, maxPartitionCount: 4 }),
      }),
    );
    assert.equal(contradictory.abortCode, 'partitioning_caps_incomplete');
  });

  // Test 66: the key window follows the CAP, not the dataset.
  it('keeps the peak key window a function of the partition map, not of the row count', async () => {
    const scenario: BrazilReceitaFullJoinFixtureScenario = {
      files: [
        { family: 'empresas', rows: companyRows(32) },
        { family: 'estabelecimentos', rows: companyRows(32) },
      ],
    };
    const coarse = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), { partitioningCaps: partitioningCaps({ partitionCount: 1 }) }),
    );
    const fine = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), { partitioningCaps: partitioningCaps({ partitionCount: 16 }) }),
    );

    assert.equal(coarse.exitStatus, 'completed');
    assert.equal(fine.exitStatus, 'completed');
    assert.equal(coarse.exact.matchesEmitted, fine.exact.matchesEmitted, 'same join, same result');
    assert.ok(
      fine.exact.peakKeyWindowSize < coarse.exact.peakKeyWindowSize,
      `a finer map must hold fewer keys at once (coarse=${coarse.exact.peakKeyWindowSize}, fine=${fine.exact.peakKeyWindowSize})`,
    );
    assert.ok(
      fine.exact.peakKeyWindowSize < 32,
      'the window must be smaller than the dataset it joined',
    );
  });
});

