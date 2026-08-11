/**
 * BR Receita CNPJ — SYNTHETIC END-TO-END SOURCE-READ THROUGHPUT HARNESS (BR-SOURCE-14B.0I).
 *
 * Answers ONE question: after BR-SOURCE-14B.0H, can Model A sustain enough SOURCE-BYTE throughput
 * to justify a second, exceptional real benchmark? It measures that by driving the REAL production
 * path — real reader, real row framing, real parser, real join-key extraction, real partition
 * routing, real buffered spill writer, real FD pool, real resource instrumentation, real cleanup,
 * real sanitizer — over a SYNTHETIC fixture, through the connector's own established synthetic
 * benchmark entry point (`runBrazilReceitaFullJoinSyntheticFixtureBenchmark`), with one addition:
 * the reader-filesystem port it is handed is wrapped with a METER (see
 * `br-receita-cnpj-14b0i-metering-reader-fs`) so this module can report SOURCE bytes separately
 * from REFERENCE bytes and from the join stage's row re-fetches, instead of the single conflated
 * `bytesRead` counter the engine's own public/exact figures expose.
 *
 * ── Two denominators, never mixed (§ 4) ─────────────────────────────────────────
 * `SYNTHETIC_SOURCE_READ_MIB_PER_SECOND` is source bytes actually read (the meter's chunk-read
 * total) divided by the WHOLE pipeline's wall clock (`exact.resource.totalDurationMs`).
 * `REFERENCE_WRITE_MIB_PER_SECOND` is `exact.temporaryStorageBytesWritten` divided by the
 * REFERENCE-PASS wall clock (the two phases during which references are written) — sixteen bytes
 * per reference WRITTEN, never comparable with a source-bytes-READ rate. `ROWS_PER_SECOND` and
 * `REFERENCES_PER_SECOND` are their own counts over their own clocks. Every one of these is a
 * separate field on the returned report; none is derived from another by unstated arithmetic.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - executes a real benchmark, opens a real manifest, or touches Receita data of any kind.
 *   - flips `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED` or `..._EXECUTED`, or authorizes a
 *     second real benchmark attempt — it only computes a `SECOND_REAL_BENCHMARK_RECOMMENDATION`
 *     label, which is advisory and changes nothing about the source constants.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - widens a resource, reader or partitioning cap beyond `BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS`.
 */

import {
  createBrazilReceita14B0IMeteringReaderFileSystem,
  type BrazilReceita14B0IMeteringSnapshot,
} from './br-receita-cnpj-14b0i-metering-reader-fs';
import {
  createBrazilReceita14B0ISyntheticFixture,
  type BrazilReceita14B0ISyntheticFixtureHandle,
  type BrazilReceita14B0ISyntheticOracle,
  type BrazilReceita14B0ISyntheticScenarioPlan,
} from './br-receita-cnpj-14b0i-synthetic-source-generator';
import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from './br-receita-cnpj-full-join-engine-fs';
import { brazilReceitaFullJoinFixtureRunDefaults } from './br-receita-cnpj-full-join-engine-fixtures';
import type { BrazilReceitaFullJoinEngineExactObservations } from './br-receita-cnpj-full-join-engine-report';
import { BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT } from './br-receita-cnpj-full-join-no-write-guard';
import {
  createBrazilReceitaFullJoinResourceProcessDependencies,
  type BrazilReceitaFullJoinResourceDependencies,
} from './br-receita-cnpj-full-join-resource-envelope';
import {
  BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS,
  brazilReceitaProposedFullScanResourceCaps,
} from './br-receita-cnpj-real-full-scan-benchmark';
import {
  createBrazilReceitaFullJoinBenchmarkAttemptLedger,
  runBrazilReceitaFullJoinSyntheticFixtureBenchmark,
  type BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs,
  type BrazilReceitaFullJoinSyntheticBenchmarkOutcome,
} from './br-receita-cnpj-full-join-resource-benchmark';
import { sanitizeBrazilReceitaFullJoinReport } from './br-receita-cnpj-full-join-output-sanitizer';

// ─── Version & mode label ─────────────────────────────────────────────────────

export const BRAZIL_RECEITA_14B0I_HARNESS_VERSION = 1 as const;

export const BRAZIL_RECEITA_14B0I_HARNESS_MODES = ['structural_ci', 'local_performance'] as const;
export type BrazilReceita14B0IHarnessMode = (typeof BRAZIL_RECEITA_14B0I_HARNESS_MODES)[number];

/** Never advances (Date.now(), a real clock read from THIS module). Only used to label a report. */
export const BRAZIL_RECEITA_14B0I_HARNESS_LABELS = {
  engineeringTargetOnly: true,
  gate2Evidence: false,
  realDataEvidence: false,
  productionSla: false,
} as const;

// ─── Caps, unchanged from 14B.0H's proposed profile (§ 14) ────────────────────

export function brazilReceita14B0IReaderCaps(): {
  maxChunkBytes: number;
  maxCarryBytes: number;
  maxRowBytes: number;
  maxColumnsPerRow: number;
} {
  const proposal = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
  return {
    maxChunkBytes: proposal.maxChunkBytes,
    maxCarryBytes: proposal.maxCarryBytes,
    maxRowBytes: proposal.maxRowBytes,
    maxColumnsPerRow: proposal.maxColumnsPerRow,
  };
}

export function brazilReceita14B0IPartitioningCaps(): {
  partitionCount: number;
  maxPartitionCount: number;
  maxPartitionDepth: number;
  maxReferencesPerPartition: number;
  maxReferenceBytesPerPartition: number;
} {
  const proposal = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
  return {
    partitionCount: proposal.partitionCount,
    maxPartitionCount: proposal.maxPartitionCount,
    maxPartitionDepth: proposal.maxPartitionDepth,
    maxReferencesPerPartition: proposal.maxReferencesPerPartition,
    maxReferenceBytesPerPartition: proposal.maxReferenceBytesPerPartition,
  };
}

// ─── Phase metrics ────────────────────────────────────────────────────────────

export interface BrazilReceita14B0IPhaseMetric {
  readonly sourceBytesRead: number;
  readonly rowsRead: number;
  readonly durationMs: number | null;
  readonly sourceMibPerSecond: number | null;
  readonly rowsPerSecond: number | null;
}

function mibPerSecond(bytes: number, durationMs: number | null): number | null {
  if (durationMs === null || durationMs <= 0) return null;
  return bytes / 1_048_576 / (durationMs / 1000);
}

function perSecond(count: number, durationMs: number | null): number | null {
  if (durationMs === null || durationMs <= 0) return null;
  return count / (durationMs / 1000);
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface BrazilReceita14B0IHarnessRunReport {
  readonly mode: BrazilReceita14B0IHarnessMode;
  readonly ok: boolean;
  readonly abortCode: string | null;
  readonly exitStatus: 'completed' | 'aborted' | 'refused';
  readonly oracle: BrazilReceita14B0ISyntheticOracle;
  /** `null` when the run was refused before the engine executed. */
  readonly exact: BrazilReceitaFullJoinEngineExactObservations | null;
  readonly actualMatches: number | null;
  readonly matchCountMatchesOracle: boolean | null;
  readonly sanitizerPassed: boolean | null;
  readonly meteringSnapshot: BrazilReceita14B0IMeteringSnapshot | null;
  readonly synthetic: {
    readonly syntheticSourceBytesTotal: number;
    readonly syntheticRowsTotal: number;
    readonly totalWallClockMs: number | null;
    readonly sourceReadMibPerSecondOverall: number | null;
    readonly rowsPerSecondOverall: number | null;
    readonly referencesPerSecondOverall: number | null;
    readonly referenceWriteMibPerSecond: number | null;
    readonly empresas: BrazilReceita14B0IPhaseMetric;
    readonly estabelecimentos: BrazilReceita14B0IPhaseMetric;
    readonly partitionedJoinDurationMs: number | null;
    readonly partitionedJoinEffectiveReferencesPerSecond: number | null;
    readonly cleanupDurationMs: number | null;
    readonly sanitizationDurationMs: number | null;
  };
}

export interface BrazilReceita14B0IHarnessRunRequest {
  readonly mode: BrazilReceita14B0IHarnessMode;
  readonly plan: BrazilReceita14B0ISyntheticScenarioPlan;
  readonly workingDirectory: BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs;
  readonly resourceDependencies?: BrazilReceitaFullJoinResourceDependencies;
  /**
   * Test-only escape hatch: overrides the resource caps otherwise taken unchanged from
   * `BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS`. Exists so a test can force a deliberate
   * cap breach (e.g. a tiny `maxRowsRead`) to exercise the abort path — never used by the
   * `local_performance` script, which always takes the unmodified proposed profile.
   */
  readonly resourceCapsOverride?: ReturnType<typeof brazilReceitaProposedFullScanResourceCaps>;
  /** Test-only escape hatch: overrides the free-disk probe, e.g. with a call-counting spy. */
  readonly freeDiskProbeOverride?: (targetPath: string) => number;
}

/**
 * Runs ONE full generate → meter → real-engine → measure cycle and returns a complete report.
 *
 * Always disposes the fixture it created, on every path — success, engine abort, or a preflight
 * refusal raised before the engine ever ran.
 */
export async function runBrazilReceita14B0ISyntheticThroughputRun(
  request: BrazilReceita14B0IHarnessRunRequest,
): Promise<BrazilReceita14B0IHarnessRunReport> {
  const fixture: BrazilReceita14B0ISyntheticFixtureHandle = await createBrazilReceita14B0ISyntheticFixture(
    request.plan,
  );

  // A measurement-isolation step, not an engine optimization: fixture generation builds and
  // discards large batched strings (see the generator's `GENERATOR_WRITE_BATCH_ROWS`), and at the
  // `local_performance` scale that garbage can still be reachable-but-dead when the FIRST resource
  // checkpoint samples heap, inflating `peakHeapUsedBytes` with bytes the engine itself never
  // touched. `global.gc` exists only when the process was started with `--expose-gc` (this
  // module's `local_performance` npm script sets `NODE_OPTIONS=--expose-gc`); it is a no-op
  // everywhere else, including every `structural_ci` test, which never needs it at these scales.
  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    (globalThis as { gc: () => void }).gc();
  }

  try {
    const readerCaps = brazilReceita14B0IReaderCaps();
    const partitioningCaps = brazilReceita14B0IPartitioningCaps();
    const resourceCaps = request.resourceCapsOverride ?? brazilReceitaProposedFullScanResourceCaps();
    const runDefaults = brazilReceitaFullJoinFixtureRunDefaults(
      request.freeDiskProbeOverride !== undefined
        ? { freeDiskProbe: request.freeDiskProbeOverride }
        : {},
    );

    const metering = createBrazilReceita14B0IMeteringReaderFileSystem({
      realFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      sources: fixture.sources,
      maxChunkBytes: readerCaps.maxChunkBytes,
    });

    const outcome: BrazilReceitaFullJoinSyntheticBenchmarkOutcome =
      await runBrazilReceitaFullJoinSyntheticFixtureBenchmark({
        workingDirectory: request.workingDirectory,
        attemptLedger: createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
        noWriteContract: BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
        engineRequest: {
          sources: fixture.sources,
          readerCaps,
          partitioningCaps,
          resourceCaps,
          duplicateKeyPolicy: 'pair_with_every_duplicate',
          sink: createNullSink(),
          readerFileSystem: metering.fileSystem,
          workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
          workspaceParentDirectory: fixture.workspaceParentDirectory,
          workspaceBoundaries: {
            repositoryRoot: request.workingDirectory.repositoryRoot,
            homeDirectory: request.workingDirectory.homeDirectory,
            datasetRoot: fixture.datasetRoot,
          },
          resourceDependencies:
            request.resourceDependencies ?? createBrazilReceitaFullJoinResourceProcessDependencies(),
          openHandleLedger: runDefaults.openHandleLedger,
          maxOpenPartitionFiles: runDefaults.maxOpenPartitionFiles,
          // Taken from the SAME proposed profile as `resourceCaps.maxTemporaryStorageBytes`, never
          // from the fixture module's small generic defaults: those defaults were sized for suites
          // whose `maxTemporaryStorageBytes` is small too, and pairing them with this profile's 4
          // GiB cap would fail `resolveBrazilReceitaFullJoinFreeDiskThresholds`'s OWN relational
          // check (`reserve_below_temporary_storage_cap`) before a single file is opened.
          minimumFreeDiskBeforeStart: BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.minimumFreeDiskBeforeStart,
          minimumFreeDiskReserve: BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.minimumFreeDiskReserve,
          freeDiskProbe: runDefaults.freeDiskProbe,
          realDataRun: false,
          sinkMaterializesRows: false,
        },
      });

    const meteringSnapshot = metering.snapshot();

    if (!outcome.ok) {
      return {
        mode: request.mode,
        ok: false,
        abortCode: outcome.abortCode,
        exitStatus: 'refused',
        oracle: fixture.oracle,
        exact: null,
        actualMatches: null,
        matchCountMatchesOracle: null,
        sanitizerPassed: null,
        meteringSnapshot,
        synthetic: emptySyntheticMetrics(fixture),
      };
    }

    const exact = outcome.result.exact;
    const empresasBytes = meteringSnapshot.byFamily.empresas?.chunkReadBytes ?? 0;
    const estabBytes = meteringSnapshot.byFamily.estabelecimentos?.chunkReadBytes ?? 0;
    const empresasRows = exact.empresaRowsTraversed;
    const estabRows = exact.estabelecimentoRowsTraversed;
    const empresasDurationMs = exact.resource.phaseDurationsMs.empresas_read;
    const estabDurationMs = exact.resource.phaseDurationsMs.estabelecimentos_read;
    const cleanupDurationMs = exact.resource.phaseDurationsMs.cleanup;
    const sanitizationDurationMs = exact.resource.phaseDurationsMs.sanitization;
    const totalWallClockMs = exact.resource.totalDurationMs;

    const referencePassDurationMs = sumDurations([empresasDurationMs, estabDurationMs]);
    const totalSourceBytes = empresasBytes + estabBytes;

    const partitionedJoinDurationMs = derivePartitionedJoinDurationMs(exact);
    const partitionedJoinEffectiveReferencesPerSecond = perSecond(
      exact.referencesPersisted,
      partitionedJoinDurationMs,
    );

    const sanitized = sanitizeBrazilReceitaFullJoinReport(outcome.result.publicReport);

    return {
      mode: request.mode,
      ok: true,
      abortCode: outcome.result.abortCode,
      exitStatus: outcome.result.exitStatus,
      oracle: fixture.oracle,
      exact,
      actualMatches: exact.matchesEmitted,
      matchCountMatchesOracle: exact.matchesEmitted === fixture.oracle.expectedMatches,
      sanitizerPassed: sanitized.ok,
      meteringSnapshot,
      synthetic: {
        syntheticSourceBytesTotal: fixture.totalSourceBytes,
        syntheticRowsTotal: fixture.totalRows,
        totalWallClockMs,
        sourceReadMibPerSecondOverall: mibPerSecond(totalSourceBytes, totalWallClockMs),
        rowsPerSecondOverall: perSecond(empresasRows + estabRows, totalWallClockMs),
        referencesPerSecondOverall: perSecond(exact.referencesPersisted, totalWallClockMs),
        referenceWriteMibPerSecond: mibPerSecond(
          exact.temporaryStorageBytesWritten,
          referencePassDurationMs,
        ),
        empresas: {
          sourceBytesRead: empresasBytes,
          rowsRead: empresasRows,
          durationMs: empresasDurationMs,
          sourceMibPerSecond: mibPerSecond(empresasBytes, empresasDurationMs),
          rowsPerSecond: perSecond(empresasRows, empresasDurationMs),
        },
        estabelecimentos: {
          sourceBytesRead: estabBytes,
          rowsRead: estabRows,
          durationMs: estabDurationMs,
          sourceMibPerSecond: mibPerSecond(estabBytes, estabDurationMs),
          rowsPerSecond: perSecond(estabRows, estabDurationMs),
        },
        partitionedJoinDurationMs,
        partitionedJoinEffectiveReferencesPerSecond,
        cleanupDurationMs,
        sanitizationDurationMs,
      },
    };
  } finally {
    fixture.dispose();
  }
}

function emptySyntheticMetrics(
  fixture: BrazilReceita14B0ISyntheticFixtureHandle,
): BrazilReceita14B0IHarnessRunReport['synthetic'] {
  return {
    syntheticSourceBytesTotal: fixture.totalSourceBytes,
    syntheticRowsTotal: fixture.totalRows,
    totalWallClockMs: null,
    sourceReadMibPerSecondOverall: null,
    rowsPerSecondOverall: null,
    referencesPerSecondOverall: null,
    referenceWriteMibPerSecond: null,
    empresas: { sourceBytesRead: 0, rowsRead: 0, durationMs: null, sourceMibPerSecond: null, rowsPerSecond: null },
    estabelecimentos: {
      sourceBytesRead: 0,
      rowsRead: 0,
      durationMs: null,
      sourceMibPerSecond: null,
      rowsPerSecond: null,
    },
    partitionedJoinDurationMs: null,
    partitionedJoinEffectiveReferencesPerSecond: null,
    cleanupDurationMs: null,
    sanitizationDurationMs: null,
  };
}

function sumDurations(values: ReadonlyArray<number | null>): number | null {
  let sum = 0;
  let sawAny = false;
  for (const value of values) {
    if (value === null) continue;
    sum += value;
    sawAny = true;
  }
  return sawAny ? sum : null;
}

/**
 * The partitioned-join stage does not get a clean `phaseDurationsMs` entry of its own: the engine
 * re-opens the `estabelecimentos_read` phase name for the join stage, and the resource enforcer's
 * `beginPhase`/`endPhase` only ever records the FIRST begin→end window for a given phase name (see
 * `br-receita-cnpj-full-join-resource-envelope`'s `beginPhase`) — which is exactly what makes
 * `phaseDurationsMs.estabelecimentos_read` equal to the REFERENCE PASS alone, the figure this
 * module wants for `estabelecimentos`. The join stage's own duration is therefore derived by
 * subtraction from the total, never asserted as a fact the engine reported directly. A negative
 * remainder — possible only from sub-millisecond rounding — is clamped to zero rather than surfaced
 * as a nonsensical negative duration.
 */
function derivePartitionedJoinDurationMs(
  exact: BrazilReceitaFullJoinEngineExactObservations,
): number | null {
  const total = exact.resource.totalDurationMs;
  if (total === null) return null;
  const accountedFor = sumDurations([
    exact.resource.phaseDurationsMs.empresas_read,
    exact.resource.phaseDurationsMs.estabelecimentos_read,
    exact.resource.phaseDurationsMs.cleanup,
    exact.resource.phaseDurationsMs.sanitization,
  ]);
  if (accountedFor === null) return null;
  return Math.max(0, total - accountedFor);
}

function createNullSink() {
  return {
    onMatch(): void {
      // Intentionally empty: this benchmark emits, retains and persists zero rows. See the engine
      // contract's `BrazilReceitaFullJoinNullBenchmarkSink` for the canonical zero-retention sink;
      // a bespoke one is used here only so this module owns no dependency on its tally shape.
    },
    finalize(): void {
      // Intentionally empty.
    },
  };
}

// ─── Multi-run aggregation (§ 12) ─────────────────────────────────────────────

export interface BrazilReceita14B0IAggregateStat {
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
  readonly samples: readonly number[];
}

function aggregate(values: ReadonlyArray<number | null>): BrazilReceita14B0IAggregateStat {
  const samples = values.filter((value): value is number => value !== null);
  if (samples.length === 0) return { min: null, median: null, max: null, samples: [] };
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return { min: sorted[0]!, median, max: sorted[sorted.length - 1]!, samples };
}

export interface BrazilReceita14B0IAggregateReport {
  readonly runs: readonly BrazilReceita14B0IHarnessRunReport[];
  readonly sourceReadMibPerSecond: BrazilReceita14B0IAggregateStat;
  readonly rowsPerSecond: BrazilReceita14B0IAggregateStat;
}

/** Runs the harness `runCount` times sequentially (never in parallel — each run wants a clean cache/FD state) and aggregates. */
export async function runBrazilReceita14B0ISyntheticThroughputRuns(
  request: BrazilReceita14B0IHarnessRunRequest,
  runCount: number,
): Promise<BrazilReceita14B0IAggregateReport> {
  if (!Number.isInteger(runCount) || runCount <= 0) {
    throw new Error('runCount must be a positive integer');
  }
  const runs: BrazilReceita14B0IHarnessRunReport[] = [];
  for (let index = 0; index < runCount; index += 1) {
    runs.push(await runBrazilReceita14B0ISyntheticThroughputRun(request));
  }
  return {
    runs,
    sourceReadMibPerSecond: aggregate(runs.map((run) => run.synthetic.sourceReadMibPerSecondOverall)),
    rowsPerSecond: aggregate(runs.map((run) => run.synthetic.rowsPerSecondOverall)),
  };
}

// ─── Classification (§ 17, § 18) ──────────────────────────────────────────────

export const BRAZIL_RECEITA_14B0I_MINIMUM_ENGINEERING_SOURCE_READ_TARGET_MIB_S = 5 as const;
export const BRAZIL_RECEITA_14B0I_HEALTHY_MARGIN_TARGET_MIB_S = 10 as const;
/** The 68 GiB / 6 h envelope's implied rate. The floor below which Model A is still insufficient. */
export const BRAZIL_RECEITA_14B0I_BORDERLINE_FLOOR_MIB_S = 3.2 as const;

export const BRAZIL_RECEITA_14B0I_SOURCE_READ_CLASSIFICATIONS = ['A1', 'A2', 'B', 'C'] as const;
export type BrazilReceita14B0ISourceReadClassification =
  (typeof BRAZIL_RECEITA_14B0I_SOURCE_READ_CLASSIFICATIONS)[number];

/** Classifies a MEDIAN synthetic source-read throughput. `null` (no successful run) is `C`. */
export function classifyBrazilReceita14B0ISourceReadThroughput(
  medianMibPerSecond: number | null,
): BrazilReceita14B0ISourceReadClassification {
  if (medianMibPerSecond === null) return 'C';
  if (medianMibPerSecond >= BRAZIL_RECEITA_14B0I_HEALTHY_MARGIN_TARGET_MIB_S) return 'A1';
  if (medianMibPerSecond >= BRAZIL_RECEITA_14B0I_MINIMUM_ENGINEERING_SOURCE_READ_TARGET_MIB_S) return 'A2';
  if (medianMibPerSecond >= BRAZIL_RECEITA_14B0I_BORDERLINE_FLOOR_MIB_S) return 'B';
  return 'C';
}

export const BRAZIL_RECEITA_14B0I_SECOND_BENCHMARK_RECOMMENDATIONS = ['YES', 'DEFER', 'NO'] as const;
export type BrazilReceita14B0ISecondBenchmarkRecommendation =
  (typeof BRAZIL_RECEITA_14B0I_SECOND_BENCHMARK_RECOMMENDATIONS)[number];

/**
 * § 18's rule, and nothing else: this is advisory ONLY. It never authorizes, executes, or flips a
 * source constant — it is a label an owner may read before deciding anything.
 */
export function recommendBrazilReceita14B0ISecondRealBenchmark(
  classification: BrazilReceita14B0ISourceReadClassification,
): BrazilReceita14B0ISecondBenchmarkRecommendation {
  if (classification === 'A1' || classification === 'A2') return 'YES';
  if (classification === 'B') return 'DEFER';
  return 'NO';
}
