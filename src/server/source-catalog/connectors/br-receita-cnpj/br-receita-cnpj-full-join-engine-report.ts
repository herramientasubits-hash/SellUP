/**
 * BR Receita CNPJ — STREAMING FULL-JOIN ENGINE REPORTS (BR-SOURCE-14B.0D § 12).
 *
 * The two-channel split, applied to the engine's own figures. It lives in its own module because the
 * distinction it encodes is easy to erode by accident in the middle of an orchestration loop, and
 * because keeping it PURE means the whole projection is testable without running a join.
 *
 *   EXACT   (`BrazilReceitaFullJoinEngineExactObservations`) — private-operator channel input ONLY.
 *   PUBLIC  (`BrazilReceitaFullJoinEnginePublicReport`)      — buckets, closed enums, held-absence
 *                                                              assertions. Passes the full-join
 *                                                              output sanitizer unchanged.
 *
 * ── Why the public report has no exact magnitude at all ─────────────────────────
 * The sanitizer rejects any numeric leaf at or beyond eight digits as `oversized_numeric_value`, and
 * that rule is what stops a 14-digit CNPJ from reaching a report as a number. A byte offset is
 * numerically indistinguishable from an identifier, so the public report carries NO byte figure —
 * not a bucketed one derived from an exact field it also prints, and not an "unavoidable" exception.
 * Exact figures travel `exact` to 14B.0C's private channel, which refuses to persist without an
 * explicit operator declaration. This module is the only place that projects one into the other, and
 * the projection is one-way: it reads exact figures and returns buckets, and there is no inverse.
 *
 * ── The field names are chosen against the sanitizer's key rules ────────────────
 * `in_memory_key_window_*` rather than `join_keys_*`, `company_without_establishment_*` rather than
 * anything `joined_row`-shaped, and every held-absence assertion (`join_keys_printed: false`) stays a
 * literal `false` so it carries nothing. A reviewer scanning a report cannot tell a COUNT called
 * `join_keys_*` from a PAYLOAD called `join_keys_*`, which is exactly why the sanitizer refuses the
 * whole shape and why this module does not fight it.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - performs I/O, reads an environment variable, or writes to stdout or stderr. It is pure.
 *   - emits a path, a file name, a row, a cell, a join key, a CNPJ or a hash of one.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 */

import {
  emptyBrazilReceitaFullJoinArtifactCounts,
  emptyBrazilReceitaFullJoinCleanupErrorCounts,
  type BrazilReceitaFullJoinCleanupReport,
} from './br-receita-cnpj-full-join-cleanup';
import {
  BRAZIL_RECEITA_FULL_JOIN_ENGINE_ARCHITECTURE,
  BRAZIL_RECEITA_FULL_JOIN_ENGINE_REJECTED_ARCHITECTURES,
  BRAZIL_RECEITA_FULL_JOIN_ENGINE_VERSION,
  type BrazilReceitaFullJoinDuplicateKeyPolicy,
  type BrazilReceitaFullJoinEngineAbortCode,
  type BrazilReceitaFullJoinEngineAbortStage,
  type BrazilReceitaFullJoinEngineExitStatus,
} from './br-receita-cnpj-full-join-engine-contract';
import {
  toBrazilReceitaFullJoinCountBucket,
  toBrazilReceitaFullJoinPublicSanitizedMeasurements,
  type BrazilReceitaFullJoinCountBucket,
  type BrazilReceitaFullJoinPublicSanitizedMeasurements,
} from './br-receita-cnpj-full-join-operator-metric-channel';
import type { BrazilReceitaFullJoinWorkspaceCleanupOutcome } from './br-receita-cnpj-full-join-partition-workspace';
import {
  BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION,
  type BrazilReceitaFullJoinResourceExactObservations,
} from './br-receita-cnpj-full-join-resource-envelope';

// ─── Exact observations ───────────────────────────────────────────────────────

/** EXACT engine figures. Private-channel input only — never a public report. */
export interface BrazilReceitaFullJoinEngineExactObservations {
  readonly resource: BrazilReceitaFullJoinResourceExactObservations;
  readonly empresaRowsTraversed: number;
  readonly estabelecimentoRowsTraversed: number;
  readonly referencesPersisted: number;
  readonly matchesEmitted: number;
  readonly orphanEstabelecimentoCount: number;
  readonly empresaKeysWithoutEstabelecimento: number;
  readonly invalidKeyCount: number;
  readonly malformedRowCount: number;
  readonly duplicateEmpresaKeyCount: number;
  readonly partitionsCreated: number;
  readonly largestPartitionReferenceCount: number;
  readonly peakKeyWindowSize: number;
  readonly temporaryStorageBytesWritten: number;
  readonly partitionDepthReached: number;
  readonly filesTraversedToEndOfFile: number;
  readonly sourceFilesDeclared: number;
  /**
   * The high-water mark of SIMULTANEOUSLY-open descriptors, across every category
   * (BR-SOURCE-14B.0F § 3, § 9). This is the figure that answers "did the run need an extraordinary
   * `ulimit`?" — the cumulative `resource.filesOpened` count cannot, because it never falls.
   */
  readonly filesOpenedPeak: number;
  /** The partition pool's own high-water mark. Bounded by `maxOpenPartitionFiles` by construction. */
  readonly partitionHandlePeakOpen: number;
  /** How many times the pool closed a handle to make room. Evidence the bound is doing work. */
  readonly partitionHandleEvictions: number;
}

/**
 * The observations of a run that never armed its enforcer.
 *
 * Every magnitude is `null` or zero rather than absent, so a refusal reports the same SHAPE as a
 * completed run. A report whose fields disappear on the refusal path is a report a consumer has to
 * special-case, and special-casing is where a refusal quietly starts reading as a success.
 */
export function emptyBrazilReceitaFullJoinResourceObservations(): BrazilReceitaFullJoinResourceExactObservations {
  return {
    envelope_version: BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION,
    peakRssBytes: null,
    peakHeapUsedBytes: null,
    peakExternalMemoryBytes: null,
    totalDurationMs: null,
    phaseDurationsMs: {
      preflight: null,
      manifest_validation: null,
      empresas_read: null,
      estabelecimentos_read: null,
      cleanup: null,
      sanitization: null,
    },
    bytesRead: 0,
    rowsRead: 0,
    filesOpened: 0,
    outputRowsMaterialized: 0,
    joinKeysPeakInMemory: 0,
    temporaryStoragePeakBytes: 0,
    checkpointsEvaluated: [],
    cleanupOutcome: null,
  };
}

// ─── Public report ────────────────────────────────────────────────────────────

/** The PUBLIC report. Buckets and closed enums; no exact magnitude, no path, no value. */
export interface BrazilReceitaFullJoinEnginePublicReport {
  readonly engine_version: typeof BRAZIL_RECEITA_FULL_JOIN_ENGINE_VERSION;
  readonly architecture: typeof BRAZIL_RECEITA_FULL_JOIN_ENGINE_ARCHITECTURE;
  readonly rejected_architectures: readonly string[];
  readonly full_join_model: 'model_a_fully_bounded_streaming';
  readonly exit_status: BrazilReceitaFullJoinEngineExitStatus;
  readonly abort_code: BrazilReceitaFullJoinEngineAbortCode | 'none';
  readonly abort_stage: BrazilReceitaFullJoinEngineAbortStage | 'none';
  readonly every_source_traversed_to_end_of_file: boolean;
  readonly dataset_materialized: false;
  readonly resource_measurements: BrazilReceitaFullJoinPublicSanitizedMeasurements;
  readonly partition_count_bucket: BrazilReceitaFullJoinCountBucket;
  readonly largest_partition_reference_count_bucket: BrazilReceitaFullJoinCountBucket;
  readonly in_memory_key_window_peak_bucket: BrazilReceitaFullJoinCountBucket;
  /** § 10's `filesOpenedPeakBucket`. Bucketed like every other magnitude; never the exact count. */
  readonly files_opened_peak_bucket: BrazilReceitaFullJoinCountBucket;
  readonly partition_handle_peak_open_bucket: BrazilReceitaFullJoinCountBucket;
  readonly partition_depth_reached: number;
  readonly match_count_bucket: BrazilReceitaFullJoinCountBucket;
  readonly orphan_establishment_count_bucket: BrazilReceitaFullJoinCountBucket;
  readonly company_without_establishment_count_bucket: BrazilReceitaFullJoinCountBucket;
  readonly invalid_key_count_bucket: BrazilReceitaFullJoinCountBucket;
  readonly malformed_row_count_bucket: BrazilReceitaFullJoinCountBucket;
  readonly duplicate_company_key_count_bucket: BrazilReceitaFullJoinCountBucket;
  readonly duplicate_key_policy: BrazilReceitaFullJoinDuplicateKeyPolicy | 'not_declared';
  readonly cleanup: BrazilReceitaFullJoinCleanupReport;
  readonly cleanup_outcome: BrazilReceitaFullJoinWorkspaceCleanupOutcome | 'not_recorded';
  readonly cleanup_verified_absent: boolean;
  readonly temporary_storage_policy_approved: false;
  readonly zero_output_rows_enforced: true;
  readonly rows_emitted: 0;
  readonly retries_performed: typeof BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT;
  readonly join_keys_printed: false;
  readonly raw_rows_printed: false;
  readonly exact_values_printed: false;
  readonly absolute_paths_printed: false;
  readonly file_names_printed: false;
}

export interface BrazilReceitaFullJoinEngineReportInput {
  readonly exact: BrazilReceitaFullJoinEngineExactObservations;
  readonly abortCode: BrazilReceitaFullJoinEngineAbortCode | null;
  readonly abortStage: BrazilReceitaFullJoinEngineAbortStage | null;
  readonly duplicateKeyPolicy: BrazilReceitaFullJoinDuplicateKeyPolicy | 'not_declared';
  readonly workspaceCreated: boolean;
  readonly cleanupOutcome: BrazilReceitaFullJoinWorkspaceCleanupOutcome | null;
  readonly cleanupVerifiedAbsent: boolean;
  readonly filesReleased: number;
}

/**
 * Builds the cleanup block in the 11A report SHAPE with the outcome that actually happened.
 *
 * `planBrazilReceitaFullJoinCleanup` is deliberately not called: it is a PURE PLANNER written when no
 * deletion engine was authorized, so it reports `not_executed` for every required cleanup and cannot
 * express `completed`. This engine IS the deletion engine, so reusing its report type while
 * computing the status honestly is the only combination that neither lies nor invents a new shape.
 *
 * `unverified` maps to `failed` with `artifact_release_failed`, because the 11A vocabulary has no
 * `unverified` member. The precise outcome survives in `cleanup_outcome` alongside it — collapsing
 * the two would lose the distinction 14B.0C draws between "could not finish" and "cannot be proven
 * finished".
 */
function buildCleanupBlock(input: BrazilReceitaFullJoinEngineReportInput): BrazilReceitaFullJoinCleanupReport {
  const artifactCounts = emptyBrazilReceitaFullJoinArtifactCounts();
  artifactCounts.temporary_spill_file = input.filesReleased;
  artifactCounts.temporary_scratch_directory = input.workspaceCreated ? 1 : 0;

  const errorCounts = emptyBrazilReceitaFullJoinCleanupErrorCounts();
  if (input.cleanupOutcome === 'failed' || input.cleanupOutcome === 'unverified') {
    errorCounts.artifact_release_failed = 1;
  }

  const status: BrazilReceitaFullJoinCleanupReport['cleanup_status'] =
    input.cleanupOutcome === 'completed'
      ? 'completed'
      : input.cleanupOutcome === 'not_needed'
        ? 'not_needed'
        : input.cleanupOutcome === null
          ? input.workspaceCreated
            ? 'not_executed'
            : 'not_needed'
          : 'failed';

  return {
    cleanup_required: input.workspaceCreated,
    cleanup_status: status,
    unsafe_artifacts_detected: false,
    artifact_counts_by_type: artifactCounts,
    cleanup_error_counts_by_code: errorCounts,
  };
}

/**
 * Projects one run into its public report. PURE, and the ONLY place the projection happens.
 *
 * `every_source_traversed_to_end_of_file` is computed rather than asserted: it is true only when the
 * number of files that reached EOF equals the number declared. A run that read a prefix of each file
 * and joined it would otherwise look identical to a complete one, which is precisely the failure this
 * milestone exists to make impossible.
 */
export function buildBrazilReceitaFullJoinEnginePublicReport(
  input: BrazilReceitaFullJoinEngineReportInput,
): BrazilReceitaFullJoinEnginePublicReport {
  const { exact } = input;
  return {
    engine_version: BRAZIL_RECEITA_FULL_JOIN_ENGINE_VERSION,
    architecture: BRAZIL_RECEITA_FULL_JOIN_ENGINE_ARCHITECTURE,
    rejected_architectures: [...BRAZIL_RECEITA_FULL_JOIN_ENGINE_REJECTED_ARCHITECTURES],
    full_join_model: 'model_a_fully_bounded_streaming',
    exit_status: input.abortCode === null ? 'completed' : 'aborted',
    abort_code: input.abortCode ?? 'none',
    abort_stage: input.abortStage ?? 'none',
    every_source_traversed_to_end_of_file:
      exact.sourceFilesDeclared > 0 &&
      exact.filesTraversedToEndOfFile === exact.sourceFilesDeclared,
    dataset_materialized: false,
    resource_measurements: toBrazilReceitaFullJoinPublicSanitizedMeasurements(exact.resource),
    partition_count_bucket: toBrazilReceitaFullJoinCountBucket(exact.partitionsCreated),
    largest_partition_reference_count_bucket: toBrazilReceitaFullJoinCountBucket(
      exact.largestPartitionReferenceCount,
    ),
    in_memory_key_window_peak_bucket: toBrazilReceitaFullJoinCountBucket(exact.peakKeyWindowSize),
    files_opened_peak_bucket: toBrazilReceitaFullJoinCountBucket(exact.filesOpenedPeak),
    partition_handle_peak_open_bucket: toBrazilReceitaFullJoinCountBucket(
      exact.partitionHandlePeakOpen,
    ),
    partition_depth_reached: exact.partitionDepthReached,
    match_count_bucket: toBrazilReceitaFullJoinCountBucket(exact.matchesEmitted),
    orphan_establishment_count_bucket: toBrazilReceitaFullJoinCountBucket(
      exact.orphanEstabelecimentoCount,
    ),
    company_without_establishment_count_bucket: toBrazilReceitaFullJoinCountBucket(
      exact.empresaKeysWithoutEstabelecimento,
    ),
    invalid_key_count_bucket: toBrazilReceitaFullJoinCountBucket(exact.invalidKeyCount),
    malformed_row_count_bucket: toBrazilReceitaFullJoinCountBucket(exact.malformedRowCount),
    duplicate_company_key_count_bucket: toBrazilReceitaFullJoinCountBucket(
      exact.duplicateEmpresaKeyCount,
    ),
    duplicate_key_policy: input.duplicateKeyPolicy,
    cleanup: buildCleanupBlock(input),
    cleanup_outcome: input.cleanupOutcome ?? 'not_recorded',
    cleanup_verified_absent: input.cleanupVerifiedAbsent,
    temporary_storage_policy_approved: false,
    zero_output_rows_enforced: true,
    rows_emitted: 0,
    retries_performed: BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
    join_keys_printed: false,
    raw_rows_printed: false,
    exact_values_printed: false,
    absolute_paths_printed: false,
    file_names_printed: false,
  };
}
