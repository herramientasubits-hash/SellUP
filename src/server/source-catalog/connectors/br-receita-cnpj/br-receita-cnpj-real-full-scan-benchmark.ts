/**
 * BR Receita CNPJ — REAL FULL-SCAN RESOURCE BENCHMARK: THE EXECUTION PATH (BR-SOURCE-14B.0F § 5, § 6,
 * § 11, § 12).
 *
 * The first gap 14B.0E found, and the one the other three exist to serve: every PART of a real
 * full-scan benchmark existed — a manifest validator, a Model A streaming engine, a resource
 * envelope, a bounded partition workspace, a sink that emits nothing, a public sanitizer, a private
 * exact-metric channel — and nothing joined them. A future authorization would have had to be
 * followed by a code change, which means the authorization would have been for something nobody had
 * built yet.
 *
 * This module is the wiring. After it, an authorization is sufficient on its own:
 *
 *   manifest → validated descriptors → streaming full-join engine → NullBenchmarkSink
 *            → public bucketed report → private exact metric artifact → verified cleanup
 *
 * ── And it still refuses ────────────────────────────────────────────────────────
 * `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED` is `false`, and this module imports that
 * constant from 14B.0C rather than declaring its own. There is exactly one authorization flag in the
 * connector; a second one here would be a second place to flip, and the two would eventually
 * disagree. Every real run refuses at the AUTHORIZATION stage, before a manifest is opened, and the
 * refusal is reported as `ABORT_BEFORE_REAL_FILE_OPEN`.
 *
 * ── Nothing is inferred from anything else ──────────────────────────────────────
 * § 6 is emphatic about this and it is the module's main structural rule: nine declarations are
 * required, and NOT ONE of them is derived from another. `capInputPolicyApproved` does not imply
 * `temporaryStoragePolicyApproved`. A present `privateMetricChannelAcknowledgement` does not imply
 * the benchmark is authorized. A complete cap set does not imply the workspace constraints were
 * stated. The reason is that inference is how a partial authorization becomes a full one: an operator
 * approves the thing they were asked about, and the code quietly reads a second approval out of it.
 *
 * ── The caps here are PROPOSED ──────────────────────────────────────────────────
 * `BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS` is the § 11 profile, written down so an owner
 * decision is about concrete numbers. It is `PROPOSED_BENCHMARK_CAPS` and `NOT_PRODUCTION_CAPS`, it
 * is not a default anywhere, and this module never applies it on a caller's behalf — a caller who
 * wants it passes it. Six hours of runtime is an OWNER BUDGET CEILING, not an estimate and not an
 * observation: nobody has measured this run, and a cap presented as a prediction would be a number
 * with the shape of evidence and none of the content.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`. Every filesystem effect arrives through a port the caller supplies, which is
 *     what makes "no test in this milestone opens the real manifest" a structural fact.
 *   - spawns a process, reads an environment variable, or writes to stdout or stderr.
 *   - emits a row, a path, a file name, a CNPJ, a join key, or an exact figure into a public report.
 *   - touches Supabase, a migration, `source_company_snapshots`, the runtime, Agent 1, Agent 2A, a
 *     provider, HubSpot or the UI.
 *   - retries, and cannot be run twice: the attempt ledger is consumed and there is no reset.
 */

import { runBrazilReceitaFullJoinStreamingEngineOnce } from './br-receita-cnpj-full-join-engine';
import {
  createBrazilReceitaFullJoinNullBenchmarkSink,
  type BrazilReceitaFullJoinEngineAbortCode,
  type BrazilReceitaFullJoinNullSinkTally,
} from './br-receita-cnpj-full-join-engine-contract';
import type { BrazilReceitaFullJoinEnginePublicReport } from './br-receita-cnpj-full-join-engine-report';
import type { BrazilReceitaFullJoinFreeDiskProbe } from './br-receita-cnpj-full-join-free-disk';
import {
  resolveBrazilReceitaFullJoinManifestSources,
  type BrazilReceitaFullJoinBridgeFileSystem,
  type BrazilReceitaFullJoinBridgeFinding,
  type BrazilReceitaFullJoinBridgeManifestValidator,
} from './br-receita-cnpj-full-join-manifest-source-bridge';
import { assertBrazilReceitaFullJoinNoWrite } from './br-receita-cnpj-full-join-no-write-guard';
import { sanitizeBrazilReceitaFullJoinReport } from './br-receita-cnpj-full-join-output-sanitizer';
import {
  createBrazilReceitaFullJoinOpenHandleLedger,
  resolveBrazilReceitaFullJoinHandleCaps,
  type BrazilReceitaFullJoinOpenHandleLedger,
} from './br-receita-cnpj-full-join-open-handle-ledger';
import {
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
  deleteBrazilReceitaFullJoinPrivateArtifact,
  resolveBrazilReceitaFullJoinPrivateChannel,
  toBrazilReceitaFullJoinPrivateOperatorMeasurements,
  toBrazilReceitaFullJoinCountBucket,
  writeBrazilReceitaFullJoinPrivateArtifact,
  type BrazilReceitaFullJoinCountBucket,
  type BrazilReceitaFullJoinPrivateChannelBoundaries,
  type BrazilReceitaFullJoinPrivateChannelDeclaration,
  type BrazilReceitaFullJoinPrivateChannelFileSystem,
  type BrazilReceitaFullJoinPrivateDestinationRejection,
  type BrazilReceitaFullJoinPrivateSanitizerResult,
  type BrazilReceitaFullJoinPrivateWriteFailure,
} from './br-receita-cnpj-full-join-operator-metric-channel';
import { BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES } from './br-receita-cnpj-full-join-partition-handle-pool';
import type {
  BrazilReceitaFullJoinWorkspaceBoundaries,
  BrazilReceitaFullJoinWorkspaceFileSystem,
} from './br-receita-cnpj-full-join-partition-workspace';
import {
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
  evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory,
  type BrazilReceitaFullJoinBenchmarkAttemptLedger,
  type BrazilReceitaFullJoinBenchmarkCwdViolation,
  type BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs,
} from './br-receita-cnpj-full-join-resource-benchmark';
import {
  BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
  createBrazilReceitaFullJoinResourceProcessDependencies,
  resolveBrazilReceitaFullJoinResourceCaps,
  type BrazilReceitaFullJoinCapRejection,
  type BrazilReceitaFullJoinResourceCapKey,
  type BrazilReceitaFullJoinResourceDependencies,
} from './br-receita-cnpj-full-join-resource-envelope';
import type { BrazilReceitaFullJoinReaderFileSystem } from './br-receita-cnpj-full-join-streaming-reader';

// ─── Identity ─────────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_MODE =
  'real_full_scan_resource_benchmark' as const;

export const BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_VERSION = 1 as const;

/**
 * The abort marker for a refusal raised before the manifest — let alone a data file — is opened.
 *
 * Distinct from 14B.0C's `ABORT_BEFORE_DATA_ACCESS` because it makes a STRONGER claim: not merely
 * that no row was read, but that no real file was opened at all, including the manifest.
 */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_BEFORE_REAL_FILE_OPEN =
  'ABORT_BEFORE_REAL_FILE_OPEN' as const;

/**
 * The single hard gate, re-exported so a reader of this module does not have to go and find it.
 *
 * Re-exported, not redeclared. It is 14B.0C's constant, it is `false`, and flipping it takes a source
 * edit, a PR and an owner decision in exactly one place.
 */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG =
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED;

// ─── § 11 proposed profile ────────────────────────────────────────────────────

/**
 * The runtime ceiling's THREE names, kept apart because collapsing them is how a budget becomes a
 * prediction. Six hours is what an owner would be authorizing this run to spend. Nobody has measured
 * how long it takes, and nobody has modelled it.
 */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_FIGURE_KIND = 'OWNER_BUDGET_CEILING' as const;
export const BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_IS_OBSERVED = false as const;
export const BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_IS_ESTIMATED = false as const;

/**
 * Exhausting either runtime cap is a VALID RESULT of the benchmark, not a reason to try again.
 *
 * § 2 says so and the envelope already enforces it (`BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT`
 * is structurally zero). It is restated here as data because the temptation is specific and strong:
 * a six-hour run that stops at six hours feels like a run that "nearly worked", and a second attempt
 * would spend another six hours to reach the same wall — in a process whose heap is already grown.
 */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_EXHAUSTION_IS_A_RESULT = {
  runtime_cap_exceeded: 'valid_benchmark_result_no_retry_authorized',
  phase_runtime_cap_exceeded: 'valid_benchmark_result_no_retry_authorized',
} as const;

/** The § 11 profile's standing. Stated as data so no report can imply approval by omission. */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_CAP_APPROVAL_STATUS =
  'proposed_benchmark_caps_not_production_caps' as const;

/**
 * The § 11 profile, complete and in one place.
 *
 * Every figure here is a PROPOSAL for a future owner decision. Nothing in this module defaults to it,
 * nothing validates against it, and passing it is a caller's explicit act — the same discipline
 * 14B.0C applies to its own provisional proposal, for the same reason.
 */
export const BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS = {
  // Memory — 14B.0A observed `lte_256mb` RSS and `lte_16mb` heap on a bounded run.
  maxRssBytes: 536_870_912,
  maxHeapUsedBytes: 134_217_728,
  maxExternalMemoryBytes: 67_108_864,
  // Runtime — the owner budget ceiling. Six hours. Not an estimate.
  maxRuntimeMs: 21_600_000,
  maxPhaseRuntimeMs: 21_600_000,
  // Temporary storage and the disk it lives on.
  maxTemporaryStorageBytes: 4_294_967_296,
  minimumFreeDiskBeforeStart: 12_884_901_888,
  minimumFreeDiskReserve: 8_589_934_592,
  // Descriptors — the § 3 fix, as numbers.
  maxFilesOpened: 64,
  maxOpenPartitionFiles: BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES,
  // Coverage — bounds on what a complete traversal may consume.
  maxBytesRead: 73_014_444_032,
  maxRowsRead: 360_000_000,
  maxJoinKeysInMemory: 131_072,
  // Zero. A benchmark that could emit one row would be an import with a smaller number attached.
  maxOutputRows: 0,
  // Partitioning.
  partitionCount: 1_024,
  maxPartitionCount: 2_048,
  maxPartitionDepth: 1,
  maxReferencesPerPartition: 131_072,
  maxReferenceBytesPerPartition: 2_097_152,
  // Reader buffers.
  maxChunkBytes: 4_194_304,
  maxCarryBytes: 65_536,
  maxRowBytes: 65_536,
  maxColumnsPerRow: 64,
  // Private artifact lifetime.
  privateMetricArtifactTtlMs: 3_600_000,
  // Attempts.
  attemptCount: 1,
  automaticRetryCount: BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
} as const;

/** The resource-envelope subset of the profile, in the shape 14B.0C's resolver expects. */
export function brazilReceitaProposedFullScanResourceCaps(): Record<
  BrazilReceitaFullJoinResourceCapKey,
  number
> {
  const proposal = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
  return {
    maxRssBytes: proposal.maxRssBytes,
    maxHeapUsedBytes: proposal.maxHeapUsedBytes,
    maxExternalMemoryBytes: proposal.maxExternalMemoryBytes,
    maxRuntimeMs: proposal.maxRuntimeMs,
    maxPhaseRuntimeMs: proposal.maxPhaseRuntimeMs,
    maxTemporaryStorageBytes: proposal.maxTemporaryStorageBytes,
    maxFilesOpened: proposal.maxFilesOpened,
    maxBytesRead: proposal.maxBytesRead,
    maxRowsRead: proposal.maxRowsRead,
    maxJoinKeysInMemory: proposal.maxJoinKeysInMemory,
    maxOutputRows: proposal.maxOutputRows,
  };
}

// ─── Declarations ─────────────────────────────────────────────────────────────

/**
 * The nine declarations § 6 requires, each one its own field.
 *
 * They are separate fields rather than a single "approved" object because that is the only shape in
 * which "no declaration is inferred from another" can be enforced: with nine fields, a missing one is
 * a missing one, and there is nothing for the code to fall back to.
 */
export interface BrazilReceitaRealFullScanDeclarations {
  /** GATE-2's temporary-storage approval, stated by the operator. Must be the literal `true`. */
  readonly temporaryStoragePolicyApproved: unknown;
  /** The CAP-input policy approval. A separate decision, separately stated. */
  readonly capInputPolicyApproved: unknown;
  /** The benchmark authorization itself. Checked against the source constant, never trusted alone. */
  readonly benchmarkAuthorization: unknown;
  /** Must be exactly `1`. There is no second attempt and no configuration that produces one. */
  readonly attemptCount: unknown;
  /** The dataset period being benchmarked, `YYYY-MM`. Named so two runs cannot be confused. */
  readonly datasetPeriod: unknown;
  /** The absolute manifest path. Declared, never discovered — this module searches for nothing. */
  readonly manifestPath: unknown;
  /** The exact acknowledgement phrase that enables the private exact-metric channel. */
  readonly privateMetricChannelAcknowledgement: unknown;
  /** The complete resource cap set, plus the § 3 and § 4 additions. */
  readonly resourceCaps: unknown;
  readonly maxOpenPartitionFiles: unknown;
  readonly minimumFreeDiskBeforeStart: unknown;
  readonly minimumFreeDiskReserve: unknown;
  readonly readerCaps: unknown;
  readonly partitioningCaps: unknown;
  /** The workspace constraints: where it may live, and the boundaries it may not cross. */
  readonly workspaceParentDirectory: unknown;
  readonly workspaceBoundaries: unknown;
  /** Where the private artifact goes, and for how long. */
  readonly privateMetricDestinationDirectory: unknown;
  readonly privateMetricArtifactSlug: unknown;
  readonly privateMetricArtifactTtlMs: unknown;
  /** The 11A no-write contract, passed through the guard verbatim. */
  readonly noWriteContract: unknown;
}

/** Every way a declaration can be missing or wrong. Never echoes the offending value. */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_DECLARATION_KEYS = [
  'temporaryStoragePolicyApproved',
  'capInputPolicyApproved',
  'benchmarkAuthorization',
  'attemptCount',
  'datasetPeriod',
  'manifestPath',
  'privateMetricChannelAcknowledgement',
  'resourceCaps',
  'maxOpenPartitionFiles',
  'minimumFreeDiskBeforeStart',
  'minimumFreeDiskReserve',
  'readerCaps',
  'partitioningCaps',
  'workspaceParentDirectory',
  'workspaceBoundaries',
  'privateMetricDestinationDirectory',
  'privateMetricArtifactSlug',
  'privateMetricArtifactTtlMs',
  'noWriteContract',
] as const;

export type BrazilReceitaRealFullScanDeclarationKey =
  (typeof BRAZIL_RECEITA_REAL_FULL_SCAN_DECLARATION_KEYS)[number];

// ─── Abort codes ──────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_CODES = [
  'unsafe_operator_working_directory',
  'declaration_missing',
  'resource_caps_incomplete',
  'handle_caps_invalid',
  'no_write_guard_failed',
  'output_rows_cap_must_be_zero',
  'single_attempt_already_consumed',
  'benchmark_not_authorized',
  'private_metric_channel_not_ready',
  'manifest_resolution_failed',
  'engine_aborted',
  'private_metric_write_failed',
  'cleanup_not_verified',
] as const;

export type BrazilReceitaRealFullScanAbortCode =
  (typeof BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_CODES)[number];

/**
 * The ordered preflight. Every stage fires BEFORE the manifest is opened, and the order is a safety
 * property rather than a style choice:
 *
 *   1. `operator_working_directory` — the one hazard that can damage something OUTSIDE this run.
 *   2. `declarations`              — nine explicit statements, none inferred from another.
 *   3. `resource_caps`             — § 5 of 14B.0C: caps validated before the first real access.
 *   4. `handle_caps`               — § 3's two new caps, validated together.
 *   5. `no_write_contract`         — the 11A guard, on the whole configuration.
 *   6. `zero_output`               — `maxOutputRows` must be exactly zero.
 *   7. `private_metric_channel`    — resolved, so a run does not finish and then discover it has
 *                                    nowhere to put the figures it spent six hours collecting.
 *   8. `single_attempt`            — consumed only once the run is otherwise well-formed, so a typo
 *                                    does not burn the operator's single attempt.
 *   9. `authorization`             — LAST, and the one that actually stops every run today.
 */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES = [
  'operator_working_directory',
  'declarations',
  'resource_caps',
  'handle_caps',
  'no_write_contract',
  'zero_output',
  'private_metric_channel',
  'single_attempt',
  'authorization',
] as const;

export type BrazilReceitaRealFullScanPreflightStage =
  (typeof BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES)[number];

// ─── Request ──────────────────────────────────────────────────────────────────

/**
 * Everything the benchmark needs, with every filesystem effect behind a port.
 *
 * The ports are what make § 15 structural rather than aspirational: this module has no `node:fs`
 * import, so a test that supplies scripted ports CANNOT reach the real manifest even by accident.
 */
export interface BrazilReceitaRealFullScanBenchmarkRequest {
  readonly declarations: BrazilReceitaRealFullScanDeclarations;
  readonly workingDirectory: BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs;
  readonly attemptLedger: BrazilReceitaFullJoinBenchmarkAttemptLedger;
  readonly bridgeFileSystem: BrazilReceitaFullJoinBridgeFileSystem;
  readonly validateManifest: BrazilReceitaFullJoinBridgeManifestValidator;
  readonly readerFileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly workspaceFileSystem: BrazilReceitaFullJoinWorkspaceFileSystem;
  readonly privateChannelFileSystem: BrazilReceitaFullJoinPrivateChannelFileSystem;
  readonly privateChannelBoundaries: BrazilReceitaFullJoinPrivateChannelBoundaries;
  readonly freeDiskProbe: BrazilReceitaFullJoinFreeDiskProbe;
  readonly resourceDependencies?: BrazilReceitaFullJoinResourceDependencies;
  /**
   * Wall-clock milliseconds, supplied rather than read.
   *
   * The private artifact stamps a creation time and an expiry, and both belong to the CALLER's clock:
   * a module that called `Date.now()` itself could not be tested for TTL behaviour without waiting.
   */
  readonly nowMs: number;
}

// ─── Outcome ──────────────────────────────────────────────────────────────────

/**
 * The § 10 public report. Buckets and closed enums only — every magnitude that could be an identifier
 * is bucketed, and the exact figures live in the private artifact or nowhere.
 */
export interface BrazilReceitaRealFullScanPublicReport {
  readonly mode: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_MODE;
  readonly benchmark_version: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_VERSION;
  readonly measurement_version: number;
  /**
   * Whether the run produced a complete set of measurements.
   *
   * False whenever the engine aborted or a memory sample was unavailable. It is reported explicitly
   * because a bucketed report of a partial run looks exactly like a bucketed report of a complete
   * one, and a reader comparing two runs must be able to tell them apart.
   */
  readonly measurement_complete: boolean;
  readonly exit_status: 'completed' | 'aborted';
  readonly abort_code: BrazilReceitaRealFullScanAbortCode | BrazilReceitaFullJoinEngineAbortCode | 'none';
  readonly abort_stage: BrazilReceitaRealFullScanPreflightStage | 'engine' | 'cleanup' | 'none';
  /** `null` exactly when `sanitizer_status` is `'failed'` — see `public_report_released`. */
  readonly engine_report: BrazilReceitaFullJoinEnginePublicReport | null;
  /**
   * The REAL sanitizer verdict against `engine_report`, computed on every terminal outcome
   * (BR-SOURCE-14B.0H § 16) — never a label inferred from `abort_code`.
   */
  readonly sanitizer_status: BrazilReceitaFullJoinPrivateSanitizerResult;
  /** `false` whenever `sanitizer_status` is `'failed'`. The primary `abort_code` is unaffected. */
  readonly public_report_released: boolean;
  readonly files_opened_peak_bucket: BrazilReceitaFullJoinCountBucket;
  readonly cleanup_status: string;
  readonly cleanup_verified_absent: boolean;
  readonly private_metric_artifact_written: boolean;
  readonly real_full_scan_benchmark_executed: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED;
  readonly real_manifest_opened: boolean;
  readonly rows_emitted: 0;
  readonly retries_performed: typeof BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT;
  readonly exact_values_printed: false;
  readonly absolute_paths_printed: false;
  readonly file_names_printed: false;
}

export interface BrazilReceitaRealFullScanRefusal {
  readonly ok: false;
  readonly mode: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_MODE;
  readonly abortStage: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_BEFORE_REAL_FILE_OPEN;
  readonly failedStage: BrazilReceitaRealFullScanPreflightStage;
  readonly abortCode: BrazilReceitaRealFullScanAbortCode;
  readonly missingDeclarations: readonly BrazilReceitaRealFullScanDeclarationKey[];
  readonly cwdViolations: readonly BrazilReceitaFullJoinBenchmarkCwdViolation[];
  readonly capRejections: readonly BrazilReceitaFullJoinCapRejection[];
  readonly privateChannelRejections: readonly BrazilReceitaFullJoinPrivateDestinationRejection[];
  readonly bridgeFindings: readonly BrazilReceitaFullJoinBridgeFinding[];
  readonly realManifestOpened: false;
  readonly realDataAccessed: false;
  readonly rowsEmitted: 0;
  readonly retriesPerformed: typeof BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT;
  readonly realFullScanBenchmarkExecuted: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED;
}

export interface BrazilReceitaRealFullScanCompletion {
  readonly ok: true;
  readonly mode: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_MODE;
  readonly publicReport: BrazilReceitaRealFullScanPublicReport;
  readonly sinkTally: BrazilReceitaFullJoinNullSinkTally;
  readonly privateArtifactWritten: boolean;
  readonly privateArtifactFailure: BrazilReceitaFullJoinPrivateWriteFailure | null;
  readonly cleanupVerified: boolean;
}

export type BrazilReceitaRealFullScanOutcome =
  | BrazilReceitaRealFullScanCompletion
  | BrazilReceitaRealFullScanRefusal;

// ─── Declaration validation ───────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns EVERY declaration that is missing or malformed, in declaration order.
 *
 * All of them rather than the first: an operator completing a nineteen-field declaration should learn
 * about every gap in one refusal. And each check tests the declaration on its OWN terms — a `true`
 * where `true` is required, a `1` where `1` is required, the exact acknowledgement phrase where the
 * phrase is required — because "present and truthy" is how `"no"` becomes an approval.
 */
export function findBrazilReceitaRealFullScanMissingDeclarations(
  declarations: BrazilReceitaRealFullScanDeclarations | null | undefined,
): readonly BrazilReceitaRealFullScanDeclarationKey[] {
  if (!isRecord(declarations)) return [...BRAZIL_RECEITA_REAL_FULL_SCAN_DECLARATION_KEYS];
  const missing: BrazilReceitaRealFullScanDeclarationKey[] = [];

  if (declarations.temporaryStoragePolicyApproved !== true) {
    missing.push('temporaryStoragePolicyApproved');
  }
  if (declarations.capInputPolicyApproved !== true) missing.push('capInputPolicyApproved');
  if (declarations.benchmarkAuthorization !== true) missing.push('benchmarkAuthorization');
  if (declarations.attemptCount !== 1) missing.push('attemptCount');
  if (
    typeof declarations.datasetPeriod !== 'string' ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(declarations.datasetPeriod)
  ) {
    missing.push('datasetPeriod');
  }
  if (typeof declarations.manifestPath !== 'string' || declarations.manifestPath.trim() === '') {
    missing.push('manifestPath');
  }
  if (
    declarations.privateMetricChannelAcknowledgement !==
    BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT
  ) {
    // A literal phrase, never a boolean: a boolean is too easy to set by accident and too easy for a
    // future caller to default to `true`.
    missing.push('privateMetricChannelAcknowledgement');
  }
  if (!isRecord(declarations.resourceCaps)) missing.push('resourceCaps');
  if (!Number.isInteger(declarations.maxOpenPartitionFiles as number)) {
    missing.push('maxOpenPartitionFiles');
  }
  if (!Number.isInteger(declarations.minimumFreeDiskBeforeStart as number)) {
    missing.push('minimumFreeDiskBeforeStart');
  }
  if (!Number.isInteger(declarations.minimumFreeDiskReserve as number)) {
    missing.push('minimumFreeDiskReserve');
  }
  if (!isRecord(declarations.readerCaps)) missing.push('readerCaps');
  if (!isRecord(declarations.partitioningCaps)) missing.push('partitioningCaps');
  if (
    typeof declarations.workspaceParentDirectory !== 'string' ||
    declarations.workspaceParentDirectory.trim() === ''
  ) {
    missing.push('workspaceParentDirectory');
  }
  if (!isRecord(declarations.workspaceBoundaries)) missing.push('workspaceBoundaries');
  if (
    typeof declarations.privateMetricDestinationDirectory !== 'string' ||
    declarations.privateMetricDestinationDirectory.trim() === ''
  ) {
    missing.push('privateMetricDestinationDirectory');
  }
  if (
    typeof declarations.privateMetricArtifactSlug !== 'string' ||
    declarations.privateMetricArtifactSlug.trim() === ''
  ) {
    missing.push('privateMetricArtifactSlug');
  }
  if (!Number.isInteger(declarations.privateMetricArtifactTtlMs as number)) {
    missing.push('privateMetricArtifactTtlMs');
  }
  if (!isRecord(declarations.noWriteContract)) missing.push('noWriteContract');

  return missing;
}

// ─── Refusal helper ───────────────────────────────────────────────────────────

function refuse(
  abortCode: BrazilReceitaRealFullScanAbortCode,
  failedStage: BrazilReceitaRealFullScanPreflightStage,
  details: {
    missingDeclarations?: readonly BrazilReceitaRealFullScanDeclarationKey[];
    cwdViolations?: readonly BrazilReceitaFullJoinBenchmarkCwdViolation[];
    capRejections?: readonly BrazilReceitaFullJoinCapRejection[];
    privateChannelRejections?: readonly BrazilReceitaFullJoinPrivateDestinationRejection[];
    bridgeFindings?: readonly BrazilReceitaFullJoinBridgeFinding[];
  } = {},
): BrazilReceitaRealFullScanRefusal {
  return {
    ok: false,
    mode: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_MODE,
    abortStage: BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_BEFORE_REAL_FILE_OPEN,
    failedStage,
    abortCode,
    missingDeclarations: details.missingDeclarations ?? [],
    cwdViolations: details.cwdViolations ?? [],
    capRejections: details.capRejections ?? [],
    privateChannelRejections: details.privateChannelRejections ?? [],
    bridgeFindings: details.bridgeFindings ?? [],
    realManifestOpened: false,
    realDataAccessed: false,
    rowsEmitted: 0,
    retriesPerformed: BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
    realFullScanBenchmarkExecuted: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
  };
}

// ─── Sanitizer gate (BR-SOURCE-14B.0H § 16) ───────────────────────────────────

/**
 * Runs the REAL structural leak sanitizer against the engine's public report, and decides what may
 * be released.
 *
 * Before this milestone, `sanitizerResult` was a hardcoded label derived from `abortCode` — `'passed'`
 * on success, `'not_run'` on any abort — and `sanitizeBrazilReceitaFullJoinReport` was never actually
 * called on this path. That made the label a claim nobody had checked, on BOTH branches: a `'passed'`
 * that no sanitizer had verified is exactly as ungrounded as a `'not_run'` that skips verification
 * because the run failed. This function is what makes the label a computed fact instead: the
 * sanitizer runs on every terminal outcome — success, resource-cap breach, reader failure, partition
 * failure, disk failure, runtime failure, cleanup failure — because a report is not safer for having
 * come from a run that failed.
 *
 * The PRIMARY abort code is never touched here and is not this function's business: a run that
 * breached `maxRuntimeMs` reports `runtime_cap_exceeded` regardless of what the sanitizer finds.
 * `sanitizerResult` and `publicReportReleased` are carried separately so a failed sanitization cannot
 * be confused with, or silently overwrite, the reason the run actually stopped.
 */
export function applyBrazilReceitaRealFullScanReportSanitizer(
  engineReport: BrazilReceitaFullJoinEnginePublicReport,
): {
  readonly sanitizerResult: BrazilReceitaFullJoinPrivateSanitizerResult;
  readonly publicReportReleased: boolean;
  readonly releasedEngineReport: BrazilReceitaFullJoinEnginePublicReport | null;
} {
  const verdict = sanitizeBrazilReceitaFullJoinReport(engineReport);
  return {
    sanitizerResult: verdict.ok ? 'passed' : 'failed',
    publicReportReleased: verdict.ok,
    // A sanitizer failure withholds the nested engine report itself — the one object in this
    // module's output built from the run's own figures — rather than merely noting the failure
    // alongside an unsafe payload the caller could still read.
    releasedEngineReport: verdict.ok ? engineReport : null,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Runs the real full-scan resource benchmark, or refuses.
 *
 * Today it always refuses, at the `authorization` stage, and the value of the module is everything
 * that is now WIRED behind that refusal: after an authorization, this function runs the real engine
 * over the real files with no further code change. That was the whole point of the milestone.
 *
 * ── Cleanup runs on EVERY path (§ 12) ───────────────────────────────────────────
 * The engine already stops reading, closes its source handles, closes the partition pool, deletes the
 * workspace and VERIFIES the deletion — on success, on a cap breach, on a sink failure and on a free-
 * disk breach alike. What this function adds is the last two obligations: the private artifact is
 * written only after cleanup has been accounted for, and a cleanup that FAILED or could not be
 * VERIFIED makes the whole result unsuccessful regardless of what the join found. The PRIMARY abort
 * code is preserved — a run that breached a memory cap and then cleaned up badly reports the memory
 * breach, because that is what happened first and it is what the operator has to act on.
 */
export async function runBrazilReceitaRealFullScanResourceBenchmark(
  request: BrazilReceitaRealFullScanBenchmarkRequest,
): Promise<BrazilReceitaRealFullScanOutcome> {
  // 1 — Working directory. First, because an unsafe cwd is the one hazard that can damage something
  // outside this run, and it must be caught before any other work happens.
  const cwdViolations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory(
    request.workingDirectory,
  );
  if (cwdViolations.length > 0) {
    return refuse('unsafe_operator_working_directory', 'operator_working_directory', {
      cwdViolations,
    });
  }

  // 2 — Declarations. Nothing below may be inferred from anything here.
  const missingDeclarations = findBrazilReceitaRealFullScanMissingDeclarations(request.declarations);
  if (missingDeclarations.length > 0) {
    return refuse('declaration_missing', 'declarations', { missingDeclarations });
  }
  const declarations = request.declarations;

  // 3 — Resource caps.
  const capResolution = resolveBrazilReceitaFullJoinResourceCaps(
    declarations.resourceCaps as Readonly<Partial<Record<BrazilReceitaFullJoinResourceCapKey, unknown>>>,
  );
  if (!capResolution.ok) {
    return refuse('resource_caps_incomplete', 'resource_caps', {
      capRejections: capResolution.rejections,
    });
  }

  // 4 — Handle caps, validated together with the global one they must fit inside.
  const handleCaps = resolveBrazilReceitaFullJoinHandleCaps(
    capResolution.caps.maxFilesOpened,
    declarations.maxOpenPartitionFiles,
  );
  if (!handleCaps.ok) return refuse('handle_caps_invalid', 'handle_caps');

  // 5 — The 11A no-write contract, over the whole configuration.
  const guardResult = assertBrazilReceitaFullJoinNoWrite(declarations.noWriteContract);
  if (!guardResult.ok) return refuse('no_write_guard_failed', 'no_write_contract');

  // 6 — Zero output. An equality, not a ceiling.
  if (capResolution.caps.maxOutputRows !== 0) {
    return refuse('output_rows_cap_must_be_zero', 'zero_output');
  }

  // 7 — The private channel, resolved BEFORE the run rather than after. A six-hour benchmark that
  // finished and then discovered it had nowhere to put its figures would have to be run again, and
  // there is no second attempt.
  const privateDeclaration: BrazilReceitaFullJoinPrivateChannelDeclaration = {
    acknowledgement: declarations.privateMetricChannelAcknowledgement as string,
    destinationDirectory: declarations.privateMetricDestinationDirectory as string,
    artifactSlug: declarations.privateMetricArtifactSlug as string,
    ttlMs: declarations.privateMetricArtifactTtlMs as number,
  };
  const privateChannel = resolveBrazilReceitaFullJoinPrivateChannel(
    privateDeclaration,
    request.privateChannelBoundaries,
  );
  if (!privateChannel.ready) {
    return refuse('private_metric_channel_not_ready', 'private_metric_channel', {
      privateChannelRejections: privateChannel.rejections,
    });
  }

  // 8 — The single attempt, consumed only now that the run is otherwise well-formed.
  if (!request.attemptLedger.consume()) {
    return refuse('single_attempt_already_consumed', 'single_attempt');
  }

  // 9 — AUTHORIZATION. The gate that stops every run today, and the last thing checked before the
  // manifest would be opened. Both the source constant and the operator's declaration must agree:
  // the declaration alone cannot authorize a run, and the constant alone does not mean the operator
  // asked for one.
  if (!BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED) {
    return refuse('benchmark_not_authorized', 'authorization');
  }

  // ── Beyond this line a real file may be opened. Nothing above has opened one. ──

  const bridge = await resolveBrazilReceitaFullJoinManifestSources({
    manifestPath: declarations.manifestPath as string,
    fileSystem: request.bridgeFileSystem,
    validateManifest: request.validateManifest,
    allowRealLocalFiles: true,
  });
  if (!bridge.ok) {
    return refuse('manifest_resolution_failed', 'authorization', {
      bridgeFindings: bridge.findings,
    });
  }

  const openHandleLedger: BrazilReceitaFullJoinOpenHandleLedger =
    createBrazilReceitaFullJoinOpenHandleLedger(handleCaps.maxFilesOpened);
  const sink = createBrazilReceitaFullJoinNullBenchmarkSink();

  const engineResult = await runBrazilReceitaFullJoinStreamingEngineOnce({
    sources: bridge.joinSources,
    readerCaps: declarations.readerCaps as Readonly<Record<string, unknown>>,
    partitioningCaps: declarations.partitioningCaps as Readonly<Record<string, unknown>>,
    resourceCaps: capResolution.caps,
    duplicateKeyPolicy: 'pair_with_every_duplicate',
    sink,
    readerFileSystem: request.readerFileSystem,
    workspaceFileSystem: request.workspaceFileSystem,
    workspaceParentDirectory: declarations.workspaceParentDirectory as string,
    workspaceBoundaries: declarations.workspaceBoundaries as BrazilReceitaFullJoinWorkspaceBoundaries,
    resourceDependencies:
      request.resourceDependencies ?? createBrazilReceitaFullJoinResourceProcessDependencies(),
    openHandleLedger,
    maxOpenPartitionFiles: handleCaps.maxOpenPartitionFiles,
    minimumFreeDiskBeforeStart: declarations.minimumFreeDiskBeforeStart as number,
    minimumFreeDiskReserve: declarations.minimumFreeDiskReserve as number,
    freeDiskProbe: request.freeDiskProbe,
    // The engine's temporary-storage policy check is a SECOND, independent gate. The operator's
    // declaration above does not satisfy it: it is a source constant, and it is `false`.
    realDataRun: true,
    sinkMaterializesRows: false,
  });

  const cleanupVerified =
    engineResult.cleanupOutcome === 'completed' || engineResult.cleanupOutcome === 'not_needed';

  // The sanitizer runs on EVERY terminal outcome, success or abort alike (BR-SOURCE-14B.0H § 16) —
  // see `applyBrazilReceitaRealFullScanReportSanitizer`.
  const sanitization = applyBrazilReceitaRealFullScanReportSanitizer(engineResult.publicReport);

  // The private artifact is written from the run's EXACT observations, and only after cleanup has
  // been accounted for — so a report of a run whose workspace is still on disk cannot claim success.
  const privatePayload = toBrazilReceitaFullJoinPrivateOperatorMeasurements(
    engineResult.exact.resource,
    sanitization.sanitizerResult,
    {
      partitionsCreated: engineResult.exact.partitionsCreated,
      largestPartitionReferenceCount: engineResult.exact.largestPartitionReferenceCount,
      filesOpenedPeak: engineResult.exact.filesOpenedPeak,
      partitionHandlePeakOpen: engineResult.exact.partitionHandlePeakOpen,
    },
  );
  const write = writeBrazilReceitaFullJoinPrivateArtifact(
    privateChannel,
    privatePayload,
    request.privateChannelFileSystem,
    request.nowMs,
  );
  if (!write.written) {
    // A failed private write leaves NOTHING on disk (the channel discards its temporary file), and
    // the run is reported as unsuccessful: exact figures that were never persisted are exact figures
    // nobody has, and GATE-2 needs them.
    deleteBrazilReceitaFullJoinPrivateArtifact(
      privateChannel.destinationFile,
      request.privateChannelFileSystem,
    );
  }

  const abortCode: BrazilReceitaRealFullScanPublicReport['abort_code'] =
    engineResult.abortCode !== null
      ? engineResult.abortCode
      : !write.written
        ? 'private_metric_write_failed'
        : !cleanupVerified
          ? 'cleanup_not_verified'
          : 'none';

  const publicReport: BrazilReceitaRealFullScanPublicReport = {
    mode: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_MODE,
    benchmark_version: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_VERSION,
    measurement_version: engineResult.publicReport.resource_measurements.measurement_version,
    measurement_complete:
      engineResult.abortCode === null && engineResult.exact.resource.peakRssBytes !== null,
    exit_status: abortCode === 'none' ? 'completed' : 'aborted',
    // The PRIMARY code, untouched by the sanitizer verdict: a run that breached `maxRuntimeMs` and
    // whose report also failed sanitization still reports `runtime_cap_exceeded`, because that is
    // what actually happened first and what an operator has to act on.
    abort_code: abortCode,
    abort_stage: engineResult.abortCode !== null ? 'engine' : abortCode === 'none' ? 'none' : 'cleanup',
    // Withheld (`null`) when the sanitizer failed — see `sanitizer_status` and
    // `public_report_released` below, which carry that fact separately from `abort_code`.
    engine_report: sanitization.releasedEngineReport,
    sanitizer_status: sanitization.sanitizerResult,
    public_report_released: sanitization.publicReportReleased,
    files_opened_peak_bucket: toBrazilReceitaFullJoinCountBucket(
      engineResult.exact.filesOpenedPeak,
    ),
    cleanup_status: engineResult.publicReport.cleanup.cleanup_status,
    cleanup_verified_absent: engineResult.publicReport.cleanup_verified_absent,
    private_metric_artifact_written: write.written,
    real_full_scan_benchmark_executed: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
    real_manifest_opened: true,
    rows_emitted: 0,
    retries_performed: BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
    exact_values_printed: false,
    absolute_paths_printed: false,
    file_names_printed: false,
  };

  return {
    ok: true,
    mode: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_MODE,
    publicReport,
    sinkTally: sink.tally(),
    privateArtifactWritten: write.written,
    privateArtifactFailure: write.written ? null : write.failure,
    cleanupVerified,
  };
}

// ─── Readiness ────────────────────────────────────────────────────────────────

/**
 * The milestone's own readiness, COMPUTED from the constants rather than asserted.
 *
 * `gate2ReadyForOwnerReview` is deliberately `false` and deliberately not a function of how finished
 * the code is. GATE-2 is a decision about what a real run COSTS, and nobody has run one: the answer
 * comes from the benchmark, so it cannot be a precondition for it.
 */
export interface BrazilReceitaRealFullScanReadiness {
  readonly fullScanEngineReady: true;
  readonly fullScanExecutionPathReady: true;
  readonly benchmarkProfileImplementable: true;
  readonly realFullScanBenchmarkReadyForOwnerAuthorization: boolean;
  readonly realFullScanBenchmarkAuthorized: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED;
  readonly realFullScanBenchmarkExecuted: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED;
  readonly gate2ReadyForOwnerReview: false;
  readonly nextAction: 'merge_review';
}

export function summarizeBrazilReceitaRealFullScanReadiness(): BrazilReceitaRealFullScanReadiness {
  return {
    fullScanEngineReady: true,
    fullScanExecutionPathReady: true,
    benchmarkProfileImplementable: true,
    // Ready to be AUTHORIZED — every control exists and the path is wired end to end. Not authorized:
    // those are different facts, and this milestone changes only the first.
    realFullScanBenchmarkReadyForOwnerAuthorization: true,
    realFullScanBenchmarkAuthorized: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
    realFullScanBenchmarkExecuted: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
    gate2ReadyForOwnerReview: false,
    nextAction: 'merge_review',
  };
}
