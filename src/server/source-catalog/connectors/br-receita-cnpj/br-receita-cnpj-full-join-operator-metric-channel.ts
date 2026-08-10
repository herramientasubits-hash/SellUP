/**
 * BR Receita CNPJ — FULL-JOIN OPERATOR METRIC CHANNEL (BR-SOURCE-14B.0C § 6).
 *
 * Two channels for one run's resource figures, with deliberately different rules.
 *
 *   PUBLIC  (`publicSanitizedMeasurements`)  — buckets and small counts. Versionable, printable,
 *                                             reviewable, and passed through the full-join output
 *                                             sanitizer unchanged.
 *   PRIVATE (`privateOperatorMeasurements`)  — exact figures. Operator-only, off-repo, owner-only
 *                                             on disk, TTL'd, and disabled unless explicitly
 *                                             declared.
 *
 * ── Why not simply relax the sanitizer ──────────────────────────────────────────
 * GATE-2 needs exact figures, and the public sanitizer rejects any numeric leaf at or beyond eight
 * digits as `oversized_numeric_value`. A peak RSS in bytes is nine to ten digits, so the tempting
 * fix is an exemption. That fix would be a disaster, and this module exists precisely to avoid it:
 *
 *   - `oversized_numeric_value` is not a nuisance rule. It is the check that stops a 14-digit CNPJ
 *     from reaching a report as a number. Relaxing the digit ceiling to admit a byte count admits
 *     an identifier at the same time.
 *   - A field-NAME exemption (`allow anything ending in Bytes`) is worse still: it makes the
 *     sanitizer's verdict depend on a string a future author chooses, so `cnpjBytes` would pass.
 *     Naming is not a security boundary.
 *
 * So the sanitizer is untouched, no exemption is added, and exact values travel a SEPARATE, typed,
 * explicitly-constructed data path that never enters the public report object at all. The two
 * channels are built by two functions from the same source observations, and the public one is
 * structurally incapable of carrying an exact figure — it has no numeric field wider than a small
 * count.
 *
 * ── The private channel's obligations ───────────────────────────────────────────
 * Disabled by default; explicit operator declaration; never stdout; never inside a git repository
 * or the operator's home; owner-only permissions; atomic write; a TTL; deletable and verifiably
 * deleted. If any obligation cannot be met, the channel refuses and reports
 * `PRIVATE_EXACT_METRIC_CHANNEL_READY = false` rather than writing a weaker artifact.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - reads an environment variable, a hostname or a username. Every boundary it needs — the
 *     repository root, the home directory, the dataset root — is an explicit PARAMETER, so the
 *     module cannot learn a path it was not handed.
 *   - writes to stdout or stderr. It has no `console` reference.
 *   - persists a row, a cell, a CNPJ, a join key, a company name, a file name, an absolute path
 *     or an identifier hash. It records PROCESS metrics only, and a runtime validator re-checks
 *     that claim on the way out.
 *   - reads or writes a dataset file, a manifest, Supabase, the runtime or Agent 1.
 */

import * as path from 'node:path';

import {
  BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION,
  toBrazilReceitaCalibrationDurationBucket,
  toBrazilReceitaCalibrationMemoryBucket,
  type BrazilReceitaCalibrationDurationBucket,
  type BrazilReceitaCalibrationMemoryBucket,
} from './br-receita-cnpj-calibration-instrumentation';
import {
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_PHASES,
  type BrazilReceitaFullJoinResourceCleanupOutcome,
  type BrazilReceitaFullJoinResourceExactObservations,
  type BrazilReceitaFullJoinResourcePhase,
} from './br-receita-cnpj-full-join-resource-envelope';

// ─── Version & declaration ────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_METRIC_CHANNEL_VERSION = 1 as const;

/**
 * The exact acknowledgement an operator must supply to enable the private channel.
 *
 * A boolean flag would be too easy to set by accident, and too easy for a future caller to default
 * to `true`. A literal sentence cannot be arrived at by accident.
 */
export const BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT =
  'BR_SOURCE_14B0C_PRIVATE_OPERATOR_METRICS_ACKNOWLEDGED' as const;

/** The private channel is OFF unless a declaration says otherwise. Stated as data. */
export const BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_DEFAULT_ENABLED = false as const;

/** Hard ceiling on the artifact's lifetime. A TTL an operator forgets must still expire. */
export const BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_MAX_TTL_MS = 86_400_000 as const;

/** A conservative default lifetime: long enough to read a figure, short enough to forget. */
export const BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_DEFAULT_TTL_MS = 3_600_000 as const;

/** Owner read/write only. No group, no other. Verified after creation, not assumed. */
export const BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_MODE = 0o600 as const;

/** The artifact's fixed extension. A caller supplies only a validated slug, never a path. */
export const BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_EXTENSION = '.json' as const;

/** A caller-supplied artifact slug must match this exactly: no separators, no dots, no spaces. */
export const BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ─── Public channel ───────────────────────────────────────────────────────────

/** Buckets for the small, bounded counts that may ship publicly. */
export type BrazilReceitaFullJoinCountBucket =
  | 'zero'
  | 'lte_10'
  | 'lte_100'
  | 'lte_1k'
  | 'lte_10k'
  | 'lte_1m'
  | 'gt_1m'
  | 'not_measured';

export const BRAZIL_RECEITA_FULL_JOIN_COUNT_BUCKETS: readonly BrazilReceitaFullJoinCountBucket[] = [
  'zero',
  'lte_10',
  'lte_100',
  'lte_1k',
  'lte_10k',
  'lte_1m',
  'gt_1m',
  'not_measured',
];

const COUNT_BUCKET_CEILINGS: ReadonlyArray<
  readonly [ceiling: number, bucket: BrazilReceitaFullJoinCountBucket]
> = [
  [0, 'zero'],
  [10, 'lte_10'],
  [100, 'lte_100'],
  [1_000, 'lte_1k'],
  [10_000, 'lte_10k'],
  [1_000_000, 'lte_1m'],
];

export function toBrazilReceitaFullJoinCountBucket(
  count: number | null,
): BrazilReceitaFullJoinCountBucket {
  if (count === null || !Number.isFinite(count) || count < 0) return 'not_measured';
  for (const [ceiling, bucket] of COUNT_BUCKET_CEILINGS) {
    if (count <= ceiling) return bucket;
  }
  return 'gt_1m';
}

/**
 * The PUBLIC measurement. Every magnitude is a bucket; the only bare numbers are the two version
 * integers and a bounded checkpoint count.
 *
 * There is no field here that can hold an exact byte figure, so this object cannot trip
 * `oversized_numeric_value` and cannot be made to carry an identifier by a later edit that forgets
 * why the buckets are here.
 */
export interface BrazilReceitaFullJoinPublicSanitizedMeasurements {
  readonly channel_version: typeof BRAZIL_RECEITA_FULL_JOIN_METRIC_CHANNEL_VERSION;
  readonly envelope_version: typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION;
  readonly measurement_version: typeof BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION;
  readonly peak_rss_bucket: BrazilReceitaCalibrationMemoryBucket;
  readonly peak_heap_used_bucket: BrazilReceitaCalibrationMemoryBucket;
  readonly peak_external_memory_bucket: BrazilReceitaCalibrationMemoryBucket;
  readonly temporary_storage_peak_bucket: BrazilReceitaCalibrationMemoryBucket;
  readonly total_duration_bucket: BrazilReceitaCalibrationDurationBucket;
  readonly phase_duration_buckets: Readonly<
    Record<BrazilReceitaFullJoinResourcePhase, BrazilReceitaCalibrationDurationBucket>
  >;
  readonly bytes_read_bucket: BrazilReceitaFullJoinCountBucket;
  readonly rows_read_bucket: BrazilReceitaFullJoinCountBucket;
  readonly files_opened_bucket: BrazilReceitaFullJoinCountBucket;
  readonly output_rows_bucket: BrazilReceitaFullJoinCountBucket;
  /**
   * The peak SIZE of the bounded in-memory key window — a count, never a key.
   *
   * Named `in_memory_key_window_peak_bucket` rather than anything containing "join key" because the
   * output sanitizer refuses any key whose NAME is join-key-shaped, and it is right to: a reviewer
   * scanning a report cannot tell a count called `join_keys_*` from a payload called `join_keys_*`,
   * so the rule refuses the whole shape. The bucket below carries a window SIZE and nothing else.
   */
  readonly in_memory_key_window_peak_bucket: BrazilReceitaFullJoinCountBucket;
  readonly checkpoints_evaluated_count: number;
  readonly cleanup_outcome: BrazilReceitaFullJoinResourceCleanupOutcome | 'not_recorded';
  readonly exact_values_printed: false;
  readonly absolute_paths_printed: false;
  readonly file_names_printed: false;
  readonly raw_memory_observations_printed: false;
}

const MILLISECONDS_TO_NANOSECONDS = BigInt(1_000_000);

function msToDurationBucket(ms: number | null): BrazilReceitaCalibrationDurationBucket {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'not_measured';
  return toBrazilReceitaCalibrationDurationBucket(BigInt(Math.round(ms)) * MILLISECONDS_TO_NANOSECONDS);
}

/**
 * Projects exact observations into the public, bucketed measurement.
 *
 * One-way by construction: it reads exact figures and returns buckets, and there is no inverse.
 */
export function toBrazilReceitaFullJoinPublicSanitizedMeasurements(
  observations: BrazilReceitaFullJoinResourceExactObservations,
): BrazilReceitaFullJoinPublicSanitizedMeasurements {
  const phaseDurationBuckets = {} as Record<
    BrazilReceitaFullJoinResourcePhase,
    BrazilReceitaCalibrationDurationBucket
  >;
  for (const phase of BRAZIL_RECEITA_FULL_JOIN_RESOURCE_PHASES) {
    phaseDurationBuckets[phase] = msToDurationBucket(observations.phaseDurationsMs[phase]);
  }

  return {
    channel_version: BRAZIL_RECEITA_FULL_JOIN_METRIC_CHANNEL_VERSION,
    envelope_version: BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION,
    measurement_version: BRAZIL_RECEITA_CALIBRATION_MEASUREMENT_VERSION,
    peak_rss_bucket: toBrazilReceitaCalibrationMemoryBucket(observations.peakRssBytes),
    peak_heap_used_bucket: toBrazilReceitaCalibrationMemoryBucket(observations.peakHeapUsedBytes),
    peak_external_memory_bucket: toBrazilReceitaCalibrationMemoryBucket(
      observations.peakExternalMemoryBytes,
    ),
    temporary_storage_peak_bucket: toBrazilReceitaCalibrationMemoryBucket(
      observations.temporaryStoragePeakBytes,
    ),
    total_duration_bucket: msToDurationBucket(observations.totalDurationMs),
    phase_duration_buckets: phaseDurationBuckets,
    bytes_read_bucket: toBrazilReceitaFullJoinCountBucket(observations.bytesRead),
    rows_read_bucket: toBrazilReceitaFullJoinCountBucket(observations.rowsRead),
    files_opened_bucket: toBrazilReceitaFullJoinCountBucket(observations.filesOpened),
    output_rows_bucket: toBrazilReceitaFullJoinCountBucket(observations.outputRowsMaterialized),
    in_memory_key_window_peak_bucket: toBrazilReceitaFullJoinCountBucket(
      observations.joinKeysPeakInMemory,
    ),
    checkpoints_evaluated_count: observations.checkpointsEvaluated.length,
    cleanup_outcome: observations.cleanupOutcome ?? 'not_recorded',
    exact_values_printed: false,
    absolute_paths_printed: false,
    file_names_printed: false,
    raw_memory_observations_printed: false,
  };
}

// ─── Private channel ──────────────────────────────────────────────────────────

/**
 * The PRIVATE measurement. Exact figures, and ONLY the eleven the milestone authorizes.
 *
 * Every field is a number, a `null`, or a value from a closed enum. There is deliberately no
 * free-form string field: a string is how a path, a file name or a row sample would arrive, and the
 * cheapest way to guarantee none arrives is to have nowhere to put one.
 */
export interface BrazilReceitaFullJoinPrivateOperatorMeasurements {
  readonly channel_version: typeof BRAZIL_RECEITA_FULL_JOIN_METRIC_CHANNEL_VERSION;
  readonly envelope_version: typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION;
  readonly peakRssBytes: number | null;
  readonly peakHeapUsedBytes: number | null;
  readonly peakExternalMemoryBytes: number | null;
  readonly totalDurationMs: number | null;
  readonly phaseDurationsMs: Readonly<Record<BrazilReceitaFullJoinResourcePhase, number | null>>;
  readonly bytesRead: number;
  readonly rowsRead: number;
  readonly filesOpened: number;
  readonly temporaryStoragePeakBytes: number;
  readonly joinKeysPeakInMemory: number;
  readonly outputRowsMaterialized: number;
  /**
   * The four figures BR-SOURCE-14B.0F § 9 adds, all of them counts of the run's own machinery.
   *
   * `filesOpenedPeak` is the one that could not be derived from anything that existed before: the
   * enforcer's `filesOpened` is CUMULATIVE and never falls, so it cannot answer "how many descriptors
   * were held at once" — which is precisely the question the 4096-handle finding raised.
   */
  readonly partitionsCreated: number;
  readonly largestPartitionReferenceCount: number;
  readonly filesOpenedPeak: number;
  readonly partitionHandlePeakOpen: number;
  readonly cleanupResult: BrazilReceitaFullJoinResourceCleanupOutcome | 'not_recorded';
  readonly sanitizerResult: BrazilReceitaFullJoinPrivateSanitizerResult;
}

/**
 * The engine-side counts the private channel carries alongside the resource observations.
 *
 * A separate parameter rather than a wider `BrazilReceitaFullJoinResourceExactObservations`, because
 * the 14B.0C enforcer measures the PROCESS and knows nothing about partitions. Widening its type to
 * carry a partition count would put engine vocabulary inside the resource envelope, and the envelope
 * is deliberately the one module in this family that has no idea what a join is.
 */
export interface BrazilReceitaFullJoinPrivateEngineCounts {
  readonly partitionsCreated: number;
  readonly largestPartitionReferenceCount: number;
  readonly filesOpenedPeak: number;
  readonly partitionHandlePeakOpen: number;
}

/** The public report's sanitizer verdict, carried so an operator can correlate the two channels. */
export type BrazilReceitaFullJoinPrivateSanitizerResult =
  | 'passed'
  | 'failed'
  | 'not_run';

/**
 * The engine counts a run that never reached the engine reports.
 *
 * Zeros rather than absent fields, for the reason the empty resource observations exist: a refusal
 * must report the same SHAPE as a completed run, or a consumer has to special-case it — and
 * special-casing is where a refusal starts reading as a success.
 */
export function emptyBrazilReceitaFullJoinPrivateEngineCounts(): BrazilReceitaFullJoinPrivateEngineCounts {
  return {
    partitionsCreated: 0,
    largestPartitionReferenceCount: 0,
    filesOpenedPeak: 0,
    partitionHandlePeakOpen: 0,
  };
}

export function toBrazilReceitaFullJoinPrivateOperatorMeasurements(
  observations: BrazilReceitaFullJoinResourceExactObservations,
  sanitizerResult: BrazilReceitaFullJoinPrivateSanitizerResult,
  engineCounts: BrazilReceitaFullJoinPrivateEngineCounts = emptyBrazilReceitaFullJoinPrivateEngineCounts(),
): BrazilReceitaFullJoinPrivateOperatorMeasurements {
  return {
    partitionsCreated: engineCounts.partitionsCreated,
    largestPartitionReferenceCount: engineCounts.largestPartitionReferenceCount,
    filesOpenedPeak: engineCounts.filesOpenedPeak,
    partitionHandlePeakOpen: engineCounts.partitionHandlePeakOpen,
    channel_version: BRAZIL_RECEITA_FULL_JOIN_METRIC_CHANNEL_VERSION,
    envelope_version: observations.envelope_version,
    peakRssBytes: observations.peakRssBytes,
    peakHeapUsedBytes: observations.peakHeapUsedBytes,
    peakExternalMemoryBytes: observations.peakExternalMemoryBytes,
    totalDurationMs: observations.totalDurationMs,
    phaseDurationsMs: observations.phaseDurationsMs,
    bytesRead: observations.bytesRead,
    rowsRead: observations.rowsRead,
    filesOpened: observations.filesOpened,
    temporaryStoragePeakBytes: observations.temporaryStoragePeakBytes,
    joinKeysPeakInMemory: observations.joinKeysPeakInMemory,
    outputRowsMaterialized: observations.outputRowsMaterialized,
    cleanupResult: observations.cleanupOutcome ?? 'not_recorded',
    sanitizerResult,
  };
}

// ─── Private-content validation ───────────────────────────────────────────────

/** Why a private payload was refused. Never echoes the offending value. */
export type BrazilReceitaFullJoinPrivateContentViolation =
  | 'unexpected_string_value'
  | 'identifier_like_digit_run'
  | 'path_like_value'
  | 'hash_like_value'
  | 'unexpected_field'
  | 'non_finite_number';

export interface BrazilReceitaFullJoinPrivateContentFinding {
  readonly kind: BrazilReceitaFullJoinPrivateContentViolation;
  /** The dotted field path INSIDE the measurement object. Never a filesystem path. */
  readonly field: string;
}

/** Eight or more consecutive digits: a CNPJ básico, a CNPJ, or another Receita identifier. */
const IDENTIFIER_LIKE_DIGIT_RUN = /(?<!\d)\d{8,}(?!\d)/;
/** Sixteen or more hex characters: an identifier hash. */
const HASH_LIKE = /\b[0-9a-fA-F]{16,}\b/;
/** Anything that looks like a filesystem path, a URL, or a home reference. */
const PATH_LIKE = /[/\\]|^[A-Za-z]:|^~|\bfile:/;

/**
 * The closed set of string values the private payload may contain. Anything else is refused.
 *
 * An allowlist rather than a denylist: a denylist has to anticipate every shape a leak takes, and
 * an allowlist only has to enumerate what is legitimate — which here is eleven enum members.
 */
const ALLOWED_PRIVATE_STRINGS: readonly string[] = [
  // Cleanup outcomes.
  'not_needed',
  'completed',
  'failed',
  'unverified',
  'not_recorded',
  // Sanitizer verdicts.
  'passed',
  'not_run',
];

const ALLOWED_PRIVATE_TOP_LEVEL_FIELDS: readonly string[] = [
  'channel_version',
  'envelope_version',
  'peakRssBytes',
  'peakHeapUsedBytes',
  'peakExternalMemoryBytes',
  'totalDurationMs',
  'phaseDurationsMs',
  'bytesRead',
  'rowsRead',
  'filesOpened',
  'temporaryStoragePeakBytes',
  'joinKeysPeakInMemory',
  'outputRowsMaterialized',
  'partitionsCreated',
  'largestPartitionReferenceCount',
  'filesOpenedPeak',
  'partitionHandlePeakOpen',
  'cleanupResult',
  'sanitizerResult',
];

/**
 * Re-checks, at runtime, that a private payload carries only process metrics.
 *
 * The TYPE already guarantees most of this. The validator exists because a type guarantees nothing
 * about a future field, and this artifact is the one place in the milestone where exact values are
 * allowed to exist — the cost of a mistake here is a Receita identifier on an operator's disk.
 */
export function validateBrazilReceitaFullJoinPrivateContent(
  payload: BrazilReceitaFullJoinPrivateOperatorMeasurements,
): readonly BrazilReceitaFullJoinPrivateContentFinding[] {
  const findings: BrazilReceitaFullJoinPrivateContentFinding[] = [];

  function walk(value: unknown, field: string, depth: number): void {
    if (depth > 4) return;
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) findings.push({ kind: 'non_finite_number', field });
      return;
    }
    if (typeof value === 'string') {
      if (PATH_LIKE.test(value)) {
        findings.push({ kind: 'path_like_value', field });
        return;
      }
      if (IDENTIFIER_LIKE_DIGIT_RUN.test(value)) {
        findings.push({ kind: 'identifier_like_digit_run', field });
        return;
      }
      if (HASH_LIKE.test(value)) {
        findings.push({ kind: 'hash_like_value', field });
        return;
      }
      if (!ALLOWED_PRIVATE_STRINGS.includes(value)) {
        findings.push({ kind: 'unexpected_string_value', field });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${field}[${index}]`, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        walk(entry, field === '' ? key : `${field}.${key}`, depth + 1);
      }
      return;
    }
    findings.push({ kind: 'unexpected_string_value', field });
  }

  for (const key of Object.keys(payload as unknown as Record<string, unknown>)) {
    if (!ALLOWED_PRIVATE_TOP_LEVEL_FIELDS.includes(key)) {
      findings.push({ kind: 'unexpected_field', field: key });
    }
  }
  walk(payload, '', 0);
  return findings;
}

// ─── Destination safety ───────────────────────────────────────────────────────

/**
 * The boundaries the channel must be told about. All explicit: the module reads no environment
 * variable, so it cannot discover `HOME` or the repository root on its own.
 */
export interface BrazilReceitaFullJoinPrivateChannelBoundaries {
  readonly repositoryRoot: string;
  readonly homeDirectory: string;
  readonly datasetRoot: string | null;
}

export type BrazilReceitaFullJoinPrivateDestinationRejection =
  | 'destination_not_absolute'
  | 'destination_is_standard_stream'
  | 'destination_inside_repository'
  | 'destination_inside_home'
  | 'destination_inside_dataset'
  | 'destination_slug_invalid'
  | 'ttl_invalid'
  | 'acknowledgement_missing';

/** True when `candidate` is `parent` or lives beneath it. Path-only; touches no filesystem. */
function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative === '') return true;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

const STANDARD_STREAM_DESTINATIONS: readonly string[] = [
  '/dev/stdout',
  '/dev/stderr',
  '/dev/fd/1',
  '/dev/fd/2',
  '/proc/self/fd/1',
  '/proc/self/fd/2',
];

// ─── Declaration ──────────────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinPrivateChannelDeclaration {
  readonly acknowledgement: string;
  readonly destinationDirectory: string;
  /** A validated slug. The module builds the file name; a caller never supplies a path. */
  readonly artifactSlug: string;
  readonly ttlMs: number;
}

export type BrazilReceitaFullJoinPrivateChannelResolution =
  | {
      readonly ready: true;
      readonly destinationFile: string;
      readonly temporaryFile: string;
      readonly ttlMs: number;
    }
  | {
      readonly ready: false;
      readonly rejections: readonly BrazilReceitaFullJoinPrivateDestinationRejection[];
    };

/**
 * Resolves a declaration into a concrete destination, or refuses.
 *
 * Refusal is the default: an absent declaration is not an error to be worked around, it is the
 * normal state of this channel. `PRIVATE_EXACT_METRIC_CHANNEL_READY` is false until every
 * obligation below is satisfied.
 */
export function resolveBrazilReceitaFullJoinPrivateChannel(
  declaration: BrazilReceitaFullJoinPrivateChannelDeclaration | null | undefined,
  boundaries: BrazilReceitaFullJoinPrivateChannelBoundaries,
): BrazilReceitaFullJoinPrivateChannelResolution {
  const rejections: BrazilReceitaFullJoinPrivateDestinationRejection[] = [];

  if (
    declaration == null ||
    declaration.acknowledgement !== BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT
  ) {
    // Reported alone: without an acknowledgement there is nothing else worth validating.
    return { ready: false, rejections: ['acknowledgement_missing'] };
  }

  const directory = declaration.destinationDirectory;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    rejections.push('destination_not_absolute');
  } else {
    if (STANDARD_STREAM_DESTINATIONS.some((stream) => isInside(directory, stream))) {
      rejections.push('destination_is_standard_stream');
    }
    // The repository check comes before home: a worktree inside home should read as a repository
    // violation, which is the more specific and more actionable fact.
    if (isInside(directory, boundaries.repositoryRoot)) {
      rejections.push('destination_inside_repository');
    } else if (isInside(directory, boundaries.homeDirectory)) {
      // Home is refused wholesale because the operator's `$HOME` is itself a git repository in this
      // environment (BR-SOURCE-14B.0C § 10) — an artifact there is an artifact in a repository.
      rejections.push('destination_inside_home');
    }
    if (boundaries.datasetRoot !== null && isInside(directory, boundaries.datasetRoot)) {
      rejections.push('destination_inside_dataset');
    }
  }

  if (
    typeof declaration.artifactSlug !== 'string' ||
    !BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_SLUG_PATTERN.test(declaration.artifactSlug)
  ) {
    rejections.push('destination_slug_invalid');
  }

  const ttlMs = declaration.ttlMs;
  if (
    typeof ttlMs !== 'number' ||
    !Number.isInteger(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_MAX_TTL_MS
  ) {
    rejections.push('ttl_invalid');
  }

  if (rejections.length > 0) return { ready: false, rejections };

  const fileName = `${declaration.artifactSlug}${BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_EXTENSION}`;
  return {
    ready: true,
    destinationFile: path.join(directory, fileName),
    temporaryFile: path.join(directory, `${fileName}.tmp`),
    ttlMs,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * The filesystem operations the writer needs, injected so tests can drive failures without a real
 * disk — and so this module's dependency on `node:fs` is a parameter rather than an import.
 */
export interface BrazilReceitaFullJoinPrivateChannelFileSystem {
  writeFileExclusive(filePath: string, contents: string, mode: number): void;
  chmod(filePath: string, mode: number): void;
  statMode(filePath: string): number;
  rename(fromPath: string, toPath: string): void;
  exists(filePath: string): boolean;
  unlink(filePath: string): void;
}

export type BrazilReceitaFullJoinPrivateWriteFailure =
  | 'content_validation_failed'
  | 'write_failed'
  | 'permission_hardening_failed'
  | 'permission_verification_failed'
  | 'atomic_rename_failed';

export type BrazilReceitaFullJoinPrivateWriteOutcome =
  | {
      readonly written: true;
      readonly destinationFile: string;
      readonly mode: number;
      readonly expiresAtMs: number;
    }
  | {
      readonly written: false;
      readonly failure: BrazilReceitaFullJoinPrivateWriteFailure;
      readonly findings?: readonly BrazilReceitaFullJoinPrivateContentFinding[];
    };

/** The artifact envelope on disk: the payload plus its own expiry, so a reader can check it. */
interface PrivateArtifactEnvelope {
  readonly channel_version: typeof BRAZIL_RECEITA_FULL_JOIN_METRIC_CHANNEL_VERSION;
  readonly created_at_ms: number;
  readonly expires_at_ms: number;
  readonly measurements: BrazilReceitaFullJoinPrivateOperatorMeasurements;
}

/**
 * Writes the private artifact atomically, owner-only, with a TTL — or writes nothing.
 *
 * Order matters and is enforced:
 *   1. VALIDATE the payload. Nothing touches the disk until the content is known to be clean; a
 *      rejected payload leaves no partial file to clean up.
 *   2. Create the temporary file EXCLUSIVELY (`wx`) with mode 0600, so a pre-existing file or a
 *      symlink at that path is a failure rather than a target.
 *   3. `chmod` explicitly. `open` honours the process umask, so the mode passed at creation is a
 *      request, not a guarantee.
 *   4. VERIFY the mode by reading it back. An unverifiable permission is a failure: the artifact is
 *      removed rather than left behind at unknown permissions.
 *   5. `rename` into place. Rename within a directory is atomic, so a reader never observes a
 *      half-written artifact.
 *
 * Every failure path removes the temporary file. A failed write leaves no exact figures on disk.
 */
export function writeBrazilReceitaFullJoinPrivateArtifact(
  resolution: Extract<BrazilReceitaFullJoinPrivateChannelResolution, { ready: true }>,
  payload: BrazilReceitaFullJoinPrivateOperatorMeasurements,
  fileSystem: BrazilReceitaFullJoinPrivateChannelFileSystem,
  nowMs: number,
): BrazilReceitaFullJoinPrivateWriteOutcome {
  const findings = validateBrazilReceitaFullJoinPrivateContent(payload);
  if (findings.length > 0) {
    return { written: false, failure: 'content_validation_failed', findings };
  }

  const expiresAtMs = nowMs + resolution.ttlMs;
  const envelope: PrivateArtifactEnvelope = {
    channel_version: BRAZIL_RECEITA_FULL_JOIN_METRIC_CHANNEL_VERSION,
    created_at_ms: nowMs,
    expires_at_ms: expiresAtMs,
    measurements: payload,
  };
  const contents = JSON.stringify(envelope, null, 2);

  /** Best-effort removal of the temporary file. Never masks the failure being reported. */
  function discardTemporary(): void {
    try {
      if (fileSystem.exists(resolution.temporaryFile)) {
        fileSystem.unlink(resolution.temporaryFile);
      }
    } catch {
      // The reported failure is the write failure, not the cleanup of its debris. A throw here
      // would replace an accurate diagnosis with a misleading one.
    }
  }

  try {
    fileSystem.writeFileExclusive(
      resolution.temporaryFile,
      contents,
      BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_MODE,
    );
  } catch {
    discardTemporary();
    return { written: false, failure: 'write_failed' };
  }

  try {
    fileSystem.chmod(resolution.temporaryFile, BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_MODE);
  } catch {
    discardTemporary();
    return { written: false, failure: 'permission_hardening_failed' };
  }

  let mode: number;
  try {
    mode = fileSystem.statMode(resolution.temporaryFile) & 0o777;
  } catch {
    discardTemporary();
    return { written: false, failure: 'permission_verification_failed' };
  }
  if (mode !== BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_MODE) {
    discardTemporary();
    return { written: false, failure: 'permission_verification_failed' };
  }

  try {
    fileSystem.rename(resolution.temporaryFile, resolution.destinationFile);
  } catch {
    discardTemporary();
    return { written: false, failure: 'atomic_rename_failed' };
  }

  return {
    written: true,
    destinationFile: resolution.destinationFile,
    mode,
    expiresAtMs,
  };
}

// ─── TTL & verifiable deletion ────────────────────────────────────────────────

export function isBrazilReceitaFullJoinPrivateArtifactExpired(
  expiresAtMs: number,
  nowMs: number,
): boolean {
  return nowMs >= expiresAtMs;
}

export interface BrazilReceitaFullJoinPrivateDeletionOutcome {
  readonly requested: boolean;
  readonly deleted: boolean;
  /** `true` only when a post-deletion existence check confirmed the file is gone. */
  readonly verifiedAbsent: boolean;
}

/**
 * Deletes the artifact and VERIFIES it is gone.
 *
 * `deleted` and `verifiedAbsent` are separate fields because an unlink that reports success and a
 * file that is actually absent are different claims. Only the second one lets an operator say the
 * exact figures no longer exist, so only the second one is reported as verification.
 */
export function deleteBrazilReceitaFullJoinPrivateArtifact(
  destinationFile: string,
  fileSystem: BrazilReceitaFullJoinPrivateChannelFileSystem,
): BrazilReceitaFullJoinPrivateDeletionOutcome {
  let deleted = false;
  try {
    if (fileSystem.exists(destinationFile)) {
      fileSystem.unlink(destinationFile);
      deleted = true;
    } else {
      // Already absent. Not a deletion, but the post-condition an operator cares about holds.
      deleted = true;
    }
  } catch {
    return { requested: true, deleted: false, verifiedAbsent: false };
  }

  let verifiedAbsent = false;
  try {
    verifiedAbsent = !fileSystem.exists(destinationFile);
  } catch {
    verifiedAbsent = false;
  }
  return { requested: true, deleted, verifiedAbsent };
}

/**
 * Deletes the artifact if — and only if — its TTL has elapsed.
 *
 * A live artifact is left alone and reported as `requested: false`, so a purge sweep cannot be
 * mistaken for a deletion that happened.
 */
export function purgeBrazilReceitaFullJoinPrivateArtifactIfExpired(
  destinationFile: string,
  expiresAtMs: number,
  nowMs: number,
  fileSystem: BrazilReceitaFullJoinPrivateChannelFileSystem,
): BrazilReceitaFullJoinPrivateDeletionOutcome {
  if (!isBrazilReceitaFullJoinPrivateArtifactExpired(expiresAtMs, nowMs)) {
    return { requested: false, deleted: false, verifiedAbsent: false };
  }
  return deleteBrazilReceitaFullJoinPrivateArtifact(destinationFile, fileSystem);
}
