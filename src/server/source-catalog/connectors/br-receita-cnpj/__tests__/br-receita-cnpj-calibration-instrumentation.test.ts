/**
 * BR Receita CNPJ BOUNDED CALIBRATION INSTRUMENTATION — tests (BR-SOURCE-14B.0A).
 *
 * BR-SOURCE-14A closed with the owner authorizing ONE read-only calibration of the real 11G join
 * probe, and that calibration could not be delivered: five of its eleven required metrics — peak
 * RSS, peak heap, total duration, per-phase duration and peak temporary storage — had no
 * instrument behind them. These tests hold the line on what the new instrument may and may not do.
 *
 * The two claims that matter most, and that every test below serves:
 *
 *   1. The instrument MEASURES and never VOTES. Adding it changes no cap, no gate, no abort code,
 *      no file count, no join outcome, no report field, and no exit status. A run with a recorder
 *      and the same run without one are compared field by field, not asserted to be similar.
 *   2. A broken RULER is not a broken RUN. A throwing clock or sampler degrades the MEASUREMENT to
 *      `measurement_complete: false` and leaves the observed run untouched — and it can never move
 *      an outcome in the other direction, because instrumentation has no channel into the report.
 *
 * 100% synthetic. Every manifest and every CSV here is written by this suite into a temp workspace
 * it creates and removes. Every cell is an opaque `SYN-…` token, so no identifier-shaped literal
 * (8-, 11- or 14-digit run) exists in this source file or in any fixture it creates. No real
 * Receita manifest, no real data file, no operator directory, no dataset, no Supabase, no network,
 * no runtime, and no real calibration.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BRAZIL_RECEITA_CALIBRATION_DURATION_BUCKETS,
  BRAZIL_RECEITA_CALIBRATION_INSTRUMENTATION_FAILURE_POLICY,
  BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION,
  BRAZIL_RECEITA_CALIBRATION_MEMORY_BUCKETS,
  BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES,
  BRAZIL_RECEITA_CALIBRATION_PHASES,
  BRAZIL_RECEITA_CALIBRATION_REQUIRED_TIMED_PHASES,
  BRAZIL_RECEITA_CALIBRATION_SAMPLE_POINTS,
  createBrazilReceitaCalibrationProcessDependencies,
  createBrazilReceitaCalibrationRecorder,
  toBrazilReceitaCalibrationDurationBucket,
  toBrazilReceitaCalibrationMemoryBucket,
  type BrazilReceitaCalibrationDependencies,
  type BrazilReceitaCalibrationMemorySnapshot,
  type BrazilReceitaCalibrationRecorder,
} from '../br-receita-cnpj-calibration-instrumentation';
import {
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS,
  createBrazilReceitaRequiredFamilyJoinProbe,
  type BrazilReceitaRequiredFamilyJoinProbeOptions,
} from '../br-receita-cnpj-required-family-join-probe';
import {
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES,
  BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
} from '../br-receita-cnpj-required-family-probe';
import {
  BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
  runBrazilReceitaFullJoinDryRun,
  type BrazilReceitaFullJoinDryRunInput,
  type BrazilReceitaFullJoinDryRunReport,
} from '../br-receita-cnpj-full-join-dry-run-runner';
import { createBrazilReceitaRealManifestMetadataReader } from '../br-receita-cnpj-real-manifest-metadata-reader';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import { BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS } from '../br-receita-cnpj-file-reader';
import {
  ForbiddenFullJoinRunnerModeError,
  main,
  parseFullJoinRunnerArgs,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run';

// ─── Synthetic workspace (written and removed by this suite) ───────────────────

const WORKSPACE_PREFIX = 'br-source-14b0a-calibration-instrumentation-test-';

const createdWorkspaces: string[] = [];

afterEach(() => {
  while (createdWorkspaces.length > 0) {
    const directory = createdWorkspaces.pop()!;
    // Only ever a directory this suite created, directly under the OS temp root.
    if (path.basename(directory).startsWith(WORKSPACE_PREFIX)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

/** Opaque synthetic join-key tokens. They resemble no real root value: no digit run at all. */
const OVERLAPPING_KEYS: readonly string[] = ['SYN-JOIN-ROOT-A', 'SYN-JOIN-ROOT-B'];

/** One synthetic headerless row with the official positional column count for `family`. */
function syntheticRow(family: string, row: number, joinKey: string): string {
  const columns =
    BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS[
      family as keyof typeof BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS
    ]!;
  return Array.from({ length: columns }, (_unused, index) =>
    index === BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX
      ? joinKey
      : ['SYN', family.toUpperCase(), `R${row}`, `C${index}`].join('-'),
  ).join(';');
}

/**
 * A manifest declaring both required families, each with a synthetic CSV beside it. This is the
 * shape the real 11G calibration will need in staging — declared here as a FIXTURE only.
 */
function createCalibrationWorkspace(): { readonly manifestPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), WORKSPACE_PREFIX));
  createdWorkspaces.push(root);

  const files = BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_FAMILIES.map((family) => {
    const relative = `synthetic-${family}.csv`;
    const body = OVERLAPPING_KEYS.map((joinKey, index) =>
      syntheticRow(family, index, joinKey),
    ).join('\n');
    fs.writeFileSync(path.join(root, relative), `${body}\n`, { encoding: 'latin1' });
    return {
      fileType: family,
      path: relative,
      encoding: 'latin1',
      layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
    };
  });

  const manifestPath = path.join(root, 'synthetic-manifest.json');
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        sourceKey: 'br_receita_cnpj_dados_abertos',
        countryCode: 'BR',
        sourceYear: 2026,
        sourcePeriod: '2026-07',
        mode: 'local_manifest_validation',
        layoutMode: BRAZIL_RECEITA_REQUIRED_FAMILY_PROBE_LAYOUT_MODE,
        files,
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8' },
  );
  return { manifestPath };
}

// ─── Caps and run helpers ─────────────────────────────────────────────────────

/** The 11G caps, EXACTLY as the probe declares them. Never restated as literals here. */
const AUTHORIZED_CAPS = {
  maxManifestBytes: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_MANIFEST_BYTES,
  maxDeclaredFiles: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_DECLARED_FILES,
  maxFilesOpened: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED,
  maxBytesPerFile: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE,
  maxRowsPerFile: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE,
  maxTotalRows: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS,
  maxTotalBytes: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES,
  maxJoinInputRows: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS,
  maxJoinKeyValuesInMemory:
    BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY,
  maxJoinPairsEmitted: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED,
  maxJoinedRowsPrinted: BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED,
} as const;

function probeOptions(
  manifestPath: string,
  overrides: Partial<BrazilReceitaRequiredFamilyJoinProbeOptions> = {},
): BrazilReceitaRequiredFamilyJoinProbeOptions {
  return {
    manifestPath,
    requiredFamilyJoinProbeAuthorized: true,
    realLocalJoinDryRunAuthorized: true,
    requiredFamilyProbeAuthorized: true,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    ...AUTHORIZED_CAPS,
    ...overrides,
  };
}

/**
 * A full 11G run through the core runner. `recorder` is the ONLY difference between an
 * instrumented run and a legacy one — which is what makes the equality assertions below meaningful.
 */
function runJoinProbe(
  manifestPath: string,
  recorder?: BrazilReceitaCalibrationRecorder,
  overrides: Partial<BrazilReceitaFullJoinDryRunInput> = {},
): BrazilReceitaFullJoinDryRunReport {
  return runBrazilReceitaFullJoinDryRun({
    mode: 'local_manifest_dry_run',
    manifest: { declared: true },
    allowLocalManifest: true,
    manifestTrust: BRAZIL_RECEITA_FULL_JOIN_REQUIRED_FAMILY_JOIN_PROBE_TRUST,
    realManifestMetadataOnlyOptionBAuthorized: true,
    realManifestMetadataOnlyExecutionAuthorized: true,
    requiredFamilyProbeAuthorized: true,
    requiredFamilyJoinProbeAuthorized: true,
    realLocalJoinDryRunAuthorized: true,
    strict: true,
    outputSanitizationVersion: BRAZIL_RECEITA_FULL_JOIN_OUTPUT_SANITIZATION_VERSION,
    ...AUTHORIZED_CAPS,
    realManifestMetadataReader: createBrazilReceitaRealManifestMetadataReader({
      manifestPath,
      realManifestMetadataOnlyOptionBAuthorized: true,
      realManifestMetadataOnlyExecutionAuthorized: true,
      maxManifestBytes: AUTHORIZED_CAPS.maxManifestBytes,
      maxDeclaredFiles: AUTHORIZED_CAPS.maxDeclaredFiles,
    }),
    requiredFamilyJoinProbeReader: createBrazilReceitaRequiredFamilyJoinProbe(
      probeOptions(manifestPath, recorder === undefined ? {} : { calibrationRecorder: recorder }),
    ),
    ...(recorder === undefined ? {} : { calibrationRecorder: recorder }),
    noWriteMode: true,
    runtimeIntegration: false,
    agent1Integration: false,
    supabaseWrite: false,
    providerCalls: false,
    importExecuted: false,
    productionWrites: false,
    ...overrides,
  } as BrazilReceitaFullJoinDryRunInput);
}

// ─── Scripted dependencies ────────────────────────────────────────────────────

const MEGABYTE = 1024 * 1024;

function snapshot(rssMb: number, heapMb: number, externalMb: number): BrazilReceitaCalibrationMemorySnapshot {
  return { rss: rssMb * MEGABYTE, heapUsed: heapMb * MEGABYTE, external: externalMb * MEGABYTE };
}

/**
 * A clock that advances a FIXED step on every call, and a sampler that walks a scripted list and
 * then repeats its last entry. Deterministic regardless of how many times the instrumented code
 * happens to call them, which is what makes two runs comparable field by field.
 */
function scriptedDependencies(
  options: {
    readonly stepNs?: number;
    readonly snapshots?: readonly BrazilReceitaCalibrationMemorySnapshot[];
  } = {},
): BrazilReceitaCalibrationDependencies {
  const stepNs = options.stepNs ?? 1;
  const snapshots = options.snapshots ?? [snapshot(40, 20, 2)];
  let clockCalls = 0;
  let sampleCalls = 0;
  return {
    clock: () => {
      const value = BigInt(clockCalls * stepNs);
      clockCalls += 1;
      return value;
    },
    memorySampler: () => snapshots[Math.min(sampleCalls++, snapshots.length - 1)]!,
  };
}

function scriptedRecorder(
  options: Parameters<typeof scriptedDependencies>[0] = {},
): BrazilReceitaCalibrationRecorder {
  return createBrazilReceitaCalibrationRecorder(scriptedDependencies(options));
}

/** Drives every phase and sample point to completion, so `measurement_complete` can be true. */
function driveCompleteRun(recorder: BrazilReceitaCalibrationRecorder): void {
  recorder.beginPhase('total');
  recorder.sample('before_preflight');
  for (const phase of ['preflight', 'manifest_validation', 'empresas_read'] as const) {
    recorder.beginPhase(phase);
    recorder.endPhase(phase);
  }
  recorder.sample('after_manifest_validation');
  recorder.sample('after_empresas_read');
  recorder.beginPhase('estabelecimentos_read');
  recorder.endPhase('estabelecimentos_read');
  recorder.sample('after_estabelecimentos_read');
  recorder.sample('after_join');
  recorder.beginPhase('cleanup');
  recorder.endPhase('cleanup');
  recorder.sample('after_cleanup');
  recorder.beginPhase('sanitization');
  recorder.endPhase('sanitization');
  recorder.sample('after_sanitization');
  recorder.endPhase('total');
}

// ─── Buckets ──────────────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0A calibration — buckets', () => {
  it('buckets a duration by centralized, ascending, inclusive ceilings', () => {
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(0)), 'lte_1ms');
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(1_000_000)), 'lte_1ms');
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(1_000_001)), 'lte_10ms');
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(10_000_000)), 'lte_10ms');
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(100_000_000)), 'lte_100ms');
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(1_000_000_000)), 'lte_1s');
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(10_000_000_000)), 'lte_10s');
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(60_000_000_000)), 'lte_60s');
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(60_000_000_001)), 'gt_60s');
  });

  it('buckets a memory magnitude by binary ceilings', () => {
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(0), 'lte_16mb');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(16 * MEGABYTE), 'lte_16mb');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(16 * MEGABYTE + 1), 'lte_64mb');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(64 * MEGABYTE), 'lte_64mb');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(256 * MEGABYTE), 'lte_256mb');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(1024 * MEGABYTE), 'lte_1gb');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(4 * 1024 * MEGABYTE), 'lte_4gb');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(4 * 1024 * MEGABYTE + 1), 'gt_4gb');
  });

  it('refuses to invent a magnitude it does not have', () => {
    assert.equal(toBrazilReceitaCalibrationDurationBucket(null), 'not_measured');
    // A monotonic clock cannot go backwards: a negative interval means the RULER broke, and the
    // honest answer is that nothing was measured — never the smallest bucket.
    assert.equal(toBrazilReceitaCalibrationDurationBucket(BigInt(-1)), 'not_measured');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(null), 'not_measured');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(-1), 'not_measured');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(Number.NaN), 'not_measured');
    assert.equal(toBrazilReceitaCalibrationMemoryBucket(Number.POSITIVE_INFINITY), 'not_measured');
  });

  it('declares every bucket it can emit', () => {
    for (const bucket of ['not_measured', 'not_separable', 'lte_1ms', 'gt_60s'] as const) {
      assert.ok(BRAZIL_RECEITA_CALIBRATION_DURATION_BUCKETS.includes(bucket));
    }
    for (const bucket of ['not_measured', 'lte_16mb', 'gt_4gb'] as const) {
      assert.ok(BRAZIL_RECEITA_CALIBRATION_MEMORY_BUCKETS.includes(bucket));
    }
  });
});

// ─── Peaks ────────────────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0A calibration — peaks conserve the maximum', () => {
  it('keeps the peak RSS, not the last or the first observation', () => {
    // 200 MB in the middle, 30 MB last: only a MAX-keeping fold reports `lte_256mb`.
    const recorder = scriptedRecorder({
      snapshots: [snapshot(30, 10, 1), snapshot(200, 10, 1), snapshot(30, 10, 1)],
    });
    driveCompleteRun(recorder);
    assert.equal(recorder.build().peak_rss_bucket, 'lte_256mb');
  });

  it('keeps the peak heap, not the last or the first observation', () => {
    const recorder = scriptedRecorder({
      snapshots: [snapshot(30, 10, 1), snapshot(30, 500, 1), snapshot(30, 10, 1)],
    });
    driveCompleteRun(recorder);
    assert.equal(recorder.build().peak_heap_used_bucket, 'lte_1gb');
  });

  it('keeps the peak external memory, not the last or the first observation', () => {
    const recorder = scriptedRecorder({
      snapshots: [snapshot(30, 10, 1), snapshot(30, 10, 40), snapshot(30, 10, 1)],
    });
    driveCompleteRun(recorder);
    assert.equal(recorder.build().peak_external_memory_bucket, 'lte_64mb');
  });

  it('reports every metric as not_measured when no observation was ever taken', () => {
    const measurement = scriptedRecorder().build();
    assert.equal(measurement.peak_rss_bucket, 'not_measured');
    assert.equal(measurement.peak_heap_used_bucket, 'not_measured');
    assert.equal(measurement.peak_external_memory_bucket, 'not_measured');
    assert.equal(measurement.memory_observations_taken, 0);
    assert.equal(measurement.measurement_complete, false);
  });
});

// ─── Durations ────────────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0A calibration — durations', () => {
  it('derives the total duration from the injected monotonic clock alone', () => {
    // One step per clock call. `driveCompleteRun` opens `total` first and closes it last, so the
    // total spans every intervening call — and the figure comes ONLY from the scripted clock,
    // which is demonstrated by moving the step and watching the bucket follow it.
    const fast = scriptedRecorder({ stepNs: 20_000_000 });
    driveCompleteRun(fast);
    const fastMeasurement = fast.build();
    assert.equal(fastMeasurement.total_duration_bucket, 'lte_1s');
    assert.equal(fastMeasurement.phase_duration_buckets.total, fastMeasurement.total_duration_bucket);

    const slow = scriptedRecorder({ stepNs: 10_000_000_000 });
    driveCompleteRun(slow);
    assert.equal(slow.build().total_duration_bucket, 'gt_60s');
  });

  it('reports a total no shorter than the phases it contains', () => {
    const recorder = scriptedRecorder({ stepNs: 5_000_000 });
    driveCompleteRun(recorder);
    const buckets = recorder.build().phase_duration_buckets;
    const order = BRAZIL_RECEITA_CALIBRATION_DURATION_BUCKETS.indexOf(buckets.total);
    for (const phase of BRAZIL_RECEITA_CALIBRATION_REQUIRED_TIMED_PHASES) {
      if (phase === 'total') continue;
      assert.ok(
        BRAZIL_RECEITA_CALIBRATION_DURATION_BUCKETS.indexOf(buckets[phase]) <= order,
        `${phase} cannot be bucketed above the total that contains it`,
      );
    }
  });

  it('times each phase independently and deterministically', () => {
    const recorder = scriptedRecorder({ stepNs: 5_000_000 });
    recorder.beginPhase('preflight');
    recorder.endPhase('preflight');
    recorder.beginPhase('manifest_validation');
    recorder.endPhase('manifest_validation');
    const buckets = recorder.build().phase_duration_buckets;
    // Each phase spans exactly ONE step: begin, then end.
    assert.equal(buckets.preflight, 'lte_10ms');
    assert.equal(buckets.manifest_validation, 'lte_10ms');
  });

  it('reports an unclosed phase as not_measured rather than a fabricated duration', () => {
    const recorder = scriptedRecorder({ stepNs: 5_000_000 });
    recorder.beginPhase('total');
    recorder.beginPhase('empresas_read');
    // `estabelecimentos_read` never opens: the run refused before reaching it.
    recorder.beginPhase('cleanup');
    recorder.endPhase('cleanup');
    const measurement = recorder.build();
    assert.equal(measurement.phase_duration_buckets.empresas_read, 'not_measured');
    assert.equal(measurement.phase_duration_buckets.estabelecimentos_read, 'not_measured');
    assert.equal(measurement.phase_duration_buckets.total, 'not_measured');
    assert.equal(measurement.phase_duration_buckets.cleanup, 'lte_10ms');
    assert.equal(measurement.measurement_complete, false);
  });

  it('ignores a re-open and an unmatched close instead of overwriting a boundary', () => {
    const recorder = scriptedRecorder({ stepNs: 5_000_000 });
    recorder.beginPhase('preflight');
    recorder.beginPhase('preflight');
    recorder.endPhase('preflight');
    recorder.endPhase('preflight');
    // Two steps elapsed before the first close, because the second `beginPhase` was ignored.
    assert.equal(recorder.build().phase_duration_buckets.preflight, 'lte_10ms');
    // Closing a phase that never opened leaves it unmeasured, and never throws.
    const other = scriptedRecorder();
    other.endPhase('sanitization');
    assert.equal(other.build().phase_duration_buckets.sanitization, 'not_measured');
  });

  it('never times the join: it is declared non-separable, not measured at zero', () => {
    const recorder = scriptedRecorder({ stepNs: 5_000_000 });
    driveCompleteRun(recorder);
    // Even an explicit attempt to time it is refused by the recorder.
    recorder.beginPhase('join');
    recorder.endPhase('join');
    const measurement = recorder.build();
    assert.equal(measurement.phase_duration_buckets.join, 'not_separable');
    assert.equal(measurement.non_separable_phases.join, 'estabelecimentos_read');
    assert.equal(BRAZIL_RECEITA_CALIBRATION_NON_SEPARABLE_PHASES.join, 'estabelecimentos_read');
    // A non-separable phase is never required to carry a duration.
    assert.ok(!BRAZIL_RECEITA_CALIBRATION_REQUIRED_TIMED_PHASES.includes('join'));
    assert.equal(measurement.measurement_complete, true);
  });
});

// ─── Temporary storage ────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0A calibration — temporary storage', () => {
  it('derives disabled / zero / not-applicable from a run that created no workspace', () => {
    const recorder = scriptedRecorder();
    driveCompleteRun(recorder);
    const measurement = recorder.build();
    assert.equal(measurement.temporary_storage_mode, 'disabled');
    assert.equal(measurement.temporary_storage_peak_bytes, 0);
    assert.equal(
      measurement.temporary_storage_observation,
      'not_applicable_no_workspace_created',
    );
    assert.equal(measurement.temporary_workspaces_created, 0);
  });

  it('reports the zero for a real 11G run, because the 11G path creates no workspace', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const recorder = scriptedRecorder();
    const report = runJoinProbe(manifestPath, recorder);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    const measurement = recorder.build();
    // DERIVED, not asserted: nothing in the instrumented path called
    // `noteTemporaryWorkspaceCreated`, so the count is zero and the mode follows from it.
    assert.equal(measurement.temporary_workspaces_created, 0);
    assert.equal(measurement.temporary_storage_mode, 'disabled');
    assert.equal(measurement.temporary_storage_peak_bytes, 0);
    assert.equal(
      measurement.temporary_storage_observation,
      'not_applicable_no_workspace_created',
    );
  });

  it('has a truthful place to report a workspace, so the zero is measured rather than hardcoded', () => {
    const recorder = scriptedRecorder();
    driveCompleteRun(recorder);
    recorder.noteTemporaryWorkspaceCreated(3 * MEGABYTE);
    const measurement = recorder.build();
    assert.equal(measurement.temporary_storage_mode, 'observed');
    assert.equal(measurement.temporary_storage_peak_bytes, 3 * MEGABYTE);
    assert.equal(measurement.temporary_storage_observation, 'workspace_created_peak_observed');
    assert.equal(measurement.temporary_workspaces_created, 1);
  });
});

// ─── Sanitization ─────────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0A calibration — the measurement passes output sanitization', () => {
  it('passes the full-join sanitizer on a complete measurement', () => {
    const recorder = scriptedRecorder({ snapshots: [snapshot(4096, 2048, 512)] });
    driveCompleteRun(recorder);
    const result = sanitizeBrazilReceitaFullJoinReport(recorder.build());
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  });

  it('passes on an incomplete measurement, and on one whose instrumentation failed', () => {
    const empty = sanitizeBrazilReceitaFullJoinReport(scriptedRecorder().build());
    assert.equal(empty.ok, true, JSON.stringify(empty.findings));

    const broken = createBrazilReceitaCalibrationRecorder({
      clock: () => {
        throw new Error('clock unavailable');
      },
      memorySampler: () => {
        throw new Error('sampler unavailable');
      },
    });
    driveCompleteRun(broken);
    const result = sanitizeBrazilReceitaFullJoinReport(broken.build());
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  });

  it('emits no path, no file name, and no operator-environment string', () => {
    const recorder = createBrazilReceitaCalibrationRecorder(
      createBrazilReceitaCalibrationProcessDependencies(),
    );
    driveCompleteRun(recorder);
    const rendered = JSON.stringify(recorder.build());

    // A path needs a separator run; every emitted value is a bucket or a class label.
    assert.ok(!/(?:\/[A-Za-z0-9._-]+){2,}/.test(rendered), 'no POSIX path may appear');
    assert.ok(!/[A-Za-z]:[\\/]/.test(rendered), 'no Windows drive path may appear');
    assert.ok(!rendered.includes('file:'), 'no file URL may appear');
    assert.ok(!rendered.includes('.csv') && !rendered.includes('.json'), 'no file name may appear');
    assert.ok(!rendered.includes(os.tmpdir()), 'no temp directory may appear');
    assert.ok(!rendered.includes(os.homedir()), 'no home directory may appear');
    assert.ok(!rendered.includes(os.hostname()), 'no hostname may appear');
  });

  it('emits no raw memory observation and no raw timestamp', () => {
    const recorder = createBrazilReceitaCalibrationRecorder(
      createBrazilReceitaCalibrationProcessDependencies(),
    );
    driveCompleteRun(recorder);
    const measurement = recorder.build();
    const rendered = JSON.stringify(measurement);

    // Matched as JSON KEYS, so `peak_rss_bucket` — a bucket, not an observation — is not mistaken
    // for the raw `rss` field of a snapshot.
    for (const forbidden of [
      'rss',
      'heapUsed',
      'heap_used',
      'external',
      'peak_rss_bytes',
      'peak_heap_used_bytes',
      'startedAt',
      'started_at',
      'timestamp',
      'durationNs',
      'duration_ns',
      'hrtime',
      'epoch',
    ]) {
      assert.ok(
        !rendered.includes(`"${forbidden}":`),
        `the measurement must not carry a raw "${forbidden}" field`,
      );
    }
    // Nothing snapshot-shaped survives anywhere in the tree, at any nesting depth.
    assert.ok(!/"(rss|heapUsed|external)"/.test(rendered), 'no raw snapshot may appear');
    // The held-absence assertions are STATED so a reader can see that they hold.
    assert.equal(measurement.raw_memory_observations_printed, false);
    assert.equal(measurement.raw_timestamps_printed, false);
    assert.equal(measurement.exact_values_printed, false);
    assert.equal(measurement.absolute_paths_printed, false);
    assert.equal(measurement.file_names_printed, false);

    // Every numeric leaf stays far below the sanitizer's eight-digit ceiling, which is the
    // structural reason exact figures are impossible here rather than merely discouraged.
    for (const value of Object.values(measurement)) {
      if (typeof value === 'number') assert.ok(Math.abs(value) < 10 * MEGABYTE);
    }
  });

  it('would have been rejected had it emitted an exact byte figure — which is why it buckets', () => {
    // Not a test of this module's output: a test of the CONSTRAINT that shapes it. A raw peak RSS
    // is an eight-plus-digit numeric leaf, and the sanitizer fails closed on exactly that.
    const withExactFigure = sanitizeBrazilReceitaFullJoinReport({
      peak_rss: 4 * 1024 * MEGABYTE,
    });
    assert.equal(withExactFigure.ok, false);
    assert.equal(withExactFigure.findings[0]?.kind, 'oversized_numeric_value');
  });
});

// ─── Failure containment ──────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0A calibration — a broken ruler is not a broken run', () => {
  it('declares the conservative failure policy it implements', () => {
    assert.equal(
      BRAZIL_RECEITA_CALIBRATION_INSTRUMENTATION_FAILURE_POLICY,
      'instrumentation_failure_marks_measurement_incomplete_and_preserves_original_failure',
    );
    assert.equal(
      scriptedRecorder().build().instrumentation_failure_policy,
      BRAZIL_RECEITA_CALIBRATION_INSTRUMENTATION_FAILURE_POLICY,
    );
  });

  it('contains a throwing clock and a throwing sampler without propagating', () => {
    const recorder = createBrazilReceitaCalibrationRecorder({
      clock: () => {
        throw new Error('clock unavailable');
      },
      memorySampler: () => {
        throw new Error('sampler unavailable');
      },
    });
    // Not a single call below is allowed to throw at its call site.
    driveCompleteRun(recorder);
    const measurement = recorder.build();
    assert.equal(measurement.measurement_complete, false);
    assert.ok(measurement.instrumentation_failure_count > 0);
    assert.equal(measurement.memory_observations_taken, 0);
    assert.equal(measurement.total_duration_bucket, 'not_measured');
  });

  it('contains a dependency that returns the wrong shape', () => {
    const recorder = createBrazilReceitaCalibrationRecorder({
      clock: () => Number.NaN as unknown as bigint,
      memorySampler: () => ({ rss: 'large' }) as unknown as BrazilReceitaCalibrationMemorySnapshot,
    });
    driveCompleteRun(recorder);
    const measurement = recorder.build();
    assert.equal(measurement.measurement_complete, false);
    assert.ok(measurement.instrumentation_failure_count > 0);
    assert.equal(measurement.peak_rss_bucket, 'not_measured');
  });

  it('never converts a failed run into a successful one', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const throwingRecorder = createBrazilReceitaCalibrationRecorder({
      clock: () => {
        throw new Error('clock unavailable');
      },
      memorySampler: () => {
        throw new Error('sampler unavailable');
      },
    });
    // A run the 11G gate REFUSES: the 11G authorization is withheld.
    const refused = runJoinProbe(manifestPath, throwingRecorder, {
      requiredFamilyJoinProbeAuthorized: false,
    } as Partial<BrazilReceitaFullJoinDryRunInput>);
    assert.equal(refused.ok, false);
    assert.ok(refused.errors.length > 0);
    assert.equal(throwingRecorder.build().measurement_complete, false);
  });

  it('never converts a successful run into a failed one', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const throwingRecorder = createBrazilReceitaCalibrationRecorder({
      clock: () => {
        throw new Error('clock unavailable');
      },
      memorySampler: () => {
        throw new Error('sampler unavailable');
      },
    });
    const report = runJoinProbe(manifestPath, throwingRecorder);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(throwingRecorder.build().measurement_complete, false);
  });
});

// ─── Behaviour preservation ───────────────────────────────────────────────────

describe('BR-SOURCE-14B.0A calibration — the observed run is unchanged', () => {
  it('produces a byte-identical report with and without a recorder', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const legacy = runJoinProbe(manifestPath);
    const instrumented = runJoinProbe(manifestPath, scriptedRecorder());
    // The legacy report contract is preserved field for field, not merely "compatible".
    assert.deepEqual(instrumented, legacy);
    assert.deepEqual(Object.keys(instrumented), Object.keys(legacy));
  });

  it('opens no additional file and reads no additional row', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const legacy = runJoinProbe(manifestPath).required_family_join_probe;
    const instrumented = runJoinProbe(manifestPath, scriptedRecorder()).required_family_join_probe;
    assert.ok(legacy !== null && instrumented !== null);
    assert.equal(instrumented.files_opened_count, legacy.files_opened_count);
    assert.equal(instrumented.files_opened_count, AUTHORIZED_CAPS.maxFilesOpened);
    assert.deepEqual(instrumented.files_opened_by_family, legacy.files_opened_by_family);
    assert.deepEqual(instrumented.rows_read_bucket, legacy.rows_read_bucket);
    assert.deepEqual(instrumented.bytes_read_bucket, legacy.bytes_read_bucket);
  });

  it('changes no cap', () => {
    // The 11G ceilings are the ones the owner authorized for the calibration: 40 / 40 / 0 / 0,
    // and the last two are EQUALITIES rather than ceilings.
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_INPUT_ROWS, 40);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_KEY_VALUES_IN_MEMORY, 40);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOIN_PAIRS_EMITTED, 0);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_JOINED_ROWS_PRINTED, 0);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_FILES_OPENED, 2);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_ROWS_PER_FILE, 20);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_ROWS, 40);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_BYTES_PER_FILE, 64_000);
    assert.equal(BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_MAX_TOTAL_BYTES, 128_000);
  });

  it('changes no join outcome', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const legacy = runJoinProbe(manifestPath).required_family_join_probe;
    const instrumented = runJoinProbe(manifestPath, scriptedRecorder()).required_family_join_probe;
    assert.ok(legacy !== null && instrumented !== null);
    assert.deepEqual(instrumented.join_probe, legacy.join_probe);
    assert.equal(instrumented.joins_executed, legacy.joins_executed);
    assert.equal(instrumented.join_coverage_computed, false);
    assert.equal(instrumented.join_probe.join_key_values_printed, false);
  });

  it('changes no abort code on any refusal path', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const refusals: ReadonlyArray<Partial<BrazilReceitaFullJoinDryRunInput>> = [
      { requiredFamilyJoinProbeAuthorized: false },
      { realLocalJoinDryRunAuthorized: false },
      { requiredFamilyProbeAuthorized: false },
      { requiredFamilyJoinProbeReader: undefined },
    ];
    for (const overrides of refusals) {
      const legacy = runJoinProbe(manifestPath, undefined, overrides);
      const instrumented = runJoinProbe(manifestPath, scriptedRecorder(), overrides);
      assert.equal(legacy.ok, false);
      assert.equal(instrumented.ok, legacy.ok);
      assert.deepEqual(
        instrumented.errors.map((error) => [error.error_code, error.stage]),
        legacy.errors.map((error) => [error.error_code, error.stage]),
      );
    }
  });

  it('leaves the measurement incomplete when the run it observed refused', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const recorder = scriptedRecorder();
    const report = runJoinProbe(manifestPath, recorder, {
      requiredFamilyJoinProbeAuthorized: false,
    } as Partial<BrazilReceitaFullJoinDryRunInput>);
    assert.equal(report.ok, false);
    const measurement = recorder.build();
    // A refused run reached neither the reads nor the sanitizer, so it cannot claim a complete
    // calibration — and it reports that instead of presenting partial phases as a whole run.
    assert.equal(measurement.measurement_complete, false);
    assert.equal(measurement.phase_duration_buckets.empresas_read, 'not_measured');
    assert.equal(measurement.phase_duration_buckets.total, 'not_measured');
  });
});

// ─── End-to-end measurement ───────────────────────────────────────────────────

describe('BR-SOURCE-14B.0A calibration — an instrumented 11G run', () => {
  it('measures every required phase and observes every sample point, in real order', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const recorder = scriptedRecorder();
    const report = runJoinProbe(manifestPath, recorder);
    assert.equal(report.ok, true, JSON.stringify(report.errors));

    const measurement = recorder.build();
    assert.equal(measurement.measurement_complete, true);
    assert.equal(measurement.instrumentation_failure_count, 0);
    assert.equal(measurement.measurement_version, BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION);

    for (const phase of BRAZIL_RECEITA_CALIBRATION_REQUIRED_TIMED_PHASES) {
      assert.notEqual(
        measurement.phase_duration_buckets[phase],
        'not_measured',
        `phase ${phase} must be timed by an instrumented 11G run`,
      );
    }
    assert.equal(measurement.phase_duration_buckets.join, 'not_separable');

    // The REAL order: cleanup is planned into the candidate report, and the assembled report is
    // then sanitized. The instrumentation reports what it saw rather than reordering the run.
    assert.deepEqual(measurement.sample_points_observed, [
      'before_preflight',
      'after_manifest_validation',
      'after_empresas_read',
      'after_estabelecimentos_read',
      'after_join',
      'after_cleanup',
      'after_sanitization',
    ]);
    for (const point of BRAZIL_RECEITA_CALIBRATION_SAMPLE_POINTS) {
      assert.ok(measurement.sample_points_observed.includes(point));
    }
    assert.equal(measurement.memory_observations_taken, BRAZIL_RECEITA_CALIBRATION_SAMPLE_POINTS.length);
  });

  it('is deterministic across repeated runs with identical injected dependencies', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const first = scriptedRecorder({ stepNs: 250_000, snapshots: [snapshot(80, 40, 4)] });
    const second = scriptedRecorder({ stepNs: 250_000, snapshots: [snapshot(80, 40, 4)] });
    runJoinProbe(manifestPath, first);
    runJoinProbe(manifestPath, second);
    assert.deepEqual(second.build(), first.build());
  });

  it('measures a real run through the real process dependencies', () => {
    const { manifestPath } = createCalibrationWorkspace();
    const recorder = createBrazilReceitaCalibrationRecorder(
      createBrazilReceitaCalibrationProcessDependencies(),
    );
    const report = runJoinProbe(manifestPath, recorder);
    assert.equal(report.ok, true, JSON.stringify(report.errors));

    const measurement = recorder.build();
    assert.equal(measurement.measurement_complete, true);
    // A real process reports a real resident set: the point is that a bucket EXISTS, never which.
    assert.notEqual(measurement.peak_rss_bucket, 'not_measured');
    assert.notEqual(measurement.peak_heap_used_bucket, 'not_measured');
    assert.ok(BRAZIL_RECEITA_CALIBRATION_MEMORY_BUCKETS.includes(measurement.peak_rss_bucket));
    assert.ok(
      BRAZIL_RECEITA_CALIBRATION_DURATION_BUCKETS.includes(measurement.total_duration_bucket),
    );
    assert.equal(sanitizeBrazilReceitaFullJoinReport(measurement).ok, true);
  });

  it('declares a closed, single-owner phase set', () => {
    assert.deepEqual(BRAZIL_RECEITA_CALIBRATION_PHASES, [
      'preflight',
      'manifest_validation',
      'empresas_read',
      'estabelecimentos_read',
      'join',
      'cleanup',
      'sanitization',
      'total',
    ]);
    const recorder = scriptedRecorder();
    driveCompleteRun(recorder);
    assert.deepEqual(
      Object.keys(recorder.build().phase_duration_buckets).sort(),
      [...BRAZIL_RECEITA_CALIBRATION_PHASES].sort(),
    );
  });
});

// ─── CLI ──────────────────────────────────────────────────────────────────────

const JOIN_PROBE_CLI_ARGS: readonly string[] = [
  '--required-family-join-probe',
  '--required-family-join-probe-authorized',
  '--real-local-join-dry-run-authorized',
  '--required-family-probe-authorized',
  '--real-manifest-metadata-only',
  '--real-manifest-metadata-execution-authorized',
  '--allow-local-manifest',
  '--strict',
  '--manifest',
  'synthetic-manifest.json',
  '--max-manifest-bytes',
  String(AUTHORIZED_CAPS.maxManifestBytes),
  '--max-declared-files',
  String(AUTHORIZED_CAPS.maxDeclaredFiles),
  '--max-files-opened',
  String(AUTHORIZED_CAPS.maxFilesOpened),
  '--max-bytes-per-file',
  String(AUTHORIZED_CAPS.maxBytesPerFile),
  '--max-rows-per-file',
  String(AUTHORIZED_CAPS.maxRowsPerFile),
  '--max-total-rows',
  String(AUTHORIZED_CAPS.maxTotalRows),
  '--max-total-bytes',
  String(AUTHORIZED_CAPS.maxTotalBytes),
  '--max-join-input-rows',
  String(AUTHORIZED_CAPS.maxJoinInputRows),
  '--max-join-key-values-in-memory',
  String(AUTHORIZED_CAPS.maxJoinKeyValuesInMemory),
  '--max-join-pairs-emitted',
  String(AUTHORIZED_CAPS.maxJoinPairsEmitted),
  '--max-joined-rows-printed',
  String(AUTHORIZED_CAPS.maxJoinedRowsPrinted),
];

describe('BR-SOURCE-14B.0A calibration — CLI surface', () => {
  it('accepts the measurement flag on a 11G join-probe invocation', () => {
    const options = parseFullJoinRunnerArgs([
      ...JOIN_PROBE_CLI_ARGS,
      '--calibration-instrumentation',
    ]);
    assert.equal(options.calibrationInstrumentation, true);
    assert.equal(options.requiredFamilyJoinProbe, true);
  });

  it('defaults the measurement OFF, so the legacy invocation is unchanged', () => {
    assert.equal(parseFullJoinRunnerArgs([...JOIN_PROBE_CLI_ARGS]).calibrationInstrumentation, false);
    // Also off in the ordinary synthetic-fixture mode, which is the only other invocation that
    // parses without a carve-out declaration.
    assert.equal(
      parseFullJoinRunnerArgs(['--synthetic-fixture']).calibrationInstrumentation,
      false,
    );
  });

  it('refuses the measurement flag outside the 11G join-probe mode', () => {
    // Fail-closed: a measurement whose phase contract does not describe the run is worse than no
    // measurement, because `not_measured` phases read as a broken probe rather than a misused flag.
    assert.throws(
      () => parseFullJoinRunnerArgs(['--calibration-instrumentation']),
      ForbiddenFullJoinRunnerModeError,
    );
    assert.throws(
      () =>
        parseFullJoinRunnerArgs([
          '--required-family-probe',
          '--required-family-probe-authorized',
          '--calibration-instrumentation',
        ]),
      ForbiddenFullJoinRunnerModeError,
    );
  });

  it('grants nothing: the flag carries no authorization and no cap', () => {
    const options = parseFullJoinRunnerArgs([
      ...JOIN_PROBE_CLI_ARGS,
      '--calibration-instrumentation',
    ]);
    const withoutFlag = parseFullJoinRunnerArgs([...JOIN_PROBE_CLI_ARGS]);
    // Every other parsed field is identical: the flag moves no cap and no declaration.
    assert.deepEqual(
      { ...options, calibrationInstrumentation: false },
      { ...withoutFlag },
    );
  });
});

// ─── CLI synthetic smoke ──────────────────────────────────────────────────────

interface CapturedRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | undefined;
}

/**
 * Drives the real CLI entry point against a SYNTHETIC workspace and captures everything it wrote.
 * `process.exitCode` and both streams are restored on every path, so one smoke test can never
 * leak an exit code into the rest of the suite.
 */
async function runCli(argv: readonly string[]): Promise<CapturedRun> {
  const chunks: string[] = [];
  const errors: string[] = [];
  const realStdout = process.stdout.write.bind(process.stdout);
  const realStderr = process.stderr.write.bind(process.stderr);
  const realExitCode = process.exitCode;
  process.exitCode = undefined;
  process.stdout.write = ((text: string) => {
    chunks.push(String(text));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((text: string) => {
    errors.push(String(text));
    return true;
  }) as typeof process.stderr.write;
  try {
    await main([...argv]);
    return { stdout: chunks.join(''), stderr: errors.join(''), exitCode: process.exitCode };
  } finally {
    process.stdout.write = realStdout;
    process.stderr.write = realStderr;
    process.exitCode = realExitCode;
  }
}

/** The 11G CLI arguments, rewritten to point at a freshly created synthetic manifest. */
function cliArgsForWorkspace(manifestPath: string, extra: readonly string[] = []): string[] {
  const args = [...JOIN_PROBE_CLI_ARGS];
  args[args.indexOf('--manifest') + 1] = manifestPath;
  return [...args, ...extra];
}

describe('BR-SOURCE-14B.0A calibration — CLI synthetic smoke', () => {
  it('emits a sanitized measurement block alongside the JSON report', async () => {
    const { manifestPath } = createCalibrationWorkspace();
    const run = await runCli(cliArgsForWorkspace(manifestPath, [
      '--format',
      'json',
      '--calibration-instrumentation',
    ]));
    assert.equal(run.stderr, '', run.stderr);
    assert.equal(run.exitCode, undefined);

    const parsed = JSON.parse(run.stdout) as {
      report: { ok: boolean };
      calibration_measurement: Record<string, unknown>;
    };
    assert.equal(parsed.report.ok, true);
    assert.equal(parsed.calibration_measurement.measurement_complete, true);
    assert.equal(
      parsed.calibration_measurement.measurement_version,
      BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION,
    );
    assert.equal(parsed.calibration_measurement.temporary_storage_mode, 'disabled');
    assert.equal(parsed.calibration_measurement.temporary_storage_peak_bytes, 0);
    assert.equal(
      (parsed.calibration_measurement.phase_duration_buckets as Record<string, string>).join,
      'not_separable',
    );
    assert.equal(sanitizeBrazilReceitaFullJoinReport(parsed.calibration_measurement).ok, true);
    // The manifest path the caller passed in never comes back out.
    assert.ok(!run.stdout.includes(manifestPath));
  });

  it('emits the measurement as an appended text section', async () => {
    const { manifestPath } = createCalibrationWorkspace();
    const run = await runCli(cliArgsForWorkspace(manifestPath, ['--calibration-instrumentation']));
    assert.equal(run.stderr, '', run.stderr);
    assert.ok(run.stdout.includes('calibration_measurement:'));
    assert.ok(run.stdout.includes('measurement_complete: true'));
    assert.ok(run.stdout.includes('non_separable_phase: join -> estabelecimentos_read'));
    assert.ok(run.stdout.includes('temporary_storage_observation: not_applicable_no_workspace_created'));
    assert.ok(!run.stdout.includes(manifestPath));
  });

  it('reproduces the pre-14B.0A output exactly when the flag is absent', async () => {
    const first = createCalibrationWorkspace();
    const legacy = await runCli(cliArgsForWorkspace(first.manifestPath, ['--format', 'json']));
    const second = createCalibrationWorkspace();
    const instrumented = await runCli(
      cliArgsForWorkspace(second.manifestPath, [
        '--format',
        'json',
        '--calibration-instrumentation',
      ]),
    );

    assert.equal(legacy.stderr, '', legacy.stderr);
    // Without the flag there is no envelope at all: the report IS the document, exactly as every
    // earlier hito published it.
    const legacyDocument = JSON.parse(legacy.stdout) as Record<string, unknown>;
    assert.equal(legacyDocument.calibration_measurement, undefined);
    assert.equal(legacyDocument.ok, true);

    // With the flag, the report sits UNDER `report` and is byte-identical to the legacy document.
    const wrapped = JSON.parse(instrumented.stdout) as { report: Record<string, unknown> };
    assert.deepEqual(wrapped.report, legacyDocument);
  });

  it('refuses the flag outside the 11G mode, and says so on stderr with a non-zero exit', async () => {
    const run = await runCli(['--synthetic-fixture', '--calibration-instrumentation']);
    assert.equal(run.exitCode, 1);
    assert.ok(run.stderr.includes('--calibration-instrumentation is only valid together with'));
    assert.equal(run.stdout, '');
  });
});

// ─── Static guards ───────────────────────────────────────────────────────────

const require_ = createRequire(import.meta.url);

function moduleSource(specifier: string): string {
  return fs.readFileSync(require_.resolve(specifier), 'utf8');
}

/** Code only, comments stripped: these guards are about what the module DOES. */
function instrumentationCode(): string {
  return moduleSource('../br-receita-cnpj-calibration-instrumentation')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('BR-SOURCE-14B.0A calibration — static guards', () => {
  it('performs no I/O of any kind', () => {
    const source = instrumentationCode();
    for (const forbidden of [
      'node:fs',
      'fs.',
      'openSync',
      'readSync',
      'readFileSync',
      'writeFile',
      'statSync',
      'readdirSync',
      'existsSync',
      'mkdir',
      'unlink',
      'rmSync',
      'createWriteStream',
      'fetch(',
    ]) {
      assert.ok(!source.includes(forbidden), `the instrument must not use "${forbidden}"`);
    }
  });

  it('imports no Supabase, Agent 1, provider, HubSpot or Slack module, and reads no env', () => {
    const source = instrumentationCode().toLowerCase();
    for (const forbidden of [
      'supabase',
      'createclient',
      'agent1',
      'apollo',
      'lusha',
      'tavily',
      'hubspot',
      'slack',
      'process.env',
    ]) {
      assert.ok(!source.includes(forbidden), `the instrument must not reference "${forbidden}"`);
    }
  });

  it('touches process only through the monotonic clock and the memory sampler', () => {
    const source = instrumentationCode();
    const references = source.match(/process\.[a-zA-Z.]+/g) ?? [];
    assert.deepEqual(
      [...new Set(references)].sort(),
      ['process.hrtime.bigint', 'process.memoryUsage'],
      'the only permitted process surface is the monotonic clock and the memory sampler',
    );
  });

  it('never mixes a wall clock into a duration', () => {
    const source = instrumentationCode();
    // `Date.now` is a WALL clock: an NTP step or a suspend can make an interval negative, so it
    // is never used for a duration. `process.hrtime.bigint()` is the only clock here.
    assert.ok(!source.includes('Date.now'), 'a duration must never come from a wall clock');
    assert.ok(!source.includes('new Date'), 'a duration must never come from a wall clock');
    assert.ok(source.includes('process.hrtime.bigint'));
  });

  it('starts no timer, interval, or async task that could outlive the run', () => {
    const source = instrumentationCode();
    for (const forbidden of [
      'setInterval',
      'setTimeout',
      'setImmediate',
      'queueMicrotask',
      'PerformanceObserver',
      'async ',
      'await ',
    ]) {
      assert.ok(!source.includes(forbidden), `the instrument must not use "${forbidden}"`);
    }
  });

  it('emits through a return value only: no log, no stdout, no stderr', () => {
    const source = instrumentationCode();
    for (const forbidden of [
      'console.log',
      'console.error',
      'console.warn',
      'process.stdout',
      'process.stderr',
    ]) {
      assert.ok(!source.includes(forbidden), `the instrument must not emit via "${forbidden}"`);
    }
  });

  it('computes no hash and constructs no identity', () => {
    const source = instrumentationCode();
    for (const forbidden of [
      'createHash',
      'sha256',
      'digest',
      'fingerprint',
      'normalizedTaxId',
      'recordIdentityKey',
    ]) {
      assert.ok(!source.includes(forbidden), `the instrument must not reference "${forbidden}"`);
    }
  });

  it('embeds no operator path and no real dataset location, in code OR in prose', () => {
    const raw = moduleSource('../br-receita-cnpj-calibration-instrumentation');
    for (const forbidden of [
      '/Users/',
      'Downloads',
      'sellup-source-data',
      'dados_abertos',
      'manifest.headerless.json',
      'manifest.real.json',
    ]) {
      assert.ok(!raw.includes(forbidden), `the instrument must not embed "${forbidden}"`);
    }
  });

  it('leaves the join probe with exactly two bounded readers after instrumentation', () => {
    // The 11G file surface is the invariant this milestone most had to avoid disturbing: two
    // `openSync` sites (the manifest control document and one data file) and two `readSync`.
    const source = moduleSource('../br-receita-cnpj-required-family-join-probe')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.equal(source.split('fs.openSync(').length - 1, 2);
    assert.equal(source.split('fs.readSync(').length - 1, 2);
  });

  it('reaches the probe as an optional observer, never as a required dependency', () => {
    const source = moduleSource('../br-receita-cnpj-required-family-join-probe');
    // Optional in the contract, and every call site is an optional call: an absent recorder can
    // never change a code path, which is why a legacy run is byte-identical.
    assert.ok(source.includes('readonly calibrationRecorder?: BrazilReceitaCalibrationRecorder'));
    for (const call of source.match(/recorder[?.]*\.(beginPhase|endPhase|sample)\(/g) ?? []) {
      assert.ok(call.startsWith('recorder?.'), `every recorder call must be optional, got ${call}`);
    }
  });

  it('is excluded from the no-write guard config, like every other injected port', () => {
    const source = moduleSource('../br-receita-cnpj-full-join-dry-run-runner');
    assert.ok(source.includes("key === 'calibrationRecorder'"));
  });
});
