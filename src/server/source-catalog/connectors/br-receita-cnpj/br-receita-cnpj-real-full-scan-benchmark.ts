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
 * ── And it still refuses, by default ────────────────────────────────────────────
 * `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED` is `false`, and this module imports that
 * constant from 14B.0C rather than declaring its own. There is exactly one authorization CONSTANT in
 * the connector; a second one here would be a second place to flip, and the two would eventually
 * disagree.
 *
 * BR-SOURCE-ATTEMPT2-OPS adds the one thing that constant could never express: an owner decision scoped
 * to a single invocation. `request.operatorAuthorization` carries three separate approvals, each `false`
 * unless the operator passed its own explicit flag, and a COMPLETE grant satisfies the authorization
 * stage on its own. The constant did not move and the default did not move — a request with no grant is
 * refused at the AUTHORIZATION stage, before a manifest is opened, and the refusal is reported as
 * `ABORT_BEFORE_REAL_FILE_OPEN` exactly as it always was.
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

import {
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
  brazilReceitaAttempt2OperatorAuthorizationGranted,
  findBrazilReceitaAttempt2MissingOperatorApprovals,
  summarizeBrazilReceitaAttempt2OperatorAuthorization,
  type BrazilReceitaAttempt2OperatorApprovalKey,
  type BrazilReceitaAttempt2OperatorAuthorization,
  type BrazilReceitaAttempt2OperatorAuthorizationStanding,
} from './br-receita-cnpj-attempt2-operator-authorization';
import { runBrazilReceitaFullJoinStreamingEngineOnce } from './br-receita-cnpj-full-join-engine';
import { withBrazilReceitaFullJoinFirstSourceReadBoundary } from './br-receita-cnpj-full-join-first-source-read-boundary';
import { mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval } from './br-receita-cnpj-full-join-temporary-storage-approval';
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
import {
  brazilReceitaNationalInputSatisfiesAttempt2,
  summarizeBrazilReceitaNationalInputGate,
  type BrazilReceitaNationalInputCompletenessResult,
  type BrazilReceitaNationalInputGateStanding,
} from './br-receita-cnpj-national-input-completeness';
import {
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  createBrazilReceitaRealBenchmarkAttemptBoundaryLedger,
  evaluateBrazilReceitaRealBenchmarkAttemptRequest,
  summarizeBrazilReceitaRealBenchmarkAttemptModel,
  type BrazilReceitaRealBenchmarkAttemptModelSummary,
  type BrazilReceitaRealBenchmarkAttemptRejectionCode,
} from './br-receita-cnpj-real-benchmark-attempt-ledger';
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
  /**
   * Attempts this ONE run is budgeted. Must be exactly `1`: a single run spends a single attempt.
   *
   * Not to be confused with `requestedRealAttemptNumber` below — that is WHICH attempt this is in the
   * project's history. Conflating "one attempt per run" with "only one attempt ever" is precisely what
   * 14B.0J had to untangle: the first is a per-run invariant that never changes, the second is a
   * historical count that moved to 1 when 14B.0G ran.
   */
  readonly attemptCount: unknown;
  /**
   * WHICH real attempt this run is (BR-SOURCE-14B.0J § 5). Must equal the durable ledger's next attempt
   * number exactly — `2` today.
   *
   * Declared and never defaulted. A run that omits it is refused: the number is how the durable ledger
   * tells a legitimate second attempt from a third one, and a default would answer the question the gate
   * exists to ask.
   */
  readonly requestedRealAttemptNumber: unknown;
  /**
   * The § 7 national-input completeness result for the declared period.
   *
   * A RESULT OBJECT from `evaluateBrazilReceitaNationalInputCompleteness`, never a boolean: a boolean
   * would let a caller assert completeness, and the whole point of the gate is that completeness must be
   * derived from a declared inventory instead of claimed. The verdict must be `complete` and the scope
   * `full_national` for any attempt beyond the first.
   */
  readonly nationalInputCompleteness: unknown;
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
  'requestedRealAttemptNumber',
  'nationalInputCompleteness',
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
  // BR-SOURCE-14B.0J § 5–§ 7. Every one of these fires before the manifest is opened.
  'real_attempt_number_invalid',
  'real_attempt_number_already_consumed',
  'real_attempt_number_not_next',
  'real_benchmark_attempt_limit_reached',
  'dataset_period_not_authorized_for_attempt',
  'national_input_not_complete',
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
 *   2. `declarations`              — explicit statements, none inferred from another.
 *   3. `real_attempt_eligibility`  — BR-SOURCE-14B.0J § 5, § 6: the durable attempt number. Placed
 *                                    THIRD, immediately after the declarations that carry it, so a
 *                                    third attempt is refused as early as the data allows — long
 *                                    before caps, channels or a manifest are considered.
 *   4. `national_input_completeness` — § 7: the input must be the national collection, not the
 *                                    calibration subset attempt #1 used. Read-only and row-free.
 *   5. `resource_caps`             — § 5 of 14B.0C: caps validated before the first real access.
 *   6. `handle_caps`               — § 3's two new caps, validated together.
 *   7. `no_write_contract`         — the 11A guard, on the whole configuration.
 *   8. `zero_output`               — `maxOutputRows` must be exactly zero.
 *   9. `private_metric_channel`    — resolved, so a run does not finish and then discover it has
 *                                    nowhere to put the figures it spent six hours collecting.
 *  10. `single_attempt`            — the PER-PROCESS single-flight token, consumed only once the run
 *                                    is otherwise well-formed, so a typo does not burn it. It is not
 *                                    the durable record; stage 3 owns that.
 *  11. `authorization`             — LAST, and the one that actually stops every run today.
 *
 * ── Why the durable gate is NOT where the in-process ledger is (§ 11) ────────────
 * § 11 requires that a run aborting BEFORE the real-data boundary leave the durable consumed count
 * untouched. The in-process ledger at stage 10 is consumed before the authorization refusal at stage 11,
 * and that is deliberately left alone: it is a single-flight token scoped to one process, it dies with
 * the process, and it was never the historical record. The DURABLE count moves only at
 * `commitCrossing()`, which BR-SOURCE-ATTEMPT2-FINAL § 7 moved further still — past stage 11, past the
 * manifest bridge, past the engine call, and onto the first `read` of a source file. Every stage in this
 * list, and every pre-read validation the engine performs after them, spends nothing.
 */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES = [
  'operator_working_directory',
  'declarations',
  'real_attempt_eligibility',
  'national_input_completeness',
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
   * The PROCESS-SCOPED operator grant for THIS invocation (BR-SOURCE-ATTEMPT2-OPS § 2, § 13).
   *
   * Optional, and absent means the frozen all-`false` default: a caller that supplies nothing is
   * refused at the `authorization` stage exactly as every caller was before this field existed. It is a
   * SECOND, independent way for the authorization to arrive — never a replacement for
   * `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`, which is untouched and still `false`, and
   * never a way to change it.
   *
   * It is a request FIELD rather than a module constant on purpose: a value that arrives with the call
   * dies with the call. There is nowhere for it to be written, so the next invocation starts from the
   * default and an authorization cannot outlive the run it was granted for.
   */
  readonly operatorAuthorization?: BrazilReceitaAttempt2OperatorAuthorization;
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
  /**
   * The durable attempt accounting AFTER this refusal (BR-SOURCE-14B.0J § 5, § 11).
   *
   * Reported on every refusal because "the run was refused" and "the attempt was not spent" are two
   * different claims, and an operator with one structurally supported attempt left needs the second one
   * stated rather than inferred. `realDataBoundaryCrossed` is `false` on this type by construction: a
   * refusal is, definitionally, a stop before the boundary.
   */
  readonly realDataBoundaryCrossed: false;
  readonly attemptsConsumedAfterRefusal: number;
  /** The durable ledger's verdict on the requested attempt number, when that is why the run stopped. */
  readonly attemptRejectionCode: BrazilReceitaRealBenchmarkAttemptRejectionCode | null;
  /**
   * Which of the three process-scoped approvals this invocation did not carry
   * (BR-SOURCE-ATTEMPT2-OPS § 4, § 14).
   *
   * Reported on every refusal, so an operator preparing attempt #2 learns which flag is missing rather
   * than only that the run was "not authorized". Empty when the grant was complete — including on
   * refusals that happened for some other reason entirely.
   */
  readonly missingOperatorApprovals: readonly BrazilReceitaAttempt2OperatorApprovalKey[];
}

export interface BrazilReceitaRealFullScanCompletion {
  readonly ok: true;
  readonly mode: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_MODE;
  readonly publicReport: BrazilReceitaRealFullScanPublicReport;
  readonly sinkTally: BrazilReceitaFullJoinNullSinkTally;
  readonly privateArtifactWritten: boolean;
  readonly privateArtifactFailure: BrazilReceitaFullJoinPrivateWriteFailure | null;
  readonly cleanupVerified: boolean;
  /**
   * The § 11 attempt accounting for a run that reached the engine.
   *
   * A BOOLEAN, and it used to be the literal `true` (BR-SOURCE-ATTEMPT2-FINAL § 7). "The engine ran" and
   * "a real source row was read" were treated as the same fact, and they are not: the engine performs
   * several pre-read validations of its own, and a run that fails one of them returns here having read
   * zero bytes. Typing this `true` made that run indistinguishable from a six-hour traversal, and forced
   * a cast at the construction site that hid the difference.
   *
   * `attemptsConsumedAfterRun` follows the same distinction, because it is read off the same ledger: it
   * is the durable count that must be edited to only when the boundary was actually crossed, and the
   * unchanged count otherwise.
   */
  readonly realDataBoundaryCrossed: boolean;
  readonly realAttemptNumber: number;
  readonly attemptsConsumedAfterRun: number;
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
  // A positive integer only. The VALUE is judged by the durable ledger at the
  // `real_attempt_eligibility` stage — this check establishes only that the operator stated one, so a
  // missing number is reported as a missing declaration rather than as an attempt-number rejection.
  if (
    typeof declarations.requestedRealAttemptNumber !== 'number' ||
    !Number.isInteger(declarations.requestedRealAttemptNumber) ||
    declarations.requestedRealAttemptNumber < 1
  ) {
    missing.push('requestedRealAttemptNumber');
  }
  // Shape only, and never the verdict: a completeness result whose verdict is `incomplete` is a
  // PRESENT declaration that the `national_input_completeness` stage then refuses. Folding the verdict
  // in here would report a diagnosed subset as a paperwork error.
  if (
    !isRecord(declarations.nationalInputCompleteness) ||
    typeof declarations.nationalInputCompleteness.verdict !== 'string' ||
    typeof declarations.nationalInputCompleteness.inputScope !== 'string'
  ) {
    missing.push('nationalInputCompleteness');
  }
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
    attemptRejectionCode?: BrazilReceitaRealBenchmarkAttemptRejectionCode | null;
    missingOperatorApprovals?: readonly BrazilReceitaAttempt2OperatorApprovalKey[];
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
    // A refusal never crosses the boundary, so the durable count is whatever it already was. Read from
    // the ledger rather than restated as a literal: a hardcoded `1` here would silently become wrong the
    // day the durable record moves.
    realDataBoundaryCrossed: false,
    attemptsConsumedAfterRefusal: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
    attemptRejectionCode: details.attemptRejectionCode ?? null,
    missingOperatorApprovals: details.missingOperatorApprovals ?? [],
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
  // 0 — The PROCESS-SCOPED operator grant, read once from the request and never from ambient state.
  //
  // Resolved before anything else so that EVERY refusal below can name the approvals this invocation was
  // missing. It grants nothing on its own: the value is consumed at the `authorization` stage, and an
  // absent field resolves to the frozen all-`false` default.
  const operatorAuthorization =
    request.operatorAuthorization ?? BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT;
  const missingOperatorApprovals =
    findBrazilReceitaAttempt2MissingOperatorApprovals(operatorAuthorization);
  const stop = (
    abortCode: BrazilReceitaRealFullScanAbortCode,
    failedStage: BrazilReceitaRealFullScanPreflightStage,
    details: Parameters<typeof refuse>[2] = {},
  ): BrazilReceitaRealFullScanRefusal =>
    refuse(abortCode, failedStage, { ...details, missingOperatorApprovals });

  // 1 — Working directory. First, because an unsafe cwd is the one hazard that can damage something
  // outside this run, and it must be caught before any other work happens.
  const cwdViolations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory(
    request.workingDirectory,
  );
  if (cwdViolations.length > 0) {
    return stop('unsafe_operator_working_directory', 'operator_working_directory', {
      cwdViolations,
    });
  }

  // 2 — Declarations. Nothing below may be inferred from anything here.
  const missingDeclarations = findBrazilReceitaRealFullScanMissingDeclarations(request.declarations);
  if (missingDeclarations.length > 0) {
    return stop('declaration_missing', 'declarations', { missingDeclarations });
  }
  const declarations = request.declarations;

  // 3 — REAL ATTEMPT ELIGIBILITY (BR-SOURCE-14B.0J § 5, § 6). The durable attempt number, judged
  // against the durable consumed count. A third attempt dies here — before caps are parsed, before the
  // private channel is resolved, and a long way before a manifest could be opened.
  const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(
    declarations.requestedRealAttemptNumber,
  );
  if (!eligibility.eligible) {
    // The ledger's rejection code IS the abort code. They are deliberately the same strings: a second
    // vocabulary here would mean a future reader has to maintain a mapping, and a stale mapping is how
    // `real_benchmark_attempt_limit_reached` would quietly become something softer.
    return stop(
      eligibility.rejectionCode as BrazilReceitaRealFullScanAbortCode,
      'real_attempt_eligibility',
      { attemptRejectionCode: eligibility.rejectionCode },
    );
  }

  // 4 — NATIONAL INPUT COMPLETENESS (§ 7, § 8). Attempt #1 traversed a staged subset; a second attempt
  // over the same subset would spend the last supported attempt to re-answer a question that is already
  // answered. Row-free: the result was computed from manifest metadata by a module with no `node:fs`.
  //
  // The period is checked HERE, against the attempt-specific requirement, rather than in the
  // declarations: `datasetPeriod` being a well-formed `YYYY-MM` is a shape question, and being the
  // period this ATTEMPT was approved for is a policy question.
  if (declarations.datasetPeriod !== BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD) {
    return stop('dataset_period_not_authorized_for_attempt', 'national_input_completeness');
  }
  if (
    !brazilReceitaNationalInputSatisfiesAttempt2(
      declarations.nationalInputCompleteness as BrazilReceitaNationalInputCompletenessResult,
    )
  ) {
    return stop('national_input_not_complete', 'national_input_completeness');
  }

  // 5 — Resource caps.
  const capResolution = resolveBrazilReceitaFullJoinResourceCaps(
    declarations.resourceCaps as Readonly<Partial<Record<BrazilReceitaFullJoinResourceCapKey, unknown>>>,
  );
  if (!capResolution.ok) {
    return stop('resource_caps_incomplete', 'resource_caps', {
      capRejections: capResolution.rejections,
    });
  }

  // 6 — Handle caps, validated together with the global one they must fit inside.
  const handleCaps = resolveBrazilReceitaFullJoinHandleCaps(
    capResolution.caps.maxFilesOpened,
    declarations.maxOpenPartitionFiles,
  );
  if (!handleCaps.ok) return stop('handle_caps_invalid', 'handle_caps');

  // 7 — The 11A no-write contract, over the whole configuration.
  const guardResult = assertBrazilReceitaFullJoinNoWrite(declarations.noWriteContract);
  if (!guardResult.ok) return stop('no_write_guard_failed', 'no_write_contract');

  // 8 — Zero output. An equality, not a ceiling.
  if (capResolution.caps.maxOutputRows !== 0) {
    return stop('output_rows_cap_must_be_zero', 'zero_output');
  }

  // 9 — The private channel, resolved BEFORE the run rather than after. A six-hour benchmark that
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
    return stop('private_metric_channel_not_ready', 'private_metric_channel', {
      privateChannelRejections: privateChannel.rejections,
    });
  }

  // 10 — The single attempt, consumed only now that the run is otherwise well-formed.
  if (!request.attemptLedger.consume()) {
    return stop('single_attempt_already_consumed', 'single_attempt');
  }

  // 11 — AUTHORIZATION. The last thing checked before the manifest would be opened.
  //
  // TWO independent ways for an authorization to exist, and the run needs exactly one of them:
  //
  //   - `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`, the tracked constant. Still `false`, still
  //     14B.0C's, still the only one in the connector, and untouched by this milestone.
  //   - a COMPLETE process-scoped operator grant on the request (BR-SOURCE-ATTEMPT2-OPS § 2, § 4). All
  //     three approvals, each set only by its own explicit flag on this one invocation.
  //
  // An OR between them rather than an AND, because they are alternatives and not halves: the constant
  // says "this repository authorizes real benchmarks", the grant says "this operator authorized THIS
  // run". Requiring both would mean the source edit is still mandatory, which is the hard stop this
  // milestone exists to remove; requiring neither is what fail-open looks like.
  //
  // Inside the grant the composition is an AND, and the declarations at stage 2 already required the
  // same three approvals as literal `true`. That duplication is deliberate: stage 2 checks that the
  // operator STATED three approvals, this checks that the invocation CARRIED them, and a future caller
  // that hand-built declarations without a grant is refused here.
  const processScopedAuthorization =
    brazilReceitaAttempt2OperatorAuthorizationGranted(operatorAuthorization);
  if (!BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED && !processScopedAuthorization) {
    return stop('benchmark_not_authorized', 'authorization');
  }

  // ── Beyond this line a real file may be opened. Nothing above has opened one. ──

  const bridge = await resolveBrazilReceitaFullJoinManifestSources({
    manifestPath: declarations.manifestPath as string,
    fileSystem: request.bridgeFileSystem,
    validateManifest: request.validateManifest,
    allowRealLocalFiles: true,
  });
  if (!bridge.ok) {
    return stop('manifest_resolution_failed', 'authorization', {
      bridgeFindings: bridge.findings,
    });
  }

  const openHandleLedger: BrazilReceitaFullJoinOpenHandleLedger =
    createBrazilReceitaFullJoinOpenHandleLedger(handleCaps.maxFilesOpened);
  const sink = createBrazilReceitaFullJoinNullBenchmarkSink();

  // ── THE REAL-DATA ATTEMPT BOUNDARY (BR-SOURCE-14B.0J § 11, BR-SOURCE-ATTEMPT2-FINAL § 7–§ 10) ──
  //
  // Crossing this line is what SPENDS the attempt, and where the line falls is the whole question.
  //
  // Not at the manifest bridge: § 9 classes manifest metadata as permitted and § 5's marker is
  // `ABORT_BEFORE_REAL_SOURCE_ROW_OPEN`, so a manifest that fails validation has cost the operator a
  // read of their own control document and nothing else. Committing before the bridge would bill a
  // six-hour attempt for a typo in a JSON path.
  //
  // Not after the engine returns: that is the failure mode § 11 exists to forbid. A run that breaches
  // `maxRuntimeMs` at one per cent of the join has spent attempt #2 exactly as completely as a clean
  // traversal would — the cost was the hours and the data access, not the verdict.
  //
  // And — this is what BR-SOURCE-ATTEMPT2-FINAL corrects — not at the engine CALL either, which is where
  // it used to be. The engine runs its own pre-read validations (caps, descriptors, duplicate policy,
  // resource arming, the temporary-storage wall) and every one of them returns `before_first_read`. A
  // commit placed before the call recorded a crossing for runs that read zero bytes: attempt #2's third
  // authorization died exactly that way, at `temporary_storage_policy_not_approved`, with the ledger
  // already saying it had crossed.
  //
  // So the commit hangs on the reader PORT instead, firing once immediately before the first `read` —
  // the first access to source CONTENT, and the only event that costs anything. Every abort above it,
  // inside the engine or not, leaves the attempt unspent; everything after it spends the attempt whatever
  // the verdict turns out to be.
  const boundaryLedger = createBrazilReceitaRealBenchmarkAttemptBoundaryLedger(
    eligibility.attemptNumber as number,
  );
  const boundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(request.readerFileSystem, () => {
    boundaryLedger.commitCrossing();
  });

  const engineResult = await runBrazilReceitaFullJoinStreamingEngineOnce({
    sources: bridge.joinSources,
    readerCaps: declarations.readerCaps as Readonly<Record<string, unknown>>,
    partitioningCaps: declarations.partitioningCaps as Readonly<Record<string, unknown>>,
    resourceCaps: capResolution.caps,
    duplicateKeyPolicy: 'pair_with_every_duplicate',
    sink,
    readerFileSystem: boundary.fileSystem,
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
    realDataRun: true,
    // The engine's temporary-storage check is a SECOND, INDEPENDENT wall, and it stays one
    // (BR-SOURCE-ATTEMPT2-FINAL § 4). What changes is that it can now be satisfied by the same
    // invocation-scoped decision the operator actually made, instead of only by a tracked constant
    // nobody may flip. The approval is minted HERE, from the grant this call carried, and it is minted
    // fresh: it is not stored, not reused, and a `null` — which is what an incomplete grant yields — is
    // forwarded as-is, so the wall refuses exactly as before.
    invocationTemporaryStorageApproval:
      mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(operatorAuthorization),
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
    // Read back from the boundary ledger rather than restated: the accounting a report carries and the
    // accounting the code performed are then the same object, and cannot drift. No cast — the ledger's
    // answer is now allowed to be `false`, which is the only way a pre-read engine abort can report
    // itself honestly.
    realDataBoundaryCrossed: boundaryLedger.boundaryState() === 'crossed_real_data_boundary',
    realAttemptNumber: eligibility.attemptNumber as number,
    attemptsConsumedAfterRun: boundaryLedger.resultingAttemptsConsumed(),
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
  /**
   * The BR-SOURCE-14B.0J attempt model and input gate, so `--readiness` answers the second-attempt
   * question without an operator having to read source.
   *
   * `secondRealBenchmarkControlReady` and `secondRealBenchmarkAuthorized` are separate fields on purpose:
   * the controls being finished is what this milestone delivers, and it is not permission.
   */
  readonly attemptModel: BrazilReceitaRealBenchmarkAttemptModelSummary;
  readonly nationalInputGate: BrazilReceitaNationalInputGateStanding;
  readonly secondRealBenchmarkControlReady: true;
  readonly secondRealBenchmarkAuthorized: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED;
  /**
   * How a process-scoped grant is expressed, and what it defaults to (BR-SOURCE-ATTEMPT2-OPS § 24).
   *
   * Reported next to `secondRealBenchmarkAuthorized: false` on purpose. The mechanism being ready and
   * nothing being approved are both true, and an operator reading `--readiness` needs the flag names to
   * prepare an invocation without reading source — while still being told, in the field above, that no
   * authorization exists.
   */
  readonly operatorAuthorization: BrazilReceitaAttempt2OperatorAuthorizationStanding;
}

export function summarizeBrazilReceitaRealFullScanReadiness(): BrazilReceitaRealFullScanReadiness {
  return {
    fullScanEngineReady: true,
    fullScanExecutionPathReady: true,
    benchmarkProfileImplementable: true,
    attemptModel: summarizeBrazilReceitaRealBenchmarkAttemptModel(),
    nationalInputGate: summarizeBrazilReceitaNationalInputGate(),
    // The CONTROLS are ready. Authorization is the next field and it is `false`.
    secondRealBenchmarkControlReady: true,
    secondRealBenchmarkAuthorized: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
    operatorAuthorization: summarizeBrazilReceitaAttempt2OperatorAuthorization(),
    // Ready to be AUTHORIZED — every control exists and the path is wired end to end. Not authorized:
    // those are different facts, and this milestone changes only the first.
    realFullScanBenchmarkReadyForOwnerAuthorization: true,
    realFullScanBenchmarkAuthorized: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
    realFullScanBenchmarkExecuted: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
    gate2ReadyForOwnerReview: false,
    nextAction: 'merge_review',
  };
}
