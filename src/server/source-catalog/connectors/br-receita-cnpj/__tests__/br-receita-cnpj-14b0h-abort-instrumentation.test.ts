/**
 * BR-SOURCE-14B.0H — ABORT-PATH INSTRUMENTATION — tests (§ 13, § 14, § 16, § 24 items 19-36).
 *
 * Three gaps, found by reading the code rather than assumed, and this suite's three claims mirror them
 * exactly:
 *
 *   1. TEMPORARY STORAGE PEAK IS MEASURABLE ON ABORT. Before this milestone, the enforcer only ever
 *      learned about temporary storage once, at final cleanup — an early abort (before that one call)
 *      reported a peak of zero despite bytes actually sitting on disk.
 *   2. PHASE DURATION SURVIVES A LATCHED BREACH. `beginPhase`/`endPhase` used to refuse ALL work once
 *      the enforcer had latched a breach, which meant `cleanup` — the one phase that runs on EVERY
 *      abort — could never get a measured duration once something else had already failed.
 *   3. THE SANITIZER ACTUALLY RUNS. `real-full-scan-benchmark.ts` used to derive `sanitizerResult` from
 *      `abortCode` as a string label, never calling `sanitizeBrazilReceitaFullJoinReport` at all.
 *
 * 100% synthetic and offline. No real manifest, no real dataset, no Supabase, no runtime, no Agent 1.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  runBrazilReceitaFullJoinStreamingEngineOnce,
  type BrazilReceitaFullJoinEngineRequest,
} from '../br-receita-cnpj-full-join-engine';
import { createBrazilReceitaFullJoinNullBenchmarkSink } from '../br-receita-cnpj-full-join-engine-contract';
import {
  brazilReceitaFullJoinFixtureRunDefaults,
  brazilReceitaFullJoinSyntheticKey,
  createBrazilReceitaFullJoinFixture,
  type BrazilReceitaFullJoinFixtureHandle,
  type BrazilReceitaFullJoinFixtureScenario,
} from '../br-receita-cnpj-full-join-engine-fixtures';
import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-engine-fs';
import {
  createBrazilReceitaFullJoinResourceEnforcer,
  createBrazilReceitaFullJoinResourceProcessDependencies,
  type BrazilReceitaFullJoinResourceDependencies,
} from '../br-receita-cnpj-full-join-resource-envelope';
import {
  applyBrazilReceitaRealFullScanReportSanitizer,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
} from '../br-receita-cnpj-real-full-scan-benchmark';
import { BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED } from '../br-receita-cnpj-full-join-resource-benchmark';
import {
  buildBrazilReceitaFullJoinEnginePublicReport,
  emptyBrazilReceitaFullJoinResourceObservations,
  type BrazilReceitaFullJoinEnginePublicReport,
} from '../br-receita-cnpj-full-join-engine-report';

// ─── Helpers (mirrors br-receita-cnpj-full-join-engine-envelope.test.ts) ───────

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
  return { maxChunkBytes: 512, maxCarryBytes: 4 * 1024, maxRowBytes: 4 * 1024, maxColumnsPerRow: 64, ...overrides };
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
      repositoryRoot: '/workspaces/sellup-worktrees/br-14b0h',
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
  return Array.from({ length: count }, (_, index) => ({ key: brazilReceitaFullJoinSyntheticKey(startIndex + index) }));
}

// ─── 1. Temporary storage peak, measured on abort ──────────────────────────────

describe('BR-SOURCE-14B.0H § 13 — temporary storage peak is measurable on abort', () => {
  it('reports a nonzero peak and a zeroed current after an abort that spilled references then cleaned up', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(8) },
        { family: 'estabelecimentos', rows: companyRows(8) },
      ],
    });
    // Each clock read advances 10ms; maxPhaseRuntimeMs=1 guarantees a breach at the end of the
    // empresas_read phase, AFTER its 8 references have already been appended (and thus buffered/
    // spilled) but BEFORE estabelecimentos_read ever begins.
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        resourceCaps: generousResourceCaps({ maxPhaseRuntimeMs: 1 }),
        resourceDependencies: scriptedDependencies(CALM_MEMORY, BigInt(10) * BigInt(1_000_000)),
      }),
    );
    assert.equal(result.abortCode, 'resource_cap_breached');
    assert.equal(result.resourceBreach?.terminalCode, 'phase_runtime_cap_exceeded');
    assert.equal(result.exact.referencesPersisted, 8, 'the 8 empresas references must have been accepted');

    assert.ok(
      result.exact.resource.temporaryStoragePeakBytes > 0,
      'the peak must reflect the spill that happened before the abort, not stay at zero',
    );
    assert.equal(
      result.exact.resource.temporaryStorageCurrentBytes,
      0,
      'current must fall to zero once cleanup has verifiably released the workspace',
    );
    assert.equal(result.cleanupOutcome, 'completed');
  });

  it('reports zero peak when no workspace was ever created', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(2) },
        { family: 'estabelecimentos', rows: [] },
      ],
    });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        resourceCaps: generousResourceCaps({ maxRssBytes: 1 }),
        resourceDependencies: scriptedDependencies(CALM_MEMORY),
      }),
    );
    assert.equal(result.abortCode, 'resource_cap_breached');
    assert.equal(result.abortStage, 'before_first_read');
    assert.equal(result.exact.resource.temporaryStoragePeakBytes, 0);
    assert.equal(result.exact.resource.temporaryStorageCurrentBytes, 0);
  });
});

// ─── 2. Phase duration survives a latched breach ───────────────────────────────

describe('BR-SOURCE-14B.0H § 14 — phase duration is measurable on abort', () => {
  it('measures empresas_read AND cleanup on a phase-runtime abort, and leaves estabelecimentos_read null', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(8) },
        { family: 'estabelecimentos', rows: companyRows(8) },
      ],
    });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        resourceCaps: generousResourceCaps({ maxPhaseRuntimeMs: 1 }),
        resourceDependencies: scriptedDependencies(CALM_MEMORY, BigInt(10) * BigInt(1_000_000)),
      }),
    );
    assert.equal(result.abortCode, 'resource_cap_breached');
    const phases = result.exact.resource.phaseDurationsMs;

    assert.equal(typeof phases.empresas_read, 'number', 'the phase that aborted must have a measured duration');
    assert.ok(phases.empresas_read! >= 0);
    assert.equal(
      typeof phases.cleanup,
      'number',
      'cleanup runs on every abort and must get a measured duration even though the enforcer is already latched',
    );
    assert.ok(phases.cleanup! >= 0);
    assert.equal(
      phases.estabelecimentos_read,
      null,
      'a phase that never started must stay null, not be confused with a zero-duration phase',
    );
  });

  it('measures cleanup on a referencePassFailure that is not itself a resource breach', async () => {
    // A malformed source path makes the reader fail outright (`reader_failed`), a DIFFERENT abort
    // code from `resource_cap_breached` — this exercises the SAME cleanup-phase-timing code path for
    // a non-resource failure, confirming the fix is not accidentally specific to one abort code.
    const handle = fixture({
      files: [
        { family: 'empresas', rows: companyRows(2) },
        { family: 'estabelecimentos', rows: [] },
      ],
    });
    const brokenSource = handle.sources.map((source) => ({ ...source, filePath: `${source.filePath}.missing` }));
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { sources: brokenSource }),
    );
    assert.equal(result.abortCode, 'reader_failed');
    assert.equal(
      typeof result.exact.resource.phaseDurationsMs.cleanup,
      'number',
      'cleanup duration must be measured on a reader-failure abort too',
    );
  });
});

// ─── 2b. The underlying enforcer property, isolated from the engine ───────────

describe('BR-SOURCE-14B.0H § 14 — the enforcer itself times a phase opened after it is latched', () => {
  it('beginPhase/endPhase still record a duration once a prior breach has latched the enforcer', () => {
    const caps = {
      maxRssBytes: 1024 * MEGABYTE,
      maxHeapUsedBytes: 1024 * MEGABYTE,
      maxExternalMemoryBytes: 1024 * MEGABYTE,
      maxRuntimeMs: 10 * 60 * 1000,
      maxPhaseRuntimeMs: 10 * 60 * 1000,
      maxTemporaryStorageBytes: 0,
      maxFilesOpened: 64,
      maxBytesRead: 1000,
      // Low enough that a single noteRowsRead() call breaches it, AFTER the enforcer is armed —
      // unlike an RSS breach at validateBeforeFirstAccess(), which never reaches `armed = true` at
      // all and so is a different (and already-covered) case: an unarmed enforcer, not a latched one.
      maxRowsRead: 1,
      maxJoinKeysInMemory: 1000,
      maxOutputRows: 0,
    };
    let now = BigInt(0);
    const enforcer = createBrazilReceitaFullJoinResourceEnforcer(caps, {
      clock: () => {
        const value = now;
        now += BigInt(1_000_000);
        return value;
      },
      memorySampler: () => ({ rss: 2 * MEGABYTE, heapUsed: MEGABYTE, external: MEGABYTE }),
    });

    const armed = enforcer.validateBeforeFirstAccess();
    assert.equal(armed.ok, true, 'the caps here must all be generous enough to arm cleanly');

    const rowsBreach = enforcer.noteRowsRead(5);
    assert.equal(rowsBreach.ok, false, 'the row cap (1) must breach on the first note');
    assert.equal(enforcer.breach()?.terminalCode, 'rows_read_cap_exceeded');

    // Latched, but ARMED. Under the pre-14B.0H behavior, everything below this line would refuse
    // WITHOUT recording any timing at all — the exact gap this fix closes.
    const begun = enforcer.beginPhase('cleanup');
    assert.equal(begun.ok, false, 'the latched breach must still be reported');
    assert.equal(begun.ok === false ? begun.breach.terminalCode : null, 'rows_read_cap_exceeded');
    const ended = enforcer.endPhase('cleanup');
    assert.equal(ended.ok, false);

    const observations = enforcer.readExactObservations();
    assert.equal(
      typeof observations.phaseDurationsMs.cleanup,
      'number',
      'cleanup must have a measured duration despite beginPhase/endPhase running after the latch',
    );
  });
});

// ─── 3. The sanitizer actually runs ─────────────────────────────────────────────

describe('BR-SOURCE-14B.0H § 16 — the sanitizer gate is real, not a label', () => {
  // Built from the REAL production projection rather than hand-fabricated, so this test exercises
  // exactly the shape `buildBrazilReceitaFullJoinEnginePublicReport` actually produces — including
  // every field name the sanitizer's own key rules are written against.
  function safeEngineReport(): BrazilReceitaFullJoinEnginePublicReport {
    return buildBrazilReceitaFullJoinEnginePublicReport({
      exact: {
        resource: emptyBrazilReceitaFullJoinResourceObservations(),
        empresaRowsTraversed: 8,
        estabelecimentoRowsTraversed: 0,
        referencesPersisted: 8,
        matchesEmitted: 0,
        orphanEstabelecimentoCount: 0,
        empresaKeysWithoutEstabelecimento: 0,
        invalidKeyCount: 0,
        malformedRowCount: 0,
        duplicateEmpresaKeyCount: 0,
        partitionsCreated: 4,
        largestPartitionReferenceCount: 8,
        peakKeyWindowSize: 0,
        temporaryStorageBytesWritten: 128,
        partitionDepthReached: 0,
        filesTraversedToEndOfFile: 1,
        sourceFilesDeclared: 2,
        filesOpenedPeak: 2,
        partitionHandlePeakOpen: 2,
        partitionHandleEvictions: 0,
      },
      abortCode: 'resource_cap_breached',
      abortStage: 'estabelecimentos_reference_pass',
      duplicateKeyPolicy: 'pair_with_every_duplicate',
      workspaceCreated: true,
      cleanupOutcome: 'completed',
      cleanupVerifiedAbsent: true,
      filesReleased: 2,
    });
  }

  it('passes a structurally-safe report and releases it unchanged', () => {
    const report = safeEngineReport();
    const outcome = applyBrazilReceitaRealFullScanReportSanitizer(report);
    assert.deepEqual(outcome, { sanitizerResult: 'passed', publicReportReleased: true, releasedEngineReport: report });
  });

  it('fails a report carrying an oversized numeric leaf, and withholds it — the abort code is a SEPARATE concern', () => {
    const leaking = {
      ...safeEngineReport(),
      // A leak injected into a field whose NAME is not itself forbidden (unlike `join_keys_*`), so
      // this exercises the sanitizer's numeric-magnitude rule specifically: an eight-digit value,
      // the shape of a CNPJ básico, where only a small integer belongs.
      partition_depth_reached: 12345678,
    };
    const outcome = applyBrazilReceitaRealFullScanReportSanitizer(leaking);
    assert.equal(outcome.sanitizerResult, 'failed');
    assert.equal(outcome.publicReportReleased, false, 'a report the sanitizer rejects must not be released');
    assert.equal(outcome.releasedEngineReport, null, 'the withheld report must not be handed back at all');
  });

  it('never mistakes sanitizer failure for the primary abort reason', () => {
    // The primary abort code lives on the ENGINE result, entirely separate from the sanitizer verdict
    // computed here — this test exists to make that separation explicit and regression-checkable.
    const leaking = { ...safeEngineReport(), partition_depth_reached: 99999999 };
    const outcome = applyBrazilReceitaRealFullScanReportSanitizer(leaking);
    assert.equal(outcome.sanitizerResult, 'failed');
    // The report's OWN abort_code is untouched by the sanitizer verdict.
    assert.equal(leaking.abort_code, 'resource_cap_breached');
  });
});

// ─── 4. Safety regressions this milestone must not touch ──────────────────────

describe('BR-SOURCE-14B.0H § 23 — the single-attempt and authorization gates are untouched', () => {
  it('the real full-scan benchmark authorization flag is still false', () => {
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG, false);
  });
});
