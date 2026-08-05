/**
 * BR Receita CNPJ — BOUNDED CALIBRATION INSTRUMENTATION (BR-SOURCE-14B.0A).
 *
 * The measuring instrument for the ULTRA-BOUNDED REQUIRED-FAMILY REAL JOIN PROBE, and nothing
 * else. It exists because BR-SOURCE-14A closed with the owner authorizing ONE read-only
 * calibration of the real 11G join probe, and that calibration cannot be delivered: five of the
 * eleven metrics it must report — peak RSS, peak heap, total duration, per-phase duration and
 * peak temporary storage — have no instrument behind them. This module is that instrument.
 *
 * It measures. It authorizes nothing, it reads no dataset, and it opens no file.
 *
 * ── What this module is NOT ─────────────────────────────────────────────────────
 * It is not a cap, not a watchdog, and not an enforcement point. The 11G probe already owns a
 * liveness deadline and eleven caps; this module observes and never votes. A measurement can
 * never abort a run, widen a cap, or change an outcome — which is why every value it produces
 * is derived AFTER the fact from samples taken at fixed points, and why nothing reads a
 * measurement back into control flow.
 *
 * ── Two clocks that must never be mixed ─────────────────────────────────────────
 * The 11G probe's `nowMs` is a WALL clock: it exists to enforce a deadline, and a wall clock is
 * the correct instrument for "has this run outlived its allowance". Durations are a different
 * question, and a wall clock answers it wrongly — an NTP step or a suspend/resume can make an
 * interval negative. So this module carries its OWN clock, monotonic and injected, and the two
 * are never combined into one figure. `clock` is nanoseconds since an arbitrary origin; only
 * DIFFERENCES of it are ever meaningful, and only differences are ever taken.
 *
 * ── Buckets, not figures ────────────────────────────────────────────────────────
 * Every emitted magnitude is a BUCKET. Three independent reasons, any one of which suffices:
 *
 *   1. The full-join output sanitizer rejects any numeric leaf at or beyond eight digits. A
 *      peak RSS in bytes is eight to ten digits, so an exact figure could not ship even if it
 *      were desirable — it would fail closed at the output boundary as `oversized_numeric_value`.
 *   2. A duration and a resident-set size are weak side channels on the bytes and rows that were
 *      read. The windows are 20 rows wide, so the channel is thin, but a bucket closes it
 *      without costing the milestone anything it needs.
 *   3. GATE-2 needs orders of magnitude, not microseconds. A bucket is the honest resolution of
 *      a single ultra-bounded run.
 *
 * If a later gate genuinely needs exact figures, they belong in a private operator artifact
 * outside this repository. The versioned report stays bucketed.
 *
 * ── Instrumentation failure is never terminal ───────────────────────────────────
 * See `BRAZIL_RECEITA_CALIBRATION_INSTRUMENTATION_FAILURE_POLICY`.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - performs I/O of any kind: no open, no read, no write, no stat, no directory listing.
 *   - reads an environment variable, a hostname, a username, or a filesystem path.
 *   - emits a raw memory snapshot, a raw timestamp, an exact byte figure, or an exact duration.
 *   - emits a path, a file name, a row, a cell, or a join key — it is never handed one.
 *   - starts a timer, an interval, or an async task. Every sample is taken synchronously at a
 *     fixed call site, so nothing here can keep a process alive or leak a handle.
 *   - changes the outcome, the exit status, the abort code, or the caps of the run it observes.
 */

// ─── Version ──────────────────────────────────────────────────────────────────

/**
 * The measurement CONTRACT version. Bumped when a field changes meaning or a bucket boundary
 * moves — a consumer comparing two runs must be able to tell that the ruler itself changed.
 */
export const BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION = 1 as const;

/**
 * The failure policy, chosen deliberately over `instrumentation_failure_is_terminal`.
 *
 * A terminal policy would let a throwing memory sampler abort a run that was otherwise valid —
 * turning an observation into a control-flow participant and changing the exit status of the
 * very thing it was added to watch. That breaks the compatibility obligation ("the
 * instrumentation must not alter exit status, abort codes, or CLI behaviour") and it fails
 * closed in the wrong direction: a broken RULER is not a broken RUN.
 *
 * So an instrumentation failure is contained: the offending sample is dropped,
 * `instrumentation_failure_count` is incremented, `measurement_complete` becomes `false`, and
 * control flow is untouched. This is NOT a swallowed error — the degradation is reported as a
 * first-class field, and a consumer that requires a complete measurement must check it.
 *
 * The asymmetry that matters: instrumentation can never make a FAILED run look successful,
 * because it never writes to the run's outcome at all. It has no channel to do so.
 */
export const BRAZIL_RECEITA_CALIBRATION_INSTRUMENTATION_FAILURE_POLICY =
  'instrumentation_failure_marks_measurement_incomplete_and_preserves_original_failure' as const;

// ─── Phases ───────────────────────────────────────────────────────────────────

/**
 * The closed set of phases, taken from the REAL structure of the 11G run rather than from an
 * idealized pipeline. Boundaries, precisely:
 *
 *   `preflight`             — runner-owned. Entry of the 11G run through the end of the join
 *                             gate: the manifest metadata gate, the five authorizations and the
 *                             eleven caps. Closes immediately before the probe reader is called,
 *                             so no descriptor exists inside it.
 *   `manifest_validation`   — probe-owned. Probe entry through completed file selection: the
 *                             read-time cap re-check, the bounded manifest control-document
 *                             read, the JSON parse, the family classification and the
 *                             one-file-per-required-family selection.
 *   `empresas_read`         — probe-owned. The bounded prefix read of the FIRST required family.
 *                             Includes building the capped join-key window, which is not
 *                             separable from the read that feeds it.
 *   `estabelecimentos_read` — probe-owned. The bounded prefix read of the SECOND required
 *                             family. Includes the join's membership tests — see
 *                             `BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES`.
 *   `join`                  — NOT SEPARABLE. Declared, never timed. See below.
 *   `cleanup`               — runner-owned. The cleanup PLAN call.
 *   `sanitization`          — runner-owned. The output sanitizer call.
 *   `total`                 — runner-owned. Entry through the end of sanitization.
 *
 * Phases do not overlap and each has exactly one owner, so two surfaces can instrument the same
 * run without double-counting.
 */
export type BrazilReceitaCalibrationPhase =
  | 'preflight'
  | 'manifest_validation'
  | 'empresas_read'
  | 'estabelecimentos_read'
  | 'join'
  | 'cleanup'
  | 'sanitization'
  | 'total';

export const BRAZIL_RECEITA_CALIBRATION_PHASES: readonly BrazilReceitaCalibrationPhase[] = [
  'preflight',
  'manifest_validation',
  'empresas_read',
  'estabelecimentos_read',
  'join',
  'cleanup',
  'sanitization',
  'total',
];

/**
 * Phases that CANNOT be timed independently in the 11G runner as it exists, mapped to the phase
 * they are folded into.
 *
 * `join` is the whole of it. The 11G join is not a stage that runs after the reads — it is a
 * membership test performed inside them: the first family's read ADDS each parsed key to the
 * bounded window, and the second family's read TESTS each parsed key against it. There is no
 * instant at which "the join begins". The only separable remnant is turning two tallies into
 * buckets and releasing the window, and timing THAT and calling it "the join" would be false
 * precision of the worst kind — it would report the join as effectively free while the work it
 * names sits inside `estabelecimentos_read`.
 *
 * So `join` is reported as `not_separable` with a pointer to where its cost actually lives. A
 * reader learns the truth; a reader of a fabricated `join: lte_1ms` would not.
 */
export const BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES: Readonly<
  Partial<Record<BrazilReceitaCalibrationPhase, BrazilReceitaCalibrationPhase>>
> = {
  join: 'estabelecimentos_read',
};

/**
 * The phases a COMPLETE 11G measurement must have timed. `join` is absent by construction: a
 * non-separable phase cannot be required to carry a duration.
 */
export const BRAZIL_RECEITA_CALIBRATION_REQUIRED_TIMED_PHASES: readonly BrazilReceitaCalibrationPhase[] =
  BRAZIL_RECEITA_CALIBRATION_PHASES.filter(
    (phase) => BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES[phase] === undefined,
  );

// ─── Sample points ────────────────────────────────────────────────────────────

/**
 * The deterministic instants at which memory is sampled. Fixed call sites, never a timer: a
 * periodic sampler would be a live handle that could outlive the run, keep the process alive,
 * or fire inside a phase boundary and make two runs with identical inputs disagree.
 *
 * `after_cleanup` precedes `after_sanitization` because that is the real order of the 11G
 * runner: the cleanup plan is assembled into the candidate report, and the assembled report is
 * then sanitized. The instrumentation reports the order it observed and does not reorder the
 * run to match a tidier list.
 */
export type BrazilReceitaCalibrationSamplePoint =
  | 'before_preflight'
  | 'after_manifest_validation'
  | 'after_empresas_read'
  | 'after_estabelecimentos_read'
  | 'after_join'
  | 'after_cleanup'
  | 'after_sanitization';

export const BRAZIL_RECEITA_CALIBRATION_SAMPLE_POINTS: readonly BrazilReceitaCalibrationSamplePoint[] =
  [
    'before_preflight',
    'after_manifest_validation',
    'after_empresas_read',
    'after_estabelecimentos_read',
    'after_join',
    'after_cleanup',
    'after_sanitization',
  ];

// ─── Buckets ──────────────────────────────────────────────────────────────────

/**
 * A duration as a bucket.
 *
 * `not_measured`  — the phase never opened, or opened and never closed. An unclosed phase is
 *                   NOT reported as "however long the run lasted": a phase that was cut short
 *                   has no duration, and inventing one would turn a refusal into a data point.
 * `not_separable` — the phase exists but cannot be timed independently. See
 *                   `BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES`.
 */
export type BrazilReceitaCalibrationDurationBucket =
  | 'lte_1ms'
  | 'lte_10ms'
  | 'lte_100ms'
  | 'lte_1s'
  | 'lte_10s'
  | 'lte_60s'
  | 'gt_60s'
  | 'not_measured'
  | 'not_separable';

export const BRAZIL_RECEITA_CALIBRATION_DURATION_BUCKETS: readonly BrazilReceitaCalibrationDurationBucket[] =
  [
    'lte_1ms',
    'lte_10ms',
    'lte_100ms',
    'lte_1s',
    'lte_10s',
    'lte_60s',
    'gt_60s',
    'not_measured',
    'not_separable',
  ];

/**
 * Duration bucket boundaries in NANOSECONDS, ascending, each inclusive. Centralized here and
 * nowhere else: a second module inventing its own ranges is how two reports that look
 * comparable stop being comparable.
 *
 * Built with `BigInt(...)` rather than `1_000_000n`: the project targets ES2017, where the literal
 * suffix is a syntax error, while the `esnext` lib still provides the type and the constructor.
 */
const ZERO_NS = BigInt(0);

const DURATION_BUCKET_CEILINGS_NS: ReadonlyArray<
  readonly [ceilingNs: bigint, bucket: BrazilReceitaCalibrationDurationBucket]
> = [
  [BigInt(1_000_000), 'lte_1ms'],
  [BigInt(10_000_000), 'lte_10ms'],
  [BigInt(100_000_000), 'lte_100ms'],
  [BigInt(1_000_000_000), 'lte_1s'],
  [BigInt(10_000_000_000), 'lte_10s'],
  [BigInt(60_000_000_000), 'lte_60s'],
];

/** A memory magnitude as a bucket. `not_measured` when no sample was ever taken. */
export type BrazilReceitaCalibrationMemoryBucket =
  | 'lte_16mb'
  | 'lte_64mb'
  | 'lte_256mb'
  | 'lte_1gb'
  | 'lte_4gb'
  | 'gt_4gb'
  | 'not_measured';

export const BRAZIL_RECEITA_CALIBRATION_MEMORY_BUCKETS: readonly BrazilReceitaCalibrationMemoryBucket[] =
  ['lte_16mb', 'lte_64mb', 'lte_256mb', 'lte_1gb', 'lte_4gb', 'gt_4gb', 'not_measured'];

/** Memory bucket boundaries in BYTES, ascending, each inclusive. Binary units. */
const MEMORY_BUCKET_CEILINGS_BYTES: ReadonlyArray<
  readonly [ceilingBytes: number, bucket: BrazilReceitaCalibrationMemoryBucket]
> = [
  [16 * 1024 * 1024, 'lte_16mb'],
  [64 * 1024 * 1024, 'lte_64mb'],
  [256 * 1024 * 1024, 'lte_256mb'],
  [1024 * 1024 * 1024, 'lte_1gb'],
  [4 * 1024 * 1024 * 1024, 'lte_4gb'],
];

/**
 * Buckets a duration. A NEGATIVE interval is `not_measured` rather than `lte_1ms`: a monotonic
 * clock cannot go backwards, so a negative difference means the clock dependency misbehaved and
 * the honest answer is that nothing was measured.
 */
export function toBrazilReceitaCalibrationDurationBucket(
  durationNs: bigint | null,
): BrazilReceitaCalibrationDurationBucket {
  if (durationNs === null || durationNs < ZERO_NS) return 'not_measured';
  for (const [ceiling, bucket] of DURATION_BUCKET_CEILINGS_NS) {
    if (durationNs <= ceiling) return bucket;
  }
  return 'gt_60s';
}

/** Buckets a memory magnitude. A negative or non-finite figure is `not_measured`. */
export function toBrazilReceitaCalibrationMemoryBucket(
  bytes: number | null,
): BrazilReceitaCalibrationMemoryBucket {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'not_measured';
  for (const [ceiling, bucket] of MEMORY_BUCKET_CEILINGS_BYTES) {
    if (bytes <= ceiling) return bucket;
  }
  return 'gt_4gb';
}

// ─── Temporary storage ────────────────────────────────────────────────────────

/**
 * Whether the executed path had a temporary storage envelope at all.
 *
 * `disabled` is DERIVED from the run, not asserted about the machine: the recorder counts
 * workspace creations, the 11G path creates none, and the count is therefore zero. The
 * alternative — inspecting the filesystem for temporary files — would be both a lie (it cannot
 * attribute a file to this run) and a violation (it would name operator paths).
 */
export type BrazilReceitaCalibrationTemporaryStorageMode = 'disabled' | 'observed';

export type BrazilReceitaCalibrationTemporaryStorageObservation =
  | 'not_applicable_no_workspace_created'
  | 'workspace_created_peak_observed';

// ─── Dependencies ─────────────────────────────────────────────────────────────

/** A MONOTONIC clock in nanoseconds. Only differences are meaningful. */
export type BrazilReceitaCalibrationClock = () => bigint;

/**
 * One memory observation. Deliberately the three figures that answer the GATE-2 question —
 * resident set, JS heap in use, and off-heap allocations — and nothing else.
 */
export interface BrazilReceitaCalibrationMemorySnapshot {
  readonly rss: number;
  readonly heapUsed: number;
  readonly external: number;
}

export type BrazilReceitaCalibrationMemorySampler = () => BrazilReceitaCalibrationMemorySnapshot;

export interface BrazilReceitaCalibrationDependencies {
  readonly clock: BrazilReceitaCalibrationClock;
  readonly memorySampler: BrazilReceitaCalibrationMemorySampler;
}

/**
 * The real process-backed dependencies. The ONLY place in this milestone that touches `process`,
 * kept behind a factory so every test drives scripted values instead of racing a real clock, and
 * so the 11G probe — whose static guards forbid it a `process` reference — never acquires one.
 *
 * `process.hrtime.bigint()` is monotonic. `Date.now()` is deliberately not used for durations.
 */
export function createBrazilReceitaCalibrationProcessDependencies(): BrazilReceitaCalibrationDependencies {
  return {
    clock: () => process.hrtime.bigint(),
    memorySampler: () => {
      const usage = process.memoryUsage();
      return { rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external };
    },
  };
}

// ─── Measurement contract ─────────────────────────────────────────────────────

/**
 * The sanitized measurement. Every magnitude is a bucket, every count is small and bounded, and
 * every held-absence assertion is stated rather than omitted so a reader can see that it holds.
 *
 * The `*_printed: false` fields are the established shape in this connector: the output
 * sanitizer exempts a key ending in `printed` whose value is literally `false`, so an assertion
 * of absence passes while the same key carrying a payload fails closed.
 */
export interface BrazilReceitaCalibrationMeasurement {
  readonly measurement_version: typeof BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION;
  /**
   * `true` only when every required phase was timed, every sample point was observed, and no
   * instrumentation failure occurred. A consumer that needs a trustworthy calibration must
   * check this before reading anything below it.
   */
  readonly measurement_complete: boolean;
  readonly instrumentation_failure_policy: typeof BRAZIL_RECEITA_CALIBRATION_INSTRUMENTATION_FAILURE_POLICY;
  readonly instrumentation_failure_count: number;
  readonly peak_rss_bucket: BrazilReceitaCalibrationMemoryBucket;
  readonly peak_heap_used_bucket: BrazilReceitaCalibrationMemoryBucket;
  readonly peak_external_memory_bucket: BrazilReceitaCalibrationMemoryBucket;
  readonly memory_observations_taken: number;
  readonly total_duration_bucket: BrazilReceitaCalibrationDurationBucket;
  readonly phase_duration_buckets: Readonly<
    Record<BrazilReceitaCalibrationPhase, BrazilReceitaCalibrationDurationBucket>
  >;
  /** Phases folded into another phase, mapped to where their cost actually lives. */
  readonly non_separable_phases: Readonly<
    Partial<Record<BrazilReceitaCalibrationPhase, BrazilReceitaCalibrationPhase>>
  >;
  readonly temporary_storage_mode: BrazilReceitaCalibrationTemporaryStorageMode;
  readonly temporary_storage_peak_bytes: number;
  readonly temporary_storage_observation: BrazilReceitaCalibrationTemporaryStorageObservation;
  readonly temporary_workspaces_created: number;
  /** Sample points in the order they were actually observed. */
  readonly sample_points_observed: readonly BrazilReceitaCalibrationSamplePoint[];
  readonly exact_values_printed: false;
  readonly raw_memory_observations_printed: false;
  readonly raw_timestamps_printed: false;
  readonly absolute_paths_printed: false;
  readonly file_names_printed: false;
}

// ─── Recorder ─────────────────────────────────────────────────────────────────

/**
 * The observer threaded through a 11G run. Every method is a no-op-on-failure void call: a call
 * site can never be made to handle an instrumentation error, because a call site that had to
 * handle one would be a call site where instrumentation affects control flow.
 */
export interface BrazilReceitaCalibrationRecorder {
  /** Opens a phase. A second open of the same phase is ignored — the first boundary wins. */
  beginPhase(phase: BrazilReceitaCalibrationPhase): void;
  /** Closes a phase. Closing an unopened phase is ignored and leaves it `not_measured`. */
  endPhase(phase: BrazilReceitaCalibrationPhase): void;
  /** Takes a memory observation at a fixed point and folds it into the running peaks. */
  sample(point: BrazilReceitaCalibrationSamplePoint): void;
  /**
   * Declares that this run created a temporary workspace. Nothing in the 11G path calls it —
   * which is exactly what makes `temporary_storage_mode: disabled` a DERIVED fact rather than a
   * hardcoded claim. It exists so a future gate that does create a workspace has a truthful
   * place to say so, and so the zero can be measured today.
   */
  noteTemporaryWorkspaceCreated(peakBytes: number): void;
  /** Projects everything observed into the sanitized measurement. Pure; callable more than once. */
  build(): BrazilReceitaCalibrationMeasurement;
}

interface PhaseRecord {
  startedAtNs: bigint | null;
  durationNs: bigint | null;
}

/**
 * Builds a recorder over injected dependencies.
 *
 * Every dependency call is contained: a throwing clock or sampler increments the failure count
 * and returns, so the observed run continues untouched and the measurement reports itself
 * incomplete. That containment is the whole of
 * `BRAZIL_RECEITA_CALIBRATION_INSTRUMENTATION_FAILURE_POLICY`.
 */
export function createBrazilReceitaCalibrationRecorder(
  dependencies: BrazilReceitaCalibrationDependencies,
): BrazilReceitaCalibrationRecorder {
  const phases = new Map<BrazilReceitaCalibrationPhase, PhaseRecord>();
  const observedPoints: BrazilReceitaCalibrationSamplePoint[] = [];
  let failureCount = 0;
  let memoryObservations = 0;
  let peakRss: number | null = null;
  let peakHeapUsed: number | null = null;
  let peakExternal: number | null = null;
  let temporaryWorkspacesCreated = 0;
  let temporaryStoragePeakBytes = 0;

  /** Reads the monotonic clock, or `null` if the dependency misbehaved. */
  function readClock(): bigint | null {
    try {
      const now = dependencies.clock();
      if (typeof now !== 'bigint') {
        failureCount += 1;
        return null;
      }
      return now;
    } catch {
      // Contained on purpose: the run being observed must not learn that its ruler broke.
      failureCount += 1;
      return null;
    }
  }

  /** Folds one observation into the running peaks. Only the maximum per metric is kept. */
  function foldMemoryPeak(): void {
    let snapshot: BrazilReceitaCalibrationMemorySnapshot;
    try {
      snapshot = dependencies.memorySampler();
    } catch {
      failureCount += 1;
      return;
    }
    if (
      typeof snapshot?.rss !== 'number' ||
      typeof snapshot?.heapUsed !== 'number' ||
      typeof snapshot?.external !== 'number'
    ) {
      failureCount += 1;
      return;
    }
    memoryObservations += 1;
    peakRss = peakRss === null ? snapshot.rss : Math.max(peakRss, snapshot.rss);
    peakHeapUsed = peakHeapUsed === null ? snapshot.heapUsed : Math.max(peakHeapUsed, snapshot.heapUsed);
    peakExternal =
      peakExternal === null ? snapshot.external : Math.max(peakExternal, snapshot.external);
  }

  function phaseRecord(phase: BrazilReceitaCalibrationPhase): PhaseRecord {
    const existing = phases.get(phase);
    if (existing !== undefined) return existing;
    const created: PhaseRecord = { startedAtNs: null, durationNs: null };
    phases.set(phase, created);
    return created;
  }

  return {
    beginPhase(phase) {
      if (BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES[phase] !== undefined) return;
      const record = phaseRecord(phase);
      // The first boundary wins: a re-open would silently discard the earlier start.
      if (record.startedAtNs !== null || record.durationNs !== null) return;
      record.startedAtNs = readClock();
    },

    endPhase(phase) {
      const record = phases.get(phase);
      if (record === undefined || record.startedAtNs === null || record.durationNs !== null) return;
      const now = readClock();
      if (now === null) return;
      record.durationNs = now - record.startedAtNs;
    },

    sample(point) {
      observedPoints.push(point);
      foldMemoryPeak();
    },

    noteTemporaryWorkspaceCreated(peakBytes) {
      temporaryWorkspacesCreated += 1;
      if (Number.isFinite(peakBytes) && peakBytes > temporaryStoragePeakBytes) {
        temporaryStoragePeakBytes = peakBytes;
      }
    },

    build() {
      const phaseDurationBuckets = {} as Record<
        BrazilReceitaCalibrationPhase,
        BrazilReceitaCalibrationDurationBucket
      >;
      for (const phase of BRAZIL_RECEITA_CALIBRATION_PHASES) {
        if (BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES[phase] !== undefined) {
          phaseDurationBuckets[phase] = 'not_separable';
          continue;
        }
        phaseDurationBuckets[phase] = toBrazilReceitaCalibrationDurationBucket(
          phases.get(phase)?.durationNs ?? null,
        );
      }

      const everyRequiredPhaseTimed = BRAZIL_RECEITA_CALIBRATION_REQUIRED_TIMED_PHASES.every(
        (phase) => phaseDurationBuckets[phase] !== 'not_measured',
      );
      const everyPointObserved = BRAZIL_RECEITA_CALIBRATION_SAMPLE_POINTS.every((point) =>
        observedPoints.includes(point),
      );

      const workspaceCreated = temporaryWorkspacesCreated > 0;

      return {
        measurement_version: BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION,
        measurement_complete: failureCount === 0 && everyRequiredPhaseTimed && everyPointObserved,
        instrumentation_failure_policy: BRAZIL_RECEITA_CALIBRATION_INSTRUMENTATION_FAILURE_POLICY,
        instrumentation_failure_count: failureCount,
        peak_rss_bucket: toBrazilReceitaCalibrationMemoryBucket(peakRss),
        peak_heap_used_bucket: toBrazilReceitaCalibrationMemoryBucket(peakHeapUsed),
        peak_external_memory_bucket: toBrazilReceitaCalibrationMemoryBucket(peakExternal),
        memory_observations_taken: memoryObservations,
        total_duration_bucket: phaseDurationBuckets.total,
        phase_duration_buckets: phaseDurationBuckets,
        non_separable_phases: { ...BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES },
        temporary_storage_mode: workspaceCreated ? 'observed' : 'disabled',
        temporary_storage_peak_bytes: workspaceCreated ? temporaryStoragePeakBytes : 0,
        temporary_storage_observation: workspaceCreated
          ? 'workspace_created_peak_observed'
          : 'not_applicable_no_workspace_created',
        temporary_workspaces_created: temporaryWorkspacesCreated,
        sample_points_observed: [...observedPoints],
        exact_values_printed: false,
        raw_memory_observations_printed: false,
        raw_timestamps_printed: false,
        absolute_paths_printed: false,
        file_names_printed: false,
      };
    },
  };
}
