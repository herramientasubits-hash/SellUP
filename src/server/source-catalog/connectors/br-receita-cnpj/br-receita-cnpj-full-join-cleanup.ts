/**
 * BR Receita CNPJ — full join dry-run FAILURE CLEANUP model (BR-SOURCE-11A).
 *
 * GATE-6 (failure cleanup) is NOT approved, and GATE-2 (temporary storage envelope)
 * is NOT approved either — so in BR-SOURCE-11A the runner produces NO temporary
 * artifacts at all, and cleanup is a modelled no-op rather than a deletion engine.
 *
 * This module exists to make the eventual contract explicit and testable now:
 *
 *   - WHAT would need cleaning (artifact kinds, counted — never named);
 *   - WHEN cleanup becomes required (any sanitizer failure, any guard failure, any
 *     recorded error, or any declared artifact);
 *   - HOW a cleanup outcome is reported (aggregate, sanitized, value-free).
 *
 * ── The cleanup model NEVER ─────────────────────────────────────────────────────
 *   - deletes a real dataset file, a manifest, a download, or anything under the
 *     operator's own directories.
 *   - deletes a repository path.
 *   - accepts an arbitrary path to remove. `planCleanup` takes DECLARED artifact
 *     counts, not paths, so there is no path for it to act on by construction.
 *   - reports a filesystem path, an artifact name, or any dataset value.
 *
 * When a future hito grants GATE-2 + GATE-6, the deletion engine layered on top of
 * this model must confine itself to a temp directory it created itself, and must
 * still report through `BrazilReceitaFullJoinCleanupReport`.
 */

// ─── Artifact kinds ───────────────────────────────────────────────────────────

/**
 * The kinds of temporary artifact a full join could produce once a temporary
 * storage envelope is approved. Counted only — an artifact is never named, and its
 * path is never carried.
 */
export type BrazilReceitaFullJoinArtifactKind =
  | 'temporary_join_index'
  | 'temporary_spill_file'
  | 'temporary_report_file'
  | 'temporary_scratch_directory';

export const BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS: readonly BrazilReceitaFullJoinArtifactKind[] =
  [
    'temporary_join_index',
    'temporary_spill_file',
    'temporary_report_file',
    'temporary_scratch_directory',
  ];

export type BrazilReceitaFullJoinArtifactCounts = Record<
  BrazilReceitaFullJoinArtifactKind,
  number
>;

export function emptyBrazilReceitaFullJoinArtifactCounts(): BrazilReceitaFullJoinArtifactCounts {
  const counts = {} as BrazilReceitaFullJoinArtifactCounts;
  for (const kind of BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS) counts[kind] = 0;
  return counts;
}

// ─── Cleanup status & error codes ─────────────────────────────────────────────

/**
 * `not_needed`  — nothing was produced and nothing failed.
 * `completed`   — cleanup ran and every declared artifact was released.
 * `failed`      — cleanup ran and could not release everything.
 * `not_executed`— cleanup was REQUIRED but did not run. In BR-SOURCE-11A this is the
 *                 honest status whenever cleanup is required, because no deletion
 *                 engine is authorized yet.
 */
export type BrazilReceitaFullJoinCleanupStatus =
  | 'not_needed'
  | 'completed'
  | 'failed'
  | 'not_executed';

/** Why a cleanup could not complete. Fixed machine codes; never a path or value. */
export type BrazilReceitaFullJoinCleanupErrorCode =
  | 'cleanup_engine_not_authorized'
  | 'artifact_release_failed'
  | 'artifact_outside_managed_envelope';

export const BRAZIL_RECEITA_FULL_JOIN_CLEANUP_ERROR_CODES: readonly BrazilReceitaFullJoinCleanupErrorCode[] =
  ['cleanup_engine_not_authorized', 'artifact_release_failed', 'artifact_outside_managed_envelope'];

export type BrazilReceitaFullJoinCleanupErrorCounts = Record<
  BrazilReceitaFullJoinCleanupErrorCode,
  number
>;

export function emptyBrazilReceitaFullJoinCleanupErrorCounts(): BrazilReceitaFullJoinCleanupErrorCounts {
  const counts = {} as BrazilReceitaFullJoinCleanupErrorCounts;
  for (const code of BRAZIL_RECEITA_FULL_JOIN_CLEANUP_ERROR_CODES) counts[code] = 0;
  return counts;
}

// ─── Report shape ─────────────────────────────────────────────────────────────

/** The sanitized, aggregate cleanup block embedded in every full-join report. */
export interface BrazilReceitaFullJoinCleanupReport {
  readonly cleanup_required: boolean;
  readonly cleanup_status: BrazilReceitaFullJoinCleanupStatus;
  /**
   * Hard-wired false in BR-SOURCE-11A: no artifact is produced, so none can be left
   * behind. A future engine must compute this honestly rather than assert it.
   */
  readonly unsafe_artifacts_detected: false;
  readonly artifact_counts_by_type: BrazilReceitaFullJoinArtifactCounts;
  readonly cleanup_error_counts_by_code: BrazilReceitaFullJoinCleanupErrorCounts;
}

// ─── Planning input ───────────────────────────────────────────────────────────

/**
 * What the runner knows when it asks for a cleanup plan. Counts and booleans only:
 * there is deliberately no field for a path, so this model cannot be handed one.
 */
export interface BrazilReceitaFullJoinCleanupPlanInput {
  /** Declared temporary artifacts by kind. All zero in BR-SOURCE-11A. */
  readonly artifactCounts?: Partial<BrazilReceitaFullJoinArtifactCounts>;
  /** True when the output sanitizer rejected the report. Forces cleanup_required. */
  readonly sanitizerFailed: boolean;
  /** True when the no-write/no-runtime guard refused. Forces cleanup_required. */
  readonly guardFailed: boolean;
  /** Count of recorded run errors. Any error forces cleanup_required. */
  readonly errorCount: number;
}

function resolveArtifactCounts(
  partial: Partial<BrazilReceitaFullJoinArtifactCounts> | undefined,
): BrazilReceitaFullJoinArtifactCounts {
  const counts = emptyBrazilReceitaFullJoinArtifactCounts();
  if (partial === undefined) return counts;
  for (const kind of BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS) {
    const value = partial[kind];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      counts[kind] = value;
    }
  }
  return counts;
}

function totalArtifacts(counts: BrazilReceitaFullJoinArtifactCounts): number {
  let total = 0;
  for (const kind of BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS) total += counts[kind];
  return total;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Produces the cleanup block for one run. PURE — it plans and reports, it does not
 * delete: no filesystem call, no path, no I/O of any kind.
 *
 * Cleanup is REQUIRED when the sanitizer failed, the guard failed, any error was
 * recorded, or any temporary artifact was declared. Because no cleanup engine is
 * authorized in BR-SOURCE-11A, a required cleanup reports `not_executed` with
 * `cleanup_engine_not_authorized` — an honest "this would need cleaning and nothing
 * cleaned it", never a false `completed`.
 */
export function planBrazilReceitaFullJoinCleanup(
  input: BrazilReceitaFullJoinCleanupPlanInput,
): BrazilReceitaFullJoinCleanupReport {
  const artifactCounts = resolveArtifactCounts(input.artifactCounts);
  const artifacts = totalArtifacts(artifactCounts);
  const errorCount = Number.isInteger(input.errorCount) && input.errorCount > 0 ? input.errorCount : 0;

  const cleanupRequired =
    input.sanitizerFailed || input.guardFailed || errorCount > 0 || artifacts > 0;

  const errorCounts = emptyBrazilReceitaFullJoinCleanupErrorCounts();
  if (cleanupRequired) errorCounts.cleanup_engine_not_authorized = 1;

  return {
    cleanup_required: cleanupRequired,
    cleanup_status: cleanupRequired ? 'not_executed' : 'not_needed',
    unsafe_artifacts_detected: false,
    artifact_counts_by_type: artifactCounts,
    cleanup_error_counts_by_code: errorCounts,
  };
}
