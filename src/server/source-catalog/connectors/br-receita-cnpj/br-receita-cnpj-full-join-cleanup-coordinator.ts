/**
 * BR Receita CNPJ — GATE-6 EXECUTABLE CLEANUP CONTRACT (BR-SOURCE-GATE-ROUND-2).
 *
 * GATE-6 is the failure-cleanup gate (10K § 10). Before this round the cleanup story was split in
 * two, and neither half could satisfy the gate alone:
 *
 *   · `br-receita-cnpj-full-join-partition-workspace` CAN delete and verify — but only its own
 *     workspace, and it knows nothing about anything else the run created.
 *   · `br-receita-cnpj-full-join-cleanup` is a pure PLANNER that by construction cannot delete a
 *     path. It was written when no deletion engine was authorized, so a required cleanup ALWAYS
 *     reported `not_executed` / `cleanup_engine_not_authorized`, and `unsafe_artifacts_detected` was
 *     the hard-wired literal `false`. Honest at the time; unable to ever report a verified deletion,
 *     and unable to ever detect residue.
 *
 * This module is the missing middle: it OWNS a set of units, drives each unit's own verified
 * deletion, and reduces their outcomes to one status that cannot lie in the direction of success.
 *
 * ── The one invariant everything else serves ────────────────────────────────
 *
 * SUCCESS-WITH-RESIDUE IS UNREPRESENTABLE. `completed` is returned only when every registered unit
 * reported `verifiedAbsent` and left zero residual entries. There is no code path that produces
 * `completed` from an unverified, failed, or residue-bearing unit — see
 * `reduceUnitOutcomes`. GATE-6's fail criteria name that outcome explicitly, and GATE-2's recorded
 * cleanup contract sets `successWithResiduePermitted: false`.
 *
 * ── Terminal means terminal ─────────────────────────────────────────────────
 *
 * `failed` and `not_executed` are TERMINAL: once reached, the coordinator latches and every further
 * call returns the same result without touching a filesystem. A failed cleanup that a retry could
 * quietly upgrade to `completed` would defeat the point of recording it. Re-attempting is an
 * OPERATOR action, which means a new coordinator, not a second call on a latched one.
 *
 * ── Registration happens BEFORE creation ────────────────────────────────────
 *
 * A unit is registered when the run DECIDES to create it, not after it succeeds. That is what makes
 * cleanup-after-partial-initialization work: if the process dies between registering and creating,
 * the unit is still known and its deletion still runs (and verifies absent, because the thing was
 * never made). A ledger written after the fact cannot clean up a crash.
 *
 * ── This module NEVER (fail-closed by construction) ─────────────────────────
 *   - imports `node:fs`, `node:path` or any I/O module. It holds unit CLOSURES supplied by the module
 *     that owns each artifact, so it has no way to name, reach, or construct a path.
 *   - accepts a path from a caller. There is no path parameter anywhere in its API — the reason
 *     "never recursively delete an arbitrary parent directory" is structural here, not a rule.
 *   - deletes a dataset file, a manifest, a download, a repository path, `$HOME`, or the dataset
 *     root. It cannot: it only invokes deletions the owning modules already confined to themselves,
 *     each of which validated its own boundaries and symlink safety before creating anything.
 *   - reports a path, a file name, or any dataset value. Counts, enums and booleans only.
 *   - converts a failure into a success, or a retry into an upgrade.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - authorizes a run. GATE-6 governs what happens when a run ends; it does not start one.
 */

import {
  BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS,
  emptyBrazilReceitaFullJoinArtifactCounts,
  emptyBrazilReceitaFullJoinCleanupErrorCounts,
  type BrazilReceitaFullJoinArtifactCounts,
  type BrazilReceitaFullJoinArtifactKind,
  type BrazilReceitaFullJoinCleanupErrorCounts,
  type BrazilReceitaFullJoinCleanupReport,
  type BrazilReceitaFullJoinCleanupStatus,
} from './br-receita-cnpj-full-join-cleanup';

// ─── Unit classes (§ 16 — private artifacts are NOT partition data) ──────────

/**
 * The classes of thing a run owns. Kept apart because GATE-6's required evidence asks *which*
 * artifacts may survive and which must be destroyed, and "the temp join workspace" and "the private
 * operator metric artifact" have genuinely different lifecycles:
 *
 *   `partition_workspace`      — run-lifetime. Never survives. Nothing may read it after the run.
 *   `private_metric_artifact`  — TTL'd (default 1 h, hard ceiling 24 h), owner-only, off by default.
 *                                It may legitimately outlive the process, but it may NEVER outlive a
 *                                declared-completed cleanup path, which is what this coordinator
 *                                enforces.
 *   `snapshot_output`          — declared and REFUSED. It is neither temporary nor cleanup's
 *                                business, and `maxOutputRows` is 0 with a null sink. Registering one
 *                                is a programming error, and it is rejected rather than deleted:
 *                                a cleanup engine that could remove snapshot output is a cleanup
 *                                engine that could remove a snapshot.
 */
export type BrazilReceitaCleanupUnitClass =
  | 'partition_workspace'
  | 'private_metric_artifact'
  | 'snapshot_output';

export const BRAZIL_RECEITA_CLEANUP_UNIT_CLASSES: readonly BrazilReceitaCleanupUnitClass[] = [
  'partition_workspace',
  'private_metric_artifact',
  'snapshot_output',
] as const;

/** The classes this coordinator will actually clean. `snapshot_output` is deliberately absent. */
export const BRAZIL_RECEITA_CLEANABLE_UNIT_CLASSES: readonly BrazilReceitaCleanupUnitClass[] = [
  'partition_workspace',
  'private_metric_artifact',
] as const;

/** Which artifact-kind counter each cleanable class contributes to, for the § 5 report block. */
const ARTIFACT_KIND_BY_UNIT_CLASS: Readonly<
  Record<'partition_workspace' | 'private_metric_artifact', BrazilReceitaFullJoinArtifactKind>
> = {
  partition_workspace: 'temporary_scratch_directory',
  private_metric_artifact: 'temporary_report_file',
};

/** The private artifact's contractual TTL ceiling, restated as the class's lifecycle owner. */
export const BRAZIL_RECEITA_CLEANUP_UNIT_LIFECYCLE_OWNER: Readonly<
  Record<BrazilReceitaCleanupUnitClass, string>
> = {
  partition_workspace: 'GATE_2_TEMPORARY_STORAGE_ENVELOPE_RUN_LIFETIME',
  private_metric_artifact: 'BR_SOURCE_14B0C_PRIVATE_CHANNEL_TTL',
  snapshot_output: 'GATE_8_NO_WRITE_INVARIANT_NOT_A_CLEANUP_SUBJECT',
};

// ─── Unit outcome ─────────────────────────────────────────────────────────────

/**
 * What one unit's own deletion reported, normalized.
 *
 * This is the ONLY shape a unit may return, and every field is load-bearing:
 *
 *   `verifiedAbsent`   — a post-deletion existence check confirmed the thing is gone. An unlink that
 *                        returned successfully is NOT this; only the check is.
 *   `residualEntries`  — entries the unit refused to remove because it did not create them. Counted,
 *                        never named. Nonzero means residue, and residue forbids success.
 *   `deletionAttempted`— false when the unit could not even try. Kept separate from a failed attempt.
 */
export interface BrazilReceitaCleanupUnitOutcome {
  readonly verifiedAbsent: boolean;
  readonly residualEntries: number;
  readonly deletionAttempted: boolean;
}

/**
 * A registered unit: its class, and a closure that deletes IT and verifies.
 *
 * The closure is supplied by the module that created the artifact, so the boundary validation,
 * symlink safety, own-prefix confinement and pattern matching all stay where they were already
 * proved. This coordinator adds ordering, reduction and terminality — never a second deletion
 * implementation.
 */
export interface BrazilReceitaCleanupUnit {
  readonly unitClass: 'partition_workspace' | 'private_metric_artifact';
  /** Deletes this unit and verifies. Must not throw; a throw is treated as a failed attempt. */
  readonly destroy: () => BrazilReceitaCleanupUnitOutcome;
}

// ─── Coordinator result ───────────────────────────────────────────────────────

/** Why a cleanup did not reach `completed`. Machine codes; never a path, a name or a value. */
export type BrazilReceitaCleanupFailureCode =
  | 'unit_deletion_failed'
  | 'unit_deletion_unverified'
  | 'residual_entries_present'
  | 'unit_destroy_threw'
  | 'cleanup_never_invoked';

export const BRAZIL_RECEITA_CLEANUP_FAILURE_CODES: readonly BrazilReceitaCleanupFailureCode[] = [
  'unit_deletion_failed',
  'unit_deletion_unverified',
  'residual_entries_present',
  'unit_destroy_threw',
  'cleanup_never_invoked',
] as const;

export interface BrazilReceitaCleanupResult {
  readonly status: BrazilReceitaFullJoinCleanupStatus;
  readonly cleanupRequired: boolean;
  /** True only when EVERY registered unit verified absent with zero residue. */
  readonly allUnitsVerifiedAbsent: boolean;
  readonly unitsRegistered: number;
  readonly unitsVerifiedAbsent: number;
  readonly residualEntriesTotal: number;
  /** True when this status may never change again on this coordinator. */
  readonly terminal: boolean;
  readonly failureCodes: readonly BrazilReceitaCleanupFailureCode[];
  readonly artifactCounts: BrazilReceitaFullJoinArtifactCounts;
}

/** Raised when a caller registers a class this coordinator refuses to clean. */
export class BrazilReceitaCleanupUnitClassRefusedError extends Error {
  constructor(unitClass: string) {
    super(
      `BR Receita CNPJ cleanup coordinator: refusing to register unit class "${unitClass}". Only ${BRAZIL_RECEITA_CLEANABLE_UNIT_CLASSES.join(
        ' and ',
      )} are cleanup subjects; snapshot output is governed by the GATE-8 no-write invariant and is never deleted by a cleanup path.`,
    );
    this.name = 'BrazilReceitaCleanupUnitClassRefusedError';
  }
}

// ─── Reduction ────────────────────────────────────────────────────────────────

/**
 * Reduces per-unit outcomes to one status. The single place `completed` can be produced, and it is
 * guarded by a conjunction over every unit rather than by any per-unit shortcut.
 *
 * Order matters: residue and unverified deletions are checked BEFORE the success branch, so there is
 * no arrangement of inputs that reaches `completed` while a failure code exists.
 */
export function reduceBrazilReceitaCleanupUnitOutcomes(
  outcomes: readonly BrazilReceitaCleanupUnitOutcome[],
): {
  readonly ok: boolean;
  readonly failureCodes: readonly BrazilReceitaCleanupFailureCode[];
} {
  const failureCodes: BrazilReceitaCleanupFailureCode[] = [];

  for (const outcome of outcomes) {
    if (!outcome.deletionAttempted) {
      if (!failureCodes.includes('unit_deletion_failed')) failureCodes.push('unit_deletion_failed');
      continue;
    }
    if (outcome.residualEntries > 0 && !failureCodes.includes('residual_entries_present')) {
      failureCodes.push('residual_entries_present');
    }
    if (!outcome.verifiedAbsent && !failureCodes.includes('unit_deletion_unverified')) {
      failureCodes.push('unit_deletion_unverified');
    }
  }

  return { ok: failureCodes.length === 0, failureCodes };
}

// ─── The coordinator ──────────────────────────────────────────────────────────

export interface BrazilReceitaCleanupCoordinator {
  /**
   * Declares a unit the run owns. Call BEFORE creating the artifact.
   *
   * @throws {BrazilReceitaCleanupUnitClassRefusedError} for a non-cleanable class.
   */
  register(unit: BrazilReceitaCleanupUnit): void;
  /** Marks cleanup required for a reason that is not a unit: a sanitizer or guard refusal, an error. */
  requireCleanup(reason: 'sanitizer_failed' | 'guard_failed' | 'run_error'): void;
  /** Runs cleanup. Idempotent: a latched terminal or completed result is returned unchanged. */
  runCleanup(): BrazilReceitaCleanupResult;
  /** The last result, or null if `runCleanup` was never called. Performs no I/O. */
  lastResult(): BrazilReceitaCleanupResult | null;
  /**
   * The GATE-6 report block for a run whose cleanup was REQUIRED and never invoked.
   *
   * `not_executed`, terminal. This is the honest status for an abandoned run, and it is what makes
   * "not_executed when cleanup required → terminal" assertable rather than aspirational.
   */
  reportNotExecuted(): BrazilReceitaCleanupResult;
}

export function createBrazilReceitaCleanupCoordinator(): BrazilReceitaCleanupCoordinator {
  const units: BrazilReceitaCleanupUnit[] = [];
  let externalRequirement = false;
  let latched: BrazilReceitaCleanupResult | null = null;

  function artifactCountsFor(
    registered: readonly BrazilReceitaCleanupUnit[],
  ): BrazilReceitaFullJoinArtifactCounts {
    const counts = emptyBrazilReceitaFullJoinArtifactCounts();
    for (const unit of registered) {
      counts[ARTIFACT_KIND_BY_UNIT_CLASS[unit.unitClass]] += 1;
    }
    return counts;
  }

  function buildResult(params: {
    status: BrazilReceitaFullJoinCleanupStatus;
    cleanupRequired: boolean;
    unitsVerifiedAbsent: number;
    residualEntriesTotal: number;
    terminal: boolean;
    failureCodes: readonly BrazilReceitaCleanupFailureCode[];
  }): BrazilReceitaCleanupResult {
    return {
      status: params.status,
      cleanupRequired: params.cleanupRequired,
      // Not a second computation of success: it is the conjunction, and `completed` below is gated on
      // the same facts, so the two cannot disagree.
      allUnitsVerifiedAbsent:
        params.unitsVerifiedAbsent === units.length && params.residualEntriesTotal === 0,
      unitsRegistered: units.length,
      unitsVerifiedAbsent: params.unitsVerifiedAbsent,
      residualEntriesTotal: params.residualEntriesTotal,
      terminal: params.terminal,
      failureCodes: [...params.failureCodes],
      artifactCounts: artifactCountsFor(units),
    };
  }

  return {
    register(unit) {
      if (
        !BRAZIL_RECEITA_CLEANABLE_UNIT_CLASSES.includes(
          unit.unitClass as BrazilReceitaCleanupUnitClass,
        )
      ) {
        throw new BrazilReceitaCleanupUnitClassRefusedError(String(unit.unitClass));
      }
      units.push(unit);
    },

    requireCleanup() {
      externalRequirement = true;
    },

    runCleanup() {
      // IDEMPOTENCE. A latched result — terminal OR completed — is returned as-is, and no filesystem
      // is touched. This is what makes a double cleanup safe and a failed cleanup un-upgradable in
      // the same line of code.
      if (latched !== null) return latched;

      const cleanupRequired = units.length > 0 || externalRequirement;
      if (!cleanupRequired) {
        latched = buildResult({
          status: 'not_needed',
          cleanupRequired: false,
          unitsVerifiedAbsent: 0,
          residualEntriesTotal: 0,
          terminal: true,
          failureCodes: [],
        });
        return latched;
      }

      const outcomes: BrazilReceitaCleanupUnitOutcome[] = [];
      const throwCodes: BrazilReceitaCleanupFailureCode[] = [];

      // Every unit is attempted, even after one has failed. GATE-6 forbids "skipping a later step
      // because an earlier one failed": abandoning the remaining units would leave residue that
      // nobody ever tried to remove, and the run would report the first failure as if it were the
      // only one.
      for (const unit of units) {
        try {
          const outcome = unit.destroy();
          outcomes.push({
            verifiedAbsent: outcome.verifiedAbsent === true,
            residualEntries:
              Number.isInteger(outcome.residualEntries) && outcome.residualEntries > 0
                ? outcome.residualEntries
                : 0,
            deletionAttempted: outcome.deletionAttempted === true,
          });
        } catch {
          // A unit that threw made no verifiable claim about its own artifact. Treated as an
          // unattempted deletion, which cannot reach success.
          if (!throwCodes.includes('unit_destroy_threw')) throwCodes.push('unit_destroy_threw');
          outcomes.push({ verifiedAbsent: false, residualEntries: 0, deletionAttempted: false });
        }
      }

      const reduced = reduceBrazilReceitaCleanupUnitOutcomes(outcomes);
      const failureCodes = [...throwCodes, ...reduced.failureCodes];
      const unitsVerifiedAbsent = outcomes.filter(
        (outcome) => outcome.verifiedAbsent && outcome.residualEntries === 0,
      ).length;
      const residualEntriesTotal = outcomes.reduce(
        (total, outcome) => total + outcome.residualEntries,
        0,
      );

      // 🔴 The success gate, stated once. `completed` requires: no failure code, every unit verified
      // absent, and zero residue. Success-with-residue is not reachable from here.
      const succeeded =
        failureCodes.length === 0 &&
        unitsVerifiedAbsent === units.length &&
        residualEntriesTotal === 0;

      latched = buildResult({
        status: succeeded ? 'completed' : 'failed',
        cleanupRequired: true,
        unitsVerifiedAbsent,
        residualEntriesTotal,
        // Both outcomes latch: `failed` because GATE-2's cleanup contract makes it terminal, and
        // `completed` because a verified deletion has nothing left to redo.
        terminal: true,
        failureCodes,
      });
      return latched;
    },

    lastResult() {
      return latched;
    },

    reportNotExecuted() {
      if (latched !== null) return latched;
      const cleanupRequired = units.length > 0 || externalRequirement;
      latched = buildResult({
        status: cleanupRequired ? 'not_executed' : 'not_needed',
        cleanupRequired,
        unitsVerifiedAbsent: 0,
        residualEntriesTotal: 0,
        terminal: true,
        failureCodes: cleanupRequired ? ['cleanup_never_invoked'] : [],
      });
      return latched;
    },
  };
}

// ─── Bridge to the § 5 report block ───────────────────────────────────────────

/**
 * Renders a coordinator result as the sanitized cleanup block every full-join report embeds.
 *
 * 🔴 The one line that matters: `unsafe_artifacts_detected` is COMPUTED here, from residue and
 * verification. The planner's version was the hard-wired literal `false`, which was true of a runner
 * that produced nothing and would have been a lie for one that does.
 *
 * The report type declares that field as the literal `false`, so a residue-bearing run cannot be
 * squeezed into it — which is the correct failure mode: `toGate6CleanupReport` returns null instead,
 * and a caller with residue must report the coordinator result itself rather than a shape that says
 * everything is fine.
 */
export function brazilReceitaCleanupResultHasUnsafeResidue(
  result: BrazilReceitaCleanupResult,
): boolean {
  if (!result.cleanupRequired) return false;
  if (result.status === 'completed') return false;
  return result.residualEntriesTotal > 0 || result.status === 'failed';
}

export function toBrazilReceitaGate6CleanupReport(
  result: BrazilReceitaCleanupResult,
): BrazilReceitaFullJoinCleanupReport | null {
  if (brazilReceitaCleanupResultHasUnsafeResidue(result)) return null;

  const errorCounts: BrazilReceitaFullJoinCleanupErrorCounts =
    emptyBrazilReceitaFullJoinCleanupErrorCounts();
  for (const code of result.failureCodes) {
    if (code === 'residual_entries_present') {
      errorCounts.artifact_outside_managed_envelope += 1;
    } else if (code === 'cleanup_never_invoked') {
      errorCounts.cleanup_engine_not_authorized += 1;
    } else {
      errorCounts.artifact_release_failed += 1;
    }
  }

  return {
    cleanup_required: result.cleanupRequired,
    cleanup_status: result.status,
    unsafe_artifacts_detected: false,
    artifact_counts_by_type: result.artifactCounts,
    cleanup_error_counts_by_code: errorCounts,
  };
}

/** The artifact kinds this coordinator can account for. Exported so a test can assert coverage. */
export const BRAZIL_RECEITA_CLEANUP_COORDINATOR_ARTIFACT_KINDS: readonly BrazilReceitaFullJoinArtifactKind[] =
  BRAZIL_RECEITA_FULL_JOIN_ARTIFACT_KINDS;
