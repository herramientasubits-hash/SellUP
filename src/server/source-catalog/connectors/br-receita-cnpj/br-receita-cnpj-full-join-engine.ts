/**
 * BR Receita CNPJ — STREAMING FULL-JOIN ENGINE (BR-SOURCE-14B.0D).
 *
 * The first executable route in this connector that can traverse Empresas and Estabelecimentos
 * COMPLETELY and join them, with a memory footprint that does not grow with the number of rows. It
 * is what turns the § 3 audit's `FULL_JOIN_MODEL = D` into `FULL_JOIN_MODEL = A`.
 *
 * ── Three passes, and why there are exactly three ───────────────────────────────
 *   1. Empresas → EOF. Each row's join key is parsed, hashed into a partition ordinal, and
 *      DISCARDED. What is persisted is an opaque reference: file ordinal, byte offset, byte length,
 *      family. Nothing else.
 *   2. Estabelecimentos → EOF. Identically.
 *   3. Per partition: load a BOUNDED window of Empresas keys (re-reading each row from its recorded
 *      offset), then stream that partition's Estabelecimentos references, re-read each row, compare
 *      keys in memory, hand matches to the sink, and CLEAR the window before the next partition.
 *
 * Peak memory is therefore: the reader's chunk buffer + one carry buffer + one row buffer + one
 * partition's key window. Every one of those is capped, and none of them is a function of file
 * length. That single sentence is the Model A claim, and it is the only claim this module makes.
 *
 * ── What "bounded" does NOT mean here ───────────────────────────────────────────
 * It does not mean the run is authorized. GATE-2 is not approved, the tracked
 * `BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED` is still `false` and nothing here
 * assigns it, the real full-scan benchmark remains unauthorized, and no import, runtime hop or
 * Agent 1 integration exists anywhere in this path. The engine is exercised against SYNTHETIC
 * fixtures only. An engine that exists and a run that is permitted are different facts, and this
 * module is careful never to let the first imply the second.
 *
 * BR-SOURCE-ATTEMPT2-FINAL § 3 gives a real run a SECOND way to hold the temporary-storage approval —
 * one minted from an operator grant, scoped to a single invocation. This module forwards that value to
 * the workspace and neither reads nor interprets it: the wall is still the workspace's, and a real run
 * carrying no approval at all still refuses with `temporary_storage_policy_not_approved`, before the
 * first read, having opened nothing.
 *
 * ── Repartition is not a retry ──────────────────────────────────────────────────
 * A repartition (§ 6.2) re-runs the two REFERENCE passes at a higher partition count when a
 * partition would exceed its cap. It is not a retry of a failed run: it happens BEFORE any match is
 * emitted, it is bounded by `maxPartitionDepth`, and it never widens a cap — it subdivides the work
 * under the same caps. 14B.0C's automatic retry count stays structurally zero, and a RESOURCE breach
 * is never repartitioned around: it stops the run.
 *
 * ── Where the resource envelope draws the line ──────────────────────────────────
 * Every coverage-shaped bound comes from 14B.0C's enforcer, which this module CALLS and never
 * reimplements: bytes, rows, files, in-memory keys, output rows, temporary storage, memory, runtime,
 * phase runtime.
 *
 * `maxFilesOpened` is now counted TWICE, by two different counters, and the difference matters
 * (BR-SOURCE-14B.0F § 3). 14B.0C's enforcer counts CUMULATIVE source opens over the run's lifetime.
 * The new open-handle ledger counts CONCURRENT descriptors across every category — source files,
 * partition files, the private metric artifact, control artifacts. 14B.0D bounded partition
 * descriptors only by `maxPartitionCount`, which at 1024 partitions meant thousands of them held at
 * once and made correctness depend on the operator's `ulimit -n`. It no longer does: partition
 * handles come from a bounded LRU pool, and every open in this path reserves from the ledger first.
 *
 * Periodic re-checks during a long pass use an EXPONENTIALLY WIDENING row interval (see
 * `periodicCheckpointDue`). A fixed interval would make the enforcer's checkpoint list grow linearly
 * with the row count — memory proportional to the dataset, in the module whose entire purpose is to
 * avoid that.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`. Both filesystem ports are parameters.
 *   - emits, retains, logs or reports a CNPJ, a CNPJ básico, a razão social, a raw row, a raw cell,
 *     a join key, or a hash of any of them. A join key exists inside one loop iteration and is gone.
 *   - reads Sócios, QSA, CPF, Simples, an email, a phone or an address. It reads ONE column of two
 *     families and counts the rest.
 *   - touches Supabase, a migration, `source_company_snapshots`, the runtime, Agent 1, Agent 2A, a
 *     provider, HubSpot or the UI.
 *   - spawns a process, reads an environment variable, or writes to stdout or stderr.
 *   - retries. A second `run()` on the same engine is refused.
 */

import {
  BRAZIL_RECEITA_FULL_JOIN_KEY_COLUMN_INDEX,
  brazilReceitaFullJoinPartitionOrdinalBounds,
  brazilReceitaFullJoinPartitionOrdinalFor,
  isBrazilReceitaFullJoinDuplicateKeyPolicy,
  normalizeBrazilReceitaFullJoinKey,
  resolveBrazilReceitaFullJoinPartitionOrdinalRange,
  resolveBrazilReceitaFullJoinPartitioningCaps,
  type BrazilReceitaFullJoinBoundedJoinedRecord,
  type BrazilReceitaFullJoinDuplicateKeyPolicy,
  type BrazilReceitaFullJoinEngineAbortCode,
  type BrazilReceitaFullJoinEngineAbortStage,
  type BrazilReceitaFullJoinEngineExitStatus,
  type BrazilReceitaFullJoinPartitionOrdinalBounds,
  type BrazilReceitaFullJoinPartitionOrdinalRange,
  type BrazilReceitaFullJoinPartitionOrdinalRangeRejection,
  type BrazilReceitaFullJoinPartitionSummary,
  type BrazilReceitaFullJoinPartitioningCaps,
  type BrazilReceitaFullJoinPartitioningCapRejection,
  type BrazilReceitaFullJoinSink,
  type BrazilReceitaFullJoinSourceFileDescriptor,
} from './br-receita-cnpj-full-join-engine-contract';
import {
  createBrazilReceitaFullJoinPeriodicCheckpointSchedule,
  emptyBrazilReceitaFullJoinEngineTallies,
  resetBrazilReceitaFullJoinPassTallies,
  validateBrazilReceitaFullJoinSourceDescriptors,
} from './br-receita-cnpj-full-join-engine-bookkeeping';
import {
  buildBrazilReceitaFullJoinEnginePublicReport,
  emptyBrazilReceitaFullJoinResourceObservations,
  type BrazilReceitaFullJoinEngineExactObservations,
  type BrazilReceitaFullJoinEnginePublicReport,
} from './br-receita-cnpj-full-join-engine-report';
import type { BrazilReceitaFullJoinFreeDiskProbe } from './br-receita-cnpj-full-join-free-disk';
import {
  withBrazilReceitaFullJoinLedgerAccounting,
  type BrazilReceitaFullJoinOpenHandleLedger,
} from './br-receita-cnpj-full-join-open-handle-ledger';
import {
  createBrazilReceitaFullJoinPartitionWorkspace,
  BRAZIL_RECEITA_FULL_JOIN_REFERENCE_READ_BATCH,
  BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES,
  type BrazilReceitaFullJoinRowReference,
  type BrazilReceitaFullJoinWorkspace,
  type BrazilReceitaFullJoinWorkspaceBoundaries,
  type BrazilReceitaFullJoinWorkspaceCleanupOutcome,
  type BrazilReceitaFullJoinWorkspaceFailure,
  type BrazilReceitaFullJoinWorkspaceFileSystem,
  type BrazilReceitaFullJoinWorkspaceRejection,
} from './br-receita-cnpj-full-join-partition-workspace';
import type { BrazilReceitaFullJoinInvocationTemporaryStorageApproval } from './br-receita-cnpj-full-join-temporary-storage-approval';
import {
  createBrazilReceitaFullJoinResourceEnforcer,
  resolveBrazilReceitaFullJoinResourceCaps,
  type BrazilReceitaFullJoinCapRejection,
  type BrazilReceitaFullJoinResourceBreach,
  type BrazilReceitaFullJoinResourceCapKey,
  type BrazilReceitaFullJoinResourceDependencies,
  type BrazilReceitaFullJoinResourceEnforcer,
} from './br-receita-cnpj-full-join-resource-envelope';
import {
  BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER,
  fetchBrazilReceitaFullJoinRowByReference,
  readBrazilReceitaFullJoinFieldAt,
  readBrazilReceitaFullJoinFileSequentially,
  resolveBrazilReceitaFullJoinReaderCaps,
  type BrazilReceitaFullJoinReaderCapKey,
  type BrazilReceitaFullJoinReaderCapRejection,
  type BrazilReceitaFullJoinReaderCaps,
  type BrazilReceitaFullJoinReaderFileSystem,
} from './br-receita-cnpj-full-join-streaming-reader';
import { getBrReceitaCnpjOfficialColumnCount } from './br-receita-cnpj-file-reader';

// ─── Request & result ─────────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinEngineRequest {
  readonly sources: readonly BrazilReceitaFullJoinSourceFileDescriptor[];
  readonly readerCaps: Readonly<Partial<Record<BrazilReceitaFullJoinReaderCapKey, unknown>>> | null;
  readonly partitioningCaps: Readonly<Record<string, unknown>> | null;
  readonly resourceCaps: Readonly<Partial<Record<BrazilReceitaFullJoinResourceCapKey, unknown>>> | null;
  readonly duplicateKeyPolicy: unknown;
  readonly sink: BrazilReceitaFullJoinSink;
  readonly readerFileSystem: BrazilReceitaFullJoinReaderFileSystem;
  readonly workspaceFileSystem: BrazilReceitaFullJoinWorkspaceFileSystem;
  readonly workspaceParentDirectory: string;
  readonly workspaceBoundaries: BrazilReceitaFullJoinWorkspaceBoundaries;
  readonly resourceDependencies: BrazilReceitaFullJoinResourceDependencies;
  /**
   * The GLOBAL concurrent descriptor ledger (BR-SOURCE-14B.0F § 3).
   *
   * Injected rather than created here so ONE instance covers source files, partition files, the
   * private metric artifact and any control artifact. A ledger the engine created for itself would
   * bound the engine and leave everything around it unaccounted, which is the state 14B.0E found.
   */
  readonly openHandleLedger: BrazilReceitaFullJoinOpenHandleLedger;
  /** The partition pool's own ceiling. Required; see the workspace module for why there is no default. */
  readonly maxOpenPartitionFiles: number;
  readonly minimumFreeDiskBeforeStart: number;
  readonly minimumFreeDiskReserve: number;
  readonly freeDiskProbe: BrazilReceitaFullJoinFreeDiskProbe;
  /** `true` for a real dataset run, which still needs a temporary-storage approval to proceed. */
  readonly realDataRun: boolean;
  /**
   * THIS invocation's temporary-storage approval, forwarded verbatim to the workspace
   * (BR-SOURCE-ATTEMPT2-FINAL § 3, § 4).
   *
   * The engine does not interpret it, cannot construct one, and does not become a second authority by
   * carrying it: the wall stays in the workspace, where the temporary storage actually gets created. What
   * the engine does is stop DROPPING the operator's approval on the floor — which is the whole of the
   * defect. Absent means no approval, and a real run without one refuses at `before_first_read` exactly
   * as it always did.
   */
  readonly invocationTemporaryStorageApproval?: BrazilReceitaFullJoinInvocationTemporaryStorageApproval | null;
  /**
   * Whether the sink MATERIALIZES a row (persists it, prints it, or keeps it). Required, not
   * optional: a caller must state it, and stating it is what makes `maxOutputRows` enforceable.
   *
   * With `maxOutputRows: 0` — the only value this milestone authorizes — declaring a materializing
   * sink aborts on the FIRST match. That is the mechanism by which "the benchmark emits zero rows"
   * is a control rather than a claim about the sink's implementation.
   */
  readonly sinkMaterializesRows: boolean;
  /**
   * OPTIONAL Stage-3 window (BR-RECEITA-CHUNKED-JOIN-RANGE). Both fields together or neither.
   *
   * Absent on both means the pre-existing behaviour, exactly: Stage 3 iterates every ordinal of the
   * map. Present means Stage 3 iterates `[start, min(start + count, partitionCount))` and does no
   * row re-read, no key-window load and no sink call for any ordinal outside it — the selection is at
   * the LOOP, not at the sink, because a sink-level filter would still pay for the whole join.
   *
   * Nothing else about the run changes. Both input families are still scanned to end of file and both
   * reference passes still run in full, because which rows land in ordinal 4 is not knowable without
   * reading the rows that might.
   *
   * Half-declared or malformed is REFUSED at `before_first_read`; see
   * `resolveBrazilReceitaFullJoinPartitionOrdinalRange`.
   */
  readonly partitionOrdinalStart?: number;
  readonly partitionOrdinalCount?: number;
}

export interface BrazilReceitaFullJoinEngineResult {
  readonly exitStatus: BrazilReceitaFullJoinEngineExitStatus;
  readonly abortCode: BrazilReceitaFullJoinEngineAbortCode | null;
  readonly abortStage: BrazilReceitaFullJoinEngineAbortStage | null;
  readonly resourceBreach: BrazilReceitaFullJoinResourceBreach | null;
  readonly readerCapRejections: readonly BrazilReceitaFullJoinReaderCapRejection[];
  readonly partitioningCapRejections: readonly BrazilReceitaFullJoinPartitioningCapRejection[];
  readonly partitionOrdinalRangeRejections: readonly BrazilReceitaFullJoinPartitionOrdinalRangeRejection[];
  readonly resourceCapRejections: readonly BrazilReceitaFullJoinCapRejection[];
  readonly workspaceRejections: readonly BrazilReceitaFullJoinWorkspaceRejection[];
  readonly exact: BrazilReceitaFullJoinEngineExactObservations;
  readonly publicReport: BrazilReceitaFullJoinEnginePublicReport;
  readonly partitionSummaries: readonly BrazilReceitaFullJoinPartitionSummary[];
  /**
   * The half-open ordinal window Stage 3 ACTUALLY iterated, or `null` when the run never reached
   * Stage 3 (BR-RECEITA-CHUNKED-JOIN-RANGE).
   *
   * Reported because a chunked import's bookkeeping is only as good as its knowledge of which
   * ordinals a given execution covered, and because `partitionOrdinalCount` is a REQUEST while this
   * is the OUTCOME after the clamp to the effective map. Read it together with
   * `exact.partitionsCreated`: if that is not the count the operator pinned, the ordinals in this
   * window mean something different from the ones the previous execution covered.
   */
  readonly executedPartitionOrdinalRange: BrazilReceitaFullJoinPartitionOrdinalBounds | null;
  /** Chunk-boundary offsets from the first traversed file. Evidence of progression, not a report. */
  readonly firstFileOffsetProgression: readonly number[];
  readonly cleanupOutcome: BrazilReceitaFullJoinWorkspaceCleanupOutcome | null;
}

export interface BrazilReceitaFullJoinStreamingEngine {
  run(request: BrazilReceitaFullJoinEngineRequest): Promise<BrazilReceitaFullJoinEngineResult>;
  attemptsConsumed(): number;
}

// ─── Refusal mapping ──────────────────────────────────────────────────────────

/**
 * Maps a workspace refusal to the engine's terminal code, MOST SPECIFIC FIRST.
 *
 * The order is the whole content of this function. A run refused for lack of free disk and a run
 * refused because temporary storage is unapproved are different facts with different remedies, and
 * collapsing every workspace refusal into `temporary_workspace_unavailable` — which is what the
 * previous two-branch check did once § 4 added four new rejections — would hand an operator a code
 * that means "something about the destination" and leave them to guess which something.
 */
function workspaceRejectionAbortCode(
  rejections: readonly BrazilReceitaFullJoinWorkspaceRejection[],
): BrazilReceitaFullJoinEngineAbortCode {
  if (rejections.includes('temporary_storage_policy_not_approved')) {
    return 'temporary_storage_policy_not_approved';
  }
  if (rejections.includes('handle_caps_invalid')) return 'handle_caps_incomplete';
  if (rejections.includes('free_disk_thresholds_invalid')) return 'free_disk_thresholds_invalid';
  if (rejections.includes('free_disk_measurement_unavailable')) {
    return 'free_disk_measurement_unavailable';
  }
  if (rejections.includes('insufficient_free_disk_before_start')) {
    return 'insufficient_free_disk_before_start';
  }
  return 'temporary_workspace_unavailable';
}

/** Maps a per-append workspace failure to the engine's terminal code. Same principle, same order. */
function appendFailureAbortCode(
  failure: BrazilReceitaFullJoinWorkspaceFailure,
): BrazilReceitaFullJoinEngineAbortCode {
  switch (failure) {
    case 'temporary_storage_cap_exceeded':
      return 'temporary_storage_cap_exceeded';
    case 'partition_handle_cap_exceeded':
      return 'files_opened_cap_exceeded';
    case 'free_disk_reserve_breached':
      return 'free_disk_reserve_breached';
    case 'free_disk_measurement_unavailable':
      return 'free_disk_measurement_unavailable';
    default:
      return 'partition_io_failed';
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export function createBrazilReceitaFullJoinStreamingEngine(): BrazilReceitaFullJoinStreamingEngine {
  let consumed = 0;

  async function run(
    request: BrazilReceitaFullJoinEngineRequest,
  ): Promise<BrazilReceitaFullJoinEngineResult> {
    const tallies = emptyBrazilReceitaFullJoinEngineTallies();
    const partitionSummaries: BrazilReceitaFullJoinPartitionSummary[] = [];
    let firstFileOffsetProgression: readonly number[] = [];
    let workspace: BrazilReceitaFullJoinWorkspace | null = null;
    let cleanupOutcome: BrazilReceitaFullJoinWorkspaceCleanupOutcome | null = null;
    let cleanupVerifiedAbsent = false;
    let filesReleased = 0;
    let partitionCount = 0;
    let partitionDepth = 0;
    // Set once, immediately before the Stage-3 loop. `null` until then, so a run that aborted in the
    // reference passes reports that it covered no ordinals rather than implying it covered the map.
    let executedPartitionOrdinalRange: BrazilReceitaFullJoinPartitionOrdinalBounds | null = null;
    let temporaryBytes = 0;
    // Sampled from the pool BEFORE each disposal, because a disposed workspace can no longer be
    // asked, and a repartition disposes one workspace and builds another. Taking the maximum across
    // depths is the honest reading: the peak is a property of the RUN, not of its last attempt.
    let partitionHandlePeak = 0;
    let partitionHandleEvictions = 0;
    let enforcer: BrazilReceitaFullJoinResourceEnforcer | null = null;

    /**
     * Folds the live workspace's descriptor statistics into the run-level accumulators.
     *
     * Idempotent per workspace INSTANCE, which is what makes it safe to call from both the release
     * path and the reporting path: a repartition disposes one workspace and builds another, so the
     * stats have to be captured before the reference is dropped, and a run that never repartitioned
     * must not have its single workspace counted twice.
     */
    const foldedWorkspaces = new Set<BrazilReceitaFullJoinWorkspace>();
    function foldPartitionHandleStats(): void {
      if (workspace === null || foldedWorkspaces.has(workspace)) return;
      foldedWorkspaces.add(workspace);
      const stats = workspace.handleStats();
      partitionHandlePeak = Math.max(partitionHandlePeak, stats.peakOpen);
      partitionHandleEvictions += stats.evictions;
    }

    /** Builds the terminal result. The single exit point, so no path can skip the public report. */
    function finish(
      abortCode: BrazilReceitaFullJoinEngineAbortCode | null,
      abortStage: BrazilReceitaFullJoinEngineAbortStage | null,
      rejections: {
        reader?: readonly BrazilReceitaFullJoinReaderCapRejection[];
        partitioning?: readonly BrazilReceitaFullJoinPartitioningCapRejection[];
        partitionOrdinalRange?: readonly BrazilReceitaFullJoinPartitionOrdinalRangeRejection[];
        resource?: readonly BrazilReceitaFullJoinCapRejection[];
        workspace?: readonly BrazilReceitaFullJoinWorkspaceRejection[];
      } = {},
      declaredPolicy: BrazilReceitaFullJoinDuplicateKeyPolicy | 'not_declared' = 'not_declared',
    ): BrazilReceitaFullJoinEngineResult {
      foldPartitionHandleStats();
      const exact: BrazilReceitaFullJoinEngineExactObservations = {
        resource: enforcer?.readExactObservations() ?? emptyBrazilReceitaFullJoinResourceObservations(),
        empresaRowsTraversed: tallies.empresaRows,
        estabelecimentoRowsTraversed: tallies.estabelecimentoRows,
        referencesPersisted: tallies.references,
        matchesEmitted: tallies.matches,
        orphanEstabelecimentoCount: tallies.orphans,
        empresaKeysWithoutEstabelecimento: tallies.companiesWithoutEstablishment,
        invalidKeyCount: tallies.invalidKeys,
        malformedRowCount: tallies.malformedRows,
        duplicateEmpresaKeyCount: tallies.duplicateKeys,
        partitionsCreated: partitionCount,
        largestPartitionReferenceCount: tallies.largestPartition,
        peakKeyWindowSize: tallies.peakKeyWindow,
        temporaryStorageBytesWritten: temporaryBytes,
        partitionDepthReached: partitionDepth,
        filesTraversedToEndOfFile: tallies.filesToEof,
        sourceFilesDeclared: Array.isArray(request.sources) ? request.sources.length : 0,
        filesOpenedPeak: request.openHandleLedger.peakOpen(),
        partitionHandlePeakOpen: partitionHandlePeak,
        partitionHandleEvictions,
      };

      // The projection into buckets lives in `-engine-report`, and every exit goes through it. A
      // second construction site is how a report grows a field the sanitizer has never seen.
      const publicReport = buildBrazilReceitaFullJoinEnginePublicReport({
        exact,
        abortCode,
        abortStage,
        duplicateKeyPolicy: declaredPolicy,
        workspaceCreated: workspace !== null,
        cleanupOutcome,
        cleanupVerifiedAbsent,
        filesReleased,
      });

      return {
        exitStatus: abortCode === null ? 'completed' : 'aborted',
        abortCode,
        abortStage,
        resourceBreach: enforcer?.breach() ?? null,
        readerCapRejections: rejections.reader ?? [],
        partitioningCapRejections: rejections.partitioning ?? [],
        partitionOrdinalRangeRejections: rejections.partitionOrdinalRange ?? [],
        resourceCapRejections: rejections.resource ?? [],
        workspaceRejections: rejections.workspace ?? [],
        exact,
        publicReport,
        partitionSummaries,
        executedPartitionOrdinalRange,
        firstFileOffsetProgression,
        cleanupOutcome,
      };
    }

    /** Runs the deletion engine and records the outcome with the 14B.0C enforcer. */
    function releaseWorkspace(): void {
      if (workspace === null) return;
      // Captured BEFORE disposal, because the repartition path drops the reference afterwards.
      foldPartitionHandleStats();
      const result = workspace.dispose();
      cleanupOutcome = result.outcome;
      cleanupVerifiedAbsent = result.verifiedAbsent;
      filesReleased = result.filesReleased;
      enforcer?.recordCleanup(result.outcome);
    }

    if (consumed >= 1) {
      // A second attempt is refused before anything is validated. See the module header: a retry
      // after a bounded run has already proven what it was going to prove.
      return finish('attempt_already_consumed', 'before_first_read');
    }
    consumed += 1;

    const readerResolution = resolveBrazilReceitaFullJoinReaderCaps(request.readerCaps);
    if (!readerResolution.ok) {
      return finish('reader_caps_incomplete', 'before_first_read', {
        reader: readerResolution.rejections,
      });
    }
    const readerCaps: BrazilReceitaFullJoinReaderCaps = readerResolution.caps;

    const partitioningResolution = resolveBrazilReceitaFullJoinPartitioningCaps(
      request.partitioningCaps,
    );
    if (!partitioningResolution.ok) {
      return finish('partitioning_caps_incomplete', 'before_first_read', {
        partitioning: partitioningResolution.rejections,
      });
    }
    const partitioningCaps: BrazilReceitaFullJoinPartitioningCaps = partitioningResolution.caps;

    const resourceResolution = resolveBrazilReceitaFullJoinResourceCaps(request.resourceCaps);
    if (!resourceResolution.ok) {
      return finish('resource_caps_incomplete', 'before_first_read', {
        resource: resourceResolution.rejections,
      });
    }

    if (!isBrazilReceitaFullJoinDuplicateKeyPolicy(request.duplicateKeyPolicy)) {
      return finish('duplicate_policy_not_declared', 'before_first_read');
    }
    const duplicatePolicy = request.duplicateKeyPolicy;

    if (!validateBrazilReceitaFullJoinSourceDescriptors(request.sources)) {
      return finish('source_descriptors_invalid', 'before_first_read', {}, duplicatePolicy);
    }

    // Validated HERE, at `before_first_read`, against the DECLARED partition count — so a malformed
    // or out-of-map chunk boundary costs zero data access instead of being discovered after two full
    // scans. The engine still does not clamp anything at this point; the clamp to the EFFECTIVE map
    // happens at Stage 3, where the effective map is finally known.
    const ordinalRangeResolution = resolveBrazilReceitaFullJoinPartitionOrdinalRange({
      start: request.partitionOrdinalStart,
      count: request.partitionOrdinalCount,
      declaredPartitionCount: partitioningCaps.partitionCount,
    });
    if (!ordinalRangeResolution.ok) {
      return finish(
        'partition_ordinal_range_invalid',
        'before_first_read',
        { partitionOrdinalRange: ordinalRangeResolution.rejections },
        duplicatePolicy,
      );
    }
    const ordinalRange: BrazilReceitaFullJoinPartitionOrdinalRange | null =
      ordinalRangeResolution.range;

    enforcer = createBrazilReceitaFullJoinResourceEnforcer(
      resourceResolution.caps,
      request.resourceDependencies,
    );
    const armed = enforcer.validateBeforeFirstAccess();
    if (!armed.ok) {
      return finish('resource_cap_breached', 'before_first_read', {}, duplicatePolicy);
    }
    const guard = enforcer;

    const empresaSources = request.sources.filter((source) => source.family === 'empresas');
    const estabelecimentoSources = request.sources.filter(
      (source) => source.family === 'estabelecimentos',
    );
    const rowBuffer = Buffer.alloc(readerCaps.maxRowBytes);

    // Every source descriptor this run opens — in the reference passes and in the join stage alike —
    // goes through the GLOBAL ledger, so `maxFilesOpened` bounds the number held AT ONE INSTANT
    // rather than only the number of times a dataset file was opened. Wrapping the PORT rather than
    // the call sites is what makes that true of paths written after this milestone too.
    const readerFileSystem = withBrazilReceitaFullJoinLedgerAccounting(
      request.readerFileSystem,
      request.openHandleLedger,
      'source_file',
    );

    // ── Stages 1 & 2, repeated only for a controlled repartition ───────────────
    let overflowed = false;
    for (partitionDepth = 0; ; partitionDepth += 1) {
      // Each depth doubles the map, under the same ceiling. Never above `maxPartitionCount`: § 6.1
      // forbids widening the limit after an adverse distribution, so the map is subdivided within it.
      partitionCount = Math.min(
        partitioningCaps.partitionCount * 2 ** partitionDepth,
        partitioningCaps.maxPartitionCount,
      );

      const creation = createBrazilReceitaFullJoinPartitionWorkspace({
        parentDirectory: request.workspaceParentDirectory,
        boundaries: request.workspaceBoundaries,
        fileSystem: request.workspaceFileSystem,
        maxTemporaryStorageBytes: resourceResolution.caps.maxTemporaryStorageBytes,
        maxOpenPartitionFiles: request.maxOpenPartitionFiles,
        openHandleLedger: request.openHandleLedger,
        minimumFreeDiskBeforeStart: request.minimumFreeDiskBeforeStart,
        minimumFreeDiskReserve: request.minimumFreeDiskReserve,
        freeDiskProbe: request.freeDiskProbe,
        realDataRun: request.realDataRun,
        invocationTemporaryStorageApproval: request.invocationTemporaryStorageApproval,
      });
      if (!creation.ok) {
        return finish(
          workspaceRejectionAbortCode(creation.rejections),
          'before_first_read',
          { workspace: creation.rejections },
          duplicatePolicy,
        );
      }
      workspace = creation.workspace;
      const openWorkspace = creation.workspace;

      const partitionLoads = new Map<string, number>();
      overflowed = false;
      let referencePassFailure: {
        code: BrazilReceitaFullJoinEngineAbortCode;
        stage: BrazilReceitaFullJoinEngineAbortStage;
      } | null = null;

      for (const family of ['empresas', 'estabelecimentos'] as const) {
        const stage: BrazilReceitaFullJoinEngineAbortStage =
          family === 'empresas' ? 'empresas_reference_pass' : 'estabelecimentos_reference_pass';
        const phase = family === 'empresas' ? 'empresas_read' : 'estabelecimentos_read';
        const checkpoint = family === 'empresas' ? 'after_empresas_read' : 'after_estabelecimentos_read';
        const expectedColumns = getBrReceitaCnpjOfficialColumnCount(family);
        const sources = family === 'empresas' ? empresaSources : estabelecimentoSources;

        guard.beginPhase(phase);
        const due = createBrazilReceitaFullJoinPeriodicCheckpointSchedule();
        let rowsInPhase = 0;

        for (const source of sources) {
          let appendFailure: BrazilReceitaFullJoinEngineAbortCode | null = null;

          const traversal = readBrazilReceitaFullJoinFileSequentially({
            filePath: source.filePath,
            encoding: source.encoding,
            caps: readerCaps,
            fileSystem: readerFileSystem,
            resourceGuard: guard,
            onRow: (row) => {
              rowsInPhase += 1;
              if (family === 'empresas') tallies.empresaRows += 1;
              else tallies.estabelecimentoRows += 1;

              if (row.columnCount !== expectedColumns) {
                // Counted and skipped. A row whose positional width is not the official one cannot
                // be trusted to have the join column where the layout says it is.
                tallies.malformedRows += 1;
                return 'continue';
              }
              const rawKey = readBrazilReceitaFullJoinFieldAt(
                row.text,
                BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER,
                BRAZIL_RECEITA_FULL_JOIN_KEY_COLUMN_INDEX,
              );
              const key = normalizeBrazilReceitaFullJoinKey(rawKey);
              if (key === null) {
                tallies.invalidKeys += 1;
                return 'continue';
              }
              const ordinal = brazilReceitaFullJoinPartitionOrdinalFor(key, partitionCount);
              // The key and its digest end here. What survives is an ordinal and three integers.
              const appended = openWorkspace.appendReference(
                {
                  sourceFileOrdinal: source.sourceFileOrdinal,
                  byteOffset: row.byteOffset,
                  byteLength: row.byteLength,
                  family,
                },
                ordinal,
              );
              if (!appended.ok) {
                appendFailure = appendFailureAbortCode(appended.failure);
                return 'stop';
              }
              tallies.references += 1;
              temporaryBytes = openWorkspace.bytesWritten();
              // Recorded on EVERY successful append, not just once at final cleanup (BR-SOURCE-
              // 14B.0H § 13): a run that aborts mid-pass must still be able to report the temporary
              // storage it actually spilled, and the only way the enforcer can know that is if it is
              // told as it happens rather than after the fact.
              guard.noteTemporaryStorageBytes(temporaryBytes);

              const loadKey = `${family}:${ordinal}`;
              const load = (partitionLoads.get(loadKey) ?? 0) + 1;
              partitionLoads.set(loadKey, load);
              if (load > tallies.largestPartition) tallies.largestPartition = load;
              if (
                load > partitioningCaps.maxReferencesPerPartition ||
                load * BRAZIL_RECEITA_FULL_JOIN_REFERENCE_RECORD_BYTES >
                  partitioningCaps.maxReferenceBytesPerPartition
              ) {
                // An adverse distribution, detected while it is still safe to fix: no match has been
                // emitted, so the reference passes can be redone at a finer partition map.
                overflowed = true;
                return 'stop';
              }

              if (due(rowsInPhase)) {
                const outcome = guard.checkpoint(checkpoint);
                if (!outcome.ok) {
                  appendFailure = 'resource_cap_breached';
                  return 'stop';
                }
              }
              return 'continue';
            },
          });

          if (appendFailure !== null) {
            referencePassFailure = { code: appendFailure, stage };
            break;
          }
          if (overflowed) break;
          if (!traversal.ok) {
            const code: BrazilReceitaFullJoinEngineAbortCode =
              traversal.abortCode === 'non_progressing_reader'
                ? 'non_progressing_reader'
                : traversal.abortCode === 'row_bytes_cap_exceeded'
                  ? 'row_bytes_cap_exceeded'
                  : traversal.abortCode === 'carry_bytes_cap_exceeded'
                    ? 'carry_bytes_cap_exceeded'
                    : traversal.abortCode === 'columns_cap_exceeded'
                      ? 'columns_cap_exceeded'
                      : traversal.abortCode === 'resource_envelope_breached'
                        ? 'resource_cap_breached'
                        : 'reader_failed';
            referencePassFailure = { code, stage };
            break;
          }
          if (firstFileOffsetProgression.length === 0) {
            firstFileOffsetProgression = traversal.offsetProgression;
          }
          if (traversal.reachedEndOfFile) tallies.filesToEof += 1;
        }

        const ended = guard.endPhase(phase);
        if (referencePassFailure === null && !overflowed && !ended.ok) {
          referencePassFailure = { code: 'resource_cap_breached', stage };
        }
        if (referencePassFailure === null && !overflowed) {
          const checked = guard.checkpoint(checkpoint);
          if (!checked.ok) referencePassFailure = { code: 'resource_cap_breached', stage };
        }
        if (referencePassFailure !== null || overflowed) break;
      }

      if (referencePassFailure !== null) {
        // Wrapped in the SAME 'cleanup' phase boundaries as the success path (below), so an early
        // abort's cleanup gets a measured `durationMs` too, instead of leaving it `null` forever
        // (BR-SOURCE-14B.0H § 14). `beginPhase`/`endPhase` record timing even when the enforcer is
        // already latched from `referencePassFailure`'s own breach — see resource-envelope.ts.
        guard.beginPhase('cleanup');
        releaseWorkspace();
        guard.endPhase('cleanup');
        return finish(referencePassFailure.code, referencePassFailure.stage, {}, duplicatePolicy);
      }

      if (!overflowed) break;

      // ── Controlled repartition (§ 6.2) ───────────────────────────────────────
      const nextCount = partitionCount * 2;
      const mayRepartition =
        partitionDepth + 1 <= partitioningCaps.maxPartitionDepth &&
        nextCount <= partitioningCaps.maxPartitionCount &&
        openWorkspace.bytesWritten() < resourceResolution.caps.maxTemporaryStorageBytes &&
        guard.mayAccessData();
      // The references collected under the coarser map are useless now and are deleted before the
      // finer pass starts, so temporary storage does not accumulate across depths.
      if (mayRepartition) {
        // An INTERIM disposal, not the run's final cleanup: a fresh workspace is about to be built at
        // the next depth. Left unwrapped, exactly as before — wrapping it in 'cleanup' here would make
        // `endPhase('cleanup')` record THIS disposal's duration and leave the real final cleanup's
        // `durationNs` stuck at `null` (`endPhase` only measures a phase once).
        releaseWorkspace();
        workspace = null;
      } else {
        // This IS the run's final disposal for a `partition_capacity_exceeded` abort — the same class
        // of gap as `referencePassFailure` above, and fixed the same way (BR-SOURCE-14B.0H § 14).
        guard.beginPhase('cleanup');
        releaseWorkspace();
        workspace = null;
        guard.endPhase('cleanup');
        return finish('partition_capacity_exceeded', 'estabelecimentos_reference_pass', {}, duplicatePolicy);
      }
      // Counters that describe the discarded pass are reset; the run is starting its reference
      // passes over, not continuing them.
      resetBrazilReceitaFullJoinPassTallies(tallies);
      firstFileOffsetProgression = [];
      cleanupOutcome = null;
      cleanupVerifiedAbsent = false;
      filesReleased = 0;
    }

    const activeWorkspace = workspace;
    if (activeWorkspace === null) {
      return finish('temporary_workspace_unavailable', 'before_first_read', {}, duplicatePolicy);
    }

    // ── Stage 3: partitioned join ─────────────────────────────────────────────
    const handles = new Map<number, number>();
    let joinFailure: {
      code: BrazilReceitaFullJoinEngineAbortCode;
      stage: BrazilReceitaFullJoinEngineAbortStage;
    } | null = null;

    function handleFor(ordinal: number, filePath: string): number | null {
      const existing = handles.get(ordinal);
      if (existing !== undefined) return existing;
      if (!guard.noteFileOpened().ok) return null;
      try {
        const handle = readerFileSystem.open(filePath);
        handles.set(ordinal, handle);
        return handle;
      } catch {
        return null;
      }
    }

    function pathFor(ordinal: number): string | null {
      return request.sources.find((source) => source.sourceFileOrdinal === ordinal)?.filePath ?? null;
    }

    function encodingFor(ordinal: number): 'latin1' | 'utf8' {
      return request.sources.find((source) => source.sourceFileOrdinal === ordinal)?.encoding ?? 'utf8';
    }

    /** Re-reads one row by reference and returns its normalized join key, or a failure. */
    function keyOf(
      reference: BrazilReceitaFullJoinRowReference,
    ): { readonly ok: true; readonly key: string | null } | { readonly ok: false } {
      const filePath = pathFor(reference.sourceFileOrdinal);
      if (filePath === null) return { ok: false };
      const handle = handleFor(reference.sourceFileOrdinal, filePath);
      if (handle === null) return { ok: false };
      const fetched = fetchBrazilReceitaFullJoinRowByReference({
        handle,
        byteOffset: reference.byteOffset,
        byteLength: reference.byteLength,
        encoding: encodingFor(reference.sourceFileOrdinal),
        buffer: rowBuffer,
        fileSystem: readerFileSystem,
        resourceGuard: guard,
      });
      if (!fetched.ok) return { ok: false };
      const raw = readBrazilReceitaFullJoinFieldAt(
        fetched.text,
        BRAZIL_RECEITA_FULL_JOIN_OFFICIAL_DELIMITER,
        BRAZIL_RECEITA_FULL_JOIN_KEY_COLUMN_INDEX,
      );
      return { ok: true, key: normalizeBrazilReceitaFullJoinKey(raw) };
    }

    guard.beginPhase('estabelecimentos_read');

    // The ONE line this capability changes: the same loop, over a window instead of over the map.
    // With no range declared the window IS the map (`0 .. partitionCount`), so this is byte-for-byte
    // the previous traversal. With a range declared, every skipped ordinal costs nothing — no
    // `readPartitionSlice`, no `keyOf`, no row re-read, no key window, no sink call — because the
    // selection is the loop bound and not a filter downstream of the work.
    const ordinalBounds = brazilReceitaFullJoinPartitionOrdinalBounds(ordinalRange, partitionCount);
    executedPartitionOrdinalRange = ordinalBounds;

    for (
      let ordinal = ordinalBounds.start;
      ordinal < ordinalBounds.endExclusive && joinFailure === null;
      ordinal += 1
    ) {
      // The BOUNDED key window: one partition's Empresas keys, cleared before the next partition.
      const window = new Map<string, readonly BrazilReceitaFullJoinRowReference[]>();
      const matched = new Set<string>();
      let empresaKeysLoaded = 0;
      let streamed = 0;
      let matches = 0;
      let orphans = 0;
      let invalidKeysInPartition = 0;

      let cursor = 0;
      let exhausted = false;
      while (!exhausted && joinFailure === null) {
        const slice = activeWorkspace.readPartitionSlice(
          'empresas',
          ordinal,
          cursor,
          BRAZIL_RECEITA_FULL_JOIN_REFERENCE_READ_BATCH,
        );
        if (!slice.ok) {
          joinFailure = { code: 'partition_io_failed', stage: 'partitioned_join' };
          break;
        }
        cursor = slice.nextRecordIndex;
        exhausted = slice.exhausted;
        for (const reference of slice.references) {
          const resolved = keyOf(reference);
          if (!resolved.ok) {
            joinFailure = { code: 'reader_failed', stage: 'partitioned_join' };
            break;
          }
          if (resolved.key === null) {
            tallies.invalidKeys += 1;
            invalidKeysInPartition += 1;
            continue;
          }
          const existing = window.get(resolved.key);
          if (existing === undefined) {
            window.set(resolved.key, [reference]);
            empresaKeysLoaded += 1;
          } else {
            tallies.duplicateKeys += 1;
            if (duplicatePolicy === 'reject') {
              // Fail-closed, and loudly. The alternative — keeping one and dropping the other — is
              // the silent de-duplication § 9 forbids.
              joinFailure = { code: 'duplicate_empresa_key_rejected', stage: 'partitioned_join' };
              break;
            }
            window.set(resolved.key, [...existing, reference]);
          }
          if (window.size > tallies.peakKeyWindow) tallies.peakKeyWindow = window.size;
          if (!guard.noteJoinKeysInMemory(window.size).ok) {
            joinFailure = { code: 'resource_cap_breached', stage: 'partitioned_join' };
            break;
          }
        }
      }

      cursor = 0;
      exhausted = false;
      while (!exhausted && joinFailure === null) {
        const slice = activeWorkspace.readPartitionSlice(
          'estabelecimentos',
          ordinal,
          cursor,
          BRAZIL_RECEITA_FULL_JOIN_REFERENCE_READ_BATCH,
        );
        if (!slice.ok) {
          joinFailure = { code: 'partition_io_failed', stage: 'partitioned_join' };
          break;
        }
        cursor = slice.nextRecordIndex;
        exhausted = slice.exhausted;

        for (const reference of slice.references) {
          streamed += 1;
          const resolved = keyOf(reference);
          if (!resolved.ok) {
            joinFailure = { code: 'reader_failed', stage: 'partitioned_join' };
            break;
          }
          if (resolved.key === null) {
            tallies.invalidKeys += 1;
            invalidKeysInPartition += 1;
            continue;
          }
          const companyReferences = window.get(resolved.key);
          if (companyReferences === undefined) {
            // The same key always lands in the same partition, so an absent key here is a genuine
            // orphan rather than a partition artefact.
            orphans += 1;
            tallies.orphans += 1;
            continue;
          }
          matched.add(resolved.key);
          for (const companyReference of companyReferences) {
            const record: BrazilReceitaFullJoinBoundedJoinedRecord = {
              empresaReference: companyReference,
              estabelecimentoReference: reference,
              partitionOrdinal: ordinal,
            };
            // A MATERIALIZING sink is accounted for BEFORE the record reaches it. Under
            // `maxOutputRows: 0` this breaches on the first match, so an importing sink cannot run
            // inside a benchmark envelope even if a caller wires one up by mistake.
            if (request.sinkMaterializesRows && !guard.noteOutputRowsMaterialized(1).ok) {
              joinFailure = { code: 'resource_cap_breached', stage: 'partitioned_join' };
              break;
            }
            try {
              await request.sink.onMatch(record);
            } catch {
              joinFailure = { code: 'sink_failed', stage: 'partitioned_join' };
              break;
            }
            matches += 1;
            tallies.matches += 1;
          }
          if (joinFailure !== null) break;
        }
        if (joinFailure === null) {
          const checked = guard.checkpoint('after_join');
          if (!checked.ok) joinFailure = { code: 'resource_cap_breached', stage: 'partitioned_join' };
        }
      }

      const withoutEstablishment = empresaKeysLoaded - matched.size;
      tallies.companiesWithoutEstablishment += Math.max(0, withoutEstablishment);

      const summary: BrazilReceitaFullJoinPartitionSummary = {
        partitionOrdinal: ordinal,
        empresaKeysLoaded,
        estabelecimentoReferencesStreamed: streamed,
        matchesEmitted: matches,
        empresaKeysWithoutEstabelecimento: Math.max(0, withoutEstablishment),
        orphanEstabelecimentoCount: orphans,
        invalidKeyCount: invalidKeysInPartition,
        // Malformed rows are rejected during the reference passes, so a partition never receives
        // one: a reference only exists for a row whose positional width was already the official
        // one. Reported as zero because that is the fact, not because it is unmeasured.
        malformedRowCount: 0,
      };
      partitionSummaries.push(summary);
      if (joinFailure === null && request.sink.onPartitionComplete !== undefined) {
        try {
          await request.sink.onPartitionComplete(summary);
        } catch {
          joinFailure = { code: 'sink_failed', stage: 'partitioned_join' };
        }
      }

      // The window is released HERE, before the next partition is touched. This is the line that
      // makes peak memory a function of the partition cap rather than of the dataset.
      window.clear();
      matched.clear();
      if (!guard.noteJoinKeysInMemory(0).ok && joinFailure === null) {
        joinFailure = { code: 'resource_cap_breached', stage: 'partitioned_join' };
      }
    }

    for (const handle of handles.values()) {
      try {
        readerFileSystem.close(handle);
      } catch {
        // A close failure does not change the join's verdict; cleanup below is what must be honest.
      }
    }
    handles.clear();
    guard.endPhase('estabelecimentos_read');

    if (joinFailure === null) {
      try {
        await request.sink.finalize();
      } catch {
        joinFailure = { code: 'sink_failed', stage: 'partitioned_join' };
      }
    }

    // Cleanup runs on EVERY path, including a sink failure and a cap breach.
    guard.beginPhase('cleanup');
    guard.noteTemporaryStorageBytes(temporaryBytes);
    releaseWorkspace();
    guard.endPhase('cleanup');
    guard.checkpoint('after_cleanup');

    if (joinFailure !== null) {
      return finish(joinFailure.code, joinFailure.stage, {}, duplicatePolicy);
    }
    if (cleanupOutcome === 'failed') {
      return finish('cleanup_failed', 'cleanup', {}, duplicatePolicy);
    }
    if (cleanupOutcome === 'unverified') {
      return finish('cleanup_unverified', 'cleanup', {}, duplicatePolicy);
    }

    guard.beginPhase('sanitization');
    const sanitizationCheck = guard.checkpoint('after_sanitization');
    guard.endPhase('sanitization');
    if (!sanitizationCheck.ok) {
      return finish('resource_cap_breached', 'cleanup', {}, duplicatePolicy);
    }

    return finish(null, null, {}, duplicatePolicy);
  }

  return {
    run,
    attemptsConsumed() {
      return consumed;
    },
  };
}

/** One attempt, one engine. The convenience wrapper cannot be talked into a second run. */
export async function runBrazilReceitaFullJoinStreamingEngineOnce(
  request: BrazilReceitaFullJoinEngineRequest,
): Promise<BrazilReceitaFullJoinEngineResult> {
  return createBrazilReceitaFullJoinStreamingEngine().run(request);
}
